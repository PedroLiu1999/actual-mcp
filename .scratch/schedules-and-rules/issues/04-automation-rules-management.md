# 04: Automation Rules Management

**What to build:** Expose `create_rule`, `update_rule`, and `delete_rule` tools end-to-end so conversational agents can create auto-categorization and transaction mutation rules, update existing rules, and delete rules.

**Blocked by:** 03: Automation Rules Inspection

**Status:** resolved

- [x] `create_rule` creates a rule with conditions and actions, converting any Decimal Amounts to internal Minor Units
- [x] `update_rule` updates conditions, actions, stage, or conditionsOp for an existing rule ID
- [x] `delete_rule` permanently removes a rule by ID and carries the `destructiveHint: true` annotation
- [x] All mutations execute within the single-budget FIFO mutex and trigger upstream sync
- [x] Automated HTTP/MCP integration tests verify creation, update, deletion, schema validation, and mutex serialization
