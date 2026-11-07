# 04: In-Process Resolution for run_bank_sync Account Synchronization

**What to build:** End-to-end support for triggering bank synchronization by account name or UUID, resolving the account in-process while maintaining global sync when omitted and backward compatibility for `accountId`.

**Blocked by:** 01: Entity Resolver Gateway Seam Prefactoring & Polymorphic Types

**Status:** ready-for-agent

- [ ] `run_bank_sync` MCP tool schema accepts `account` as an optional input (accepting account name or UUID), retaining `accountId` as an alias.
- [ ] Gateway resolves account name in-process against the local Budget Cache before triggering bank synchronization.
- [ ] Omitting `account` and `accountId` continues to trigger synchronization across all linked accounts.
- [ ] Misspelled or non-existent account names fail fast with `EntityResolutionError` and fuzzy suggestions.
- [ ] End-to-end MCP tool tests verify running bank sync by account name and by account UUID.
