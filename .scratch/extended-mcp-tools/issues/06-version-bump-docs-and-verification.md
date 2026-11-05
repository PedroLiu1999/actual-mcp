# 06: Version Bump, Documentation, and Final Verification

**What to build:** Release packaging and documentation updates for `v0.2.0`. Bump the package version and MCP server info version to `0.2.0`, update README and documentation to catalog all 26 available tools with descriptions and examples, and verify the entire test suite, TypeScript compilation, and build pass cleanly.

**Blocked by:** 01: Category and Category Group Management Tools, 02: Payee Management and Merge Tools, 03: Account Lifecycle Management Tools, 04: Bank Synchronization Tool, 05: Budget Flow Adjustment Tools

**Status:** ready-for-agent

- [ ] `package.json` version bumped to `0.2.0`.
- [ ] `src/mcp/server.ts` server info version set to `0.2.0`.
- [ ] `README.md` updated to document the 14 new tools across Categories, Payees, Accounts, Bank Sync, and Budget Adjustments.
- [ ] Full regression test suite (`npm test`) passes with 100% green tests.
- [ ] TypeScript typecheck (`npm run typecheck`) and build (`npm run build`) complete without errors.
