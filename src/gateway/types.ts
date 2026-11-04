export interface AccountSummary {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  /** Account balance expressed as a Decimal Amount (e.g. -12.34 or 1500.5). */
  balance: number;
}

export interface BudgetReadiness {
  ready: boolean;
  syncId: string;
  lastSyncedAt: string | null;
}

export interface BudgetGateway {
  getReadiness(): BudgetReadiness;
  listAccounts(options?: { forceSync?: boolean }): Promise<AccountSummary[]>;
  initialize?(): Promise<void>;
  sync?(): Promise<void>;
  shutdown?(): Promise<void>;
}
