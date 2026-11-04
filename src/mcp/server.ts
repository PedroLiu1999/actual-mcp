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

  return server;
}
