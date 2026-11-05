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

describe('Account Lifecycle Management MCP Tools Seam', () => {
  it('exposes account lifecycle tools with correct readOnlyHint and destructiveHint annotations on tools/list', async () => {
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

    const createAcct = tools.find((t: { name: string }) => t.name === 'create_account');
    expect(createAcct).toBeDefined();
    expect(createAcct.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const updateAcct = tools.find((t: { name: string }) => t.name === 'update_account');
    expect(updateAcct).toBeDefined();
    expect(updateAcct.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(updateAcct.inputSchema?.properties?.closed).toBeUndefined();

    const closeAcct = tools.find((t: { name: string }) => t.name === 'close_account');
    expect(closeAcct).toBeDefined();
    expect(closeAcct.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });

    const reopenAcct = tools.find((t: { name: string }) => t.name === 'reopen_account');
    expect(reopenAcct).toBeDefined();
    expect(reopenAcct.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it('invokes create_account via tools/call and returns created account ID', async () => {
    let capturedAccount: unknown;
    let capturedBalance: unknown;
    const gateway = createStubGateway({
      createAccount: async (account, initialBalance) => {
        capturedAccount = account;
        capturedBalance = initialBalance;
        return { id: 'acct-new-123' };
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
          name: 'create_account',
          arguments: {
            name: 'Checking Account',
            type: 'checking',
            offbudget: false,
            initialBalance: 1250.5,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedAccount).toEqual({
      name: 'Checking Account',
      type: 'checking',
      offbudget: false,
    });
    expect(capturedBalance).toBe(1250.5);
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'acct-new-123',
    });
  });

  it('rejects create_account via tools/call when type is not in supported enum', async () => {
    const gateway = createStubGateway({
      createAccount: async () => ({ id: 'never-called' }),
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
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_account',
          arguments: {
            name: 'Crypto Vault',
            type: 'crypto_wallet', // invalid enum value
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
  });

  it('rejects create_account via tools/call when required name is missing', async () => {
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
        id: 4,
        method: 'tools/call',
        params: {
          name: 'create_account',
          arguments: {
            type: 'savings',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
  });

  it('invokes update_account via tools/call and returns updated account ID', async () => {
    let capturedId: unknown;
    let capturedFields: unknown;
    const gateway = createStubGateway({
      updateAccount: async (id, fields) => {
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
          name: 'update_account',
          arguments: {
            id: 'acct-456',
            name: 'Emergency Fund',
            offbudget: true,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedId).toBe('acct-456');
    expect(capturedFields).toEqual({
      name: 'Emergency Fund',
      offbudget: true,
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'acct-456',
    });
  });

  it('rejects update_account via tools/call when id is missing', async () => {
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
        id: 6,
        method: 'tools/call',
        params: {
          name: 'update_account',
          arguments: {
            name: 'New Name',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
  });

  it('invokes close_account via tools/call with optional balance transfer targets', async () => {
    let capturedId: unknown;
    let capturedTransferAcct: unknown;
    let capturedTransferCat: unknown;
    const gateway = createStubGateway({
      closeAccount: async (id, transferAccountId, transferCategoryId) => {
        capturedId = id;
        capturedTransferAcct = transferAccountId;
        capturedTransferCat = transferCategoryId;
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
        id: 7,
        method: 'tools/call',
        params: {
          name: 'close_account',
          arguments: {
            id: 'acct-closing',
            transferAccountId: 'acct-destination',
            transferCategoryId: 'cat-reassignment',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedId).toBe('acct-closing');
    expect(capturedTransferAcct).toBe('acct-destination');
    expect(capturedTransferCat).toBe('cat-reassignment');
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'acct-closing',
    });
  });

  it('returns error when closing an account with non-zero balance without transferAccountId', async () => {
    const gateway = createStubGateway({
      closeAccount: async (id, transferAccountId) => {
        if (!transferAccountId) {
          throw new Error(
            `Cannot close account "${id}" with non-zero balance (5000) without specifying transferAccountId.`,
          );
        }
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
        id: 71,
        method: 'tools/call',
        params: {
          name: 'close_account',
          arguments: {
            id: 'acct-with-balance',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
    expect(callRes.body.result.content[0].text).toContain(
      'Cannot close account "acct-with-balance" with non-zero balance (5000) without specifying transferAccountId.',
    );
  });

  it('invokes reopen_account via tools/call and reactivates a closed account', async () => {
    let capturedId: unknown;
    const gateway = createStubGateway({
      reopenAccount: async (id) => {
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
          name: 'reopen_account',
          arguments: {
            id: 'acct-reopening',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedId).toBe('acct-reopening');
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'acct-reopening',
    });
  });
});
