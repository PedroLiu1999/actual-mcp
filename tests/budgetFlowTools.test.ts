import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { BudgetGateway, BudgetReadiness } from '../src/gateway/types.js';

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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-flow-test-'));
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
  const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/flow-test';
  const codeVerifier = 'flow-test-pkce-verifier-with-sufficient-entropy-0123456789';
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

describe('Budget Flow Adjustment MCP Tools Seam', () => {
  it('exposes set_budget_carryover, hold_budget_for_next_month, and reset_budget_hold tools with correct readOnlyHint: false and destructiveHint: false on tools/list', async () => {
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

    const carryoverTool = tools.find((t: { name: string }) => t.name === 'set_budget_carryover');
    expect(carryoverTool).toBeDefined();
    expect(carryoverTool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const holdTool = tools.find((t: { name: string }) => t.name === 'hold_budget_for_next_month');
    expect(holdTool).toBeDefined();
    expect(holdTool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const resetTool = tools.find((t: { name: string }) => t.name === 'reset_budget_hold');
    expect(resetTool).toBeDefined();
    expect(resetTool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  describe('set_budget_carryover tool', () => {
    it('invokes set_budget_carryover via tools/call with month, categoryId, and carryover flag', async () => {
      let capturedArgs: { month: string; categoryId: string; carryover: boolean } | undefined;
      const gateway = createStubGateway({
        setBudgetCarryover: async (month, categoryId, carryover) => {
          capturedArgs = { month, categoryId, carryover };
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
            name: 'set_budget_carryover',
            arguments: {
              month: '2026-11',
              categoryId: 'cat-groceries',
              carryover: true,
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBeFalsy();
      expect(capturedArgs).toEqual({
        month: '2026-11',
        categoryId: 'cat-groceries',
        carryover: true,
      });
      const parsedContent = JSON.parse(callRes.body.result.content[0].text);
      expect(parsedContent).toMatchObject({
        success: true,
        month: '2026-11',
        categoryId: 'cat-groceries',
        carryover: true,
      });
    });

    it('rejects invalid month format in set_budget_carryover', async () => {
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
          id: 11,
          method: 'tools/call',
          params: {
            name: 'set_budget_carryover',
            arguments: {
              month: '2026-1',
              categoryId: 'cat-groceries',
              carryover: true,
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBe(true);
    });

    it('returns an error if setBudgetCarryover is unsupported on gateway', async () => {
      const gateway = createStubGateway(); // setBudgetCarryover undefined
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
          id: 12,
          method: 'tools/call',
          params: {
            name: 'set_budget_carryover',
            arguments: {
              month: '2026-11',
              categoryId: 'cat-groceries',
              carryover: false,
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBe(true);
    });
  });

  describe('hold_budget_for_next_month tool', () => {
    it('invokes hold_budget_for_next_month via tools/call with Decimal Amount and returns success', async () => {
      let capturedArgs: { month: string; amount: number } | undefined;
      const gateway = createStubGateway({
        holdBudgetForNextMonth: async (month, amount) => {
          capturedArgs = { month, amount };
          return true;
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
          id: 20,
          method: 'tools/call',
          params: {
            name: 'hold_budget_for_next_month',
            arguments: {
              month: '2026-11',
              amount: 250.75,
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBeFalsy();
      expect(capturedArgs).toEqual({
        month: '2026-11',
        amount: 250.75,
      });
      const parsedContent = JSON.parse(callRes.body.result.content[0].text);
      expect(parsedContent).toMatchObject({
        success: true,
        month: '2026-11',
        amount: 250.75,
      });
    });

    it('rejects missing or non-finite amount for hold_budget_for_next_month', async () => {
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
          id: 21,
          method: 'tools/call',
          params: {
            name: 'hold_budget_for_next_month',
            arguments: {
              month: '2026-11',
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBe(true);
    });

    it('returns an error if holdBudgetForNextMonth is unsupported on gateway', async () => {
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
          id: 22,
          method: 'tools/call',
          params: {
            name: 'hold_budget_for_next_month',
            arguments: {
              month: '2026-11',
              amount: 100,
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBe(true);
    });
  });

  describe('reset_budget_hold tool', () => {
    it('invokes reset_budget_hold via tools/call with month and returns success', async () => {
      let capturedMonth: string | undefined;
      const gateway = createStubGateway({
        resetBudgetHold: async (month) => {
          capturedMonth = month;
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
          id: 30,
          method: 'tools/call',
          params: {
            name: 'reset_budget_hold',
            arguments: {
              month: '2026-11',
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBeFalsy();
      expect(capturedMonth).toBe('2026-11');
      const parsedContent = JSON.parse(callRes.body.result.content[0].text);
      expect(parsedContent).toMatchObject({
        success: true,
        month: '2026-11',
      });
    });

    it('rejects invalid month format in reset_budget_hold', async () => {
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
          id: 31,
          method: 'tools/call',
          params: {
            name: 'reset_budget_hold',
            arguments: {
              month: 'invalid-month',
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBe(true);
    });

    it('returns an error if resetBudgetHold is unsupported on gateway', async () => {
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
          id: 32,
          method: 'tools/call',
          params: {
            name: 'reset_budget_hold',
            arguments: {
              month: '2026-11',
            },
          },
        });

      expect(callRes.status).toBe(200);
      expect(callRes.body.result?.isError).toBe(true);
    });
  });
});
