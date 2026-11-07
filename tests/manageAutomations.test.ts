import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import {
  createActualBudgetGateway,
  type ActualApiAdapter,
  type ActualRuleRecord,
  type ActualScheduleRecord,
} from '../src/gateway/actualBudgetGateway.js';
import { EntityResolutionError } from '../src/gateway/resolver.js';
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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-automations-test-'));
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

describe('manage_automations MCP Tool Seam', () => {
  it('exposes manage_automations tool with readOnlyHint: false and destructiveHint: true on tools/list and delegates to gateway.manageAutomations', async () => {
    const manageAutomationsFn = vi.fn().mockResolvedValue({
      success: true,
      message: 'Created schedule "Internet"',
      data: { id: 'sched-new-1' },
      resolved: { 'Main Checking': '88888888-8888-4888-8888-888888888888' },
    });

    const gateway = createStubGateway({ manageAutomations: manageAutomationsFn });
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

    const manageAutomationsTool = tools.find((t) => t.name === 'manage_automations');
    expect(manageAutomationsTool).toBeDefined();
    expect(manageAutomationsTool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });

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
          name: 'manage_automations',
          arguments: {
            target: 'schedule',
            action: 'create',
            name: 'Internet',
            account: 'Main Checking',
            amount: -79.99,
            date: { frequency: 'monthly', start: '2026-11-01' },
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(manageAutomationsFn).toHaveBeenCalledWith({
      target: 'schedule',
      action: 'create',
      name: 'Internet',
      account: 'Main Checking',
      amount: -79.99,
      date: { frequency: 'monthly', start: '2026-11-01' },
    });

    const parsed = JSON.parse(callRes.body.result.content[0].text);
    expect(parsed).toEqual({
      success: true,
      message: 'Created schedule "Internet"',
      data: { id: 'sched-new-1' },
      resolved: { 'Main Checking': '88888888-8888-4888-8888-888888888888' },
    });
  });

  it('returns structured error envelope with suggestions over /mcp tools/call when EntityResolutionError is thrown', async () => {
    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Main Checking',
          offbudget: false,
          closed: false,
        },
      ],
      getAccountBalance: async () => 0,
      createSchedule: vi.fn(),
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
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
          name: 'manage_automations',
          arguments: {
            target: 'schedule',
            action: 'create',
            name: 'Internet',
            account: 'Main Checkin',
            amount: -79.99,
            date: { frequency: 'monthly', start: '2026-11-01' },
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
    const payload = JSON.parse(callRes.body.result.content[0].text);
    expect(payload.success).toBe(false);
    expect(payload.entityType).toBe('account');
    expect(payload.input).toBe('Main Checkin');
    expect(payload.suggestions).toContain('Main Checking');
  });
});

describe('manageAutomations ActualBudgetGateway Seam - Schedule Target', () => {
  it('creates a schedule resolving account and payee names in-process and converting Decimal Amounts to minor units', async () => {
    const createScheduleMock = vi.fn().mockResolvedValue('sched-created-1');
    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Main Checking',
          offbudget: false,
          closed: false,
        },
      ],
      getAccountBalance: async () => 250000,
      getPayees: async () => [
        {
          id: '66666666-6666-4666-8666-666666666666',
          name: 'Comcast',
          transfer_acct: null,
        },
      ],
      createSchedule: createScheduleMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const result = await gateway.manageAutomations({
      target: 'schedule',
      action: 'create',
      name: 'Internet Bill',
      account: 'Main Checking',
      payee: 'Comcast',
      amount: -79.99,
      amountOp: 'is',
      date: { frequency: 'monthly', start: '2026-12-01' },
      postsTransaction: true,
    });

    expect(createScheduleMock).toHaveBeenCalledWith({
      name: 'Internet Bill',
      account: '88888888-8888-4888-8888-888888888888',
      payee: '66666666-6666-4666-8666-666666666666',
      amount: -7999,
      amountOp: 'is',
      date: { frequency: 'monthly', start: '2026-12-01' },
      posts_transaction: true,
    });

    expect(result).toEqual({
      success: true,
      message: expect.stringContaining('Internet Bill'),
      data: expect.objectContaining({
        id: 'sched-created-1',
      }),
      resolved: {
        'Main Checking': '88888888-8888-4888-8888-888888888888',
        Comcast: '66666666-6666-4666-8666-666666666666',
      },
    });
  });

  it('supports schedule creation with accountId/payeeId UUIDs and between range Decimal Amounts', async () => {
    const createScheduleMock = vi.fn().mockResolvedValue('sched-range-1');
    const getAccountsMock = vi.fn();
    const getPayeesMock = vi.fn();
    const mockApi: ActualApiAdapter = {
      getAccounts: getAccountsMock,
      getAccountBalance: async () => 0,
      getPayees: getPayeesMock,
      createSchedule: createScheduleMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const acctUuid = '88888888-8888-4888-8888-888888888888';
    const payeeUuid = '66666666-6666-4666-8666-666666666666';

    const result = await gateway.manageAutomations({
      target: 'schedule',
      action: 'create',
      name: 'Electric Utility',
      accountId: acctUuid,
      payeeId: payeeUuid,
      amount: { num1: -120.5, num2: -65.25 },
      amountOp: 'isbetween',
      date: '2026-12-15',
    });

    expect(createScheduleMock).toHaveBeenCalledWith({
      name: 'Electric Utility',
      account: acctUuid,
      payee: payeeUuid,
      amount: { num1: -12050, num2: -6525 },
      amountOp: 'isbetween',
      date: '2026-12-15',
      posts_transaction: false,
    });
    expect(getAccountsMock).not.toHaveBeenCalled();
    expect(getPayeesMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.resolved).toBeUndefined();
  });

  it('updates an existing schedule by name or id, resolving linked account/payee names and passing resetNextDate', async () => {
    const updateScheduleMock = vi.fn().mockResolvedValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const mockSchedules: ActualScheduleRecord[] = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Gym Membership',
      },
    ];
    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '99999999-9999-4999-8999-999999999999',
          name: 'High Yield Savings',
          offbudget: false,
          closed: false,
        },
      ],
      getAccountBalance: async () => 0,
      getPayees: async () => [
        {
          id: '77777777-7777-4777-8777-777777777777',
          name: 'Planet Fitness',
          transfer_acct: null,
        },
      ],
      getSchedules: async () => mockSchedules,
      updateSchedule: updateScheduleMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const result = await gateway.manageAutomations({
      target: 'schedule',
      action: 'update',
      id: 'Gym Membership',
      name: 'Planet Fitness Monthly',
      account: 'High Yield Savings',
      payee: 'Planet Fitness',
      amount: -24.99,
      postsTransaction: true,
      resetNextDate: true,
    });

    expect(updateScheduleMock).toHaveBeenCalledWith(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      {
        name: 'Planet Fitness Monthly',
        account: '99999999-9999-4999-8999-999999999999',
        payee: '77777777-7777-4777-8777-777777777777',
        amount: -2499,
        posts_transaction: true,
      },
      true,
    );

    expect(result).toEqual({
      success: true,
      message: expect.stringContaining('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      data: expect.objectContaining({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Planet Fitness Monthly',
      }),
      resolved: {
        'Gym Membership': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'High Yield Savings': '99999999-9999-4999-8999-999999999999',
        'Planet Fitness': '77777777-7777-4777-8777-777777777777',
      },
    });
  });

  it('deletes an existing schedule resolved by name or id', async () => {
    const deleteScheduleMock = vi.fn().mockResolvedValue(undefined);
    const mockSchedules: ActualScheduleRecord[] = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Monthly Rent',
      },
    ];
    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getSchedules: async () => mockSchedules,
      deleteSchedule: deleteScheduleMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const result = await gateway.manageAutomations({
      target: 'schedule',
      action: 'delete',
      name: 'monthly rent',
    });

    expect(deleteScheduleMock).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(result).toEqual({
      success: true,
      message: expect.stringContaining('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      data: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      resolved: {
        'monthly rent': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });
  });

  it('previews upcoming occurrence dates for an existing schedule (by name or id) or an explicit recurrence date config', async () => {
    const getScheduleDatesMock = vi
      .fn()
      .mockResolvedValue(['2026-12-01', '2027-01-01', '2027-02-01']);
    const mockSchedules: ActualScheduleRecord[] = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Monthly Rent',
        date: { frequency: 'monthly', start: '2026-11-01' },
      },
    ];
    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getSchedules: async () => mockSchedules,
      getScheduleDates: getScheduleDatesMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
      now: () => new Date('2026-11-15T12:00:00Z').getTime(),
    });

    const byNameResult = await gateway.manageAutomations({
      target: 'schedule',
      action: 'preview_dates',
      name: 'Monthly Rent',
      count: 3,
    });

    expect(getScheduleDatesMock).toHaveBeenCalledWith(
      { frequency: 'monthly', start: '2026-11-01' },
      { start: '2026-11-15', count: 3 },
    );
    expect(byNameResult).toEqual({
      success: true,
      message: expect.stringContaining('3'),
      data: {
        scheduleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        dates: ['2026-12-01', '2027-01-01', '2027-02-01'],
      },
      resolved: {
        'Monthly Rent': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });

    getScheduleDatesMock.mockClear();
    const explicitConfig = { frequency: 'weekly', start: '2026-11-20' };
    const byDateResult = await gateway.manageAutomations({
      target: 'schedule',
      action: 'preview_dates',
      date: explicitConfig,
    });

    expect(getScheduleDatesMock).toHaveBeenCalledWith(explicitConfig, {
      start: '2026-11-15',
      count: 10,
    });
    expect(byDateResult).toEqual({
      success: true,
      message: expect.stringContaining('3'),
      data: {
        dates: ['2026-12-01', '2027-01-01', '2027-02-01'],
      },
    });
  });
});

describe('manageAutomations ActualBudgetGateway Seam - Rule Target', () => {
  it('creates a rule resolving payee, account, and category names in conditions and actions and converting Decimal Amounts to minor units', async () => {
    const createRuleMock = vi.fn().mockImplementation(async (payload) => ({
      id: 'rule-created-1',
      ...payload,
    }));

    const getPayeesSpy = vi.fn(async () => [
      {
        id: '66666666-6666-4666-8666-666666666666',
        name: 'Starbucks',
        transfer_acct: null,
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        name: 'Peets Coffee',
        transfer_acct: null,
      },
    ]);

    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Main Checking',
          offbudget: false,
          closed: false,
        },
      ],
      getAccountBalance: async () => 0,
      getPayees: getPayeesSpy,
      getCategoryGroups: async () => [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Frequent Spending',
          categories: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Coffee Shops',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        },
      ],
      createRule: createRuleMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const result = await gateway.manageAutomations({
      target: 'rule',
      action: 'create',
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { field: 'payee', op: 'oneOf', value: ['Starbucks', 'Peets Coffee'] },
        { field: 'account', op: 'is', value: 'Main Checking' },
        { field: 'amount', op: 'isbetween', value: { num1: -25.0, num2: -2.5 } },
      ],
      actions: [
        { field: 'category', op: 'set', value: 'Coffee Shops' },
        { op: 'set-split-amount', value: -10.25 },
      ],
    });

    expect(createRuleMock).toHaveBeenCalledWith({
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        {
          field: 'payee',
          op: 'oneOf',
          value: [
            '66666666-6666-4666-8666-666666666666',
            '77777777-7777-4777-8777-777777777777',
          ],
        },
        {
          field: 'account',
          op: 'is',
          value: '88888888-8888-4888-8888-888888888888',
        },
        {
          field: 'amount',
          op: 'isbetween',
          value: { num1: -2500, num2: -250 },
        },
      ],
      actions: [
        {
          field: 'category',
          op: 'set',
          value: '33333333-3333-4333-8333-333333333333',
        },
        {
          op: 'set-split-amount',
          value: -1025,
        },
      ],
    });

    expect(result).toEqual({
      success: true,
      message: expect.stringContaining('rule-created-1'),
      data: {
        id: 'rule-created-1',
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [
          {
            field: 'payee',
            op: 'oneOf',
            value: [
              '66666666-6666-4666-8666-666666666666',
              '77777777-7777-4777-8777-777777777777',
            ],
          },
          {
            field: 'account',
            op: 'is',
            value: '88888888-8888-4888-8888-888888888888',
          },
          {
            field: 'amount',
            op: 'isbetween',
            value: { num1: -25.0, num2: -2.5 },
          },
        ],
        actions: [
          {
            field: 'category',
            op: 'set',
            value: '33333333-3333-4333-8333-333333333333',
          },
          {
            op: 'set-split-amount',
            value: -10.25,
          },
        ],
      },
      resolved: {
        Starbucks: '66666666-6666-4666-8666-666666666666',
        'Peets Coffee': '77777777-7777-4777-8777-777777777777',
        'Main Checking': '88888888-8888-4888-8888-888888888888',
        'Coffee Shops': '33333333-3333-4333-8333-333333333333',
      },
    });
    expect(getPayeesSpy).toHaveBeenCalledTimes(1);
  });

  it('updates and deletes an existing rule by id and resolves linked entity names', async () => {
    const updateRuleMock = vi.fn().mockImplementation(async (payload) => ({
      ...payload,
    }));
    const deleteRuleMock = vi.fn().mockResolvedValue(undefined);

    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getPayees: async () => [
        {
          id: '66666666-6666-4666-8666-666666666666',
          name: 'Starbucks',
          transfer_acct: null,
        },
      ],
      getCategoryGroups: async () => [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Frequent Spending',
          categories: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Coffee Shops',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        },
      ],
      updateRule: updateRuleMock,
      deleteRule: deleteRuleMock,
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    const updateResult = await gateway.manageAutomations({
      target: 'rule',
      action: 'update',
      id: 'rule-101',
      stage: null,
      conditionsOp: 'or',
      conditions: [
        { field: 'payee', op: 'is', value: 'Starbucks' },
        { field: 'payee', op: 'contains', value: 'STARBUCKS STORE' },
      ],
      actions: [
        { field: 'category', op: 'set', value: 'Coffee Shops' },
      ],
    });

    expect(updateRuleMock).toHaveBeenCalledWith({
      id: 'rule-101',
      stage: null,
      conditionsOp: 'or',
      conditions: [
        { field: 'payee', op: 'is', value: '66666666-6666-4666-8666-666666666666' },
        { field: 'payee', op: 'contains', value: 'STARBUCKS STORE' },
      ],
      actions: [
        { field: 'category', op: 'set', value: '33333333-3333-4333-8333-333333333333' },
      ],
    });
    expect(updateResult.success).toBe(true);
    expect(updateResult.data).toEqual({
      id: 'rule-101',
      stage: 'default',
      conditionsOp: 'or',
      conditions: [
        { field: 'payee', op: 'is', value: '66666666-6666-4666-8666-666666666666' },
        { field: 'payee', op: 'contains', value: 'STARBUCKS STORE' },
      ],
      actions: [
        { field: 'category', op: 'set', value: '33333333-3333-4333-8333-333333333333' },
      ],
    });
    expect(updateResult.resolved).toEqual({
      Starbucks: '66666666-6666-4666-8666-666666666666',
      'Coffee Shops': '33333333-3333-4333-8333-333333333333',
    });

    const deleteResult = await gateway.manageAutomations({
      target: 'rule',
      action: 'delete',
      id: 'rule-101',
    });

    expect(deleteRuleMock).toHaveBeenCalledWith('rule-101');
    expect(deleteResult).toEqual({
      success: true,
      message: expect.stringContaining('rule-101'),
      data: { id: 'rule-101' },
    });
  });

  it('throws EntityResolutionError with suggestions when a referenced entity name in schedule or rule is not found', async () => {
    const mockApi: ActualApiAdapter = {
      getAccounts: async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Main Checking',
          offbudget: false,
          closed: false,
        },
      ],
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Frequent Spending',
          categories: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Coffee Shops',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        },
      ],
      createRule: vi.fn(),
      sync: vi.fn().mockResolvedValue(undefined),
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: mockApi,
    });

    await expect(
      gateway.manageAutomations({
        target: 'rule',
        action: 'create',
        conditions: [{ field: 'account', op: 'is', value: 'Main Checkin' }],
        actions: [{ field: 'category', op: 'set', value: 'Coffee Shops' }],
      }),
    ).rejects.toThrow(EntityResolutionError);

    try {
      await gateway.manageAutomations({
        target: 'rule',
        action: 'create',
        conditions: [{ field: 'account', op: 'is', value: 'Main Checkin' }],
        actions: [{ field: 'category', op: 'set', value: 'Coffee Shops' }],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EntityResolutionError);
      const resErr = error as EntityResolutionError;
      expect(resErr.entityType).toBe('account');
      expect(resErr.suggestions).toContain('Main Checking');
    }
  });
});



