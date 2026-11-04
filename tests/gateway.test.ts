import { describe, expect, it } from 'vitest';
import { createActualBudgetGateway, type ActualApiAdapter } from '../src/gateway/actualBudgetGateway.js';

describe('BudgetGateway seam — createActualBudgetGateway listAccounts', () => {
  it('returns accounts with normalized flags and Minor Unit Amount balances converted to Decimal Amounts', async () => {
    const fakeApi: ActualApiAdapter = {
      getAccounts: async () => [
        { id: 'acc-1', name: 'Checking', offbudget: false, closed: false },
        { id: 'acc-2', name: 'Credit Card', offbudget: false, closed: false },
        { id: 'acc-3', name: 'Brokerage' },
      ],
      getAccountBalance: async (id: string) => {
        const balances: Record<string, number> = {
          'acc-1': 245075,
          'acc-2': -1234,
          'acc-3': 0,
        };
        return balances[id] ?? 0;
      },
    };

    const gateway = createActualBudgetGateway({
      syncId: '11111111-2222-3333-4444-555555555555',
      api: fakeApi,
    });

    const accounts = await gateway.listAccounts();

    expect(accounts).toEqual([
      {
        id: 'acc-1',
        name: 'Checking',
        offbudget: false,
        closed: false,
        balance: 2450.75,
      },
      {
        id: 'acc-2',
        name: 'Credit Card',
        offbudget: false,
        closed: false,
        balance: -12.34,
      },
      {
        id: 'acc-3',
        name: 'Brokerage',
        offbudget: false,
        closed: false,
        balance: 0,
      },
    ]);
  });
});
