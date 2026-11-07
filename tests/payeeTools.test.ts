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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-payee-test-'));
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

describe('manage_payees Deep Resource Facade — BudgetGateway Seam', () => {
  it('creates a payee and updates a payee by name or UUID, returning the standardized ResourceFacadeResult envelope', async () => {
    const events: string[] = [];
    const payees = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Starbucks Coffee' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Trader Joes' },
    ];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {
        events.push('api:sync');
      },
      getPayees: async () => {
        events.push('api:getPayees');
        return payees;
      },
      createPayee: async (payee) => {
        events.push(`api:createPayee:${payee.name}`);
        return '33333333-3333-4333-8333-333333333333';
      },
      updatePayee: async (id, fields) => {
        events.push(`api:updatePayee:${id}:${JSON.stringify(fields)}`);
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // 1. Create payee
    const createRes = await gateway.managePayees({
      action: 'create',
      name: 'Whole Foods Market',
    });

    expect(createRes).toEqual({
      success: true,
      message:
        'Created payee "Whole Foods Market" (33333333-3333-4333-8333-333333333333).',
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Whole Foods Market',
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:createPayee:Whole Foods Market',
      'api:sync',
    ]);

    // 2. Update payee by human-readable name (case-insensitive)
    events.length = 0;
    const updateByNameRes = await gateway.managePayees({
      action: 'update',
      name: 'trader joes',
      newName: "Trader Joe's Market",
    });

    expect(updateByNameRes).toEqual({
      success: true,
      message:
        'Updated payee "Trader Joes" (22222222-2222-4222-8222-222222222222) to "Trader Joe\'s Market".',
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        name: "Trader Joe's Market",
      },
      resolved: {
        'trader joes': '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:getPayees',
      'api:updatePayee:22222222-2222-4222-8222-222222222222:{"name":"Trader Joe\'s Market"}',
      'api:sync',
    ]);

    // 3. Update payee by UUID directly without extra getPayees lookup
    events.length = 0;
    const updateByUuidRes = await gateway.managePayees({
      action: 'update',
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Starbucks',
    });

    expect(updateByUuidRes).toEqual({
      success: true,
      message:
        'Updated payee "11111111-1111-4111-8111-111111111111" (11111111-1111-4111-8111-111111111111) to "Starbucks".',
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Starbucks',
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:updatePayee:11111111-1111-4111-8111-111111111111:{"name":"Starbucks"}',
      'api:sync',
    ]);
  });

  it('deletes a payee by name or UUID, atomically merges multiple duplicate payees by names/UUIDs, and throws EntityResolutionError with fuzzy suggestions when a payee name is not found', async () => {
    const events: string[] = [];
    const payees = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Starbucks' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Starbucks #1042' },
      { id: '33333333-3333-4333-8333-333333333333', name: 'STARBUCKS STORE 99' },
      { id: '44444444-4444-4444-8444-444444444444', name: 'Obsolete Vendor' },
    ];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {
        events.push('api:sync');
      },
      getPayees: async () => {
        events.push('api:getPayees');
        return payees;
      },
      deletePayee: async (id) => {
        events.push(`api:deletePayee:${id}`);
      },
      mergePayees: async (targetId, mergeIds) => {
        events.push(`api:mergePayees:${targetId}:${JSON.stringify(mergeIds)}`);
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // 1. Delete payee by name
    const deleteRes = await gateway.managePayees({
      action: 'delete',
      name: 'obsolete vendor',
    });

    expect(deleteRes).toEqual({
      success: true,
      message:
        'Deleted payee "Obsolete Vendor" (44444444-4444-4444-8444-444444444444).',
      data: {
        id: '44444444-4444-4444-8444-444444444444',
      },
      resolved: {
        'obsolete vendor': '44444444-4444-4444-8444-444444444444',
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:getPayees',
      'api:deletePayee:44444444-4444-4444-8444-444444444444',
      'api:sync',
    ]);

    // 2. Merge multiple duplicate payees into a target payee (mixing names and UUIDs)
    events.length = 0;
    const mergeRes = await gateway.managePayees({
      action: 'merge',
      target: 'Starbucks',
      merge: [
        'Starbucks #1042',
        '33333333-3333-4333-8333-333333333333',
      ],
    });

    expect(mergeRes).toEqual({
      success: true,
      message:
        'Merged 2 payee(s) into "Starbucks" (11111111-1111-4111-8111-111111111111).',
      data: {
        targetId: '11111111-1111-4111-8111-111111111111',
        mergedIds: [
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
        ],
        mergedCount: 2,
      },
      resolved: {
        Starbucks: '11111111-1111-4111-8111-111111111111',
        'Starbucks #1042': '22222222-2222-4222-8222-222222222222',
      },
    });
    // Should fetch getPayees only once during the merge resolution
    expect(events).toEqual([
      'api:sync',
      'api:getPayees',
      'api:mergePayees:11111111-1111-4111-8111-111111111111:["22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"]',
      'api:sync',
    ]);

    // 3. Resolution failure returns fuzzy suggestions
    await expect(
      gateway.managePayees({
        action: 'delete',
        name: 'Starbux',
      }),
    ).rejects.toThrow(EntityResolutionError);

    try {
      await gateway.managePayees({
        action: 'merge',
        target: 'Starbucks',
        merge: ['Starbux'],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(EntityResolutionError);
      const resErr = err as EntityResolutionError;
      expect(resErr.entityType).toBe('payee');
      expect(resErr.input).toBe('Starbux');
      expect(resErr.suggestions).toContain('Starbucks');
    }
  });
});

describe('manage_payees Deep Resource Facade — MCP Server Seam', () => {
  it('exposes manage_payees tool with readOnlyHint: false, destructiveHint: true and action enum on tools/list', async () => {
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
        id: 101,
        method: 'tools/list',
        params: {},
      });

    expect(listRes.status).toBe(200);
    const tools = listRes.body.result.tools;
    const managePayees = tools.find(
      (t: { name: string }) => t.name === 'manage_payees',
    );
    expect(managePayees).toBeDefined();
    expect(managePayees.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(managePayees.inputSchema.properties.action.enum).toEqual([
      'create',
      'update',
      'delete',
      'merge',
    ]);

    for (const retiredTool of [
      'create_payee',
      'update_payee',
      'delete_payee',
      'merge_payees',
    ]) {
      expect(tools.find((t: { name: string }) => t.name === retiredTool)).toBeUndefined();
    }
  });

  it('executes create, update, delete, and merge via manage_payees tools/call with in-process name resolution and standardized envelope', async () => {
    const payees = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Starbucks' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Starbucks #42' },
      { id: '33333333-3333-4333-8333-333333333333', name: 'Starbucks Airport' },
      { id: '44444444-4444-4444-8444-444444444444', name: 'Old Gym' },
    ];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {},
      getPayees: async () => payees,
      createPayee: async () => '55555555-5555-4555-8555-555555555555',
      updatePayee: async () => {},
      deletePayee: async () => {},
      mergePayees: async () => {},
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    // 1. Create
    const createCall = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'manage_payees',
          arguments: {
            action: 'create',
            name: 'Blue Bottle Coffee',
          },
        },
      });

    expect(createCall.status).toBe(200);
    expect(createCall.body.result?.isError).toBeFalsy();
    expect(JSON.parse(createCall.body.result.content[0].text)).toEqual({
      success: true,
      message:
        'Created payee "Blue Bottle Coffee" (55555555-5555-4555-8555-555555555555).',
      data: {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Blue Bottle Coffee',
      },
    });

    // 2. Update by name
    const updateCall = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 103,
        method: 'tools/call',
        params: {
          name: 'manage_payees',
          arguments: {
            action: 'update',
            payee: 'starbucks',
            newName: 'Starbucks Reserve',
          },
        },
      });

    expect(updateCall.status).toBe(200);
    expect(updateCall.body.result?.isError).toBeFalsy();
    expect(JSON.parse(updateCall.body.result.content[0].text)).toEqual({
      success: true,
      message:
        'Updated payee "Starbucks" (11111111-1111-4111-8111-111111111111) to "Starbucks Reserve".',
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Starbucks Reserve',
      },
      resolved: {
        starbucks: '11111111-1111-4111-8111-111111111111',
      },
    });

    // 3. Delete by name
    const deleteCall = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 104,
        method: 'tools/call',
        params: {
          name: 'manage_payees',
          arguments: {
            action: 'delete',
            name: 'old gym',
          },
        },
      });

    expect(deleteCall.status).toBe(200);
    expect(deleteCall.body.result?.isError).toBeFalsy();
    expect(JSON.parse(deleteCall.body.result.content[0].text)).toEqual({
      success: true,
      message:
        'Deleted payee "Old Gym" (44444444-4444-4444-8444-444444444444).',
      data: {
        id: '44444444-4444-4444-8444-444444444444',
      },
      resolved: {
        'old gym': '44444444-4444-4444-8444-444444444444',
      },
    });

    // 4. Merge by names
    const mergeCall = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 105,
        method: 'tools/call',
        params: {
          name: 'manage_payees',
          arguments: {
            action: 'merge',
            target: 'Starbucks',
            merge: ['Starbucks #42', 'Starbucks Airport'],
          },
        },
      });

    expect(mergeCall.status).toBe(200);
    expect(mergeCall.body.result?.isError).toBeFalsy();
    expect(JSON.parse(mergeCall.body.result.content[0].text)).toEqual({
      success: true,
      message:
        'Merged 2 payee(s) into "Starbucks" (11111111-1111-4111-8111-111111111111).',
      data: {
        targetId: '11111111-1111-4111-8111-111111111111',
        mergedIds: [
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
        ],
        mergedCount: 2,
      },
      resolved: {
        Starbucks: '11111111-1111-4111-8111-111111111111',
        'Starbucks #42': '22222222-2222-4222-8222-222222222222',
        'Starbucks Airport': '33333333-3333-4333-8333-333333333333',
      },
    });
  });

  it('returns structured fuzzy suggestions when payee resolution fails and rejects invalid manage_payees inputs', async () => {
    const payees = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Starbucks' },
    ];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {},
      getPayees: async () => payees,
      deletePayee: async () => {},
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const notFoundRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 106,
        method: 'tools/call',
        params: {
          name: 'manage_payees',
          arguments: {
            action: 'delete',
            name: 'Starbux',
          },
        },
      });

    expect(notFoundRes.status).toBe(200);
    expect(notFoundRes.body.result?.isError).toBe(true);
    const errPayload = JSON.parse(notFoundRes.body.result.content[0].text);
    expect(errPayload).toEqual({
      success: false,
      message: 'Payee "Starbux" not found. Did you mean: "Starbucks"?',
      error: 'Payee "Starbux" not found. Did you mean: "Starbucks"?',
      entityType: 'payee',
      input: 'Starbux',
      suggestions: ['Starbucks'],
    });

    const invalidActionRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 107,
        method: 'tools/call',
        params: {
          name: 'manage_payees',
          arguments: {
            action: 'invalid_action',
          },
        },
      });

    expect(invalidActionRes.status).toBe(200);
    expect(invalidActionRes.body.result?.isError).toBe(true);
  });
});



