import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { AccountSummary, BudgetGateway, BudgetReadiness } from '../src/gateway/types.js';
import { issueBearerToken } from './helpers/auth.js';

function createStubGateway(overrides: {
  readiness?: Partial<BudgetReadiness>;
  accounts?: AccountSummary[];
} = {}): BudgetGateway {
  const readiness: BudgetReadiness = {
    ready: true,
    syncId: '11111111-2222-3333-4444-555555555555',
    lastSyncedAt: '2026-11-04T17:00:00.000Z',
    ...overrides.readiness,
  };
  const accounts: AccountSummary[] = overrides.accounts ?? [
    {
      id: 'acc-checking',
      name: 'Main Checking',
      offbudget: false,
      closed: false,
      balance: 2450.75,
    },
    {
      id: 'acc-credit',
      name: 'Visa Card',
      offbudget: false,
      closed: false,
      balance: -120.34,
    },
  ];

  return {
    getReadiness: () => readiness,
    listAccounts: async () => accounts,
  };
}

let tempDataDir: string;
let testConfig: AppConfig;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-app-test-'));
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

describe('HTTP application seam — healthz & host validation', () => {
  it('enables reverse proxy trust (trust proxy: 1)', () => {
    const app = createApp({ config: testConfig, budgetGateway: createStubGateway() });
    expect(app.get('trust proxy')).toBe(1);
  });

  it('returns 200 OK with Target Budget readiness on GET /healthz without authentication', async () => {
    const app = createApp({ config: testConfig, budgetGateway: createStubGateway() });

    const res = await request(app)
      .get('/healthz')
      .set('Host', 'mcp.example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      targetBudget: {
        ready: true,
        syncId: '11111111-2222-3333-4444-555555555555',
        lastSyncedAt: '2026-11-04T17:00:00.000Z',
      },
    });
  });

  it('allows requests with Host matching PUBLIC_URL hostname, localhost, and 127.0.0.1, and rejects unrecognized Host headers with 403', async () => {
    const app = createApp({ config: testConfig, budgetGateway: createStubGateway() });

    const okPublic = await request(app).get('/healthz').set('Host', 'mcp.example.com');
    expect(okPublic.status).toBe(200);

    const okLocalhost = await request(app).get('/healthz').set('Host', 'localhost:3000');
    expect(okLocalhost.status).toBe(200);

    const okLoopback = await request(app).get('/healthz').set('Host', '127.0.0.1:3000');
    expect(okLoopback.status).toBe(200);

    const badHost = await request(app).get('/healthz').set('Host', 'evil.attacker.com');
    expect(badHost.status).toBe(403);
  });

  it('serves brand static assets (/favicon.ico, /logo.png, /apple-touch-icon.png, /logo.svg) for web discovery', async () => {
    const app = createApp({ config: testConfig, budgetGateway: createStubGateway() });

    const faviconRes = await request(app).get('/favicon.ico').set('Host', 'mcp.example.com');
    expect(faviconRes.status).toBe(200);
    expect(faviconRes.headers['content-type']).toMatch(/image\/(x-icon|vnd\.microsoft\.icon)/);

    const logoPngRes = await request(app).get('/logo.png').set('Host', 'mcp.example.com');
    expect(logoPngRes.status).toBe(200);
    expect(logoPngRes.headers['content-type']).toBe('image/png');

    const appleIconRes = await request(app).get('/apple-touch-icon.png').set('Host', 'mcp.example.com');
    expect(appleIconRes.status).toBe(200);
    expect(appleIconRes.headers['content-type']).toBe('image/png');

    const logoSvgRes = await request(app).get('/logo.svg').set('Host', 'mcp.example.com');
    expect(logoSvgRes.status).toBe(200);
    expect(logoSvgRes.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
  });
});

describe('HTTP application seam — stateless Streamable HTTP /mcp & list_accounts', () => {
  it('returns 405 Method Not Allowed on GET /mcp and DELETE /mcp', async () => {
    const app = createApp({ config: testConfig, budgetGateway: createStubGateway() });

    const getRes = await request(app).get('/mcp').set('Host', 'mcp.example.com');
    expect(getRes.status).toBe(405);

    const deleteRes = await request(app).delete('/mcp').set('Host', 'mcp.example.com');
    expect(deleteRes.status).toBe(405);
  });

  it('handles initialize on POST /mcp as stateless JSON response without Mcp-Session-Id', async () => {
    const app = createApp({ config: testConfig, budgetGateway: createStubGateway() });
    const token = await issueBearerToken(app);

    const res = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'gemini-test-client', version: '1.0.0' },
        },
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['mcp-session-id']).toBeUndefined();
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(1);
    expect(res.body.result.serverInfo.name).toBe('actual-mcp');
    expect(res.body.result.serverInfo.version).toBe('0.3.0');
    expect(res.body.result.serverInfo.icons).toEqual([
      {
        src: expect.stringMatching(/^data:image\/png;base64,/),
        mimeType: 'image/png',
        sizes: ['128x128', '512x512'],
      },
    ]);
    expect(res.body.result.instructions).toEqual(expect.any(String));
  });

  it('exposes list_accounts with readOnlyHint: true and destructiveHint: false on tools/list', async () => {
    const app = createApp({ config: testConfig, budgetGateway: createStubGateway() });
    const token = await issueBearerToken(app);

    const res = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

    expect(res.status).toBe(200);
    const tools = res.body.result.tools;
    const listAccountsTool = tools.find((t: { name: string }) => t.name === 'list_accounts');
    expect(listAccountsTool).toBeDefined();
    expect(listAccountsTool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it('invokes list_accounts via tools/call and returns all accounts with Decimal Amount balances', async () => {
    let receivedOptions: { forceSync?: boolean } | undefined;
    const gateway: BudgetGateway = {
      ...createStubGateway(),
      listAccounts: async (opts) => {
        receivedOptions = opts;
        return [
          {
            id: 'acc-checking',
            name: 'Main Checking',
            offbudget: false,
            closed: false,
            balance: 2450.75,
          },
          {
            id: 'acc-savings',
            name: 'Emergency Fund',
            offbudget: true,
            closed: false,
            balance: 10000,
          },
          {
            id: 'acc-old',
            name: 'Closed Card',
            offbudget: false,
            closed: true,
            balance: 0,
          },
        ];
      },
    };

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const res = await request(app)
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
          name: 'list_accounts',
          arguments: { forceSync: true },
        },
      });

    expect(res.status).toBe(200);
    expect(receivedOptions).toEqual({ forceSync: true });
    expect(res.body.result.isError).toBeFalsy();
    const textContent = res.body.result.content[0];
    expect(textContent.type).toBe('text');
    const parsed = JSON.parse(textContent.text);
    expect(parsed).toEqual({
      accounts: [
        {
          id: 'acc-checking',
          name: 'Main Checking',
          offbudget: false,
          closed: false,
          balance: 2450.75,
        },
        {
          id: 'acc-savings',
          name: 'Emergency Fund',
          offbudget: true,
          closed: false,
          balance: 10000,
        },
        {
          id: 'acc-old',
          name: 'Closed Card',
          offbudget: false,
          closed: true,
          balance: 0,
        },
      ],
    });
  });

  it('exposes list_categories with readOnlyHint: true and destructiveHint: false and returns category groups and categories', async () => {
    const gateway: BudgetGateway = {
      ...createStubGateway(),
      listCategories: async () => [
        {
          id: 'grp-expenses',
          name: 'Usual Expenses',
          is_income: false,
          hidden: false,
          categories: [
            {
              id: 'cat-food',
              name: 'Food',
              group_id: 'grp-expenses',
              is_income: false,
              hidden: false,
            },
          ],
        },
      ],
    };

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
        id: 10,
        method: 'tools/list',
        params: {},
      });

    expect(listRes.status).toBe(200);
    const tool = listRes.body.result.tools.find(
      (t: { name: string }) => t.name === 'list_categories',
    );
    expect(tool).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
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
        id: 11,
        method: 'tools/call',
        params: {
          name: 'list_categories',
          arguments: {},
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result.isError).toBeFalsy();
    const parsed = JSON.parse(callRes.body.result.content[0].text);
    expect(parsed).toEqual({
      categoryGroups: [
        {
          id: 'grp-expenses',
          name: 'Usual Expenses',
          is_income: false,
          hidden: false,
          categories: [
            {
              id: 'cat-food',
              name: 'Food',
              group_id: 'grp-expenses',
              is_income: false,
              hidden: false,
            },
          ],
        },
      ],
      categories: [
        {
          id: 'cat-food',
          name: 'Food',
          group_id: 'grp-expenses',
          is_income: false,
          hidden: false,
        },
      ],
    });
  });

  it('exposes list_payees with readOnlyHint: true and destructiveHint: false and returns payees', async () => {
    const gateway: BudgetGateway = {
      ...createStubGateway(),
      listPayees: async () => [
        { id: 'payee-1', name: 'Whole Foods', transfer_acct: null },
        { id: 'payee-2', name: 'Transfer : Savings', transfer_acct: 'acc-savings' },
      ],
    };

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
        id: 12,
        method: 'tools/list',
        params: {},
      });

    expect(listRes.status).toBe(200);
    const tool = listRes.body.result.tools.find(
      (t: { name: string }) => t.name === 'list_payees',
    );
    expect(tool).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
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
        id: 13,
        method: 'tools/call',
        params: {
          name: 'list_payees',
          arguments: {},
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result.isError).toBeFalsy();
    const parsed = JSON.parse(callRes.body.result.content[0].text);
    expect(parsed).toEqual({
      payees: [
        { id: 'payee-1', name: 'Whole Foods', transfer_acct: null },
        { id: 'payee-2', name: 'Transfer : Savings', transfer_acct: 'acc-savings' },
      ],
    });
  });

  it('exposes list_budget_months and get_budget_month with readOnlyHint: true and destructiveHint: false and returns Decimal Amounts', async () => {
    let requestedMonth: string | undefined;
    const gateway: BudgetGateway = {
      ...createStubGateway(),
      listBudgetMonths: async () => ['2026-09', '2026-10', '2026-11'],
      getBudgetMonth: async (month) => {
        requestedMonth = month;
        return {
          month,
          incomeAvailable: 5000,
          lastMonthOverspent: 0,
          forNextMonth: 0,
          totalBudgeted: -2500.5,
          toBudget: 2499.5,
          fromLastMonth: 0,
          totalIncome: 5000,
          totalSpent: -1420.25,
          totalBalance: 1080.25,
          categoryGroups: [
            {
              id: 'grp-living',
              name: 'Living',
              is_income: false,
              hidden: false,
              budgeted: 600,
              spent: -420.25,
              balance: 179.75,
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
              ],
            },
          ],
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
          ],
        };
      },
    };

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
        id: 14,
        method: 'tools/list',
        params: {},
      });

    expect(listRes.status).toBe(200);
    for (const toolName of ['list_budget_months', 'get_budget_month']) {
      const tool = listRes.body.result.tools.find((t: { name: string }) => t.name === toolName);
      expect(tool).toBeDefined();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }

    const monthsRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'list_budget_months',
          arguments: {},
        },
      });

    expect(monthsRes.status).toBe(200);
    expect(JSON.parse(monthsRes.body.result.content[0].text)).toEqual({
      months: ['2026-09', '2026-10', '2026-11'],
    });

    const monthSummaryRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'get_budget_month',
          arguments: { month: '2026-11' },
        },
      });

    expect(monthSummaryRes.status).toBe(200);
    expect(requestedMonth).toBe('2026-11');
    const summaryParsed = JSON.parse(monthSummaryRes.body.result.content[0].text);
    expect(summaryParsed).toMatchObject({
      month: '2026-11',
      toBudget: 2499.5,
      totalIncome: 5000,
      totalBudgeted: -2500.5,
      totalSpent: -1420.25,
      totalBalance: 1080.25,
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
      ],
    });
  });

  it('exposes get_transactions with readOnlyHint: true and destructiveHint: false, forwards filters, and enforces limit <= 500', async () => {
    let capturedFilters: unknown;
    const gateway: BudgetGateway = {
      ...createStubGateway(),
      getTransactions: async (filters) => {
        capturedFilters = filters;
        return [
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
        ];
      },
    };

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
        id: 17,
        method: 'tools/list',
        params: {},
      });

    expect(listRes.status).toBe(200);
    const tool = listRes.body.result.tools.find(
      (t: { name: string }) => t.name === 'get_transactions',
    );
    expect(tool).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
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
        id: 18,
        method: 'tools/call',
        params: {
          name: 'get_transactions',
          arguments: {
            accountId: 'acc-checking',
            startDate: '2026-11-01',
            endDate: '2026-11-30',
            categoryId: 'cat-groceries',
            payeeId: 'payee-trader-joes',
            searchText: 'produce',
            limit: 50,
            forceSync: true,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result.isError).toBeFalsy();
    expect(capturedFilters).toEqual({
      accountId: 'acc-checking',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      categoryId: 'cat-groceries',
      payeeId: 'payee-trader-joes',
      searchText: 'produce',
      limit: 50,
      forceSync: true,
    });

    const parsed = JSON.parse(callRes.body.result.content[0].text);
    expect(parsed).toEqual({
      transactions: [
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
      ],
    });

    // Rejects limit > 500 via Zod input validation
    const invalidLimitRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: {
          name: 'get_transactions',
          arguments: {
            limit: 501,
          },
        },
      });

    expect(invalidLimitRes.status).toBe(200);
    expect(
      invalidLimitRes.body.error || invalidLimitRes.body.result?.isError,
    ).toBeTruthy();
  });
});

