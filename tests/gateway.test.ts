import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createActualBudgetGateway, type ActualApiAdapter } from '../src/gateway/actualBudgetGateway.js';

describe('BudgetGateway seam — Target Budget initialization and local Budget Cache', () => {
  it('creates the local Budget Cache directory, initializes @actual-app/api, opens the Target Budget via downloadBudget with encryption password, and updates readiness', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-gw-test-'));
    const budgetCacheDir = path.join(tmpRoot, 'nested', 'budget-cache');
    const calls: Array<{ step: string; args: unknown }> = [];

    const fakeApi: ActualApiAdapter = {
      init: async (config) => {
        calls.push({ step: 'init', args: { ...config, dirExists: fs.existsSync(budgetCacheDir) } });
      },
      downloadBudget: async (syncId, opts) => {
        calls.push({ step: 'downloadBudget', args: { syncId, opts } });
      },
      sync: async () => {
        calls.push({ step: 'sync', args: null });
      },
      shutdown: async () => {
        calls.push({ step: 'shutdown', args: null });
      },
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
    };

    try {
      const gateway = createActualBudgetGateway({
        dataDir: budgetCacheDir,
        serverURL: 'http://localhost:5006',
        password: 'server-password',
        syncId: '11111111-2222-3333-4444-555555555555',
        encryptionPassword: 'e2e-password',
        now: () => Date.parse('2026-11-04T18:00:00.000Z'),
        api: fakeApi,
      });

      expect(gateway.getReadiness()).toEqual({
        ready: false,
        syncId: '11111111-2222-3333-4444-555555555555',
        lastSyncedAt: null,
      });

      await gateway.initialize();

      expect(fs.existsSync(budgetCacheDir)).toBe(true);
      expect(calls).toEqual([
        {
          step: 'init',
          args: {
            dataDir: budgetCacheDir,
            serverURL: 'http://localhost:5006',
            password: 'server-password',
            dirExists: true,
          },
        },
        {
          step: 'downloadBudget',
          args: {
            syncId: '11111111-2222-3333-4444-555555555555',
            opts: { password: 'e2e-password' },
          },
        },
      ]);

      expect(gateway.getReadiness()).toEqual({
        ready: true,
        syncId: '11111111-2222-3333-4444-555555555555',
        lastSyncedAt: '2026-11-04T18:00:00.000Z',
      });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('calls api.shutdown() to clean up session if downloadBudget fails during initialization', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-gw-fail-'));
    const budgetCacheDir = path.join(tmpRoot, 'budget-cache');
    const calls: string[] = [];

    const fakeApi: ActualApiAdapter = {
      init: async () => {
        calls.push('init');
      },
      downloadBudget: async () => {
        calls.push('downloadBudget');
        throw new Error('Could not download budget: invalid encryption password');
      },
      shutdown: async () => {
        calls.push('shutdown');
      },
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
    };

    try {
      const gateway = createActualBudgetGateway({
        dataDir: budgetCacheDir,
        serverURL: 'http://localhost:5006',
        password: 'server-password',
        syncId: '11111111-2222-3333-4444-555555555555',
        api: fakeApi,
      });

      await expect(gateway.initialize()).rejects.toThrow('invalid encryption password');
      expect(calls).toEqual(['init', 'downloadBudget', 'shutdown']);
      expect(gateway.getReadiness().ready).toBe(false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('BudgetGateway seam — createActualBudgetGateway listAccounts', () => {
  it('returns accounts with normalized flags and Minor Unit Amount balances converted to Decimal Amounts', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [
        { id: 'acc-1', name: 'Checking', offbudget: false, closed: false },
        { id: 'acc-2', name: 'Credit Card', offbudget: false, closed: false },
        { id: 'acc-3', name: 'Brokerage' },
      ],
      getAccountBalance: async (id: string) => {
        const balances: Record<string, number> = {
          'acc-1': 245075,
          'acc-2': -1234,
          'acc-3': 0,
        };
        return balances[id] ?? 0;
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const accounts = await gateway.listAccounts();

    expect(accounts).toEqual([
      {
        id: 'acc-1',
        name: 'Checking',
        offbudget: false,
        closed: false,
        balance: 2450.75,
      },
      {
        id: 'acc-2',
        name: 'Credit Card',
        offbudget: false,
        closed: false,
        balance: -12.34,
      },
      {
        id: 'acc-3',
        name: 'Brokerage',
        offbudget: false,
        closed: false,
        balance: 0,
      },
    ]);
  });
});

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('BudgetGateway seam — FIFO mutex serialization', () => {
  it('serializes concurrent operations in strict FIFO order without overlapping and continues after a failure', async () => {
    const timeline: string[] = [];
    let activeCount = 0;
    let maxConcurrent = 0;

    const gate1 = createDeferred<void>();
    const gate2 = createDeferred<void>();

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => {
        activeCount += 1;
        maxConcurrent = Math.max(maxConcurrent, activeCount);
        timeline.push('listAccounts:start');
        await gate1.promise;
        timeline.push('listAccounts:end');
        activeCount -= 1;
        return [{ id: 'acc-1', name: 'Checking', offbudget: false, closed: false }];
      },
      getAccountBalance: async () => 10000,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const p1 = gateway.listAccounts();
    const p2 = gateway.executeRead(async () => {
      activeCount += 1;
      maxConcurrent = Math.max(maxConcurrent, activeCount);
      timeline.push('failingRead:start');
      await gate2.promise;
      timeline.push('failingRead:end');
      activeCount -= 1;
      throw new Error('simulated read failure');
    });
    const p3 = gateway.executeRead(async () => {
      activeCount += 1;
      maxConcurrent = Math.max(maxConcurrent, activeCount);
      timeline.push('finalRead:start');
      timeline.push('finalRead:end');
      activeCount -= 1;
      return 'done';
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(timeline).toEqual(['listAccounts:start']);

    gate1.resolve();
    const res1 = await p1;
    expect(res1).toEqual([
      { id: 'acc-1', name: 'Checking', offbudget: false, closed: false, balance: 100 },
    ]);

    await new Promise((r) => setTimeout(r, 10));
    expect(timeline).toEqual([
      'listAccounts:start',
      'listAccounts:end',
      'failingRead:start',
    ]);

    gate2.resolve();
    await expect(p2).rejects.toThrow('simulated read failure');
    const res3 = await p3;

    expect(res3).toBe('done');
    expect(maxConcurrent).toBe(1);
    expect(timeline).toEqual([
      'listAccounts:start',
      'listAccounts:end',
      'failingRead:start',
      'failingRead:end',
      'finalRead:start',
      'finalRead:end',
    ]);
  });
});

describe('BudgetGateway seam — Coalesced Sync on reads', () => {
  it('skips api.sync() on reads within SYNC_TTL_SECONDS and runs api.sync() when TTL expires or forceSync: true is passed', async () => {
    let currentTimeMs = Date.parse('2026-11-04T19:00:00.000Z');
    const events: string[] = [];
    let checkingBalanceMinor = 100000;

    const fakeApi: ActualApiAdapter = {
      init: async () => {
        events.push('init');
      },
      downloadBudget: async () => {
        events.push('downloadBudget');
      },
      sync: async () => {
        events.push('sync');
        // Simulate remote balance change pulled during sync
        checkingBalanceMinor += 25000;
      },
      getAccounts: async () => {
        events.push('getAccounts');
        return [{ id: 'acc-1', name: 'Checking', offbudget: false, closed: false }];
      },
      getAccountBalance: async () => checkingBalanceMinor,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      syncTtlSeconds: 30,
      now: () => currentTimeMs,
      api: fakeApi,
    });

    await gateway.initialize();
    expect(events).toEqual(['init', 'downloadBudget']);
    expect(gateway.getReadiness().lastSyncedAt).toBe('2026-11-04T19:00:00.000Z');

    // Read 10s later (within 30s TTL): must NOT call sync()
    currentTimeMs += 10_000;
    const firstRead = await gateway.listAccounts();
    expect(firstRead[0]?.balance).toBe(1000);
    expect(events).toEqual(['init', 'downloadBudget', 'getAccounts']);
    expect(gateway.getReadiness().lastSyncedAt).toBe('2026-11-04T19:00:00.000Z');

    // Read at exactly 30s (still within 30s TTL): must NOT call sync()
    currentTimeMs += 20_000;
    const secondRead = await gateway.listAccounts();
    expect(secondRead[0]?.balance).toBe(1000);
    expect(events).toEqual(['init', 'downloadBudget', 'getAccounts', 'getAccounts']);

    // Read at 30.001s (TTL exceeded): MUST call sync() before getAccounts and update lastSyncedAt
    currentTimeMs += 1;
    const thirdRead = await gateway.listAccounts();
    expect(thirdRead[0]?.balance).toBe(1250);
    expect(events).toEqual([
      'init',
      'downloadBudget',
      'getAccounts',
      'getAccounts',
      'sync',
      'getAccounts',
    ]);
    expect(gateway.getReadiness().lastSyncedAt).toBe('2026-11-04T19:00:30.001Z');

    // Read 5s later with forceSync: true (within new TTL, but forced): MUST call sync() before getAccounts
    currentTimeMs += 5_000;
    const forcedRead = await gateway.listAccounts({ forceSync: true });
    expect(forcedRead[0]?.balance).toBe(1500);
    expect(events).toEqual([
      'init',
      'downloadBudget',
      'getAccounts',
      'getAccounts',
      'sync',
      'getAccounts',
      'sync',
      'getAccounts',
    ]);
    expect(gateway.getReadiness().lastSyncedAt).toBe('2026-11-04T19:00:35.001Z');
  });
});

describe('BudgetGateway seam — pre/post sync on writes', () => {
  it('runs api.sync() before mutating, executes the mutation, and immediately awaits api.sync() and updates lastSyncedAt before resolving', async () => {
    let currentTimeMs = Date.parse('2026-11-04T20:00:00.000Z');
    const events: string[] = [];

    const fakeApi: ActualApiAdapter = {
      init: async () => {
        events.push('init');
      },
      downloadBudget: async () => {
        events.push('downloadBudget');
      },
      sync: async () => {
        currentTimeMs += 1_000;
        events.push(`sync@${new Date(currentTimeMs).toISOString()}`);
      },
      getAccounts: async () => {
        events.push('getAccounts');
        return [];
      },
      getAccountBalance: async () => 0,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      syncTtlSeconds: 30,
      now: () => currentTimeMs,
      api: fakeApi,
    });

    await gateway.initialize();
    expect(gateway.getReadiness().lastSyncedAt).toBe('2026-11-04T20:00:00.000Z');

    // Only 5 seconds after init (well within 30s read TTL), a write MUST still sync before AND after mutating
    currentTimeMs += 5_000;
    const writeResult = await gateway.executeWrite(async () => {
      events.push('mutation:execute');
      return { createdId: 'tx-123' };
    });

    expect(writeResult).toEqual({ createdId: 'tx-123' });
    expect(events).toEqual([
      'init',
      'downloadBudget',
      'sync@2026-11-04T20:00:06.000Z',
      'mutation:execute',
      'sync@2026-11-04T20:00:07.000Z',
    ]);
    expect(gateway.getReadiness().lastSyncedAt).toBe('2026-11-04T20:00:07.000Z');

    // A read 10s after the post-write sync skips sync() because lastSyncedAt was updated by the write
    currentTimeMs += 10_000;
    await gateway.listAccounts();
    expect(events).toEqual([
      'init',
      'downloadBudget',
      'sync@2026-11-04T20:00:06.000Z',
      'mutation:execute',
      'sync@2026-11-04T20:00:07.000Z',
      'getAccounts',
    ]);
  });
});

describe('BudgetGateway seam — graceful shutdown & signal draining', () => {
  it('waits for queued operations to finish, runs a final sync(), invokes api.shutdown(), and rejects new operations after shutdown starts', async () => {
    const events: string[] = [];
    const inFlightGate = createDeferred<void>();

    const fakeApi: ActualApiAdapter = {
      init: async () => {
        events.push('init');
      },
      downloadBudget: async () => {
        events.push('downloadBudget');
      },
      sync: async () => {
        events.push('sync');
      },
      shutdown: async () => {
        events.push('shutdown');
      },
      getAccounts: async () => {
        events.push('getAccounts:start');
        await inFlightGate.promise;
        events.push('getAccounts:end');
        return [{ id: 'acc-1', name: 'Checking', offbudget: false, closed: false }];
      },
      getAccountBalance: async () => 50000,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    await gateway.initialize();
    expect(gateway.getReadiness().ready).toBe(true);

    // Enqueue a read (blocks on inFlightGate) and a write behind it, then initiate shutdown()
    const pendingRead = gateway.listAccounts();
    const pendingWrite = gateway.executeWrite(async () => {
      events.push('write:mutate');
      return 'written';
    });

    const shutdownPromise1 = gateway.shutdown();
    const shutdownPromise2 = gateway.shutdown(); // idempotent second call

    // Operations enqueued after shutdown starts are rejected
    await expect(gateway.listAccounts()).rejects.toThrow(/shutting down|shut down/i);

    await new Promise((r) => setTimeout(r, 10));
    // Shutdown must NOT have run while pendingRead and pendingWrite are still in the queue
    expect(events).toEqual(['init', 'downloadBudget', 'getAccounts:start']);

    // Release the in-flight read; queued write and then shutdown should drain in order
    inFlightGate.resolve();

    const [accounts, writeOut] = await Promise.all([
      pendingRead,
      pendingWrite,
      shutdownPromise1,
      shutdownPromise2,
    ]);

    expect(accounts[0]?.balance).toBe(500);
    expect(writeOut).toBe('written');
    expect(gateway.getReadiness().ready).toBe(false);
    expect(events).toEqual([
      'init',
      'downloadBudget',
      'getAccounts:start',
      'getAccounts:end',
      'sync',
      'write:mutate',
      'sync',
      'sync',
      'shutdown',
    ]);
  });

  it('drains the mutex, runs final sync(), and calls api.shutdown() on SIGTERM and SIGINT signals', async () => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const events: string[] = [];
      const listeners = new Map<string, () => void>();
      const fakeSignalTarget = {
        once: (sig: string, listener: () => void) => {
          listeners.set(sig, listener);
        },
        off: (sig: string, listener: () => void) => {
          if (listeners.get(sig) === listener) {
            listeners.delete(sig);
          }
        },
      };

      const fakeApi: ActualApiAdapter = {
        init: async () => {
          events.push('init');
        },
        downloadBudget: async () => {
          events.push('downloadBudget');
        },
        sync: async () => {
          events.push('sync');
        },
        shutdown: async () => {
          events.push('shutdown');
        },
        getAccounts: async () => [],
        getAccountBalance: async () => 0,
      };

      const gateway = createActualBudgetGateway({
        syncId: '11111111-2222-3333-4444-555555555555',
        api: fakeApi,
        signalTarget: fakeSignalTarget,
      });

      await gateway.initialize();
      expect(listeners.has(signal)).toBe(true);

      // Emit the termination signal
      listeners.get(signal)?.();
      await gateway.shutdown();

      expect(events).toEqual(['init', 'downloadBudget', 'sync', 'shutdown']);
      expect(gateway.getReadiness().ready).toBe(false);
    }
  });
});
