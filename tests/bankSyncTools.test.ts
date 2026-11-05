import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { BudgetGateway, BudgetReadiness, RunBankSyncResult } from '../src/gateway/types.js';
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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-banksync-test-'));
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

describe('Bank Synchronization MCP Tool Seam', () => {
  it('exposes run_bank_sync with correct readOnlyHint and destructiveHint annotations on tools/list', async () => {
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

    const syncTool = tools.find((t: { name: string }) => t.name === 'run_bank_sync');
    expect(syncTool).toBeDefined();
    expect(syncTool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it('invokes run_bank_sync via tools/call across all accounts when accountId is omitted', async () => {
    let capturedAccountId: string | undefined = 'initial-value';
    const mockResult: RunBankSyncResult = {
      updatedAccountIds: ['acct-1', 'acct-2'],
      newTransactionsCount: 5,
      matchedTransactionsCount: 2,
    };

    const gateway = createStubGateway({
      runBankSync: async (accountId) => {
        capturedAccountId = accountId;
        return mockResult;
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
          name: 'run_bank_sync',
          arguments: {},
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedAccountId).toBeUndefined();
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      updatedAccountIds: ['acct-1', 'acct-2'],
      newTransactionsCount: 5,
      matchedTransactionsCount: 2,
    });
  });

  it('invokes run_bank_sync via tools/call for a specific accountId', async () => {
    let capturedAccountId: string | undefined;
    const mockResult: RunBankSyncResult = {
      updatedAccountIds: ['acct-checking'],
      newTransactionsCount: 1,
      matchedTransactionsCount: 0,
    };

    const gateway = createStubGateway({
      runBankSync: async (accountId) => {
        capturedAccountId = accountId;
        return mockResult;
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
        id: 3,
        method: 'tools/call',
        params: {
          name: 'run_bank_sync',
          arguments: {
            accountId: 'acct-checking',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedAccountId).toBe('acct-checking');
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      updatedAccountIds: ['acct-checking'],
      newTransactionsCount: 1,
      matchedTransactionsCount: 0,
    });
  });

  it('invokes run_bank_sync via tools/call and returns reported errors in reconciliation report', async () => {
    const mockResult: RunBankSyncResult = {
      updatedAccountIds: [],
      newTransactionsCount: 0,
      matchedTransactionsCount: 0,
      errors: ['Bank connection timed out'],
    };

    const gateway = createStubGateway({
      runBankSync: async () => mockResult,
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
        id: 4,
        method: 'tools/call',
        params: {
          name: 'run_bank_sync',
          arguments: {
            accountId: 'acct-offline',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      updatedAccountIds: [],
      newTransactionsCount: 0,
      matchedTransactionsCount: 0,
      errors: ['Bank connection timed out'],
    });
  });

  it('rejects run_bank_sync via tools/call when accountId is empty string', async () => {
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
        id: 5,
        method: 'tools/call',
        params: {
          name: 'run_bank_sync',
          arguments: {
            accountId: '',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
  });

  it('returns error when runBankSync is not supported by gateway', async () => {
    const gateway = createStubGateway(); // does not implement runBankSync
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
          name: 'run_bank_sync',
          arguments: {},
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
    expect(callRes.body.result.content[0].text).toContain(
      'runBankSync is not supported by the configured BudgetGateway',
    );
  });
});
