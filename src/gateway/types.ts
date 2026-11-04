export interface AccountSummary {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  /** Account balance expressed as a Decimal Amount (e.g. -12.34 or 1500.5). */
  balance: number;
}

export interface CategorySummary {
  id: string;
  name: string;
  group_id: string;
  is_income: boolean;
  hidden: boolean;
}

export interface CategoryGroupSummary {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  categories: CategorySummary[];
}

export interface PayeeSummary {
  id: string;
  name: string;
  transfer_acct: string | null;
}

export interface BudgetMonthCategorySummary {
  id: string;
  name: string;
  group_id: string;
  is_income: boolean;
  hidden: boolean;
  budgeted: number;
  spent: number;
  balance: number;
  carryover: boolean;
  received?: number;
}

export interface BudgetMonthCategoryGroupSummary {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  budgeted: number;
  spent: number;
  balance: number;
  received?: number;
  categories: BudgetMonthCategorySummary[];
}

export interface BudgetMonthSummary {
  month: string;
  incomeAvailable: number;
  lastMonthOverspent: number;
  forNextMonth: number;
  totalBudgeted: number;
  toBudget: number;
  fromLastMonth: number;
  totalIncome: number;
  totalSpent: number;
  totalBalance: number;
  categoryGroups: BudgetMonthCategoryGroupSummary[];
  categories: BudgetMonthCategorySummary[];
}

export interface GetTransactionsFilter {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  payeeId?: string;
  searchText?: string;
  limit?: number;
  forceSync?: boolean;
}

export interface TransactionRecord {
  id: string;
  account: string;
  accountId: string;
  accountName: string | null;
  date: string;
  /** Transaction amount expressed as a Decimal Amount (e.g. -84.5 or 1500.0). */
  amount: number;
  payee: string | null;
  payeeId: string | null;
  payeeName: string | null;
  category: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled?: boolean;
  imported_id?: string | null;
  transfer_id?: string | null;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: string | null;
  subtransactions?: TransactionRecord[];
}

export interface BudgetReadiness {
  ready: boolean;
  syncId: string;
  lastSyncedAt: string | null;
}

export interface BudgetGateway {
  getReadiness(): BudgetReadiness;
  listAccounts(options?: { forceSync?: boolean }): Promise<AccountSummary[]>;
  getTransactions?(filter?: GetTransactionsFilter): Promise<TransactionRecord[]>;
  listCategories?(options?: { forceSync?: boolean }): Promise<CategoryGroupSummary[]>;
  listPayees?(options?: { forceSync?: boolean }): Promise<PayeeSummary[]>;
  listBudgetMonths?(options?: { forceSync?: boolean }): Promise<string[]>;
  getBudgetMonth?(
    month: string,
    options?: { forceSync?: boolean },
  ): Promise<BudgetMonthSummary>;
  initialize?(): Promise<void>;
  sync?(): Promise<void>;
  shutdown?(): Promise<void>;
}
