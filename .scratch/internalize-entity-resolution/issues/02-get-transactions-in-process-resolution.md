# 02: In-Process Resolution for get_transactions Query Filters

**What to build:** End-to-end support for filtering transactions using natural names (`account`, `category`, `payee`) or UUIDs in a single tool call, resolving against the local Budget Cache in-process with fail-fast fuzzy suggestions on misspelled names.

**Blocked by:** 01: Entity Resolver Gateway Seam Prefactoring & Polymorphic Types

**Status:** ready-for-agent

- [ ] `get_transactions` MCP tool schema defines `account`, `category`, and `payee` as primary filter inputs, preserving `accountId`, `categoryId`, and `payeeId` as backward-compatible aliases.
- [ ] Gateway resolves `account`, `category`, and `payee` against the local Budget Cache before querying transactions.
- [ ] Invalid or misspelled entity names trigger an `EntityResolutionError` formatted with fuzzy suggestions, preventing silent empty-result responses.
- [ ] Passing raw storage UUIDs continues to work without regression.
- [ ] End-to-end MCP tool tests verify that filtering by category name, account name, payee name, and their legacy ID aliases returns the expected enriched transaction records.
