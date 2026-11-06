<p align="center">

![actual-mcp logo](https://raw.githubusercontent.com/PedroLiu1999/actual-mcp/main/docs/assets/logo/dist/actual-mcp-horizontal.svg)

</p>

# actual-mcp

<p align="center">

[![CI](https://github.com/PedroLiu1999/actual-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/PedroLiu1999/actual-mcp/actions/workflows/ci.yml)
[![Docker](https://github.com/PedroLiu1999/actual-mcp/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/PedroLiu1999/actual-mcp/actions/workflows/docker-publish.yml)
[![GitHub Release](https://img.shields.io/github/v/release/PedroLiu1999/actual-mcp?color=blue&label=version)](https://github.com/PedroLiu1999/actual-mcp/releases)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Streamable%20HTTP-blueviolet.svg)](https://modelcontextprotocol.io/)
[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/pedroliu1999/actual-mcp)

</p>

A self-contained Model Context Protocol (MCP) server that connects a self-hosted [Actual Budget](https://actualbudget.org/) instance to AI assistants, including Claude Desktop, Cursor, Google Gemini, and custom agents. The server communicates over Streamable HTTP (`POST /mcp`) and includes an embedded OAuth 2.1 server that supports PKCE and RFC 7591 dynamic client registration.

Designed for single-user VPS deployments running `actual-server` and `cloudflared` (Cloudflare Tunnel), `actual-mcp` packages `@actual-app/api` (`loot-core`), a local SQLite budget cache, and the embedded OAuth server in one Docker container.

---

## Architecture

![actual-mcp Architecture](docs/assets/architecture.svg)

---

## MCP tools reference

`actual-mcp` provides all 39 MCP tools: 11 read tools and 28 write tools across categories, category groups, payees, accounts, bank synchronization, budget adjustments, recurring schedules, and automation rules. Every tool returns structured JSON in MCP text content blocks and includes safety annotations (`readOnlyHint`, `destructiveHint`).

### Read tools (`readOnlyHint: true`, `destructiveHint: false`)

<details>
<summary><strong>View read tools (11 tools)</strong></summary>

| Tool | Description | Parameters |
| :--- | :--- | :--- |
| `list_accounts` | List all accounts in the target budget with ID, name, `offbudget` flag, `closed` flag, and current balance as a decimal amount. | `forceSync?` (`boolean`) |
| `get_transactions` | Query transactions with enriched `accountName`, `categoryName`, and `payeeName` alongside IDs and decimal amounts. | `accountId?` (`string`), `startDate?` (`YYYY-MM-DD`), `endDate?` (`YYYY-MM-DD`), `categoryId?` (`string`), `payeeId?` (`string`), `searchText?` (`string`, case-insensitive match on payee or notes), `limit?` (`1..500`, default `100`), `forceSync?` (`boolean`) |
| `get_spending_summary` | Aggregate transactions over a date range into a spending summary grouped by `'category'`, `'payee'`, or `'month'` with split transactions inlined. Excludes internal transfers and off-budget accounts by default. | `startDate` (`YYYY-MM-DD`, required), `endDate` (`YYYY-MM-DD`, required), `groupBy?` (`'category' \| 'payee' \| 'month'`, default `'category'`), `includeTransfers?` (`boolean`, default `false`), `includeOffBudget?` (`boolean`, default `false`), `forceSync?` (`boolean`) |
| `run_aql_query` | Execute a validated, read-only AQL query against `@actual-app/api` and convert monetary fields to decimal amounts. | `table` (`'transactions' \| 'accounts' \| 'categories' \| 'category_groups' \| 'payees' \| 'schedules' \| 'rules'`), `filter?` (`object`), `select?` (`string \| Array<string \| object>`), `groupBy?` (`string \| string[]`), `orderBy?` (`string \| object \| Array`), `limit?` (`1..1000`, default `100`), `offset?` (`number`), `splits?` (`'inline' \| 'grouped' \| 'all'`, default `'inline'`), `forceSync?` (`boolean`) |
| `list_categories` | List all category groups and their child categories (`id`, `name`, `group_id`, `is_income`, `hidden`). | `forceSync?` (`boolean`) |
| `list_payees` | List all payees (`id`, `name`, `transfer_acct`). | `forceSync?` (`boolean`) |
| `list_budget_months` | List available `YYYY-MM` budget months in the target budget. | `forceSync?` (`boolean`) |
| `get_budget_month` | Inspect a `YYYY-MM` budget month summary (`toBudget`, `totalIncome`, `totalBudgeted`, `totalSpent`, `totalBalance`, and per-category amounts in decimal units). | `month` (`YYYY-MM`, required), `forceSync?` (`boolean`) |
| `list_schedules` | List all recurring schedules in the target budget with ID, name, rule ID, next date, completed flag, transaction posting flag, payee ID, account ID, decimal amount, amount operator, and recurrence configuration. | `forceSync?` (`boolean`) |
| `get_schedule_upcoming_dates` | Calculate upcoming occurrence dates for a schedule ID or date recurrence configuration over a date range or count. | `scheduleId?` (`string`), `date?` (`string \| object`), `start?` (`YYYY-MM-DD`), `end?` (`YYYY-MM-DD`), `count?` (`number`, 1..100, default 10), `forceSync?` (`boolean`) |
| `list_rules` | List all automation rules in the target budget with conditions, actions, stage, and operator, with optional payee filtering. Amounts in conditions and actions are converted to decimal amounts. | `payeeId?` (`string`), `forceSync?` (`boolean`) |

</details>

### Write tools (`readOnlyHint: false`)

<details>
<summary><strong>Transactions and budget amounts (4 tools)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `create_transactions` | `false` | Create a batch of 1 to 50 transactions in an account using decimal amounts. Uses `importTransactions` by default (`runRules: true`) so payee matching and categorization rules run automatically, or `addTransactions` when `runRules: false`. | `accountId` (`string`, required), `transactions` (`Array<{ date, amount, payeeName?, payeeId?, categoryId?, notes?, cleared?, importedId? }>`, 1–50 items), `runRules?` (`boolean`, default `true`) |
| `update_transaction` | `false` | Update an existing transaction by ID and return `{ previous, updated }` in decimal amounts so changes can be verified or reverted. | `id` (`string`, required), `date?` (`YYYY-MM-DD`), `amount?` (`number`), `payeeId?` (`string \| null`), `categoryId?` (`string \| null`), `notes?` (`string \| null`), `cleared?` (`boolean`) |
| `delete_transaction` | `true` | Delete a transaction by ID and return `{ deleted }` with the full pre-deletion record in decimal amounts so it can be restored if deleted by mistake. | `id` (`string`, required) |
| `set_budget_amount` | `false` | Update a category budgeted decimal amount or overspending carryover flag in a `YYYY-MM` budget month, returning `{ previous, updated }` states. | `month` (`YYYY-MM`, required), `categoryId` (`string`, required), `budgeted?` (`number`), `carryover?` (`boolean`) |

</details>

<details>
<summary><strong>Categories and category groups (6 tools)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `create_category` | `false` | Create an envelope category under a category group. Returns `{ id }`. | `name` (`string`, min 1, required), `groupId` (`string`, min 1, required), `isIncome?` (`boolean`), `hidden?` (`boolean`) |
| `update_category` | `false` | Update an envelope category name, parent group, or income and hidden flags. | `id` (`string`, min 1, required), `name?` (`string`), `groupId?` (`string`), `isIncome?` (`boolean`), `hidden?` (`boolean`) |
| `delete_category` | `true` | Delete an envelope category. When the category contains existing transactions, provide `transferCategoryId` to reassign them safely. | `id` (`string`, min 1, required), `transferCategoryId?` (`string`, min 1) |
| `create_category_group` | `false` | Create a category group for organizing expense or income envelopes. Returns `{ id }`. | `name` (`string`, min 1, required), `isIncome?` (`boolean`), `hidden?` (`boolean`) |
| `update_category_group` | `false` | Update a category group name or income and hidden flags. | `id` (`string`, min 1, required), `name?` (`string`), `isIncome?` (`boolean`), `hidden?` (`boolean`) |
| `delete_category_group` | `true` | Delete a category group. When member categories contain transactions, provide `transferCategoryId` to reassign them safely. | `id` (`string`, min 1, required), `transferCategoryId?` (`string`, min 1) |

</details>

<details>
<summary><strong>Payees and merging (4 tools)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `create_payee` | `false` | Create a payee record by name. Returns `{ id }`. | `name` (`string`, min 1, required) |
| `update_payee` | `false` | Rename an existing payee record. | `id` (`string`, min 1, required), `name` (`string`, min 1, required) |
| `delete_payee` | `true` | Delete a payee record by ID. | `id` (`string`, min 1, required) |
| `merge_payees` | `true` | Merge duplicate source payees into a target payee, reassigning all transactions and rules to the target payee and removing the source payees. | `targetPayeeId` (`string`, min 1, required), `sourcePayeeIds` (`string[]`, min 1 items, required) |

</details>

<details>
<summary><strong>Account lifecycle (4 tools)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `create_account` | `false` | Create an on-budget or off-budget account with a specified type and optional initial balance. Returns `{ id }`. | `name` (`string`, min 1, required), `type` (`'checking' \| 'savings' \| 'credit' \| 'investment' \| 'mortgage' \| 'debt' \| 'other'`, required), `offbudget?` (`boolean`), `initialBalance?` (`number`, finite decimal amount) |
| `update_account` | `false` | Update an account name or toggle its off-budget status. | `id` (`string`, min 1, required), `name?` (`string`), `offbudget?` (`boolean`) |
| `close_account` | `true` | Close an account in the target budget, with optional balance and category transfer to another account. | `id` (`string`, min 1, required), `transferAccountId?` (`string`), `transferCategoryId?` (`string`) |
| `reopen_account` | `false` | Reopen a previously closed account. | `id` (`string`, min 1, required) |

</details>

<details>
<summary><strong>Bank synchronization (1 tool)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `run_bank_sync` | `false` | Trigger bank synchronization for a single account or for all linked accounts when `accountId` is omitted. Returns `{ updatedAccountIds, newTransactionsCount, matchedTransactionsCount, errors }`. | `accountId?` (`string`, min 1) |

</details>

<details>
<summary><strong>Budget flow adjustments (3 tools)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `set_budget_carryover` | `false` | Set the overspending carryover flag for a category envelope in a budget month (`YYYY-MM`). When true, overspent category balance rolls into the next month. | `month` (`YYYY-MM`, required), `categoryId` (`string`, min 1, required), `carryover` (`boolean`, required) |
| `hold_budget_for_next_month` | `false` | Hold a decimal amount from the current month available budget for the next month. | `month` (`YYYY-MM`, required), `amount` (`number`, finite decimal amount, required) |
| `reset_budget_hold` | `false` | Reset the budget hold for a month and return held funds to the available budget. | `month` (`YYYY-MM`, required) |

</details>

<details>
<summary><strong>Recurring schedules (3 tools)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `create_schedule` | `false` | Create a recurring schedule in the target budget with decimal amounts, recurrence rules, and a linked payee and account. | `name?` (`string`), `account` (`string`, required), `payee?` (`string`), `amount` (`number \| { num1, num2 }`, decimal amount, required), `amountOp?` (`'is' \| 'isapprox' \| 'isbetween'`), `date` (`string \| object`, required), `posts_transaction?` (`boolean`) |
| `update_schedule` | `false` | Update fields on an existing recurring schedule (name, amount, amountOp, payee, account, date, posts_transaction, resetNextDate). | `id` (`string`, required), `name?` (`string`), `account?` (`string`), `payee?` (`string \| null`), `amount?` (`number \| { num1, num2 }`), `amountOp?` (`'is' \| 'isapprox' \| 'isbetween'`), `date?` (`string \| object`), `posts_transaction?` (`boolean`), `resetNextDate?` (`boolean`) |
| `delete_schedule` | `true` | Delete a recurring schedule from the target budget. | `id` (`string`, required) |

</details>

<details>
<summary><strong>Automation rules (3 tools)</strong></summary>

| Tool | Destructive | Description | Parameters |
| :--- | :---: | :--- | :--- |
| `create_rule` | `false` | Create an automation rule for categorization, payee renaming, or field setting. Converts monetary condition and action values to minor units. | `stage?` (`'pre' \| 'post' \| 'default'`), `conditionsOp?` (`'and' \| 'or'`), `conditions` (`Array<{ field, op, value, options? }>`, min 1, required), `actions` (`Array<{ field?, op, value?, options? }>`, min 1, required) |
| `update_rule` | `false` | Update conditions, actions, stage, or operator on an existing rule by ID. | `id` (`string`, required), `stage?` (`'pre' \| 'post' \| 'default'`), `conditionsOp?` (`'and' \| 'or'`), `conditions` (`Array<{ field, op, value, options? }>`, min 1, required), `actions` (`Array<{ field?, op, value?, options? }>`, min 1, required) |
| `delete_rule` | `true` | Delete an automation rule from the target budget. | `id` (`string`, required) |

</details>

---

## Quick start

To install on a VPS without cloning the repository, run the interactive setup wizard:

```bash
mkdir -p actual-mcp && cd actual-mcp && bash -c "$(curl -fsSL https://raw.githubusercontent.com/PedroLiu1999/actual-mcp/main/scripts/setup-wizard.sh)"
```

The setup wizard automates configuration:
1. Downloads `docker-compose.yml` and creates the persistent `data/` directory.
2. Configures `.env` with `PUBLIC_URL` and the loopback `PORT` (default `3000`).
3. Prompts for `OAUTH_ADMIN_PASSWORD` to protect the authorization consent screen.
4. Sets up OAuth redirect URIs for your selected AI clients, including Claude Desktop, Cursor, Google Gemini, and ChatGPT.
5. Configures the connection to your Actual Budget sync server: `ACTUAL_SERVER_URL`, server password, and `ACTUAL_SYNC_ID`.
6. Pulls the container image from GitHub Container Registry and starts the service.
7. Verifies health against local and public `/healthz` endpoints.
8. Displays tailored connection instructions for each selected AI client.

---

## Environment variables

To configure environment variables manually, copy `.env.example` to `.env`. Alternatively, run `./scripts/setup-wizard.sh`.

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PUBLIC_URL` | Yes | - | Public HTTPS origin exposed by your Cloudflare Tunnel (for example, `https://actual-mcp.example.com`, without trailing slash). |
| `PORT` | No | `3000` | Port that the HTTP server listens on inside the container, mapped to host loopback in `docker-compose.yml`. |
| `ACTUAL_MCP_VERSION` | No | `latest` | Image tag from GitHub Container Registry (`ghcr.io/pedroliu1999/actual-mcp`). |
| `DATA_DIR` | Yes | `/data` | Path to the persistent directory storing `oauth-tokens.json` (token store) and `budget-cache/` (budget cache). |
| `OAUTH_ADMIN_PASSWORD` | Yes | - | Admin passphrase required on the HTML consent page (`GET /authorize`) to approve an OAuth grant. |
| `OAUTH_ALLOWED_REDIRECT_URIS` | No | `http://localhost,http://127.0.0.1` | Comma-separated list of allowed OAuth redirect URIs. Loopback ports match dynamically per RFC 8252. Default includes well-known Google callback endpoints. |
| `ACTUAL_SERVER_URL` | Yes | - | URL of your self-hosted Actual Budget sync server (for example, `http://host.docker.internal:5006`). |
| `ACTUAL_PASSWORD` | Yes | - | Password used to authenticate with your Actual Budget sync server. |
| `ACTUAL_SYNC_ID` | Yes | - | Sync ID of the target budget. Find this in Actual Budget under *Settings → Show advanced settings → Sync ID*. |
| `ACTUAL_ENCRYPTION_PASSWORD` | No | - | End-to-end encryption password for the target budget. Leave empty if unencrypted. |
| `SYNC_TTL_SECONDS` | No | `30` | Coalesced sync freshness window in seconds for read tools. |

---

## VPS deployment guide

This guide assumes your VPS already runs:
1. An Actual Budget sync server (`actual-server`, typically on port `5006`).
2. A Cloudflare Tunnel (`cloudflared`).

### Step 1: Clone and configure the environment

To clone the repository and prepare the persistent storage directory, run:

```bash
git clone git@github.com:PedroLiu1999/actual-mcp.git
cd actual-mcp
mkdir -p data
```

To configure `.env` interactively, run:

```bash
./scripts/setup-wizard.sh
```

To configure `.env` manually, copy the sample file and fill in the values:

```bash
cp .env.example .env
```

Set `OAUTH_ADMIN_PASSWORD` to a strong passphrase, then set the remaining variables:

- Set `PUBLIC_URL=https://actual-mcp.yourdomain.com`, matching the public hostname routed by `cloudflared`.
- Set `ACTUAL_SERVER_URL`:
  - When `actual-server` publishes port `5006` on the VPS host (for example, `127.0.0.1:5006:5006`), set `ACTUAL_SERVER_URL=http://host.docker.internal:5006`. `docker-compose.yml` maps `host.docker.internal` to the Docker host gateway automatically.
  - When `actual-server` uses HTTPS with a self-signed certificate, connect over local HTTP through `host.docker.internal`, or mount the CA certificate and set `NODE_EXTRA_CA_CERTS`.
- Set `ACTUAL_PASSWORD` to your Actual server password.
- Set `ACTUAL_SYNC_ID` to your budget sync ID (*Settings → Show advanced settings → Sync ID* in Actual Budget).

### Step 2: Start the container

To run using the official image from GitHub Container Registry:

```bash
docker compose pull
docker compose up -d
```

To build and run locally from source:

```bash
docker compose up -d --build
```

To verify that the service is running and the target budget initialized cleanly:

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

### Step 3: Route a public hostname through Cloudflare Tunnel

Because `docker-compose.yml` binds to `127.0.0.1:${PORT:-3000}:3000` on the VPS host, `actual-mcp` is never exposed directly on the public IP address of your VPS. Traffic routes only through your Cloudflare Tunnel.

#### Option A: Cloudflare Zero Trust dashboard

1. Open the **Cloudflare Zero Trust Dashboard** → **Networks** → **Tunnels**.
2. Select your tunnel and choose **Configure** → **Public Hostname** → **Add a public hostname**.
3. Set the hostname fields:
   - **Subdomain**: `actual-mcp` (or your chosen subdomain)
   - **Domain**: `yourdomain.com`
   - **Service Type**: `HTTP`
   - **URL**: `127.0.0.1:3000` (or `host.docker.internal:3000` if `cloudflared` runs inside Docker with host gateway mapping)
4. Save the hostname.

#### Option B: Local cloudflared configuration file

Add an ingress rule to `/etc/cloudflared/config.yml` before the catch-all `http_status:404` rule:

```yaml
ingress:
  - hostname: actual-mcp.yourdomain.com
    service: http://127.0.0.1:3000
  # ... your existing ingress rules ...
  - service: http_status:404
```

Create the DNS route and reload `cloudflared`:

```bash
cloudflared tunnel route dns <your-tunnel-name> actual-mcp.yourdomain.com
sudo systemctl restart cloudflared
```

> **Cloudflare WAF and Bot Fight Mode**: Google Gemini sends outbound MCP requests with `User-Agent: Google`. Ensure Cloudflare Bot Fight Mode or custom WAF rules on `actual-mcp.yourdomain.com` do not challenge (CAPTCHA or JavaScript challenges) requests to `/mcp`, `/authorize`, `/token`, `/revoke`, `/register`, or `/.well-known/*`.

To verify external OAuth discovery over HTTPS:

```bash
curl -s https://actual-mcp.yourdomain.com/.well-known/oauth-protected-resource | jq .
curl -s https://actual-mcp.yourdomain.com/.well-known/oauth-authorization-server | jq .
```

---

## Connect AI assistants

Once `https://actual-mcp.yourdomain.com` is accessible through your Cloudflare Tunnel:

1. Add the MCP server URL in your AI client (such as Claude Desktop, Cursor, or Google Gemini):
   - **MCP server URL**: `https://actual-mcp.yourdomain.com/mcp`
2. **Client registration**: Clients that support RFC 7591 Dynamic Client Registration (such as Google Gemini) register automatically. Clients connecting directly as public OAuth 2.1 PKCE clients do not require a pre-shared client ID or client secret.
3. **Authorization**:
   - The client discovers OAuth metadata and opens `https://actual-mcp.yourdomain.com/authorize` in your browser.
   - On the consent screen, enter your `OAUTH_ADMIN_PASSWORD` and select **Approve Access**.
4. The client completes the PKCE token exchange and receives an access token. Your AI client can now invoke Actual Budget tools.

---

## Local development and verification

Development requires Node.js 22.0.0 or later.

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

### Continuous integration

Automated GitHub Actions workflows run on every pull request and push to `main`:
- The CI pipeline ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs dependency installation (`npm ci`), TypeScript typecheck (`npm run typecheck`), the full Vitest test suite (`npm test`), and compilation (`npm run build`) on Node.js versions 22.x and 24.x.
- The container publishing pipeline ([`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)) builds and pushes multi-architecture (`linux/amd64`, `linux/arm64`) container images to GitHub Container Registry.

---

## Brand and logo assets

The official `actual-mcp` brand identity ("The Agent Spark") is located in [`docs/assets/logo/`](docs/assets/logo/):
- **Brand guidelines**: [`docs/assets/logo/BRAND-GUIDELINES.md`](docs/assets/logo/BRAND-GUIDELINES.md)
- **Vector and raster assets**: [`docs/assets/logo/dist/`](docs/assets/logo/dist/) (SVG masters, PNG ladders, PWA icons, favicon.ico)
- **Interactive presentation board**: [`docs/assets/logo/presentation.html`](docs/assets/logo/presentation.html)
