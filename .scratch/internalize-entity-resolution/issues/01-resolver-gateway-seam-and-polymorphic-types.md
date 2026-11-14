# 01: Entity Resolver Gateway Seam Prefactoring & Polymorphic Types

**What to build:** The gateway types and resolution helpers accept polymorphic entity references (`account`, `category`, `payee`) alongside legacy `*Id` identifiers, supporting fail-fast resolution with fuzzy suggestions for query and budget envelope operations.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Gateway input types (`GetTransactionsFilter`, `SetBudgetAmountInput`, `SetBudgetCarryoverInput`, `RunBankSyncInput`) define primary human-friendly parameter names (`account`, `category`, `payee`) accepting names or UUIDs, while retaining `*Id` as backward-compatible aliases.
- [x] Gateway response types for budget envelope mutations (`SetBudgetAmountResult`, `SetBudgetCarryoverResult`) include `categoryName` on both `previous` and `updated` envelope states.
- [x] In-process resolution helpers support resolving single entities with fail-fast `EntityResolutionError` and fuzzy suggestions for non-existent names without remote sync roundtrips.
- [x] Unit tests verify that name and UUID resolution behaves deterministically, case-insensitively, and surfaces helpful suggestions on typos.
