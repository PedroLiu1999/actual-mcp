import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AQL_SPLITS_OPTIONS,
  AQL_TABLES,
  structuredAqlQueryInputSchema,
  structuredAqlQueryObjectSchema,
} from '../gateway/aql.js';
import {
  createResourceFacadeErrorResponse,
  EntityResolutionError,
} from '../gateway/resolver.js';
import type { BudgetGateway, ManageTransactionsInput } from '../gateway/types.js';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');

const budgetMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Expected month in YYYY-MM format');

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

const scheduleAmountSchema = z.union([
  z
    .number()
    .finite()
    .describe(
      'Decimal Amount in standard major currency units (e.g. -50.00 for expense, 2500.00 for income).',
    ),
  z
    .object({
      num1: z.number().finite().describe('Lower bound Decimal Amount.'),
      num2: z.number().finite().describe('Upper bound Decimal Amount.'),
    })
    .describe('Decimal Amount range for between operator.'),
]);

const scheduleDateSchema = z.union([
  isoDateSchema.describe('Exact date in YYYY-MM-DD format.'),
  z
    .record(z.string(), z.unknown())
    .describe(
      'Recurrence configuration object (e.g. { frequency: "monthly", start: "2026-11-01" }).',
    ),
]);

const ruleConditionSchema = z.object({
  field: z
    .string()
    .describe(
      'Field to match on (e.g. "payee", "amount", "notes", "account", "category", "date").',
    ),
  op: z
    .string()
    .describe(
      'Operator (e.g. "is", "isNot", "contains", "doesNotContain", "matches", "gt", "gte", "lt", "lte", "isbetween", "isapprox", "oneOf", "notOneOf").',
    ),
  value: z
    .unknown()
    .describe(
      'Comparison value. For "amount" conditions, supply standard Decimal Amount (e.g. -50.00) or { num1, num2 } range.',
    ),
  options: z
    .unknown()
    .optional()
    .describe('Optional matching options (e.g. { inflow: boolean, outflow: boolean }).'),
  type: z.string().optional(),
});

const ruleActionSchema = z.object({
  field: z
    .string()
    .optional()
    .describe('Target field to modify (e.g. "category", "notes", "cleared", "payee").'),
  op: z
    .string()
    .describe(
      'Action operator (e.g. "set", "set-split-amount", "link-schedule", "delete-transaction", "prepend-notes", "append-notes").',
    ),
  value: z
    .unknown()
    .optional()
    .describe('Value to assign. For monetary actions, supply standard Decimal Amount.'),
  options: z.unknown().optional().describe('Optional action options.'),
  type: z.string().optional(),
});

import { BRAND_ICON_DATA_URI } from './icon.js';

export function createMcpServer(budgetGateway: BudgetGateway, _publicUrl?: string): McpServer {
  const icons = [
    {
      src: BRAND_ICON_DATA_URI,
      mimeType: 'image/png',
      sizes: ['128x128', '512x512'],
    },
  ];

  const server = new McpServer(
    {
      name: 'actual-mcp',
      version: '0.4.6',
      icons,
    },
    {
      instructions:
        'Actual Budget MCP Server. All monetary amounts are Decimal Amounts in standard major units (e.g. -12.34 for a $12.34 expense/Outflow, 100.00 for a $100.00 income/Inflow).',
    },
  );

  server.registerTool(
    'list_accounts',
    {
      title: 'List Accounts',
      description:
        'List all accounts in the Target Budget with their ID, name, off-budget flag, closed flag, and current balance as a Decimal Amount.',
      inputSchema: {
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading accounts.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ forceSync }) => {
      const accounts = await budgetGateway.listAccounts(
        forceSync !== undefined ? { forceSync } : undefined,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ accounts }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_transactions',
    {
      title: 'Get Transactions',
      description:
        'Query transactions with optional filters (accountId, startDate, endDate, categoryId, payeeId, case-insensitive searchText matching payee name or notes, limit default 100 max 500, and forceSync). Returns enriched records with Decimal Amounts and resolved accountName, categoryName, and payeeName alongside their IDs.',
      inputSchema: {
        accountId: z.string().optional().describe('Filter by account ID.'),
        startDate: isoDateSchema
          .optional()
          .describe('Inclusive start date in YYYY-MM-DD format.'),
        endDate: isoDateSchema
          .optional()
          .describe('Inclusive end date in YYYY-MM-DD format.'),
        categoryId: z.string().optional().describe('Filter by category ID.'),
        payeeId: z.string().optional().describe('Filter by payee ID.'),
        searchText: z
          .string()
          .optional()
          .describe('Case-insensitive substring matching payee name or notes.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Maximum number of transactions to return (default 100, max 500).'),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading transactions.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async (args) => {
      const filter = stripUndefined(args);
      const transactions =
        (await budgetGateway.getTransactions?.(
          Object.keys(filter).length > 0 ? filter : undefined,
        )) ?? [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ transactions }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_spending_summary',
    {
      title: 'Get Spending Summary',
      description:
        'Aggregate transactions over a startDate..endDate window grouped by category, payee, or month with splits inlined. Excludes internal transfers and off-budget accounts by default and returns Decimal Amounts.',
      inputSchema: {
        startDate: isoDateSchema.describe('Inclusive start date in YYYY-MM-DD format.'),
        endDate: isoDateSchema.describe('Inclusive end date in YYYY-MM-DD format.'),
        groupBy: z
          .enum(['category', 'payee', 'month'])
          .default('category')
          .describe("Dimension to group spending by: 'category', 'payee', or 'month'."),
        includeTransfers: z
          .boolean()
          .optional()
          .describe('Include internal account transfers (default: false).'),
        includeOffBudget: z
          .boolean()
          .optional()
          .describe('Include off-budget accounts (default: false).'),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ startDate, endDate, groupBy, includeTransfers, includeOffBudget, forceSync }) => {
      if (!budgetGateway.getSpendingSummary) {
        throw new Error('getSpendingSummary is not implemented on BudgetGateway');
      }

      const summary = await budgetGateway.getSpendingSummary({
        startDate,
        endDate,
        groupBy,
        ...(includeTransfers !== undefined ? { includeTransfers } : {}),
        ...(includeOffBudget !== undefined ? { includeOffBudget } : {}),
        ...(forceSync !== undefined ? { forceSync } : {}),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'run_aql_query',
    {
      title: 'Run Structured AQL Query',
      description:
        'Execute a safe, read-only Structured AQL Query over the Target Budget via @actual-app/api q(table) and aqlQuery(), automatically converting monetary fields to Decimal Amounts.',
      inputSchema: {
        table: z
          .enum(AQL_TABLES)
          .describe('Target ActualQL table to query.'),
        filter: structuredAqlQueryObjectSchema.shape.filter.describe(
          'Optional ActualQL filter expression object.',
        ),
        select: structuredAqlQueryObjectSchema.shape.select.describe(
          "Optional field list, '*', or aggregate alias expressions (e.g. ['category.name', { total: { $sum: '$amount' } }]).",
        ),
        groupBy: structuredAqlQueryObjectSchema.shape.groupBy.describe(
          'Optional field or array of fields/expressions to group by.',
        ),
        orderBy: structuredAqlQueryObjectSchema.shape.orderBy.describe(
          'Optional field or direction map to order results by.',
        ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe('Maximum number of rows to return (default 100, max 1000).'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Number of rows to skip for pagination.'),
        splits: z
          .enum(AQL_SPLITS_OPTIONS)
          .default('inline')
          .describe("Split transaction handling for transactions table (default 'inline')."),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.runAqlQuery) {
        throw new Error('runAqlQuery is not implemented on BudgetGateway');
      }

      const validated = structuredAqlQueryInputSchema.parse(args);
      const result = await budgetGateway.runAqlQuery(validated);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List Categories',
      description:
        'List all category groups and their categories (including id, name, group_id, is_income, and hidden flags).',
      inputSchema: {
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading categories.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ forceSync }) => {
      const categoryGroups =
        (await budgetGateway.listCategories?.(
          forceSync !== undefined ? { forceSync } : undefined,
        )) ?? [];
      const categories = categoryGroups.flatMap((group) => group.categories);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ categoryGroups, categories }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_payees',
    {
      title: 'List Payees',
      description:
        'List all payees in the Target Budget (including id, name, and transfer_acct indicator).',
      inputSchema: {
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading payees.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ forceSync }) => {
      const payees =
        (await budgetGateway.listPayees?.(
          forceSync !== undefined ? { forceSync } : undefined,
        )) ?? [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ payees }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_budget_months',
    {
      title: 'List Budget Months',
      description:
        'List the sorted YYYY-MM Budget Months available in the Target Budget.',
      inputSchema: {
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading budget months.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ forceSync }) => {
      const months =
        (await budgetGateway.listBudgetMonths?.(
          forceSync !== undefined ? { forceSync } : undefined,
        )) ?? [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ months }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_budget_month',
    {
      title: 'Get Budget Month',
      description:
        'Get the monthly envelope summary for a given YYYY-MM Budget Month (toBudget, totalIncome, totalBudgeted, totalSpent, totalBalance, and per-category budgeted, spent, balance, carryover in Decimal Amounts).',
      inputSchema: {
        month: budgetMonthSchema.describe(
          'Target Budget Month in YYYY-MM format (e.g. 2026-11).',
        ),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading the budget month.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ month, forceSync }) => {
      if (!budgetGateway.getBudgetMonth) {
        throw new Error('getBudgetMonth is not supported by the configured BudgetGateway');
      }
      const summary = await budgetGateway.getBudgetMonth(
        month,
        forceSync !== undefined ? { forceSync } : undefined,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  const manageTransactionItemSchema = z.object({
    date: isoDateSchema.describe('Transaction date in YYYY-MM-DD format.'),
    amount: z
      .number()
      .finite()
      .describe(
        'Transaction amount as a Decimal Amount (negative for Outflow/expense e.g. -12.34, positive for Inflow/income e.g. 100.00).',
      ),
    payee: z
      .string()
      .optional()
      .describe('Payee name or UUID to match or create.'),
    payeeName: z
      .string()
      .optional()
      .describe('Payee name to match or create when importing transactions.'),
    payeeId: z
      .string()
      .optional()
      .describe('Existing payee UUID to assign to the transaction.'),
    category: z
      .string()
      .optional()
      .describe('Category name or UUID to assign to the transaction.'),
    categoryId: z
      .string()
      .optional()
      .describe('Category UUID to assign to the transaction.'),
    notes: z.string().optional().describe('Optional transaction notes.'),
    cleared: z
      .boolean()
      .optional()
      .describe('Whether the transaction is cleared.'),
    importedId: z
      .string()
      .optional()
      .describe('Optional unique imported_id for deduplication.'),
  });

  server.registerTool(
    'manage_transactions',
    {
      title: 'Manage Transactions',
      description:
        'Consolidated Resource Facade for transaction lifecycle operations (action: "create" | "update" | "delete"). Supports batch creation (1-50 items with Decimal Amounts, in-process account/category/payee name resolution, and runRules default true), single or bulk updates across 1-50 transaction IDs with automatic creation of new payees, and single or bulk deletions.',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete'])
          .describe('Transaction lifecycle operation to perform.'),
        account: z
          .string()
          .min(1)
          .optional()
          .describe('Target account name or UUID (for action: "create").'),
        accountId: z
          .string()
          .min(1)
          .optional()
          .describe('Target account UUID or name (for action: "create").'),
        transactions: z
          .array(manageTransactionItemSchema)
          .min(1, 'At least 1 transaction is required')
          .max(50, 'At most 50 transactions can be created per call')
          .optional()
          .describe('Batch of 1 to 50 transactions to create (for action: "create").'),
        runRules: z
          .boolean()
          .optional()
          .describe(
            'When true (default for action: "create"), uses importTransactions to match/create payees and run Actual rules; when false, uses addTransactions.',
          ),
        id: z
          .string()
          .min(1)
          .optional()
          .describe('Single target transaction UUID (for action: "update" or "delete").'),
        ids: z
          .array(z.string().min(1))
          .min(1, 'At least 1 transaction ID is required')
          .max(50, 'At most 50 transaction IDs can be processed per call')
          .optional()
          .describe('Batch of 1 to 50 transaction UUIDs (for action: "update" or "delete").'),
        date: isoDateSchema
          .optional()
          .describe('New transaction date in YYYY-MM-DD format (for action: "update").'),
        amount: z
          .number()
          .finite()
          .optional()
          .describe(
            'New transaction amount as a Decimal Amount (negative for Outflow, positive for Inflow) (for action: "update").',
          ),
        payee: z
          .string()
          .nullable()
          .optional()
          .describe(
            'New payee name or UUID (auto-created if name does not exist), or null to clear (for action: "update").',
          ),
        payeeId: z
          .string()
          .nullable()
          .optional()
          .describe('New payee UUID or name, or null to clear (for action: "update").'),
        payeeName: z
          .string()
          .nullable()
          .optional()
          .describe('New payee name, or null to clear (for action: "update").'),
        category: z
          .string()
          .nullable()
          .optional()
          .describe('New category name or UUID, or null to clear (for action: "update").'),
        categoryId: z
          .string()
          .nullable()
          .optional()
          .describe('New category UUID or name, or null to clear (for action: "update").'),
        notes: z
          .string()
          .nullable()
          .optional()
          .describe('New transaction notes, or null to clear (for action: "update").'),
        cleared: z
          .boolean()
          .optional()
          .describe('New cleared status (for action: "update").'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.manageTransactions) {
        throw new Error(
          'manageTransactions is not supported by the configured BudgetGateway',
        );
      }

      let normalizedInput: ManageTransactionsInput;
      if (args.action === 'create') {
        if (!args.account && !args.accountId) {
          throw new Error('manage_transactions create requires account or accountId');
        }
        if (!args.transactions || args.transactions.length === 0) {
          throw new Error('manage_transactions create requires a non-empty transactions array');
        }
        normalizedInput = stripUndefined({
          action: 'create' as const,
          account: args.account,
          accountId: args.accountId,
          transactions: args.transactions.map((item) => stripUndefined(item)),
          runRules: args.runRules ?? true,
        });
      } else if (args.action === 'update') {
        if (!args.id && (!args.ids || args.ids.length === 0)) {
          throw new Error('manage_transactions update requires id or ids');
        }
        normalizedInput = stripUndefined({
          action: 'update' as const,
          id: args.id,
          ids: args.ids,
          date: args.date,
          amount: args.amount,
          payee: args.payee,
          payeeId: args.payeeId,
          payeeName: args.payeeName,
          category: args.category,
          categoryId: args.categoryId,
          notes: args.notes,
          cleared: args.cleared,
        });
      } else {
        if (!args.id && (!args.ids || args.ids.length === 0)) {
          throw new Error('manage_transactions delete requires id or ids');
        }
        normalizedInput = stripUndefined({
          action: 'delete' as const,
          id: args.id,
          ids: args.ids,
        });
      }

      try {
        const result = await budgetGateway.manageTransactions(normalizedInput);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error instanceof EntityResolutionError) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(createResourceFacadeErrorResponse(error), null, 2),
              },
            ],
          };
        }
        throw error;
      }
    },
  );

  server.registerTool(
    'set_budget_amount',
    {
      title: 'Set Budget Amount',
      description:
        'Update a category envelope in a given YYYY-MM Budget Month by setting budgeted (Decimal Amount) and/or carryover (boolean), and return { previous, updated } category states in Decimal Amounts.',
      inputSchema: {
        month: budgetMonthSchema.describe(
          'Target Budget Month in YYYY-MM format (e.g. 2026-11).',
        ),
        categoryId: z
          .string()
          .min(1)
          .describe('Target category UUID.'),
        budgeted: z
          .number()
          .finite()
          .optional()
          .describe(
            'New budgeted Decimal Amount for this category in the specified month.',
          ),
        carryover: z
          .boolean()
          .optional()
          .describe(
            'Whether to roll over overspending for this expense category starting in the specified month.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ month, categoryId, budgeted, carryover }) => {
      if (budgeted === undefined && carryover === undefined) {
        throw new Error(
          'set_budget_amount requires at least one of budgeted or carryover',
        );
      }
      if (!budgetGateway.setBudgetAmount) {
        throw new Error(
          'setBudgetAmount is not supported by the configured BudgetGateway',
        );
      }
      const result = await budgetGateway.setBudgetAmount({
        month,
        categoryId,
        ...(budgeted !== undefined ? { budgeted } : {}),
        ...(carryover !== undefined ? { carryover } : {}),
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'manage_categories',
    {
      title: 'Manage Categories',
      description:
        'Deep Resource Facade for category and category group lifecycle operations (create, update, delete, move). Accepts human-readable names or UUIDs, resolves identifiers in-process against the Budget Cache, automatically creates missing category groups when creating or moving a category, and enforces safe transaction reassignment on deletion.',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete', 'move'])
          .describe(
            "Lifecycle action to perform: 'create', 'update', 'delete', or 'move'.",
          ),
        target: z
          .enum(['category', 'group'])
          .default('category')
          .describe("Target entity type: 'category' (default) or 'group'."),
        id: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Target category or category group UUID or name (for update, delete, or move).',
          ),
        name: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Category or category group name (required for create; can also identify target for update, delete, or move).',
          ),
        newName: z
          .string()
          .min(1)
          .optional()
          .describe('New name when renaming a category or category group during update.'),
        group: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Parent category group name or UUID (auto-created in-process if not found during category create or move).',
          ),
        groupId: z
          .string()
          .min(1)
          .optional()
          .describe('Parent category group UUID or name (alias for group).'),
        isIncome: z
          .boolean()
          .optional()
          .describe('Whether the category or category group represents an income stream.'),
        hidden: z
          .boolean()
          .optional()
          .describe(
            'Whether the category or category group is hidden from active budget views.',
          ),
        transferTo: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Destination category name or UUID to reassign existing transactions to when deleting a non-empty category or group.',
          ),
        transferCategoryId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Destination category UUID or name for deletion reassignment (alias for transferTo).',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.manageCategories) {
        throw new Error(
          'manageCategories is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.manageCategories(normalizedInput);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'manage_payees',
    {
      title: 'Manage Payees',
      description:
        'Consolidated Resource Facade for payee lifecycle operations (create, update, delete, merge). Accepts human-readable payee names or internal UUIDs, resolves names in-process against the Budget Cache, and returns a standardized confirmation envelope.',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete', 'merge'])
          .describe(
            'Lifecycle action to perform on payees: "create", "update", "delete", or "merge".',
          ),
        id: z
          .string()
          .min(1)
          .optional()
          .describe('Target payee UUID or name (for update, delete, or merge target).'),
        name: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Payee name to create, target payee name to update/delete, or new name when id/payee is supplied.',
          ),
        payee: z
          .string()
          .min(1)
          .optional()
          .describe('Target payee name or UUID (alias for name/id).'),
        newName: z
          .string()
          .min(1)
          .optional()
          .describe('New name to assign when action is "update".'),
        target: z
          .string()
          .min(1)
          .optional()
          .describe('Target payee name or UUID to keep when action is "merge".'),
        targetId: z
          .string()
          .min(1)
          .optional()
          .describe('Target payee UUID or name to keep when action is "merge".'),
        targetPayeeId: z
          .string()
          .min(1)
          .optional()
          .describe('Alias for targetId when action is "merge".'),
        merge: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe(
            'Array of duplicate source payee names or UUIDs to merge into the target payee and delete when action is "merge".',
          ),
        mergeIds: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe(
            'Array of duplicate source payee UUIDs or names to merge into the target payee and delete when action is "merge".',
          ),
        sourcePayeeIds: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe('Alias for mergeIds when action is "merge".'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.managePayees) {
        throw new Error(
          'managePayees is not supported by the configured BudgetGateway',
        );
      }
      try {
        const normalizedInput = stripUndefined(args);
        const result = await budgetGateway.managePayees(normalizedInput);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error instanceof EntityResolutionError) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(error.toEnvelope(), null, 2),
              },
            ],
          };
        }
        throw error;
      }
    },
  );

  server.registerTool(
    'manage_accounts',
    {
      title: 'Manage Accounts',
      description:
        'Unified Resource Facade for account lifecycle management (create, update, close, reopen). Accepts human-readable names or UUIDs for accounts and transfer categories, and enforces safe balance transfer on closure.',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'close', 'reopen'])
          .describe(
            'Account lifecycle operation to perform: "create", "update", "close", or "reopen".',
          ),
        id: z
          .string()
          .min(1)
          .optional()
          .describe('Target account UUID or human-readable name (for update, close, reopen).'),
        name: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Account name (new account name for create, target account name or updated name for update, or target account name for close/reopen).',
          ),
        account: z
          .string()
          .min(1)
          .optional()
          .describe('Alias for target account name or UUID.'),
        newName: z
          .string()
          .min(1)
          .optional()
          .describe('New account name when renaming an existing account via action: "update".'),
        type: z
          .enum([
            'checking',
            'savings',
            'credit',
            'investment',
            'mortgage',
            'debt',
            'other',
          ])
          .optional()
          .describe('Type of financial account for action: "create" (default: "checking").'),
        offbudget: z
          .boolean()
          .optional()
          .describe('Whether the account is off-budget (for create or update).'),
        initialBalance: z
          .number()
          .finite()
          .optional()
          .describe('Optional initial balance as a Decimal Amount for action: "create".'),
        transferTo: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Destination account name or UUID to transfer remaining balance to on action: "close".',
          ),
        transferAccountId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Alias for transferTo: destination account UUID or name on action: "close".',
          ),
        transferCategory: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Destination category name or UUID for balance transfer across budget boundaries on action: "close".',
          ),
        transferCategoryId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Alias for transferCategory: destination category UUID or name on action: "close".',
          ),
        forced: z
          .boolean()
          .optional()
          .describe(
            'Force close an account with a non-zero balance without transferring on action: "close".',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      try {
        if (!budgetGateway.manageAccounts) {
          throw new Error(
            'manageAccounts is not supported by the configured BudgetGateway',
          );
        }
        const normalizedInput = stripUndefined(args);
        const result = await budgetGateway.manageAccounts(normalizedInput);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorEnvelope = createResourceFacadeErrorResponse(error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(errorEnvelope, null, 2),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    'run_bank_sync',
    {
      title: 'Run Bank Sync',
      description:
        'Trigger bank synchronization for a specific linked account or all linked accounts when accountId is omitted. Returns updated account IDs, new and matched transaction counts, and any sync errors.',
      inputSchema: {
        accountId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Optional account ID to synchronize. When omitted, synchronizes all linked accounts.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.runBankSync) {
        throw new Error(
          'runBankSync is not supported by the configured BudgetGateway',
        );
      }
      const result = await budgetGateway.runBankSync(args.accountId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'set_budget_carryover',
    {
      title: 'Set Budget Carryover',
      description:
        'Set the carryover flag for a category envelope in a specified budget month (YYYY-MM). When true, overspent category balance rolls over into next month.',
      inputSchema: {
        month: budgetMonthSchema.describe(
          'Target Budget Month in YYYY-MM format (e.g. 2026-11).',
        ),
        categoryId: z.string().min(1).describe('Target category UUID.'),
        carryover: z
          .boolean()
          .describe(
            'Whether to roll over overspending for this category envelope into the following month.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ month, categoryId, carryover }) => {
      if (!budgetGateway.setBudgetCarryover) {
        throw new Error(
          'setBudgetCarryover is not supported by the configured BudgetGateway',
        );
      }
      await budgetGateway.setBudgetCarryover(month, categoryId, carryover);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, month, categoryId, carryover },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'hold_budget_for_next_month',
    {
      title: 'Hold Budget For Next Month',
      description:
        'Hold a specified Decimal Amount from the current month available budget for next month.',
      inputSchema: {
        month: budgetMonthSchema.describe(
          'Target Budget Month in YYYY-MM format (e.g. 2026-11).',
        ),
        amount: z
          .number()
          .finite()
          .describe(
            'Decimal Amount to hold from current month available funds for next month.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ month, amount }) => {
      if (!budgetGateway.holdBudgetForNextMonth) {
        throw new Error(
          'holdBudgetForNextMonth is not supported by the configured BudgetGateway',
        );
      }
      const success = await budgetGateway.holdBudgetForNextMonth(month, amount);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success, month, amount }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'reset_budget_hold',
    {
      title: 'Reset Budget Hold',
      description:
        'Reset the budget hold for a given month, releasing held budget hold funds back to the current month available budget.',
      inputSchema: {
        month: budgetMonthSchema.describe(
          'Target Budget Month in YYYY-MM format (e.g. 2026-11).',
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ month }) => {
      if (!budgetGateway.resetBudgetHold) {
        throw new Error(
          'resetBudgetHold is not supported by the configured BudgetGateway',
        );
      }
      await budgetGateway.resetBudgetHold(month);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, month }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_schedules',
    {
      title: 'List Schedules',
      description:
        'List all recurring schedules in the Target Budget with their ID, name, rule ID, next date, completed flag, posts transaction flag, payee ID, account ID, amount (Decimal Amount), amount operator, and recurrence date config.',
      inputSchema: {
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading schedules.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ forceSync }) => {
      if (!budgetGateway.listSchedules) {
        throw new Error('listSchedules is not supported by the configured BudgetGateway');
      }
      const schedules = await budgetGateway.listSchedules(
        forceSync !== undefined ? { forceSync } : undefined,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ schedules }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_rules',
    {
      title: 'List Automation Rules',
      description:
        'List all automation/categorization rules in the Target Budget with conditions, actions, stage, and operator, with optional payee filtering.',
      inputSchema: {
        payeeId: z
          .string()
          .optional()
          .describe('Filter rules associated with a specific payee ID.'),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before reading rules.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ payeeId, forceSync }) => {
      if (!budgetGateway.listRules) {
        throw new Error('listRules is not supported by the configured BudgetGateway');
      }
      const rules = await budgetGateway.listRules({
        ...(payeeId ? { payeeId } : {}),
        ...(forceSync !== undefined ? { forceSync } : {}),
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ rules }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'manage_automations',
    {
      title: 'Manage Automations (Schedules & Rules)',
      description:
        'Consolidated Resource Facade for recurring schedules and automation rules, discriminated by target ("schedule" | "rule") and action ("create" | "update" | "delete" | "preview_dates"). Resolves human-readable account, payee, category, and schedule names to UUIDs in-process and uses Decimal Amounts.',
      inputSchema: {
        target: z
          .enum(['schedule', 'rule'])
          .describe('Target automation type: "schedule" or "rule".'),
        action: z
          .enum(['create', 'update', 'delete', 'preview_dates'])
          .describe(
            'Lifecycle action to perform: "create", "update", "delete", or "preview_dates" (schedule only).',
          ),
        id: z
          .string()
          .optional()
          .describe(
            'Schedule ID (or existing schedule name) or Rule ID for update, delete, or preview_dates.',
          ),
        scheduleId: z
          .string()
          .optional()
          .describe(
            'Schedule ID (or existing schedule name) for preview_dates, update, or delete.',
          ),
        name: z
          .string()
          .optional()
          .describe(
            'Display name for schedule create/update, or existing schedule name for delete/preview_dates.',
          ),
        account: z
          .string()
          .optional()
          .describe('Account name or UUID for schedule create/update.'),
        accountId: z
          .string()
          .optional()
          .describe('Alias for account (name or UUID) for schedule create/update.'),
        payee: z
          .string()
          .nullable()
          .optional()
          .describe('Payee name or UUID (or null to clear) for schedule create/update.'),
        payeeId: z
          .string()
          .nullable()
          .optional()
          .describe('Alias for payee (name or UUID, or null to clear) for schedule create/update.'),
        amount: scheduleAmountSchema
          .optional()
          .describe(
            'Schedule monetary amount as a Decimal Amount (negative for Outflow, positive for Inflow) or { num1, num2 } range.',
          ),
        amountOp: z
          .enum(['is', 'isapprox', 'isbetween'])
          .optional()
          .describe('Schedule amount match operator: "is", "isapprox", or "isbetween".'),
        date: scheduleDateSchema
          .optional()
          .describe(
            'Schedule recurrence config object (e.g. { frequency: "monthly", start: "2026-11-01" }) or exact YYYY-MM-DD date.',
          ),
        postsTransaction: z
          .boolean()
          .optional()
          .describe(
            'Whether Actual should automatically post transactions for this schedule (default: false).',
          ),
        posts_transaction: z
          .boolean()
          .optional()
          .describe('Alias for postsTransaction.'),
        resetNextDate: z
          .boolean()
          .optional()
          .describe(
            'When updating a schedule, recalculate next occurrence date based on current day and date pattern.',
          ),
        start: isoDateSchema
          .optional()
          .describe('Inclusive start date in YYYY-MM-DD format for preview_dates (defaults to today).'),
        end: isoDateSchema
          .optional()
          .describe('Inclusive end date in YYYY-MM-DD format for preview_dates.'),
        count: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            'Number of upcoming occurrences to calculate for preview_dates (default 10, max 100).',
          ),
        forceSync: z
          .boolean()
          .optional()
          .describe('Force a sync with the Sync Server before preview_dates.'),
        stage: z
          .enum(['pre', 'post', 'default'])
          .nullable()
          .optional()
          .describe(
            'Rule execution stage: "pre" (import/creation), "post", or "default" (or null for default).',
          ),
        conditionsOp: z
          .enum(['and', 'or'])
          .optional()
          .describe(
            'Rule condition combination operator: "and" (all must match) or "or" (any must match). Default: "and".',
          ),
        conditions: z
          .array(ruleConditionSchema)
          .min(1)
          .optional()
          .describe(
            'List of rule conditions (supports human-readable names for payee, account, and category fields, and Decimal Amounts for amount).',
          ),
        actions: z
          .array(ruleActionSchema)
          .min(1)
          .optional()
          .describe(
            'List of rule actions (supports human-readable names for payee, account, and category fields, and Decimal Amounts for monetary actions).',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.manageAutomations) {
        throw new Error(
          'manageAutomations is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.manageAutomations(normalizedInput);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
