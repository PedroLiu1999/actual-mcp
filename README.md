# actual-mcp

A self-contained Model Context Protocol (MCP) server that connects a self-hosted [Actual Budget](https://actualbudget.org/) instance to **Google Gemini** over **Streamable HTTP** (`POST /mcp`) and an **Embedded OAuth Server** (OAuth 2.1 Authorization Code + PKCE).

Designed for single-user VPS deployments where `actual-server` and `cloudflared` (Cloudflare Tunnel) are already running, `actual-mcp` packages the `@actual-app/api` (`loot-core`) Node.js engine, a persistent local SQLite **Budget Cache**, and a zero-dependency **Embedded OAuth Server** into a single lightweight Docker container.

---

## Architecture

![actual-mcp Architecture](docs/assets/architecture.svg)

<details>
<summary>ASCII Diagram Fallback</summary>

```text
+------------------------+        HTTPS (Cloudflare Tunnel)        +---------------------------------------------------+
|     Google Gemini      |  ------------------------------------>  |               actual-mcp (Docker)                 |
|  Custom MCP Connector  |     POST /mcp (Bearer Access Token)     |                                                   |
|                        |     GET  /.well-known/oauth-*           |  +---------------------------------------------+  |
|                        |     GET/POST /authorize, POST /token    |  | Embedded OAuth Server (OAuth 2.1 + PKCE)    |  |
+------------------------+                                         |  | - Pre-registered Client ID & Client Secret  |  |
                                                                   |  | - Passphrase-protected HTML consent screen  |  |
                                                                   |  | - Persistent Token Store (oauth-tokens.json)|  |
                                                                   |  +---------------------------------------------+  |
                                                                   |                        |                          |
                                                                   |                        v                          |
                                                                   |  +---------------------------------------------+  |
                                                                   |  | Stateless Streamable HTTP Transport (/mcp)  |  |
                                                                   |  | - 12 MCP Tools (8 Read, 4 Write)            |  |
                                                                   |  | - Decimal Amount <-> Minor Unit conversion  |  |
                                                                   |  +---------------------------------------------+  |
                                                                   |                        |                          |
                                                                   |                        v                          |
                                                                   |  +---------------------------------------------+  |
                                                                   |  | ActualBudgetGateway (FIFO Mutex)            |  |
                                                                   |  | - Coalesced Sync (TTL on reads, pre/post    |  |
                                                                   |  |   sync on writes, graceful SIGTERM drain)   |  |
                                                                   |  | - Local SQLite Budget Cache (/data)         |  |
                                                                   |  +---------------------------------------------+  |
                                                                   +------------------------|--------------------------+
                                                                                            |
                                                                                            | HTTP (host.docker.internal:5006)
                                                                                            v
                                                                   +---------------------------------------------------+
                                                                   |       Existing Actual Budget Sync Server          |
                                                                   |            (actualbudget/actual-server)           |
                                                                   +---------------------------------------------------+
```

</details>

### Key Design Highlights

1. **Embedded Single-Tenant OAuth 2.1 Server ([ADR-0001](docs/adr/0001-embedded-single-tenant-oauth.md))**:
   - Exposes RFC 9728 Protected Resource Metadata (`/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`) and RFC 8414 Authorization Server Metadata (`/.well-known/oauth-authorization-server`).
   - Supports both `client_secret_basic` (`Authorization: Basic`) and `client_secret_post` client authentication on `/token` and `/revoke`.
   - Automatically allowlists Google Gemini's dynamic OAuth callback URLs (`https://oauth-redirect*.googleusercontent.com/(r|a)/*` and `https://vertexaisearch.cloud.google.com/oauth-redirect`).
   - Renders a self-contained, rate-limited HTML consent screen at `GET /authorize` gated by `OAUTH_ADMIN_PASSWORD`.
   - Implements **Persistent Linking** via a file-backed **Token Store** (`/data/oauth-tokens.json`): `grant_type=refresh_token` returns a fresh access token while preserving the exact same refresh token and extending its sliding 365-day expiration so your Gemini link survives token refreshes and container restarts.
2. **Single-Budget FIFO Mutex & Coalesced Sync ([ADR-0002](docs/adr/0002-single-budget-mutex-and-cache.md))**:
   - `@actual-app/api` embeds `loot-core` and a module-level `better-sqlite3` singleton. `actual-mcp` binds to a single **Target Budget** (`ACTUAL_SYNC_ID`), caches its SQLite database in `/data/budget-cache`, and serializes every API operation through a process-wide non-reentrant FIFO mutex.
   - **Coalesced Sync**: Read operations skip `api.sync()` if the **Budget Cache** was synced within `SYNC_TTL_SECONDS` (default `30` seconds, overrideable per call with `forceSync: true`). Write operations always `sync()` before mutating and `sync()` immediately after mutating so changes reach the **Sync Server** before the tool returns.
   - **Graceful Shutdown**: Running under `tini` (PID 1), `SIGTERM` and `SIGINT` drain any in-flight mutex operation, run a final `sync()`, and cleanly close the SQLite database via `shutdown()`.
3. **Decimal Amounts at the MCP Boundary**:
   - Internally, `@actual-app/api` represents money as integer **Minor Unit Amounts** (`-1234` for `-$12.34`). Every MCP tool in `actual-mcp` accepts and returns standard major-unit **Decimal Amounts** (`-12.34` for a `$12.34` **Outflow** / expense, `100.00` for a `$100.00` **Inflow** / income) to prevent LLM unit-scale errors.

---

## MCP Tools Reference (12 Tools)

All tools return structured JSON serialized in MCP text content blocks and include MCP safety annotations (`readOnlyHint`, `destructiveHint`).

### Read Tools (`readOnlyHint: true`, `destructiveHint: false`)

| Tool | Description | Parameters |
| :--- | :--- | :--- |
| `list_accounts` | List all accounts in the **Target Budget** with ID, name, `offbudget` flag, `closed` flag, and current balance as a **Decimal Amount**. | `forceSync?` (`boolean`) |
| `get_transactions` | Query transactions with enriched `accountName`, `categoryName`, and `payeeName` alongside IDs and **Decimal Amounts**. | `accountId?` (`string`), `startDate?` (`YYYY-MM-DD`), `endDate?` (`YYYY-MM-DD`), `categoryId?` (`string`), `payeeId?` (`string`), `searchText?` (`string`, case-insensitive match on payee/notes), `limit?` (`1..500`, default `100`), `forceSync?` (`boolean`) |
| `get_spending_summary` | Aggregate transactions over a date range into a **Spending Summary** grouped by `'category'`, `'payee'`, or `'month'` with split transactions inlined (`splits: 'inline'`). Excludes internal transfers and off-budget accounts by default. | `startDate` (`YYYY-MM-DD`, required), `endDate` (`YYYY-MM-DD`, required), `groupBy?` (`'category' \| 'payee' \| 'month'`, default `'category'`), `includeTransfers?` (`boolean`, default `false`), `includeOffBudget?` (`boolean`, default `false`), `forceSync?` (`boolean`) |
| `run_aql_query` | Execute a Zod-validated, read-only **Structured AQL Query** against `@actual-app/api`'s `q(table)` builder and `aqlQuery()`, converting monetary fields to **Decimal Amounts**. | `table` (`'transactions' \| 'accounts' \| 'categories' \| 'category_groups' \| 'payees' \| 'schedules' \| 'rules'`), `filter?` (`object`), `select?` (`string \| Array<string \| object>`), `groupBy?` (`string \| string[]`), `orderBy?` (`string \| object \| Array`), `limit?` (`1..1000`, default `100`), `offset?` (`number`), `splits?` (`'inline' \| 'grouped' \| 'all'`, default `'inline'`), `forceSync?` (`boolean`) |
| `list_categories` | List all category groups and their categories (`id`, `name`, `group_id`, `is_income`, `hidden`). | `forceSync?` (`boolean`) |
| `list_payees` | List all payees (`id`, `name`, `transfer_acct`). | `forceSync?` (`boolean`) |
| `list_budget_months` | List available `YYYY-MM` **Budget Months** in the **Target Budget**. | `forceSync?` (`boolean`) |
| `get_budget_month` | Inspect a `YYYY-MM` **Budget Month** envelope summary (`toBudget`, `totalIncome`, `totalBudgeted`, `totalSpent`, `totalBalance`, and per-category `budgeted`, `spent`, `balance`, `carryover` in **Decimal Amounts**). | `month` (`YYYY-MM`, required), `forceSync?` (`boolean`) |

### Write Tools (`readOnlyHint: false`)

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `create_transactions` | `false` | Create a batch of 1 to 50 transactions in an account using **Decimal Amounts**. Uses `importTransactions` by default (`runRules: true`) so payee matching/creation and Actual categorization rules run automatically, or `addTransactions` when `runRules: false`. | `accountId` (`string`, required), `transactions` (`Array<{ date, amount, payeeName?, payeeId?, categoryId?, notes?, cleared?, importedId? }>`, 1–50 items), `runRules?` (`boolean`, default `true`) |
| `update_transaction` | `false` | Update an existing transaction by ID and return `{ previous, updated }` in **Decimal Amounts** so edits can be verified or immediately reverted. | `id` (`string`, required), `date?` (`YYYY-MM-DD`), `amount?` (`number`), `payeeId?` (`string \| null`), `categoryId?` (`string \| null`), `notes?` (`string \| null`), `cleared?` (`boolean`) |
| `delete_transaction` | `true` | Delete an existing transaction by ID and return `{ deleted }` containing the full pre-deletion record in **Decimal Amounts** so it can be recreated if deleted by mistake. | `id` (`string`, required) |
| `set_budget_amount` | `false` | Update a category's budgeted **Decimal Amount** and/or overspending `carryover` flag in a `YYYY-MM` **Budget Month** and return `{ previous, updated }` category states. | `month` (`YYYY-MM`, required), `categoryId` (`string`, required), `budgeted?` (`number`), `carryover?` (`boolean`) |

---

## Quick Start (One-Command Setup)

Deploy in seconds on your VPS without cloning the repository. In your terminal, run:

```bash
mkdir -p actual-mcp && cd actual-mcp && bash -c "$(curl -fsSL https://raw.githubusercontent.com/PedroLiu1999/actual-mcp/main/scripts/setup-wizard.sh)"
```

The interactive wizard handles everything end-to-end:
1. **Auto-Downloads `docker-compose.yml`**: Fetches the compose file and creates the persistent `data/` directory.
2. **Configures `.env`**: Sets up `PUBLIC_URL` (for your Cloudflare Tunnel) and loopback `PORT` (default `3000`).
3. **OAuth Credentials**: Generates a random `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`, and prompts for an `OAUTH_ADMIN_PASSWORD`.
4. **Actual Budget Connection**: Prompts for `ACTUAL_SERVER_URL`, server password, and `ACTUAL_SYNC_ID`.
5. **Starts Docker Container**: Offers to pull the pre-built image from GHCR and start it (`docker compose pull && docker compose up -d`).
6. **Healthchecks**: Tests local and public `/healthz` endpoints.
7. **Gemini Custom Connector**: Displays the exact `MCP server URL`, `Client ID`, and `Client secret` to paste into Google Gemini.

---

## Environment Variables

Copy `.env.example` to `.env` (or run `./scripts/setup-wizard.sh`):

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PUBLIC_URL` | **Yes** | — | Public HTTPS origin exposed by your Cloudflare Tunnel (e.g. `https://actual-mcp.example.com`, no trailing slash). |
| `PORT` | No | `3000` | Port the HTTP server listens on inside the container (and host loopback port in `docker-compose.yml`). |
| `ACTUAL_MCP_VERSION` | No | `latest` | Tag of the pre-built Docker image from GitHub Container Registry (`ghcr.io/pedroliu1999/actual-mcp`). |
| `DATA_DIR` | **Yes** | `/data` | Path to the persistent directory storing `oauth-tokens.json` (**Token Store**) and `budget-cache/` (**Budget Cache**). |
| `OAUTH_CLIENT_ID` | **Yes** | — | Pre-registered OAuth 2.1 `Client ID` to enter in Google Gemini. |
| `OAUTH_CLIENT_SECRET` | **Yes** | — | Pre-registered OAuth 2.1 `Client Secret` to enter in Google Gemini (e.g. `openssl rand -hex 32`). |
| `OAUTH_ADMIN_PASSWORD` | **Yes** | — | Admin passphrase required on the HTML consent page (`GET /authorize`) to approve an OAuth grant. |
| `OAUTH_EXTRA_REDIRECT_URIS` | No | `""` | Optional comma-separated list of additional allowed redirect URIs beyond Google Gemini's built-in callback patterns. |
| `ACTUAL_SERVER_URL` | **Yes** | — | URL of your self-hosted Actual Budget **Sync Server** (e.g. `http://host.docker.internal:5006`). |
| `ACTUAL_PASSWORD` | **Yes** | — | Server password used to sign in to your Actual Budget **Sync Server**. |
| `ACTUAL_SYNC_ID` | **Yes** | — | **Sync ID** UUID of the **Target Budget** (found in Actual Budget under *Settings → Show advanced settings → Sync ID*). |
| `ACTUAL_ENCRYPTION_PASSWORD` | No | — | End-to-end encryption password for the **Target Budget** (omit or leave empty if unencrypted). |
| `SYNC_TTL_SECONDS` | No | `30` | **Coalesced Sync** freshness window in seconds for read tools. |

---

## VPS Deployment Guide

This guide assumes your VPS already runs:
1. An Actual Budget **Sync Server** (`actual-server`, typically listening on port `5006`).
2. A Cloudflare Tunnel (`cloudflared`).

### Step 1: Clone & Configure `.env`

```bash
git clone git@github.com:PedroLiu1999/actual-mcp.git
cd actual-mcp
mkdir -p data
```

You can configure `.env` interactively using the setup wizard:

```bash
./scripts/setup-wizard.sh
```

Or configure it manually by copying `.env.example`:

```bash
cp .env.example .env
```

Generate strong secrets for `OAUTH_CLIENT_SECRET` and `OAUTH_ADMIN_PASSWORD`, and fill in your `.env`:

```bash
# Example secret generation:
openssl rand -hex 32
```

- Set `PUBLIC_URL=https://actual-mcp.yourdomain.com` (matching the hostname you will route in `cloudflared`).
- Set `ACTUAL_SERVER_URL`:
  - If `actual-server` publishes port `5006` on the VPS host (e.g. `127.0.0.1:5006:5006` or `0.0.0.0:5006:5006`), keep `ACTUAL_SERVER_URL=http://host.docker.internal:5006` (`docker-compose.yml` maps `host.docker.internal` to the Docker host gateway automatically).
  - If `actual-server` uses a self-signed certificate over HTTPS, either connect over local HTTP via `host.docker.internal` or mount the CA certificate and set `NODE_EXTRA_CA_CERTS`.
- Set `ACTUAL_PASSWORD` to your Actual server password and `ACTUAL_SYNC_ID` to your budget's **Sync ID** (*Settings → Show advanced settings → Sync ID* in the Actual UI).

### Step 2: Start the Container

To run using the official prebuilt image from GitHub Container Registry:

```bash
docker compose pull
docker compose up -d
```

Or build locally from source:

```bash
docker compose up -d --build
```

Verify the container is healthy and the **Target Budget** initialized cleanly:

```bash
curl -s http://127.0.0.1:3000/healthz | jq .
```

Expected response:

```json
{
  "status": "ok",
  "targetBudget": {
    "ready": true,
    "syncId": "11111111-2222-3333-4444-555555555555",
    "lastSyncedAt": "2026-11-04T18:00:00.000Z"
  }
}
```

### Step 3: Route a Public Hostname in Your Existing `cloudflared` Tunnel

Because `docker-compose.yml` binds `127.0.0.1:${PORT:-3000}:3000` on the VPS host, `actual-mcp` is never exposed directly on your VPS's public IP—only through your Cloudflare Tunnel.

#### Option A: Cloudflare Zero Trust Dashboard (Remotely Managed Tunnel)
1. Open the **Cloudflare Zero Trust Dashboard** → **Networks** → **Tunnels**.
2. Select your existing tunnel and click **Configure** → **Public Hostname** → **Add a public hostname**.
3. Set:
   - **Subdomain**: `actual-mcp` (or your chosen subdomain)
   - **Domain**: `yourdomain.com`
   - **Service Type**: `HTTP`
   - **URL**: `127.0.0.1:3000` (or `host.docker.internal:3000` if `cloudflared` runs inside a Docker container with `host-gateway` mapped)
4. Save the hostname.

#### Option B: Local `cloudflared` Config File (`/etc/cloudflared/config.yml`)
Add an ingress rule before the catch-all `http_status:404` rule:

```yaml
ingress:
  - hostname: actual-mcp.yourdomain.com
    service: http://127.0.0.1:3000
  # ... your existing ingress rules ...
  - service: http_status:404
```

Then create the DNS route and reload `cloudflared`:

```bash
cloudflared tunnel route dns <your-tunnel-name> actual-mcp.yourdomain.com
sudo systemctl restart cloudflared
```

> **Cloudflare WAF / Bot Fight Mode Note**: Google Gemini sends outbound MCP requests with `User-Agent: Google`. Ensure Cloudflare **Bot Fight Mode** or custom WAF rules on `actual-mcp.yourdomain.com` do not challenge (CAPTCHA / JS challenge) requests to `/mcp`, `/authorize`, `/token`, `/revoke`, or `/.well-known/*`.

Verify external OAuth discovery over HTTPS:

```bash
curl -s https://actual-mcp.yourdomain.com/.well-known/oauth-protected-resource | jq .
curl -s https://actual-mcp.yourdomain.com/.well-known/oauth-authorization-server | jq .
```

---

## Connecting in Google Gemini

Once `https://actual-mcp.yourdomain.com` is live behind your Cloudflare Tunnel:

1. Open [Google Gemini](https://gemini.google.com) (or [Gemini Apps Developer Mode](https://gemini.google.com/devmode)).
2. Go to **Settings** → **Connected Apps** → **Add a custom app** (or click **+ Create new** to open the **"Connect to an MCP server"** dialog).
3. Fill in the connection details:
   - **MCP server URL**: `https://actual-mcp.yourdomain.com/mcp`
4. Expand **Additional settings** → **Show more** (or **Advanced features** → **Show more**) to reveal static OAuth client credentials:
   - **Client ID** (OAuth Client ID): Enter the exact `OAUTH_CLIENT_ID` from your `.env` (e.g. `actual-mcp-gemini`).
   - **Client Secret** (OAuth Client secret): Enter the exact `OAUTH_CLIENT_SECRET` from your `.env`.
5. Click **Connect** / **Save**:
   - Gemini discovers `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` and opens a browser popup to `https://actual-mcp.yourdomain.com/authorize`.
   - On the **Actual Budget MCP Server** consent screen, enter your `OAUTH_ADMIN_PASSWORD` and click **Approve & Connect**.
6. Gemini exchanges the authorization code (with PKCE `S256`) at `POST /token` and stores your non-rotating refresh token. Your Actual Budget tools are now available in Gemini web and mobile chats!

---

## Local Development & Verification

Requires **Node.js `>=22.0.0`**.

```bash
# Install dependencies
npm install

# Run the test suite (Vitest)
npm test

# Run TypeScript typechecking
npm run typecheck

# Compile TypeScript to dist/
npm run build
```
