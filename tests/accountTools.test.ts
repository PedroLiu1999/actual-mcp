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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-account-test-'));
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

describe('manage_accounts Deep Resource Facade — BudgetGateway Seam', () => {
  it('creates an account with Decimal Amount initialBalance converted to Minor Unit Amount and returns standardized envelope', async () => {
    const events: string[] = [];
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      sync: async () => {
        events.push('api:sync');
      },
      createAccount: async (account, initialBalance) => {
        events.push(
          `api:createAccount:${JSON.stringify(account)}:${initialBalance ?? 'none'}`,
        );
        return 'acct-created-1';
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const result = await gateway.manageAccounts({
      action: 'create',
      name: 'High Yield Savings',
      type: 'savings',
      offbudget: false,
      initialBalance: 2500.75,
    });

    expect(result).toEqual({
      success: true,
      message: 'Created account "High Yield Savings" (acct-created-1)',
      data: {
        id: 'acct-created-1',
        name: 'High Yield Savings',
        type: 'savings',
        offbudget: false,
        initialBalance: 2500.75,
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:createAccount:{"name":"High Yield Savings","type":"savings","offbudget":false}:250075',
      'api:sync',
    ]);
  });

  it('updates an account by human-readable name or UUID and returns resolved map or fuzzy suggestions on failure', async () => {
    const events: string[] = [];
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Main Checking',
          offbudget: false,
          closed: false,
        },
        {
          id: '99999999-9999-4999-8999-999999999999',
          name: 'Emergency Savings',
          offbudget: false,
          closed: false,
        },
      ],
      getAccountBalance: async () => 0,
      sync: async () => {
        events.push('api:sync');
      },
      updateAccount: async (id, fields) => {
        events.push(`api:updateAccount:${id}:${JSON.stringify(fields)}`);
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // 1. Update by human-readable name (case-insensitive) with newName + offbudget
    const updateByName = await gateway.manageAccounts({
      action: 'update',
      name: 'main checking',
      newName: 'Primary Checking',
      offbudget: true,
    });

    expect(updateByName).toEqual({
      success: true,
      message:
        'Updated account "Primary Checking" (88888888-8888-4888-8888-888888888888)',
      data: {
        id: '88888888-8888-4888-8888-888888888888',
        name: 'Primary Checking',
        offbudget: true,
      },
      resolved: {
        'main checking': '88888888-8888-4888-8888-888888888888',
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:updateAccount:88888888-8888-4888-8888-888888888888:{"name":"Primary Checking","offbudget":true}',
      'api:sync',
    ]);

    // 2. Update by UUID directly
    events.length = 0;
    const updateByUuid = await gateway.manageAccounts({
      action: 'update',
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Rainy Day Fund',
    });

    expect(updateByUuid).toEqual({
      success: true,
      message:
        'Updated account "Rainy Day Fund" (99999999-9999-4999-8999-999999999999)',
      data: {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Rainy Day Fund',
      },
    });

    // 3. Resolution failure returns EntityResolutionError with fuzzy match suggestions
    await expect(
      gateway.manageAccounts({
        action: 'update',
        name: 'Main Checkin',
        newName: 'Updated Name',
      }),
    ).rejects.toThrow(/Account "Main Checkin" not found.*Main Checking/);
  });

  it('enforces safety invariants on close (requiring transferTo for non-zero balance) and resolves transferTo/transferCategory names', async () => {
    const events: string[] = [];
    const balancesByAccount: Record<string, number> = {
      '88888888-8888-4888-8888-888888888888': 150050, // $1500.50
      '99999999-9999-4999-8999-999999999999': 0,
    };

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Old Checking',
          offbudget: false,
          closed: false,
        },
        {
          id: '99999999-9999-4999-8999-999999999999',
          name: 'Active Checking',
          offbudget: false,
          closed: false,
        },
      ],
      getCategoryGroups: async () => [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Transfers',
          categories: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Balance Reassignment',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        },
      ],
      getAccountBalance: async (id) => balancesByAccount[id] ?? 0,
      sync: async () => {
        events.push('api:sync');
      },
      closeAccount: async (id, transferAccountId, transferCategoryId) => {
        events.push(
          `api:closeAccount:${id}:${transferAccountId ?? 'none'}:${transferCategoryId ?? 'none'}`,
        );
      },
      reopenAccount: async (id) => {
        events.push(`api:reopenAccount:${id}`);
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // 1. Rejects closing non-zero balance account without transferTo, providing available account suggestions
    try {
      await gateway.manageAccounts({
        action: 'close',
        name: 'Old Checking',
      });
      expect.fail('Expected manageAccounts to reject closing non-zero balance account');
    } catch (err) {
      const error = err as Error & { suggestions?: string[] };
      expect(error.message).toMatch(/Cannot close account.*Old Checking.*1500\.5/);
      expect(error.message).toContain('Active Checking');
      expect(error.suggestions).toEqual(['Active Checking']);
    }

    // 2. Closes non-zero balance account when transferTo and transferCategory are supplied by name
    events.length = 0;
    const closeWithTransfer = await gateway.manageAccounts({
      action: 'close',
      name: 'Old Checking',
      transferTo: 'Active Checking',
      transferCategory: 'Balance Reassignment',
    });

    expect(closeWithTransfer).toEqual({
      success: true,
      message:
        'Closed account "Old Checking" (88888888-8888-4888-8888-888888888888) and transferred balance to "Active Checking" (99999999-9999-4999-8999-999999999999)',
      data: {
        id: '88888888-8888-4888-8888-888888888888',
        closed: true,
        transferAccountId: '99999999-9999-4999-8999-999999999999',
        transferCategoryId: '22222222-2222-4222-8222-222222222222',
      },
      resolved: {
        'Old Checking': '88888888-8888-4888-8888-888888888888',
        'Active Checking': '99999999-9999-4999-8999-999999999999',
        'Balance Reassignment': '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:closeAccount:88888888-8888-4888-8888-888888888888:99999999-9999-4999-8999-999999999999:22222222-2222-4222-8222-222222222222',
      'api:sync',
    ]);

    // 3. Closes zero-balance account without transferTo
    events.length = 0;
    const closeZeroBalance = await gateway.manageAccounts({
      action: 'close',
      name: 'Active Checking',
    });

    expect(closeZeroBalance).toEqual({
      success: true,
      message:
        'Closed account "Active Checking" (99999999-9999-4999-8999-999999999999)',
      data: {
        id: '99999999-9999-4999-8999-999999999999',
        closed: true,
      },
      resolved: {
        'Active Checking': '99999999-9999-4999-8999-999999999999',
      },
    });

    // 4. Reopens account by name
    events.length = 0;
    const reopenRes = await gateway.manageAccounts({
      action: 'reopen',
      name: 'Old Checking',
    });
    expect(reopenRes).toEqual({
      success: true,
      message:
        'Reopened account "Old Checking" (88888888-8888-4888-8888-888888888888)',
      data: {
        id: '88888888-8888-4888-8888-888888888888',
        closed: false,
      },
      resolved: {
        'Old Checking': '88888888-8888-4888-8888-888888888888',
      },
    });
    expect(events).toEqual([
      'api:sync',
      'api:reopenAccount:88888888-8888-4888-8888-888888888888',
      'api:sync',
    ]);
  });
});

describe('manage_accounts Deep Resource Facade — MCP Server Seam', () => {
  it('registers manage_accounts on tools/list with readOnlyHint: false and destructiveHint: true and discriminated action enum', async () => {
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
    const manageAccountsTool = tools.find(
      (t: { name: string }) => t.name === 'manage_accounts',
    );
    expect(manageAccountsTool).toBeDefined();
    expect(manageAccountsTool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(manageAccountsTool.inputSchema?.properties?.action?.enum).toEqual([
      'create',
      'update',
      'close',
      'reopen',
    ]);
    expect(manageAccountsTool.inputSchema?.properties?.forced).toBeUndefined();

    for (const retiredTool of [
      'create_account',
      'update_account',
      'close_account',
      'reopen_account',
    ]) {
      expect(tools.find((t: { name: string }) => t.name === retiredTool)).toBeUndefined();
    }
  });

  it('executes create, update, close, and reopen actions through manage_accounts MCP tool and returns standardized envelopes and error suggestions', async () => {
    const balancesByAccount: Record<string, number> = {
      '88888888-8888-4888-8888-888888888888': 50000, // $500.00
      '99999999-9999-4999-8999-999999999999': 0,
    };

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Checking Account',
          offbudget: false,
          closed: false,
        },
        {
          id: '99999999-9999-4999-8999-999999999999',
          name: 'Savings Vault',
          offbudget: false,
          closed: false,
        },
      ],
      getAccountBalance: async (id) => balancesByAccount[id] ?? 0,
      createAccount: async () => 'acct-mcp-new',
      updateAccount: async () => undefined,
      closeAccount: async () => undefined,
      reopenAccount: async () => undefined,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });
    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    // 1. Create account via manage_accounts
    const createRes = await request(app)
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
          name: 'manage_accounts',
          arguments: {
            action: 'create',
            name: 'Brokerage',
            type: 'investment',
            offbudget: true,
            initialBalance: 10000.25,
          },
        },
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body.result?.isError).toBeFalsy();
    expect(JSON.parse(createRes.body.result.content[0].text)).toEqual({
      success: true,
      message: 'Created account "Brokerage" (acct-mcp-new)',
      data: {
        id: 'acct-mcp-new',
        name: 'Brokerage',
        type: 'investment',
        offbudget: true,
        initialBalance: 10000.25,
      },
    });

    // 2. Close non-zero account without transferTo returns isError: true with suggestions
    const closeFailRes = await request(app)
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
          name: 'manage_accounts',
          arguments: {
            action: 'close',
            account: 'Checking Account',
          },
        },
      });

    expect(closeFailRes.status).toBe(200);
    expect(closeFailRes.body.result?.isError).toBe(true);
    const closeFailBody = JSON.parse(closeFailRes.body.result.content[0].text);
    expect(closeFailBody.success).toBe(false);
    expect(closeFailBody.suggestions).toEqual(['Savings Vault']);

    // 3. Close with transferTo by name succeeds
    const closeOkRes = await request(app)
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
          name: 'manage_accounts',
          arguments: {
            action: 'close',
            account: 'Checking Account',
            transferTo: 'Savings Vault',
          },
        },
      });

    expect(closeOkRes.status).toBe(200);
    expect(closeOkRes.body.result?.isError).toBeFalsy();
    expect(JSON.parse(closeOkRes.body.result.content[0].text)).toEqual({
      success: true,
      message:
        'Closed account "Checking Account" (88888888-8888-4888-8888-888888888888) and transferred balance to "Savings Vault" (99999999-9999-4999-8999-999999999999)',
      data: {
        id: '88888888-8888-4888-8888-888888888888',
        closed: true,
        transferAccountId: '99999999-9999-4999-8999-999999999999',
      },
      resolved: {
        'Checking Account': '88888888-8888-4888-8888-888888888888',
        'Savings Vault': '99999999-9999-4999-8999-999999999999',
      },
    });

    // 4. Resolution failure on update returns isError: true with fuzzy match suggestions
    const notFoundRes = await request(app)
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
          name: 'manage_accounts',
          arguments: {
            action: 'update',
            name: 'Savngs Vault',
            newName: 'Emergency Vault',
          },
        },
      });

    expect(notFoundRes.status).toBe(200);
    expect(notFoundRes.body.result?.isError).toBe(true);
    const notFoundBody = JSON.parse(notFoundRes.body.result.content[0].text);
    expect(notFoundBody.success).toBe(false);
    expect(notFoundBody.entityType).toBe('account');
    expect(notFoundBody.suggestions).toContain('Savings Vault');
  });
});

