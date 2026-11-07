# 07: Retire Shallow CRUD Tools & Verify 20-Tool Catalog

**What to build:** The contraction step that cleanly unregisters the 24 retired shallow write CRUD tools from the public MCP catalog, updates MCP server tests to assert that exactly 20 tools are exposed, and updates documentation.

**Blocked by:** 02: manage_categories Deep Resource Facade, 03: manage_payees Deep Resource Facade, 04: manage_accounts Deep Resource Facade, 05: manage_automations Deep Resource Facade, 06: manage_transactions Deep Resource Facade

**Status:** resolved

- [x] Cleanly unregisters the 24 retired shallow tools from `McpServer` (`create_category`, `update_category`, `delete_category`, `create_category_group`, `update_category_group`, `delete_category_group`, `create_payee`, `update_payee`, `delete_payee`, `merge_payees`, `create_account`, `update_account`, `close_account`, `reopen_account`, `create_schedule`, `update_schedule`, `delete_schedule`, `get_schedule_upcoming_dates`, `create_rule`, `update_rule`, `delete_rule`, `create_transactions`, `update_transaction`, `delete_transaction`).
- [x] Confirms the server exposes exactly the 20 active tools (5 deep Resource Facades + 15 read, analytical, and budget flow tools).
- [x] Updates MCP catalog tests to assert the exact 20-tool list and verify absence of all retired tool names.
- [x] Updates `README.md` and tool documentation to reflect the consolidated Resource Facades.
- [x] Runs full test suite (`npm test`) and packaging checks to ensure zero regressions across all 15+ test suites.
