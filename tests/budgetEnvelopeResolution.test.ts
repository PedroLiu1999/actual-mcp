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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-budget-env-res-test-'));
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

describe('Budget envelope in-process entity resolution', () => {
  const groceriesId = '22222222-2222-4222-8222-222222222222';
  const diningOutId = '33333333-3333-4333-8333-333333333333';

  function createTestGateway() {
    const categoryStates = new Map([
      [
        groceriesId,
        {
          id: groceriesId,
          name: 'Groceries',
          group_id: '11111111-1111-4111-8111-111111111111',
          is_income: false,
          hidden: false,
          budgeted: 50000,
          spent: -20000,
          balance: 30000,
          carryover: false,
        },
      ],
      [
        diningOutId,
        {
          id: diningOutId,
          name: 'Dining Out',
          group_id: '11111111-1111-4111-8111-111111111111',
          is_income: false,
          hidden: false,
          budgeted: 15000,
          spent: -5000,
          balance: 10000,
          carryover: false,
        },
      ],
    ]);

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Daily Living',
          categories: [
            {
              id: groceriesId,
              name: 'Groceries',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
            {
              id: diningOutId,
              name: 'Dining Out',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        },
      ],
      getBudgetMonth: async (month) => ({
        month,
        categoryGroups: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Daily Living',
            is_income: false,
            hidden: false,
            budgeted: 65000,
            spent: -25000,
            balance: 40000,
            categories: Array.from(categoryStates.values()).map((c) => ({ ...c })),
          },
        ],
      }),
      setBudgetAmount: async (_month, categoryId, value) => {
        const state = categoryStates.get(categoryId);
        if (state) {
          state.budgeted = value;
          state.balance = value + state.spent;
        }
      },
      setBudgetCarryover: async (_month, categoryId, flag) => {
        const state = categoryStates.get(categoryId);
        if (state) {
          state.carryover = flag;
        }
      },
      sync: async () => {},
    };

    return createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });
  }

  it('sets budget amount by category name (case-insensitive) and returns categoryName and categoryId', async () => {
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
          name: 'set_budget_amount',
          arguments: {
            month: '2026-11',
            category: 'groceries',
            budgeted: 600,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toMatchObject({
      month: '2026-11',
      categoryId: groceriesId,
      categoryName: 'Groceries',
      previous: {
        id: groceriesId,
        name: 'Groceries',
        categoryName: 'Groceries',
        budgeted: 500,
      },
      updated: {
        id: groceriesId,
        name: 'Groceries',
        categoryName: 'Groceries',
        budgeted: 600,
      },
    });
  });

  it('sets budget amount by category UUID (via category or legacy categoryId) and returns categoryName', async () => {
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
          name: 'set_budget_amount',
          arguments: {
            month: '2026-11',
            categoryId: diningOutId,
            budgeted: 200,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toMatchObject({
      month: '2026-11',
      categoryId: diningOutId,
      categoryName: 'Dining Out',
      previous: {
        id: diningOutId,
        name: 'Dining Out',
        categoryName: 'Dining Out',
        budgeted: 150,
      },
      updated: {
        id: diningOutId,
        name: 'Dining Out',
        categoryName: 'Dining Out',
        budgeted: 200,
      },
    });
  });

  it('fails fast with EntityResolutionError and fuzzy suggestions on misspelled category in set_budget_amount', async () => {
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
          name: 'set_budget_amount',
          arguments: {
            month: '2026-11',
            category: 'Groceriess',
            budgeted: 600,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toMatchObject({
      success: false,
      entityType: 'category',
      input: 'Groceriess',
      suggestions: ['Groceries'],
    });
  });

  it('sets budget carryover by category name (case-insensitive) and returns categoryName and categoryId', async () => {
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
        id: 4,
        method: 'tools/call',
        params: {
          name: 'set_budget_carryover',
          arguments: {
            month: '2026-11',
            category: 'dining out',
            carryover: true,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toMatchObject({
      success: true,
      month: '2026-11',
      categoryId: diningOutId,
      categoryName: 'Dining Out',
      carryover: true,
    });
    expect(parsed.previousCarryover).toBeUndefined();
  });

  it('sets budget carryover by category UUID without fetching category groups', async () => {
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
        id: 5,
        method: 'tools/call',
        params: {
          name: 'set_budget_carryover',
          arguments: {
            month: '2026-11',
            categoryId: groceriesId,
            carryover: true,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toMatchObject({
      success: true,
      month: '2026-11',
      categoryId: groceriesId,
      carryover: true,
    });
    expect(parsed.previousCarryover).toBeUndefined();
  });

  it('fails fast with EntityResolutionError and fuzzy suggestions on misspelled category in set_budget_carryover', async () => {
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
        id: 6,
        method: 'tools/call',
        params: {
          name: 'set_budget_carryover',
          arguments: {
            month: '2026-11',
            category: 'Dinnig Out',
            carryover: true,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.result?.isError).toBe(true);
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toMatchObject({
      success: false,
      entityType: 'category',
      input: 'Dinnig Out',
      suggestions: ['Dining Out'],
    });
  });
});
