# 01: In-Process Identifier Resolution & Standardized Response Envelope

**What to build:** An in-process resolution mechanism and uniform response envelope helper so that callers can supply human-readable names for budget entities (categories, groups, payees, accounts) instead of database UUIDs, receive helpful fuzzy match suggestions when a name is not found, and get consistent structured confirmation responses across all mutations.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Resolves category and group names to internal UUIDs against the local Budget Cache case-insensitively.
- [x] Resolves payee and account names to internal UUIDs against the local Budget Cache case-insensitively.
- [x] Accepts UUIDs directly without unnecessary lookups when a UUID is already provided.
- [x] Returns structured fuzzy suggestions of closest matching entity names when a name resolution fails.
- [x] Formats a uniform result envelope containing `success: true`, a human-readable confirmation `message`, the mutated `data` payload with Decimal Amounts, and a `resolved` map of names to UUIDs.
- [x] Unit tests verify resolution, case insensitivity, direct UUID passthrough, fuzzy suggestions, and envelope formatting.
