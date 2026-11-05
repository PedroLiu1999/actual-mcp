# 04: Bank Synchronization Tool

**What to build:** The ability for an agent to trigger bank synchronization on demand through the MCP tool `run_bank_sync`. The tool can synchronize a single designated account by ID or sync all linked bank accounts simultaneously when no account ID is provided. The tool returns a structured reconciliation report detailing updated account IDs, counts of newly imported transactions, matched reconciled transactions, and any provider errors encountered.

**Blocked by:** 03: Account Lifecycle Management Tools

**Status:** resolved

- [x] `run_bank_sync` accepts an optional `accountId` parameter.
- [x] When `accountId` is omitted, bank sync runs across all linked accounts; when supplied, only the specified account is synced.
- [x] Returns a structured JSON summary reporting `updatedAccountIds`, `newTransactionsCount`, `matchedTransactionsCount`, and any `errors`.
- [x] Mutex locking is maintained during sync and in-memory caches are refreshed/invalidated after sync completion.
- [x] End-to-end HTTP integration tests pass exercising `run_bank_sync` for single and all accounts via JSON-RPC `tools/call`.
