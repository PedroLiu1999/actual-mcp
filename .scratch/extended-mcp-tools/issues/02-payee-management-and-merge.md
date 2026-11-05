# 02: Payee Management and Merge Tools

**What to build:** The ability for an agent to create, rename, delete, and merge payees through MCP tools (`create_payee`, `update_payee`, `delete_payee`, `merge_payees`). Users and conversational agents can curate payees to clean up duplicate merchant entries resulting from manual entry or bank imports, merging multiple duplicate payees into a single canonical payee record and updating historical transactions automatically.

**Blocked by:** 01: Category and Category Group Management Tools

**Status:** ready-for-agent

- [ ] `create_payee` accepts a `name` string and returns the created payee record with its generated ID.
- [ ] `update_payee` accepts `id` and a replacement `name`, updating the merchant title.
- [ ] `delete_payee` accepts `id` and deletes the payee, annotated with `destructiveHint: true`.
- [ ] `merge_payees` accepts `targetPayeeId` and a non-empty array of `sourcePayeeIds`, consolidating all transactions and rules under the target payee and removing source records.
- [ ] All payee mutations trigger an upstream Coalesced Sync and invalidate the cached payees list.
- [ ] End-to-end HTTP integration tests pass exercising payee creation, updating, deletion, and merging via JSON-RPC `tools/call`.
