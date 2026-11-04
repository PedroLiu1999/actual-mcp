import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import type { AppConfig } from '../config.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  FileTokenStore,
  REFRESH_TOKEN_TTL_SECONDS,
} from './tokenStore.js';

const GOOGLE_REDIRECT_HOSTS = new Set([
  'oauth-redirect.googleusercontent.com',
  'oauth-redirect-sandbox.googleusercontent.com',
  'oauth-redirect-test.googleusercontent.com',
]);

const VERTEX_REDIRECT_URI = 'https://vertexaisearch.cloud.google.com/oauth-redirect';

export function isAllowedRedirectUri(
  redirectUri: string,
  extraRedirectUris: readonly string[] = [],
): boolean {
  if (redirectUri === VERTEX_REDIRECT_URI) {
    return true;
  }
  if (extraRedirectUris.includes(redirectUri)) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    return false;
  }

  if (!GOOGLE_REDIRECT_HOSTS.has(parsed.hostname)) {
    return false;
  }

  if (parsed.pathname.includes('..')) {
    return false;
  }

  if (parsed.pathname.startsWith('/r/') && parsed.pathname.length > 3) {
    return true;
  }

  if (parsed.pathname.startsWith('/a/') && parsed.pathname.length > 3) {
    return true;
  }

  return false;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderConsentHtml(options: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
  resource?: string;
  errorMessage?: string;
}): string {
  const scopesText = options.scopes && options.scopes.length > 0 ? options.scopes.join(' ') : 'mcp:tools';
  const errorBanner = options.errorMessage
    ? `<div role="alert" style="color: #b91c1c; background: #fee2e2; padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 1rem;">${escapeHtml(options.errorMessage)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize Actual Budget MCP</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 1.5rem;">
  <h1>Authorize Actual Budget MCP</h1>
  <p>Client <strong>${escapeHtml(options.clientId)}</strong> is requesting access to your Actual Budget (scope: <code>${escapeHtml(scopesText)}</code>).</p>
  ${errorBanner}
  <form method="POST" action="/authorize">
    <input type="hidden" name="response_type" value="code" />
    <input type="hidden" name="client_id" value="${escapeHtml(options.clientId)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(options.redirectUri)}" />
    <input type="hidden" name="code_challenge" value="${escapeHtml(options.codeChallenge)}" />
    <input type="hidden" name="code_challenge_method" value="S256" />
    ${options.state !== undefined ? `<input type="hidden" name="state" value="${escapeHtml(options.state)}" />` : ''}
    ${options.scopes && options.scopes.length > 0 ? `<input type="hidden" name="scope" value="${escapeHtml(options.scopes.join(' '))}" />` : ''}
    ${options.resource !== undefined ? `<input type="hidden" name="resource" value="${escapeHtml(options.resource)}" />` : ''}
    <div style="margin-bottom: 1rem;">
      <label for="password" style="display: block; margin-bottom: 0.5rem;">Admin Passphrase</label>
      <input id="password" type="password" name="password" required autofocus style="width: 100%; padding: 0.5rem;" />
    </div>
    <button type="submit" style="padding: 0.5rem 1rem;">Approve Access</button>
  </form>
</body>
</html>`;
}

export function verifySecretConstantTime(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const digestsMatch = timingSafeEqual(candidateDigest, expectedDigest);
  return digestsMatch && candidate.length === expected.length;
}

interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: URL;
  expiresAt: number;
}

export class EmbeddedOAuthProvider implements OAuthServerProvider {
  private readonly config: AppConfig;
  private readonly store: OAuthRegisteredClientsStore;
  private readonly tokenStore: FileTokenStore;
  private readonly allowedRedirectUris: Set<string>;
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();

  constructor(config: AppConfig) {
    this.config = config;
    this.tokenStore = new FileTokenStore(config.DATA_DIR);
    this.allowedRedirectUris = new Set<string>([
      VERTEX_REDIRECT_URI,
      ...config.OAUTH_EXTRA_REDIRECT_URIS,
    ]);

    this.store = {
      getClient: (clientId: string) => {
        if (clientId !== this.config.OAUTH_CLIENT_ID) {
          return undefined;
        }
        return {
          client_id: this.config.OAUTH_CLIENT_ID,
          client_secret: this.config.OAUTH_CLIENT_SECRET,
          redirect_uris: Array.from(this.allowedRedirectUris),
        };
      },
    };
  }

  recordCandidateRedirectUri(redirectUri: unknown): void {
    if (
      typeof redirectUri === 'string' &&
      isAllowedRedirectUri(redirectUri, this.config.OAUTH_EXTRA_REDIRECT_URIS)
    ) {
      this.allowedRedirectUris.add(redirectUri);
    }
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.store;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const req = res.req;
    if (req && req.method === 'POST') {
      const submittedPassword =
        typeof req.body?.password === 'string'
          ? req.body.password
          : typeof req.body?.passphrase === 'string'
            ? req.body.passphrase
            : undefined;

      if (
        submittedPassword === undefined ||
        !verifySecretConstantTime(submittedPassword, this.config.OAUTH_ADMIN_PASSWORD)
      ) {
        const errorHtml = renderConsentHtml({
          clientId: client.client_id,
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          state: params.state,
          scopes: params.scopes,
          resource: params.resource?.href,
          errorMessage: 'Invalid admin passphrase.',
        });
        res.status(401).type('html').send(errorHtml);
        return;
      }

      const code = randomBytes(32).toString('hex');
      const nowSeconds = Math.floor(Date.now() / 1000);
      this.authorizationCodes.set(code, {
        code,
        clientId: client.client_id,
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        scopes: params.scopes && params.scopes.length > 0 ? params.scopes : ['mcp:tools'],
        resource: params.resource,
        expiresAt: nowSeconds + 600,
      });

      const targetUrl = new URL(params.redirectUri);
      targetUrl.searchParams.set('code', code);
      if (params.state !== undefined) {
        targetUrl.searchParams.set('state', params.state);
      }
      res.redirect(302, targetUrl.href);
      return;
    }

    const html = renderConsentHtml({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes,
      resource: params.resource?.href,
    });
    res.status(200).type('html').send(html);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = this.authorizationCodes.get(authorizationCode);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!record || record.clientId !== client.client_id || record.expiresAt <= nowSeconds) {
      if (record && record.expiresAt <= nowSeconds) {
        this.authorizationCodes.delete(authorizationCode);
      }
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.authorizationCodes.get(authorizationCode);
    this.authorizationCodes.delete(authorizationCode);

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!record || record.clientId !== client.client_id || record.expiresAt <= nowSeconds) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }

    if (redirectUri !== undefined && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match authorization request');
    }

    const effectiveResource = (resource ?? record.resource)?.href ?? `${this.config.PUBLIC_URL}/mcp`;
    const accessToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');

    this.tokenStore.saveTokens(
      {
        token: accessToken,
        clientId: client.client_id,
        scopes: record.scopes,
        expiresAt: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
        resource: effectiveResource,
      },
      {
        token: refreshToken,
        clientId: client.client_id,
        scopes: record.scopes,
        expiresAt: nowSeconds + REFRESH_TOKEN_TTL_SECONDS,
        resource: effectiveResource,
      },
    );

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: record.scopes.join(' '),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const existingRefresh = this.tokenStore.getRefreshToken(refreshToken);
    if (!existingRefresh || existingRefresh.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const effectiveScopes =
      scopes && scopes.length > 0 ? scopes : existingRefresh.scopes;
    const effectiveResource =
      resource?.href ?? existingRefresh.resource ?? `${this.config.PUBLIC_URL}/mcp`;
    const newAccessToken = randomBytes(32).toString('hex');
    const extendedRefreshExpiresAt = Math.max(
      existingRefresh.expiresAt + 1,
      nowSeconds + REFRESH_TOKEN_TTL_SECONDS,
    );

    this.tokenStore.saveTokens(
      {
        token: newAccessToken,
        clientId: client.client_id,
        scopes: effectiveScopes,
        expiresAt: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
        resource: effectiveResource,
      },
      {
        token: existingRefresh.token,
        clientId: existingRefresh.clientId,
        scopes: effectiveScopes,
        expiresAt: extendedRefreshExpiresAt,
        resource: effectiveResource,
      },
    );

    return {
      access_token: newAccessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: existingRefresh.token,
      scope: effectiveScopes.join(' '),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.tokenStore.getAccessToken(token);
    if (!record) {
      throw new InvalidTokenError('Invalid or expired access token');
    }
    return {
      token: record.token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: record.resource ? new URL(record.resource) : undefined,
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.tokenStore.revokeToken(client.client_id, request.token);
  }
}
