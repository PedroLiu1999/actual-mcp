# 03: ActualBudgetGateway — Target Budget Cache, FIFO Mutex, Coalesced Sync & Shutdown

**What to build:** The concrete `ActualBudgetGateway` adapter that initializes `@actual-app/api` against the persistent local Budget Cache directory, opens the configured Target Budget by its Sync ID (with optional end-to-end encryption password), serializes all budget operations through a process-wide non-reentrant FIFO mutex, enforces Coalesced Sync on reads and immediate pre/post sync on writes, and drains/shuts down cleanly on termination signals.

**Blocked by:** 01: Walking Skeleton — Express App, Config, Healthcheck, Stateless MCP & list_accounts

**Status:** resolved

- [x] On initialization, ensures the local Budget Cache directory exists on disk, initializes `@actual-app/api` with `serverURL` and `password`, and opens the Target Budget via `downloadBudget(syncId, { password: encryptionPassword })`.
- [x] All operations on `ActualBudgetGateway` (reads, writes, explicit syncs, and shutdown) execute sequentially through a single process-wide non-reentrant FIFO mutex so concurrent callers never overlap.
- [x] Read operations implement Coalesced Sync: if the time since the last successful sync exceeds `SYNC_TTL_SECONDS` (default 30 seconds) or `forceSync: true` is passed, `sync()` runs before reading; otherwise, the cached state is read without a network round-trip.
- [x] Write operations run `sync()` before mutating, execute the mutation, and immediately `await sync()` and update the last-synced timestamp before resolving.
- [x] Graceful shutdown (`shutdown()` and `SIGTERM`/`SIGINT` handlers) waits for queued mutex operations to finish, runs a final `sync()`, and invokes `@actual-app/api`'s `shutdown()`.
- [x] Adapter seam tests verify FIFO mutex serialization under concurrent calls, Coalesced Sync TTL skipping vs refreshing, pre/post write syncing, and clean shutdown draining.
