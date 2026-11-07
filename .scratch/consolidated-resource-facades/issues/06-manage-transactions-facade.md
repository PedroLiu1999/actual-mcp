# 06: manage_transactions Deep Resource Facade

**What to build:** A unified `manage_transactions` tool and gateway method that consolidates transaction creation (1–50 batch items), multi-transaction editing, and transaction deletion behind a single discriminated action interface, accepting human-readable names for `category`, `payee`, and `account`, auto-creating missing payees, and using Decimal Amounts.

**Blocked by:** 01: In-Process Identifier Resolution & Standardized Response Envelope

**Status:** resolved

- [x] Exposes a `manage_transactions` tool on the MCP server with a discriminated `action` schema supporting `create`, `update`, and `delete`.
- [x] For `action: 'create'`, accepts 1 to 50 transaction items with Decimal Amounts, resolving `account`, `category`, and `payee` names in-process, supporting `runRules: true` (default).
- [x] For `action: 'update'`, accepts either a single transaction ID or an array of transaction IDs (`ids`) along with fields to update (`date`, `amount`, `category`, `payee`, `notes`, `cleared`).
- [x] Automatically resolves `category` and `payee` names to UUIDs in updates; auto-creates the payee if specified by name and not yet present.
- [x] For `action: 'delete'`, accepts either a single transaction ID or an array of transaction IDs (`ids`).
- [x] Returns the standardized result envelope with confirmation message, updated transaction data, and resolved UUIDs.
- [x] Declares `destructiveHint: true` on deletion actions.
- [x] Contract and unit tests verify batch creation, single update with name resolution, bulk recategorization across multiple IDs, and batch deletion across the gateway seam.
