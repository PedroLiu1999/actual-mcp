import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import {
  createActualBudgetGateway,
  type ActualApiAdapter,
} from '../src/gateway/actualBudgetGateway.js';
import type { BudgetGateway, BudgetReadiness } from '../src/gateway/types.js';
import { issueBearerToken } from './helpers/auth.js';

function createStubGateway(overrides: Partial<BudgetGateway> = {}): BudgetGateway {
  const readiness: BudgetReadiness = {
    ready: true,
    syncId: '11111111-2222-3333-4444-555555555555',
    lastSyncedAt: '2026-11-04T17:00:00.000Z',
  };

  return {
    getReadiness: () => readiness,
    listAccounts: async () => [],
    ...overrides,
  };
}

let tempDataDir: string;
let testConfig: AppConfig;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-write-test-'));
  testConfig = loadConfig({
    PUBLIC_URL: 'https://mcp.example.com',
    PORT: '3000',
    DATA_DIR: tempDataDir,
    OAUTH_ADMIN_PASSWORD: 'admin-password',
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_PASSWORD: 'actual-password',
    ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
  });
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

describe('HTTP application seam — retired shallow transaction CRUD tools', () => {
  it('omits retired create_transactions, update_transaction, and delete_transaction tools from tools/list in favor of manage_transactions', async () => {
    const gateway = createStubGateway();
    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const listRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });

    expect(listRes.status).toBe(200);
    const tools = listRes.body.result.tools as Array<{ name: string }>;
    expect(tools.find((t) => t.name === 'manage_transactions')).toBeDefined();
    for (const retiredTool of [
      'create_transactions',
      'update_transaction',
      'delete_transaction',
    ]) {
      expect(tools.find((t) => t.name === retiredTool)).toBeUndefined();
    }
  });
});

describe('HTTP application seam — set_budget_amount tool', () => {
  it('exposes set_budget_amount with readOnlyHint: false and destructiveHint: false, requires at least one of budgeted or carryover, and returns { previous, updated } in Decimal Amounts', async () => {
    let capturedBudgetInput: unknown;
    const samplePrevious = {
      id: 'cat-groceries',
      name: 'Groceries',
      group_id: 'grp-living',
      is_income: false,
      hidden: false,
      budgeted: 500,
      spent: -320.5,
      balance: 179.5,
      carryover: false,
    };
    const sampleUpdated = {
      ...samplePrevious,
      budgeted: 650.25,
      balance: 329.75,
      carryover: true,
    };

    const gateway = createStubGateway({
      setBudgetAmount: async (input) => {
        capturedBudgetInput = input;
        return {
          month: input.month,
          categoryId: input.categoryId,
          previous: samplePrevious,
          updated: sampleUpdated,
        };
      },
    });

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const listRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/list',
        params: {},
      });

    expect(listRes.status).toBe(200);
    const tool = listRes.body.result.tools.find(
      (t: { name: string }) => t.name === 'set_budget_amount',
    );
    expect(tool).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const callRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'set_budget_amount',
          arguments: {
            month: '2026-11',
            categoryId: 'cat-groceries',
            budgeted: 650.25,
            carryover: true,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result.isError).toBeFalsy();
    expect(capturedBudgetInput).toEqual({
      month: '2026-11',
      categoryId: 'cat-groceries',
      budgeted: 650.25,
      carryover: true,
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      month: '2026-11',
      categoryId: 'cat-groceries',
      previous: samplePrevious,
      updated: sampleUpdated,
    });

    // Rejects calls missing both budgeted and carryover
    const missingBothRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: {
          name: 'set_budget_amount',
          arguments: {
            month: '2026-11',
            categoryId: 'cat-groceries',
          },
        },
      });

    expect(missingBothRes.status).toBe(200);
    expect(
      missingBothRes.body.error || missingBothRes.body.result?.isError,
    ).toBeTruthy();
  });
});

describe('BudgetGateway seam — createActualBudgetGateway createTransactions', () => {
  it('calls importTransactions when runRules is true (default), converts Decimal Amounts to Minor Unit Amounts, maps payeeName/payeeId/categoryId/importedId, and syncs before and after', async () => {
    const events: Array<{ step: string; args?: unknown }> = [];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {
        events.push({ step: 'sync' });
      },
      importTransactions: async (accountId, transactions) => {
        events.push({ step: 'importTransactions', args: { accountId, transactions } });
        return {
          added: ['tx-added-1', 'tx-added-2'],
          updated: ['tx-updated-1'],
          errors: [],
        };
      },
      addTransactions: async (accountId, transactions) => {
        events.push({ step: 'addTransactions', args: { accountId, transactions } });
        return 'ok';
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const result = await gateway.createTransactions({
      accountId: 'acc-checking',
      transactions: [
        {
          date: '2026-11-04',
          amount: -12.34,
          payeeName: 'Blue Bottle Coffee',
          categoryId: 'cat-coffee',
          notes: 'Oat latte',
          cleared: true,
          importedId: 'imp-001',
        },
        {
          date: '2026-11-05',
          amount: 100.5,
          payeeId: 'payee-employer',
          categoryId: 'cat-income',
          cleared: false,
        },
      ],
    });

    expect(result).toEqual({
      mode: 'import',
      added: ['tx-added-1', 'tx-added-2'],
      updated: ['tx-updated-1'],
      errors: [],
    });

    expect(events).toEqual([
      { step: 'sync' },
      {
        step: 'importTransactions',
        args: {
          accountId: 'acc-checking',
          transactions: [
            {
              account: 'acc-checking',
              date: '2026-11-04',
              amount: -1234,
              payee_name: 'Blue Bottle Coffee',
              category: 'cat-coffee',
              notes: 'Oat latte',
              cleared: true,
              imported_id: 'imp-001',
            },
            {
              account: 'acc-checking',
              date: '2026-11-05',
              amount: 10050,
              payee: 'payee-employer',
              category: 'cat-income',
              cleared: false,
            },
          ],
        },
      },
      { step: 'sync' },
    ]);
  });

  it('calls addTransactions when runRules is false and syncs before and after', async () => {
    const events: Array<{ step: string; args?: unknown }> = [];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {
        events.push({ step: 'sync' });
      },
      importTransactions: async () => {
        events.push({ step: 'importTransactions' });
        return { added: [], updated: [], errors: [] };
      },
      addTransactions: async (accountId, transactions) => {
        events.push({ step: 'addTransactions', args: { accountId, transactions } });
        return 'ok';
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const result = await gateway.createTransactions({
      accountId: 'acc-checking',
      runRules: false,
      transactions: [
        {
          date: '2026-11-04',
          amount: -5.0,
          payeeName: 'Local Cafe',
          categoryId: 'cat-coffee',
        },
      ],
    });

    expect(result).toEqual({
      mode: 'add',
      added: [],
      updated: [],
      errors: [],
    });

    expect(events).toEqual([
      { step: 'sync' },
      {
        step: 'addTransactions',
        args: {
          accountId: 'acc-checking',
          transactions: [
            {
              account: 'acc-checking',
              date: '2026-11-04',
              amount: -500,
              payee_name: 'Local Cafe',
              category: 'cat-coffee',
            },
          ],
        },
      },
      { step: 'sync' },
    ]);
  });
});

describe('BudgetGateway seam — createActualBudgetGateway updateTransaction', () => {
  it('looks up the existing transaction, converts Decimal Amount to Minor Unit Amount, calls updateTransaction, syncs before and after, and returns { previous, updated } in Decimal Amounts', async () => {
    const events: Array<{ step: string; args?: unknown }> = [];
    const storedTransactions = [
      {
        id: 'tx-100',
        account: 'acc-checking',
        date: '2026-11-01',
        amount: -4500,
        payee: 'payee-trader-joes',
        category: 'cat-groceries',
        notes: 'Initial note',
        cleared: false,
      },
    ];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [{ id: 'acc-checking', name: 'Main Checking' }],
      getAccountBalance: async () => 0,
      getCategories: async () => [
        { id: 'cat-groceries', name: 'Groceries', group_id: 'grp-1' },
        { id: 'cat-dining', name: 'Dining Out', group_id: 'grp-1' },
      ],
      getPayees: async () => [
        { id: 'payee-trader-joes', name: "Trader Joe's" },
        { id: 'payee-cafe', name: 'Corner Cafe' },
      ],
      getTransactions: async () => storedTransactions.map((tx) => ({ ...tx })),
      sync: async () => {
        events.push({ step: 'sync' });
      },
      updateTransaction: async (id, fields) => {
        events.push({ step: 'updateTransaction', args: { id, fields } });
        const idx = storedTransactions.findIndex((t) => t.id === id);
        if (idx >= 0) {
          storedTransactions[idx] = {
            ...storedTransactions[idx]!,
            ...(fields as Partial<(typeof storedTransactions)[number]>),
          };
        }
        return storedTransactions;
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const result = await gateway.updateTransaction({
      id: 'tx-100',
      date: '2026-11-02',
      amount: -52.25,
      payeeId: 'payee-cafe',
      categoryId: 'cat-dining',
      notes: 'Dinner with friends',
      cleared: true,
    });

    expect(result).toEqual({
      previous: {
        id: 'tx-100',
        account: 'acc-checking',
        accountId: 'acc-checking',
        accountName: 'Main Checking',
        date: '2026-11-01',
        amount: -45,
        payee: 'payee-trader-joes',
        payeeId: 'payee-trader-joes',
        payeeName: "Trader Joe's",
        category: 'cat-groceries',
        categoryId: 'cat-groceries',
        categoryName: 'Groceries',
        notes: 'Initial note',
        cleared: false,
      },
      updated: {
        id: 'tx-100',
        account: 'acc-checking',
        accountId: 'acc-checking',
        accountName: 'Main Checking',
        date: '2026-11-02',
        amount: -52.25,
        payee: 'payee-cafe',
        payeeId: 'payee-cafe',
        payeeName: 'Corner Cafe',
        category: 'cat-dining',
        categoryId: 'cat-dining',
        categoryName: 'Dining Out',
        notes: 'Dinner with friends',
        cleared: true,
      },
    });

    expect(events).toEqual([
      { step: 'sync' },
      {
        step: 'updateTransaction',
        args: {
          id: 'tx-100',
          fields: {
            date: '2026-11-02',
            amount: -5225,
            payee: 'payee-cafe',
            category: 'cat-dining',
            notes: 'Dinner with friends',
            cleared: true,
          },
        },
      },
      { step: 'sync' },
    ]);

    // Throws clear error if transaction ID does not exist
    await expect(
      gateway.updateTransaction({ id: 'tx-does-not-exist', amount: -10 }),
    ).rejects.toThrow(/Transaction not found.*tx-does-not-exist/i);
  });
});

describe('BudgetGateway seam — createActualBudgetGateway deleteTransaction', () => {
  it('looks up the target transaction by ID prior to deletion, calls deleteTransaction, syncs before and after, and returns { deleted } in Decimal Amounts', async () => {
    const events: Array<{ step: string; args?: unknown }> = [];
    const storedTransactions = [
      {
        id: 'tx-200',
        account: 'acc-credit',
        date: '2026-11-03',
        amount: -8999,
        payee: 'payee-amazon',
        category: 'cat-shopping',
        notes: 'USB-C hub',
        cleared: true,
      },
    ];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [{ id: 'acc-credit', name: 'Visa Card' }],
      getAccountBalance: async () => 0,
      getCategories: async () => [
        { id: 'cat-shopping', name: 'Shopping', group_id: 'grp-1' },
      ],
      getPayees: async () => [{ id: 'payee-amazon', name: 'Amazon' }],
      getTransactions: async () => storedTransactions.map((tx) => ({ ...tx })),
      sync: async () => {
        events.push({ step: 'sync' });
      },
      deleteTransaction: async (id) => {
        events.push({ step: 'deleteTransaction', args: { id } });
        const idx = storedTransactions.findIndex((t) => t.id === id);
        if (idx >= 0) {
          storedTransactions.splice(idx, 1);
        }
        return [];
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const result = await gateway.deleteTransaction('tx-200');

    expect(result).toEqual({
      deleted: {
        id: 'tx-200',
        account: 'acc-credit',
        accountId: 'acc-credit',
        accountName: 'Visa Card',
        date: '2026-11-03',
        amount: -89.99,
        payee: 'payee-amazon',
        payeeId: 'payee-amazon',
        payeeName: 'Amazon',
        category: 'cat-shopping',
        categoryId: 'cat-shopping',
        categoryName: 'Shopping',
        notes: 'USB-C hub',
        cleared: true,
      },
    });

    expect(events).toEqual([
      { step: 'sync' },
      { step: 'deleteTransaction', args: { id: 'tx-200' } },
      { step: 'sync' },
    ]);

    await expect(gateway.deleteTransaction('tx-200')).rejects.toThrow(
      /Transaction not found.*tx-200/i,
    );
  });
});

describe('BudgetGateway seam — createActualBudgetGateway setBudgetAmount', () => {
  it('captures previous monthly category state, converts budgeted Decimal Amount to Minor Unit Amount, calls setBudgetAmount and/or setBudgetCarryover, syncs before and after, and returns { previous, updated } in Decimal Amounts', async () => {
    const events: Array<{ step: string; args?: unknown }> = [];
    const categoryState = {
      id: 'cat-groceries',
      name: 'Groceries',
      group_id: 'grp-living',
      is_income: false,
      hidden: false,
      budgeted: 50000,
      spent: -32050,
      balance: 17950,
      carryover: false as boolean | number,
    };

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {
        events.push({ step: 'sync' });
      },
      getBudgetMonth: async (month) => {
        events.push({ step: 'getBudgetMonth', args: { month } });
        return {
          month,
          categoryGroups: [
            {
              id: 'grp-living',
              name: 'Living',
              is_income: false,
              hidden: false,
              budgeted: categoryState.budgeted,
              spent: categoryState.spent,
              balance: categoryState.balance,
              categories: [{ ...categoryState }],
            },
          ],
        };
      },
      setBudgetAmount: async (month, categoryId, value) => {
        events.push({ step: 'setBudgetAmount', args: { month, categoryId, value } });
        if (categoryId === categoryState.id) {
          categoryState.budgeted = value;
          categoryState.balance = value + categoryState.spent;
        }
      },
      setBudgetCarryover: async (month, categoryId, flag) => {
        events.push({ step: 'setBudgetCarryover', args: { month, categoryId, flag } });
        if (categoryId === categoryState.id) {
          categoryState.carryover = flag;
        }
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const result = await gateway.setBudgetAmount({
      month: '2026-11',
      categoryId: 'cat-groceries',
      budgeted: 650.25,
      carryover: true,
    });

    expect(result).toEqual({
      month: '2026-11',
      categoryId: 'cat-groceries',
      previous: {
        id: 'cat-groceries',
        name: 'Groceries',
        group_id: 'grp-living',
        is_income: false,
        hidden: false,
        budgeted: 500,
        spent: -320.5,
        balance: 179.5,
        carryover: false,
      },
      updated: {
        id: 'cat-groceries',
        name: 'Groceries',
        group_id: 'grp-living',
        is_income: false,
        hidden: false,
        budgeted: 650.25,
        spent: -320.5,
        balance: 329.75,
        carryover: true,
      },
    });

    expect(events).toEqual([
      { step: 'sync' },
      { step: 'getBudgetMonth', args: { month: '2026-11' } },
      {
        step: 'setBudgetAmount',
        args: { month: '2026-11', categoryId: 'cat-groceries', value: 65025 },
      },
      {
        step: 'setBudgetCarryover',
        args: { month: '2026-11', categoryId: 'cat-groceries', flag: true },
      },
      { step: 'getBudgetMonth', args: { month: '2026-11' } },
      { step: 'sync' },
    ]);

    // Supports updating carryover only without calling setBudgetAmount
    events.length = 0;
    const carryoverOnlyResult = await gateway.setBudgetAmount({
      month: '2026-11',
      categoryId: 'cat-groceries',
      carryover: false,
    });

    expect(carryoverOnlyResult.previous.carryover).toBe(true);
    expect(carryoverOnlyResult.updated.carryover).toBe(false);
    expect(events).toEqual([
      { step: 'sync' },
      { step: 'getBudgetMonth', args: { month: '2026-11' } },
      {
        step: 'setBudgetCarryover',
        args: { month: '2026-11', categoryId: 'cat-groceries', flag: false },
      },
      { step: 'getBudgetMonth', args: { month: '2026-11' } },
      { step: 'sync' },
    ]);

    // Throws clear error if category ID does not exist in the budget month
    await expect(
      gateway.setBudgetAmount({
        month: '2026-11',
        categoryId: 'cat-missing',
        budgeted: 100,
      }),
    ).rejects.toThrow(/Category not found.*cat-missing/i);
  });
});

