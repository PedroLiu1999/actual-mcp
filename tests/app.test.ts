import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { AccountSummary, BudgetGateway, BudgetReadiness } from '../src/gateway/types.js';

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
    OAUTH_CLIENT_ID: 'gemini-client',
    OAUTH_CLIENT_SECRET: 'super-secret',
    OAUTH_ADMIN_PASSWORD: 'admin-password',
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_PASSWORD: 'actual-password',
    ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
  });
});

afterEach(() => {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

async function issueBearerToken(app: Express): Promise<string> {
  const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/app-test';
  const codeVerifier = 'app-test-pkce-verifier-with-sufficient-entropy-0123456789';
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const authRes = await request(app)
    .post('/authorize')
    .set('Host', 'mcp.example.com')
    .type('form')
    .send({
      response_type: 'code',
      client_id: testConfig.OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      password: testConfig.OAUTH_ADMIN_PASSWORD,
    });

  const code = new URL(authRes.headers.location).searchParams.get('code')!;
  const tokenRes = await request(app)
    .post('/token')
    .set('Host', 'mcp.example.com')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: testConfig.OAUTH_CLIENT_ID,
      client_secret: testConfig.OAUTH_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });

  return tokenRes.body.access_token as string;
}

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
});

