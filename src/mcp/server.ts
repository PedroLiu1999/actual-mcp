import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AQL_SPLITS_OPTIONS,
  AQL_TABLES,
  structuredAqlQueryInputSchema,
  structuredAqlQueryObjectSchema,
} from '../gateway/aql.js';
import type { BudgetGateway } from '../gateway/types.js';

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');

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

  return server;
}
