# Extended MCP Tool Suite for Budget Lifecycle and Bank Sync

In `v0.2.0`, `actual-mcp` extends its MCP tool suite with 18 new tools (6 category/group, 4 payee, 5 account/sync, 3 budget flow) expanding the catalog to 30 tools (8 read, 22 write) across four operational tiers: Category & Category Group Management (`create_category`, `update_category`, `delete_category`, `create_category_group`, `update_category_group`, `delete_category_group`), Payee Management (`create_payee`, `update_payee`, `delete_payee`, `merge_payees`), Account Lifecycle & Bank Sync (`create_account`, `update_account`, `close_account`, `reopen_account`, `run_bank_sync`), and Budget Flow Adjustments (`set_budget_carryover`, `hold_budget_for_next_month`, `reset_budget_hold`). We deliberately deferred low-level rule engines (`create_rule`) and raw recurrence schedules (`create_schedule`) to future releases to protect Gemini context windows from deeply nested JSON schema bloat while prioritizing immediate user workflows.

## Consequences

- All new monetary fields at the tool boundary strictly accept **Decimal Amounts** (`z.number().finite()` in major currency units) and convert to/from **Minor Unit Amounts** (integers) only behind the gateway boundary.
- Destructive operations (`delete_category`, `delete_category_group`, `close_account`) carry `destructiveHint: true` MCP annotations and require explicit transfer target IDs (`transferCategoryId`, `transferAccountId`) when existing transactions or balances would otherwise become orphaned.
- All mutating tools operate within the single-budget mutex, trigger an immediate upstream `api.sync()` to the Sync Server, and invalidate in-memory metadata caches so subsequent reads reflect consistent state.
