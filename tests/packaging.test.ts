import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

describe('Packaging & deployment artifacts', () => {
  it('provides a valid .env.example that passes loadConfig and documents all required and optional variables', () => {
    const envExamplePath = path.join(repoRoot, '.env.example');
    expect(fs.existsSync(envExamplePath)).toBe(true);

    const raw = fs.readFileSync(envExamplePath, 'utf8');
    const parsed = parseDotEnv(raw);

    const config = loadConfig(parsed);
    expect(config.PUBLIC_URL).toMatch(/^https:\/\//);
    expect(config.PORT).toBe(3000);
    expect(config.DATA_DIR).toBe('/data');
    expect(config.ACTUAL_SERVER_URL).toContain('host.docker.internal');
    expect(config.SYNC_TTL_SECONDS).toBe(30);

    // Ensure optional variables are also documented in .env.example
    expect(raw).toContain('ACTUAL_ENCRYPTION_PASSWORD');
    expect(raw).toContain('OAUTH_EXTRA_REDIRECT_URIS');
    expect(raw).toContain('SYNC_TTL_SECONDS');
  });

  it('defines a multi-stage Dockerfile with node:22-bookworm-slim, tini PID 1, /data volume, and /healthz HEALTHCHECK, plus .dockerignore', () => {
    const dockerfilePath = path.join(repoRoot, 'Dockerfile');
    const dockerignorePath = path.join(repoRoot, '.dockerignore');

    expect(fs.existsSync(dockerfilePath)).toBe(true);
    expect(fs.existsSync(dockerignorePath)).toBe(true);

    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    const fromStages = dockerfile.match(/^FROM\s+node:22-bookworm-slim/gm) ?? [];
    expect(fromStages.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toContain('tini');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--"]');
    expect(dockerfile).toContain('npm run build');
    expect(dockerfile).toContain('/data');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('http://127.0.0.1:3000/healthz');
    expect(dockerfile).toContain('dist/index.js');

    const dockerignore = fs.readFileSync(dockerignorePath, 'utf8');
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('dist');
    expect(dockerignore).toContain('.env');
    expect(dockerignore).toContain('data');
  });

  it('defines a standalone docker-compose.yml with actual-mcp service, loopback port binding, host.docker.internal mapping, ./data:/data volume, .env, and unless-stopped restart policy', () => {
    const composePath = path.join(repoRoot, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);

    const compose = fs.readFileSync(composePath, 'utf8');
    expect(compose).toContain('actual-mcp:');
    expect(compose).toContain('127.0.0.1:${PORT:-3000}:3000');
    expect(compose).toContain('host.docker.internal:host-gateway');
    expect(compose).toContain('./data:/data');
    expect(compose).toContain('.env');
    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('http://127.0.0.1:3000/healthz');
  });

  it('documents architecture, all 30 MCP tools, all environment variables, VPS deployment (actual-server + cloudflared), and Google Gemini connection steps in README.md', () => {
    const readmePath = path.join(repoRoot, 'README.md');
    const readme = fs.readFileSync(readmePath, 'utf8');

    const expectedTools = [
      'list_accounts',
      'get_transactions',
      'get_spending_summary',
      'run_aql_query',
      'list_categories',
      'list_payees',
      'list_budget_months',
      'get_budget_month',
      'create_transactions',
      'update_transaction',
      'delete_transaction',
      'set_budget_amount',
      'create_category',
      'update_category',
      'delete_category',
      'create_category_group',
      'update_category_group',
      'delete_category_group',
      'create_payee',
      'update_payee',
      'delete_payee',
      'merge_payees',
      'create_account',
      'update_account',
      'close_account',
      'reopen_account',
      'run_bank_sync',
      'set_budget_carryover',
      'hold_budget_for_next_month',
      'reset_budget_hold',
    ];
    for (const tool of expectedTools) {
      expect(readme).toContain(tool);
    }
    expect(readme).toContain('all 30 MCP tools');

    const expectedEnvVars = [
      'PUBLIC_URL',
      'PORT',
      'DATA_DIR',
      'OAUTH_CLIENT_ID',
      'OAUTH_CLIENT_SECRET',
      'OAUTH_ADMIN_PASSWORD',
      'OAUTH_EXTRA_REDIRECT_URIS',
      'ACTUAL_SERVER_URL',
      'ACTUAL_PASSWORD',
      'ACTUAL_SYNC_ID',
      'ACTUAL_ENCRYPTION_PASSWORD',
      'SYNC_TTL_SECONDS',
    ];
    for (const envVar of expectedEnvVars) {
      expect(readme).toContain(envVar);
    }

    expect(readme).toContain('cloudflared');
    expect(readme).toContain('actual-server');
    expect(readme).toContain('Connect to an MCP server');
    expect(readme).toContain('Client ID');
    expect(readme).toContain('Client Secret');
  });

  it('aligns version across package.json and src/mcp/server.ts to 0.2.1', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('0.2.1');

    const serverCode = fs.readFileSync(path.join(repoRoot, 'src/mcp/server.ts'), 'utf8');
    expect(serverCode).toContain("version: '0.2.1'");
  });

  it('defines a GitHub Actions CI pipeline (.github/workflows/ci.yml) with typecheck, test, and build across supported Node versions', () => {
    const ciPath = path.join(repoRoot, '.github/workflows/ci.yml');
    expect(fs.existsSync(ciPath)).toBe(true);

    const ciContent = fs.readFileSync(ciPath, 'utf8');
    expect(ciContent).toContain('push:');
    expect(ciContent).toContain('pull_request:');
    expect(ciContent).toContain('main');
    expect(ciContent).toContain('npm ci');
    expect(ciContent).toContain('npm run typecheck');
    expect(ciContent).toContain('npm test');
    expect(ciContent).toContain('npm run build');
    expect(ciContent).toContain('node-version: [22.x, 24.x]');
    expect(ciContent).toContain('dist/index.js');
  });
});
