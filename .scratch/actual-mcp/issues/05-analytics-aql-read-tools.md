# 05: Analytics Read Tools — get_spending_summary & run_aql_query

**What to build:** Two ActualQL-powered analytics read tools (`get_spending_summary` and `run_aql_query`) that let Gemini run accurate spending aggregations and safe custom queries over the Target Budget with automatic conversion of monetary columns to Decimal Amounts.

**Blocked by:** 01: Walking Skeleton — Express App, Config, Healthcheck, Stateless MCP & list_accounts, 03: ActualBudgetGateway — Target Budget Cache, FIFO Mutex, Coalesced Sync & Shutdown

**Status:** done

- [x] `get_spending_summary` aggregates transactions over a `startDate`..`endDate` window grouped by `'category' | 'payee' | 'month'`, using `splits: 'inline'` so split parent and child transactions are never double-counted.
- [x] `get_spending_summary` excludes internal account transfers (`payee.transfer_acct = null`) and off-budget accounts (`account.offbudget = false`) by default (with optional flags to include them) and returns totals in Decimal Amounts.
- [x] `run_aql_query` validates a Structured AQL Query JSON object via Zod (`table`: `'transactions' | 'accounts' | 'categories' | 'category_groups' | 'payees' | 'schedules' | 'rules'`, plus optional `filter`, `select`, `groupBy`, `orderBy`, `limit` default 100 max 1000, `offset`, and `splits` default `'inline'`) and compiles it safely to `@actual-app/api`'s `q(table)` builder and `aqlQuery()` without evaluating arbitrary code strings.
- [x] Monetary fields in `run_aql_query` results (such as `amount` and `$sum(amount)` aggregations on transactions) are converted from Minor Unit Amounts to Decimal Amounts.
- [x] Both tools carry `readOnlyHint: true` and `destructiveHint: false` annotations.
- [x] Tests at the HTTP application seam and `BudgetGateway` seam verify split inlining, transfer/off-budget exclusion, Structured AQL Query compilation, validation of disallowed tables/fields, and Decimal Amount conversion.
