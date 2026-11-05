# 03: Account Lifecycle Management Tools

**What to build:** The ability for an agent to create, update, close, and reopen financial accounts through MCP tools (`create_account`, `update_account`, `close_account`, `reopen_account`). Account creation validates standard account types and accepts an optional initial balance in Decimal Amount. Closing an account supports balance transfers to another account and category, and carries `destructiveHint: true`.

**Blocked by:** 01: Category and Category Group Management Tools

**Status:** ready-for-agent

- [ ] `create_account` accepts `name`, `type` (validated enum: `checking`, `savings`, `credit`, `investment`, `mortgage`, `debt`, `other`), optional `offbudget` boolean, and optional `initialBalance` as a Decimal Amount.
- [ ] Initial balance is converted accurately from Decimal Amount to Minor Unit Amount integers before dispatching to the engine.
- [ ] `update_account` allows updating `name`, `offbudget`, or `closed` flags on an account.
- [ ] `close_account` accepts `id`, optional `transferAccountId`, and optional `transferCategoryId`, annotated with `destructiveHint: true`.
- [ ] `reopen_account` accepts `id` and re-activates a previously closed account.
- [ ] All account lifecycle mutations trigger upstream Coalesced Sync and invalidate cached account listings.
- [ ] End-to-end HTTP integration tests pass exercising account creation, update, close, and reopen via JSON-RPC `tools/call`.
