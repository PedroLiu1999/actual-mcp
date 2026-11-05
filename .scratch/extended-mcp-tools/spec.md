# Spec: Extended MCP Tool Suite for Budget Lifecycle and Bank Sync

Status: ready-for-agent

## Problem Statement

Users interacting with Actual Budget through conversational AI agents (such as Google Gemini via the Gemini Connector) in `actual-mcp` v0.1.0 can query accounts, view transactions, compute spending summaries, and make basic transaction and monthly budget allocations. However, they cannot manage categories or category groups (e.g., adding an envelope for "Daycare" or reorganizing expenses), curate payees or merge duplicates from messy bank imports, manage account lifecycles (opening a new account, closing or reopening accounts), trigger bank synchronizations on demand, or control month-to-month budget carryover and hold buffers. This forces users to drop out of conversational budgeting and open the desktop or web interface whenever category structures, account portfolios, payees, or bank feeds need maintenance.

## Solution

Extend `actual-mcp` to `v0.2.0` with 14 new MCP tools across three operational tiers:
1. **Tier 1 (Categories & Payees)**: Full lifecycle management for categories (`create_category`, `update_category`, `delete_category`), category groups (`create_category_group`, `update_category_group`, `delete_category_group`), and payees (`create_payee`, `update_payee`, `delete_payee`, `merge_payees`).
2. **Tier 2 (Account Lifecycle & Bank Sync)**: Account onboarding and maintenance (`create_account`, `update_account`, `close_account`, `reopen_account`) and on-demand reconciliation via `run_bank_sync`.
3. **Tier 3 (Budget Flow Adjustments)**: Envelope overspending carryover flags (`set_budget_carryover`) and monthly reserve buffer holds (`hold_budget_for_next_month`, `reset_budget_hold`).

All new tools maintain strict adherence to the **Decimal Amount** standard at the tool boundary, enforce safety guardrails against orphaned historical transactions on deletion/closure, and operate within the single-budget mutex and Coalesced Sync policy.

## User Stories

1. As a budgeting user, I want to create a new category under an existing category group, so that I can track expenses for a new spending goal.
2. As a budgeting user, I want to rename or change the parent group of an existing category, so that I can reorganize my envelope hierarchy.
3. As a budgeting user, I want to toggle whether a category is an income category or hidden, so that my active envelope views stay clean.
4. As a budgeting user, I want to delete an unused category without existing transactions, so that I can remove accidental or obsolete envelopes.
5. As a budgeting user, I want to delete a category that contains transactions by specifying a transfer category ID, so that historical spending is safely reassigned without orphaned records.
6. As a budgeting user, I want to create a new category group, so that I can group related expense or income envelopes together.
7. As a budgeting user, I want to rename or change visibility of a category group, so that my top-level budget layout reflects my financial structure.
8. As a budgeting user, I want to delete a category group and reassign its member categories and transactions, so that historical accounting remains intact.
9. As a budgeting user, I want to create a new payee by name, so that I can explicitly record merchants or payors before logging transactions.
10. As a budgeting user, I want to rename a payee, so that merchant names in my transaction history remain consistent and clean.
11. As a budgeting user, I want to delete an obsolete or unused payee, so that payee autocompletion lists do not become cluttered.
12. As a budgeting user, I want to merge multiple duplicate source payees into a canonical target payee, so that historical transactions and future rule matches consolidate under one merchant name.
13. As a budgeting user, I want to create a new on-budget or off-budget account with an account type and optional initial balance in Decimal Amount, so that I can track a newly opened bank account or credit card.
14. As a budgeting user, I want to update an account's name or toggle its off-budget status, so that my account portfolio remains accurate over time.
15. As a budgeting user, I want to close an account and optionally transfer its remaining balance to another account and category, so that closed accounts do not skew active balance totals.
16. As a budgeting user, I want to reopen a previously closed account, so that I can resume tracking transactions if the account becomes active again.
17. As a budgeting user, I want to trigger bank synchronization for a specific linked account, so that new transactions and cleared statuses are pulled immediately without waiting for background polling.
18. As a budgeting user, I want to trigger bank synchronization across all linked accounts simultaneously, so that my entire budget reflects the latest cleared bank activity.
19. As a budgeting user, I want the bank sync tool to return counts of new transactions, matched transactions, and updated accounts, so that the conversational agent can give me a concise reconciliation summary.
20. As a budgeting user, I want to toggle budget carryover on a category for a specific month, so that an overspent balance rolls over into that category's envelope next month instead of reducing the general available funds pool.
21. As a budgeting user, I want to hold a specified Decimal Amount from the current month's available funds for next month, so that I can plan ahead and hold funds for next month.
22. As a budgeting user, I want to reset the budget hold for a month, so that held funds are immediately restored to the current month's available budget.
23. As an LLM agent, I want destructive operations like deleting categories, closing accounts, and merging payees to carry clear destructive annotations, so that I can request user confirmation before proceeding with irreversible actions.
24. As an LLM agent, I want clear, structured validation errors when required destination IDs are missing during deletions, so that I can prompt the user for the necessary reassignments.

## Implementation Decisions

- **Operational Tiers and Scope**: Implement Tier 1 (Categories and Payees), Tier 2 (Account Lifecycle and Bank Sync), and Tier 3 (Budget Flow Adjustments). Low-level rules engine (`create_rule`) and raw recurrence schedules (`create_schedule`) are deferred to preserve LLM context budget and avoid deeply nested schema complexity (see ADR 0004).
- **Tool Boundary Money Representation**: All monetary inputs across all new tools (`initialBalance` for account creation, `amount` for budget holding) use **Decimal Amounts** represented as standard finite floating-point numbers in major currency units. Conversion to internal **Minor Unit Amounts** (integers) is isolated behind the gateway boundary.
- **Account Type Enumeration**: Account creation enforces an explicit enumeration of supported Actual account types: `checking`, `savings`, `credit`, `investment`, `mortgage`, `debt`, and `other`.
- **Destructive Deletion Guardrails**: `delete_category`, `delete_category_group`, and `close_account` are declared with MCP metadata annotation `destructiveHint: true`. When existing transactions or non-zero balances are present, a destination target ID (`transferCategoryId` or `transferAccountId`) must be provided, preventing orphaned records.
- **Payee Consolidation**: `merge_payees` requires a target payee ID and a list of at least one source payee ID. The gateway executes payee reassignment across transactions and cleans up source records within a single operation.
- **Bank Sync Reporting**: `run_bank_sync` accepts an optional `accountId`. When omitted, it runs bank sync across all linked accounts. The return payload is structured to report `updatedAccountIds`, `newTransactionsCount`, `matchedTransactionsCount`, and any provider error strings.
- **Concurrency and Cache Invalidation**: All mutation tools acquire the single-budget mutex, invoke the underlying engine methods, trigger an immediate `api.sync()` to the Sync Server, and invalidate in-memory metadata caches (accounts, categories, payees) so that subsequent reads within the same or subsequent sessions see fresh state.
- **Versioning**: Bump package version and MCP server info version to `0.2.0`, maintaining full backwards compatibility for all 12 existing v0.1.0 tools.

## Testing Decisions

- **Test Quality Standard**: Tests must verify externally observable behaviors through tool schemas and responses, rather than probing internal state variables. Each tool must be validated for successful execution, schema compliance, error handling for missing/invalid arguments, and proper conversion between Decimal Amounts and Minor Units.
- **Primary Integration Seam (Highest Seam)**: The primary test seam is the MCP Streamable HTTP endpoint (`POST /mcp` via the Express application), exercised using HTTP requests with JSON-RPC `tools/call`. This validates Zod schema parsing, annotation exposure, gateway delegation, and structured JSON output in a single realistic pass.
- **Gateway Unit Seam**: The secondary test seam is the budget gateway interface tested against mocked engine adapters to verify mutex locking, cache eviction, and upstream sync triggering.
- **Prior Art**: Modeled after existing tests in `tests/writeTools.test.ts` (for MCP tool invocations and validation) and `tests/gateway.test.ts` (for gateway synchronization and error propagation).

## Out of Scope

- Rule creation, modification, or rule ordering tools (`create_rule`, `delete_rule`, `get_rules`).
- Recurrence schedule editors (`create_schedule`, `update_schedule`, `delete_schedule`).
- Custom notes and tag attachments across entities.
- Direct file export/import endpoints (`exportBudget`, `importBudget`).
- Changes to OAuth authentication flows, token persistence, or multi-tenant authorization.

## Further Notes

- The 18 new tools (6 category/group, 4 payee, 5 account/sync, 3 budget flow) expand the MCP tool catalog from 12 to 30 tools (8 read, 22 write).
- All tools adhere to camelCase/snake_case tool naming conventions established in v0.1.0 (snake_case tool names, camelCase argument keys).
- The changes require no database schema migrations as `@actual-app/api` manages internal SQLite structures natively.
