import fs from 'node:fs';
import * as actualApi from '@actual-app/api';
import { minorToDecimalAmount } from '../currency.js';
import type {
  AccountSummary,
  BudgetGateway,
  BudgetMonthCategoryGroupSummary,
  BudgetMonthCategorySummary,
  BudgetMonthSummary,
  BudgetReadiness,
  CategoryGroupSummary,
  CategorySummary,
  GetTransactionsFilter,
  PayeeSummary,
  TransactionRecord,
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
  executeRead<T>(
    operation: (api: ActualApiAdapter) => Promise<T>,
    options?: { forceSync?: boolean },
  ): Promise<T>;
  executeWrite<T>(operation: (api: ActualApiAdapter) => Promise<T>): Promise<T>;
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
    async getTransactions(
      filter?: GetTransactionsFilter,
    ): Promise<TransactionRecord[]> {
      return executeRead(
        async (apiAdapter) => {
          const rawTransactions =
            (await apiAdapter.getTransactions?.(
              filter?.accountId ?? '',
              filter?.startDate ?? '',
              filter?.endDate ?? '',
            )) ?? [];

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
            const accountId = tx.account;
            const payeeId = tx.payee ?? null;
            const categoryId = tx.category ?? null;
            const subtransactions = Array.isArray(tx.subtransactions)
              ? tx.subtransactions.map(enrichTransaction)
              : undefined;

            return {
              id: tx.id,
              account: accountId,
              accountId,
              accountName: accountNameById.get(accountId) ?? null,
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

          const enriched = rawTransactions.map(enrichTransaction);
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
      }, readOptions);
    },
  };
}
