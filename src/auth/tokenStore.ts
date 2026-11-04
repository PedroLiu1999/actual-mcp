import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface StoredToken {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: string;
}

export type StoredAccessToken = StoredToken;
export type StoredRefreshToken = StoredToken;

interface TokenStoreData {
  accessTokens: StoredAccessToken[];
  refreshTokens: StoredRefreshToken[];
}

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

function hydrateTokens(
  items: unknown,
  target: Map<string, StoredToken>,
  nowSeconds: number,
): void {
  if (!Array.isArray(items)) {
    return;
  }

  for (const item of items) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.token === 'string' &&
      typeof item.clientId === 'string' &&
      typeof item.expiresAt === 'number' &&
      item.expiresAt > nowSeconds
    ) {
      target.set(item.token, {
        token: item.token,
        clientId: item.clientId,
        scopes: Array.isArray(item.scopes) ? item.scopes : ['mcp:tools'],
        expiresAt: item.expiresAt,
        resource: typeof item.resource === 'string' ? item.resource : undefined,
      });
    }
  }
}

function evictExpiredTokens(
  store: Map<string, StoredToken>,
  nowSeconds: number,
): void {
  for (const [key, val] of store.entries()) {
    if (val.expiresAt <= nowSeconds) {
      store.delete(key);
    }
  }
}

function getValidToken(
  store: Map<string, StoredToken>,
  token: string,
): StoredToken | undefined {
  const record = store.get(token);
  if (!record) {
    return undefined;
  }
  if (record.expiresAt <= Math.floor(Date.now() / 1000)) {
    store.delete(token);
    return undefined;
  }
  return record;
}

export class FileTokenStore {
  private readonly filePath: string;
  private readonly dataDir: string;
  private readonly accessTokens = new Map<string, StoredAccessToken>();
  private readonly refreshTokens = new Map<string, StoredRefreshToken>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'oauth-tokens.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TokenStoreData>;
      const nowSeconds = Math.floor(Date.now() / 1000);

      hydrateTokens(parsed.accessTokens, this.accessTokens, nowSeconds);
      hydrateTokens(parsed.refreshTokens, this.refreshTokens, nowSeconds);
    } catch {
      // Ignore corrupt or empty state file and start fresh
    }
  }

  private persistToDisk(): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    evictExpiredTokens(this.accessTokens, nowSeconds);
    evictExpiredTokens(this.refreshTokens, nowSeconds);

    fs.mkdirSync(this.dataDir, { recursive: true });
    const payload: TokenStoreData = {
      accessTokens: Array.from(this.accessTokens.values()),
      refreshTokens: Array.from(this.refreshTokens.values()),
    };

    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }

  saveTokens(access: StoredAccessToken, refresh?: StoredRefreshToken): void {
    this.accessTokens.set(access.token, access);
    if (refresh) {
      this.refreshTokens.set(refresh.token, refresh);
    }
    this.persistToDisk();
  }

  getAccessToken(token: string): StoredAccessToken | undefined {
    return getValidToken(this.accessTokens, token);
  }

  getRefreshToken(token: string): StoredRefreshToken | undefined {
    return getValidToken(this.refreshTokens, token);
  }

  revokeToken(clientId: string, token: string): void {
    let changed = false;
    const access = this.accessTokens.get(token);
    if (access && access.clientId === clientId) {
      this.accessTokens.delete(token);
      changed = true;
    }
    const refresh = this.refreshTokens.get(token);
    if (refresh && refresh.clientId === clientId) {
      this.refreshTokens.delete(token);
      changed = true;
    }
    if (changed) {
      this.persistToDisk();
    }
  }
}
