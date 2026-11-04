import fs from 'node:fs';
import * as actualApi from '@actual-app/api';
import { minorToDecimalAmount } from '../currency.js';
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
  BudgetReadiness,
  GetSpendingSummaryInput,
  SpendingSummary,
  SpendingSummaryGroup,
} from './types.js';

export interface ActualAccountRecord {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
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
  };
}
