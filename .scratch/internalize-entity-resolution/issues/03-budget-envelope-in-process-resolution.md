# 03: In-Process Resolution for Budget Envelopes (set_budget_amount & set_budget_carryover)

**What to build:** End-to-end support for setting monthly category envelope amounts and carryover flags using category names or UUIDs, returning enriched responses containing `categoryName` alongside `categoryId`.

**Blocked by:** 01: Entity Resolver Gateway Seam Prefactoring & Polymorphic Types

**Status:** resolved

- [x] `set_budget_amount` and `set_budget_carryover` MCP tool schemas accept `category` as primary input (accepting category name or UUID), retaining `categoryId` as a backward-compatible alias.
- [x] Gateway resolves category name in-process against the local Budget Cache before applying monthly budget updates.
- [x] Both tools return `categoryName` on `previous` and `updated` envelope state objects in their response payloads.
- [x] Misspelled or non-existent category names fail fast with `EntityResolutionError` and fuzzy suggestions.
- [x] End-to-end MCP tool tests verify setting envelope budgeted amount and carryover by category name and by category UUID.
