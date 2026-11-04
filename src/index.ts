import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createActualBudgetGateway } from './gateway/actualBudgetGateway.js';

export function startServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const budgetGateway = createActualBudgetGateway({
    dataDir: path.join(config.DATA_DIR, 'budget-cache'),
    serverURL: config.ACTUAL_SERVER_URL,
    password: config.ACTUAL_PASSWORD,
    syncId: config.ACTUAL_SYNC_ID,
    encryptionPassword: config.ACTUAL_ENCRYPTION_PASSWORD,
    syncTtlSeconds: config.SYNC_TTL_SECONDS,
    signalTarget: process,
  });

  void budgetGateway.initialize().catch((error) => {
    console.error('Failed to initialize Target Budget:', error);
  });

  const app = createApp({ config, budgetGateway });

  const server = app.listen(config.PORT, () => {
    console.log(`actual-mcp listening on port ${config.PORT}`);
  });

  const handleShutdownSignal = () => {
    void budgetGateway.shutdown().finally(() => {
      server.close();
    });
  };

  process.once('SIGTERM', handleShutdownSignal);
  process.once('SIGINT', handleShutdownSignal);

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
