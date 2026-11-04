# Actual MCP Server Specification

**Status:** resolved

## Problem Statement

A self-hosted Actual Budget user wants to query and manage their personal finances directly from Google Gemini using Gemini's custom MCP connector ("Connect to an MCP server"). However:

1. Actual Budget's self-hosted Sync Server (`@actual-app/sync-server`) does not provide a REST API for querying or modifying budget data; it only exchanges encrypted sync envelopes and requires the `@actual-app/api` (`loot-core`) Node.js engine with a local SQLite Budget Cache.
2. Google Gemini's custom MCP connector requires a public HTTPS MCP Streamable HTTP endpoint protected by a full OAuth 2.0 / 2.1 Authorization Code + PKCE flow (`Client ID` and `Client Secret`, RFC 9728 Protected Resource Metadata, RFC 8414 Authorization Server Metadata, Google-specific dynamic redirect URIs, and persistent non-rotating refresh tokens).
3. Operating an external identity provider (such as Keycloak or Auth0) alongside a single-user self-hosted budget instance adds unnecessary operational overhead on a personal VPS.
4. `@actual-app/api` uses module-level singletons and integer Minor Unit Amounts (`-1234` for `-$12.34`), which can cause race conditions under concurrent HTTP requests and unit-scale hallucinations when exposed raw to an LLM.

## Solution

Build `actual-mcp`, a self-contained Node.js 22 TypeScript MCP server packaged as a standalone Docker container designed to sit behind an existing Cloudflare Tunnel and connect to an existing self-hosted Actual Budget Sync Server.

`actual-mcp` embeds:
- A single-tenant **Embedded OAuth Server** (`@modelcontextprotocol/sdk` auth router + compatibility shims for Google Gemini redirect URIs, Basic/POST client authentication, passphrase-protected HTML consent screen, and a persistent file-backed **Token Store** with non-rotating refresh tokens).
- A stateless **Streamable HTTP** MCP endpoint (`POST /mcp`) exposing a cohesive 12-tool surface (8 read tools and 4 write tools) with MCP tool annotations (`readOnlyHint`, `destructiveHint`).
- Automatic conversion between human-readable **Decimal Amounts** (`-12.34`) at the MCP boundary and integer **Minor Unit Amounts** (`-1234`) internally.
- A process-wide FIFO mutex and **Coalesced Sync** lifecycle managing a single **Target Budget** (`Sync ID`) cached in a persistent local **Budget Cache**.

## User Stories

1. As a budget owner connecting Gemini, I want the server to expose OAuth 2.0 Protected Resource Metadata at both root and path-suffixed `.well-known` endpoints, so that Gemini discovers the Embedded OAuth Server automatically when given my MCP server URL.
2. As a budget owner connecting Gemini, I want the server to expose OAuth 2.0 Authorization Server Metadata at `/.well-known/oauth-authorization-server`, so that Gemini discovers the `/authorize`, `/token`, and `/revoke` endpoints and supported PKCE methods.
3. As a budget owner connecting Gemini, I want unauthenticated requests to `/mcp` to return HTTP `401 Unauthorized` with a `WWW-Authenticate` header pointing to the Protected Resource Metadata URL, so that Gemini initiates the OAuth linking flow per the MCP specification.
4. As a budget owner linking my account in Gemini, I want `/authorize` to accept Google's dynamic redirect URIs (`https://oauth-redirect*.googleusercontent.com/(r|a)/*` and `https://vertexaisearch.cloud.google.com/oauth-redirect`), so that the authorization redirect succeeds without manually registering project-specific callback URLs.
5. As a budget owner linking my account in Gemini, I want `GET /authorize` to render a clean, self-contained HTML consent page prompting for my admin passphrase, so that only I can approve an OAuth grant against my budget.
6. As a budget owner, I want `POST /authorize` to be rate-limited by client IP, so that brute-force attempts against my admin passphrase over the public Cloudflare Tunnel are throttled.
7. As a budget owner, I want `POST /token` to accept client credentials via both HTTP Basic authentication (`client_secret_basic`) and form body parameters (`client_secret_post`), so that Google's token exchange succeeds regardless of which client authentication method it sends.
8. As a budget owner, I want `POST /token` with `grant_type=refresh_token` to issue a fresh access token while preserving the existing refresh token and extending its sliding expiration, so that my Gemini custom connector stays permanently linked without dropping after token refresh.
9. As a budget owner running Docker on a VPS, I want issued access tokens and refresh tokens persisted in a local Token Store on the container's data volume, so that restarting or redeploying the container does not invalidate my Gemini connection.
10. As a budget owner running behind Cloudflare Tunnel, I want the Express server to trust the reverse proxy and allow my configured public hostname, so that generated `.well-known` metadata URLs use `https://` and requests are not rejected by localhost DNS rebinding checks.
11. As a VPS operator, I want an unauthenticated `GET /healthz` endpoint that reports server readiness and Target Budget sync status, so that Docker healthchecks and uptime monitors can verify the container is healthy.
12. As a budget owner, I want `actual-mcp` to open my Target Budget by its Sync ID using `downloadBudget()` against a persistent Budget Cache directory on startup (including optional end-to-end encryption password support), so that subsequent startups reuse the local SQLite cache and only delta-sync.
13. As a budget owner who also edits budgets in the Actual web and mobile apps, I want read tool calls to perform a Coalesced Sync when the last sync is older than a configurable TTL (default 30 seconds), so that Gemini sees recent changes without paying a network round-trip on every back-to-back tool call.
14. As a budget owner, I want write tool calls to synchronize before mutating and immediately synchronize after mutating, so that edits made via Gemini are pushed to the Sync Server before the tool returns.
15. As a budget owner, I want all operations against `@actual-app/api` serialized through a process-wide FIFO mutex, so that concurrent MCP tool calls from Gemini never corrupt the singleton SQLite state or interleave with `sync()`.
16. As a budget owner stopping or redeploying the container, I want `SIGTERM` and `SIGINT` signals to drain the mutex, run a final `sync()`, and cleanly call `shutdown()`, so that no pending budget mutations are lost.
17. As a budget owner asking Gemini about my finances, I want to list all accounts with their current balances, on-budget/off-budget flags, and open/closed status via `list_accounts`, so that I can see my net worth and account balances at a glance.
18. As a budget owner, I want all monetary inputs and outputs across every MCP tool to use Decimal Amounts (`-12.34` for a $12.34 Outflow, `100.00` for a $100.00 Inflow), so that Gemini never misinterprets Minor Unit Amounts by a factor of 100.
19. As a budget owner, I want to search and filter transactions via `get_transactions` by account, date range (`startDate`, `endDate`), category, payee, text query, and limit, with category and payee names resolved alongside their IDs, so that Gemini can answer detailed questions about my transaction history.
20. As a budget owner, I want to analyze my spending via `get_spending_summary` grouped by category, payee, or month over a date range, automatically excluding internal account transfers and off-budget accounts and inlining split transactions, so that my spending totals are accurate and never double-count splits or transfers.
21. As a budget owner asking ad-hoc analytical questions, I want Gemini to execute safe, read-only queries via `run_aql_query` using a Zod-validated Structured AQL Query schema, so that complex filtering, grouping, and sorting work without exposing arbitrary code execution.
22. As a budget owner, I want to list all categories and category groups via `list_categories` and all payees via `list_payees`, so that Gemini knows the valid category and payee names and IDs when querying or categorizing transactions.
23. As a budget owner, I want to list available Budget Months via `list_budget_months` and inspect a specific month (`YYYY-MM`) via `get_budget_month`, so that Gemini can tell me how much is budgeted, spent, carried over, and remaining in each category envelope.
24. As a budget owner logging expenses through Gemini, I want `create_transactions` to use Actual's `importTransactions` by default (matching/creating payees by `payee_name` and running my Actual categorization rules, with an optional `runRules: false` flag for raw `addTransactions`), so that new transactions follow my existing budget rules automatically.
25. As a budget owner, I want `create_transactions` to enforce a maximum batch size of 50 transactions per call, so that a single misunderstood prompt cannot flood my budget with ratusan/hundreds of bogus rows.
26. As a budget owner correcting a transaction through Gemini, I want `update_transaction` to return both the previous transaction state and the updated transaction state, so that Gemini can verify the diff and immediately revert the change if needed.
27. As a budget owner removing a transaction through Gemini, I want `delete_transaction` to return the full deleted transaction record prior to deletion, so that the transaction can be recreated with all original fields if deleted by mistake.
28. As a budget owner adjusting my monthly envelope allocations through Gemini, I want `set_budget_amount` to update a category's budgeted Decimal Amount and/or carryover flag for a given `YYYY-MM` Budget Month and return the previous and new category budget state, so that I can rebalance categories conversationally and undo mistakes easily.
29. As a budget owner, I want all read tools annotated with `readOnlyHint: true` and all write/delete tools annotated with `readOnlyHint: false` and appropriate `destructiveHint` flags, so that Gemini understands the safety profile of each tool.
30. As a VPS operator who already runs `cloudflared` and `actual-server`, I want a standalone `docker-compose.yml` that binds `127.0.0.1:${PORT:-3000}:3000`, maps `host.docker.internal`, and mounts a persistent `/data` volume, so that I can deploy `actual-mcp` cleanly alongside my existing services.

## Implementation Decisions

### 1. Runtime & Core Architecture
- **Node.js 22+ TypeScript (ESM)**: Built on Node.js 22 LTS (`node:22-bookworm-slim` in Docker with `tini` as PID 1) because `@actual-app/api` enforces Node `>=22` at runtime and uses native `better-sqlite3` bindings.
- **Configuration Validation**: A central startup configuration loader validates all required environment variables via Zod (`PUBLIC_URL`, `PORT`, `DATA_DIR`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_ADMIN_PASSWORD`, `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID`, and optional `ACTUAL_ENCRYPTION_PASSWORD`, `SYNC_TTL_SECONDS`) and fails fast with descriptive errors if any required variable is missing or malformed.

### 2. Embedded OAuth Server & Token Store (ADR-0001)
- **Express & Proxy Configuration**: The Express application enables `trust proxy` (`1`) and validates the `Host` header against an allowlist derived from `PUBLIC_URL` plus `localhost` / `127.0.0.1`.
- **Metadata & Endpoints**: Uses `@modelcontextprotocol/sdk`'s `mcpAuthRouter` and `requireBearerAuth` mounted with `issuerUrl` set to `PUBLIC_URL` and `resourceServerUrl` set to `${PUBLIC_URL}/mcp`. Adds a root `GET /.well-known/oauth-protected-resource` alias alongside `/.well-known/oauth-protected-resource/mcp` for broad client discovery compatibility.
- **Basic Auth Compatibility Shim**: Before `/token` and `/revoke`, an Express middleware inspects `Authorization: Basic <base64>`; when present and `req.body.client_id` is absent, it URL-decodes the credentials into `req.body.client_id` and `req.body.client_secret` so both `client_secret_basic` and `client_secret_post` succeed.
- **Google Redirect URI Allowlist**: The client store validates the pre-registered `OAUTH_CLIENT_ID` and permits redirect URIs matching Google's official connector patterns (`https://oauth-redirect(-sandbox|-test)?.googleusercontent.com/(r|a)/.*` and `https://vertexaisearch.cloud.google.com/oauth-redirect`), plus any additional comma-separated redirect URIs configured via `OAUTH_EXTRA_REDIRECT_URIS`.
- **HTML Consent Screen & Rate Limiting**: `GET /authorize` renders a self-contained HTML consent form showing the requesting client and scope and prompting for `OAUTH_ADMIN_PASSWORD`. `POST /authorize` is protected by an IP rate limiter and uses constant-time comparison (`crypto.timingSafeEqual`) before generating a single-use short-lived authorization code bound to the PKCE `code_challenge`.
- **Persistent Token Store & Non-Rotating Refresh Tokens**: Access tokens (default 1-hour TTL, `expiresAt` stored in epoch seconds) and refresh tokens (default 365-day sliding TTL) are persisted atomically to `${DATA_DIR}/oauth-tokens.json`. On `grant_type=refresh_token`, the provider issues a new access token while returning the **same** refresh token string with its expiration extended, satisfying Google's persistent account-linking requirement.

### 3. Stateless Streamable HTTP MCP Transport
- **`POST /mcp`**: Protected by `requireBearerAuth`. Each request instantiates a fresh stateless `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` connected to an `McpServer` instance wired to the `BudgetGateway`.
- **`GET /mcp` and `DELETE /mcp`**: Return HTTP `405 Method Not Allowed` per the MCP Streamable HTTP specification for stateless servers.

### 4. Target Budget Gateway, FIFO Mutex & Coalesced Sync (ADR-0002)
- **`BudgetGateway` Interface**: Decouples the HTTP/MCP transport and tool handlers from `@actual-app/api` internals. All domain inputs and outputs on `BudgetGateway` use **Decimal Amounts** (or clean domain records) while the `ActualBudgetGateway` implementation converts to/from **Minor Unit Amounts** using `utils.amountToInteger` and `utils.integerToAmount`.
- **Initialization**: Ensures `${DATA_DIR}/budget-cache` exists on disk, calls `api.init({ dataDir, serverURL, password })`, and opens the Target Budget via `api.downloadBudget(syncId, { password: encryptionPassword })`.
- **Process-Wide FIFO Mutex**: Every gateway operation (reads, writes, explicit syncs, and shutdown) is enqueued onto a single non-reentrant FIFO promise queue so concurrent HTTP requests never interleave over `@actual-app/api`'s singleton state.
- **Coalesced Sync Policy**:
  - **Reads**: Inside the mutex, if `Date.now() - lastSyncedAt > syncTtlMs` (default 30,000 ms) or `forceSync: true` is passed, calls `await api.sync()` and updates `lastSyncedAt` before reading.
  - **Writes**: Inside the mutex, calls `await api.sync()` before executing the mutation, executes the mutation, and immediately calls `await api.sync()` and updates `lastSyncedAt` before returning.

### 5. MCP Tool Surface (12 Tools)
- **Read Tools** (`readOnlyHint: true`, `destructiveHint: false`):
  1. `list_accounts`: Lists all accounts with ID, name, offbudget flag, closed flag, and current balance as a Decimal Amount.
  2. `get_transactions`: Queries transactions with optional filters (`accountId`, `startDate`, `endDate`, `categoryId`, `payeeId`, `searchText`, `limit` default 100 max 500, `forceSync`), returning enriched records with both IDs and human-readable account/category/payee names and Decimal Amounts.
  3. `get_spending_summary`: Runs an ActualQL aggregation over `transactions` for a `startDate`..`endDate` window grouped by `'category' | 'payee' | 'month'`, defaulting to excluding transfers (`payee.transfer_acct = null`) and off-budget accounts (`account.offbudget = false`) with `splits: 'inline'`.
  4. `run_aql_query`: Accepts a Zod-validated **Structured AQL Query** (`table`, `filter`, `select`, `groupBy`, `orderBy`, `limit`, `offset`, `splits`), compiles it safely to `@actual-app/api`'s `q(table)` builder, executes `aqlQuery()`, and converts integer amount columns to Decimal Amounts.
  5. `list_categories`: Returns category groups and their categories (including `is_income` and `hidden` flags).
  6. `list_payees`: Returns payees (including `transfer_acct` indicator).
  7. `list_budget_months`: Returns available `YYYY-MM` Budget Months.
  8. `get_budget_month`: Returns the `YYYY-MM` Budget Month envelope summary (`toBudget`, `totalIncome`, `totalBudgeted`, `totalSpent`, `totalBalance`, and per-category `budgeted`, `spent`, `balance`, `carryover` in Decimal Amounts).
- **Write Tools** (`readOnlyHint: false`):
  9. `create_transactions` (`destructiveHint: false`): Accepts `accountId`, an array of 1–50 transactions (`date`, `amount` in Decimal Amount, `payeeName` or `payeeId`, `categoryId`, `notes`, `cleared`, `importedId`), and `runRules` (default `true`). Uses `importTransactions` when `runRules: true` and `addTransactions` when `runRules: false`.
  10. `update_transaction` (`destructiveHint: false`): Fetches the existing transaction by ID, applies the requested field updates (`date`, `amount`, `payeeId`, `categoryId`, `notes`, `cleared`), calls `updateTransaction`, and returns `{ previous, updated }`.
  11. `delete_transaction` (`destructiveHint: true`): Fetches the existing transaction by ID, calls `deleteTransaction`, and returns `{ deleted }` containing the full record prior to removal.
  12. `set_budget_amount` (`destructiveHint: false`): Reads the current category budget state for `month` (`YYYY-MM`) and `categoryId`, updates `budgeted` (via `setBudgetAmount`) and/or `carryover` (via `setBudgetCarryover`), and returns `{ previous, updated }`.

### 6. Docker & Standalone Deployment
- **Dockerfile**: Multi-stage `node:22-bookworm-slim` build installing `tini`, compiling TypeScript, pruning dev dependencies, creating `/data`, and running under `ENTRYPOINT ["/usr/bin/tini", "--"]`.
- **Standalone `docker-compose.yml` & `.env.example`**: Binds `127.0.0.1:${PORT:-3000}:3000`, configures `extra_hosts: ["host.docker.internal:host-gateway"]`, mounts `./data:/data`, and sets `restart: unless-stopped` and a container healthcheck hitting `http://127.0.0.1:3000/healthz`.

## Testing Decisions

- **Philosophy**: Tests verify observable behavior at public boundaries, never internal implementation details.
- **Seam 1 — HTTP Application Boundary (`createApp`)**:
  - Tested via `supertest` and JSON-RPC HTTP calls against the Express app created with a temporary `DATA_DIR` and an injected `BudgetGateway` test double.
  - Verifies: `GET /healthz`, RFC 9728 & RFC 8414 `.well-known` discovery, `401 WWW-Authenticate` challenge on unauthenticated `/mcp`, `/authorize` HTML rendering + passphrase validation + rate limiting + Google redirect URI allowlisting + PKCE verification, `/token` exchange with both `client_secret_basic` and `client_secret_post`, non-rotating refresh token renewal + persistence across store reloads, stateless `POST /mcp` (`405` on `GET`/`DELETE`), `tools/list` annotations, and `tools/call` for all 12 tools (Decimal Amount conversion, batch limits, and `{ previous, updated }` / `{ deleted }` responses).
- **Seam 2 — `BudgetGateway` Adapter (`createActualBudgetGateway`)**:
  - Tested against a controlled `@actual-app/api` boundary / temporary SQLite budget fixture.
  - Verifies: FIFO mutex serialization (concurrent calls never overlap), Coalesced Sync TTL behavior (reads within TTL skip `sync()`, reads after TTL or with `forceSync` invoke `sync()`, writes invoke `sync()` before and after), `Structured AQL Query` compilation (`splits: 'inline'`, filter/groupBy/orderBy/limit), Minor Unit Amount ↔ Decimal Amount conversion accuracy, and graceful `shutdown()` draining.

## Out of Scope

- Multi-tenant user management or external OAuth identity providers (Keycloak, Auth0, Cloudflare Access OIDC).
- Dynamic switching between multiple Actual Budget files at runtime within a single server instance.
- Bank sync configuration (SimpleFIN / GoCardless account linking) via MCP tools.
- Bundling `actual-server` or `cloudflared` inside `docker-compose.yml` (both already run on the target VPS).

## Further Notes

- Research references:
  - `docs/research/mcp-oauth-and-gemini-connector.md`
  - `docs/research/actual-budget-api.md`
- Architecture Decision Records:
  - `docs/adr/0001-embedded-single-tenant-oauth.md`
  - `docs/adr/0002-single-budget-mutex-and-cache.md`
