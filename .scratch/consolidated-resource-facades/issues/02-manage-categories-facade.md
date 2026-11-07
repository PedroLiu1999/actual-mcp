# 02: manage_categories Deep Resource Facade

**What to build:** A unified `manage_categories` tool and gateway method that consolidates category and category group lifecycle operations (`create`, `update`, `delete`, `move`) behind a single discriminated action interface, accepting either names or UUIDs, auto-creating missing parent groups, and preventing orphaned transactions on deletion.

**Blocked by:** 01: In-Process Identifier Resolution & Standardized Response Envelope

**Status:** resolved

- [x] Exposes a `manage_categories` tool on the MCP server with a discriminated `action` schema supporting `create`, `update`, `delete`, and `move`.
- [x] Accepts `target: 'category' | 'group'` (defaulting to `'category'`).
- [x] Resolves category and group names to internal UUIDs in-process.
- [x] Automatically creates missing parent category groups when creating or moving a category with a new group name.
- [x] Enforces safety invariants: deleting non-empty categories or groups requires a `transferTo` destination (name or UUID).
- [x] Returns the standardized result envelope with confirmation message and resolved UUIDs.
- [x] Declares `destructiveHint: true` on deletion actions.
- [x] Contract and unit tests verify creation, auto-group creation, renaming, moving, safe deletion, and error suggestions across the gateway seam.
