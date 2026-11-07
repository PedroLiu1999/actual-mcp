# 03: manage_payees Deep Resource Facade

**What to build:** A unified `manage_payees` tool and gateway method that consolidates payee creation, renaming, deletion, and merging behind a single discriminated action interface, accepting either names or UUIDs and executing atomic merges.

**Blocked by:** 01: In-Process Identifier Resolution & Standardized Response Envelope

**Status:** ready-for-agent

- [ ] Exposes a `manage_payees` tool on the MCP server with a discriminated `action` schema supporting `create`, `update`, `delete`, and `merge`.
- [ ] Resolves payee names to UUIDs in-process for single updates, deletions, and source/target merge lists.
- [ ] Supports atomic merging of multiple duplicate payees into a single target payee.
- [ ] Returns the standardized result envelope with confirmation message and resolved UUIDs.
- [ ] Declares `destructiveHint: true` on deletion and merge actions.
- [ ] Contract and unit tests verify creation, renaming, deletion, and multi-payee merging across the gateway seam.
