# 04: Core Read Tools — Transactions, Categories, Payees & Budget Months

**What to build:** Five end-to-end MCP read tools (`get_transactions`, `list_categories`, `list_payees`, `list_budget_months`, and `get_budget_month`) exposed over `POST /mcp` and implemented in `ActualBudgetGateway`, returning human-readable enriched records with all monetary values converted to Decimal Amounts.

**Blocked by:** 01: Walking Skeleton — Express App, Config, Healthcheck, Stateless MCP & list_accounts, 03: ActualBudgetGateway — Target Budget Cache, FIFO Mutex, Coalesced Sync & Shutdown

**Status:** ready-for-agent

- [ ] `get_transactions` supports filtering by `accountId`, `startDate` (`YYYY-MM-DD`), `endDate` (`YYYY-MM-DD`), `categoryId`, `payeeId`, case-insensitive `searchText` (matching payee name or notes), `limit` (default 100, max 500), and `forceSync`, and returns transactions with Decimal Amounts and resolved `accountName`, `categoryName`, and `payeeName` alongside their IDs.
- [ ] `list_categories` returns category groups and their categories (`id`, `name`, `group_id`, `is_income`, `hidden`).
- [ ] `list_payees` returns payees (`id`, `name`, `transfer_acct`).
- [ ] `list_budget_months` returns the sorted list of available `YYYY-MM` Budget Months.
- [ ] `get_budget_month` accepts a `month` (`YYYY-MM`) and returns the monthly envelope summary (`toBudget`, `totalIncome`, `totalBudgeted`, `totalSpent`, `totalBalance`, and per-category `budgeted`, `spent`, `balance`, `carryover`) with all currency fields converted to Decimal Amounts.
- [ ] All five tools carry `readOnlyHint: true` and `destructiveHint: false` annotations.
- [ ] Integration tests at the HTTP application seam and `BudgetGateway` seam verify filtering, name enrichment, and Decimal Amount conversion across all five tools.
