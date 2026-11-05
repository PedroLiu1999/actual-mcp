import type { AqlQueryResult, StructuredAqlQueryInput } from './aql.js';

export type {
  AqlQueryResult,
  AqlSplitsOption,
  AqlTable,
  ParsedStructuredAqlQuery,
  StructuredAqlQueryInput,
} from './aql.js';

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'investment'
  | 'mortgage'
  | 'debt'
  | 'other';

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

export interface CreateTransactionItemInput {
  date: string;
  /** Transaction amount expressed as a Decimal Amount (negative for Outflow, positive for Inflow). */
  amount: number;
  payeeName?: string;
  payeeId?: string;
  categoryId?: string;
  notes?: string;
  cleared?: boolean;
  importedId?: string;
}

export interface CreateTransactionsInput {
  accountId: string;
  transactions: CreateTransactionItemInput[];
  runRules?: boolean;
}

export interface CreateTransactionsResult {
  mode: 'import' | 'add';
  added: string[];
  updated: string[];
  errors: unknown[];
}

export interface UpdateTransactionInput {
  id: string;
  date?: string;
  /** Transaction amount expressed as a Decimal Amount (negative for Outflow, positive for Inflow). */
  amount?: number;
  payeeId?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  cleared?: boolean;
}

export interface UpdateTransactionResult {
  previous: TransactionRecord;
  updated: TransactionRecord;
}

export interface DeleteTransactionResult {
  deleted: TransactionRecord;
}

export interface SetBudgetAmountInput {
  month: string;
  categoryId: string;
  /** Monthly budgeted envelope allocation expressed as a Decimal Amount. */
  budgeted?: number;
  carryover?: boolean;
}

export interface SetBudgetAmountResult {
  month: string;
  categoryId: string;
  previous: BudgetMonthCategorySummary;
  updated: BudgetMonthCategorySummary;
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

export interface CreateCategoryInput {
  name: string;
  groupId: string;
  isIncome?: boolean;
  hidden?: boolean;
}

export interface CreateCategoryResult {
  id: string;
}

export interface UpdateCategoryInput {
  id: string;
  name?: string;
  groupId?: string;
  isIncome?: boolean;
  hidden?: boolean;
}

export interface UpdateCategoryResult {
  id: string;
  success: boolean;
}

export interface DeleteCategoryInput {
  id: string;
  transferCategoryId?: string;
}

export interface DeleteCategoryResult {
  id: string;
  success: boolean;
}

export interface CreateCategoryGroupInput {
  name: string;
  isIncome?: boolean;
  hidden?: boolean;
}

export interface CreateCategoryGroupResult {
  id: string;
}

export interface UpdateCategoryGroupInput {
  id: string;
  name?: string;
  isIncome?: boolean;
  hidden?: boolean;
}

export interface UpdateCategoryGroupResult {
  id: string;
  success: boolean;
}

export interface DeleteCategoryGroupInput {
  id: string;
  transferCategoryId?: string;
}

export interface DeleteCategoryGroupResult {
  id: string;
  success: boolean;
}

export interface CreatePayeeInput {
  name: string;
}

export interface CreatePayeeResult {
  id: string;
}

export interface UpdatePayeeInput {
  name?: string;
}

export interface UpdatePayeeResult {
  id: string;
}

export interface DeletePayeeResult {
  id: string;
}

export interface MergePayeesResult {
  targetId: string;
  mergedCount: number;
}

export interface RunBankSyncResult {
  updatedAccountIds: string[];
  newTransactionsCount: number;
  matchedTransactionsCount: number;
  errors?: string[];
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
  getSpendingSummary?(input: GetSpendingSummaryInput): Promise<SpendingSummary>;
  runAqlQuery?(input: StructuredAqlQueryInput): Promise<AqlQueryResult>;
  createTransactions?(input: CreateTransactionsInput): Promise<CreateTransactionsResult>;
  updateTransaction?(input: UpdateTransactionInput): Promise<UpdateTransactionResult>;
  deleteTransaction?(id: string): Promise<DeleteTransactionResult>;
  setBudgetAmount?(input: SetBudgetAmountInput): Promise<SetBudgetAmountResult>;
  createCategory?(input: CreateCategoryInput): Promise<CreateCategoryResult>;
  updateCategory?(input: UpdateCategoryInput): Promise<UpdateCategoryResult>;
  deleteCategory?(input: DeleteCategoryInput): Promise<DeleteCategoryResult>;
  createCategoryGroup?(input: CreateCategoryGroupInput): Promise<CreateCategoryGroupResult>;
  updateCategoryGroup?(input: UpdateCategoryGroupInput): Promise<UpdateCategoryGroupResult>;
  deleteCategoryGroup?(input: DeleteCategoryGroupInput): Promise<DeleteCategoryGroupResult>;
  setBudgetCarryover?(
    month: string,
    categoryId: string,
    carryover: boolean,
  ): Promise<void>;
  holdBudgetForNextMonth?(month: string, amount: number): Promise<boolean>;
  resetBudgetHold?(month: string): Promise<void>;
  createPayee?(payee: { name: string }): Promise<{ id: string }>;
  updatePayee?(id: string, fields: { name?: string }): Promise<{ id: string }>;
  deletePayee?(id: string): Promise<{ id: string }>;
  mergePayees?(targetId: string, mergeIds: string[]): Promise<{ targetId: string; mergedCount: number }>;
  createAccount?(
    account: { name: string; type: AccountType; offbudget?: boolean },
    initialBalance?: number,
  ): Promise<{ id: string }>;
  updateAccount?(
    id: string,
    fields: { name?: string; offbudget?: boolean; closed?: boolean },
  ): Promise<{ id: string }>;
  closeAccount?(
    id: string,
    transferAccountId?: string,
    transferCategoryId?: string,
  ): Promise<{ id: string }>;
  reopenAccount?(id: string): Promise<{ id: string }>;
  runBankSync?(accountId?: string): Promise<RunBankSyncResult>;
  initialize?(): Promise<void>;
  sync?(): Promise<void>;
  shutdown?(): Promise<void>;
}
