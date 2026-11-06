import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  InvalidClientMetadataError,
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
  MAX_REGISTERED_CLIENTS,
  REFRESH_TOKEN_TTL_SECONDS,
} from './tokenStore.js';

export const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = [
  'none',
  'client_secret_post',
  'client_secret_basic',
] as const;

export type SupportedTokenEndpointAuthMethod = (typeof SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS)[number];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

export function isAllowedRedirectUri(
  redirectUri: string,
  allowedRedirectUris: readonly string[] = [],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (parsed.pathname.includes('..') || parsed.username !== '' || parsed.password !== '') {
    return false;
  }

  const isLoopbackCandidate = LOOPBACK_HOSTS.has(parsed.hostname);

  // Non-loopback URIs MUST use https://
  if (!isLoopbackCandidate && parsed.protocol !== 'https:') {
    return false;
  }

  for (const allowed of allowedRedirectUris) {
    if (allowed === redirectUri) {
      return true;
    }
    try {
      const parsedAllowed = new URL(allowed);
      if (isLoopbackCandidate && LOOPBACK_HOSTS.has(parsedAllowed.hostname)) {
        if (parsedAllowed.protocol !== parsed.protocol) {
          continue;
        }
        // If an explicit path is configured on loopback, candidate pathname must match
        if (parsedAllowed.pathname !== '/' && parsedAllowed.pathname !== '') {
          if (parsed.pathname !== parsedAllowed.pathname) {
            continue;
          }
        }
        return true;
      }

      // Non-loopback prefix matching if allowed URI ends with '/' (e.g. https://oauth-redirect.googleusercontent.com/r/)
      if (
        !isLoopbackCandidate &&
        parsedAllowed.protocol === parsed.protocol &&
        parsedAllowed.hostname === parsed.hostname &&
        allowed.endsWith('/')
      ) {
        const allowedBasePath = parsedAllowed.pathname.endsWith('/')
          ? parsedAllowed.pathname
          : `${parsedAllowed.pathname}/`;
        if (parsed.pathname.startsWith(allowedBasePath)) {
          return true;
        }
      }
    } catch {
      // Ignore invalid configured allowed URI
    }
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
    ? `<div role="alert" style="color: #b91c1c; background: #fee2e2; padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1.25rem; font-size: 0.875rem;">${escapeHtml(options.errorMessage)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <title>Authorize Actual Budget MCP</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; color: #0F172A; min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 1.5rem; box-sizing: border-box;">
  <div style="background: #FFFFFF; max-width: 28rem; width: 100%; padding: 2.25rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04); border: 1px solid #E2E8F0;">
    <div style="text-align: center; margin-bottom: 1.75rem;">
      <img src="/logo.png" alt="actual-mcp" width="68" height="68" style="border-radius: 16px; box-shadow: 0 4px 12px rgba(107, 70, 193, 0.25);" />
      <h1 style="font-size: 1.35rem; font-weight: 700; margin: 1rem 0 0.25rem 0; color: #0F172A;">Authorize Actual Budget MCP</h1>
      <p style="font-size: 0.8125rem; color: #64748B; margin: 0; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Model Context Protocol</p>
    </div>
    <p style="font-size: 0.9375rem; line-height: 1.5; color: #334155; margin-bottom: 1.25rem;">
      Client <strong style="color: #0F172A;">${escapeHtml(options.clientId)}</strong> is requesting access to your Actual Budget (scope: <code style="background: #F1F5F9; color: #6B46C1; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.85em;">${escapeHtml(scopesText)}</code>).
    </p>
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
      <div style="margin-bottom: 1.25rem;">
        <label for="password" style="display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; color: #1E293B;">Admin Passphrase</label>
        <input id="password" type="password" name="password" required autofocus style="width: 100%; padding: 0.625rem 0.75rem; border: 1px solid #CBD5E1; border-radius: 0.5rem; font-size: 1rem; box-sizing: border-box; outline: none;" />
      </div>
      <button type="submit" style="width: 100%; background: #6B46C1; color: #FFFFFF; border: none; padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.9375rem; font-weight: 600; cursor: pointer; box-shadow: 0 2px 4px rgba(107, 70, 193, 0.25);">Approve Access</button>
    </form>
  </div>
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
    this.allowedRedirectUris = new Set<string>(config.OAUTH_ALLOWED_REDIRECT_URIS);

    this.store = {
      getClient: (clientId: string) => {
        if (!clientId || clientId.trim() === '') {
          return undefined;
        }
        const registered = this.tokenStore.getClient(clientId);
        if (registered) {
          return registered;
        }
        return {
          client_id: clientId,
          redirect_uris: Array.from(this.allowedRedirectUris),
        };
      },
      registerClient: async (
        client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> & {
          client_id?: string;
          client_id_issued_at?: number;
        },
      ) => {
        if (this.tokenStore.getClientCount() >= MAX_REGISTERED_CLIENTS) {
          throw new InvalidClientMetadataError('Client registration limit reached');
        }

        const supportedAuthMethods = new Set<string>(SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS);
        if (
          client.token_endpoint_auth_method !== undefined &&
          !supportedAuthMethods.has(client.token_endpoint_auth_method)
        ) {
          throw new InvalidClientMetadataError(
            `Unsupported token_endpoint_auth_method: ${client.token_endpoint_auth_method}. Supported: ${SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}`,
          );
        }

        const isPublicClient = client.token_endpoint_auth_method === 'none';
        const clientSecret = isPublicClient
          ? undefined
          : (client.client_secret ?? randomBytes(32).toString('hex'));
        const clientSecretExpiresAt = isPublicClient ? undefined : client.client_secret_expires_at;
        const authMethod = isPublicClient
          ? 'none'
          : (client.token_endpoint_auth_method ?? 'client_secret_basic');

        const redirectUris = client.redirect_uris ?? [];
        if (redirectUris.length === 0) {
          throw new InvalidClientMetadataError(
            'Client registration must include at least one redirect_uri',
          );
        }

        for (const uri of redirectUris) {
          if (!isAllowedRedirectUri(uri, this.config.OAUTH_ALLOWED_REDIRECT_URIS)) {
            throw new InvalidClientMetadataError(
              `Redirect URI not allowed by server allowlist policy: ${uri}`,
            );
          }
        }

        const clientId = client.client_id ?? randomUUID();
        if (this.tokenStore.getClient(clientId)) {
          throw new InvalidClientMetadataError(
            'Cannot overwrite existing client registration',
          );
        }

        const registered: OAuthClientInformationFull = {
          ...client,
          client_id: clientId,
          client_id_issued_at:
            client.client_id_issued_at ?? Math.floor(Date.now() / 1000),
          client_secret: clientSecret,
          client_secret_expires_at: clientSecretExpiresAt,
          token_endpoint_auth_method: authMethod,
          redirect_uris: redirectUris,
        };

        this.tokenStore.saveClient(registered);
        return registered;
      },
    };
  }

  recordCandidateRedirectUri(redirectUri: unknown): void {
    if (
      typeof redirectUri === 'string' &&
      isAllowedRedirectUri(redirectUri, this.config.OAUTH_ALLOWED_REDIRECT_URIS)
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
