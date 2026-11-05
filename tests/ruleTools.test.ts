import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createActualBudgetGateway } from '../src/gateway/actualBudgetGateway.js';
import type {
  ActualApiAdapter,
  ActualRuleRecord,
} from '../src/gateway/actualBudgetGateway.js';
import type { BudgetGateway, BudgetReadiness } from '../src/gateway/types.js';
import { issueBearerToken } from './helpers/auth.js';

function createStubGateway(overrides: Partial<BudgetGateway> = {}): BudgetGateway {
  const readiness: BudgetReadiness = {
    ready: true,
    syncId: '11111111-2222-3333-4444-555555555555',
    lastSyncedAt: '2026-11-05T12:00:00.000Z',
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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-rule-test-'));
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

describe('Rule MCP Tools HTTP Seam', () => {
  it('exposes rule tools with correct annotations on tools/list', async () => {
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
    const tools = listRes.body.result.tools as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }>;

    const listRules = tools.find((t) => t.name === 'list_rules');
    expect(listRules).toBeDefined();
    expect(listRules?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    });

    const createRule = tools.find((t) => t.name === 'create_rule');
    expect(createRule).toBeDefined();
    expect(createRule?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const updateRule = tools.find((t) => t.name === 'update_rule');
    expect(updateRule).toBeDefined();
    expect(updateRule?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const deleteRule = tools.find((t) => t.name === 'delete_rule');
    expect(deleteRule).toBeDefined();
    expect(deleteRule?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('handles list_rules tool call with optional payeeId', async () => {
    const listRulesFn = vi.fn().mockResolvedValue([
      {
        id: 'rule-1',
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'payee-1' }],
        actions: [{ field: 'category', op: 'set', value: 'cat-1' }],
      },
    ]);

    const gateway = createStubGateway({ listRules: listRulesFn });
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
          name: 'list_rules',
          arguments: {
            payeeId: 'payee-1',
            forceSync: true,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(listRulesFn).toHaveBeenCalledWith({
      payeeId: 'payee-1',
      forceSync: true,
    });
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0].id).toBe('rule-1');
  });

  it('handles create_rule tool call', async () => {
    const createRuleFn = vi.fn().mockResolvedValue({
      id: 'rule-new-1',
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: 'payee-starbucks' }],
      actions: [{ field: 'category', op: 'set', value: 'cat-coffee' }],
    });

    const gateway = createStubGateway({ createRule: createRuleFn });
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
          name: 'create_rule',
          arguments: {
            stage: 'pre',
            conditionsOp: 'and',
            conditions: [{ field: 'payee', op: 'is', value: 'payee-starbucks' }],
            actions: [{ field: 'category', op: 'set', value: 'cat-coffee' }],
          },
        },
      });

    expect(res.status).toBe(200);
    expect(createRuleFn).toHaveBeenCalledWith({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: 'payee-starbucks' }],
      actions: [{ field: 'category', op: 'set', value: 'cat-coffee' }],
    });
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.rule.id).toBe('rule-new-1');
  });

  it('handles update_rule tool call', async () => {
    const updateRuleFn = vi.fn().mockResolvedValue({
      id: 'rule-1',
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: 'payee-1' }],
      actions: [{ field: 'notes', op: 'set', value: 'Categorized' }],
    });

    const gateway = createStubGateway({ updateRule: updateRuleFn });
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
          name: 'update_rule',
          arguments: {
            id: 'rule-1',
            conditions: [{ field: 'payee', op: 'is', value: 'payee-1' }],
            actions: [{ field: 'notes', op: 'set', value: 'Categorized' }],
          },
        },
      });

    expect(res.status).toBe(200);
    expect(updateRuleFn).toHaveBeenCalledWith({
      id: 'rule-1',
      conditions: [{ field: 'payee', op: 'is', value: 'payee-1' }],
      actions: [{ field: 'notes', op: 'set', value: 'Categorized' }],
    });
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.rule.id).toBe('rule-1');
  });

  it('handles delete_rule tool call', async () => {
    const deleteRuleFn = vi.fn().mockResolvedValue({ id: 'rule-1' });
    const gateway = createStubGateway({ deleteRule: deleteRuleFn });
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
          name: 'delete_rule',
          arguments: {
            id: 'rule-1',
          },
        },
      });

    expect(res.status).toBe(200);
    expect(deleteRuleFn).toHaveBeenCalledWith('rule-1');
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toEqual({ success: true, id: 'rule-1' });
  });
});

describe('Rule ActualBudgetGateway Seam', () => {
  it('converts minor units to Decimal Amounts on listRules', async () => {
    const mockRules: ActualRuleRecord[] = [
      {
        id: 'r-1',
        stage: 'pre',
        conditions_op: 'and',
        conditions: [
          { field: 'amount', op: 'is', value: -5000 },
          { field: 'amount', op: 'isbetween', value: { num1: -10000, num2: -2500 } },
        ],
        actions: [{ field: 'category', op: 'set', value: 'c-1' }],
      },
    ];

    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getRules: async () => mockRules,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const rules = await gateway.listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].conditions[0].value).toBe(-50.0);
    expect(rules[0].conditions[1].value).toEqual({ num1: -100.0, num2: -25.0 });
  });

  it('returns default stage when stage is null or default', async () => {
    const mockRules: ActualRuleRecord[] = [
      {
        id: 'r-default',
        stage: null,
        conditions_op: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'p-1' }],
        actions: [{ field: 'category', op: 'set', value: 'c-1' }],
      },
    ];

    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getRules: async () => mockRules,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const rules = await gateway.listRules();
    expect(rules[0].stage).toBe('default');
  });

  it('converts Decimal Amounts to minor units on createRule and updateRule', async () => {
    const createRuleMock = vi.fn().mockImplementation(async (payload) => ({
      id: 'r-created',
      ...payload,
    }));
    const updateRuleMock = vi.fn().mockImplementation(async (payload) => ({
      ...payload,
    }));
    const syncMock = vi.fn().mockResolvedValue(undefined);

    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      createRule: createRuleMock,
      updateRule: updateRuleMock,
      sync: syncMock,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const created = await gateway.createRule({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'amount', op: 'is', value: -42.5 }],
      actions: [{ op: 'set-split-amount', value: -42.5 }],
    });
    expect(created.id).toBe('r-created');
    expect(createRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: [{ field: 'amount', op: 'is', value: -4250 }],
        actions: [{ op: 'set-split-amount', value: -4250 }],
      }),
    );

    await gateway.updateRule({
      id: 'r-created',
      conditions: [{ field: 'amount', op: 'is', value: -50.0 }],
      actions: [{ field: 'category', op: 'set', value: 'c-1' }],
    });
    expect(updateRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: [{ field: 'amount', op: 'is', value: -5000 }],
      }),
    );
  });
});
