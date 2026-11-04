# Actual MCP

An MCP server that exposes a self-hosted Actual Budget instance to Google Gemini over Streamable HTTP and OAuth 2.1.

## Language

### Budget & Sync

**Sync Server**:
The self-hosted Actual Budget server (`@actual-app/sync-server`) that stores encrypted or unencrypted budget sync envelopes and authenticates via the server password.
_Avoid_: Actual backend, API server

**Target Budget**:
The single Actual Budget file bound to this server instance, identified by its Sync ID.
_Avoid_: Workspace, profile, account

**Sync ID**:
The UUID shown in Actual Budget's advanced settings ("Sync ID") that uniquely identifies the Target Budget on the Sync Server and is passed to `downloadBudget()`.
_Avoid_: Budget ID, File ID, Group ID

**Budget Cache**:
The local directory on disk (`dataDir`) where `@actual-app/api` stores the downloaded SQLite database and metadata for the Target Budget across syncs.
_Avoid_: Local database, temp dir

**Coalesced Sync**:
A synchronization policy that skips `api.sync()` on read operations when the Budget Cache was synced within the configured TTL window, while always syncing before and after write operations.
_Avoid_: Background poll, auto-sync

**Budget Month**:
A monthly envelope allocation record (`YYYY-MM`) containing per-category budgeted amounts, spent amounts, carryover flags, and remaining balances.
_Avoid_: Monthly plan, budget period

### Money & Transactions

**Decimal Amount**:
A currency value expressed in standard major units at the MCP tool boundary (e.g., `-12.34` for a $12.34 expense, `100.00` for a $100.00 inflow).
_Avoid_: Float amount, dollar amount

**Minor Unit Amount**:
An integer currency value in cents/minor units used internally by `@actual-app/api` (e.g., `-1234` for `-12.34`), converted to and from Decimal Amounts at the MCP boundary.
_Avoid_: Cents, milliunits, raw amount

**Outflow / Inflow**:
The sign convention for transactions: negative values represent money leaving an account (Outflow / expense), and positive values represent money entering an account (Inflow / income).
_Avoid_: Debit / credit

**Spending Summary**:
An ActualQL aggregation over budget transactions that excludes internal account transfers and off-budget accounts, with split transactions inlined so parent and child splits are never double-counted.
_Avoid_: Expense report, transaction total

**Structured AQL Query**:
A Zod-validated JSON representation of an ActualQL query (`table`, `filter`, `select`, `groupBy`, `orderBy`, `limit`, `offset`, `splits`) translated safely into `@actual-app/api`'s `q()` builder and executed via `aqlQuery()`.
_Avoid_: Raw SQL, query string

### Access & Transport

**Embedded OAuth Server**:
The built-in single-tenant OAuth 2.1 Authorization and Resource Server running inside `actual-mcp` that authenticates the Gemini Connector using a pre-configured Client ID, Client Secret, and consent passphrase.
_Avoid_: External IdP, OAuth proxy

**Token Store**:
The persistent JSON file (`/data/oauth-tokens.json`) inside the container's data volume that stores issued access tokens and non-rotating refresh tokens across container restarts.
_Avoid_: Session store, auth DB
