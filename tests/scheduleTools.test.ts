import { createHash } from 'node:crypto';
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
  ActualScheduleRecord,
} from '../src/gateway/actualBudgetGateway.js';
import type { BudgetGateway, BudgetReadiness } from '../src/gateway/types.js';

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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-sched-test-'));
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
  const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/sched-test';
  const codeVerifier = 'sched-test-pkce-verifier-with-sufficient-entropy-0123456789';
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

describe('Schedule MCP Tools HTTP Seam', () => {
  it('exposes schedule tools with correct annotations on tools/list', async () => {
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

    const listSchedules = tools.find((t) => t.name === 'list_schedules');
    expect(listSchedules).toBeDefined();
    expect(listSchedules?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    });

    const getDates = tools.find((t) => t.name === 'get_schedule_upcoming_dates');
    expect(getDates).toBeDefined();
    expect(getDates?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    });

    const createSchedule = tools.find((t) => t.name === 'create_schedule');
    expect(createSchedule).toBeDefined();
    expect(createSchedule?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const updateSchedule = tools.find((t) => t.name === 'update_schedule');
    expect(updateSchedule).toBeDefined();
    expect(updateSchedule?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const deleteSchedule = tools.find((t) => t.name === 'delete_schedule');
    expect(deleteSchedule).toBeDefined();
    expect(deleteSchedule?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('handles list_schedules tool calls with Decimal Amounts', async () => {
    const listSchedulesFn = vi.fn().mockResolvedValue([
      {
        id: 'sched-1',
        name: 'Internet',
        rule: 'rule-1',
        next_date: '2026-12-01',
        completed: false,
        status: 'active' as const,
        posts_transaction: true,
        payee: 'payee-1',
        account: 'acct-1',
        amount: -79.99,
        amountOp: 'is',
        date: { frequency: 'monthly', start: '2026-11-01' },
      },
    ]);

    const gateway = createStubGateway({ listSchedules: listSchedulesFn });
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
          name: 'list_schedules',
          arguments: { forceSync: true },
        },
      });

    expect(res.status).toBe(200);
    expect(listSchedulesFn).toHaveBeenCalledWith({ forceSync: true });
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.schedules).toHaveLength(1);
    expect(parsed.schedules[0].amount).toBe(-79.99);
  });

  it('handles get_schedule_upcoming_dates tool call', async () => {
    const getDatesFn = vi.fn().mockResolvedValue(['2026-12-01', '2027-01-01', '2027-02-01']);
    const gateway = createStubGateway({ getScheduleDates: getDatesFn });
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
          name: 'get_schedule_upcoming_dates',
          arguments: {
            scheduleId: 'sched-1',
            count: 3,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(getDatesFn).toHaveBeenCalledWith({ scheduleId: 'sched-1', count: 3 });
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.dates).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
  });

  it('handles create_schedule tool call with Decimal Amount', async () => {
    const createScheduleFn = vi.fn().mockResolvedValue({ id: 'sched-new-1' });
    const gateway = createStubGateway({ createSchedule: createScheduleFn });
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
          name: 'create_schedule',
          arguments: {
            name: 'Gym Membership',
            account: 'acct-checking',
            amount: -45.5,
            amountOp: 'is',
            date: { frequency: 'monthly', start: '2026-11-15' },
            posts_transaction: false,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(createScheduleFn).toHaveBeenCalledWith({
      name: 'Gym Membership',
      account: 'acct-checking',
      amount: -45.5,
      amountOp: 'is',
      date: { frequency: 'monthly', start: '2026-11-15' },
      posts_transaction: false,
    });
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.id).toBe('sched-new-1');
  });

  it('handles update_schedule tool call', async () => {
    const updateScheduleFn = vi.fn().mockResolvedValue({ id: 'sched-1' });
    const gateway = createStubGateway({ updateSchedule: updateScheduleFn });
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
          name: 'update_schedule',
          arguments: {
            id: 'sched-1',
            amount: -85.0,
            resetNextDate: true,
          },
        },
      });

    expect(res.status).toBe(200);
    expect(updateScheduleFn).toHaveBeenCalledWith(
      'sched-1',
      { amount: -85.0 },
      true,
    );
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.id).toBe('sched-1');
  });

  it('handles delete_schedule tool call', async () => {
    const deleteScheduleFn = vi.fn().mockResolvedValue({ id: 'sched-1' });
    const gateway = createStubGateway({ deleteSchedule: deleteScheduleFn });
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
          name: 'delete_schedule',
          arguments: {
            id: 'sched-1',
          },
        },
      });

    expect(res.status).toBe(200);
    expect(deleteScheduleFn).toHaveBeenCalledWith('sched-1');
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed).toEqual({ success: true, id: 'sched-1' });
  });
});

describe('Schedule ActualBudgetGateway Seam', () => {
  it('converts minor units to Decimal Amounts on listSchedules', async () => {
    const mockSchedules: ActualScheduleRecord[] = [
      {
        id: 's-1',
        name: 'Rent',
        rule: 'r-1',
        next_date: '2026-12-01',
        completed: false,
        posts_transaction: true,
        payee: 'p-1',
        account: 'a-1',
        amount: -150000,
        amountOp: 'is',
        date: { frequency: 'monthly', start: '2026-11-01' },
      },
      {
        id: 's-2',
        name: 'Electric Range',
        rule: 'r-2',
        next_date: '2026-12-15',
        completed: false,
        posts_transaction: false,
        payee: 'p-2',
        account: 'a-1',
        amount: { num1: -10000, num2: -5000 },
        amountOp: 'isbetween',
        date: { frequency: 'monthly', start: '2026-11-15' },
      },
    ];

    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getSchedules: async () => mockSchedules,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const schedules = await gateway.listSchedules();
    expect(schedules).toHaveLength(2);
    expect(schedules[0].amount).toBe(-1500.0);
    expect(schedules[0].status).toBe('active');
    expect(schedules[1].amount).toEqual({ num1: -100.0, num2: -50.0 });
  });

  it('falls back to today when start is omitted in getScheduleDates', async () => {
    const getScheduleDatesMock = vi.fn().mockResolvedValue(['2026-11-05']);
    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getScheduleDates: getScheduleDatesMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
      now: () => new Date('2026-11-05T12:00:00Z').getTime(),
    });

    const dates = await gateway.getScheduleDates({ date: '2026-11-05' });
    expect(dates).toEqual(['2026-11-05']);
    expect(getScheduleDatesMock).toHaveBeenCalledWith('2026-11-05', {
      start: '2026-11-05',
      count: 10,
    });
  });

  it('converts Decimal Amounts to minor units on createSchedule and updateSchedule', async () => {
    const createScheduleMock = vi.fn().mockResolvedValue('s-created');
    const updateScheduleMock = vi.fn().mockResolvedValue('s-created');
    const syncMock = vi.fn().mockResolvedValue(undefined);

    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      createSchedule: createScheduleMock,
      updateSchedule: updateScheduleMock,
      sync: syncMock,
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const created = await gateway.createSchedule({
      name: 'Internet',
      account: 'a-1',
      amount: -79.99,
      date: '2026-12-01',
    });
    expect(created.id).toBe('s-created');
    expect(createScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: -7999,
      }),
    );

    await gateway.updateSchedule('s-created', { amount: -85.5 });
    expect(updateScheduleMock).toHaveBeenCalledWith(
      's-created',
      expect.objectContaining({
        amount: -8550,
      }),
      undefined,
    );
  });
});
