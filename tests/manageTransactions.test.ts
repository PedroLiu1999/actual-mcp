import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import {
  createActualBudgetGateway,
  type ActualApiAdapter,
} from '../src/gateway/actualBudgetGateway.js';
import { EntityResolutionError } from '../src/gateway/resolver.js';
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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-manage-tx-test-'));
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

describe('manage_transactions Deep Resource Facade', () => {
  describe('HTTP MCP seam — tool registration & action: create', () => {
    it('exposes manage_transactions with readOnlyHint: false and destructiveHint: true, defaults runRules to true, and enforces 1..50 batch size on create', async () => {
      let capturedInput: unknown;
      const gateway = createStubGateway({
        manageTransactions: async (input) => {
          capturedInput = input;
          return {
            success: true,
            message: 'Created 1 transaction in Main Checking',
            data: {
              accountId: '88888888-8888-4888-8888-888888888888',
              mode: 'import',
              added: ['tx-new-1'],
              updated: [],
              errors: [],
            },
            resolved: {
              'Main Checking': '88888888-8888-4888-8888-888888888888',
              'Coffee Shops': '33333333-3333-4333-8333-333333333333',
            },
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
          id: 1,
          method: 'tools/list',
          params: {},
        });

      expect(listRes.status).toBe(200);
      const tool = listRes.body.result.tools.find(
        (t: { name: string }) => t.name === 'manage_transactions',
      );
      expect(tool).toBeDefined();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });

      const callRes = await request(app)
        .post('/mcp')
        .set('Host', 'mcp.example.com')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'manage_transactions',
            arguments: {
              action: 'create',
              account: 'Main Checking',
              transactions: [
                {
                  date: '2026-11-04',
                  amount: -12.34,
                  payee: 'Blue Bottle Coffee',
                  category: 'Coffee Shops',
                  notes: 'Morning espresso',
                  cleared: true,
                  importedId: 'imp-1',
                },
              ],
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result.isError).toBeFalsy();
      expect(capturedInput).toEqual({
        action: 'create',
        account: 'Main Checking',
        runRules: true,
        transactions: [
          {
            date: '2026-11-04',
            amount: -12.34,
            payee: 'Blue Bottle Coffee',
            category: 'Coffee Shops',
            notes: 'Morning espresso',
            cleared: true,
            importedId: 'imp-1',
          },
        ],
      });

      const parsed = JSON.parse(callRes.body.result.content[0].text);
      expect(parsed).toEqual({
        success: true,
        message: 'Created 1 transaction in Main Checking',
        data: {
          accountId: '88888888-8888-4888-8888-888888888888',
          mode: 'import',
          added: ['tx-new-1'],
          updated: [],
          errors: [],
        },
        resolved: {
          'Main Checking': '88888888-8888-4888-8888-888888888888',
          'Coffee Shops': '33333333-3333-4333-8333-333333333333',
        },
      });

      // Rejects batches larger than 50 transactions
      const oversizedBatch = Array.from({ length: 51 }, (_, idx) => ({
        date: '2026-11-04',
        amount: -(idx + 1),
        payee: `Payee ${idx}`,
      }));

      const overLimitRes = await request(app)
        .post('/mcp')
        .set('Host', 'mcp.example.com')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'manage_transactions',
            arguments: {
              action: 'create',
              account: 'Main Checking',
              transactions: oversizedBatch,
            },
          },
        });

      expect(overLimitRes.status).toBe(200);
      expect(
        overLimitRes.body.error || overLimitRes.body.result?.isError,
      ).toBeTruthy();
    });
  });

  describe('BudgetGateway seam — action: create', () => {
    it('resolves account, category, and payee names in-process against the Budget Cache, converts Decimal Amounts to Minor Unit Amounts, and returns standardized envelope', async () => {
      const events: Array<{ step: string; args?: unknown }> = [];

      const fakeApi: ActualApiAdapter = {
        getAccounts: async () => [
          {
            id: '88888888-8888-4888-8888-888888888888',
            name: 'Main Checking',
            offbudget: false,
            closed: false,
          },
        ],
        getAccountBalance: async () => 250000,
        getCategoryGroups: async () => [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Frequent Spending',
            categories: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                name: 'Coffee Shops',
                group_id: '11111111-1111-4111-8111-111111111111',
              },
              {
                id: '22222222-2222-4222-8222-222222222222',
                name: 'Groceries',
                group_id: '11111111-1111-4111-8111-111111111111',
              },
            ],
          },
        ],
        getPayees: async () => [
          {
            id: '66666666-6666-4666-8666-666666666666',
            name: 'Starbucks',
            transfer_acct: null,
          },
        ],
        sync: async () => {
          events.push({ step: 'sync' });
        },
        importTransactions: async (accountId, transactions) => {
          events.push({ step: 'importTransactions', args: { accountId, transactions } });
          return {
            added: ['tx-added-1', 'tx-added-2'],
            updated: [],
            errors: [],
          };
        },
      };

      const gateway = createActualBudgetGateway({
        syncId: '11111111-2222-3333-4444-555555555555',
        api: fakeApi,
      });

      const result = await gateway.manageTransactions({
        action: 'create',
        account: 'main checking',
        transactions: [
          {
            date: '2026-11-04',
            amount: -6.5,
            payee: 'starbucks',
            category: 'coffee shops',
            notes: 'Iced Americano',
            cleared: true,
            importedId: 'imp-101',
          },
          {
            date: '2026-11-05',
            amount: -42.1,
            payeeName: 'New Local Bakery',
            category: 'Groceries',
            cleared: false,
          },
        ],
      });

      expect(result).toEqual({
        success: true,
        message: 'Created 2 transactions in account "88888888-8888-4888-8888-888888888888".',
        data: {
          accountId: '88888888-8888-4888-8888-888888888888',
          mode: 'import',
          added: ['tx-added-1', 'tx-added-2'],
          updated: [],
          errors: [],
        },
        resolved: {
          'main checking': '88888888-8888-4888-8888-888888888888',
          starbucks: '66666666-6666-4666-8666-666666666666',
          'coffee shops': '33333333-3333-4333-8333-333333333333',
          Groceries: '22222222-2222-4222-8222-222222222222',
        },
      });

      expect(events).toEqual([
        { step: 'sync' },
        {
          step: 'importTransactions',
          args: {
            accountId: '88888888-8888-4888-8888-888888888888',
            transactions: [
              {
                account: '88888888-8888-4888-8888-888888888888',
                date: '2026-11-04',
                amount: -650,
                payee: '66666666-6666-4666-8666-666666666666',
                category: '33333333-3333-4333-8333-333333333333',
                notes: 'Iced Americano',
                cleared: true,
                imported_id: 'imp-101',
              },
              {
                account: '88888888-8888-4888-8888-888888888888',
                date: '2026-11-05',
                amount: -4210,
                payee_name: 'New Local Bakery',
                category: '22222222-2222-4222-8222-222222222222',
                cleared: false,
              },
            ],
          },
        },
        { step: 'sync' },
      ]);
    });
  });

  describe('BudgetGateway seam — action: update (single & auto-create payee)', () => {
    it('resolves category and existing payee names to UUIDs, auto-creates missing payees via createPayee, and returns updated records in Decimal Amounts', async () => {
      const events: Array<{ step: string; args?: unknown }> = [];
      const storedPayees = [
        { id: '66666666-6666-4666-8666-666666666666', name: 'Starbucks' },
      ];
      const storedTransactions = [
        {
          id: 'tx-100',
          account: '88888888-8888-4888-8888-888888888888',
          date: '2026-11-01',
          amount: -4500,
          payee: '66666666-6666-4666-8666-666666666666',
          category: '22222222-2222-4222-8222-222222222222',
          notes: 'Initial note',
          cleared: false,
        },
      ];

      const fakeApi: ActualApiAdapter = {
        getAccounts: async () => [
          { id: '88888888-8888-4888-8888-888888888888', name: 'Main Checking' },
        ],
        getAccountBalance: async () => 0,
        getCategories: async () => [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Groceries',
            group_id: 'grp-1',
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Coffee Shops',
            group_id: 'grp-1',
          },
        ],
        getPayees: async () => storedPayees.map((p) => ({ ...p })),
        getTransactions: async () => storedTransactions.map((tx) => ({ ...tx })),
        createPayee: async ({ name }) => {
          events.push({ step: 'createPayee', args: { name } });
          const created = {
            id: '77777777-7777-4777-8777-777777777777',
            name,
          };
          storedPayees.push(created);
          return created.id;
        },
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

      const result = await gateway.manageTransactions({
        action: 'update',
        id: 'tx-100',
        date: '2026-11-02',
        amount: -7.25,
        payee: 'Blue Bottle Coffee',
        category: 'coffee shops',
        notes: 'Afternoon cortado',
        cleared: true,
      });

      expect(result).toEqual({
        success: true,
        message: 'Updated 1 transaction.',
        data: {
          updated: [
            {
              id: 'tx-100',
              account: '88888888-8888-4888-8888-888888888888',
              accountId: '88888888-8888-4888-8888-888888888888',
              accountName: 'Main Checking',
              date: '2026-11-02',
              amount: -7.25,
              payee: '77777777-7777-4777-8777-777777777777',
              payeeId: '77777777-7777-4777-8777-777777777777',
              payeeName: 'Blue Bottle Coffee',
              category: '33333333-3333-4333-8333-333333333333',
              categoryId: '33333333-3333-4333-8333-333333333333',
              categoryName: 'Coffee Shops',
              notes: 'Afternoon cortado',
              cleared: true,
            },
          ],
          previous: [
            {
              id: 'tx-100',
              account: '88888888-8888-4888-8888-888888888888',
              accountId: '88888888-8888-4888-8888-888888888888',
              accountName: 'Main Checking',
              date: '2026-11-01',
              amount: -45,
              payee: '66666666-6666-4666-8666-666666666666',
              payeeId: '66666666-6666-4666-8666-666666666666',
              payeeName: 'Starbucks',
              category: '22222222-2222-4222-8222-222222222222',
              categoryId: '22222222-2222-4222-8222-222222222222',
              categoryName: 'Groceries',
              notes: 'Initial note',
              cleared: false,
            },
          ],
        },
        resolved: {
          'Blue Bottle Coffee': '77777777-7777-4777-8777-777777777777',
          'coffee shops': '33333333-3333-4333-8333-333333333333',
        },
      });

      expect(events).toEqual([
        { step: 'sync' },
        { step: 'createPayee', args: { name: 'Blue Bottle Coffee' } },
        {
          step: 'updateTransaction',
          args: {
            id: 'tx-100',
            fields: {
              date: '2026-11-02',
              amount: -725,
              payee: '77777777-7777-4777-8777-777777777777',
              category: '33333333-3333-4333-8333-333333333333',
              notes: 'Afternoon cortado',
              cleared: true,
            },
          },
        },
        { step: 'sync' },
      ]);

      // Throws EntityResolutionError with fuzzy suggestions if category name is not found
      await expect(
        gateway.manageTransactions({
          action: 'update',
          id: 'tx-100',
          category: 'Groceris',
        }),
      ).rejects.toThrow(EntityResolutionError);
    });

    it('bulk updates multiple transaction IDs in a single mutex write operation', async () => {
      const events: Array<{ step: string; args?: unknown }> = [];
      const storedTransactions = [
        {
          id: 'tx-101',
          account: '88888888-8888-4888-8888-888888888888',
          date: '2026-11-01',
          amount: -1200,
          payee: '66666666-6666-4666-8666-666666666666',
          category: null as string | null,
          notes: 'Coffee 1',
          cleared: false,
        },
        {
          id: 'tx-102',
          account: '88888888-8888-4888-8888-888888888888',
          date: '2026-11-02',
          amount: -1550,
          payee: '66666666-6666-4666-8666-666666666666',
          category: null as string | null,
          notes: 'Coffee 2',
          cleared: false,
        },
      ];

      const fakeApi: ActualApiAdapter = {
        getAccounts: async () => [
          { id: '88888888-8888-4888-8888-888888888888', name: 'Main Checking' },
        ],
        getAccountBalance: async () => 0,
        getCategories: async () => [
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Coffee Shops',
            group_id: 'grp-1',
          },
        ],
        getPayees: async () => [
          { id: '66666666-6666-4666-8666-666666666666', name: 'Starbucks' },
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

      const result = await gateway.manageTransactions({
        action: 'update',
        ids: ['tx-101', 'tx-102'],
        category: 'Coffee Shops',
        cleared: true,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Updated 2 transactions.');
      expect(result.resolved).toEqual({
        'Coffee Shops': '33333333-3333-4333-8333-333333333333',
      });
      const data = result.data as { updated: Array<{ id: string; categoryName: string; cleared: boolean }> };
      expect(data.updated).toHaveLength(2);
      expect(data.updated[0]).toMatchObject({
        id: 'tx-101',
        categoryName: 'Coffee Shops',
        cleared: true,
      });
      expect(data.updated[1]).toMatchObject({
        id: 'tx-102',
        categoryName: 'Coffee Shops',
        cleared: true,
      });

      // Exactly one pre-sync and one post-sync for the entire bulk update
      expect(events).toEqual([
        { step: 'sync' },
        {
          step: 'updateTransaction',
          args: {
            id: 'tx-101',
            fields: {
              category: '33333333-3333-4333-8333-333333333333',
              cleared: true,
            },
          },
        },
        {
          step: 'updateTransaction',
          args: {
            id: 'tx-102',
            fields: {
              category: '33333333-3333-4333-8333-333333333333',
              cleared: true,
            },
          },
        },
        { step: 'sync' },
      ]);
    });
  });

  describe('BudgetGateway & HTTP MCP seams — action: delete (single & batch)', () => {
    it('deletes single or multiple transaction IDs in a single mutex write operation and returns deleted records in Decimal Amounts', async () => {
      const events: Array<{ step: string; args?: unknown }> = [];
      const storedTransactions = [
        {
          id: 'tx-201',
          account: 'acc-credit',
          date: '2026-11-03',
          amount: -8999,
          payee: 'payee-amazon',
          category: 'cat-shopping',
          notes: 'USB-C hub',
          cleared: true,
        },
        {
          id: 'tx-202',
          account: 'acc-credit',
          date: '2026-11-04',
          amount: -1999,
          payee: 'payee-amazon',
          category: 'cat-shopping',
          notes: 'HDMI cable',
          cleared: false,
        },
        {
          id: 'tx-203',
          account: 'acc-credit',
          date: '2026-11-05',
          amount: -999,
          payee: 'payee-amazon',
          category: 'cat-shopping',
          notes: 'Screen protector',
          cleared: false,
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

      const batchDeleteResult = await gateway.manageTransactions({
        action: 'delete',
        ids: ['tx-201', 'tx-202'],
      });

      expect(batchDeleteResult).toEqual({
        success: true,
        message: 'Deleted 2 transactions.',
        data: {
          deleted: [
            {
              id: 'tx-201',
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
            {
              id: 'tx-202',
              account: 'acc-credit',
              accountId: 'acc-credit',
              accountName: 'Visa Card',
              date: '2026-11-04',
              amount: -19.99,
              payee: 'payee-amazon',
              payeeId: 'payee-amazon',
              payeeName: 'Amazon',
              category: 'cat-shopping',
              categoryId: 'cat-shopping',
              categoryName: 'Shopping',
              notes: 'HDMI cable',
              cleared: false,
            },
          ],
        },
      });

      expect(events).toEqual([
        { step: 'sync' },
        { step: 'deleteTransaction', args: { id: 'tx-201' } },
        { step: 'deleteTransaction', args: { id: 'tx-202' } },
        { step: 'sync' },
      ]);

      // Single ID delete via HTTP MCP tool
      const app = createApp({ config: testConfig, budgetGateway: gateway });
      const token = await issueBearerToken(app);

      const singleDeleteRes = await request(app)
        .post('/mcp')
        .set('Host', 'mcp.example.com')
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 20,
          method: 'tools/call',
          params: {
            name: 'manage_transactions',
            arguments: {
              action: 'delete',
              id: 'tx-203',
            },
          },
        });

      expect(singleDeleteRes.status).toBe(200);
      expect(singleDeleteRes.body.result.isError).toBeFalsy();
      const parsedSingleDelete = JSON.parse(singleDeleteRes.body.result.content[0].text);
      expect(parsedSingleDelete).toEqual({
        success: true,
        message: 'Deleted 1 transaction.',
        data: {
          deleted: [
            {
              id: 'tx-203',
              account: 'acc-credit',
              accountId: 'acc-credit',
              accountName: 'Visa Card',
              date: '2026-11-05',
              amount: -9.99,
              payee: 'payee-amazon',
              payeeId: 'payee-amazon',
              payeeName: 'Amazon',
              category: 'cat-shopping',
              categoryId: 'cat-shopping',
              categoryName: 'Shopping',
              notes: 'Screen protector',
              cleared: false,
            },
          ],
        },
      });
    });
  });
});
