import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createActualBudgetGateway } from './gateway/actualBudgetGateway.js';

export function startServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const budgetGateway = createActualBudgetGateway({
    syncId: config.ACTUAL_SYNC_ID,
  });
  const app = createApp({ config, budgetGateway });

  return app.listen(config.PORT, () => {
    console.log(`actual-mcp listening on port ${config.PORT}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
