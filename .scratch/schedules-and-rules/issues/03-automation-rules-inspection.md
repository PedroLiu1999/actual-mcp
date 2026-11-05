# 03: Automation Rules Inspection

**What to build:** Expose `list_rules` end-to-end so conversational agents can inspect all transaction automation and categorization rules, with optional payee filtering (`payeeId`) and Decimal Amounts in rule conditions and actions.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `list_rules` returns all automation rules (triggers, stage, conditionsOp, conditions, actions)
- [x] Specifying `payeeId` filters rules using `@actual-app/api`'s payee rule indexer
- [x] Rule amounts in conditions (`field === 'amount'`) and actions (`set-split-amount` or `field === 'amount'`) are converted to Decimal Amounts
- [x] Tool declares `readOnlyHint: true` and `destructiveHint: false` annotations and supports `forceSync`
- [x] Automated HTTP/MCP integration tests verify querying all rules, filtering by payee, and amount format
