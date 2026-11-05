# 01: Recurring Schedules Read and Forecasting

**What to build:** Expose `list_schedules` and `get_schedule_upcoming_dates` tools end-to-end so conversational agents can inspect recurring bills/income with Decimal Amounts and forecast future occurrence dates by schedule ID or recurrence rule.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `list_schedules` lists all schedules in the Target Budget with ID, name, next date, completed flag, posts transaction flag, payee ID, account ID, recurrence date, and Decimal Amount
- [x] `get_schedule_upcoming_dates` resolves upcoming occurrences for a given `scheduleId` or explicit recurrence rule across given start/end/count parameters
- [x] Schedule amounts are converted from internal Minor Unit integers to Decimal Amounts at the tool boundary
- [x] Both tools declare `readOnlyHint: true` and `destructiveHint: false` annotations and support `forceSync`
- [x] Automated HTTP/MCP integration tests verify successful querying, date expansion, and error handling
