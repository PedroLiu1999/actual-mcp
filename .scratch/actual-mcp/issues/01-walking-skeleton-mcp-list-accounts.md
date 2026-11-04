# 01: Walking Skeleton — Express App, Config, Healthcheck, Stateless MCP & list_accounts

**What to build:** An end-to-end runnable TypeScript HTTP server that validates startup configuration from environment variables, responds to healthcheck probes at `GET /healthz`, and serves a stateless MCP Streamable HTTP endpoint at `POST /mcp` (returning `405 Method Not Allowed` on `GET /mcp` and `DELETE /mcp`) with the first working read tool (`list_accounts`) returning accounts and their current balances in Decimal Amounts via the `BudgetGateway` seam.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Startup configuration validates required environment variables (`PUBLIC_URL`, `PORT`, `DATA_DIR`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_ADMIN_PASSWORD`, `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID`, and optional `ACTUAL_ENCRYPTION_PASSWORD`, `SYNC_TTL_SECONDS`) and fails fast with a descriptive error when invalid.
- [x] Express application enables reverse proxy trust (`trust proxy: 1`) and validates the incoming `Host` header against the configured `PUBLIC_URL` hostname plus `localhost` and `127.0.0.1`.
- [x] `GET /healthz` returns HTTP `200` with JSON status and Target Budget readiness information without requiring authentication.
- [x] Currency conversion helpers accurately convert between Decimal Amounts (`-12.34`) at the MCP boundary and Minor Unit Amounts (`-1234`) internally without floating-point rounding drift.
- [x] `POST /mcp` handles MCP JSON-RPC requests (`initialize`, `tools/list`, `tools/call`) using a stateless Streamable HTTP transport (`sessionIdGenerator: undefined, enableJsonResponse: true`), while `GET /mcp` and `DELETE /mcp` return HTTP `405 Method Not Allowed`.
- [x] `list_accounts` is registered with `readOnlyHint: true` and `destructiveHint: false`, and returns all accounts with `id`, `name`, `offbudget`, `closed`, and `balance` (as a Decimal Amount) when invoked through `POST /mcp`.
- [x] Integration tests at the HTTP application seam verify `GET /healthz`, `GET/DELETE /mcp` (`405`), `tools/list`, and `tools/call` for `list_accounts`.
