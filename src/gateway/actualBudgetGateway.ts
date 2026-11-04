import fs from 'node:fs';
import * as actualApi from '@actual-app/api';
import { decimalToMinorAmount, minorToDecimalAmount } from '../currency.js';
import {
  collectMonetaryKeys,
  compileStructuredAqlQuery,
  convertAqlRowAmounts,
  structuredAqlQueryInputSchema,
  type AqlQueryResult,
  type StructuredAqlQueryInput,
} from './aql.js';
import type {
  AccountSummary,
  BudgetGateway,
  BudgetMonthCategoryGroupSummary,
  BudgetMonthCategorySummary,
  BudgetMonthSummary,
  BudgetReadiness,
  CategoryGroupSummary,
  CategorySummary,
  CreateTransactionsInput,
  CreateTransactionsResult,
  DeleteTransactionResult,
  GetSpendingSummaryInput,
  GetTransactionsFilter,
  PayeeSummary,
  SetBudgetAmountInput,
  SetBudgetAmountResult,
  SpendingSummary,
  SpendingSummaryGroup,
  TransactionRecord,
  UpdateTransactionInput,
  UpdateTransactionResult,
} from './types.js';

export interface ActualAccountRecord {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
}

export interface ActualCategoryRecord {
  id: string;
  name: string;
  group_id: string;
  is_income?: boolean;
  hidden?: boolean;
}

export interface ActualCategoryGroupRecord {
  id: string;
  name: string;
  is_income?: boolean;
  hidden?: boolean;
  categories?: ActualCategoryRecord[];
}

export interface ActualPayeeRecord {
  id: string;
  name: string;
  transfer_acct?: string | null;
}

export interface ActualTransactionRecord {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee?: string | null;
  imported_payee?: string | null;
  category?: string | null;
  notes?: string | null;
  cleared?: boolean;
  reconciled?: boolean;
  imported_id?: string | null;
  transfer_id?: string | null;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: string | null;
  subtransactions?: ActualTransactionRecord[];
}

export interface ActualBudgetMonthRecord {
  month: string;
  incomeAvailable?: number;
  lastMonthOverspent?: number;
  forNextMonth?: number;
  totalBudgeted?: number;
  toBudget?: number;
  fromLastMonth?: number;
  totalIncome?: number;
  totalSpent?: number;
  totalBalance?: number;
  categoryGroups: Array<
    Record<string, unknown> & {
      categories?: Record<string, unknown>[];
    }
  >;
}

export interface ActualInitConfig {
  dataDir?: string;
  serverURL: string;
  password: string;
}

export interface ActualImportTransactionInput {
  account: string;
  date: string;
  amount: number;
  payee?: string;
  payee_name?: string;
  category?: string;
  notes?: string;
  cleared?: boolean;
  imported_id?: string;
}

export interface ActualImportTransactionsResult {
  added?: string[];
  updated?: string[];
  errors?: unknown[];
}

export interface ActualApiAdapter {
  init?(config: ActualInitConfig): Promise<unknown>;
  downloadBudget?(syncId: string, opts?: { password?: string }): Promise<void>;
  sync?(): Promise<void>;
  shutdown?(): Promise<void>;
  getAccounts(): Promise<ActualAccountRecord[]>;
  getAccountBalance(id: string, cutoff?: Date): Promise<number>;
  getCategoryGroups?(): Promise<ActualCategoryGroupRecord[]>;
  getCategories?(): Promise<ActualCategoryRecord[]>;
  getPayees?(): Promise<ActualPayeeRecord[]>;
  getBudgetMonths?(): Promise<string[]>;
  getBudgetMonth?(month: string): Promise<ActualBudgetMonthRecord>;
  getTransactions?(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActualTransactionRecord[]>;
  importTransactions?(
    accountId: string,
    transactions: ActualImportTransactionInput[],
  ): Promise<ActualImportTransactionsResult>;
  addTransactions?(
    accountId: string,
    transactions: ActualImportTransactionInput[],
    opts?: { learnCategories?: boolean; runTransfers?: boolean },
  ): Promise<unknown>;
  updateTransaction?(
    id: string,
    fields: Record<string, unknown>,
  ): Promise<unknown>;
  deleteTransaction?(id: string): Promise<unknown>;
  setBudgetAmount?(month: string, categoryId: string, value: number): Promise<void>;
  setBudgetCarryover?(month: string, categoryId: string, flag: boolean): Promise<void>;
  q?: typeof actualApi.q;
  aqlQuery?(query: ReturnType<typeof actualApi.q>): Promise<unknown>;
}

export interface SignalTarget {
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  off?(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

export interface CreateActualBudgetGatewayOptions {
  syncId: string;
  dataDir?: string;
  serverURL?: string;
  password?: string;
  encryptionPassword?: string;
  syncTtlSeconds?: number;
  now?: () => number;
  api?: ActualApiAdapter;
  signalTarget?: SignalTarget;
}

export interface ActualBudgetGateway extends BudgetGateway {
  initialize(): Promise<void>;
  sync(): Promise<void>;
  shutdown(): Promise<void>;
  getTransactions(filter?: GetTransactionsFilter): Promise<TransactionRecord[]>;
  listCategories(options?: { forceSync?: boolean }): Promise<CategoryGroupSummary[]>;
  listPayees(options?: { forceSync?: boolean }): Promise<PayeeSummary[]>;
  listBudgetMonths(options?: { forceSync?: boolean }): Promise<string[]>;
  getBudgetMonth(
    month: string,
    options?: { forceSync?: boolean },
  ): Promise<BudgetMonthSummary>;
  createTransactions(input: CreateTransactionsInput): Promise<CreateTransactionsResult>;
  updateTransaction(input: UpdateTransactionInput): Promise<UpdateTransactionResult>;
  deleteTransaction(id: string): Promise<DeleteTransactionResult>;
  setBudgetAmount(input: SetBudgetAmountInput): Promise<SetBudgetAmountResult>;
  executeRead<T>(
    operation: (api: ActualApiAdapter) => Promise<T>,
    options?: { forceSync?: boolean },
  ): Promise<T>;
  executeWrite<T>(operation: (api: ActualApiAdapter) => Promise<T>): Promise<T>;
  getSpendingSummary(input: GetSpendingSummaryInput): Promise<SpendingSummary>;
  runAqlQuery(input: StructuredAqlQueryInput): Promise<AqlQueryResult>;
}

export function createActualBudgetGateway(
  options: CreateActualBudgetGatewayOptions,
): ActualBudgetGateway {
  const api: ActualApiAdapter = options.api ?? actualApi;
  const now = options.now ?? Date.now;
  const syncTtlMs = (options.syncTtlSeconds ?? 30) * 1000;
  const requiresInit = Boolean(
    options.dataDir || options.serverURL || options.password || api.init || api.downloadBudget,
  );

  let lastSyncedAtMs: number | null = null;
  let lastSyncedAt: string | null = null;
  let ready = !requiresInit;
  let initialized = !requiresInit;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;
  let queueTail: Promise<void> = Promise.resolve();

  function markSynced(): void {
    const currentMs = now();
    lastSyncedAtMs = currentMs;
    lastSyncedAt = new Date(currentMs).toISOString();
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (shuttingDown) {
      return Promise.reject(new Error('ActualBudgetGateway is shutting down'));
    }
    const result = queueTail.then(operation);
    queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function runSync(): Promise<void> {
    if (api.sync) {
      await api.sync();
      markSynced();
    }
  }

  async function runInitialize(): Promise<void> {
    if (initialized) {
      return;
    }

    if (options.dataDir) {
      fs.mkdirSync(options.dataDir, { recursive: true });
    }

    if (api.init) {
      await api.init({
        ...(options.dataDir ? { dataDir: options.dataDir } : {}),
        serverURL: options.serverURL ?? '',
        password: options.password ?? '',
      });
    }

    try {
      if (api.downloadBudget) {
        const downloadOpts = options.encryptionPassword
          ? { password: options.encryptionPassword }
          : undefined;
        await api.downloadBudget(options.syncId, downloadOpts);
      }
      markSynced();
      initialized = true;
      ready = true;
    } catch (error) {
      ready = false;
      await api.shutdown?.();
      throw error;
    }
  }

  async function executeRead<T>(
    operation: (apiAdapter: ActualApiAdapter) => Promise<T>,
    readOptions?: { forceSync?: boolean },
  ): Promise<T> {
    return enqueue(async () => {
      if (!initialized) {
        await runInitialize();
      }

      const shouldSync =
        Boolean(readOptions?.forceSync) ||
        lastSyncedAtMs === null ||
        now() - lastSyncedAtMs > syncTtlMs;

      if (shouldSync) {
        await runSync();
      }

      return operation(api);
    });
  }

  async function executeWrite<T>(
    operation: (apiAdapter: ActualApiAdapter) => Promise<T>,
  ): Promise<T> {
    return enqueue(async () => {
      if (!initialized) {
        await runInitialize();
      }

      await runSync();
      const result = await operation(api);
      await runSync();
      return result;
    });
  }

  function shutdown(): Promise<void> {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    const drainAndShutdown = queueTail.then(async () => {
      try {
        if (initialized) {
          await runSync();
        }
      } finally {
        ready = false;
        initialized = false;
        if (options.signalTarget?.off) {
          options.signalTarget.off('SIGTERM', handleSignal);
          options.signalTarget.off('SIGINT', handleSignal);
        }
        await api.shutdown?.();
      }
    });

    shuttingDown = true;
    queueTail = drainAndShutdown.then(
      () => undefined,
      () => undefined,
    );
    shutdownPromise = drainAndShutdown;
    return shutdownPromise;
  }

  function handleSignal(): void {
    void shutdown();
  }

  if (options.signalTarget) {
    options.signalTarget.once('SIGTERM', handleSignal);
    options.signalTarget.once('SIGINT', handleSignal);
  }

  async function fetchEnrichedTransactions(
    apiAdapter: ActualApiAdapter,
    accountId = '',
    startDate = '',
    endDate = '',
  ): Promise<TransactionRecord[]> {
    const rawTransactions =
      (await apiAdapter.getTransactions?.(accountId, startDate, endDate)) ?? [];
    const rawAccounts = (await apiAdapter.getAccounts?.()) ?? [];
    const rawCategories = apiAdapter.getCategories
      ? await apiAdapter.getCategories()
      : ((await apiAdapter.getCategoryGroups?.()) ?? []).flatMap(
          (g) => g.categories ?? [],
        );
    const rawPayees = (await apiAdapter.getPayees?.()) ?? [];

    const accountNameById = new Map(rawAccounts.map((a) => [a.id, a.name]));
    const categoryNameById = new Map(rawCategories.map((c) => [c.id, c.name]));
    const payeeNameById = new Map(rawPayees.map((p) => [p.id, p.name]));

    const enrichTransaction = (tx: ActualTransactionRecord): TransactionRecord => {
      const txAccountId = tx.account;
      const payeeId = tx.payee ?? null;
      const categoryId = tx.category ?? null;
      const subtransactions = Array.isArray(tx.subtransactions)
        ? tx.subtransactions.map(enrichTransaction)
        : undefined;

      return {
        id: tx.id,
        account: txAccountId,
        accountId: txAccountId,
        accountName: accountNameById.get(txAccountId) ?? null,
        date: tx.date,
        amount: minorToDecimalAmount(tx.amount),
        payee: payeeId,
        payeeId,
        payeeName: payeeId
          ? (payeeNameById.get(payeeId) ?? tx.imported_payee ?? null)
          : (tx.imported_payee ?? null),
        category: categoryId,
        categoryId,
        categoryName: categoryId ? (categoryNameById.get(categoryId) ?? null) : null,
        notes: tx.notes ?? null,
        cleared: Boolean(tx.cleared),
        ...(tx.reconciled !== undefined ? { reconciled: Boolean(tx.reconciled) } : {}),
        ...(tx.imported_id !== undefined ? { imported_id: tx.imported_id } : {}),
        ...(tx.transfer_id !== undefined ? { transfer_id: tx.transfer_id } : {}),
        ...(tx.is_parent !== undefined ? { is_parent: Boolean(tx.is_parent) } : {}),
        ...(tx.is_child !== undefined ? { is_child: Boolean(tx.is_child) } : {}),
        ...(tx.parent_id !== undefined ? { parent_id: tx.parent_id } : {}),
        ...(subtransactions !== undefined ? { subtransactions } : {}),
      };
    };

    return rawTransactions.map(enrichTransaction);
  }

  function findTransactionById(
    records: TransactionRecord[],
    id: string,
  ): TransactionRecord | undefined {
    for (const record of records) {
      if (record.id === id) {
        return record;
      }
      if (record.subtransactions) {
        const sub = findTransactionById(record.subtransactions, id);
        if (sub) {
          return sub;
        }
      }
    }
    return undefined;
  }

  async function fetchBudgetMonthSummary(
    apiAdapter: ActualApiAdapter,
    month: string,
  ): Promise<BudgetMonthSummary> {
    if (!apiAdapter.getBudgetMonth) {
      throw new Error('getBudgetMonth is not supported by the current API adapter');
    }
    const raw = await apiAdapter.getBudgetMonth(month);
    const categoryGroups: BudgetMonthCategoryGroupSummary[] = (
      raw.categoryGroups ?? []
    ).map((group) => {
      const groupId = String(group.id ?? '');
      const groupIsIncome = Boolean(group.is_income);
      const rawCategories = Array.isArray(group.categories) ? group.categories : [];
      const categories: BudgetMonthCategorySummary[] = rawCategories.map((cat) => {
        const catBudgeted = typeof cat.budgeted === 'number' ? cat.budgeted : 0;
        const catReceived =
          typeof cat.received === 'number' ? cat.received : undefined;
        const catSpent =
          typeof cat.spent === 'number'
            ? cat.spent
            : typeof catReceived === 'number'
              ? catReceived
              : 0;
        const catBalance = typeof cat.balance === 'number' ? cat.balance : 0;

        return {
          id: String(cat.id ?? ''),
          name: String(cat.name ?? ''),
          group_id: String(cat.group_id ?? groupId),
          is_income: Boolean(cat.is_income ?? groupIsIncome),
          hidden: Boolean(cat.hidden),
          budgeted: minorToDecimalAmount(catBudgeted),
          spent: minorToDecimalAmount(catSpent),
          balance: minorToDecimalAmount(catBalance),
          carryover: Boolean(cat.carryover),
          ...(catReceived !== undefined
            ? { received: minorToDecimalAmount(catReceived) }
            : {}),
        };
      });

      const groupBudgeted = typeof group.budgeted === 'number' ? group.budgeted : 0;
      const groupReceived =
        typeof group.received === 'number' ? group.received : undefined;
      const groupSpent =
        typeof group.spent === 'number'
          ? group.spent
          : typeof groupReceived === 'number'
            ? groupReceived
            : 0;
      const groupBalance = typeof group.balance === 'number' ? group.balance : 0;

      return {
        id: groupId,
        name: String(group.name ?? ''),
        is_income: groupIsIncome,
        hidden: Boolean(group.hidden),
        budgeted: minorToDecimalAmount(groupBudgeted),
        spent: minorToDecimalAmount(groupSpent),
        balance: minorToDecimalAmount(groupBalance),
        ...(groupReceived !== undefined
          ? { received: minorToDecimalAmount(groupReceived) }
          : {}),
        categories,
      };
    });

    const categories = categoryGroups.flatMap((group) => group.categories);

    return {
      month: raw.month ?? month,
      incomeAvailable: minorToDecimalAmount(raw.incomeAvailable ?? 0),
      lastMonthOverspent: minorToDecimalAmount(raw.lastMonthOverspent ?? 0),
      forNextMonth: minorToDecimalAmount(raw.forNextMonth ?? 0),
      totalBudgeted: minorToDecimalAmount(raw.totalBudgeted ?? 0),
      toBudget: minorToDecimalAmount(raw.toBudget ?? 0),
      fromLastMonth: minorToDecimalAmount(raw.fromLastMonth ?? 0),
      totalIncome: minorToDecimalAmount(raw.totalIncome ?? 0),
      totalSpent: minorToDecimalAmount(raw.totalSpent ?? 0),
      totalBalance: minorToDecimalAmount(raw.totalBalance ?? 0),
      categoryGroups,
      categories,
    };
  }

  return {
    getReadiness(): BudgetReadiness {
      return {
        ready,
        syncId: options.syncId,
        lastSyncedAt,
      };
    },
    async initialize(): Promise<void> {
      await enqueue(runInitialize);
    },
    async sync(): Promise<void> {
      await enqueue(async () => {
        if (!initialized) {
          await runInitialize();
        }
        await runSync();
      });
    },
    shutdown,
    executeRead,
    executeWrite,
    async listAccounts(readOptions?: { forceSync?: boolean }): Promise<AccountSummary[]> {
      return executeRead(async (apiAdapter) => {
        const rawAccounts = await apiAdapter.getAccounts();
        const summaries: AccountSummary[] = [];

        for (const account of rawAccounts) {
          const minorBalance = await apiAdapter.getAccountBalance(account.id);
          summaries.push({
            id: account.id,
            name: account.name,
            offbudget: Boolean(account.offbudget),
            closed: Boolean(account.closed),
            balance: minorToDecimalAmount(minorBalance),
          });
        }

        return summaries;
      }, readOptions);
    },
    async getSpendingSummary(input: GetSpendingSummaryInput): Promise<SpendingSummary> {
      const groupBy = input.groupBy ?? 'category';
      const includeTransfers = Boolean(input.includeTransfers);
      const includeOffBudget = Boolean(input.includeOffBudget);

      return executeRead(
        async (apiAdapter) => {
          if (!apiAdapter.aqlQuery) {
            throw new Error('Actual API adapter does not support aqlQuery');
          }
          const qBuilder = apiAdapter.q ?? actualApi.q;

          const filters: Array<Record<string, unknown>> = [
            { date: { $gte: input.startDate } },
            { date: { $lte: input.endDate } },
          ];
          if (!includeOffBudget) {
            filters.push({ 'account.offbudget': false });
          }
          if (!includeTransfers) {
            filters.push({ 'payee.transfer_acct': null });
          }

          let query = qBuilder('transactions')
            .filter({ $and: filters })
            .options({ splits: 'inline' });

          if (groupBy === 'category') {
            query = query
              .groupBy(['category', 'category.name'])
              .select([
                'category',
                'category.name',
                { total: { $sum: '$amount' } },
                { count: { $count: '$id' } },
              ]);
          } else if (groupBy === 'payee') {
            query = query
              .groupBy(['payee', 'payee.name'])
              .select([
                'payee',
                'payee.name',
                { total: { $sum: '$amount' } },
                { count: { $count: '$id' } },
              ]);
          } else {
            query = query
              .groupBy({ $month: '$date' })
              .select([
                { month: { $month: '$date' } },
                { total: { $sum: '$amount' } },
                { count: { $count: '$id' } },
              ]);
          }

          const queryResult = (await apiAdapter.aqlQuery(query)) as { data?: unknown } | undefined;
          const data = queryResult?.data;
          const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];

          let totalMinor = 0;
          const groups: SpendingSummaryGroup[] = rows.map((row) => {
            const rowMinor = typeof row.total === 'number' ? row.total : 0;
            const rowCount = typeof row.count === 'number' ? row.count : 0;
            totalMinor += rowMinor;

            if (groupBy === 'category') {
              return {
                categoryId: (row.category as string | null | undefined) ?? null,
                categoryName: (row['category.name'] as string | null | undefined) ?? null,
                total: minorToDecimalAmount(rowMinor),
                count: rowCount,
              };
            }
            if (groupBy === 'payee') {
              return {
                payeeId: (row.payee as string | null | undefined) ?? null,
                payeeName: (row['payee.name'] as string | null | undefined) ?? null,
                total: minorToDecimalAmount(rowMinor),
                count: rowCount,
              };
            }
            return {
              month: String(row.month ?? ''),
              total: minorToDecimalAmount(rowMinor),
              count: rowCount,
            };
          });

          return {
            startDate: input.startDate,
            endDate: input.endDate,
            groupBy,
            includeTransfers,
            includeOffBudget,
            total: minorToDecimalAmount(totalMinor),
            groups,
          };
        },
        input.forceSync !== undefined ? { forceSync: input.forceSync } : undefined,
      );
    },
    async runAqlQuery(input: StructuredAqlQueryInput): Promise<AqlQueryResult> {
      const parsed = structuredAqlQueryInputSchema.parse(input);
      const monetaryKeys = collectMonetaryKeys(parsed);

      return executeRead(
        async (apiAdapter) => {
          if (!apiAdapter.aqlQuery) {
            throw new Error('Actual API adapter does not support aqlQuery');
          }
          const qBuilder = apiAdapter.q ?? actualApi.q;
          const query = compileStructuredAqlQuery(parsed, qBuilder);
          const queryResult = (await apiAdapter.aqlQuery(query)) as { data?: unknown } | undefined;
          const data = queryResult?.data;
          const rawRows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
          const rows = rawRows.map((row) => convertAqlRowAmounts(row, monetaryKeys));

          return {
            table: parsed.table,
            limit: parsed.limit,
            offset: parsed.offset ?? 0,
            ...(parsed.table === 'transactions' ? { splits: parsed.splits } : {}),
            rows,
          };
        },
        parsed.forceSync !== undefined ? { forceSync: parsed.forceSync } : undefined,
      );
    },
    async getTransactions(
      filter?: GetTransactionsFilter,
    ): Promise<TransactionRecord[]> {
      return executeRead(
        async (apiAdapter) => {
          const enriched = await fetchEnrichedTransactions(
            apiAdapter,
            filter?.accountId ?? '',
            filter?.startDate ?? '',
            filter?.endDate ?? '',
          );
          const searchNeedle = filter?.searchText?.trim().toLowerCase() ?? '';
          const effectiveLimit = Math.min(Math.max(filter?.limit ?? 100, 1), 500);

          const matchesSearch = (tx: TransactionRecord): boolean => {
            const payeeMatch = (tx.payeeName ?? '').toLowerCase().includes(searchNeedle);
            const notesMatch = (tx.notes ?? '').toLowerCase().includes(searchNeedle);
            const subMatch =
              tx.subtransactions?.some((sub) => matchesSearch(sub)) ?? false;
            return payeeMatch || notesMatch || subMatch;
          };

          const filtered = enriched.filter((tx) => {
            if (filter?.accountId && tx.accountId !== filter.accountId) {
              return false;
            }
            if (filter?.startDate && tx.date < filter.startDate) {
              return false;
            }
            if (filter?.endDate && tx.date > filter.endDate) {
              return false;
            }
            if (filter?.categoryId) {
              const matchesCategory =
                tx.categoryId === filter.categoryId ||
                (tx.subtransactions?.some((s) => s.categoryId === filter.categoryId) ??
                  false);
              if (!matchesCategory) {
                return false;
              }
            }
            if (filter?.payeeId) {
              const matchesPayee =
                tx.payeeId === filter.payeeId ||
                (tx.subtransactions?.some((s) => s.payeeId === filter.payeeId) ?? false);
              if (!matchesPayee) {
                return false;
              }
            }
            if (searchNeedle.length > 0 && !matchesSearch(tx)) {
              return false;
            }
            return true;
          });

          return filtered.slice(0, effectiveLimit);
        },
        filter?.forceSync !== undefined ? { forceSync: filter.forceSync } : undefined,
      );
    },
    async listCategories(
      readOptions?: { forceSync?: boolean },
    ): Promise<CategoryGroupSummary[]> {
      return executeRead(async (apiAdapter) => {
        const rawGroups = (await apiAdapter.getCategoryGroups?.()) ?? [];
        const needsFallbackCategories = rawGroups.some((g) => !Array.isArray(g.categories));
        const fallbackCategories =
          needsFallbackCategories && apiAdapter.getCategories
            ? await apiAdapter.getCategories()
            : [];

        return rawGroups.map((group) => {
          const rawCategories = Array.isArray(group.categories)
            ? group.categories
            : fallbackCategories.filter((c) => c.group_id === group.id);
          const categories: CategorySummary[] = rawCategories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            group_id: cat.group_id ?? group.id,
            is_income: Boolean(cat.is_income ?? group.is_income),
            hidden: Boolean(cat.hidden),
          }));

          return {
            id: group.id,
            name: group.name,
            is_income: Boolean(group.is_income),
            hidden: Boolean(group.hidden),
            categories,
          };
        });
      }, readOptions);
    },
    async listPayees(readOptions?: { forceSync?: boolean }): Promise<PayeeSummary[]> {
      return executeRead(async (apiAdapter) => {
        const rawPayees = (await apiAdapter.getPayees?.()) ?? [];
        return rawPayees.map((payee) => ({
          id: payee.id,
          name: payee.name,
          transfer_acct: payee.transfer_acct ?? null,
        }));
      }, readOptions);
    },
    async listBudgetMonths(readOptions?: { forceSync?: boolean }): Promise<string[]> {
      return executeRead(async (apiAdapter) => {
        const rawMonths = (await apiAdapter.getBudgetMonths?.()) ?? [];
        return [...rawMonths].sort();
      }, readOptions);
    },
    async getBudgetMonth(
      month: string,
      readOptions?: { forceSync?: boolean },
    ): Promise<BudgetMonthSummary> {
      return executeRead(async (apiAdapter) => {
        return fetchBudgetMonthSummary(apiAdapter, month);
      }, readOptions);
    },
    async createTransactions(
      input: CreateTransactionsInput,
    ): Promise<CreateTransactionsResult> {
      if (input.transactions.length < 1 || input.transactions.length > 50) {
        throw new Error('createTransactions requires between 1 and 50 transactions');
      }

      return executeWrite(async (apiAdapter) => {
        const mappedTransactions: ActualImportTransactionInput[] =
          input.transactions.map((tx) => ({
            account: input.accountId,
            date: tx.date,
            amount: decimalToMinorAmount(tx.amount),
            ...(tx.payeeId !== undefined ? { payee: tx.payeeId } : {}),
            ...(tx.payeeName !== undefined ? { payee_name: tx.payeeName } : {}),
            ...(tx.categoryId !== undefined ? { category: tx.categoryId } : {}),
            ...(tx.notes !== undefined ? { notes: tx.notes } : {}),
            ...(tx.cleared !== undefined ? { cleared: tx.cleared } : {}),
            ...(tx.importedId !== undefined ? { imported_id: tx.importedId } : {}),
          }));

        const runRules = input.runRules ?? true;
        if (runRules) {
          if (!apiAdapter.importTransactions) {
            throw new Error(
              'importTransactions is not supported by the current API adapter',
            );
          }
          const result = await apiAdapter.importTransactions(
            input.accountId,
            mappedTransactions,
          );
          return {
            mode: 'import',
            added: result?.added ?? [],
            updated: result?.updated ?? [],
            errors: result?.errors ?? [],
          };
        }

        if (!apiAdapter.addTransactions) {
          throw new Error(
            'addTransactions is not supported by the current API adapter',
          );
        }
        await apiAdapter.addTransactions(input.accountId, mappedTransactions);
        return {
          mode: 'add',
          added: [],
          updated: [],
          errors: [],
        };
      });
    },
    async updateTransaction(
      input: UpdateTransactionInput,
    ): Promise<UpdateTransactionResult> {
      return executeWrite(async (apiAdapter) => {
        if (!apiAdapter.updateTransaction) {
          throw new Error(
            'updateTransaction is not supported by the current API adapter',
          );
        }

        const beforeRecords = await fetchEnrichedTransactions(apiAdapter);
        const previous = findTransactionById(beforeRecords, input.id);
        if (!previous) {
          throw new Error(`Transaction not found: ${input.id}`);
        }

        const fields: Record<string, unknown> = {};
        if (input.date !== undefined) {
          fields.date = input.date;
        }
        if (input.amount !== undefined) {
          fields.amount = decimalToMinorAmount(input.amount);
        }
        if (input.payeeId !== undefined) {
          fields.payee = input.payeeId;
        }
        if (input.categoryId !== undefined) {
          fields.category = input.categoryId;
        }
        if (input.notes !== undefined) {
          fields.notes = input.notes;
        }
        if (input.cleared !== undefined) {
          fields.cleared = input.cleared;
        }

        await apiAdapter.updateTransaction(input.id, fields);

        const afterRecords = await fetchEnrichedTransactions(apiAdapter);
        const updated = findTransactionById(afterRecords, input.id) ?? {
          ...previous,
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.payeeId !== undefined
            ? { payee: input.payeeId, payeeId: input.payeeId }
            : {}),
          ...(input.categoryId !== undefined
            ? { category: input.categoryId, categoryId: input.categoryId }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.cleared !== undefined ? { cleared: input.cleared } : {}),
        };

        return {
          previous,
          updated,
        };
      });
    },
    async deleteTransaction(id: string): Promise<DeleteTransactionResult> {
      return executeWrite(async (apiAdapter) => {
        if (!apiAdapter.deleteTransaction) {
          throw new Error(
            'deleteTransaction is not supported by the current API adapter',
          );
        }

        const beforeRecords = await fetchEnrichedTransactions(apiAdapter);
        const deleted = findTransactionById(beforeRecords, id);
        if (!deleted) {
          throw new Error(`Transaction not found: ${id}`);
        }

        await apiAdapter.deleteTransaction(id);
        return { deleted };
      });
    },
    async setBudgetAmount(
      input: SetBudgetAmountInput,
    ): Promise<SetBudgetAmountResult> {
      if (input.budgeted === undefined && input.carryover === undefined) {
        throw new Error(
          'setBudgetAmount requires at least one of budgeted or carryover',
        );
      }

      return executeWrite(async (apiAdapter) => {
        const beforeMonth = await fetchBudgetMonthSummary(apiAdapter, input.month);
        const previous = beforeMonth.categories.find(
          (c) => c.id === input.categoryId,
        );
        if (!previous) {
          throw new Error(
            `Category not found in Budget Month ${input.month}: ${input.categoryId}`,
          );
        }

        if (input.budgeted !== undefined) {
          if (!apiAdapter.setBudgetAmount) {
            throw new Error(
              'setBudgetAmount is not supported by the current API adapter',
            );
          }
          await apiAdapter.setBudgetAmount(
            input.month,
            input.categoryId,
            decimalToMinorAmount(input.budgeted),
          );
        }

        if (input.carryover !== undefined) {
          if (!apiAdapter.setBudgetCarryover) {
            throw new Error(
              'setBudgetCarryover is not supported by the current API adapter',
            );
          }
          await apiAdapter.setBudgetCarryover(
            input.month,
            input.categoryId,
            input.carryover,
          );
        }

        const afterMonth = await fetchBudgetMonthSummary(apiAdapter, input.month);
        const updated = afterMonth.categories.find(
          (c) => c.id === input.categoryId,
        ) ?? {
          ...previous,
          ...(input.budgeted !== undefined ? { budgeted: input.budgeted } : {}),
          ...(input.carryover !== undefined ? { carryover: input.carryover } : {}),
        };

        return {
          month: input.month,
          categoryId: input.categoryId,
          previous,
          updated,
        };
      });
    },
  };
}
