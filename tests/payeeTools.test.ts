import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
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

describe('Payee Management and Merge MCP Tools Seam', () => {
  it('exposes payee management and merge tools with correct readOnlyHint and destructiveHint annotations on tools/list', async () => {
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
    const tools = listRes.body.result.tools;

    const createPayee = tools.find((t: { name: string }) => t.name === 'create_payee');
    expect(createPayee).toBeDefined();
    expect(createPayee.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const updatePayee = tools.find((t: { name: string }) => t.name === 'update_payee');
    expect(updatePayee).toBeDefined();
    expect(updatePayee.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const deletePayee = tools.find((t: { name: string }) => t.name === 'delete_payee');
    expect(deletePayee).toBeDefined();
    expect(deletePayee.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });

    const mergePayees = tools.find((t: { name: string }) => t.name === 'merge_payees');
    expect(mergePayees).toBeDefined();
    expect(mergePayees.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('invokes create_payee via tools/call and returns the created payee record with its generated ID', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      createPayee: async (payee) => {
        capturedInput = payee;
        return { id: 'payee-tj-123' };
      },
    });

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

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
          name: 'create_payee',
          arguments: {
            name: "Trader Joe's",
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      name: "Trader Joe's",
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'payee-tj-123',
    });
  });

  it('rejects create_payee via tools/call when name is missing or empty', async () => {
    const gateway = createStubGateway();
    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const callResMissing = await request(app)
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
          name: 'create_payee',
          arguments: {},
        },
      });

    expect(callResMissing.status).toBe(200);
    expect(callResMissing.body.result?.isError).toBe(true);

    const callResEmpty = await request(app)
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
          name: 'create_payee',
          arguments: { name: '' },
        },
      });

    expect(callResEmpty.status).toBe(200);
    expect(callResEmpty.body.result?.isError).toBe(true);
  });

  it('invokes update_payee via tools/call and updates the merchant title', async () => {
    let capturedId: string | undefined;
    let capturedFields: unknown;
    const gateway = createStubGateway({
      updatePayee: async (id, fields) => {
        capturedId = id;
        capturedFields = fields;
        return { id };
      },
    });

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const callRes = await request(app)
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
          name: 'update_payee',
          arguments: {
            id: 'payee-tj-123',
            name: "Trader Joe's Market",
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedId).toBe('payee-tj-123');
    expect(capturedFields).toEqual({
      name: "Trader Joe's Market",
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'payee-tj-123',
    });
  });

  it('rejects update_payee via tools/call when id or name is missing or empty', async () => {
    const gateway = createStubGateway();
    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const callResMissingName = await request(app)
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
          name: 'update_payee',
          arguments: { id: 'payee-tj-123' },
        },
      });

    expect(callResMissingName.status).toBe(200);
    expect(callResMissingName.body.result?.isError).toBe(true);

    const callResEmptyName = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'update_payee',
          arguments: { id: 'payee-tj-123', name: '' },
        },
      });

    expect(callResEmptyName.status).toBe(200);
    expect(callResEmptyName.body.result?.isError).toBe(true);
  });

  it('invokes delete_payee via tools/call and deletes the payee record', async () => {
    let capturedId: string | undefined;
    const gateway = createStubGateway({
      deletePayee: async (id) => {
        capturedId = id;
        return { id };
      },
    });

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const callRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'delete_payee',
          arguments: {
            id: 'payee-obsolete-999',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedId).toBe('payee-obsolete-999');
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'payee-obsolete-999',
    });
  });

  it('rejects delete_payee via tools/call when id is missing or empty', async () => {
    const gateway = createStubGateway();
    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const callRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'delete_payee',
          arguments: { id: '' },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
  });

  it('invokes merge_payees via tools/call, consolidating source payees under target payee', async () => {
    let capturedTargetId: string | undefined;
    let capturedMergeIds: string[] | undefined;
    const gateway = createStubGateway({
      mergePayees: async (targetId, mergeIds) => {
        capturedTargetId = targetId;
        capturedMergeIds = mergeIds;
        return { targetId, mergedCount: mergeIds.length };
      },
    });

    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const callRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'merge_payees',
          arguments: {
            targetPayeeId: 'payee-canonical',
            sourcePayeeIds: ['payee-dup-1', 'payee-dup-2'],
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedTargetId).toBe('payee-canonical');
    expect(capturedMergeIds).toEqual(['payee-dup-1', 'payee-dup-2']);
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      targetId: 'payee-canonical',
      mergedCount: 2,
    });
  });

  it('rejects merge_payees via tools/call when sourcePayeeIds is empty or missing', async () => {
    const gateway = createStubGateway();
    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

    const callResEmpty = await request(app)
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
          name: 'merge_payees',
          arguments: {
            targetPayeeId: 'payee-canonical',
            sourcePayeeIds: [],
          },
        },
      });

    expect(callResEmpty.status).toBe(200);
    expect(callResEmpty.body.result?.isError).toBe(true);

    const callResMissingTarget = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'merge_payees',
          arguments: {
            sourcePayeeIds: ['payee-dup-1'],
          },
        },
      });

    expect(callResMissingTarget.status).toBe(200);
    expect(callResMissingTarget.body.result?.isError).toBe(true);
  });

  it('returns tool execution error when gateway methods are not supported', async () => {
    const gateway = createStubGateway({
      createPayee: undefined,
      updatePayee: undefined,
      deletePayee: undefined,
      mergePayees: undefined,
    });
    const app = createApp({ config: testConfig, budgetGateway: gateway });
    const token = await issueBearerToken(app);

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
          name: 'create_payee',
          arguments: { name: 'Acme' },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
    expect(callRes.body.result.content[0].text).toContain(
      'createPayee is not supported by the configured BudgetGateway',
    );
  });
});
