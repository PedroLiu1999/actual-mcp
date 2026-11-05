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
  it('exposes category and category group tools with correct readOnlyHint and destructiveHint annotations on tools/list', async () => {
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

    const createCat = tools.find((t: { name: string }) => t.name === 'create_category');
    expect(createCat).toBeDefined();
    expect(createCat.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const updateCat = tools.find((t: { name: string }) => t.name === 'update_category');
    expect(updateCat).toBeDefined();
    expect(updateCat.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const deleteCat = tools.find((t: { name: string }) => t.name === 'delete_category');
    expect(deleteCat).toBeDefined();
    expect(deleteCat.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });

    const createGroup = tools.find((t: { name: string }) => t.name === 'create_category_group');
    expect(createGroup).toBeDefined();
    expect(createGroup.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const updateGroup = tools.find((t: { name: string }) => t.name === 'update_category_group');
    expect(updateGroup).toBeDefined();
    expect(updateGroup.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });

    const deleteGroup = tools.find((t: { name: string }) => t.name === 'delete_category_group');
    expect(deleteGroup).toBeDefined();
    expect(deleteGroup.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('invokes create_category via tools/call and returns the created category ID', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      createCategory: async (input) => {
        capturedInput = input;
        return { id: 'cat-new-123' };
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
          name: 'create_category',
          arguments: {
            name: 'Daycare & Schooling',
            groupId: 'group-kids',
            isIncome: false,
            hidden: false,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      name: 'Daycare & Schooling',
      groupId: 'group-kids',
      isIncome: false,
      hidden: false,
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'cat-new-123',
    });
  });

  it('rejects create_category via tools/call when required name or groupId are missing', async () => {
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
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_category',
          arguments: {
            name: 'No Group Category',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBe(true);
  });

  it('invokes update_category via tools/call and updates fields', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      updateCategory: async (input) => {
        capturedInput = input;
        return { id: input.id, success: true };
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
        id: 4,
        method: 'tools/call',
        params: {
          name: 'update_category',
          arguments: {
            id: 'cat-123',
            name: 'Education & Tuition',
            groupId: 'group-reorganized',
            hidden: true,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      id: 'cat-123',
      name: 'Education & Tuition',
      groupId: 'group-reorganized',
      hidden: true,
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toMatchObject({
      id: 'cat-123',
      success: true,
    });
  });

  it('invokes delete_category via tools/call with optional transferCategoryId', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      deleteCategory: async (input) => {
        capturedInput = input;
        return { id: input.id, success: true };
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
          name: 'delete_category',
          arguments: {
            id: 'cat-old',
            transferCategoryId: 'cat-dest',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      id: 'cat-old',
      transferCategoryId: 'cat-dest',
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toMatchObject({
      id: 'cat-old',
      success: true,
    });
  });

  it('invokes create_category_group via tools/call and returns the created group ID', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      createCategoryGroup: async (input) => {
        capturedInput = input;
        return { id: 'group-new-456' };
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
        id: 6,
        method: 'tools/call',
        params: {
          name: 'create_category_group',
          arguments: {
            name: 'Savings Goals',
            isIncome: false,
            hidden: false,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      name: 'Savings Goals',
      isIncome: false,
      hidden: false,
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toEqual({
      id: 'group-new-456',
    });
  });

  it('invokes update_category_group via tools/call and updates fields', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      updateCategoryGroup: async (input) => {
        capturedInput = input;
        return { id: input.id, success: true };
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
          name: 'update_category_group',
          arguments: {
            id: 'group-456',
            name: 'Long-term Savings',
            hidden: true,
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      id: 'group-456',
      name: 'Long-term Savings',
      hidden: true,
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toMatchObject({
      id: 'group-456',
      success: true,
    });
  });

  it('invokes delete_category_group via tools/call with optional transferCategoryId', async () => {
    let capturedInput: unknown;
    const gateway = createStubGateway({
      deleteCategoryGroup: async (input) => {
        capturedInput = input;
        return { id: input.id, success: true };
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
          name: 'delete_category_group',
          arguments: {
            id: 'group-obsolete',
            transferCategoryId: 'cat-general',
          },
        },
      });

    expect(callRes.status).toBe(200);
    expect(callRes.body.result?.isError).toBeFalsy();
    expect(capturedInput).toEqual({
      id: 'group-obsolete',
      transferCategoryId: 'cat-general',
    });
    expect(JSON.parse(callRes.body.result.content[0].text)).toMatchObject({
      id: 'group-obsolete',
      success: true,
    });
  });
});
