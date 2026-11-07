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
  type ActualCategoryGroupRecord,
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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-cat-test-'));
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

describe('Category and Category Group MCP Tools Seam', () => {
  it('exposes manage_categories on tools/list and omits retired shallow category and group CRUD tools', async () => {
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

    const manageCategories = tools.find((t: { name: string }) => t.name === 'manage_categories');
    expect(manageCategories).toBeDefined();
    expect(manageCategories.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });

    for (const retiredTool of [
      'create_category',
      'update_category',
      'delete_category',
      'create_category_group',
      'update_category_group',
      'delete_category_group',
    ]) {
      expect(tools.find((t: { name: string }) => t.name === retiredTool)).toBeUndefined();
    }
  });

  it('invokes manage_categories via tools/call with default target "category" and returns the standardized envelope', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      manageCategories: async (input) => {
        capturedInput = input;
        return {
          success: true as const,
          message: 'Created category "Netflix" (cat-netflix) in group "Subscriptions" (grp-subs).',
          data: {
            id: 'cat-netflix',
            name: 'Netflix',
            groupId: 'grp-subs',
          },
          resolved: {
            Subscriptions: 'grp-subs',
            Netflix: 'cat-netflix',
          },
        };
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
          name: 'manage_categories',
          arguments: {
            action: 'create',
            name: 'Netflix',
            group: 'Subscriptions',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      action: 'create',
      target: 'category',
      name: 'Netflix',
      group: 'Subscriptions',
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      success: true,
      message: 'Created category "Netflix" (cat-netflix) in group "Subscriptions" (grp-subs).',
      data: {
        id: 'cat-netflix',
        name: 'Netflix',
        groupId: 'grp-subs',
      },
      resolved: {
        Subscriptions: 'grp-subs',
        Netflix: 'cat-netflix',
      },
    });
  });

  it('rejects manage_categories via tools/call when action is not in supported enum', async () => {
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
          name: 'manage_categories',
          arguments: {
            action: 'invalid_action',
            name: 'Groceries',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
  });
});

describe('manageCategories Gateway Seam (ActualBudgetGateway)', () => {
  it('creates a category under an existing group resolved by name and auto-creates a missing group when group name does not exist', async () => {
    const groups: ActualCategoryGroupRecord[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Frequent Spending',
        is_income: false,
        hidden: false,
        categories: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Groceries',
            group_id: '11111111-1111-4111-8111-111111111111',
            is_income: false,
            hidden: false,
          },
        ],
      },
    ];

    const createdGroups: Array<{ name: string; is_income?: boolean; hidden?: boolean }> = [];
    const createdCategories: Array<{
      name: string;
      group_id: string;
      is_income?: boolean;
      hidden?: boolean;
    }> = [];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => groups,
      createCategoryGroup: async (group) => {
        createdGroups.push(group);
        const newGroupId = '44444444-4444-4444-8444-444444444444';
        groups.push({
          id: newGroupId,
          name: group.name,
          is_income: group.is_income ?? false,
          hidden: group.hidden ?? false,
          categories: [],
        });
        return newGroupId;
      },
      createCategory: async (cat) => {
        createdCategories.push(cat);
        const newCatId =
          createdCategories.length === 1
            ? '33333333-3333-4333-8333-333333333333'
            : '55555555-5555-4555-8555-555555555555';
        return newCatId;
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // 1. Create category in existing group resolved by case-insensitive name
    const existingGroupResult = await gateway.manageCategories({
      action: 'create',
      name: 'Coffee Shops',
      group: 'frequent spending',
    });

    expect(existingGroupResult.success).toBe(true);
    expect(existingGroupResult.data).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Coffee Shops',
      groupId: '11111111-1111-4111-8111-111111111111',
    });
    expect(existingGroupResult.resolved).toMatchObject({
      'frequent spending': '11111111-1111-4111-8111-111111111111',
      'Coffee Shops': '33333333-3333-4333-8333-333333333333',
    });
    expect(createdGroups).toHaveLength(0);
    expect(createdCategories[0]).toEqual({
      name: 'Coffee Shops',
      group_id: '11111111-1111-4111-8111-111111111111',
    });

    // 2. Create category in a non-existent group -> auto-creates group and records both in resolved
    const autoCreatedGroupResult = await gateway.manageCategories({
      action: 'create',
      name: 'Netflix',
      group: 'Subscriptions',
    });

    expect(autoCreatedGroupResult.success).toBe(true);
    expect(autoCreatedGroupResult.data).toMatchObject({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Netflix',
      groupId: '44444444-4444-4444-8444-444444444444',
      groupCreated: true,
    });
    expect(autoCreatedGroupResult.resolved).toEqual({
      Subscriptions: '44444444-4444-4444-8444-444444444444',
      Netflix: '55555555-5555-4555-8555-555555555555',
    });
    expect(createdGroups).toEqual([{ name: 'Subscriptions' }]);
    expect(createdCategories[1]).toEqual({
      name: 'Netflix',
      group_id: '44444444-4444-4444-8444-444444444444',
    });

    // 3. Create category group directly when target: 'group'
    const directGroupResult = await gateway.manageCategories({
      action: 'create',
      target: 'group',
      name: 'Savings Goals',
      isIncome: false,
      hidden: false,
    });

    expect(directGroupResult.success).toBe(true);
    expect(directGroupResult.data).toMatchObject({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Savings Goals',
    });
    expect(directGroupResult.resolved).toEqual({
      'Savings Goals': '44444444-4444-4444-8444-444444444444',
    });
  });

  it('updates and moves categories and category groups by name or UUID, auto-creating missing destination groups on move, and returns fuzzy suggestions when not found', async () => {
    const groups: ActualCategoryGroupRecord[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Frequent Spending',
        is_income: false,
        hidden: false,
        categories: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Groceries',
            group_id: '11111111-1111-4111-8111-111111111111',
            is_income: false,
            hidden: false,
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Coffee Shops',
            group_id: '11111111-1111-4111-8111-111111111111',
            is_income: false,
            hidden: false,
          },
        ],
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Bills & Utilities',
        is_income: false,
        hidden: false,
        categories: [],
      },
    ];

    const categoryUpdates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const groupUpdates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const createdGroups: Array<{ name: string }> = [];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => groups,
      updateCategory: async (id, fields) => {
        categoryUpdates.push({ id, fields });
      },
      updateCategoryGroup: async (id, fields) => {
        groupUpdates.push({ id, fields });
      },
      createCategoryGroup: async (group) => {
        createdGroups.push(group);
        return '77777777-7777-4777-8777-777777777777';
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // 1. Rename and toggle hidden on category by name
    const renameCatResult = await gateway.manageCategories({
      action: 'update',
      name: 'coffee shops',
      newName: 'Cafes & Bakeries',
      hidden: true,
    });

    expect(renameCatResult.success).toBe(true);
    expect(renameCatResult.data).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Cafes & Bakeries',
      hidden: true,
    });
    expect(renameCatResult.resolved).toEqual({
      'coffee shops': '33333333-3333-4333-8333-333333333333',
    });
    expect(categoryUpdates[0]).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      fields: { name: 'Cafes & Bakeries', hidden: true },
    });

    // 2. Rename category group by name
    const renameGroupResult = await gateway.manageCategories({
      action: 'update',
      target: 'group',
      name: 'Bills & Utilities',
      newName: 'Fixed Monthly Bills',
    });

    expect(renameGroupResult.success).toBe(true);
    expect(renameGroupResult.data).toMatchObject({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Fixed Monthly Bills',
    });
    expect(renameGroupResult.resolved).toEqual({
      'Bills & Utilities': '44444444-4444-4444-8444-444444444444',
    });
    expect(groupUpdates[0]).toEqual({
      id: '44444444-4444-4444-8444-444444444444',
      fields: { name: 'Fixed Monthly Bills' },
    });

    // 3. Move category by name to a non-existent group -> auto-creates group and records both in resolved
    const moveResult = await gateway.manageCategories({
      action: 'move',
      name: 'Groceries',
      group: 'Essential Living',
    });

    expect(moveResult.success).toBe(true);
    expect(moveResult.data).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Groceries',
      groupId: '77777777-7777-4777-8777-777777777777',
      groupCreated: true,
    });
    expect(moveResult.resolved).toEqual({
      Groceries: '22222222-2222-4222-8222-222222222222',
      'Essential Living': '77777777-7777-4777-8777-777777777777',
    });
    expect(createdGroups).toEqual([{ name: 'Essential Living' }]);
    expect(categoryUpdates[1]).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      fields: { group_id: '77777777-7777-4777-8777-777777777777' },
    });

    // 4. Updating a misspelled category returns EntityResolutionError with suggestions
    await expect(
      gateway.manageCategories({
        action: 'update',
        name: 'Groceris',
        newName: 'Supermarket',
      }),
    ).rejects.toThrow(EntityResolutionError);

    try {
      await gateway.manageCategories({
        action: 'update',
        name: 'Groceris',
        newName: 'Supermarket',
      });
    } catch (err) {
      const resErr = err as EntityResolutionError;
      expect(resErr.suggestions).toContain('Groceries');
    }
  });

  it('enforces safe deletion invariants: rejects deleting non-empty categories or groups without transferTo with suggestions, and resolves transferTo by name when provided', async () => {
    const groups: ActualCategoryGroupRecord[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Frequent Spending',
        is_income: false,
        hidden: false,
        categories: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Groceries',
            group_id: '11111111-1111-4111-8111-111111111111',
            is_income: false,
            hidden: false,
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Coffee Shops',
            group_id: '11111111-1111-4111-8111-111111111111',
            is_income: false,
            hidden: false,
          },
          {
            id: '99999999-9999-4999-8999-999999999999',
            name: 'Empty Envelope',
            group_id: '11111111-1111-4111-8111-111111111111',
            is_income: false,
            hidden: false,
          },
        ],
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Empty Group',
        is_income: false,
        hidden: false,
        categories: [],
      },
    ];

    const deletedCategories: Array<{ id: string; transferCategoryId?: string }> = [];
    const deletedGroups: Array<{ id: string; transferCategoryId?: string }> = [];

    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => groups,
      getTransactions: async () => [
        {
          id: 'tx-1',
          account: 'acc-1',
          date: '2026-11-01',
          amount: -450,
          category: '33333333-3333-4333-8333-333333333333',
        },
      ],
      deleteCategory: async (id, transferCategoryId) => {
        deletedCategories.push({
          id,
          ...(transferCategoryId ? { transferCategoryId } : {}),
        });
      },
      deleteCategoryGroup: async (id, transferCategoryId) => {
        deletedGroups.push({
          id,
          ...(transferCategoryId ? { transferCategoryId } : {}),
        });
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    // 1. Reject deleting category with existing transactions when transferTo is omitted
    let caughtError: (Error & { suggestions?: string[] }) | undefined;
    try {
      await gateway.manageCategories({
        action: 'delete',
        name: 'Coffee Shops',
      });
    } catch (err) {
      caughtError = err as Error & { suggestions?: string[] };
    }
    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/transferTo/i);
    expect(caughtError?.suggestions).toContain('Groceries');
    expect(deletedCategories).toHaveLength(0);

    // 2. Reject deleting group whose categories have existing transactions when transferTo is omitted
    let caughtGroupError: (Error & { suggestions?: string[] }) | undefined;
    try {
      await gateway.manageCategories({
        action: 'delete',
        target: 'group',
        name: 'Frequent Spending',
      });
    } catch (err) {
      caughtGroupError = err as Error & { suggestions?: string[] };
    }
    expect(caughtGroupError).toBeDefined();
    expect(caughtGroupError?.message).toMatch(/transferTo/i);
    expect(deletedGroups).toHaveLength(0);

    // 3. Delete category with transactions by supplying transferTo category name
    const deleteCatWithTransfer = await gateway.manageCategories({
      action: 'delete',
      name: 'Coffee Shops',
      transferTo: 'groceries',
    });

    expect(deleteCatWithTransfer.success).toBe(true);
    expect(deleteCatWithTransfer.data).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Coffee Shops',
      transferCategoryId: '22222222-2222-4222-8222-222222222222',
    });
    expect(deleteCatWithTransfer.resolved).toEqual({
      'Coffee Shops': '33333333-3333-4333-8333-333333333333',
      groceries: '22222222-2222-4222-8222-222222222222',
    });
    expect(deletedCategories).toEqual([
      {
        id: '33333333-3333-4333-8333-333333333333',
        transferCategoryId: '22222222-2222-4222-8222-222222222222',
      },
    ]);

    // 4. Allow deleting an empty category and an empty category group without transferTo
    const deleteEmptyCat = await gateway.manageCategories({
      action: 'delete',
      name: 'Empty Envelope',
    });
    expect(deleteEmptyCat.success).toBe(true);
    expect(deletedCategories[1]).toEqual({
      id: '99999999-9999-4999-8999-999999999999',
    });

    const deleteEmptyGroup = await gateway.manageCategories({
      action: 'delete',
      target: 'group',
      name: 'Empty Group',
    });
    expect(deleteEmptyGroup.success).toBe(true);
    expect(deletedGroups[0]).toEqual({
      id: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('rejects with actionable transferTo error and suggestions when api.deleteCategory fails without transferTo', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [],
      getAccountBalance: async () => 0,
      getCategoryGroups: async () => [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Living',
          categories: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Dining Out',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Groceries',
              group_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        },
      ],
      deleteCategory: async (_id, transferCategoryId) => {
        if (!transferCategoryId) {
          throw new Error('Cannot delete category in use');
        }
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    let caught: (Error & { suggestions?: string[] }) | undefined;
    try {
      await gateway.manageCategories({
        action: 'delete',
        name: 'Dining Out',
      });
    } catch (err) {
      caught = err as Error & { suggestions?: string[] };
    }

    expect(caught).toBeDefined();
    expect(caught?.message).toMatch(/transferTo/i);
    expect(caught?.suggestions).toContain('Groceries');
  });
});
