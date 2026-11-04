import * as actualApi from '@actual-app/api';
import { minorToDecimalAmount } from '../currency.js';
import type { AccountSummary, BudgetGateway, BudgetReadiness } from './types.js';

export interface ActualAccountRecord {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
}

export interface ActualApiAdapter {
  getAccounts(): Promise<ActualAccountRecord[]>;
  getAccountBalance(id: string, cutoff?: Date): Promise<number>;
}

export interface CreateActualBudgetGatewayOptions {
  syncId: string;
  api?: ActualApiAdapter;
}

export function createActualBudgetGateway(
  options: CreateActualBudgetGatewayOptions,
): BudgetGateway {
  const api: ActualApiAdapter = options.api ?? actualApi;
  let lastSyncedAt: string | null = null;
  let ready = true;

  return {
    getReadiness(): BudgetReadiness {
      return {
        ready,
        syncId: options.syncId,
        lastSyncedAt,
      };
    },
    async listAccounts(): Promise<AccountSummary[]> {
      const rawAccounts = await api.getAccounts();
      const summaries: AccountSummary[] = [];

      for (const account of rawAccounts) {
        const minorBalance = await api.getAccountBalance(account.id);
        summaries.push({
          id: account.id,
          name: account.name,
          offbudget: Boolean(account.offbudget),
          closed: Boolean(account.closed),
          balance: minorToDecimalAmount(minorBalance),
        });
      }

      return summaries;
    },
  };
}
