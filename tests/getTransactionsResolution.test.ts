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
import { issueBearerToken } from './helpers/auth.js';

let tempDataDir: string;
let testConfig: AppConfig;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-get-tx-res-test-'));
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

describe('get_transactions in-process entity resolution', () => {
  const fakeAccounts = [
    { id: '88888888-8888-4888-8888-888888888888', name: 'Checking', offbudget: false, closed: false },
    { id: '99999999-9999-4999-8999-999999999999', name: 'Savings', offbudget: false, closed: false },
  ];

  const fakeCategoryGroups = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Daily Living',
      categories: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Groceries',
          group_id: '11111111-1111-4111-8111-111111111111',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Coffee',
          group_id: '11111111-1111-4111-8111-111111111111',
        },
      ],
    },
  ];

  const fakePayees = [
    { id: '77777777-7777-4777-8777-777777777777', name: 'Starbucks', transfer_acct: null },
    { id: '66666666-6666-4666-8666-666666666666', name: 'Trader Joes', transfer_acct: null },
  ];

  const fakeTransactions = [
    {
      id: 'tx-1',
      account: '88888888-8888-4888-8888-888888888888',
      date: '2026-11-01',
      amount: -450,
      payee: '77777777-7777-4777-8777-777777777777',
      category: '33333333-3333-4333-8333-333333333333',
      notes: 'Morning coffee',
      cleared: true,
    },
    {
      id: 'tx-2',
      account: '88888888-8888-4888-8888-888888888888',
      date: '2026-11-02',
      amount: -5200,
      payee: '66666666-6666-4666-8666-666666666666',
      category: '22222222-2222-4222-8222-222222222222',
      notes: 'Weekly groceries',
      cleared: true,
    },
  ];

  function createTestGateway(): ReturnType<typeof createActualBudgetGateway> {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => fakeAccounts,
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => fakeCategoryGroups,
      getPayees: async () => fakePayees,
      getTransactions: async () => fakeTransactions,
      sync: async () => {},
    };

    return createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });
  }

  it('filters transactions by natural names: account, category, and payee in tools/call', async () => {
    const gateway = createTestGateway();
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
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_transactions',
          arguments: {
            account: 'checking',
            category: 'coffee',
            payee: 'starbucks',
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].id).toBe('tx-1');
    expect(parsed.transactions[0].categoryName).toBe('Coffee');
    expect(parsed.transactions[0].payeeName).toBe('Starbucks');
  });

  it('fails fast with suggestions when filtering by misspelled category name', async () => {
    const gateway = createTestGateway();
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
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_transactions',
          arguments: {
            category: 'Grocries',
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.suggestions).toContain('Groceries');
    expect(parsed.message).toContain('Groceries');
  });

  it('accepts legacy aliases accountId, categoryId, payeeId with names or UUIDs', async () => {
    const gateway = createTestGateway();
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
          name: 'get_transactions',
          arguments: {
            accountId: '88888888-8888-4888-8888-888888888888',
            categoryId: 'Groceries',
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].id).toBe('tx-2');
  });
});
