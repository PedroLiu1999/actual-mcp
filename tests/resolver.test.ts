import { describe, expect, it, vi } from 'vitest';
import { createActualBudgetGateway } from '../src/gateway/actualBudgetGateway.js';
import {
  createResourceFacadeErrorResponse,
  createResourceFacadeResponse,
  EntityResolutionError,
  findSuggestions,
  isUuid,
  resolveAccount,
  resolveCategory,
  resolveCategoryGroup,
  resolveEntityByNameOrId,
  resolvePayee,
  resolveSchedule,
} from '../src/gateway/resolver.js';
import type {
  AccountSummary,
  CategoryGroupSummary,
  PayeeSummary,
  ResourceFacadeResult,
  ScheduleSummary,
} from '../src/gateway/types.js';

const SAMPLE_CATEGORY_GROUPS: CategoryGroupSummary[] = [
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
    name: 'Subscriptions',
    is_income: false,
    hidden: false,
    categories: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Streaming Services',
        group_id: '44444444-4444-4444-8444-444444444444',
        is_income: false,
        hidden: false,
      },
    ],
  },
];

const SAMPLE_PAYEES: PayeeSummary[] = [
  {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Starbucks',
    transfer_acct: null,
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Whole Foods Market',
    transfer_acct: null,
  },
];

const SAMPLE_ACCOUNTS: AccountSummary[] = [
  {
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Main Checking',
    offbudget: false,
    closed: false,
    balance: 2450.75,
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    name: 'High Yield Savings',
    offbudget: false,
    closed: false,
    balance: 15000.0,
  },
];

const SAMPLE_SCHEDULES: ScheduleSummary[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Monthly Rent',
    rule: 'rule-1',
    next_date: '2026-12-01',
    completed: false,
    status: 'active',
    posts_transaction: true,
    payee: '66666666-6666-4666-8666-666666666666',
    account: '88888888-8888-4888-8888-888888888888',
    amount: -2000,
    amountOp: 'is',
    date: '2026-12-01',
  },
];

describe('Identifier Resolution & Standardized Response Envelope', () => {
  describe('UUID detection and direct UUID passthrough', () => {
    it('detects standard UUIDs case-insensitively and passes them through without invoking cache lookups', async () => {
      expect(isUuid('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
      expect(isUuid('A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')).toBe(true);
      expect(isUuid('Groceries')).toBe(false);
      expect(isUuid('cat-123')).toBe(false);

      const loadCandidates = vi.fn(async () => [
        { id: '11111111-2222-3333-4444-555555555555', name: 'Groceries' },
      ]);

      const uuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      const result = await resolveEntityByNameOrId(uuid, loadCandidates, {
        entityType: 'category',
      });

      expect(result).toEqual({
        id: uuid,
        input: uuid,
        matchedBy: 'uuid',
      });
      expect(loadCandidates).not.toHaveBeenCalled();
    });
  });

  describe('Category and category group resolution', () => {
    it('resolves category and group names to internal UUIDs case-insensitively against the Budget Cache', async () => {
      const listCategories = vi.fn(async () => SAMPLE_CATEGORY_GROUPS);
      const resolvedMap: Record<string, string> = {};

      const categoryMatch = await resolveCategory(
        '  coffee shops ',
        { listCategories },
        resolvedMap,
      );
      expect(categoryMatch.id).toBe('33333333-3333-4333-8333-333333333333');
      expect(categoryMatch.name).toBe('Coffee Shops');
      expect(categoryMatch.matchedBy).toBe('name');
      expect(resolvedMap['  coffee shops ']).toBe(
        '33333333-3333-4333-8333-333333333333',
      );

      const groupMatch = await resolveCategoryGroup(
        'SUBSCRIPTIONS',
        { listCategories },
        resolvedMap,
      );
      expect(groupMatch.id).toBe('44444444-4444-4444-8444-444444444444');
      expect(groupMatch.name).toBe('Subscriptions');
      expect(groupMatch.matchedBy).toBe('name');
      expect(resolvedMap['SUBSCRIPTIONS']).toBe(
        '44444444-4444-4444-8444-444444444444',
      );

      // Direct UUID passthrough does not trigger additional listCategories calls
      listCategories.mockClear();
      const uuidPassthrough = await resolveCategory(
        '22222222-2222-4222-8222-222222222222',
        { listCategories },
        resolvedMap,
      );
      expect(uuidPassthrough.id).toBe('22222222-2222-4222-8222-222222222222');
      expect(uuidPassthrough.matchedBy).toBe('uuid');
      expect(listCategories).not.toHaveBeenCalled();
    });

    it('matches exact non-UUID IDs and case-insensitive names in synchronous candidate lists', () => {
      const candidates = [
        { id: 'cat-1', name: 'Dining Out' },
        { id: 'cat-2', name: 'Utilities' },
      ];
      const resolvedMap: Record<string, string> = {};

      const byId = resolveEntityByNameOrId('cat-1', candidates, {
        entityType: 'category',
        resolved: resolvedMap,
      });
      expect(byId.id).toBe('cat-1');
      expect(byId.matchedBy).toBe('id');
      expect(resolvedMap['cat-1']).toBeUndefined();

      const byName = resolveEntityByNameOrId('dining out', candidates, {
        entityType: 'category',
        resolved: resolvedMap,
      });
      expect(byName.id).toBe('cat-1');
      expect(byName.name).toBe('Dining Out');
      expect(byName.matchedBy).toBe('name');
      expect(resolvedMap['dining out']).toBe('cat-1');
    });
  });

  describe('Payee, account, and schedule resolution', () => {
    it('resolves payee, account, and schedule names case-insensitively against the Budget Cache and skips lookups for UUIDs', async () => {
      const listPayees = vi.fn(async () => SAMPLE_PAYEES);
      const listAccounts = vi.fn(async () => SAMPLE_ACCOUNTS);
      const listSchedules = vi.fn(async () => SAMPLE_SCHEDULES);
      const resolvedMap: Record<string, string> = {};

      const payeeMatch = await resolvePayee(
        'starbucks',
        { listPayees },
        resolvedMap,
      );
      expect(payeeMatch.id).toBe('66666666-6666-4666-8666-666666666666');
      expect(payeeMatch.name).toBe('Starbucks');
      expect(payeeMatch.matchedBy).toBe('name');
      expect(resolvedMap['starbucks']).toBe(
        '66666666-6666-4666-8666-666666666666',
      );

      const accountMatch = await resolveAccount(
        'MAIN CHECKING',
        { listAccounts },
        resolvedMap,
      );
      expect(accountMatch.id).toBe('88888888-8888-4888-8888-888888888888');
      expect(accountMatch.name).toBe('Main Checking');
      expect(accountMatch.matchedBy).toBe('name');
      expect(resolvedMap['MAIN CHECKING']).toBe(
        '88888888-8888-4888-8888-888888888888',
      );

      const scheduleMatch = await resolveSchedule(
        'monthly rent',
        { listSchedules },
        resolvedMap,
      );
      expect(scheduleMatch.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(scheduleMatch.name).toBe('Monthly Rent');
      expect(scheduleMatch.matchedBy).toBe('name');
      expect(resolvedMap['monthly rent']).toBe(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );

      // Direct UUID passthrough skips cache calls
      listPayees.mockClear();
      listAccounts.mockClear();
      const payeeUuid = await resolvePayee(
        '66666666-6666-4666-8666-666666666666',
        { listPayees },
      );
      const accountUuid = await resolveAccount(
        '88888888-8888-4888-8888-888888888888',
        { listAccounts },
      );
      expect(payeeUuid.id).toBe('66666666-6666-4666-8666-666666666666');
      expect(accountUuid.id).toBe('88888888-8888-4888-8888-888888888888');
      expect(listPayees).not.toHaveBeenCalled();
      expect(listAccounts).not.toHaveBeenCalled();
    });
  });

  describe('Fuzzy match suggestions on resolution failure', () => {
    it('throws EntityResolutionError with closest matching suggestions when a name cannot be resolved', async () => {
      const listCategories = vi.fn(async () => SAMPLE_CATEGORY_GROUPS);

      await expect(
        resolveCategory('Groceris', { listCategories }),
      ).rejects.toThrow(EntityResolutionError);

      try {
        await resolveCategory('Groceris', { listCategories });
      } catch (err) {
        expect(err).toBeInstanceOf(EntityResolutionError);
        const resErr = err as EntityResolutionError;
        expect(resErr.entityType).toBe('category');
        expect(resErr.input).toBe('Groceris');
        expect(resErr.suggestions).toContain('Groceries');
        expect(resErr.message).toContain('Groceries');
      }

      const suggestions = findSuggestions('Coffee', [
        { id: '1', name: 'Coffee Shops' },
        { id: '2', name: 'Morning Coffee & Tea' },
        { id: '3', name: 'Auto Insurance' },
      ]);
      expect(suggestions).toEqual(['Coffee Shops', 'Morning Coffee & Tea']);
    });
  });

  describe('Standardized response envelope formatting', () => {
    it('formats a uniform success envelope with message, Decimal Amount data payload, and resolved name-to-UUID map', () => {
      const envelope: ResourceFacadeResult<{
        id: string;
        amount: number;
        categoryId: string;
      }> = createResourceFacadeResponse({
        message: 'Updated transaction category to Coffee Shops (-4.75)',
        data: {
          id: 'tx-101',
          amount: -4.75,
          categoryId: '33333333-3333-4333-8333-333333333333',
        },
        resolved: {
          'Coffee Shops': '33333333-3333-4333-8333-333333333333',
        },
      });

      expect(envelope).toEqual({
        success: true,
        message: 'Updated transaction category to Coffee Shops (-4.75)',
        data: {
          id: 'tx-101',
          amount: -4.75,
          categoryId: '33333333-3333-4333-8333-333333333333',
        },
        resolved: {
          'Coffee Shops': '33333333-3333-4333-8333-333333333333',
        },
      });

      const withoutResolved = createResourceFacadeResponse({
        message: 'Reopened account',
        data: { id: '88888888-8888-4888-8888-888888888888' },
      });

      expect(withoutResolved).toEqual({
        success: true,
        message: 'Reopened account',
        data: { id: '88888888-8888-4888-8888-888888888888' },
      });
      expect(withoutResolved.resolved).toBeUndefined();
    });

    it('formats a structured error envelope with repair suggestions when EntityResolutionError occurs', () => {
      const err = new EntityResolutionError({
        entityType: 'payee',
        input: 'Starbux',
        suggestions: ['Starbucks'],
      });

      const errorEnvelope = createResourceFacadeErrorResponse(err);
      expect(errorEnvelope).toEqual({
        success: false,
        message: 'Payee "Starbux" not found. Did you mean: "Starbucks"?',
        error: 'Payee "Starbux" not found. Did you mean: "Starbucks"?',
        entityType: 'payee',
        input: 'Starbux',
        suggestions: ['Starbucks'],
      });
    });
  });

  describe('ActualBudgetGateway Budget Cache integration', () => {
    it('resolves category, group, payee, and account names in-process against ActualBudgetGateway', async () => {
      const getCategoryGroups = vi.fn(async () => SAMPLE_CATEGORY_GROUPS);
      const getPayees = vi.fn(async () => SAMPLE_PAYEES);
      const getAccounts = vi.fn(async () => [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Main Checking',
          offbudget: false,
          closed: false,
        },
      ]);
      const getAccountBalance = vi.fn(async () => 245075);

      const gateway = createActualBudgetGateway({
        syncId: '11111111-2222-3333-4444-555555555555',
        api: {
          getAccounts,
          getAccountBalance,
          getCategoryGroups,
          getPayees,
        },
      });

      const resolved: Record<string, string> = {};
      const cat = await resolveCategory('groceries', gateway, resolved);
      const catRepeat = await resolveCategory('COFFEE SHOPS', gateway, resolved);
      const grp = await resolveCategoryGroup('frequent spending', gateway, resolved);
      const payee = await resolvePayee('whole foods market', gateway, resolved);
      const acct = await resolveAccount('main checking', gateway, resolved);

      expect(cat.id).toBe('22222222-2222-4222-8222-222222222222');
      expect(catRepeat.id).toBe('33333333-3333-4333-8333-333333333333');
      expect(grp.id).toBe('11111111-1111-4111-8111-111111111111');
      expect(payee.id).toBe('77777777-7777-4777-8777-777777777777');
      expect(acct.id).toBe('88888888-8888-4888-8888-888888888888');
      expect(getCategoryGroups).toHaveBeenCalledTimes(1);
      expect(getPayees).toHaveBeenCalledTimes(1);
      expect(resolved).toEqual({
        groceries: '22222222-2222-4222-8222-222222222222',
        'COFFEE SHOPS': '33333333-3333-4333-8333-333333333333',
        'frequent spending': '11111111-1111-4111-8111-111111111111',
        'whole foods market': '77777777-7777-4777-8777-777777777777',
        'main checking': '88888888-8888-4888-8888-888888888888',
      });
    });
  });
});

