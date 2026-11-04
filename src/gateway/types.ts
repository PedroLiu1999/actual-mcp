import type { AqlQueryResult, StructuredAqlQueryInput } from './aql.js';

export type {
  AqlQueryResult,
  AqlSplitsOption,
  AqlTable,
  ParsedStructuredAqlQuery,
  StructuredAqlQueryInput,
} from './aql.js';

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

export type SpendingGroupBy = 'category' | 'payee' | 'month';

export interface GetSpendingSummaryInput {
  startDate: string;
  endDate: string;
  groupBy?: SpendingGroupBy;
  includeTransfers?: boolean;
  includeOffBudget?: boolean;
  forceSync?: boolean;
}

export interface SpendingSummaryGroup {
  categoryId?: string | null;
  categoryName?: string | null;
  payeeId?: string | null;
  payeeName?: string | null;
  month?: string;
  /** Group total expressed as a Decimal Amount. */
  total: number;
  count: number;
}

export interface SpendingSummary {
  startDate: string;
  endDate: string;
  groupBy: SpendingGroupBy;
  includeTransfers: boolean;
  includeOffBudget: boolean;
  /** Overall total across all matching groups expressed as a Decimal Amount. */
  total: number;
  groups: SpendingSummaryGroup[];
}

export interface BudgetGateway {
  getReadiness(): BudgetReadiness;
  listAccounts(options?: { forceSync?: boolean }): Promise<AccountSummary[]>;
  getSpendingSummary?(input: GetSpendingSummaryInput): Promise<SpendingSummary>;
  runAqlQuery?(input: StructuredAqlQueryInput): Promise<AqlQueryResult>;
  initialize?(): Promise<void>;
  sync?(): Promise<void>;
  shutdown?(): Promise<void>;
}
