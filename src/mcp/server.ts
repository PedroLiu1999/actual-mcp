import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BudgetGateway } from '../gateway/types.js';

export function createMcpServer(budgetGateway: BudgetGateway): McpServer {
  const server = new McpServer(
    {
      name: 'actual-mcp',
      version: '0.1.0',
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
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
          .optional()
          .describe('Inclusive start date in YYYY-MM-DD format.'),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
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
      const filter = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined),
      );
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
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/, 'Expected month in YYYY-MM format')
          .describe('Target Budget Month in YYYY-MM format (e.g. 2026-11).'),
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
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
      .describe('Transaction date in YYYY-MM-DD format.'),
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
      const normalizedTransactions = transactions.map((item) =>
        Object.fromEntries(
          Object.entries(item).filter(([, value]) => value !== undefined),
        ),
      ) as typeof transactions;
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
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
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
      const normalizedInput = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined),
      ) as { id: string } & Record<string, unknown>;
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

  server.registerTool(
    'set_budget_amount',
    {
      title: 'Set Budget Amount',
      description:
        'Update a category envelope in a given YYYY-MM Budget Month by setting budgeted (Decimal Amount) and/or carryover (boolean), and return { previous, updated } category states in Decimal Amounts.',
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/, 'Expected month in YYYY-MM format')
          .describe('Target Budget Month in YYYY-MM format (e.g. 2026-11).'),
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

  return server;
}
