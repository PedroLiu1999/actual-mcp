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

  const createTransactionItemSchema = z.object({
    date: isoDateSchema.describe('Transaction date in YYYY-MM-DD format.'),
    amount: z
      .number()
      .finite()
      .describe(
        'Transaction amount as a Decimal Amount (negative for Outflow/expense e.g. -12.34, positive for Inflow/income e.g. 100.00).',
      ),
    payeeName: z
      .string()
      .optional()
      .describe('Payee name to match or create when importing transactions.'),
    payeeId: z
      .string()
      .optional()
      .describe('Existing payee UUID to assign to the transaction.'),
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
    'create_transactions',
    {
      title: 'Create Transactions',
      description:
        'Create 1 to 50 transactions in an account using Decimal Amounts. Uses importTransactions by default (runRules: true) so payee matching and Actual categorization rules run automatically, or addTransactions when runRules is false.',
      inputSchema: {
        accountId: z.string().min(1).describe('Target account UUID.'),
        transactions: z
          .array(createTransactionItemSchema)
          .min(1, 'At least 1 transaction is required')
          .max(50, 'At most 50 transactions can be created per call')
          .describe('Batch of 1 to 50 transactions to create.'),
        runRules: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'When true (default), uses importTransactions to match/create payees and run Actual rules; when false, uses raw addTransactions.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ accountId, transactions, runRules }) => {
      if (!budgetGateway.createTransactions) {
        throw new Error(
          'createTransactions is not supported by the configured BudgetGateway',
        );
      }
      const normalizedTransactions = transactions.map((item) => stripUndefined(item));
      const result = await budgetGateway.createTransactions({
        accountId,
        transactions: normalizedTransactions,
        runRules: runRules ?? true,
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
    'update_transaction',
    {
      title: 'Update Transaction',
      description:
        'Update an existing transaction by ID (date, amount in Decimal Amount, payeeId, categoryId, notes, cleared) and return both { previous, updated } records in Decimal Amounts for verification or immediate reversal.',
      inputSchema: {
        id: z.string().min(1).describe('Target transaction UUID to update.'),
        date: isoDateSchema
          .optional()
          .describe('New transaction date in YYYY-MM-DD format.'),
        amount: z
          .number()
          .finite()
          .optional()
          .describe(
            'New transaction amount as a Decimal Amount (negative for Outflow, positive for Inflow).',
          ),
        payeeId: z
          .string()
          .nullable()
          .optional()
          .describe('New payee UUID (or null to clear).'),
        categoryId: z
          .string()
          .nullable()
          .optional()
          .describe('New category UUID (or null to clear).'),
        notes: z
          .string()
          .nullable()
          .optional()
          .describe('New transaction notes (or null to clear).'),
        cleared: z
          .boolean()
          .optional()
          .describe('New cleared status.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.updateTransaction) {
        throw new Error(
          'updateTransaction is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.updateTransaction(normalizedInput);
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
    'delete_transaction',
    {
      title: 'Delete Transaction',
      description:
        'Delete an existing transaction by ID and return { deleted } containing the full pre-deletion transaction record in Decimal Amounts so it can be recreated if needed.',
      inputSchema: {
        id: z.string().min(1).describe('Target transaction UUID to delete.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ id }) => {
      if (!budgetGateway.deleteTransaction) {
        throw new Error(
          'deleteTransaction is not supported by the configured BudgetGateway',
        );
      }
      const result = await budgetGateway.deleteTransaction(id);
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
    'create_category',
    {
      title: 'Create Category',
      description:
        'Create a new envelope category under an existing category group.',
      inputSchema: {
        name: z.string().min(1).describe('Name of the new category.'),
        groupId: z.string().min(1).describe('Parent category group ID.'),
        isIncome: z
          .boolean()
          .optional()
          .describe('Whether this category represents an income stream.'),
        hidden: z
          .boolean()
          .optional()
          .describe('Whether the category should be hidden from active budget views.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.createCategory) {
        throw new Error(
          'createCategory is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.createCategory(normalizedInput);
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
    'update_category',
    {
      title: 'Update Category',
      description:
        'Update an existing envelope category (rename, move to a different category group, or toggle income/hidden flags).',
      inputSchema: {
        id: z.string().min(1).describe('Target category ID to update.'),
        name: z.string().min(1).optional().describe('New name for the category.'),
        groupId: z
          .string()
          .min(1)
          .optional()
          .describe('New parent category group ID to move the category into.'),
        isIncome: z
          .boolean()
          .optional()
          .describe('Whether this category represents an income stream.'),
        hidden: z
          .boolean()
          .optional()
          .describe('Whether the category should be hidden from active budget views.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.updateCategory) {
        throw new Error(
          'updateCategory is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.updateCategory(normalizedInput);
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
    'delete_category',
    {
      title: 'Delete Category',
      description:
        'Delete an existing envelope category. If the category has historical transactions, transferCategoryId must be provided to reassign them without orphaned records.',
      inputSchema: {
        id: z.string().min(1).describe('Target category ID to delete.'),
        transferCategoryId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Destination category ID to safely reassign historical transactions to before deleting.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.deleteCategory) {
        throw new Error(
          'deleteCategory is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.deleteCategory(normalizedInput);
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
    'create_category_group',
    {
      title: 'Create Category Group',
      description:
        'Create a new category group to organize related expense or income envelopes.',
      inputSchema: {
        name: z.string().min(1).describe('Name of the new category group.'),
        isIncome: z
          .boolean()
          .optional()
          .describe('Whether this group holds income categories.'),
        hidden: z
          .boolean()
          .optional()
          .describe('Whether the category group should be hidden.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.createCategoryGroup) {
        throw new Error(
          'createCategoryGroup is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.createCategoryGroup(normalizedInput);
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
    'update_category_group',
    {
      title: 'Update Category Group',
      description:
        'Update an existing category group (rename or toggle income/hidden flags).',
      inputSchema: {
        id: z.string().min(1).describe('Target category group ID to update.'),
        name: z.string().min(1).optional().describe('New name for the category group.'),
        isIncome: z
          .boolean()
          .optional()
          .describe('Whether this group holds income categories.'),
        hidden: z
          .boolean()
          .optional()
          .describe('Whether the category group should be hidden.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.updateCategoryGroup) {
        throw new Error(
          'updateCategoryGroup is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.updateCategoryGroup(normalizedInput);
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
    'delete_category_group',
    {
      title: 'Delete Category Group',
      description:
        'Delete an existing category group. If any contained categories have transactions, transferCategoryId must be provided to reassign them without orphaned records.',
      inputSchema: {
        id: z.string().min(1).describe('Target category group ID to delete.'),
        transferCategoryId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Destination category ID to reassign transactions from member categories to before deleting the group.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.deleteCategoryGroup) {
        throw new Error(
          'deleteCategoryGroup is not supported by the configured BudgetGateway',
        );
      }
      const normalizedInput = stripUndefined(args);
      const result = await budgetGateway.deleteCategoryGroup(normalizedInput);
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
    'create_payee',
    {
      title: 'Create Payee',
      description: 'Create a new payee with a name string and return its generated ID.',
      inputSchema: {
        name: z.string().min(1).describe('Name of the new payee.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.createPayee) {
        throw new Error('createPayee is not supported by the configured BudgetGateway');
      }
      const result = await budgetGateway.createPayee({ name: args.name });
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
    'update_payee',
    {
      title: 'Update Payee',
      description: 'Update an existing payee name.',
      inputSchema: {
        id: z.string().min(1).describe('Target payee ID to update.'),
        name: z.string().min(1).describe('New name for the payee.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.updatePayee) {
        throw new Error('updatePayee is not supported by the configured BudgetGateway');
      }
      const result = await budgetGateway.updatePayee(args.id, { name: args.name });
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
    'delete_payee',
    {
      title: 'Delete Payee',
      description: 'Delete an existing payee.',
      inputSchema: {
        id: z.string().min(1).describe('Target payee ID to delete.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.deletePayee) {
        throw new Error('deletePayee is not supported by the configured BudgetGateway');
      }
      const result = await budgetGateway.deletePayee(args.id);
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
    'merge_payees',
    {
      title: 'Merge Payees',
      description:
        'Merge one or more duplicate source payees into a canonical target payee, consolidating all transactions and rules under the target payee and removing source records.',
      inputSchema: {
        targetPayeeId: z.string().min(1).describe('Canonical target payee ID to keep.'),
        sourcePayeeIds: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            'Non-empty array of source payee IDs to merge into target and delete.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.mergePayees) {
        throw new Error('mergePayees is not supported by the configured BudgetGateway');
      }
      const result = await budgetGateway.mergePayees(
        args.targetPayeeId,
        args.sourcePayeeIds,
      );
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
    'create_account',
    {
      title: 'Create Account',
      description:
        'Create a new on-budget or off-budget account with a specified type and optional initial balance as a Decimal Amount.',
      inputSchema: {
        name: z.string().min(1).describe('Name of the account.'),
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
          .describe('Type of financial account.'),
        offbudget: z
          .boolean()
          .optional()
          .describe('Whether the account is off-budget.'),
        initialBalance: z
          .number()
          .finite()
          .optional()
          .describe('Optional initial balance expressed as a Decimal Amount (e.g. 1500.50).'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.createAccount) {
        throw new Error(
          'createAccount is not supported by the configured BudgetGateway',
        );
      }
      const { name, type, offbudget, initialBalance } = args;
      const accountInput: { name: string; type: typeof type; offbudget?: boolean } = {
        name,
        type,
      };
      if (offbudget !== undefined) {
        accountInput.offbudget = offbudget;
      }
      const result = await budgetGateway.createAccount(
        accountInput,
        initialBalance,
      );
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
    'update_account',
    {
      title: 'Update Account',
      description:
        'Update an existing account name or toggle its off-budget status.',
      inputSchema: {
        id: z.string().min(1).describe('ID of the account to update.'),
        name: z.string().min(1).optional().describe('New name for the account.'),
        offbudget: z
          .boolean()
          .optional()
          .describe('Whether the account is off-budget.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.updateAccount) {
        throw new Error(
          'updateAccount is not supported by the configured BudgetGateway',
        );
      }
      const { id, name, offbudget } = args;
      const fields: { name?: string; offbudget?: boolean } = {};
      if (name !== undefined) fields.name = name;
      if (offbudget !== undefined) fields.offbudget = offbudget;
      const result = await budgetGateway.updateAccount(id, fields);
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
    'close_account',
    {
      title: 'Close Account',
      description:
        'Close an account in the Target Budget, optionally transferring remaining balance to another account and category.',
      inputSchema: {
        id: z.string().min(1).describe('ID of the account to close.'),
        transferAccountId: z
          .string()
          .min(1)
          .optional()
          .describe('Target account ID to transfer remaining balance to.'),
        transferCategoryId: z
          .string()
          .min(1)
          .optional()
          .describe('Category ID for balance transfer if transferring across budget boundary.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args) => {
      if (!budgetGateway.closeAccount) {
        throw new Error(
          'closeAccount is not supported by the configured BudgetGateway',
        );
      }
      const { id, transferAccountId, transferCategoryId } = args;
      const result = await budgetGateway.closeAccount(
        id,
        transferAccountId,
        transferCategoryId,
      );
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
    'reopen_account',
    {
      title: 'Reopen Account',
      description: 'Reopen a previously closed account.',
      inputSchema: {
        id: z.string().min(1).describe('ID of the account to reopen.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.reopenAccount) {
        throw new Error(
          'reopenAccount is not supported by the configured BudgetGateway',
        );
      }
      const { id } = args;
      const result = await budgetGateway.reopenAccount(id);
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
    'get_schedule_upcoming_dates',
    {
      title: 'Get Schedule Upcoming Dates',
      description:
        'Calculate upcoming occurrence dates for a schedule ID or date recurrence config over a given date range or occurrence count.',
      inputSchema: {
        scheduleId: z
          .string()
          .optional()
          .describe('Schedule ID to expand upcoming dates for.'),
        date: scheduleDateSchema
          .optional()
          .describe(
            'Explicit date string or recurrence config object to expand if scheduleId is not provided.',
          ),
        start: isoDateSchema
          .optional()
          .describe('Inclusive start date in YYYY-MM-DD format (defaults to today).'),
        end: isoDateSchema
          .optional()
          .describe('Inclusive end date in YYYY-MM-DD format.'),
        count: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            'Number of upcoming occurrences to calculate (default 10 if end is omitted).',
          ),
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
      if (!budgetGateway.getScheduleDates) {
        throw new Error('getScheduleDates is not supported by the configured BudgetGateway');
      }
      const filter = stripUndefined(args);
      const dates = await budgetGateway.getScheduleDates(filter);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ dates }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'create_schedule',
    {
      title: 'Create Schedule',
      description:
        'Create a new recurring schedule in the Target Budget with Decimal Amounts, recurrence configuration, and linked account/payee.',
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe('Display name for the recurring schedule (e.g. "Rent", "Netflix").'),
        account: z
          .string()
          .describe('Account ID the schedule is associated with.'),
        payee: z
          .string()
          .optional()
          .describe('Payee ID the schedule is associated with.'),
        amount: scheduleAmountSchema.describe(
          'Schedule monetary amount as a Decimal Amount (negative for expense/Outflow, positive for income/Inflow) or between range { num1, num2 }.',
        ),
        amountOp: z
          .enum(['is', 'isapprox', 'isbetween'])
          .optional()
          .describe('Amount match operator: "is", "isapprox", or "isbetween" (default: "is").'),
        date: scheduleDateSchema.describe(
          'Recurrence config object (e.g. { frequency: "monthly", start: "2026-11-01" }) or exact date string.',
        ),
        posts_transaction: z
          .boolean()
          .optional()
          .describe(
            'Whether Actual should automatically post transactions for this schedule (default: false).',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.createSchedule) {
        throw new Error('createSchedule is not supported by the configured BudgetGateway');
      }
      const result = await budgetGateway.createSchedule(args);
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
    'update_schedule',
    {
      title: 'Update Schedule',
      description:
        'Update fields on an existing recurring schedule (name, amount as Decimal Amount, amountOp, payee, account, date, posts_transaction, resetNextDate).',
      inputSchema: {
        id: z.string().describe('Schedule ID to update.'),
        name: z.string().optional().describe('New schedule name.'),
        account: z.string().optional().describe('New account ID.'),
        payee: z
          .string()
          .nullable()
          .optional()
          .describe('New payee ID (or null to clear).'),
        amount: scheduleAmountSchema
          .optional()
          .describe('New Decimal Amount or range.'),
        amountOp: z
          .enum(['is', 'isapprox', 'isbetween'])
          .optional()
          .describe('New amount operator.'),
        date: scheduleDateSchema
          .optional()
          .describe('New recurrence config or date.'),
        posts_transaction: z
          .boolean()
          .optional()
          .describe('Toggle automatic transaction posting.'),
        resetNextDate: z
          .boolean()
          .optional()
          .describe(
            'Recalculate next occurrence date based on current day and date pattern.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ id, resetNextDate, ...fields }) => {
      if (!budgetGateway.updateSchedule) {
        throw new Error('updateSchedule is not supported by the configured BudgetGateway');
      }
      const strippedFields = stripUndefined(fields);
      const result = await budgetGateway.updateSchedule(id, strippedFields, resetNextDate);
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
    'delete_schedule',
    {
      title: 'Delete Schedule',
      description:
        'Permanently delete a recurring schedule from the Target Budget.',
      inputSchema: {
        id: z.string().describe('Schedule ID to delete.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ id }) => {
      if (!budgetGateway.deleteSchedule) {
        throw new Error('deleteSchedule is not supported by the configured BudgetGateway');
      }
      const result = await budgetGateway.deleteSchedule(id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, id: result.id }, null, 2),
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
    'create_rule',
    {
      title: 'Create Automation Rule',
      description:
        'Create a new automation rule for categorization, payee renaming, or transaction field manipulation.',
      inputSchema: {
        stage: z
          .enum(['pre', 'post', 'default'])
          .optional()
          .describe(
            'Rule execution stage: "pre" (import/creation), "post", or "default" (default: "pre").',
          ),
        conditionsOp: z
          .enum(['and', 'or'])
          .optional()
          .describe(
            'Condition logical combination operator: "and" (all must match) or "or" (any must match). Default: "and".',
          ),
        conditions: z
          .array(ruleConditionSchema)
          .min(1)
          .describe('List of rule conditions.'),
        actions: z
          .array(ruleActionSchema)
          .min(1)
          .describe('List of rule actions to execute when conditions match.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.createRule) {
        throw new Error('createRule is not supported by the configured BudgetGateway');
      }
      const rule = await budgetGateway.createRule(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ rule }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'update_rule',
    {
      title: 'Update Automation Rule',
      description:
        'Update conditions, actions, stage, or conditionsOp for an existing automation rule by ID.',
      inputSchema: {
        id: z.string().describe('Rule ID to update.'),
        stage: z
          .enum(['pre', 'post', 'default'])
          .optional()
          .describe('Updated execution stage.'),
        conditionsOp: z
          .enum(['and', 'or'])
          .optional()
          .describe('Updated condition combination operator.'),
        conditions: z
          .array(ruleConditionSchema)
          .min(1)
          .describe('Complete list of updated rule conditions.'),
        actions: z
          .array(ruleActionSchema)
          .min(1)
          .describe('Complete list of updated rule actions.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      if (!budgetGateway.updateRule) {
        throw new Error('updateRule is not supported by the configured BudgetGateway');
      }
      const rule = await budgetGateway.updateRule(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ rule }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'delete_rule',
    {
      title: 'Delete Automation Rule',
      description:
        'Permanently delete an automation rule from the Target Budget.',
      inputSchema: {
        id: z.string().describe('Rule ID to delete.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ id }) => {
      if (!budgetGateway.deleteRule) {
        throw new Error('deleteRule is not supported by the configured BudgetGateway');
      }
      const result = await budgetGateway.deleteRule(id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, id: result.id }, null, 2),
          },
        ],
      };
    },
  );

  return server;
}
