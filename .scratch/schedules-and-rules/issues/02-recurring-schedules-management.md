# 02: Recurring Schedules Management

**What to build:** Expose `create_schedule`, `update_schedule`, and `delete_schedule` tools end-to-end so conversational agents can create recurring commitments, update interval/amount/payee/account details, and delete obsolete schedules.

**Blocked by:** 01: Recurring Schedules Read and Forecasting

**Status:** resolved

- [x] `create_schedule` creates a recurring schedule accepting Decimal Amounts and recurrence configuration, converting amounts to internal Minor Units
- [x] `update_schedule` updates schedule properties (name, amount as Decimal Amount, amountOp, payee, account, date, posts_transaction, resetNextDate)
- [x] `delete_schedule` removes a schedule by ID and carries the `destructiveHint: true` annotation
- [x] All mutations execute within the single-budget FIFO mutex and trigger upstream sync
- [x] Automated HTTP/MCP integration tests verify creation, update, deletion, schema validation, and mutex serialization
