# ADR 0005: Schedules and Rules MCP Tools Suite

## Context

In `v0.2.0`, `actual-mcp` extended its tool catalog to 30 tools covering categories, payees, accounts, bank sync, and budget flow adjustments. We previously deferred recurrence schedules (`create_schedule`) and automated categorization rules (`create_rule`) in ADR 0004 to prioritize immediate budget lifecycle maintenance and avoid nested schema complexity.

However, conversational budget management frequently involves subscriptions, scheduled utility bills, recurring salary deposits, and merchant auto-categorization. In `v0.3.0`, we introduce 9 new tools across two functional domains:
1. **Recurring Schedules Suite (5 tools)**:
   - `list_schedules` (read-only): Inspect recurring commitments with Decimal Amounts and occurrence rules.
   - `get_schedule_upcoming_dates` (read-only): Calculate upcoming occurrence dates for a schedule ID or recurrence rule.
   - `create_schedule` (write): Create recurring schedules with Decimal Amounts, interval rules, and linked payee/account.
   - `update_schedule` (write): Modify schedule parameters and optionally recalculate next dates.
   - `delete_schedule` (write, `destructiveHint: true`): Permanently delete a recurring schedule.
2. **Automation Rules Suite (4 tools)**:
   - `list_rules` (read-only): Inspect all rules or filter by payee ID (`payeeId`).
   - `create_rule` (write): Create auto-categorization or field-setting rules.
   - `update_rule` (write): Update conditions, actions, or execution stages for an existing rule.
   - `delete_rule` (write, `destructiveHint: true`): Permanently delete an automation rule.

## Consequences

- **Decimal Amount Boundary**: In keeping with the architectural principle in ADR 0002 and ADR 0004, all schedule amounts (single amounts and `{ num1, num2 }` between ranges) and rule amount conditions/actions are represented as standard major currency units (**Decimal Amounts**) at the tool boundary. Conversion to and from internal integer **Minor Unit Amounts** occurs strictly behind the gateway boundary.
- **Convenient Upcoming Date Resolution**: `get_schedule_upcoming_dates` accepts either an existing `scheduleId` (resolving its date pattern from the cache) or an explicit recurrence configuration, defaulting to 10 occurrences when unbounded.
- **Destructive Deletion Hints**: `delete_schedule` and `delete_rule` declare `destructiveHint: true` MCP metadata annotations to alert conversational clients of irreversible state mutations.
- **Concurrency & Sync**: All 9 tools operate within the single-budget FIFO mutex and Coalesced Sync policy, with read tools supporting `forceSync` and write tools syncing before and after mutation.
