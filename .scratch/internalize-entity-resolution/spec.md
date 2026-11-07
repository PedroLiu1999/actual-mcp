Status: ready-for-agent

# Specification: Internalize Entity Identifier Resolution Behind Query and Budget Seams

## Problem Statement

When an AI agent or automated client interacts with Actual MCP to explore transactions or manage envelope balances, internal storage UUIDs leak across the interface seam. To query transactions for an account or category (e.g., checking how much was spent on "Groceries" or finding transactions in "Checking"), the agent cannot simply ask by name. Instead, it must execute prerequisite listing calls (`list_accounts`, `list_categories`, `list_payees`), parse extensive JSON arrays to extract internal UUIDs, and only then construct the query filter.

Similarly, when allocating budget envelopes via `set_budget_amount` or configuring rollover carryover via `set_budget_carryover`, the agent is required to provide a raw category UUID. When initiating bank synchronization via `run_bank_sync`, it must provide an account UUID. If the agent makes a spelling error or provides an entity name directly, the tools fail unhelpfully or return zero results without guidance.

This leak forces agents into multi-turn read-then-write or read-then-query loops, bloats prompt context with intermediate lookup payloads, and introduces substantial multi-turn latency.

## Solution

Internalize entity identifier resolution behind the gateway seam for all remaining query and envelope management interfaces. Callers can specify human-readable names or storage UUIDs interchangeably for:
1. `get_transactions`: Filtering by `account`, `category`, and `payee` names or UUIDs, with previous `*Id` parameters supported as aliases.
2. `set_budget_amount`: Allocating monthly envelope amounts by category name or UUID, with the response confirming both `categoryName` and `categoryId`.
3. `set_budget_carryover`: Configuring envelope rollover flags by category name or UUID, with the response confirming both `categoryName` and `categoryId`.
4. `run_bank_sync`: Synchronizing specific linked accounts by account name or UUID.

All resolutions execute in-process against the local Budget Cache with sub-millisecond response times. Invalid entity names fail fast with an actionable error containing Levenshtein-based suggestions (e.g., "Did you mean 'Groceries'?"), eliminating silent empty-result confusion and multi-turn lookup loops.

## User Stories

1. As an AI assistant, I want to filter transactions using natural category names (e.g., `category: "Groceries"`), so that I can report spending without making a prerequisite `list_categories` call.
2. As an AI assistant, I want to filter transactions using natural account names (e.g., `account: "Checking"`), so that I can view account activity in a single interaction.
3. As an AI assistant, I want to filter transactions using natural payee names (e.g., `payee: "Starbucks"`), so that I can find merchant charges without looking up payee IDs.
4. As an API client using legacy tooling, I want to pass `categoryId`, `accountId`, and `payeeId` with either UUIDs or human names, so that my existing integration continues to work without breaking.
5. As an AI assistant, I want typos in filter names to fail immediately with an error and fuzzy suggestions, so that I can correct my query right away rather than misinterpreting an empty result as zero transactions.
6. As a budget planner, I want to set a category's budgeted amount using its name (e.g., `category: "Dining Out"`), so that I can adjust envelopes directly from conversational instructions.
7. As a budget planner, I want the response of `set_budget_amount` to return both `categoryName` and `categoryId`, so that I have clear confirmation of which envelope was modified.
8. As a budget planner, I want to enable or disable budget carryover using a category name (e.g., `category: "Vacation"`), so that I can manage rollover policies without finding UUIDs first.
9. As a budget planner, I want the response of `set_budget_carryover` to return `categoryName` and `categoryId`, so that I have confirmation of the updated carryover rule.
10. As an automated finance script, I want to run bank synchronization for an account by name (e.g., `account: "Chase Sapphire"`), so that I don't need hardcoded UUIDs in my configuration.
11. As an AI assistant, I want `run_bank_sync` with no account parameter to continue synchronizing all linked accounts, so that global bank sync behavior is preserved.
12. As a system operator, I want entity resolution during queries to use the local Budget Cache without calling remote sync APIs, so that query latency remains sub-millisecond.
13. As an AI assistant, I want to optionally specify `forceSync: true` on query filters when I need guaranteed real-time parity with the Sync Server, so that fresh transactions are resolved accurately.
14. As an API consumer, I want exact UUIDs to resolve immediately without name lookups, so that programmatic UUID-based pipelines execute with zero overhead.
15. As a developer, I want case-insensitive matching for category, account, and payee names, so that capitalization differences do not cause false resolution failures.

## Implementation Decisions

- **Resolution Locality**: All name and UUID resolution logic resides inside the Budget Gateway behind its public interface seam. The MCP transport layer remains a thin schema validation and protocol delegation layer.
- **Resolver Re-use**: Deepen the gateway operations using the existing in-process Entity Resolver (`resolveAccount`, `resolveCategory`, `resolvePayee`), ensuring consistent resolution rules, case insensitivity, and suggestion generation across all tools.
- **Input Schema Polymorphism**: 
  - `get_transactions` schema accepts optional `account`, `category`, and `payee` strings (accepting human names or UUIDs), while keeping `accountId`, `categoryId`, and `payeeId` as optional backward-compatible aliases.
  - `set_budget_amount` schema accepts `category` (string, human name or UUID) as an alternative or primary field alongside `categoryId`.
  - `set_budget_carryover` schema accepts `category` (string, human name or UUID) as an alternative or primary field alongside `categoryId`.
  - `run_bank_sync` schema accepts optional `account` (string, human name or UUID) alongside optional `accountId`.
- **Enriched Return Payloads**: 
  - `SetBudgetAmountResult` and `SetBudgetCarryoverResult` payload types are augmented with `categoryName?: string` on both `previous` and `updated` envelope state objects.
- **Error Behavior**: When an entity name fails to match any entity in the Budget Cache, the gateway throws an `EntityResolutionError` containing the input term, target entity type, and fuzzy suggestions. The MCP layer surfaces this error with actionable guidance.
- **Coalesced Sync Alignment**: Query filters resolve against the already-downloaded local budget cache without remote sync network roundtrips. Remote sync occurs only when `forceSync: true` is explicitly provided or during write mutations.

## Testing Decisions

- **Testing Principles**: Tests will exercise external behavior at the highest possible seams without mocking internal resolution helper functions or asserting on private state.
- **Primary Seam - MCP Protocol Interface**: Test tools by invoking `server.handleRequest` with `CallToolRequest`, verifying that:
  - `get_transactions` filters by category name, account name, and payee name correctly.
  - Invalid filter names produce structured error responses with fuzzy suggestions.
  - `set_budget_amount` and `set_budget_carryover` accept category names and return enriched responses containing `categoryName`.
  - `run_bank_sync` accepts account names and triggers synchronization for the resolved account ID.
  - Backward compatibility is preserved when passing `*Id` arguments.
- **Secondary Seam - Budget Gateway Interface**: Test `actualBudgetGateway` methods directly against a mocked budget API adapter to verify input normalization, cache resolution, and error propagation.
- **Prior Art**: Follow existing test conventions in `tests/categoryTools.test.ts`, `tests/accountTools.test.ts`, and `tests/manageTransactions.test.ts`.

## Out of Scope

- Modifying ActualQL query translation (`run_aql_query`) filters; ActualQL queries operate directly on underlying database tables and syntax.
- Automatic fuzzy auto-creation of missing accounts or categories during query operations (queries should never mutate budget state).
- Multi-budget resolution; all resolution is scoped to the configured Target Budget.

## Further Notes

- Aligns with ADR-0010 and ADR-0011.
- Terminates remaining UUID leaks across the tool suite, achieving 100% human-name ergonomics across both mutation facades and analytical query tools.
