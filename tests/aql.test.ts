import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as actualApi from '@actual-app/api';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import {
  compileStructuredAqlQuery,
  structuredAqlQueryInputSchema,
} from '../src/gateway/aql.js';
import { createActualBudgetGateway, type ActualBudgetGateway } from '../src/gateway/actualBudgetGateway.js';
import { issueBearerToken } from './helpers/auth.js';

describe('BudgetGateway seam — get_spending_summary & run_aql_query against SQLite Target Budget', () => {
  let tmpDir: string;
  let gateway: ActualBudgetGateway;
  let groceriesCatId: string;
  let housingCatId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-aql-test-'));
    const lib = await actualApi.init({ dataDir: tmpDir });
    await lib.send('create-budget', { budgetName: 'AnalyticsTestBudget', testMode: true });

    const checkingId = await actualApi.createAccount({ name: 'Checking', offbudget: false });
    const offBudgetId = await actualApi.createAccount({ name: 'Brokerage', offbudget: true });

    const groupId = await actualApi.createCategoryGroup({ name: 'Core Expenses', is_income: false });
    groceriesCatId = await actualApi.createCategory({ name: 'Groceries', group_id: groupId });
    housingCatId = await actualApi.createCategory({ name: 'Housing', group_id: groupId });

    const payees = await actualApi.getPayees();
    const transferToBrokeragePayee = payees.find((p) => p.transfer_acct === offBudgetId);
    if (!transferToBrokeragePayee) {
      throw new Error('Expected transfer payee for Brokerage account');
    }

    await actualApi.addTransactions(checkingId, [
      // Out of date window (February)
      {
        date: '2026-02-15',
        amount: -9900,
        payee_name: 'Trader Joes',
        category: groceriesCatId,
      },
      // Regular on-budget Groceries expense (-$50.25)
      {
        date: '2026-03-05',
        amount: -5025,
        payee_name: 'Trader Joes',
        category: groceriesCatId,
      },
      // Split transaction (-$100.00 parent split into -$60.00 Groceries and -$40.00 Housing)
      {
        date: '2026-03-10',
        amount: -10000,
        payee_name: 'Target',
        subtransactions: [
          { amount: -6000, category: groceriesCatId },
          { amount: -4000, category: housingCatId },
        ],
      },
      // Internal transfer to off-budget Brokerage (-$200.00)
      {
        date: '2026-03-12',
        amount: -20000,
        payee: transferToBrokeragePayee.id,
        category: groceriesCatId,
      },
    ]);

    // Off-budget account expense (-$300.00)
    await actualApi.addTransactions(offBudgetId, [
      {
        date: '2026-03-15',
        amount: -30000,
        payee_name: 'Vanguard Fee',
        category: housingCatId,
      },
    ]);

    gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: {
        getAccounts: actualApi.getAccounts,
        getAccountBalance: actualApi.getAccountBalance,
        aqlQuery: actualApi.aqlQuery,
        q: actualApi.q,
      },
    });
  });

  afterAll(async () => {
    await actualApi.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('aggregates spending by category over startDate..endDate with splits inlined, excluding transfers and off-budget accounts by default, in Decimal Amounts', async () => {
    const summary = await gateway.getSpendingSummary({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      groupBy: 'category',
    });

    expect(summary.startDate).toBe('2026-03-01');
    expect(summary.endDate).toBe('2026-03-31');
    expect(summary.groupBy).toBe('category');
    expect(summary.includeTransfers).toBe(false);
    expect(summary.includeOffBudget).toBe(false);
    expect(summary.total).toBe(-150.25);

    const byName = new Map(summary.groups.map((g) => [g.categoryName, g]));
    expect(byName.get('Groceries')).toMatchObject({
      categoryId: groceriesCatId,
      categoryName: 'Groceries',
      total: -110.25,
      count: 2,
    });
    expect(byName.get('Housing')).toMatchObject({
      categoryId: housingCatId,
      categoryName: 'Housing',
      total: -40,
      count: 1,
    });
  });

  it('aggregates spending grouped by payee and by month, and honors includeTransfers and includeOffBudget flags', async () => {
    const byPayee = await gateway.getSpendingSummary({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      groupBy: 'payee',
    });

    expect(byPayee.groupBy).toBe('payee');
    expect(byPayee.total).toBe(-150.25);
    const payeeMap = new Map(byPayee.groups.map((g) => [g.payeeName, g]));
    expect(payeeMap.get('Trader Joes')).toMatchObject({
      payeeName: 'Trader Joes',
      total: -50.25,
      count: 1,
    });
    expect(payeeMap.get('Target')).toMatchObject({
      payeeName: 'Target',
      total: -100,
      count: 2,
    });

    const byMonth = await gateway.getSpendingSummary({
      startDate: '2026-02-01',
      endDate: '2026-03-31',
      groupBy: 'month',
    });

    expect(byMonth.groupBy).toBe('month');
    expect(byMonth.total).toBe(-249.25);
    const monthMap = new Map(byMonth.groups.map((g) => [g.month, g]));
    expect(monthMap.get('2026-02')).toMatchObject({
      month: '2026-02',
      total: -99,
      count: 1,
    });
    expect(monthMap.get('2026-03')).toMatchObject({
      month: '2026-03',
      total: -150.25,
      count: 3,
    });

    const withTransfersAndOffBudget = await gateway.getSpendingSummary({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      groupBy: 'category',
      includeTransfers: true,
      includeOffBudget: true,
    });

    expect(withTransfersAndOffBudget.includeTransfers).toBe(true);
    expect(withTransfersAndOffBudget.includeOffBudget).toBe(true);
    // Note: adding a transfer transaction to Brokerage (-200) also creates the positive counterpart (+200) on Brokerage,
    // while Checking has -50.25, -60, -40, -200 (Groceries) and Brokerage has +200 (uncategorized transfer counterpart) and -300 (Housing).
    const inclByCat = new Map(withTransfersAndOffBudget.groups.map((g) => [g.categoryName, g]));
    expect(inclByCat.get('Groceries')?.total).toBe(-310.25);
    expect(inclByCat.get('Housing')?.total).toBe(-340);
  });

  it('compiles Structured AQL Queries via q(table), applies default splits: inline and limit: 100, and converts amount and $sum(amount) columns to Decimal Amounts', async () => {
    const rawTxResult = await gateway.runAqlQuery({
      table: 'transactions',
      filter: {
        $and: [
          { date: { $gte: '2026-03-01' } },
          { date: { $lte: '2026-03-31' } },
          { 'account.offbudget': false },
          { 'payee.transfer_acct': null },
        ],
      },
      select: ['id', 'date', 'amount', 'payee.name', 'category.name'],
      orderBy: [{ date: 'asc' }, { amount: 'asc' }],
    });

    expect(rawTxResult.table).toBe('transactions');
    expect(rawTxResult.rows).toHaveLength(3);
    expect(rawTxResult.rows.map((r) => ({
      date: r.date,
      amount: r.amount,
      payee: r['payee.name'],
      category: r['category.name'],
    }))).toEqual([
      { date: '2026-03-05', amount: -50.25, payee: 'Trader Joes', category: 'Groceries' },
      { date: '2026-03-10', amount: -60, payee: 'Target', category: 'Groceries' },
      { date: '2026-03-10', amount: -40, payee: 'Target', category: 'Housing' },
    ]);

    const aggResult = await gateway.runAqlQuery({
      table: 'transactions',
      filter: {
        date: { $gte: '2026-03-01', $lte: '2026-03-31' },
        'account.offbudget': false,
        'payee.transfer_acct': null,
      },
      groupBy: 'category.name',
      select: [
        'category.name',
        { totalSpent: { $sum: '$amount' } },
        { txCount: { $count: '$id' } },
      ],
      orderBy: { 'category.name': 'asc' },
      limit: 10,
      offset: 0,
    });

    expect(aggResult.rows).toEqual([
      {
        'category.name': 'Groceries',
        totalSpent: -110.25,
        txCount: 2,
      },
      {
        'category.name': 'Housing',
        totalSpent: -40,
        txCount: 1,
      },
    ]);

    const accountsResult = await gateway.runAqlQuery({
      table: 'accounts',
      filter: { name: 'Checking', offbudget: false },
      select: ['id', 'name', 'offbudget'],
    });
    expect(accountsResult.rows).toEqual([
      expect.objectContaining({ name: 'Checking', offbudget: false }),
    ]);
  });

  it('converts Decimal Amount filter inputs on monetary fields (direct equality, comparison operators, $oneof, and nested $and/$or) to Minor Unit Amounts', async () => {
    const ltResult = await gateway.runAqlQuery({
      table: 'transactions',
      filter: {
        date: { $gte: '2026-03-01', $lte: '2026-03-31' },
        'account.offbudget': false,
        'payee.transfer_acct': null,
        amount: { $lt: -50 },
      },
      select: ['date', 'amount', 'payee.name'],
      orderBy: { amount: 'asc' },
    });

    expect(
      ltResult.rows.map((r) => ({
        date: r.date,
        amount: r.amount,
        payee: r['payee.name'],
      })),
    ).toEqual([
      { date: '2026-03-10', amount: -60, payee: 'Target' },
      { date: '2026-03-05', amount: -50.25, payee: 'Trader Joes' },
    ]);

    const eqResult = await gateway.runAqlQuery({
      table: 'transactions',
      filter: {
        amount: -50.25,
      },
      select: ['date', 'amount', 'payee.name'],
    });

    expect(
      eqResult.rows.map((r) => ({
        date: r.date,
        amount: r.amount,
        payee: r['payee.name'],
      })),
    ).toEqual([
      { date: '2026-03-05', amount: -50.25, payee: 'Trader Joes' },
    ]);

    const compiledOneOf = compileStructuredAqlQuery(
      structuredAqlQueryInputSchema.parse({
        table: 'transactions',
        filter: {
          amount: { $oneof: [-12.34, -25.0] },
          $and: [{ amount: -12.34 }, { $or: [{ amount: { $lt: -50 } }] }],
        },
      }),
    ).serialize();

    expect(compiledOneOf.filterExpressions).toEqual([
      {
        amount: { $oneof: [-1234, -2500] },
        $and: [{ amount: -1234 }, { $or: [{ amount: { $lt: -5000 } }] }],
      },
    ]);

    const nestedLogicalResult = await gateway.runAqlQuery({
      table: 'transactions',
      filter: {
        $or: [
          { amount: -50.25 },
          {
            $and: [
              { date: '2026-03-10' },
              { amount: { $gt: -50, $lte: -40 } },
            ],
          },
        ],
      },
      select: ['date', 'amount', 'payee.name'],
      orderBy: { amount: 'asc' },
    });

    expect(
      nestedLogicalResult.rows.map((r) => ({
        date: r.date,
        amount: r.amount,
        payee: r['payee.name'],
      })),
    ).toEqual([
      { date: '2026-03-05', amount: -50.25, payee: 'Trader Joes' },
      { date: '2026-03-10', amount: -40, payee: 'Target' },
    ]);
  });

  it('rejects disallowed tables, disallowed fields or operators, and out-of-range limits in runAqlQuery', async () => {
    await expect(
      gateway.runAqlQuery({
        // @ts-expect-error testing invalid table at runtime
        table: 'sqlite_master',
      }),
    ).rejects.toThrow(/table|Invalid enum value/i);

    await expect(
      gateway.runAqlQuery({
        table: 'transactions',
        select: ['id', 'nonexistent_column'],
      }),
    ).rejects.toThrow(/Disallowed field.*nonexistent_column/i);

    await expect(
      gateway.runAqlQuery({
        table: 'transactions',
        filter: { 'amount; DROP TABLE transactions': 0 },
      }),
    ).rejects.toThrow(/Disallowed field/i);

    await expect(
      gateway.runAqlQuery({
        table: 'transactions',
        groupBy: 'evil_field',
      }),
    ).rejects.toThrow(/Disallowed field.*evil_field/i);

    await expect(
      gateway.runAqlQuery({
        table: 'transactions',
        orderBy: { evil_field: 'asc' },
      }),
    ).rejects.toThrow(/Disallowed field.*evil_field/i);

    await expect(
      gateway.runAqlQuery({
        table: 'transactions',
        limit: 1001,
      }),
    ).rejects.toThrow(/1000/i);
  });

  it('exposes get_spending_summary and run_aql_query on tools/list with readOnlyHint: true and destructiveHint: false', async () => {
    const config = loadConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: '3000',
      DATA_DIR: tmpDir,
      OAUTH_ADMIN_PASSWORD: 'admin-password',
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'actual-password',
      ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
    });
    const app = createApp({ config, budgetGateway: gateway });
    const token = await issueBearerToken(app, { adminPassword: config.OAUTH_ADMIN_PASSWORD });

    const res = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list',
        params: {},
      });

    expect(res.status).toBe(200);
    const tools: Array<{ name: string; annotations?: Record<string, unknown> }> =
      res.body.result.tools;

    const spendingTool = tools.find((t) => t.name === 'get_spending_summary');
    expect(spendingTool).toBeDefined();
    expect(spendingTool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });

    const aqlTool = tools.find((t) => t.name === 'run_aql_query');
    expect(aqlTool).toBeDefined();
    expect(aqlTool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it('executes get_spending_summary and run_aql_query via POST /mcp tools/call and rejects disallowed AQL tables/fields', async () => {
    const config = loadConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: '3000',
      DATA_DIR: tmpDir,
      OAUTH_ADMIN_PASSWORD: 'admin-password',
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'actual-password',
      ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
    });
    const app = createApp({ config, budgetGateway: gateway });
    const token = await issueBearerToken(app, { adminPassword: config.OAUTH_ADMIN_PASSWORD });

    const summaryRes = await request(app)
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
          name: 'get_spending_summary',
          arguments: {
            startDate: '2026-03-01',
            endDate: '2026-03-31',
            groupBy: 'category',
          },
        },
      });

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.result.isError).toBeFalsy();
    const summaryPayload = JSON.parse(summaryRes.body.result.content[0].text);
    expect(summaryPayload.total).toBe(-150.25);
    expect(summaryPayload.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryName: 'Groceries', total: -110.25, count: 2 }),
        expect.objectContaining({ categoryName: 'Housing', total: -40, count: 1 }),
      ]),
    );

    const aqlRes = await request(app)
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
          name: 'run_aql_query',
          arguments: {
            table: 'transactions',
            filter: {
              date: { $gte: '2026-03-01', $lte: '2026-03-31' },
              'account.offbudget': false,
              'payee.transfer_acct': null,
            },
            groupBy: 'category.name',
            select: ['category.name', { total: { $sum: '$amount' } }],
            orderBy: { 'category.name': 'asc' },
          },
        },
      });

    expect(aqlRes.status).toBe(200);
    expect(aqlRes.body.result.isError).toBeFalsy();
    const aqlPayload = JSON.parse(aqlRes.body.result.content[0].text);
    expect(aqlPayload).toEqual({
      table: 'transactions',
      limit: 100,
      offset: 0,
      splits: 'inline',
      rows: [
        { 'category.name': 'Groceries', total: -110.25 },
        { 'category.name': 'Housing', total: -40 },
      ],
    });

    const badTableRes = await request(app)
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
          name: 'run_aql_query',
          arguments: {
            table: 'messages_crdt',
          },
        },
      });

    expect(badTableRes.status).toBe(200);
    expect(
      Boolean(badTableRes.body.error) || Boolean(badTableRes.body.result?.isError),
    ).toBe(true);

    const badFieldRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'run_aql_query',
          arguments: {
            table: 'transactions',
            select: ['id', 'evil_column'],
          },
        },
      });

    expect(badFieldRes.status).toBe(200);
    expect(
      Boolean(badFieldRes.body.error) || Boolean(badFieldRes.body.result?.isError),
    ).toBe(true);
  });
});
