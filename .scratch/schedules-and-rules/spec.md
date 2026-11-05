# Spec: Schedules and Rules MCP Tool Suite

Status: resolved

## Problem Statement

In `actual-mcp` v0.2.x, users and AI agents can manage core budget entities (accounts, categories, payees, transactions, budget envelope allocations, and spending aggregations). However, recurring commitments (such as monthly subscriptions, rent, utility schedules, paychecks) and automated transaction rules (such as auto-categorization by merchant or note prefixing) cannot be inspected, created, modified, or deleted through conversational MCP tools. When budgeting conversationally, users frequently ask questions like "What recurring bills or subscriptions do I have next month?", "When is my next paycheck?", or "Automatically categorize any Starbucks charge as Coffee". Without schedules and rules exposed as first-class MCP tools, conversational agents cannot answer recurring forecast questions or set up categorization workflows.

## Solution

Extend `actual-mcp` to minor version `v0.3.0` with first-class **Schedules** and **Rules** MCP tools:
1. **Schedules Suite**:
   - `list_schedules`: List all recurring schedules with Decimal Amounts, interval rules, next dates, account, payee, and status.
   - `get_schedule_upcoming_dates`: Calculate upcoming occurrences/due dates for a schedule ID or date recurrence config.
   - `create_schedule`: Create a recurring schedule with Decimal Amounts, recurrence configuration, and linked payee/account.
   - `update_schedule`: Modify schedule parameters (amount, interval, name, payee, account, posts_transaction, resetNextDate).
   - `delete_schedule`: Delete a recurring schedule by ID (`destructiveHint: true`).
2. **Rules Suite**:
   - `list_rules`: List all configured automation rules (triggers, conditions, actions), with optional `payeeId` filter.
   - `create_rule`: Create a categorization or transaction mutation rule.
   - `update_rule`: Update conditions or actions of an existing rule.
   - `delete_rule`: Delete an automation rule by ID (`destructiveHint: true`).

All monetary fields across both suites strictly accept and return **Decimal Amounts** (`-50.00` for a $50 expense) at the tool boundary, converting to/from internal Minor Unit integer amounts (`-5000`) behind the gateway boundary. All mutations operate within the single-budget FIFO mutex and Coalesced Sync policy.

## User Stories

1. As a budgeting user, I want to list all recurring schedules so that I can audit subscriptions, utilities, and scheduled payments.
2. As a budgeting user, I want to calculate upcoming dates for a schedule so that I can forecast cash flow for the upcoming weeks or months.
3. As a budgeting user, I want to create a recurring schedule with a Decimal Amount so that upcoming bills are tracked automatically.
4. As a budgeting user, I want to update schedule details (amount, payee, frequency, name) so that changes in bill amounts or service providers stay up to date.
5. As a budgeting user, I want to delete obsolete schedules so that inactive bills no longer trigger reminders.
6. As a budgeting user, I want to list all automation rules so that I understand how transactions are categorized and processed.
7. As a budgeting user, I want to list rules filtered by a specific payee so that I can see the exact categorization rules applied to that payee.
8. As a budgeting user, I want to create an auto-categorization rule so that incoming transactions are automatically categorized based on payee or note patterns.
9. As a budgeting user, I want to update rule conditions or actions so that my automation logic adapts to changing financial structures.
10. As a budgeting user, I want to delete a rule by ID so that outdated automations are cleanly removed.
11. As an LLM agent, I want destructive operations (`delete_schedule`, `delete_rule`) to carry `destructiveHint: true` MCP annotations so that I can request confirmation before permanently removing items.

## Implementation Decisions

- **Decimal Amount Boundary**: All schedule amounts and rule amount conditions/actions use Decimal Amounts in standard major units. Conversion between Decimal Amounts and integer Minor Unit Amounts occurs inside the gateway layer.
- **Schedule Upcoming Dates Seam**: `get_schedule_upcoming_dates` accepts either `scheduleId` (resolving its date configuration automatically) or an explicit `date` object/string, along with optional `start`, `end`, and `count` parameters (defaulting `count` to 10).
- **Rule Structure & Validation**: Rule operations support standard Actual rule structures (`stage`: `'pre' | 'post' | 'default'`, `conditionsOp`: `'and' | 'or'`, `conditions`: array, `actions`: array). `update_rule` requires the full condition and action sets required by `@actual-app/api` validation.
- **Concurrency & Sync**: In accordance with ADR 0002 and ADR 0004, all read operations support `forceSync` with TTL caching, and all mutation operations execute inside the gateway mutex and trigger immediate upstream sync.
- **Version Bump**: Bump package version, server info version, and documentation to `0.3.0`.
