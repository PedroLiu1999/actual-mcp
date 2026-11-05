# 01: Category and Category Group Management Tools

**What to build:** The ability for an agent to create, update, and delete categories and category groups through MCP tools (`create_category`, `update_category`, `delete_category`, `create_category_group`, `update_category_group`, `delete_category_group`), enabling conversational envelope organization and reorganization. Deleting categories or category groups with existing transactions enforces a destination `transferCategoryId` safeguard and carries `destructiveHint: true` metadata. All mutations persist upstream to the Sync Server and invalidate cached category structures.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `create_category` accepts `name`, `groupId`, and optional `isIncome` and `hidden` flags, returning the created category ID.
- [ ] `update_category` allows updating `name`, `groupId`, `isIncome`, or `hidden` flags for an existing category.
- [ ] `delete_category` supports deleting a category, accepts an optional `transferCategoryId` to reassign historical transactions, and is annotated with `destructiveHint: true`.
- [ ] `create_category_group` accepts `name` and optional `isIncome` and `hidden` flags, returning the created category group ID.
- [ ] `update_category_group` allows updating `name`, `isIncome`, or `hidden` flags for an existing category group.
- [ ] `delete_category_group` supports deleting a category group with an optional `transferCategoryId` and carries `destructiveHint: true`.
- [ ] Mutations trigger immediate Coalesced Sync upstream and invalidate the in-memory categories cache.
- [ ] End-to-end HTTP integration tests pass exercising each tool via JSON-RPC `tools/call`.
