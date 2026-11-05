# 05: Minor Version Bump, ADR, and Documentation

**What to build:** Finalize the minor version release to `v0.3.0` across package manifests, ADRs, glossary domain definitions, tool catalog documentation, and verify the full regression test suite.

**Blocked by:** 02: Recurring Schedules Management, 04: Automation Rules Management

**Status:** resolved

- [x] Version bumped to `0.3.0` in `package.json` and MCP server info in `src/mcp/server.ts`
- [x] ADR-0005 recorded in `docs/adr/0005-schedules-and-rules-mcp-tools.md`
- [x] `GLOSSARY.md` updated with Schedule and Rule domain concepts
- [x] `README.md` updated with the 9 new tools (39 tools total: 10 read, 29 write)
- [x] Full test suite passes cleanly with high coverage
