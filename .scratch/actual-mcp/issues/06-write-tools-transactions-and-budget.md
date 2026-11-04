# 06: Write Tools — Transaction CRUD & set_budget_amount with Reversibility

**What to build:** Four mutating MCP tools (`create_transactions`, `update_transaction`, `delete_transaction`, and `set_budget_amount`) that accept Decimal Amounts, synchronize with the Sync Server before and after mutating, enforce batch limits, and return both previous and updated/deleted records so Gemini can verify or undo any change immediately.

**Blocked by:** 04: Core Read Tools — Transactions, Categories, Payees & Budget Months

**Status:** ready-for-agent

- [ ] `create_transactions` accepts `accountId`, `transactions` (1 to 50 items with `date`, `amount` in Decimal Amount, `payeeName` or `payeeId`, `categoryId`, `notes`, `cleared`, `importedId`), and `runRules` (default `true`). Rejects batches larger than 50 transactions via schema validation.
- [ ] When `runRules: true` (default), `create_transactions` uses `@actual-app/api`'s `importTransactions` so payee matching and Actual categorization rules run automatically; when `runRules: false`, it uses `addTransactions`.
- [ ] `update_transaction` looks up the target transaction by ID, applies the requested updates (converting `amount` from Decimal Amount to Minor Unit Amount when provided), updates the transaction, and returns `{ previous, updated }` in Decimal Amounts. Returns a clear error if the transaction ID does not exist.
- [ ] `delete_transaction` is annotated with `readOnlyHint: false` and `destructiveHint: true`, looks up the target transaction by ID prior to deletion, deletes it, and returns `{ deleted }` containing the full pre-deletion record in Decimal Amounts.
- [ ] `set_budget_amount` accepts `month` (`YYYY-MM`), `categoryId`, and at least one of `budgeted` (Decimal Amount) or `carryover` (boolean), captures the category's previous monthly state, applies `setBudgetAmount` and/or `setBudgetCarryover`, and returns `{ previous, updated }` in Decimal Amounts.
- [ ] Integration tests at the HTTP application seam and `BudgetGateway` seam verify batch limits, rule execution vs raw add, `{ previous, updated }` and `{ deleted }` payloads, and pre/post write sync calls.
