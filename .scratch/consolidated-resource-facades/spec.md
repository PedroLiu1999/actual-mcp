Status: ready-for-agent

# Specification: Consolidated Deep Resource Facades for Agent Ergonomics

## Problem Statement

When an AI agent connects to Actual MCP, it is presented with a catalog of 39 separate tools. Twenty-four of these tools are shallow CRUD operations (such as individual creation, updating, and deletion tools for categories, category groups, payees, accounts, schedules, rules, and transactions). 

This tool fragmentation creates severe friction for the agent:
1. **Severe Context Window Bloat**: The declarations, parameter schemas, and descriptions for 39 tools are injected into the agent's context on every single conversation turn, consuming thousands of tokens and increasing latency and inference cost.
2. **Tool Selection Confusion**: Large sets of similar fine-grained tools confuse LLM tool selection priors, frequently leading to invalid tool calls or tool discovery failures.
3. **Multi-Turn Roundtrips**: All mutation tools strictly require internal database storage UUIDs. When a user asks an agent to perform natural operations (such as "Categorize Starbucks as Coffee" or "Create a Netflix category under Subscriptions"), the agent cannot execute the command directly. Instead, it must execute multiple sequential read queries (`list_accounts`, `list_categories`, `list_payees`), parse large JSON payloads to locate internal UUIDs, handle missing groups or payees with further intermediate tool calls, and only then submit the mutation.
4. **Single-Item Transaction Editing**: Transaction updates and deletions only accept a single transaction ID at a time, forcing agents into slow, sequential tool-calling loops when performing bulk categorizations or multi-transaction adjustments.

## Solution

Consolidate the 24 shallow write CRUD tools into five deep, high-leverage Resource Facades with discriminated action interfaces, in-process human-reference resolution, and standardized feedback envelopes:

1. `manage_categories`: Consolidates category and category group lifecycle (`create`, `update`, `delete`, `move`). Automatically creates missing category groups in-process when a category is created or moved with a new group name.
2. `manage_payees`: Consolidates payee lifecycle (`create`, `update`, `delete`, `merge`).
3. `manage_accounts`: Consolidates account lifecycle (`create`, `update`, `close`, `reopen`).
4. `manage_automations`: Consolidates schedules and rules lifecycle (`create`, `update`, `delete`, `preview_dates`) discriminated by target type (`schedule` or `rule`).
5. `manage_transactions`: Consolidates transaction lifecycle (`create`, `update`, `delete`) with batch creation (1–50 transactions), bulk updates (updating fields across multiple transaction IDs in one turn), and multi-transaction deletions.

All five facades accept either human-readable names or internal UUIDs, resolving them in-process against the local Budget Cache without extra network or tool roundtrips. When resolution fails, the facades return structured repair suggestions containing the closest matching names. The public tool catalog shrinks from 39 to 16 tools, reducing context load by over 60% while preserving every underlying capability.

## User Stories

1. As an AI agent, I want a concise public tool catalog of 16 tools instead of 39, so that my context window overhead is reduced by over 60% on every turn.
2. As an AI agent, I want unified Resource Facades with a clear `action` parameter, so that I can select the appropriate resource management tool without tool selection ambiguity.
3. As an AI agent, I want to create a new category by specifying its group name directly (e.g., `group: "Subscriptions"`), so that I do not need to query category groups first to find a group UUID.
4. As an AI agent, I want missing category groups to be automatically created when I create a category with a new group name, so that I do not get blocked by missing parent entity errors.
5. As an AI agent, I want to move an existing category to another group by name, so that reorganization requires a single tool call.
6. As an AI agent, I want to rename or toggle flags on a category or group using either its name or its UUID, so that I can fulfill user instructions naturally.
7. As an AI agent, I want to delete a category and specify a destination `transferTo` category by name or UUID, so that existing transactions are safely reassigned without orphaning data.
8. As an AI agent, I want to create, update, or merge payees using `manage_payees`, so that payee lifecycle operations are unified under one interface.
9. As an AI agent, I want to merge duplicate payees by supplying their names or UUIDs, so that payee reconciliation happens in a single atomic tool call.
10. As an AI agent, I want to create, update, close, or reopen accounts through `manage_accounts`, so that account lifecycle operations do not require separate tools.
11. As an AI agent, I want to close an account and specify a balance transfer destination account by name or UUID, so that closing non-zero accounts remains safe and atomic.
12. As an AI agent, I want to manage recurring commitments and automation rules through `manage_automations` using a `target` discriminator (`schedule` vs `rule`), so that automation logic is kept cohesive under one facade.
13. As an AI agent, I want to preview upcoming schedule dates using `manage_automations` with `action: 'preview_dates'`, so that I can report upcoming due dates to the user.
14. As an AI agent, I want to create or update transaction rules with Decimal Amounts and conditions through `manage_automations`, so that merchant auto-categorization can be automated.
15. As an AI agent, I want to create batches of 1 to 50 transactions using `manage_transactions` with `action: 'create'`, so that transaction imports remain fast and rule-enabled.
16. As an AI agent, I want to update transactions by specifying `category`, `payee`, or `account` as human-readable names, so that I do not have to perform prerequisite UUID lookups.
17. As an AI agent, I want auto-creation of payees when specifying a new payee name in transaction updates, so that new merchant transactions are categorized seamlessly.
18. As an AI agent, I want to apply field updates (such as setting a category or cleared status) across multiple transaction IDs in a single `manage_transactions` call, so that bulk edits avoid sequential round trips.
19. As an AI agent, I want to delete one or more transactions in a single `manage_transactions` call, so that transaction cleanup is efficient.
20. As an AI agent, I want all monetary fields in the Resource Facades to strictly use Decimal Amounts in standard major currency units, so that amounts remain intuitive and match the rest of the system.
21. As an AI agent, I want every Resource Facade call to return a standardized result envelope with a human-readable confirmation message and resolved UUIDs, so that I can immediately verify mutation success.
22. As an AI agent, I want entity resolution failures to return a list of closest matching names, so that I can self-correct misspelled user queries without failing the conversation.
23. As an AI agent, I want dedicated read tools (`list_accounts`, `list_categories`, `list_payees`) to remain available with `readOnlyHint: true`, so that read-only inspection remains lightweight and separate from mutations.
24. As an AI agent, I want analytical tools (`get_transactions`, `get_spending_summary`, `run_aql_query`) to remain top-level tools, so that complex financial querying retains its dedicated query filters and documentation.
25. As a budget owner, I want my agent to execute mutations with fewer round trips and lower latency, so that conversational interactions feel immediate and responsive.

## Implementation Decisions

- **Five Deep Resource Facades**:
  - `manage_categories`: Discriminated action interface supporting `create`, `update`, `delete`, and `move` across categories and category groups.
  - `manage_payees`: Discriminated action interface supporting `create`, `update`, `delete`, and `merge`.
  - `manage_accounts`: Discriminated action interface supporting `create`, `update`, `close`, and `reopen`.
  - `manage_automations`: Discriminated action interface supporting `create`, `update`, `delete`, and `preview_dates` across `schedule` and `rule` targets.
  - `manage_transactions`: Discriminated action interface supporting `create` (1–50 transactions), `update` (single or bulk transaction IDs with field updates), and `delete` (single or bulk transaction IDs).
- **Clean Tool Catalog Cutover**:
  - Cleanly retire the 24 shallow write CRUD tools from the public tool registration. Do not register legacy aliases on the MCP server, ensuring the agent context window captures the full ~65% token reduction.
- **In-Process Identifier Resolution**:
  - All facades accept either human-readable names or internal UUIDs for categories, category groups, payees, and accounts.
  - Resolution happens in-process against the local Budget Cache.
  - When creating or moving a category with a group name that does not exist in the Budget Cache, the group is automatically created in-process.
  - When updating a transaction with a payee name that does not exist, the payee is automatically created in-process.
- **Bulk Transaction Updating**:
  - The `update` action in `manage_transactions` accepts either a single transaction ID with field values, or a list of transaction IDs to apply the same field updates to simultaneously.
- **Standardized Response Envelope**:
  - Facades return a uniform envelope containing `success: boolean`, a human-readable `message` describing the mutation, the updated/created `data` (formatted with Decimal Amounts), and `resolved` mapping any supplied names to their resolved UUIDs.
  - When an entity name cannot be resolved and cannot be auto-created, the error returns an explicit rejection along with a `suggestions` array containing close matches.
- **Destructive Safety Annotations and Guards**:
  - Deletion of non-empty categories or accounts requires an explicit `transferTo` target (name or UUID).
  - Tools declare `destructiveHint: true` for deletion actions and `destructiveHint: false` otherwise.
- **Seam Placement on BudgetGateway**:
  - The five deep methods are placed directly on the `BudgetGateway` interface.
  - Multi-step orchestration, name resolution, and cache querying live inside the concrete budget gateway implementation behind the gateway seam.
  - MCP tool handlers in the server simply validate input Zod schemas, invoke the corresponding gateway facade method, and format the standardized envelope.

## Testing Decisions

- **External Behavior Verification**:
  - Tests verify only external behavior crossing the `BudgetGateway` interface seam and the MCP tool registration seam; they do not assert on internal private helper functions.
- **Gateway Seam Unit & Contract Tests**:
  - Test all five deep gateway methods directly with an in-memory test adapter.
  - Verify name-to-UUID resolution, case-insensitivity, and fallback behavior.
  - Verify auto-creation of missing category groups when creating a category with a new group name.
  - Verify auto-creation of payees during transaction updates.
  - Verify bulk transaction updates applying changes across multiple transaction records.
  - Verify safety guards: deleting categories/accounts with transactions without a transfer destination is rejected with actionable error messages.
  - Verify fuzzy match suggestions returned when an entity name is not found.
- **MCP Tool Registration & Catalog Tests**:
  - Verify the server exposes exactly the 16 active tools and none of the 24 retired shallow tools.
  - Verify input schema validation and error responses for invalid action parameters.
  - Verify standardized result envelope structure and MCP metadata annotations (`destructiveHint`, `readOnlyHint`).
- **Prior Art**:
  - Follow the existing mock adapter patterns in existing tool tests (`categoryTools.test.ts`, `payeeTools.test.ts`, `accountTools.test.ts`, `scheduleTools.test.ts`, `ruleTools.test.ts`, `writeTools.test.ts`).

## Out of Scope

- Introducing new third-party sync integrations or modifying `@actual-app/api` internal SQLite schemas.
- Modifying the embedded OAuth 2.1 authentication flow or client registration endpoints.
- Altering ActualQL query compilation or changing the structured AQL schema.
- Automatic fuzzy renaming of existing entities without explicit user direction.

## Further Notes

- This specification implements the decisions recorded in ADR-0010 and respects the domain terminology in `GLOSSARY.md`.
- Downstream implementation tickets will be split into dependency-ordered tracer-bullet tickets under `.scratch/consolidated-resource-facades/issues/`.
