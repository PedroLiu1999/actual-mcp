# 0010: Consolidated Deep Resource Facades for Agent Ergonomics

## Status

Accepted (supersedes the fine-grained tool catalogs in ADR-0004 and ADR-0005).

## Context

In `v0.2.0` (ADR-0004) and `v0.3.0` (ADR-0005), `actual-mcp` expanded its catalog to 39 MCP tools to expose category, payee, account, bank sync, budget flow, schedule, and rule operations. While functionally complete, exposing 39 shallow CRUD tools incurs severe penalties for conversational LLM agents:
1. **Context Load**: Tool declarations bloat the agent's context window by thousands of tokens on every single turn.
2. **Tool Selection Ambiguity**: Large sets of fine-grained CRUD tools confuse agent reasoning priors and trigger invalid tool choices.
3. **Multi-Turn Roundtrips**: Requiring storage UUIDs across all mutations forces agents into multi-step read-then-write loops.

## Decision

We retire 24 shallow write CRUD tools from the public MCP catalog and consolidate entity lifecycle operations into five deep **Resource Facades** with in-process human-reference resolution:
1. `manage_categories`: Handles category and category group lifecycle (create, update, delete) with automatic group creation on category create/move.
2. `manage_payees`: Handles payee lifecycle (create, update, delete, merge).
3. `manage_accounts`: Handles account lifecycle (create, update, close, reopen).
4. `manage_automations`: Handles schedules and rules lifecycle (create, update, delete, preview dates) discriminated by `target: 'schedule' | 'rule'`.
5. `manage_transactions`: Handles transaction lifecycle (create batches of 1–50, update single or multiple transactions with bulk field assignments, delete single or multiple transactions) with in-process resolution of `category`, `payee`, and `account` names and Decimal Amounts.

Dedicated analytical and inspection tools (`list_accounts`, `list_categories`, `list_payees`, `get_transactions`, `get_spending_summary`, `run_aql_query`) remain top-level read tools.

All five facades accept either human-readable names or UUIDs, resolve them in-process against the Budget Cache, and return a standardized result envelope with human-readable confirmation summaries and fuzzy suggestion hints on not-found errors.

## Consequences

- Public MCP tool count decreases from 39 to 20 tools, cutting caller context overhead significantly.
- Transaction categorization and multi-item edits execute in a single roundtrip without prerequisite ID lookup queries.
- Tests and callers exercise deep operations directly across the `BudgetGateway` interface seam.
- Destructive actions (`delete`, `close`) require `transferTo` targets (accepting names or UUIDs) when non-empty, preventing orphaned budget entities.
