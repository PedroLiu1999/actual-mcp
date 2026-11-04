# Actual Budget API (`@actual-app/api`) & Headless Operation Research

This document captures primary-source findings on `@actual-app/api` (version `26.11.0` as of current `master`), its internal architecture in `actualbudget/actual`, official documentation from `actualbudget/docs` (`actualbudget.org`), and patterns/pitfalls observed across open-source Actual Budget MCP servers.

---

## 1. Architecture & Headless Operation Overview

Actual Budget is a **local-first** application. Unlike traditional web services, the Actual Sync Server (`@actual-app/sync-server`, Docker image `actualbudget/actual-server` / `ghcr.io/actualbudget/actual`) does **not** expose REST endpoints for querying or modifying transactions, budgets, or categories ([`actualbudget/docs`: `docs/api/index.md`](https://github.com/actualbudget/docs/blob/master/docs/api/index.md), [`actualbudget.org/docs/api/`](https://actualbudget.org/docs/api/)). The sync server only stores encrypted or unencrypted budget zip snapshots and exchanges CRDT sync messages (`/sync`, `/account/login`, `/account/logout`, `/user-get-key`, etc.) ([`actualbudget/actual`: `packages/loot-core/src/server/sync/index.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/sync/index.ts), [`packages/loot-core/src/server/cloud-storage.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/cloud-storage.ts)).

Instead, `@actual-app/api` embeds the entire Actual core engine (`@actual-app/core` / `loot-core`) and runs it **in-process in Node.js** against a local SQLite database (`better-sqlite3`) and an in-memory spreadsheet calculation engine ([`actualbudget/actual`: `packages/api/package.json`](https://github.com/actualbudget/actual/blob/master/packages/api/package.json), [`packages/loot-core/src/server/main.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/main.ts)).

### Runtime & Native Dependencies (Headless Docker Considerations)
- **Node.js Engine Requirement**: `@actual-app/api` enforces `"node": ">=22"` in `package.json` and runs `validateNodeVersion()` at the start of `init()`, throwing an error if `process.versions.node` does not satisfy `>=22` ([`packages/api/package.json`](https://github.com/actualbudget/actual/blob/master/packages/api/package.json), [`packages/api/validateNodeVersion.ts`](https://github.com/actualbudget/actual/blob/master/packages/api/validateNodeVersion.ts)).
- **Native Addon (`better-sqlite3`)**: `@actual-app/api` depends on `"better-sqlite3": "^13.0.3"` ([`packages/api/package.json`](https://github.com/actualbudget/actual/blob/master/packages/api/package.json)).
  - In Alpine-based Docker images (`node:22-alpine` / `node:24-alpine`), building `better-sqlite3` from source during `npm ci` requires `python3`, `make`, and `g++` in the builder stage.
  - Because `better-sqlite3` is a native C++ addon compiled against a specific Node ABI (`NODE_MODULE_VERSION`), the runtime container must use the exact same Node major ABI and OS libc (musl vs. glibc) as the builder stage.
- **Writable `dataDir`**: `@actual-app/api` requires a writable directory on disk to store cached budget subdirectories (`metadata.json` and `db.sqlite`) ([`packages/loot-core/src/server/main.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/main.ts)). In Docker, mount a persistent volume (e.g., `/data`) or configure a dedicated directory so budget files do not have to be re-downloaded from scratch on every container restart.
- **Self-Signed HTTPS Certificates**: `@actual-app/api` uses `fetch` to talk to `serverURL`. When connecting to a self-hosted Actual server with a self-signed or custom CA certificate, Node.js requires `NODE_EXTRA_CA_CERTS=/path/to/cert.pem` (recommended) or `NODE_TLS_REJECT_UNAUTHORIZED=0` ([`actualbudget/docs`: `docs/api/index.md`](https://github.com/actualbudget/docs/blob/master/docs/api/index.md)).

---

## 2. Initialization, Authentication & Budget Lifecycle

### 2.1 `init(config)`

**Source**: [`packages/api/index.ts`](https://github.com/actualbudget/actual/blob/master/packages/api/index.ts), [`packages/loot-core/src/server/main.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/main.ts)

```ts
type BaseInitConfig = {
  dataDir?: string;
  verbose?: boolean;
};

type ServerInitConfig = BaseInitConfig & {
  serverURL: string;
};

type PasswordAuthConfig = ServerInitConfig & {
  password: string;
  sessionToken?: never;
};

type SessionTokenAuthConfig = ServerInitConfig & {
  sessionToken: string;
  password?: never;
};

type NoServerConfig = BaseInitConfig & {
  serverURL?: undefined;
  password?: never;
  sessionToken?: never;
};

export type InitConfig =
  | PasswordAuthConfig
  | SessionTokenAuthConfig
  | NoServerConfig;

export async function init(config: InitConfig = {}): Promise<typeof lib>;
```

**What `init(config)` does internally** ([`packages/loot-core/src/server/main.ts#L283-L355`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/main.ts#L283-L355)):
1. Calls `validateNodeVersion()` (requires Node `>=22`).
2. Reads `config.dataDir` and `config.serverURL` (or falls back to `process.env.ACTUAL_DATA_DIR` and `process.env.ACTUAL_SERVER_URL` only if `config` itself is falsy—note that because `packages/api/index.ts` defaults `config: InitConfig = {}`, `config` is always truthy when called via `api.init()`, so environment variables are **not** automatically read unless passed in `config`!).
3. **Important directory requirement**: Calls `fs._setDocumentDir(dataDir || process.cwd())`. As documented in `BaseInitConfig`, in Node `dataDir` **must already exist on disk** (`fs.mkdirSync(dataDir, { recursive: true })` before calling `init()`).
4. Initializes `asyncStorage.init({ persist: false })` — global key-value storage (`user-token`, `encrypt-keys`, `lastBudget`) is held **in memory only** for the duration of the API session.
5. Configures server and authentication:
   - **Password auth (`password`)**: Invokes `subscribe-sign-in` (`POST /account/login`), stores the returned token in in-memory `asyncStorage`, and sets `ownsSession = true` in `packages/api/index.ts`. Throws an error with `.code` (e.g., `'invalid-password'`, `'network-failure'`) on failure.
   - **Session token auth (`sessionToken`)**: Stores `config.sessionToken` via `subscribe-set-token` and validates it via `subscribe-get-user`. Throws `'token-expired'` or `'network-failure'` if invalid. Sets `ownsSession = false` so `shutdown()` will **not** revoke the caller-supplied token ([`packages/api/session.test.ts`](https://github.com/actualbudget/actual/blob/master/packages/api/session.test.ts)). Useful when Actual Server has OpenID/OAuth enforced and password login disabled.
   - **Offline mode (no `serverURL`)**: Calls `setServer(null)` and registers a listener on `'load-budget'` to set `setSyncingMode('offline')`.

### 2.2 Local Cache Files in `dataDir`

**Source**: [`packages/loot-core/src/server/budgetfiles/app.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/budgetfiles/app.ts), [`packages/loot-core/src/server/prefs.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/prefs.ts), [`packages/loot-core/src/platform/server/fs/shared.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/platform/server/fs/shared.ts)

Inside `dataDir`, each locally cached budget lives in its own subdirectory: `<dataDir>/<localBudgetId>/`:
- **`localBudgetId` (`id`)**: A slugified directory name derived from the budget name (e.g., `My-Budget-a1b2c3d`), restricted to `/^[A-Za-z0-9\-_]+$/` ([`packages/loot-core/src/platform/server/fs/shared.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/platform/server/fs/shared.ts)).
- **`metadata.json`**: Stores budget metadata preferences (`MetadataPrefs`), including:
  - `id`: The local directory name (forced to match the directory name on load).
  - `budgetName`: Human-readable name of the budget.
  - `cloudFileId`: The file UUID on the remote sync server.
  - `groupId`: The **Sync ID** UUID (shown in the Actual UI under *Settings → Show advanced settings → Sync ID*).
  - `encryptKeyId`: The UUID of the end-to-end encryption key (if encrypted).
  - `lastSyncedTimestamp`: The last CRDT clock timestamp synced with the server.
- **`db.sqlite`**: The SQLite database containing all budget tables (`transactions`, `accounts`, `categories`, `category_groups`, `payees`, `rules`, `schedules`, `messages_crdt`, `messages_clock`, `kvcache`, etc.).

### 2.3 Server Password vs. End-to-End Encryption Password

**Source**: [`packages/loot-core/src/server/main.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/main.ts), [`packages/loot-core/src/server/api.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts), [`packages/loot-core/src/server/encryption/app.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/encryption/app.ts)

Actual Budget has **two distinct passwords**:
1. **Server Password (`init({ password })`)**: Authenticates with the Actual Sync Server (`POST /account/login`) to obtain a `user-token` (`X-ACTUAL-TOKEN`). Required to list remote files, download budgets, or push/pull sync messages.
2. **Budget End-to-End Encryption Password (`downloadBudget(syncId, { password })`)**: Optional per-budget key used to encrypt/decrypt the budget zip file and CRDT sync messages on the client before they are sent to the server.
   - When `downloadBudget(syncId, { password })` runs on a budget where `activeFile.encryptKeyId` is set:
     - If `password` is omitted, it throws an error with code `'missing-key'` (`File <name> is encrypted. Please provide a password.`).
     - If `password` is provided, it calls `handlers['key-test']({ cloudFileId, password })` ([`packages/loot-core/src/server/encryption/app.ts#L51-L120`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/encryption/app.ts#L51-L120)), which fetches the salt and test payload from `POST /user-get-key`, derives the encryption key in memory, verifies decryption of the test payload, and loads the key into the in-memory `encryption` module and `asyncStorage` (`encrypt-keys`).
   - **Crucial Pitfall**: Because `init()` initializes `asyncStorage` with `{ persist: false }`, encryption keys are **not** persisted to disk across `init()` / `shutdown()` cycles. If a budget is end-to-end encrypted and you open it with `loadBudget(localId)` + `sync()` in a new process without calling `downloadBudget(syncId, { password })`, the encryption key will not be loaded in memory and `sync()` will fail with `decrypt-failure` / `missing-key`!

### 2.4 `downloadBudget(syncId, { password })` vs. `loadBudget(id)` + `sync()`

**Source**: [`packages/loot-core/src/server/api.ts#L194-L280`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L194-L280), [`packages/loot-core/src/server/budgetfiles/app.ts#L225-L290`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/budgetfiles/app.ts#L225-L290)

Despite its name, **`downloadBudget(syncId, { password })` is smart and does NOT re-download the budget if it is already cached locally in `dataDir`!**

Here is the exact execution flow of `handlers['api/download-budget']` ([`packages/loot-core/src/server/api.ts#L209-L280`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L209-L280)):
1. If a budget is currently open (`prefs.getPrefs()?.id`), it calls `close-budget`.
2. Calls `handlers['get-budgets']()` to scan `dataDir` for local budgets (`metadata.json`) and looks for a local budget where `b.groupId === syncId`.
3. **If `localBudget` is found in `dataDir`**:
   - It does **not** call `get-remote-files` or download the zip file.
   - If `localBudget.encryptKeyId` is present, it validates and loads the encryption key via `key-test`.
   - It calls `load-budget({ id: localBudget.id })` to open the local `db.sqlite` and initialize the in-memory spreadsheet.
   - It calls `sync-budget()` (`initialFullSync()`) to pull any new CRDT changes from the server and push local changes.
4. **If `localBudget` is NOT found in `dataDir`**:
   - Calls `get-remote-files()` to list files from the server and matches `f.groupId === syncId` (throws `'budget-not-found'` if missing, or `'network-failure'` if unreachable).
   - If `remoteBudget.encryptKeyId` is present, validates and loads the encryption key via `key-test`.
   - Downloads the base zip file via `handlers['download-budget']({ cloudFileId: remoteBudget.fileId })`, which unzips `db.sqlite` and `metadata.json` into `<dataDir>/<localId>`, loads the budget, runs `sync-budget()`, and returns.

**Comparison with `loadBudget(budgetId)`**:
- `loadBudget(budgetId)` takes the **local directory ID** (e.g., `'My-Budget-a1b2c3d'`, as returned in `BudgetFile.id` by `getBudgets()`), **not** the `syncId` (`groupId`)! (Note: the official docs at `reference.md` mistakenly label the parameter `syncId`, but `packages/api/methods.ts` and `budgetfiles/app.ts` show it is the local directory `id`: `fs.getBudgetDir(id)`).
- `loadBudget(budgetId)` only opens `<dataDir>/<budgetId>/db.sqlite` and loads the spreadsheet in memory; it does **not** load E2E encryption keys or run an initial sync.
- **Recommendation for MCP Servers**: Always use `downloadBudget(syncId, { password })` when connecting to a server-backed budget. It accepts the canonical `syncId` (`groupId`), handles E2E encryption keys, reuses the cached local SQLite file if present in `dataDir` (making subsequent startups fast), and performs an initial delta `sync()`. Use `loadBudget(id)` only for offline-only local budgets that have no remote server.

### 2.5 `sync()` and Background Auto-Sync Behavior

**Source**: [`packages/loot-core/src/server/api.ts#L288-L297`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L288-L297), [`packages/loot-core/src/server/sync/index.ts#L222-L345`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/sync/index.ts#L222-L345)

- **Explicit `api.sync()`**: Calls `handlers['sync-budget']()` -> `initialFullSync()` -> `fullSync()`. This sends all local CRDT messages since `lastSyncedTimestamp` (or 5 minutes ago if never synced) to `POST /sync`, receives remote CRDT messages, applies them inside a SQLite transaction, updates the Merkle trie clock, and waits for the spreadsheet to finish recomputing.
- **Automatic debounced sync on local mutations**: Whenever any mutating API method writes CRDT messages via `sendMessages()`, `_sendMessages()` applies the messages locally to SQLite and then calls `scheduleFullSync()` ([`packages/loot-core/src/server/sync/index.ts#L222-L231`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/sync/index.ts#L222-L231)). In production (`NODE_ENV !== 'test'`), `scheduleFullSync()` sets a **1000ms debounce timer** (`FULL_SYNC_DELAY = 1000`):
  ```ts
  syncTimeout = setTimeout(fullSync, FULL_SYNC_DELAY);
  ```
- **Deduplication of concurrent `fullSync()` calls**: `fullSync()` coalesces concurrent calls via `runningFullSync ??= runFullSync().finally(() => { runningFullSync = null; })` ([`packages/loot-core/src/server/sync/index.ts#L337-L345`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/sync/index.ts#L337-L345)).
- **When to call `api.sync()` in an MCP Server**:
  - **Before reads (or on a TTL, e.g., every 30–60s)**: Because external clients (e.g., the user's phone or browser UI) may have added or edited transactions on the sync server, the MCP server's local SQLite database will not see remote changes until `api.sync()` pulls them. Calling `api.sync()` on a short TTL (e.g., 60 seconds, as in `s-stefanov/actual-mcp`) or before read/write operations keeps the local cache fresh without hammering the sync server on every tool call.
  - **After writes**: Although mutations trigger a 1-second background `setTimeout(fullSync, 1000)`, calling `await api.sync()` explicitly after a write tool (or batch of writes) guarantees changes are pushed to the server before returning success to the MCP client, and surfaces any sync errors immediately.

### 2.6 `shutdown()`

**Source**: [`packages/api/index.ts#L25-L46`](https://github.com/actualbudget/actual/blob/master/packages/api/index.ts#L25-L46), [`packages/loot-core/src/server/budgetfiles/app.ts#L305-L340`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/budgetfiles/app.ts#L305-L340)

```ts
export async function shutdown() {
  if (internal) {
    try {
      await internal.send('sync');
    } catch {
      // most likely that no budget is loaded, so the sync failed
    }

    try {
      await internal.send('close-budget');
    } finally {
      try {
        if (ownsSession) {
          await internal.send('subscribe-sign-out');
        }
      } finally {
        ownsSession = false;
        internal = null;
      }
    }
  }
}
```
What happens during `shutdown()`:
1. Attempts a final `sync` (`handlers['sync']`—note: in `packages/api/index.ts`, `internal.send('sync')` actually invokes `handlers['sync']` if registered or fails silently in the `catch` block; therefore, calling `await api.sync()` explicitly before `await api.shutdown()` is safer if you want guaranteed sync error handling!).
2. Calls `close-budget`, which:
   - Waits 200ms+ in `flushRunningMethods()` for any running handlers to settle ([`packages/loot-core/src/server/mutators.ts#L20-L33`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/mutators.ts#L20-L33)).
   - Calls `stopFullSync()`, clearing `syncTimeout` and awaiting `runningFullSync` and `flushRunningMutators()`.
   - Waits for the in-memory spreadsheet (`sheet.waitOnSpreadsheet()`) and unloads it.
   - Closes the `better-sqlite3` database connection (`db.closeDatabase()`) and unloads `prefs`.
3. If `init()` authenticated with `password` (`ownsSession === true`), calls `subscribe-sign-out` (`POST /account/logout`) to revoke the session token on the server.
4. Resets `internal = null`.

---

## 3. Concurrency & Single-Instance Constraints in an MCP Server

Understanding `@actual-app/api`'s concurrency model is critical when building an HTTP or multi-tool MCP server where an LLM may fire parallel tool calls (`Promise.all` of multiple MCP `tools/call` requests) or where multiple HTTP requests arrive concurrently.

### 3.1 Process-Global Singleton State in `@actual-app/api`

`@actual-app/api` and `@actual-app/core` rely heavily on **module-level singletons**:
1. **`packages/api/index.ts`**: `export let internal: typeof lib | null = null;` and `let ownsSession = false;`.
2. **Active SQLite Connection (`packages/loot-core/src/server/db/index.ts`)**:
   - `let db: Database | null = null;` and `let dbPath: string | null = null;`.
   - Only **one** budget database can be open at a time in a Node.js process. Calling `openDatabase()` closes any previously open `db`.
3. **Active Budget Preferences (`packages/loot-core/src/server/prefs.ts`)**:
   - `let prefs: MetadataPrefs = null;`.
   - `checkFileOpen()` checks `if (!(prefs.getPrefs() || {}).id) throw APIError('No budget file is open')`.
4. **In-Memory Spreadsheet (`packages/loot-core/src/server/sheet.ts`)**:
   - Holds the computed budget cells (`available-funds`, `leftover-<catId>`, `budget-<catId>`, etc.) for the single open budget.
5. **CRDT Clock & Sync Batching (`packages/loot-core/src/server/sync/index.ts`)**:
   - `let IS_BATCHING = false;`, `let _BATCHED: Message[] = [];`, `let batchPromise = null;` (`api.ts`), and `let IMPORT_MODE = false;`.
6. **Async SQLite Transaction Depth (`packages/loot-core/src/platform/server/sqlite/index.electron.ts#L93-L116`)**:
   - `let transactionDepth = 0;` — The source comment explicitly warns:
     > `// **Important**: this is an unsafe function since sqlite executes statements sequentially. It would be easy for other code to run statements in between our transaction and get caught up in it.`

### 3.2 Built-in Serialization vs. Unprotected Operations

What does `loot-core` serialize internally, and what does it **not** serialize?
- **Mutators (`withMutation` / `runMutator`) ARE queued sequentially**:
  - In `packages/loot-core/src/server/api.ts`, write handlers (`api/budget-set-amount`, `api/transactions-import`, `api/transactions-add`, `api/transaction-update`, `api/transaction-delete`, `api/account-create`, `api/category-create`, etc.) are wrapped in `withMutation(...)`, which calls `runMutator(...)` ([`packages/loot-core/src/server/mutators.ts#L90-L103`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/mutators.ts#L90-L103)).
  - `runMutator` wraps `_runMutator` with `sequential(_runMutator)` ([`packages/loot-core/src/shared/async.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/shared/async.ts)) and `applyMessages` is also wrapped in `sequential(_applyMessages)`.
  - However, `currentContext` in `mutators.ts` is a module-global variable!
- **Lifecycle, Sync, Batch, and Read handlers are NOT wrapped in `withMutation`**:
  - `api.init()`, `api.shutdown()`, `api.downloadBudget()`, `api.loadBudget()`, `api.sync()`, `api.runBankSync()`, `api.batchBudgetUpdates()`, and all read handlers (`api.getTransactions()`, `api.getBudgetMonth()`, `api.aqlQuery()`, `api.getAccounts()`, etc.) are **not** wrapped in `withMutation`.
  - If a read (`getBudgetMonth`, `aqlQuery`) runs concurrently while `downloadBudget` or `sync()` or `batchBudgetUpdates` is in flight:
    - `downloadBudget` calls `close-budget` first, setting `prefs = null` and `db = null`. Any concurrent read or write immediately throws `APIError('No budget file is open')` or crashes with `TypeError: Cannot read properties of null (reading 'prepare')`.
    - `batchBudgetUpdates(func)` uses a single global `batchPromise` and `IS_BATCHING` flag (`api/batch-budget-start`). If two requests call `batchBudgetUpdates` concurrently, the second throws `APIError('Cannot start a batch process: batch already started')`, or interleaved mutations from another request get captured into the first request's `_BATCHED` array!
    - During `_applyMessages`, `sheet.get().startCacheBarrier()` is active while spreadsheet cells are recomputed. Interleaving `getBudgetMonth()` during spreadsheet recomputation or sync can read transitional state.

### 3.3 Recommended Concurrency Pattern for an MCP Server

Every production Actual MCP server (`s-stefanov/actual-mcp` in [`src/integrations/actual/connection.ts`](https://github.com/s-stefanov/actual-mcp/blob/main/src/integrations/actual/connection.ts) and `agigante80/actual-mcp-server` in [`src/lib/apiLock.ts`](https://github.com/agigante80/actual-mcp-server/blob/main/src/lib/apiLock.ts)) converges on the **exact same architectural requirement**:

1. **Process-Wide Non-Reentrant Async Mutex / FIFO Execution Queue**:
   - Wrap **all** interactions with `@actual-app/api` (`init`, `downloadBudget`, `sync`, `shutdown`, reads, writes, and `batchBudgetUpdates`) in a single process-wide promise queue / mutex:
     ```ts
     private enqueue<T>(operation: () => Promise<T>): Promise<T> {
       const result = this.queueTail.then(operation);
       this.queueTail = result.then(() => undefined, () => undefined);
       return result;
     }
     ```
   - **Watch out for reentrancy deadlocks**: Because a promise queue is non-reentrant, any helper function called *inside* a queued operation must call raw `api.*` methods directly rather than re-acquiring the queue lock (otherwise the inner call waits forever for the outer call to finish) ([`s-stefanov/actual-mcp`: `src/integrations/actual/connection.ts#L69-L77`](https://github.com/s-stefanov/actual-mcp/blob/main/src/integrations/actual/connection.ts#L69-L77), [`agigante80/actual-mcp-server`: `src/lib/apiLock.ts#L22-L27`](https://github.com/agigante80/actual-mcp-server/blob/main/src/lib/apiLock.ts#L22-L27)).
2. **Lazy / Shared Initialization with Cleanup on Failure**:
   - Initialize `@actual-app/api` once (either at server startup or lazily on first tool call) and keep the budget loaded in memory across requests.
   - If `api.init()` succeeds but `api.downloadBudget()` throws (e.g., wrong sync ID or encryption password), call `await api.shutdown()` in the `catch` block so native handles and sessions are cleaned up before the next retry ([`s-stefanov/actual-mcp`: `src/integrations/actual/connection.ts#L212-L225`](https://github.com/s-stefanov/actual-mcp/blob/main/src/integrations/actual/connection.ts#L212-L225)).
3. **Coalesced TTL Sync + Post-Write Sync**:
   - Maintain a `lastSyncAt` timestamp. Before running a queued operation, if `Date.now() - lastSyncAt > SYNC_TTL_MS` (e.g., 30–60s), enqueue `api.sync()` and update `lastSyncAt`. If `api.sync()` fails due to transient network error on a read, log a warning and serve from local SQLite rather than failing the read tool ([`s-stefanov/actual-mcp`: `src/integrations/actual/connection.ts#L130-L151`](https://github.com/s-stefanov/actual-mcp/blob/main/src/integrations/actual/connection.ts#L130-L151)).
   - After mutating operations, either rely on Actual's 1000ms background `scheduleFullSync()` or explicitly enqueue `await api.sync()` so remote state is immediately updated.
4. **Multi-Budget Switching (if supporting multiple budgets)**:
   - Because only one budget can be loaded at a time, switching budgets requires calling `downloadBudget(otherSyncId)` inside the mutex. If two concurrent MCP sessions alternate between two different budgets, strict FIFO causes budget-switch thrashing on every call; `agigante80/actual-mcp-server` solves this by preferring queued waiters that target the *currently loaded* `syncId` (up to `MAX_AFFINITY_SKIPS = 8` before forcing a switch) ([`agigante80/actual-mcp-server`: `src/lib/apiLock.ts#L29-L74`](https://github.com/agigante80/actual-mcp-server/blob/main/src/lib/apiLock.ts#L29-L74)). For a single-budget MCP server, a simple FIFO queue is optimal and completely eliminates budget switching.

---

## 4. Primitives: Amounts, Dates, Months & IDs

**Source**: [`actualbudget/docs`: `docs/api/types.js`](https://github.com/actualbudget/docs/blob/master/docs/api/types.js), [`packages/loot-core/src/shared/util.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/shared/util.ts), [`packages/loot-core/src/server/api.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts)

| Primitive | Type | Format / Representation | Source Notes |
| :--- | :--- | :--- | :--- |
| **`id`** | `string` | UUID (or slug for local `budgetId`) | All entities (`Account`, `Transaction`, `Category`, `CategoryGroup`, `Payee`, `Rule`, `Schedule`, `Tag`) use UUID strings. |
| **`amount`** | `integer` (`number`) | **Cents / minor units (2 implied decimals)** | An integer with the decimal point removed (`123.45` -> `12345`, `-$54.90` -> `-5490`). In `util.ts`: *"Always two implied decimals, whatever the currency: ¥1,500 is 150000."* Outflows/expenses are **negative** integers; inflows/income are **positive** integers. Safe range: `-(2^51 - 1)` to `2^51 - 1` (`MAX_SAFE_NUMBER`). |
| **`date`** | `string` | `'YYYY-MM-DD'` | Validated via `monthUtils.isValidYearMonthDay(value)`. Passing any other format throws `APIError('Invalid ..., use YYYY-MM-DD: ...')`. Note: inside SQLite, dates are stored as integer `YYYYMMDD` (converted via `toDateRepr` / `fromDateRepr`), but `@actual-app/api` and ActualQL automatically convert to/from `'YYYY-MM-DD'`. |
| **`month`** | `string` | `'YYYY-MM'` | Validated via `/^\d{4}-\d{2}$/` in `validateMonth(month)`. Must fall within existing budget bounds returned by `getBudgetMonths()`. |

### `utils.amountToInteger` & `utils.integerToAmount`

**Source**: [`packages/api/utils.ts`](https://github.com/actualbudget/actual/blob/master/packages/api/utils.ts), [`packages/loot-core/src/shared/util.ts#L536-L550`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/shared/util.ts#L536-L550)

```ts
export function amountToInteger(
  amount: number,
  decimalPlaces: number = 2,
): number {
  const multiplier = Math.pow(10, decimalPlaces);
  return Math.round(amount * multiplier);
}

export function integerToAmount(
  integerAmount: number,
  decimalPlaces: number = 2,
): number {
  const divisor = Math.pow(10, decimalPlaces);
  return integerAmount / divisor;
}
```
Both functions are re-exported on `@actual-app/api` under `api.utils.amountToInteger(amount)` and `api.utils.integerToAmount(integerAmount)`.

---

## 5. Complete `@actual-app/api` Method Surface & Signatures

**Primary Sources**:
- [`packages/api/index.ts`](https://github.com/actualbudget/actual/blob/master/packages/api/index.ts)
- [`packages/api/methods.ts`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts)
- [`packages/loot-core/src/server/api.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts)
- [`packages/loot-core/src/server/api-models.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api-models.ts)
- [`packages/loot-core/src/types/api-handlers.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/types/api-handlers.ts)
- [`actualbudget/docs`: `docs/api/reference.md`](https://github.com/actualbudget/docs/blob/master/docs/api/reference.md)

### 5.1 Lifecycle, Sync, Import/Export & Misc

| Method Signature | Return Type | Behavior & Caveats |
| :--- | :--- | :--- |
| `init(config?: InitConfig)` | `Promise<typeof lib>` | Validates Node `>=22`, sets `dataDir`, authenticates with `serverURL` (via `password` or `sessionToken`), and initializes `loot-core`. |
| `shutdown()` | `Promise<void>` | Attempts `sync`, closes open budget (`close-budget`), revokes session if `init` used `password`, and resets `internal = null`. |
| `sync()` | `Promise<void>` | Runs `initialFullSync()` to push/pull CRDT messages with the remote server and waits for spreadsheet recomputation. |
| `runBankSync(args?: { accountId: string })` | `Promise<{ newTransactions: string[]; matchedTransactions: string[]; updatedAccounts: string[] }>` | Runs third-party bank sync (GoCardless, SimpleFIN, etc.) for one `accountId` or all linked accounts when omitted. |
| `getBudgets()` | `Promise<APIFileEntity[]>` | Returns both locally cached budgets (have `id: string`, no `state`) and remote server files (have `state: 'remote'`, `cloudFileId: string`, `groupId: string`, `encryptKeyId?: string`, `hasKey: boolean`). |
| `downloadBudget(syncId: string, opts?: { password?: string })` | `Promise<void>` | Opens budget matching `groupId === syncId`. Uses local cache + `sync()` if already in `dataDir`; otherwise downloads from server. `opts.password` is the E2E encryption password. |
| `loadBudget(budgetId: string)` | `Promise<void>` | Opens a locally cached budget by its **local directory ID** (`BudgetFile.id`), without syncing. |
| `importBudget(input: string \| ArrayBuffer \| Uint8Array, opts?: { type?: ImportableBudgetType; filename?: string })` | `Promise<{ id: string }>` | Imports an Actual `.zip` export or YNAB4/YNAB5 export (`type?: 'actual' \| 'ynab4' \| 'ynab5'`), loads it, and returns its local `id`. |
| `exportBudget()` | `Promise<Uint8Array>` | Exports the currently loaded budget as a `.zip` byte buffer (`Uint8Array`), stripping `kvcache` tables first. |
| `runImport(budgetName: string, func: () => Promise<void>)` | `Promise<void>` | Creates a brand-new budget named `budgetName`, deletes default expense categories, disables sync/spreadsheet during `func()`, then reloads and uploads the budget. |
| `batchBudgetUpdates(func: () => Promise<void>)` | `Promise<void>` | Batches all CRDT messages generated inside `func()` into a single `_sendMessages` apply & spreadsheet pass. Cannot be nested or run concurrently. |
| `getIDByName(type: 'accounts' \| 'schedules' \| 'categories' \| 'payees', name: string)` | `Promise<string>` | Queries `q(type).filter({ name }).select('*')` and returns `data[0].id`. Throws `APIError('Not found: ...')` if not found. |
| `getServerVersion()` | `Promise<{ error?: 'no-server' \| 'network-failure'; version?: string }>` | Fetches `GET <serverURL>/info` and returns `{ version }`. |
| `getPreferences()` | `Promise<SyncedPrefs>` | Returns the open budget's synced preferences (number format, currency, date format, budget type, etc.). |
| `setPreference<T extends keyof SyncedPrefs>(id: T, value: SyncedPrefs[T] \| undefined)` | `Promise<void>` | Saves a synced preference key/value for the open budget. |

### 5.2 Budgets (Monthly Envelope / Tracking Budget Sheet)

**Source**: [`packages/api/methods.ts#L194-L216`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L194-L216), [`packages/loot-core/src/server/api.ts#L151-L281`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L151-L281)

- **`getBudgetMonths(): Promise<string[]>`**
  Returns an array of `'YYYY-MM'` strings covering the range of existing budget months (`start` to `end`).
- **`getBudgetMonth(month: string): Promise<BudgetMonth>`**
  Validates `month` (`'YYYY-MM'`, must exist in `getBudgetMonths()`) and returns computed spreadsheet values (all amounts are integer cents):
  ```ts
  {
    month: string;               // 'YYYY-MM'
    incomeAvailable: number;     // cell: 'available-funds'
    lastMonthOverspent: number;  // cell: 'last-month-overspent'
    forNextMonth: number;        // cell: 'buffered'
    totalBudgeted: number;       // cell: 'total-budgeted'
    toBudget: number;            // cell: 'to-budget'
    fromLastMonth: number;       // cell: 'from-last-month'
    totalIncome: number;         // cell: 'total-income'
    totalSpent: number;          // cell: 'total-spent'
    totalBalance: number;        // cell: 'total-leftover'
    categoryGroups: Array<{
      id: string;
      name: string;
      is_income: boolean;
      hidden: boolean;
      // For expense groups (and income groups in tracking budgets):
      budgeted?: number;
      spent?: number;            // present on expense groups
      received?: number;         // present on income groups
      balance?: number;
      categories: Array<{
        id: string;
        name: string;
        is_income: boolean;
        hidden: boolean;
        group_id: string;
        budgeted?: number;
        spent?: number;          // present on expense categories
        received?: number;       // present on income categories
        balance?: number;
        carryover?: boolean | number;
      }>;
    }>;
  }
  ```
- **`setBudgetAmount(month: string, categoryId: string, value: number): Promise<void>`**
  Sets the budgeted amount (in integer cents) for `categoryId` in `month` (`'YYYY-MM'`). Wrap multiple calls in `batchBudgetUpdates(async () => { ... })` for performance.
- **`setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void>`**
  Enables or disables overspending rollover (`carryover`) for an **expense** category starting in `month`. Throws `APIError` if `categoryId` is an income category.
- **`holdBudgetForNextMonth(month: string, amount: number): Promise<boolean>`**
  Holds `amount` (must be `> 0`, integer cents) of `month`'s available funds for next month.
- **`resetBudgetHold(month: string): Promise<void>`**
  Resets the amount held for next month in `month` to `0`.

### 5.3 Accounts & Account Groups

**Source**: [`packages/api/methods.ts#L275-L334`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L275-L334), [`packages/loot-core/src/server/api.ts#L388-L472`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L388-L472), [`packages/loot-core/src/server/api-models.ts#L16-L65`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api-models.ts#L16-L65)

```ts
export type APIAccountEntity = {
  id: string;
  name: string;
  offbudget?: boolean;          // defaults to false
  closed?: boolean;             // defaults to false
  balance_current?: number | null;
  account_group_id?: string | null;
};
```
*(Note: Official docs at `reference.md` mention an account `type` field like `'checking'`, `'savings'`, etc., but `api-models.ts` and `api.ts` show `accountModel.toExternal` and `api/account-create` only use `name`, `offbudget`, `closed`, `balance_current`, and `account_group_id`—`type` is ignored by `api/account-create`!)*

- **`getAccounts(): Promise<APIAccountEntity[]>`** — Retrieves all accounts.
- **`createAccount(account: Omit<APIAccountEntity, 'id'>, initialBalance?: number): Promise<string>`** — Creates an account and returns its `id`. `initialBalance` is in integer cents (internally `api.ts` converts it via `integerToAmount(initialBalance)` before passing to `handlers['account-create']`).
- **`updateAccount(id: string, fields: Partial<APIAccountEntity>): Promise<void>`** — Updates `name`, `offbudget`, `closed`, etc.
- **`closeAccount(id: string, transferAccountId?: string, transferCategoryId?: string): Promise<void>`** — Closes an account. If the account has a non-zero balance, `transferAccountId` is required; if transferring from an on-budget account to an off-budget account, `transferCategoryId` is also required.
- **`reopenAccount(id: string): Promise<void>`** — Reopens a closed account.
- **`deleteAccount(id: string): Promise<void>`** — Force-deletes (`forced: true`) an account.
- **`getAccountBalance(id: string, cutoff?: Date): Promise<number>`** — Returns the account balance (in integer cents) as of `cutoff` (defaults to `new Date()`).
- **`getAccountGroups(): Promise<APIAccountGroupEntity[]>`**, **`createAccountGroup(group: { name: string }): Promise<string>`**, **`updateAccountGroup(id: string, fields: { name?: string }): Promise<void>`**, **`deleteAccountGroup(id: string): Promise<void>`**.

### 5.4 Transactions

**Source**: [`packages/api/methods.ts#L218-L273`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L218-L273), [`packages/loot-core/src/server/api.ts#L298-L386`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L298-L386), [`packages/loot-core/src/types/models/transaction.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/types/models/transaction.ts), [`packages/loot-core/src/types/models/import-transaction.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/types/models/import-transaction.ts)

**Critical Naming & Field Pitfalls in Transactions**:
1. **`category` vs. `category_id` and `payee` vs. `payee_id`**:
   - Some prose in `docs/api/reference.md` (lines 251, 306, 384, 401) mistakenly writes `category_id` or `payee_id`.
   - **In the actual TypeScript models (`TransactionEntity`, `ImportTransactionEntity`) and ActualQL schema (`schema.transactions`), the fields are ALWAYS `category` and `payee` (and `payee_name` on create/import)!** Never pass `category_id` or `payee_id`—they will be silently ignored!
2. **`getTransactions(accountId, startDate, endDate)` signature**:
   ```ts
   export function getTransactions(
     accountId: string,
     startDate: string, // 'YYYY-MM-DD'
     endDate: string,   // 'YYYY-MM-DD'
   ): Promise<TransactionEntity[]>
   ```
   - Internally runs:
     ```ts
     aqlQuery(
       q('transactions')
         .filter({
           $and: [
             accountId && { account: accountId },
             startDate && { date: { $gte: startDate } },
             endDate && { date: { $lte: endDate } },
           ].filter(Boolean),
         })
         .select('*')
         .options({ splits: 'grouped' })
     )
     ```
   - Note that in TypeScript `accountId`, `startDate`, and `endDate` are typed as required `string`, though at runtime falsy values (`""` or `undefined`) are filtered out by `.filter(Boolean)`. Returned split transactions are in `'grouped'` format (parent has `is_parent: true` and `subtransactions: TransactionEntity[]`).
3. **`importTransactions` vs. `addTransactions`**:
   - **`importTransactions(accountId: string, transactions: ImportTransactionEntity[], opts?: ImportTransactionsOpts): Promise<ImportTransactionsResult>`**
     - `opts`: `{ defaultCleared?: boolean; dryRun?: boolean; reimportDeleted?: boolean; payeeNameNormalization?: PayeeNameNormalization }` (defaults to `{ defaultCleared: true, dryRun: false }`).
     - Returns `{ errors: unknown[]; added: string[]; updated: string[] }`.
     - **Runs transaction rules**, **creates/matches payees from `payee_name`**, **creates counterpart transfer transactions** if `payee` is a transfer payee, and **reconciles/deduplicates** against existing transactions (by `imported_id` or fuzzy date/amount/payee matching).
   - **`addTransactions(accountId: string, transactions: Omit<ImportTransactionEntity, 'account'>[], opts?: { learnCategories?: boolean; runTransfers?: boolean }): Promise<'ok'>`**
     - Inserts raw transactions without deduplication/reconciliation and without running pre/default rules.
     - **Discrepancy Note**: `docs/api/reference.md` claims `addTransactions` takes `(accountId, transactions, runTransfers, learnCategories)` as positional booleans and returns `Promise<id[]>`. In actual source (`packages/api/methods.ts#L218-L232` and `packages/loot-core/src/server/api.ts#L313-L325`), the 3rd argument is an **options object** `{ learnCategories?: boolean; runTransfers?: boolean }` and it returns `Promise<'ok'>`!
   - **Pitfall for MCP `create_transaction` tools**:
     - If an user asks an AI assistant to *"add two identical $5.00 coffee transactions today"*, `importTransactions` without unique `imported_id`s may deduplicate the second one as a duplicate of the first! Conversely, `addTransactions` does not run rules and returns `'ok'` instead of transaction IDs unless `importTransactions` is used. Setting a unique `imported_id` or using `addTransactions` (when raw creation is desired) vs `importTransactions` (when rule execution and ID return are desired) is an important design choice.
4. **`updateTransaction(id: string, fields: Partial<TransactionEntity>): Promise<TransactionEntity[]>`**
   - Fetches the transaction (with `splits: 'grouped'`), ungroups splits, merges `{ ...existing, ...fields }`, and applies `transactions-batch-update`.
   - **Split Transaction Pitfall**: As noted in `api.ts#L363`: `// fields is partial; updateTransaction replaces a split child wholesale`. Modifying split subtransactions requires care so subtransaction amounts still sum to the parent `amount`.
5. **`deleteTransaction(id: string): Promise<TransactionEntity[]>`**
   - Deletes the transaction by `id` and returns the array of deleted items.
6. **`mergeTransactions(ids: [string, string]): Promise<string>`**
   - Merges two transactions by their IDs and returns the surviving transaction ID.

### 5.5 Categories & Category Groups

**Source**: [`packages/api/methods.ts#L336-L378`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L336-L378), [`packages/loot-core/src/server/api-models.ts#L67-L125`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api-models.ts#L67-L125)

```ts
export type APICategoryEntity = {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  group_id: string;
};

export type APICategoryGroupEntity = {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  categories?: APICategoryEntity[];
};
```
- **`getCategories(options?: { hidden?: boolean }): Promise<APICategoryEntity[]>`**
- **`createCategory(category: Omit<APICategoryEntity, 'id'>): Promise<string>`** — Requires `name` and `group_id`. Returns new category `id`.
- **`updateCategory(id: string, fields: Partial<APICategoryEntity>): Promise<void>`**
- **`deleteCategory(id: string, transferCategoryId?: string): Promise<void>`** — Deletes category `id`, optionally reassigning existing transactions/budget amounts to `transferCategoryId`.
- **`getCategoryGroups(options?: { hidden?: boolean }): Promise<APICategoryGroupEntity[]>`** — Returns category groups with nested `categories: APICategoryEntity[]`.
- **`createCategoryGroup(group: Omit<APICategoryGroupEntity, 'id'>): Promise<string>`** — Returns new group `id`.
- **`updateCategoryGroup(id: string, fields: Partial<APICategoryGroupEntity>): Promise<void>`**
- **`deleteCategoryGroup(id: string, transferCategoryId?: string): Promise<void>`**

### 5.6 Payees & Tags

**Source**: [`packages/api/methods.ts#L388-L435`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L388-L435), [`packages/loot-core/src/server/api-models.ts#L127-L180`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api-models.ts#L127-L180)

```ts
export type APIPayeeEntity = {
  id: string;
  name: string;
  transfer_acct?: string; // Account ID if this payee represents a transfer to/from that account
};

export type APITagEntity = {
  id: string;
  tag: string;
  color?: string | null;
  description?: string | null;
};
```
*(Note: `docs/api/types.js` lists `category` on `payee`, but `payeeModel.toExternal` in `api-models.ts` only returns `{ id, name, transfer_acct }`!)*

- **`getPayees(): Promise<APIPayeeEntity[]>`** & **`getCommonPayees(): Promise<APIPayeeEntity[]>`**
- **`createPayee(payee: Omit<APIPayeeEntity, 'id'>): Promise<string>`** — Returns new payee `id`.
- **`updatePayee(id: string, fields: Partial<APIPayeeEntity>): Promise<void>`**
- **`deletePayee(id: string): Promise<void>`**
- **`mergePayees(targetId: string, mergeIds: string[]): Promise<void>`** — Merges `mergeIds` into `targetId`.
- **`getTags(): Promise<APITagEntity[]>`**, **`createTag(tag: Omit<APITagEntity, 'id'>): Promise<string>`**, **`updateTag(id: string, fields: Partial<Omit<APITagEntity, 'id'>>): Promise<void>`**, **`deleteTag(id: string): Promise<void>`**.
- **Notes**: **`getNote(id: string): Promise<NoteEntity | null>`**, **`updateNote(id: string, note: string): Promise<void>`** (where `id` is e.g. a category ID or `'budget-YYYY-MM'`).

### 5.7 Rules

**Source**: [`packages/api/methods.ts#L437-L455`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L437-L455), [`packages/loot-core/src/server/api.ts#L655-L692`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L655-L692), [`packages/loot-core/src/types/models/rule.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/types/models/rule.ts)

```ts
export type APIRuleEntity = {
  id: string;
  stage: 'pre' | 'default' | 'post' | null; // 'default' is mapped to null internally
  conditionsOp: 'and' | 'or';
  conditions: RuleConditionEntity[];
  actions: RuleActionEntity[];
  tombstone?: boolean;
};
```
- **`getRules(): Promise<RuleEntity[]>`**
- **`getPayeeRules(id: string): Promise<RuleEntity[]>`** — Returns rules associated with payee `id`.
- **`createRule(rule: Omit<APIRuleEntity, 'id'>): Promise<RuleEntity>`** — Creates and returns the rule with `id`.
- **`updateRule(rule: APIRuleEntity): Promise<RuleEntity>`**
  - **Major Doc vs. Source Discrepancy**: `docs/api/reference.md` claims `updateRule(id, fields)` takes two arguments. In actual source (`packages/api/methods.ts#L449` and `packages/loot-core/src/server/api.ts#L676`), **`updateRule(rule: APIRuleEntity)` takes a single complete `APIRuleEntity` object (which must include `id`, `stage`, `conditionsOp`, `conditions`, `actions`)!**
- **`deleteRule(id: string): Promise<boolean>`**

### 5.8 Schedules

**Source**: [`packages/api/methods.ts#L465-L494`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L465-L494), [`packages/loot-core/src/server/api.ts#L694-L855`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api.ts#L694-L855), [`packages/loot-core/src/server/api-models.ts#L213-L270`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/api-models.ts#L213-L270)

- **`getSchedules(): Promise<APIScheduleEntity[]>`**
- **`createSchedule(schedule: Omit<APIScheduleEntity, 'id'>): Promise<string>`**
- **`updateSchedule(id: string, fields: Partial<APIScheduleEntity>, resetNextDate?: boolean): Promise<string>`**
- **`deleteSchedule(scheduleId: string): Promise<void>`**
- **`getScheduleDates(date: string | RecurConfig, options?: { start?: string; end?: string; count?: number }): Promise<string[]>`** — Expands a schedule date or `RecurConfig` into upcoming `'YYYY-MM-DD'` occurrence strings.

---

## 6. ActualQL (`q()` and `aqlQuery()` / `runQuery()`)

**Primary Sources**:
- [`packages/api/methods.ts#L71-L192`](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts#L71-L192)
- [`packages/api/app/query.ts`](https://github.com/actualbudget/actual/blob/master/packages/api/app/query.ts)
- [`packages/loot-core/src/shared/query.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/shared/query.ts)
- [`packages/loot-core/src/server/aql/schema/index.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/aql/schema/index.ts)
- [`actualbudget/docs`: `docs/api/actual-ql/`](https://github.com/actualbudget/docs/tree/master/docs/api/actual-ql)

### 6.1 `aqlQuery` vs. `runQuery` (Deprecation Notice)
In `packages/api/methods.ts#L182-L192`:
```ts
/**
 * @deprecated Please use `aqlQuery` instead.
 * This function will be removed in a future release.
 */
export function runQuery(query: Query) {
  return send('api/query', { query: query.serialize() });
}

export function aqlQuery(query: Query) {
  return send('api/query', { query: query.serialize() });
}
```
- **Prefer `api.aqlQuery(query)`** in new code (though `api.runQuery(query)` is still exported and identical).
- Both functions return `Promise<{ data: unknown; dependencies: string[] }>`.

### 6.2 `Query` Builder Methods (`q(table)`)
Construct a query with `q(tableName)` (imported from `@actual-app/api`). Every builder method is **immutable** and returns a new `Query` instance ([`packages/loot-core/src/shared/query.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/shared/query.ts)):

| Method | Signature | Description |
| :--- | :--- | :--- |
| **`.filter(expr)`** | `filter(expr: ObjectExpression): Query` | Appends a filter expression (multiple `.filter()` calls are combined with `$and`). |
| **`.unfilter(keys?)`** | `unfilter(exprs?: string[]): Query` | Removes all filters if called with no args, or removes filters whose top-level key is in `exprs`. |
| **`.select(exprs)`** | `select(exprs?: '*' \| string \| ObjectExpression \| Array<string \| ObjectExpression>): Query` | Selects fields or named aggregate expressions (e.g., `.select(['id', 'date', 'amount', 'payee.name', { total: { $sum: '$amount' } }])`). Sets `calculation: false`, so `data` is an array of row objects. |
| **`.calculate(expr)`** | `calculate(expr: ObjectExpression \| string): Query` | Selects a single scalar aggregate (e.g., `.calculate({ $sum: '$amount' })` or `.calculate({ $count: '$id' })`). Sets `calculation: true`, so `data` is the **scalar value itself** (e.g., a number) rather than an array of objects. |
| **`.groupBy(exprs)`** | `groupBy(exprs: string \| ObjectExpression \| Array<string \| ObjectExpression>): Query` | Groups rows by one or more fields (e.g., `.groupBy('category.name')` or `.groupBy({ $month: '$date' })`). |
| **`.orderBy(exprs)`** | `orderBy(exprs: string \| ObjectExpression \| Array<string \| ObjectExpression>): Query` | Orders results, e.g., `.orderBy('date')` (defaults to `'asc'`) or `.orderBy({ date: 'desc' })` or `.orderBy([{ date: 'desc' }, 'amount'])`. |
| **`.limit(n)`** | `limit(num: number): Query` | Limits maximum rows returned. |
| **`.offset(n)`** | `offset(num: number): Query` | Skips `num` rows (for pagination). |
| **`.options(opts)`** | `options(opts: Record<string, unknown>): Query` | Table-specific options. For `transactions`: `{ splits: 'inline' \| 'grouped' \| 'all' }`. |
| **`.withDead()`** | `withDead(): Query` | Includes soft-deleted rows (`tombstone = 1`). By default, `tombstone = 0` rows only are returned. |
| **`.withoutValidatedRefs()`** | `withoutValidatedRefs(): Query` | Skips joining referenced tables to null out dead foreign keys. |
| **`.raw()`** | `raw(): Query` | Enables raw mode (disables automatic view joins/conversions). |

### 6.3 Queryable Tables & Joined Fields in ActualQL Schema

**Source**: [`packages/loot-core/src/server/aql/schema/index.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/aql/schema/index.ts)

- **`transactions`**:
  - Scalar fields: `id`, `is_parent` (boolean), `is_child` (boolean), `parent_id` (id), `account` (id -> ref `accounts`), `category` (id -> ref `categories`), `amount` (integer), `payee` (id -> ref `payees`), `notes` (string), `date` (date `'YYYY-MM-DD'`), `imported_id` (string), `error` (json), `imported_payee` (string), `starting_balance_flag` (boolean), `transfer_id` (id), `sort_order` (float), `cleared` (boolean), `reconciled` (boolean), `tombstone` (boolean), `schedule` (id -> ref `schedules`).
  - **Dot-path joins (automatic via `ref`)**:
    - `account.name`, `account.offbudget`, `account.closed`, `account.account_group_id`
    - `category.name`, `category.is_income`, `category.hidden`, `category.group` (`category.group.name`, `category.group.is_income`, `category.group.sort_order`)
    - `payee.name`, `payee.transfer_acct`
    - `schedule.name`, `schedule.next_date`, `schedule.completed`
  - **Split Transaction Options (`.options({ splits })`)**:
    - `'inline'` *(default)*: Excludes parent transactions (`is_parent = 1`) and returns normal transactions plus child split subtransactions as a flat list. **Always use `'inline'` when summing/aggregating transaction amounts** so parent + child amounts are not double-counted!
    - `'grouped'`: Returns parent transactions with a nested `subtransactions: TransactionEntity[]` array whenever either the parent or any child matches the filter.
    - `'all'`: Returns both parent and child transactions in a flat list.
- **`accounts`**: `id`, `name`, `offbudget`, `closed`, `sort_order`, `tombstone`, `account_id`, `official_name`, `account_sync_source`, `last_reconciled`, `last_sync`, `bank_sync_status`, `account_group_id` (ref `account_groups`).
- **`account_groups`**: `id`, `name`, `sort_order`, `tombstone`.
- **`categories`**: `id`, `name`, `is_income`, `hidden`, `group` (ref `category_groups` — note: in AQL `categories` schema the field is `group`, whereas in `APICategoryEntity` from `getCategories()` it is mapped to `group_id`!), `goal_def`, `template_settings`, `sort_order`, `tombstone`.
- **`category_groups`**: `id`, `name`, `is_income`, `hidden`, `sort_order`, `tombstone`.
- **`payees`**: `id`, `name`, `transfer_acct` (ref `accounts`), `favorite`, `learn_categories`, `tombstone`.
- **`schedules`**: `id`, `name`, `rule` (ref `rules`), `next_date`, `completed`, `posts_transaction`, `tombstone`, `_payee` (ref `payees`), `_account` (ref `accounts`), `_amount`, `_amountOp`, `_date`, `_conditions`, `_actions`, `_has_splits`.
- **`rules`**: `id`, `stage`, `conditions_op`, `conditions`, `actions`, `tombstone`.
- **`tags`**: `id`, `tag`, `color`, `description`.
- **`notes`**: `id`, `note`.
- **`preferences`**: `id`, `value`.

### 6.4 Filter Operators, Date Transforms & Aggregations
- **Comparison & Matching Operators**: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$oneof` (array of values), `$like` (SQL `%` wildcard, case-insensitive Unicode-aware), `$notlike`, `$regex`.
- **Boolean Combinators**: `$and: [ ... ]`, `$or: [ ... ]`.
- **Transform Functions**: `$month`, `$year`, `$day`, `$abs`, `$ lower`, `$neg`:
  ```ts
  // Filter transactions in month '2026-03'
  q('transactions')
    .filter({ date: { $transform: '$month', $eq: '2026-03' } })
    .select('*');
  ```
- **Aggregations**: `$sum`, `$count`, `$avg`, `$min`, `$max`:
  ```ts
  // Total spent per category in a date range
  const { data } = await api.aqlQuery(
    api.q('transactions')
      .filter({
        $and: [
          { date: { $gte: '2026-01-01' } },
          { date: { $lte: '2026-01-31' } },
          { amount: { $lt: 0 } },
          { 'account.offbudget': false },
          { 'payee.transfer_acct': null }, // Exclude budget-neutral transfers
        ],
      })
      .groupBy('category.name')
      .select(['category.name', { total: { $sum: '$amount' } }])
  );
  ```

---

## 7. Survey of Existing Open-Source Actual Budget MCP Servers

**Primary GitHub Sources**:
1. **[`s-stefanov/actual-mcp`](https://github.com/s-stefanov/actual-mcp)** (~280 stars)
2. **[`agigante80/actual-mcp-server`](https://github.com/agigante80/actual-mcp-server)** (~76 stars)
3. **[`henfrydls/actual-budget-mcp`](https://github.com/henfrydls/actual-budget-mcp)** (~20 stars)
4. **[`marcoaperez/actual-budget-mcp-es`](https://github.com/marcoaperez/actual-budget-mcp-es)** (~3 stars)
5. **[`type0labs-dev/actual-mcp`](https://github.com/type0labs-dev/actual-mcp)** (~2 stars)

### 7.1 Common Tool Shapes & Categorization
Across these implementations, MCP tools generally fall into 5 groups:
1. **Context / Orientation & Accounts**:
   - `get-accounts` / `list_accounts` (returns accounts with current balances and on-budget/off-budget flags).
   - `get-account-balance` / `balance-history`.
2. **Transactions**:
   - `get-transactions` (with richer filters than the raw SDK `getTransactions`: filtering by optional `accountId`, `startDate`, `endDate`, `categoryId`/`categoryName`, `payeeId`/`payeeName`, `minAmount`, `maxAmount`, `limit` via ActualQL).
   - `create-transaction` / `import-transactions` (accepting account, date, amount, payee name or ID, category ID, notes, cleared).
   - `update-transaction` & `delete-transaction`.
3. **Budgeting (Monthly Envelope Management)**:
   - `get-budget-months` & `get-budget-month` / `budget-vs-actual`.
   - `set-budget-amount`, `set-budget-carryover`, `hold-budget-for-next-month`, `reset-budget-hold`, and `transfer-budget` (moving budgeted funds between two categories in a month using `batchBudgetUpdates`).
4. **Classification & Automation (Categories, Payees, Rules, Schedules)**:
   - CRUD for categories & category groups (`get-grouped-categories`, `create-category`, `update-category`, `delete-category`).
   - CRUD + `merge-payees` for payees.
   - CRUD for rules & schedules.
5. **Analytics / Reporting & Raw ActualQL**:
   - Pre-built analytical tools (`spending-by-category`, `monthly-summary`, `spending-by-payee`, `cash-flow`, `net-worth`) or a read-only `run-query` (`aqlQuery`) tool.
   - **Why pre-built analytical tools matter**: `s-stefanov/actual-mcp` and `agigante80/actual-mcp-server` provide dedicated summary tools that return structured JSON with integer cents or formatted currency because LLMs frequently miscalculate sums or double-count transfers/off-budget accounts/split parents if given hundreds of raw transactions.

### 7.2 Key Pitfalls & Lessons Learned from Existing MCP Servers

1. **Tool Sprawl vs. LLM Context Limits**:
   - `agigante80/actual-mcp-server` exposes 85 tools by default, which overwhelms smaller chat clients or eats up context tokens. They had to introduce `MCP_TOOLSETS` (e.g., a 12-tool `chat` preset) and `MCP_READ_ONLY=true` ([`agigante80/actual-mcp-server`: `README.md`](https://github.com/agigante80/actual-mcp-server/blob/main/README.md)). Keeping the tool surface focused and composable (e.g., 15–25 high-leverage tools) is much more effective for LLM tool selection.
2. **Unit & Sign Confusion (Integer Cents vs. Decimal Currency)**:
   - LLMs naturally think in decimal currency (`$54.90`), whereas `@actual-app/api` strictly uses integer minor units (`-5490` for a `$54.90` expense).
   - **Mitigation**: Either clearly document in every tool's Zod parameter description and response payload whether amounts are in integer cents (`amountsIn: 'cents'`, negative = expense/outflow, positive = income/inflow) as `s-stefanov/actual-mcp` and `type0labs-dev/actual-mcp` do, OR convert decimal amounts via `api.utils.amountToInteger()` / `integerToAmount()` at the tool boundary (as `marcoaperez/actual-budget-mcp-es` does). Whichever convention is chosen, it must be 100% consistent across all tools and explicitly stated in schema descriptions.
3. **Transfers & Off-Budget Accounts Polluting Spending Analytics**:
   - In Actual Budget, a transfer between two on-budget accounts is stored as two transactions (one negative, one positive) whose payee has ` payee.transfer_acct != null`. Off-budget accounts (`account.offbudget == true`) also have transactions without categories.
   - When querying spending by category or monthly income/expenses via ActualQL, failing to filter out transfers (`'payee.transfer_acct': null`) and off-budget accounts (`'account.offbudget': false`) will wildly inflate income/expense totals.
4. **Destructive Actions & Safety Guardrails**:
   - `type0labs-dev/actual-mcp` and `marcoaperez/actual-budget-mcp-es` highlight that LLMs can accidentally delete categories, accounts, or rules if not guarded.
   - Setting MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) and supporting a `READ_ONLY` mode or requiring explicit confirmation parameters (`confirm: true` or `transferCategoryId` when deleting categories) prevents accidental data loss.
5. **Stdout Pollution in `stdio` Transport**:
   - `@actual-app/api` and `loot-core` occasionally write informational logs via `console.log` (especially when `verbose: true` or during sync/migrations). In MCP `stdio` mode, any non-JSON-RPC output to `stdout` corrupts the MCP protocol stream. Always pass `verbose: false` (or redirect `console.log` to `console.error` / `stderr` when running in `stdio` transport mode).
6. **Graceful Container Shutdown (`SIGTERM` / `SIGINT`)**:
   - In Docker, `node` as PID 1 does not default to forwarding signals like an init process, and if `api.shutdown()` is not awaited on `SIGTERM`/`SIGINT`, recent mutations inside the 1000ms `scheduleFullSync()` window may not be synced to the Actual server before the container exits. Use `tini` (or handle `SIGTERM`/`SIGINT` directly in Node) to drain the operation queue, call `await api.sync()`, and call `await api.shutdown()` before exiting ([`agigante80/actual-mcp-server`: `Dockerfile`](https://github.com/agigante80/actual-mcp-server/blob/main/Dockerfile), [`s-stefanov/actual-mcp`: `src/integrations/actual/connection.ts`](https://github.com/s-stefanov/actual-mcp/blob/main/src/integrations/actual/connection.ts)).
