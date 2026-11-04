import * as actualApi from '@actual-app/api';
import { z } from 'zod';
import { minorToDecimalAmount } from '../currency.js';

export const AQL_TABLES = [
  'transactions',
  'accounts',
  'categories',
  'category_groups',
  'payees',
  'schedules',
  'rules',
] as const;

export type AqlTable = (typeof AQL_TABLES)[number];

export const AQL_SPLITS_OPTIONS = ['inline', 'grouped', 'all'] as const;
export type AqlSplitsOption = (typeof AQL_SPLITS_OPTIONS)[number];

export const ALLOWED_AQL_FIELDS: Record<AqlTable, ReadonlySet<string>> = {
  transactions: new Set([
    'id',
    'is_parent',
    'is_child',
    'parent_id',
    'account',
    'account.id',
    'account.name',
    'account.offbudget',
    'account.closed',
    'account.account_group_id',
    'category',
    'category.id',
    'category.name',
    'category.is_income',
    'category.hidden',
    'category.group',
    'category.group.id',
    'category.group.name',
    'category.group.is_income',
    'category.group.hidden',
    'category.group.sort_order',
    'amount',
    'payee',
    'payee.id',
    'payee.name',
    'payee.transfer_acct',
    'notes',
    'date',
    'imported_id',
    'error',
    'imported_payee',
    'starting_balance_flag',
    'transfer_id',
    'sort_order',
    'cleared',
    'reconciled',
    'tombstone',
    'schedule',
    'schedule.id',
    'schedule.name',
    'schedule.next_date',
    'schedule.completed',
  ]),
  accounts: new Set([
    'id',
    'name',
    'offbudget',
    'closed',
    'sort_order',
    'tombstone',
    'account_id',
    'official_name',
    'account_sync_source',
    'last_reconciled',
    'last_sync',
    'bank_sync_status',
    'account_group_id',
  ]),
  categories: new Set([
    'id',
    'name',
    'is_income',
    'hidden',
    'group',
    'group.id',
    'group.name',
    'group.is_income',
    'group.hidden',
    'group.sort_order',
    'goal_def',
    'template_settings',
    'sort_order',
    'tombstone',
  ]),
  category_groups: new Set(['id', 'name', 'is_income', 'hidden', 'sort_order', 'tombstone']),
  payees: new Set(['id', 'name', 'transfer_acct', 'favorite', 'learn_categories', 'tombstone']),
  schedules: new Set([
    'id',
    'name',
    'rule',
    'next_date',
    'completed',
    'posts_transaction',
    'tombstone',
    '_payee',
    '_account',
    '_amount',
    '_amountOp',
    '_date',
    '_conditions',
    '_actions',
    '_has_splits',
  ]),
  rules: new Set(['id', 'stage', 'conditions_op', 'conditions', 'actions', 'tombstone']),
};

const ALLOWED_FILTER_OPERATORS = new Set([
  '$eq',
  '$ne',
  '$lt',
  '$lte',
  '$gt',
  '$gte',
  '$oneof',
  '$like',
  '$notlike',
  '$regex',
  '$transform',
]);

const ALLOWED_EXPRESSION_OPERATORS = new Set([
  '$sum',
  '$count',
  '$avg',
  '$min',
  '$max',
  '$month',
  '$year',
  '$day',
  '$abs',
  '$lower',
  '$neg',
  '$substr',
]);

const SAFE_ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

const MONETARY_FIELDS = new Set(['amount', '_amount']);
const MONETARY_AGGREGATE_OPS = new Set(['$sum', '$avg', '$min', '$max', '$abs', '$neg']);
const UNALIASED_MONETARY_KEY_RE = /^\$(sum|avg|min|max|abs|neg)\(\$?_?amount\)$/i;

function normalizeFieldRef(ref: string): string {
  return ref.startsWith('$') ? ref.slice(1) : ref;
}

function validateFilterObject(
  filter: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  table: AqlTable,
  ctx: z.RefinementCtx,
): void {
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Logical operator "${key}" must be an array of filter objects`,
          path: ['filter', key],
        });
        continue;
      }
      for (const item of value) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          validateFilterObject(item as Record<string, unknown>, allowedFields, table, ctx);
        } else {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid filter clause inside "${key}"`,
            path: ['filter', key],
          });
        }
      }
      continue;
    }

    if (!allowedFields.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Disallowed field "${key}" in filter for table "${table}"`,
        path: ['filter', key],
      });
      continue;
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const op of Object.keys(value as Record<string, unknown>)) {
        if (!ALLOWED_FILTER_OPERATORS.has(op)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Disallowed filter operator "${op}" on field "${key}"`,
            path: ['filter', key, op],
          });
        }
      }
    }
  }
}

export const structuredAqlQueryObjectSchema = z.object({
  table: z.enum(AQL_TABLES),
  filter: z.record(z.string(), z.unknown()).optional(),
  select: z
    .union([
      z.literal('*'),
      z.string(),
      z.record(z.string(), z.unknown()),
      z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
    ])
    .optional(),
  groupBy: z
    .union([
      z.string(),
      z.record(z.string(), z.unknown()),
      z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
    ])
    .optional(),
  orderBy: z
    .union([
      z.string(),
      z.record(z.string(), z.enum(['asc', 'desc'])),
      z.array(z.union([z.string(), z.record(z.string(), z.enum(['asc', 'desc']))])),
    ])
    .optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).optional(),
  splits: z.enum(AQL_SPLITS_OPTIONS).default('inline'),
  forceSync: z.boolean().optional(),
});

export const structuredAqlQueryInputSchema = structuredAqlQueryObjectSchema.superRefine(
  (data, ctx) => {
    const allowedFields = ALLOWED_AQL_FIELDS[data.table];
    const selectedAliases = new Set<string>();

    if (data.filter) {
      validateFilterObject(data.filter, allowedFields, data.table, ctx);
    }

    if (data.select !== undefined && data.select !== '*') {
      const items = Array.isArray(data.select) ? data.select : [data.select];
      for (const item of items) {
        if (typeof item === 'string') {
          if (item !== '*' && !allowedFields.has(item)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Disallowed field "${item}" in select for table "${data.table}"`,
              path: ['select'],
            });
          }
        } else if (typeof item === 'object' && item !== null) {
          for (const [alias, expr] of Object.entries(item)) {
            if (!SAFE_ALIAS_RE.test(alias)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Disallowed select alias "${alias}"`,
                path: ['select', alias],
              });
              continue;
            }
            selectedAliases.add(alias);

            if (typeof expr === 'string') {
              const target = normalizeFieldRef(expr);
              if (!allowedFields.has(target)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Disallowed field "${target}" in select alias "${alias}" for table "${data.table}"`,
                  path: ['select', alias],
                });
              }
            } else if (typeof expr === 'object' && expr !== null) {
              const entries = Object.entries(expr as Record<string, unknown>);
              if (entries.length === 0) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Empty expression for select alias "${alias}"`,
                  path: ['select', alias],
                });
              }
              for (const [op, target] of entries) {
                if (!ALLOWED_EXPRESSION_OPERATORS.has(op)) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Disallowed operator "${op}" in select alias "${alias}"`,
                    path: ['select', alias, op],
                  });
                  continue;
                }
                if (typeof target !== 'string' || !allowedFields.has(normalizeFieldRef(target))) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Disallowed field "${String(target)}" in select alias "${alias}" for table "${data.table}"`,
                    path: ['select', alias, op],
                  });
                }
              }
            }
          }
        }
      }
    }

    if (data.groupBy !== undefined) {
      const items = Array.isArray(data.groupBy) ? data.groupBy : [data.groupBy];
      for (const item of items) {
        if (typeof item === 'string') {
          if (!allowedFields.has(item)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Disallowed field "${item}" in groupBy for table "${data.table}"`,
              path: ['groupBy'],
            });
          }
        } else if (typeof item === 'object' && item !== null) {
          for (const [op, target] of Object.entries(item)) {
            if (!ALLOWED_EXPRESSION_OPERATORS.has(op)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Disallowed operator "${op}" in groupBy`,
                path: ['groupBy', op],
              });
              continue;
            }
            if (typeof target !== 'string' || !allowedFields.has(normalizeFieldRef(target))) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Disallowed field "${String(target)}" in groupBy for table "${data.table}"`,
                path: ['groupBy', op],
              });
            }
          }
        }
      }
    }

    if (data.orderBy !== undefined) {
      const items = Array.isArray(data.orderBy) ? data.orderBy : [data.orderBy];
      for (const item of items) {
        if (typeof item === 'string') {
          if (!allowedFields.has(item) && !selectedAliases.has(item)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Disallowed field "${item}" in orderBy for table "${data.table}"`,
              path: ['orderBy'],
            });
          }
        } else if (typeof item === 'object' && item !== null) {
          for (const field of Object.keys(item)) {
            if (!allowedFields.has(field) && !selectedAliases.has(field)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Disallowed field "${field}" in orderBy for table "${data.table}"`,
                path: ['orderBy', field],
              });
            }
          }
        }
      }
    }
  },
);

export type StructuredAqlQueryInput = z.input<typeof structuredAqlQueryInputSchema>;
export type ParsedStructuredAqlQuery = z.output<typeof structuredAqlQueryInputSchema>;

export interface AqlQueryResult {
  table: AqlTable;
  limit: number;
  offset: number;
  splits?: AqlSplitsOption;
  rows: Array<Record<string, unknown>>;
}

export function collectMonetaryKeys(query: ParsedStructuredAqlQuery): Set<string> {
  const keys = new Set<string>(MONETARY_FIELDS);

  const selectItems =
    query.select === undefined || query.select === '*'
      ? []
      : Array.isArray(query.select)
        ? query.select
        : [query.select];

  for (const item of selectItems) {
    if (typeof item === 'object' && item !== null) {
      for (const [alias, expr] of Object.entries(item)) {
        if (typeof expr === 'string' && MONETARY_FIELDS.has(normalizeFieldRef(expr))) {
          keys.add(alias);
        } else if (typeof expr === 'object' && expr !== null) {
          for (const [op, target] of Object.entries(expr as Record<string, unknown>)) {
            if (
              MONETARY_AGGREGATE_OPS.has(op) &&
              typeof target === 'string' &&
              MONETARY_FIELDS.has(normalizeFieldRef(target))
            ) {
              keys.add(alias);
            }
          }
        }
      }
    }
  }

  return keys;
}

export function convertAqlRowAmounts(
  row: Record<string, unknown>,
  monetaryKeys: Set<string>,
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (
      typeof value === 'number' &&
      (monetaryKeys.has(key) || UNALIASED_MONETARY_KEY_RE.test(key))
    ) {
      converted[key] = minorToDecimalAmount(value);
    } else if (key === 'subtransactions' && Array.isArray(value)) {
      converted[key] = value.map((sub) =>
        typeof sub === 'object' && sub !== null
          ? convertAqlRowAmounts(sub as Record<string, unknown>, monetaryKeys)
          : sub,
      );
    } else {
      converted[key] = value;
    }
  }

  return converted;
}

function normalizeFilterExpression(filter: Record<string, unknown>): Record<string, unknown> {
  const andClauses: Array<Record<string, unknown>> = [];
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filter)) {
    if ((key === '$and' || key === '$or') && Array.isArray(value)) {
      normalized[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? normalizeFilterExpression(item as Record<string, unknown>)
          : item,
      );
      continue;
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const opEntries = Object.entries(value as Record<string, unknown>);
      const transformEntry = opEntries.find(([op]) => op === '$transform');
      const comparisonEntries = opEntries.filter(([op]) => op !== '$transform');

      if (comparisonEntries.length > 1) {
        for (const [op, opVal] of comparisonEntries) {
          andClauses.push({
            [key]: {
              ...(transformEntry ? { $transform: transformEntry[1] } : {}),
              [op]: opVal,
            },
          });
        }
        continue;
      }
    }

    normalized[key] = value;
  }

  if (andClauses.length > 0) {
    const existingAnd = Array.isArray(normalized.$and)
      ? (normalized.$and as Array<Record<string, unknown>>)
      : [];
    normalized.$and = [...existingAnd, ...andClauses];
  }

  return normalized;
}

export function compileStructuredAqlQuery(
  parsed: ParsedStructuredAqlQuery,
  qBuilder: typeof actualApi.q = actualApi.q,
) {
  let query = qBuilder(parsed.table);

  if (parsed.filter && Object.keys(parsed.filter).length > 0) {
    query = query.filter(normalizeFilterExpression(parsed.filter));
  }

  if (parsed.groupBy !== undefined) {
    query = query.groupBy(parsed.groupBy as Parameters<typeof query.groupBy>[0]);
  }

  if (parsed.select !== undefined) {
    query = query.select(parsed.select as Parameters<typeof query.select>[0]);
  } else {
    query = query.select('*');
  }

  if (parsed.orderBy !== undefined) {
    query = query.orderBy(parsed.orderBy as Parameters<typeof query.orderBy>[0]);
  }

  query = query.limit(parsed.limit);

  if (parsed.offset !== undefined) {
    query = query.offset(parsed.offset);
  }

  if (parsed.table === 'transactions') {
    query = query.options({ splits: parsed.splits });
  }

  return query;
}
