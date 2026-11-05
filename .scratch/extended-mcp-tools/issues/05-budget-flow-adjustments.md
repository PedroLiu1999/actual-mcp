# 05: Budget Flow Adjustment Tools

**What to build:** The ability for an agent to adjust envelope rollover behavior and monthly reserve allocations through MCP tools (`set_budget_carryover`, `hold_budget_for_next_month`, `reset_budget_hold`). Users can instruct the conversational agent to carry over overspent category balances into the next month or hold reserve buffers from the current month's available funds for next month.

**Blocked by:** 01: Category and Category Group Management Tools

**Status:** resolved

- [x] `set_budget_carryover` accepts `month` in `YYYY-MM` format, `categoryId`, and `carryover` boolean flag, toggling overspending rollover.
- [x] `hold_budget_for_next_month` accepts `month` in `YYYY-MM` format and `amount` as a Decimal Amount, converting to Minor Units and reserving funds for the following month.
- [x] `reset_budget_hold` accepts `month` in `YYYY-MM` format, releasing any held reserve funds back to available budget.
- [x] Mutations trigger immediate Coalesced Sync upstream.
- [x] End-to-end HTTP integration tests pass exercising carryover and hold modifications via JSON-RPC `tools/call`.
