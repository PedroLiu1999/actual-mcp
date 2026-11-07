# 04: manage_accounts Deep Resource Facade

**What to build:** A unified `manage_accounts` tool and gateway method that consolidates account creation, renaming, off-budget toggling, closing, and reopening behind a single discriminated action interface, accepting either names or UUIDs and safely transferring balances on closure.

**Blocked by:** 01: In-Process Identifier Resolution & Standardized Response Envelope

**Status:** resolved

- [x] Exposes a `manage_accounts` tool on the MCP server with a discriminated `action` schema supporting `create`, `update`, `close`, and `reopen`.
- [x] Accepts initial balance as a Decimal Amount during account creation.
- [x] Resolves account names to UUIDs in-process for update, close, and reopen operations.
- [x] Enforces safety invariants: closing an account with a non-zero balance requires a `transferTo` destination account (name or UUID).
- [x] Returns the standardized result envelope with confirmation message and resolved UUIDs.
- [x] Declares `destructiveHint: true` on account closure.
- [x] Contract and unit tests verify creation, renaming, closing with balance transfer, and reopening across the gateway seam.
