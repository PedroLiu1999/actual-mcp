# 05: manage_automations Deep Resource Facade

**What to build:** A unified `manage_automations` tool and gateway method that consolidates recurring schedules and categorization rules behind a single discriminated interface with `target: 'schedule' | 'rule'`, supporting `create`, `update`, `delete`, and `preview_dates` with Decimal Amounts.

**Blocked by:** 01: In-Process Identifier Resolution & Standardized Response Envelope

**Status:** ready-for-agent

- [ ] Exposes a `manage_automations` tool on the MCP server with a discriminated `target: 'schedule' | 'rule'` and `action: 'create' | 'update' | 'delete' | 'preview_dates'`.
- [ ] For `target: 'schedule'`, supports interval recurrence configurations, next occurrence dates, linked account/payee by name or UUID, and Decimal Amounts.
- [ ] For `target: 'schedule'` with `action: 'preview_dates'`, calculates upcoming occurrence dates for an existing schedule or an explicit recurrence configuration.
- [ ] For `target: 'rule'`, supports transaction pipeline stages (`pre`, `post`, `default`), condition sets, and action sets with Decimal Amounts.
- [ ] Resolves linked payee and account names in schedules and rule conditions/actions to UUIDs in-process.
- [ ] Returns the standardized result envelope with confirmation message and resolved UUIDs.
- [ ] Declares `destructiveHint: true` on deletion actions.
- [ ] Contract and unit tests verify schedule creation/updating/preview and rule creation/updating across the gateway seam.
