import type { AqlQueryResult, StructuredAqlQueryInput } from './aql.js';
import type { ResourceFacadeResult } from './resolver.js';

export type {
  AqlQueryResult,
  AqlSplitsOption,
  AqlTable,
  ParsedStructuredAqlQuery,
  StructuredAqlQueryInput,
} from './aql.js';
export type {
  BudgetCacheSource,
  ResolvableCandidate,
  ResolvableEntityType,
  ResolvedEntity,
  ResolveEntityOptions,
  ResourceFacadeErrorResult,
  ResourceFacadeResult,
} from './resolver.js';

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'investment'
  | 'mortgage'
  | 'debt'
  | 'other';

export type ManageAccountAction = 'create' | 'update' | 'close' | 'reopen';

export interface ManageAccountsInput {
  action: ManageAccountAction;
  id?: string;
  name?: string;
  account?: string;
  newName?: string;
  type?: AccountType;
  offbudget?: boolean;
  initialBalance?: number;
  transferTo?: string;
  transferAccountId?: string;
  transferCategory?: string;
  transferCategoryId?: string;
  forced?: boolean;
}

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

export interface ManageTransactionCreateItemInput {
  date: string;
  /** Transaction amount expressed as a Decimal Amount (negative for Outflow, positive for Inflow). */
  amount: number;
  payee?: string;
  payeeName?: string;
  payeeId?: string;
  category?: string;
  categoryId?: string;
  notes?: string;
  cleared?: boolean;
  importedId?: string;
}

export interface ManageTransactionsCreateInput {
  action: 'create';
  account?: string;
  accountId?: string;
  transactions: ManageTransactionCreateItemInput[];
  runRules?: boolean;
}

export interface ManageTransactionsUpdateInput {
  action: 'update';
  id?: string;
  ids?: string[];
  date?: string;
  /** Transaction amount expressed as a Decimal Amount (negative for Outflow, positive for Inflow). */
  amount?: number;
  payee?: string | null;
  payeeId?: string | null;
  payeeName?: string | null;
  category?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  cleared?: boolean;
}

export interface ManageTransactionsDeleteInput {
  action: 'delete';
  id?: string;
  ids?: string[];
}

export type ManageTransactionsInput =
  | ManageTransactionsCreateInput
  | ManageTransactionsUpdateInput
  | ManageTransactionsDeleteInput;

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

export type ManagePayeesAction = 'create' | 'update' | 'delete' | 'merge';

export interface ManagePayeesInput {
  action: ManagePayeesAction;
  /** Payee ID or name for update/delete (or target in merge). */
  id?: string;
  /** Payee name for create, target payee name/ID for update/delete, or new name when id/payee is supplied in update. */
  name?: string;
  /** Alias for payee name or ID in create/update/delete. */
  payee?: string;
  /** Explicit new payee name when action is 'update'. */
  newName?: string;
  /** Target payee name or UUID to keep when action is 'merge'. */
  target?: string;
  /** Target payee name or UUID to keep when action is 'merge'. */
  targetId?: string;
  /** Alias for target payee name or UUID when action is 'merge'. */
  targetPayeeId?: string;
  /** Array of duplicate payee names or UUIDs to merge into target when action is 'merge'. */
  merge?: string[];
  /** Array of duplicate payee names or UUIDs to merge into target when action is 'merge'. */
  mergeIds?: string[];
  /** Alias for array of duplicate payee names or UUIDs when action is 'merge'. */
  sourcePayeeIds?: string[];
}

export interface RunBankSyncResult {
  updatedAccountIds: string[];
  newTransactionsCount: number;
  matchedTransactionsCount: number;
  errors?: string[];
}

export type ScheduleAmountOp = 'is' | 'isapprox' | 'isbetween';

export type ScheduleAmount = number | { num1: number; num2: number };

export interface ScheduleSummary {
  id: string;
  name: string | null;
  rule: string;
  next_date: string | null;
  completed: boolean;
  status: 'completed' | 'active';
  posts_transaction: boolean;
  payee: string | null;
  account: string | null;
  /** Schedule amount expressed as a Decimal Amount (number or between range { num1, num2 }). */
  amount: ScheduleAmount | null;
  amountOp: ScheduleAmountOp | null;
  date: unknown;
}

export interface CreateScheduleInput {
  name?: string;
  account: string;
  payee?: string | null;
  /** Decimal Amount */
  amount: ScheduleAmount;
  amountOp?: ScheduleAmountOp;
  date: unknown;
  posts_transaction?: boolean;
}

export interface UpdateScheduleInput {
  name?: string;
  account?: string;
  payee?: string | null;
  /** Decimal Amount */
  amount?: ScheduleAmount;
  amountOp?: ScheduleAmountOp;
  date?: unknown;
  posts_transaction?: boolean;
}

export interface GetScheduleDatesInput {
  scheduleId?: string;
  date?: unknown;
  start?: string;
  end?: string;
  count?: number;
  forceSync?: boolean;
}

export interface RuleCondition {
  field: string;
  op: string;
  value?: unknown;
  options?: unknown;
  type?: string;
  [key: string]: unknown;
}

export interface RuleAction {
  field?: string;
  op: string;
  value?: unknown;
  options?: unknown;
  type?: string;
  [key: string]: unknown;
}

export interface RuleSummary {
  id: string;
  stage: 'pre' | 'post' | 'default' | null;
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export interface CreateRuleInput {
  stage?: 'pre' | 'post' | 'default';
  conditionsOp?: 'and' | 'or';
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export interface UpdateRuleInput {
  id: string;
  stage?: 'pre' | 'post' | 'default';
  conditionsOp?: 'and' | 'or';
  conditions: RuleCondition[];
  actions: RuleAction[];
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
  manageTransactions?(input: ManageTransactionsInput): Promise<ResourceFacadeResult<unknown>>;
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
  managePayees?(input: ManagePayeesInput): Promise<ResourceFacadeResult<unknown>>;
  createAccount?(
    account: { name: string; type: AccountType; offbudget?: boolean },
    initialBalance?: number,
  ): Promise<{ id: string }>;
  updateAccount?(
    id: string,
    fields: { name?: string; offbudget?: boolean },
  ): Promise<{ id: string }>;
  closeAccount?(
    id: string,
    transferAccountId?: string,
    transferCategoryId?: string,
  ): Promise<{ id: string }>;
  reopenAccount?(id: string): Promise<{ id: string }>;
  manageAccounts?(input: ManageAccountsInput): Promise<ResourceFacadeResult<unknown>>;
  runBankSync?(accountId?: string): Promise<RunBankSyncResult>;
  listSchedules?(options?: { forceSync?: boolean }): Promise<ScheduleSummary[]>;
  getScheduleDates?(input: GetScheduleDatesInput): Promise<string[]>;
  createSchedule?(input: CreateScheduleInput): Promise<{ id: string }>;
  updateSchedule?(
    id: string,
    fields: UpdateScheduleInput,
    resetNextDate?: boolean,
  ): Promise<{ id: string }>;
  deleteSchedule?(id: string): Promise<{ id: string }>;
  listRules?(options?: { payeeId?: string; forceSync?: boolean }): Promise<RuleSummary[]>;
  createRule?(input: CreateRuleInput): Promise<RuleSummary>;
  updateRule?(input: UpdateRuleInput): Promise<RuleSummary>;
  deleteRule?(id: string): Promise<{ id: string }>;
  initialize?(): Promise<void>;
  sync?(): Promise<void>;
  shutdown?(): Promise<void>;
}
