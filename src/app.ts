import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Express } from 'express';
import type { AppConfig } from './config.js';
import type { BudgetGateway } from './gateway/types.js';
import { createMcpServer } from './mcp/server.js';

export interface CreateAppOptions {
  config: AppConfig;
  budgetGateway: BudgetGateway;
}

export function createApp({ config, budgetGateway }: CreateAppOptions): Express {
  const app = express();
  app.set('trust proxy', 1);

  const publicHostname = new URL(config.PUBLIC_URL).hostname;
  const allowedHosts = Array.from(
    new Set([publicHostname, 'localhost', '127.0.0.1', '[::1]']),
  );

  app.use(hostHeaderValidation(allowedHosts));
  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    const readiness = budgetGateway.getReadiness();
    res.status(200).json({
      status: 'ok',
      targetBudget: readiness,
    });
  });

  app.post('/mcp', async (req, res) => {
    const server = createMcpServer(budgetGateway);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  return app;
}
