# 0011: In-Process Entity Resolution Across Query and Budget Seams

## Status

Accepted (extends ADR-0010 to query and budget envelope boundaries).

## Context

ADR-0010 introduced deep Resource Facades with in-process entity resolution for mutation lifecycles. However, query tools and budget envelope mutators (`get_transactions`, `set_budget_amount`, `set_budget_carryover`, and `run_bank_sync`) still strictly mandated storage UUIDs (`accountId`, `categoryId`, `payeeId`). This forced conversational agents into multi-turn lookup loops merely to filter transactions by category name or set monthly envelope targets.

## Decision

We internalize entity identifier resolution behind the `BudgetGateway` seam for all query and budget operations:
1. `get_transactions` accepts natural filters (`account`, `category`, `payee`) resolving human names or UUIDs against the local Budget Cache, failing fast with fuzzy suggestions on invalid names, with `*Id` maintained as backward-compatible aliases.
2. `set_budget_amount` and `set_budget_carryover` accept `category` (or `categoryId`), resolving names in-process and returning `categoryName` alongside `categoryId` in result states.
3. `run_bank_sync` accepts `account` (or `accountId`), resolving account names or UUIDs in-process.
4. All resolutions execute inside `actualBudgetGateway.ts` using the existing coalesced sync policy against `BudgetCache` without introducing remote network roundtrips unless `forceSync: true` is explicitly requested.

## Consequences

- Agents can query and allocate budget envelopes in a single turn using natural human names.
- Typos in query filters fail fast with actionable suggestions rather than silently returning empty datasets.
- Programmatic and MCP tool callers share identical, deep resolution semantics across the gateway interface seam.
