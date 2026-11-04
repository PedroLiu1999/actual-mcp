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

describe('BudgetGateway seam — createActualBudgetGateway listCategories', () => {
  it('returns category groups and their categories with normalized boolean flags', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => [
        {
          id: 'grp-income',
          name: 'Income',
          is_income: true,
          hidden: false,
          categories: [
            {
              id: 'cat-salary',
              name: 'Salary',
              group_id: 'grp-income',
              is_income: true,
              hidden: false,
            },
          ],
        },
        {
          id: 'grp-expenses',
          name: 'Usual Expenses',
          is_income: false,
          hidden: false,
          categories: [
            {
              id: 'cat-groceries',
              name: 'Groceries',
              group_id: 'grp-expenses',
              is_income: false,
              hidden: false,
            },
            {
              id: 'cat-old-sub',
              name: 'Old Subscription',
              group_id: 'grp-expenses',
              is_income: false,
              hidden: true,
            },
          ],
        },
      ],
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const groups = await gateway.listCategories();

    expect(groups).toEqual([
      {
        id: 'grp-income',
        name: 'Income',
        is_income: true,
        hidden: false,
        categories: [
          {
            id: 'cat-salary',
            name: 'Salary',
            group_id: 'grp-income',
            is_income: true,
            hidden: false,
          },
        ],
      },
      {
        id: 'grp-expenses',
        name: 'Usual Expenses',
        is_income: false,
        hidden: false,
        categories: [
          {
            id: 'cat-groceries',
            name: 'Groceries',
            group_id: 'grp-expenses',
            is_income: false,
            hidden: false,
          },
          {
            id: 'cat-old-sub',
            name: 'Old Subscription',
            group_id: 'grp-expenses',
            is_income: false,
            hidden: true,
          },
        ],
      },
    ]);
  });
});

describe('BudgetGateway seam — createActualBudgetGateway listPayees', () => {
  it('returns payees with id, name, and normalized transfer_acct', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getPayees: async () => [
        { id: 'payee-coffee', name: 'Blue Bottle Coffee' },
        { id: 'payee-transfer', name: 'Transfer : Savings', transfer_acct: 'acc-savings' },
      ],
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const payees = await gateway.listPayees();

    expect(payees).toEqual([
      {
        id: 'payee-coffee',
        name: 'Blue Bottle Coffee',
        transfer_acct: null,
      },
      {
        id: 'payee-transfer',
        name: 'Transfer : Savings',
        transfer_acct: 'acc-savings',
      },
    ]);
  });
});

describe('BudgetGateway seam — createActualBudgetGateway listBudgetMonths & getBudgetMonth', () => {
  it('returns the sorted list of available YYYY-MM Budget Months', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getBudgetMonths: async () => ['2026-11', '2026-09', '2026-10'],
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const months = await gateway.listBudgetMonths();
    expect(months).toEqual(['2026-09', '2026-10', '2026-11']);
  });

  it('converts all monthly envelope summary and per-category Minor Unit Amounts to Decimal Amounts in getBudgetMonth', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getBudgetMonth: async (month: string) => ({
        month,
        incomeAvailable: 525000,
        lastMonthOverspent: -1500,
        forNextMonth: 50000,
        totalBudgeted: -320050,
        toBudget: 153450,
        fromLastMonth: 25000,
        totalIncome: 500000,
        totalSpent: -184575,
        totalBalance: 135475,
        categoryGroups: [
          {
            id: 'grp-income',
            name: 'Income',
            is_income: true,
            hidden: false,
            received: 500000,
            categories: [
              {
                id: 'cat-paycheck',
                name: 'Paycheck',
                group_id: 'grp-income',
                is_income: true,
                hidden: false,
                received: 500000,
              },
            ],
          },
          {
            id: 'grp-living',
            name: 'Living Expenses',
            is_income: false,
            hidden: false,
            budgeted: 80000,
            spent: -54525,
            balance: 25475,
            categories: [
              {
                id: 'cat-groceries',
                name: 'Groceries',
                group_id: 'grp-living',
                is_income: false,
                hidden: false,
                budgeted: 60000,
                spent: -42025,
                balance: 17975,
                carryover: true,
              },
              {
                id: 'cat-dining',
                name: 'Dining Out',
                group_id: 'grp-living',
                is_income: false,
                hidden: false,
                budgeted: 20000,
                spent: -12500,
                balance: 7500,
                carryover: 0,
              },
            ],
          },
        ],
      }),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const summary = await gateway.getBudgetMonth('2026-11');

    expect(summary).toEqual({
      month: '2026-11',
      incomeAvailable: 5250,
      lastMonthOverspent: -15,
      forNextMonth: 500,
      totalBudgeted: -3200.5,
      toBudget: 1534.5,
      fromLastMonth: 250,
      totalIncome: 5000,
      totalSpent: -1845.75,
      totalBalance: 1354.75,
      categoryGroups: [
        {
          id: 'grp-income',
          name: 'Income',
          is_income: true,
          hidden: false,
          budgeted: 0,
          spent: 5000,
          balance: 0,
          received: 5000,
          categories: [
            {
              id: 'cat-paycheck',
              name: 'Paycheck',
              group_id: 'grp-income',
              is_income: true,
              hidden: false,
              budgeted: 0,
              spent: 5000,
              balance: 0,
              carryover: false,
              received: 5000,
            },
          ],
        },
        {
          id: 'grp-living',
          name: 'Living Expenses',
          is_income: false,
          hidden: false,
          budgeted: 800,
          spent: -545.25,
          balance: 254.75,
          categories: [
            {
              id: 'cat-groceries',
              name: 'Groceries',
              group_id: 'grp-living',
              is_income: false,
              hidden: false,
              budgeted: 600,
              spent: -420.25,
              balance: 179.75,
              carryover: true,
            },
            {
              id: 'cat-dining',
              name: 'Dining Out',
              group_id: 'grp-living',
              is_income: false,
              hidden: false,
              budgeted: 200,
              spent: -125,
              balance: 75,
              carryover: false,
            },
          ],
        },
      ],
      categories: [
        {
          id: 'cat-paycheck',
          name: 'Paycheck',
          group_id: 'grp-income',
          is_income: true,
          hidden: false,
          budgeted: 0,
          spent: 5000,
          balance: 0,
          carryover: false,
          received: 5000,
        },
        {
          id: 'cat-groceries',
          name: 'Groceries',
          group_id: 'grp-living',
          is_income: false,
          hidden: false,
          budgeted: 600,
          spent: -420.25,
          balance: 179.75,
          carryover: true,
        },
        {
          id: 'cat-dining',
          name: 'Dining Out',
          group_id: 'grp-living',
          is_income: false,
          hidden: false,
          budgeted: 200,
          spent: -125,
          balance: 75,
          carryover: false,
        },
      ],
    });
  });
});

describe('BudgetGateway seam — createActualBudgetGateway getTransactions', () => {
  const sampleAccounts = [
    { id: 'acc-checking', name: 'Main Checking', offbudget: false, closed: false },
    { id: 'acc-credit', name: 'Visa Card', offbudget: false, closed: false },
  ];
  const sampleCategories = [
    { id: 'cat-groceries', name: 'Groceries', group_id: 'grp-1', is_income: false, hidden: false },
    { id: 'cat-coffee', name: 'Coffee Shops', group_id: 'grp-1', is_income: false, hidden: false },
  ];
  const samplePayees = [
    { id: 'payee-trader-joes', name: "Trader Joe's", transfer_acct: null },
    { id: 'payee-blue-bottle', name: 'Blue Bottle Coffee', transfer_acct: null },
  ];
  const sampleRawTransactions = [
    {
      id: 'tx-1',
      account: 'acc-checking',
      date: '2026-11-01',
      amount: -8450,
      payee: 'payee-trader-joes',
      category: 'cat-groceries',
      notes: 'Weekly produce haul',
      cleared: true,
    },
    {
      id: 'tx-2',
      account: 'acc-credit',
      date: '2026-11-02',
      amount: -675,
      payee: 'payee-blue-bottle',
      category: 'cat-coffee',
      notes: 'Iced oat latte',
      cleared: false,
    },
    {
      id: 'tx-3',
      account: 'acc-checking',
      date: '2026-11-04',
      amount: -1230,
      payee: 'payee-trader-joes',
      category: 'cat-groceries',
      notes: 'Quick snack run',
      cleared: true,
    },
  ];

  it('enriches transactions with accountName, categoryName, and payeeName alongside IDs and converts Minor Unit Amounts to Decimal Amounts', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => sampleAccounts,
      getAccountBalance: async () => 0,
      getCategories: async () => sampleCategories,
      getPayees: async () => samplePayees,
      getTransactions: async () => sampleRawTransactions,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const transactions = await gateway.getTransactions();

    expect(transactions).toEqual([
      {
        id: 'tx-1',
        account: 'acc-checking',
        accountId: 'acc-checking',
        accountName: 'Main Checking',
        date: '2026-11-01',
        amount: -84.5,
        payee: 'payee-trader-joes',
        payeeId: 'payee-trader-joes',
        payeeName: "Trader Joe's",
        category: 'cat-groceries',
        categoryId: 'cat-groceries',
        categoryName: 'Groceries',
        notes: 'Weekly produce haul',
        cleared: true,
      },
      {
        id: 'tx-2',
        account: 'acc-credit',
        accountId: 'acc-credit',
        accountName: 'Visa Card',
        date: '2026-11-02',
        amount: -6.75,
        payee: 'payee-blue-bottle',
        payeeId: 'payee-blue-bottle',
        payeeName: 'Blue Bottle Coffee',
        category: 'cat-coffee',
        categoryId: 'cat-coffee',
        categoryName: 'Coffee Shops',
        notes: 'Iced oat latte',
        cleared: false,
      },
      {
        id: 'tx-3',
        account: 'acc-checking',
        accountId: 'acc-checking',
        accountName: 'Main Checking',
        date: '2026-11-04',
        amount: -12.3,
        payee: 'payee-trader-joes',
        payeeId: 'payee-trader-joes',
        payeeName: "Trader Joe's",
        category: 'cat-groceries',
        categoryId: 'cat-groceries',
        categoryName: 'Groceries',
        notes: 'Quick snack run',
        cleared: true,
      },
    ]);
  });

  it('filters transactions by accountId, startDate, endDate, categoryId, payeeId, case-insensitive searchText (payee name or notes), and limit', async () => {
    const getTransactionsCalls: Array<{
      accountId: string;
      startDate: string;
      endDate: string;
    }> = [];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => sampleAccounts,
      getAccountBalance: async () => 0,
      getCategories: async () => sampleCategories,
      getPayees: async () => samplePayees,
      getTransactions: async (accountId, startDate, endDate) => {
        getTransactionsCalls.push({ accountId, startDate, endDate });
        return sampleRawTransactions;
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // Filter by accountId + date range
    const byAccountAndDate = await gateway.getTransactions({
      accountId: 'acc-checking',
      startDate: '2026-11-02',
      endDate: '2026-11-05',
    });
    expect(getTransactionsCalls[0]).toEqual({
      accountId: 'acc-checking',
      startDate: '2026-11-02',
      endDate: '2026-11-05',
    });
    expect(byAccountAndDate.map((t) => t.id)).toEqual(['tx-3']);

    // Filter by categoryId
    const byCategory = await gateway.getTransactions({ categoryId: 'cat-coffee' });
    expect(byCategory.map((t) => t.id)).toEqual(['tx-2']);

    // Filter by payeeId
    const byPayee = await gateway.getTransactions({ payeeId: 'payee-trader-joes' });
    expect(byPayee.map((t) => t.id)).toEqual(['tx-1', 'tx-3']);

    // Filter by case-insensitive searchText matching payeeName
    const byPayeeSearch = await gateway.getTransactions({ searchText: 'BLUE BOTTLE' });
    expect(byPayeeSearch.map((t) => t.id)).toEqual(['tx-2']);

    // Filter by case-insensitive searchText matching notes
    const byNotesSearch = await gateway.getTransactions({ searchText: 'produce' });
    expect(byNotesSearch.map((t) => t.id)).toEqual(['tx-1']);

    // Filter with limit
    const limited = await gateway.getTransactions({ limit: 2 });
    expect(limited.map((t) => t.id)).toEqual(['tx-1', 'tx-2']);
  });
});




