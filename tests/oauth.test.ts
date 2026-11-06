import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { BudgetGateway } from '../src/gateway/types.js';

function createStubGateway(): BudgetGateway {
  return {
    getReadiness: () => ({
      ready: true,
      syncId: '11111111-2222-3333-4444-555555555555',
      lastSyncedAt: '2026-11-04T17:00:00.000Z',
    }),
    listAccounts: async () => [
      {
        id: 'acc-1',
        name: 'Checking',
        offbudget: false,
        closed: false,
        balance: 500.25,
      },
    ],
  };
}

describe('Embedded OAuth 2.1 Server & Protected Resource at HTTP seam', () => {
  let tempDataDir: string;
  let config: AppConfig;

  beforeEach(() => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-mcp-oauth-test-'));
    config = loadConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: '3000',
      DATA_DIR: tempDataDir,
      OAUTH_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      OAUTH_ALLOWED_REDIRECT_URIS:
        'http://localhost,http://127.0.0.1,https://oauth-redirect.googleusercontent.com/r/,https://oauth-redirect.googleusercontent.com/a/,https://oauth-redirect-sandbox.googleusercontent.com/r/,https://oauth-redirect-sandbox.googleusercontent.com/a/,https://oauth-redirect-test.googleusercontent.com/r/,https://oauth-redirect-test.googleusercontent.com/a/,https://vertexaisearch.cloud.google.com/oauth-redirect',
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'actual-password',
      ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
    });
  });

  afterEach(() => {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  });

  it('returns 401 Unauthorized with WWW-Authenticate resource_metadata header on unauthenticated POST /mcp', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });

    const res = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'gemini', version: '1.0.0' },
        },
      });

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBeDefined();
    expect(res.headers['www-authenticate']).toContain('Bearer');
    expect(res.headers['www-authenticate']).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('serves RFC 9728 Protected Resource Metadata on both /.well-known/oauth-protected-resource/mcp and root /.well-known/oauth-protected-resource', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });

    const pathRes = await request(app)
      .get('/.well-known/oauth-protected-resource/mcp')
      .set('Host', 'mcp.example.com');

    expect(pathRes.status).toBe(200);
    expect(pathRes.body).toMatchObject({
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://mcp.example.com'],
      logo_uri: 'https://mcp.example.com/logo.png',
    });

    const rootRes = await request(app)
      .get('/.well-known/oauth-protected-resource')
      .set('Host', 'mcp.example.com');

    expect(rootRes.status).toBe(200);
    expect(rootRes.body).toEqual(pathRes.body);
  });

  it('serves RFC 8414 Authorization Server Metadata at /.well-known/oauth-authorization-server advertising /authorize, /token, /revoke, S256, and auth method none', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });

    const res = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('Host', 'mcp.example.com');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      issuer: 'https://mcp.example.com',
      logo_uri: 'https://mcp.example.com/logo.png',
      authorization_endpoint: 'https://mcp.example.com/authorize',
      token_endpoint: 'https://mcp.example.com/token',
      revocation_endpoint: 'https://mcp.example.com/revoke',
      registration_endpoint: 'https://mcp.example.com/register',
      response_types_supported: ['code'],
      grant_types_supported: expect.arrayContaining(['authorization_code', 'refresh_token']),
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: expect.arrayContaining(['none', 'client_secret_post', 'client_secret_basic']),
      revocation_endpoint_auth_methods_supported: expect.arrayContaining(['none', 'client_secret_post', 'client_secret_basic']),
    });
  });

  it('supports custom LOGO_URL override for external hosting providers (e.g. googleusercontent)', async () => {
    const customConfig = loadConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      LOGO_URL: 'https://lh3.googleusercontent.com/d/abc-123',
      PORT: '3000',
      DATA_DIR: tempDataDir,
      OAUTH_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      OAUTH_ALLOWED_REDIRECT_URIS:
        'http://localhost,http://127.0.0.1,https://oauth-redirect.googleusercontent.com/r/,https://oauth-redirect.googleusercontent.com/a/,https://oauth-redirect-sandbox.googleusercontent.com/r/,https://oauth-redirect-sandbox.googleusercontent.com/a/,https://oauth-redirect-test.googleusercontent.com/r/,https://oauth-redirect-test.googleusercontent.com/a/,https://vertexaisearch.cloud.google.com/oauth-redirect',
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'actual-password',
      ACTUAL_SYNC_ID: 'sync-id',
    });
    const app = createApp({ config: customConfig, budgetGateway: createStubGateway() });

    const res = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('Host', 'mcp.example.com');

    expect(res.status).toBe(200);
    expect(res.body.logo_uri).toBe('https://lh3.googleusercontent.com/d/abc-123');
  });

  it('accepts dynamic client_id and allows loopback ports plus OAUTH_ALLOWED_REDIRECT_URIS on GET /authorize while rejecting unlisted redirect URIs', async () => {
    const customConfig = loadConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: '3000',
      DATA_DIR: tempDataDir,
      OAUTH_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      OAUTH_ALLOWED_REDIRECT_URIS:
        'http://localhost,http://127.0.0.1,https://custom-client.example.org/oauth/callback',
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'actual-password',
      ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
    });
    const app = createApp({ config: customConfig, budgetGateway: createStubGateway() });

    const allowedRedirectUris = [
      'http://localhost:54321/callback',
      'http://localhost:8080/oauth2callback',
      'http://127.0.0.1:49152/callback',
      'http://127.0.0.1:3000/',
      'https://custom-client.example.org/oauth/callback',
    ];

    for (const redirectUri of allowedRedirectUris) {
      const res = await request(app)
        .get('/authorize')
        .set('Host', 'mcp.example.com')
        .query({
          response_type: 'code',
          client_id: 'any-dynamic-client-id',
          redirect_uri: redirectUri,
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          state: 'state-123',
          scope: 'mcp:tools',
        });

      expect(res.status, `Expected 200 for allowed redirect_uri ${redirectUri}`).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.text).toContain('any-dynamic-client-id');
      expect(res.text).toContain('/logo.png');
      expect(res.text).toMatch(/type="password"/);
    }

    const rejectedRedirectUris = [
      'https://evil.example.com/callback',
      'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123',
      'http://attacker.com/callback',
      'https://custom-client.example.org/other/path',
    ];

    for (const badUri of rejectedRedirectUris) {
      const res = await request(app)
        .get('/authorize')
        .set('Host', 'mcp.example.com')
        .query({
          response_type: 'code',
          client_id: 'any-client',
          redirect_uri: badUri,
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          state: 'state-123',
        });

      expect(res.status, `Expected 400 for unlisted redirect_uri ${badUri}`).toBe(400);
    }

    const emptyClientRes = await request(app)
      .get('/authorize')
      .set('Host', 'mcp.example.com')
      .query({
        response_type: 'code',
        client_id: '',
        redirect_uri: 'http://localhost:54321/callback',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
      });

    expect(emptyClientRes.status).toBe(400);
  });

  it('enforces strict redirect URI rules in isAllowedRedirectUri (HTTPS for remote, RFC 8252 loopback path & host)', async () => {
    const { isAllowedRedirectUri } = await import('../src/auth/provider.js');

    // Remote URI must be HTTPS
    expect(isAllowedRedirectUri('http://remote.example.com/callback', ['http://remote.example.com/callback'])).toBe(false);
    expect(isAllowedRedirectUri('https://remote.example.com/callback', ['https://remote.example.com/callback'])).toBe(true);

    // IPv6 [::1] not allowed as loopback
    expect(isAllowedRedirectUri('http://[::1]:54321/callback', ['http://localhost'])).toBe(false);

    // Loopback path check when specific path is configured
    expect(isAllowedRedirectUri('http://localhost:8080/auth/callback', ['http://localhost/auth/callback'])).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:8080/wrong/path', ['http://localhost/auth/callback'])).toBe(false);

    // Cross-loopback (localhost <-> 127.0.0.1)
    expect(isAllowedRedirectUri('http://127.0.0.1:8080/auth/callback', ['http://localhost/auth/callback'])).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:8080/auth/callback', ['http://127.0.0.1/auth/callback'])).toBe(true);

    // Root loopback allows any path on loopback
    expect(isAllowedRedirectUri('http://localhost:54321/any/path', ['http://localhost'])).toBe(true);
  });

  it('verifies OAUTH_ADMIN_PASSWORD on POST /authorize, rejecting wrong passphrases with 401 and redirecting with code and state when valid', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });
    const redirectUri = 'http://localhost:54321/callback';

    const wrongPassRes = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'gemini-client',
        redirect_uri: redirectUri,
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        state: 'state-xyz',
        scope: 'mcp:tools',
        password: 'wrong-password',
      });

    expect(wrongPassRes.status).toBe(401);
    expect(wrongPassRes.headers.location).toBeUndefined();

    const validPassRes = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'gemini-client',
        redirect_uri: redirectUri,
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        state: 'state-xyz',
        scope: 'mcp:tools',
        password: 'correct-horse-battery-staple',
      });

    expect(validPassRes.status).toBe(302);
    const location = new URL(validPassRes.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri);
    expect(location.searchParams.get('code')).toEqual(expect.any(String));
    expect(location.searchParams.get('state')).toBe('state-xyz');
  });

  it('enforces IP rate-limiting on POST /authorize against brute-force passphrase attempts', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });
    const redirectUri = 'http://localhost:54321/callback';

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post('/authorize')
        .set('Host', 'mcp.example.com')
        .set('X-Forwarded-For', '203.0.113.42')
        .type('form')
        .send({
          response_type: 'code',
          client_id: 'gemini-client',
          redirect_uri: redirectUri,
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          state: 'state-rate-limit',
          password: `wrong-attempt-${i}`,
        });
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });

  it('exchanges a single-use authorization code with S256 PKCE verification for an access_token (expires_in: 3600) and refresh_token, and authorizes POST /mcp', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });
    const redirectUri = 'http://localhost:54321/callback';
    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-extra-entropy-12345';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const authRes = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'gemini-client',
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'pkce-state',
        scope: 'mcp:tools',
        password: 'correct-horse-battery-staple',
      });

    expect(authRes.status).toBe(302);
    const code = new URL(authRes.headers.location).searchParams.get('code')!;
    expect(code).toBeTruthy();

    // Wrong PKCE code_verifier is rejected
    const badVerifierRes = await request(app)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'gemini-client',
        code,
        code_verifier: 'wrong-code-verifier-that-is-long-enough-for-pkce-check-000000',
        redirect_uri: redirectUri,
      });

    expect(badVerifierRes.status).toBe(400);
    expect(badVerifierRes.body.error).toBe('invalid_grant');

    // Issue a fresh code and exchange with valid PKCE code_verifier
    const authRes2 = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'gemini-client',
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'pkce-state-2',
        scope: 'mcp:tools',
        password: 'correct-horse-battery-staple',
      });
    const code2 = new URL(authRes2.headers.location).searchParams.get('code')!;

    const tokenRes = await request(app)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'gemini-client',
        code: code2,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body).toMatchObject({
      access_token: expect.any(String),
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: expect.any(String),
    });

    // Replaying the same authorization code is rejected
    const replayRes = await request(app)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'gemini-client',
        code: code2,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe('invalid_grant');

    // Authenticated POST /mcp succeeds with the issued access_token
    const mcpRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'list_accounts',
          arguments: {},
        },
      });

    expect(mcpRes.status).toBe(200);
    const parsed = JSON.parse(mcpRes.body.result.content[0].text);
    expect(parsed.accounts).toEqual([
      {
        id: 'acc-1',
        name: 'Checking',
        offbudget: false,
        closed: false,
        balance: 500.25,
      },
    ]);
  });

  it('exchanges tokens and revokes them as a public client (auth_method none) without a client_secret on POST /token and POST /revoke', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });
    const redirectUri = 'http://localhost:54321/callback';
    const codeVerifier = 'basic-auth-verifier-with-sufficient-entropy-1234567890-abcdef';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const authRes = await request(app)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'public-ai-agent',
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        password: 'correct-horse-battery-staple',
      });
    const code = new URL(authRes.headers.location).searchParams.get('code')!;

    // Exchange token as public client (no client_secret)
    const tokenRes = await request(app)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'public-ai-agent',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

    expect(tokenRes.status).toBe(200);
    const accessToken = tokenRes.body.access_token as string;
    expect(accessToken).toEqual(expect.any(String));

    // Revoke token as public client
    const revokeRes = await request(app)
      .post('/revoke')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_id: 'public-ai-agent',
        token: accessToken,
      });

    expect(revokeRes.status).toBe(200);

    // Revoked access token can no longer access /mcp
    const afterRevokeMcpRes = await request(app)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/list',
        params: {},
      });

    expect(afterRevokeMcpRes.status).toBe(401);
  });

  it('persists tokens to oauth-tokens.json across server restarts and renews access_token on grant_type=refresh_token without rotating refresh_token while extending its sliding expiration', async () => {
    const app1 = createApp({ config, budgetGateway: createStubGateway() });
    const redirectUri = 'http://localhost:54321/callback';
    const codeVerifier = 'refresh-persistence-verifier-with-entropy-9876543210-zyxwv';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const authRes = await request(app1)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        response_type: 'code',
        client_id: 'gemini-client',
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        password: 'correct-horse-battery-staple',
      });
    const code = new URL(authRes.headers.location).searchParams.get('code')!;

    const initialTokenRes = await request(app1)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'gemini-client',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

    expect(initialTokenRes.status).toBe(200);
    const initialAccessToken = initialTokenRes.body.access_token as string;
    const initialRefreshToken = initialTokenRes.body.refresh_token as string;

    const tokenStorePath = path.join(tempDataDir, 'oauth-tokens.json');
    expect(fs.existsSync(tokenStorePath)).toBe(true);
    const storeBeforeRefresh = JSON.parse(fs.readFileSync(tokenStorePath, 'utf8'));
    const initialRefreshEntry = storeBeforeRefresh.refreshTokens.find(
      (r: { token: string }) => r.token === initialRefreshToken,
    );
    expect(initialRefreshEntry).toBeDefined();
    expect(typeof initialRefreshEntry.expiresAt).toBe('number');

    // Simulate container restart by creating a new app instance against the same DATA_DIR
    const app2 = createApp({ config, budgetGateway: createStubGateway() });

    const mcpOnRestartedRes = await request(app2)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/list',
        params: {},
      });
    expect(mcpOnRestartedRes.status).toBe(200);

    // Exchange refresh_token on the restarted server
    const refreshRes = await request(app2)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'gemini-client',
        refresh_token: initialRefreshToken,
      });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toEqual(expect.any(String));
    expect(refreshRes.body.access_token).not.toBe(initialAccessToken);
    expect(refreshRes.body.expires_in).toBe(3600);
    // Non-rotating refresh token: must return the exact same refresh_token string
    expect(refreshRes.body.refresh_token).toBe(initialRefreshToken);

    const storeAfterRefresh = JSON.parse(fs.readFileSync(tokenStorePath, 'utf8'));
    const updatedRefreshEntry = storeAfterRefresh.refreshTokens.find(
      (r: { token: string }) => r.token === initialRefreshToken,
    );
    expect(updatedRefreshEntry).toBeDefined();
    expect(updatedRefreshEntry.expiresAt).toBeGreaterThan(initialRefreshEntry.expiresAt);

    // Verify the new access token works across another restart
    const app3 = createApp({ config, budgetGateway: createStubGateway() });
    const mcpWithRefreshedTokenRes = await request(app3)
      .post('/mcp')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Bearer ${refreshRes.body.access_token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/list',
        params: {},
      });
    expect(mcpWithRefreshedTokenRes.status).toBe(200);

    // Invalid refresh token returns 400 invalid_grant
    const badRefreshRes = await request(app3)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'gemini-client',
        refresh_token: 'non-existent-refresh-token',
      });
    expect(badRefreshRes.status).toBe(400);
    expect(badRefreshRes.body.error).toBe('invalid_grant');
  });

  it('supports automatic dynamic client registration at POST /register and persists registered clients across restarts', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });

    // 1. Register a public client (token_endpoint_auth_method: 'none')
    const registerPublicRes = await request(app)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Claude Desktop Test',
        redirect_uris: ['http://localhost:54321/callback'],
        token_endpoint_auth_method: 'none',
      });

    expect(registerPublicRes.status).toBe(201);
    expect(registerPublicRes.body.client_id).toEqual(expect.any(String));
    expect(registerPublicRes.body.client_name).toBe('Claude Desktop Test');
    expect(registerPublicRes.body.redirect_uris).toEqual(['http://localhost:54321/callback']);
    expect(registerPublicRes.body.client_secret).toBeUndefined();

    const publicClientId = registerPublicRes.body.client_id;

    // 2. Reject registration with an unlisted redirect URI
    const registerBadRes = await request(app)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Attacker Client',
        redirect_uris: ['https://evil.com/callback'],
        token_endpoint_auth_method: 'none',
      });

    expect(registerBadRes.status).toBe(400);
    expect(registerBadRes.body.error).toBe('invalid_client_metadata');

    // 3. Register client with well-known Google callback prefix
    const registerGoogleRes = await request(app)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Gemini Connector',
        redirect_uris: ['https://oauth-redirect.googleusercontent.com/r/my-project-123'],
        token_endpoint_auth_method: 'none',
      });

    expect(registerGoogleRes.status).toBe(201);
    expect(registerGoogleRes.body.redirect_uris).toEqual([
      'https://oauth-redirect.googleusercontent.com/r/my-project-123',
    ]);

    // 4. Verify registered client is saved in oauth-tokens.json
    const storePath = path.join(tempDataDir, 'oauth-tokens.json');
    expect(fs.existsSync(storePath)).toBe(true);
    const storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(storeData.clients).toBeDefined();
    expect(storeData.clients.some((c: { client_id: string }) => c.client_id === publicClientId)).toBe(true);

    // 5. Restart server and verify authorization + token exchange with the registered client
    const appRestarted = createApp({ config, budgetGateway: createStubGateway() });

    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const codeChallenge = createHash('sha256')
      .update(codeVerifier, 'utf8')
      .digest('base64url');

    const authRes = await request(appRestarted)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_id: publicClientId,
        redirect_uri: 'http://localhost:54321/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        state: 'xyz-registered',
        passphrase: 'correct-horse-battery-staple',
      });

    expect(authRes.status).toBe(302);
    const callbackUrl = new URL(authRes.headers.location);
    const authCode = callbackUrl.searchParams.get('code');
    expect(authCode).toBeTruthy();

    const tokenRes = await request(appRestarted)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: publicClientId,
        code: authCode!,
        code_verifier: codeVerifier,
        redirect_uri: 'http://localhost:54321/callback',
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.token_type).toBe('bearer');
    expect(tokenRes.body.access_token).toEqual(expect.any(String));

    // 6. Support confidential client registration with auto-generated client_secret
    const registerConfidentialRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Confidential Client',
        redirect_uris: ['http://localhost:54321/callback'],
        token_endpoint_auth_method: 'client_secret_post',
      });
    expect(registerConfidentialRes.status).toBe(201);
    expect(registerConfidentialRes.body.client_id).toEqual(expect.any(String));
    expect(registerConfidentialRes.body.client_secret).toEqual(expect.any(String));
    expect(registerConfidentialRes.body.client_secret.length).toBeGreaterThanOrEqual(32);
    expect(registerConfidentialRes.body.token_endpoint_auth_method).toBe('client_secret_post');

    const confidentialClientId = registerConfidentialRes.body.client_id;
    const confidentialClientSecret = registerConfidentialRes.body.client_secret;

    // Verify confidential client secret is persisted in oauth-tokens.json
    const storeDataAfterConfidential = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const savedConfidential = storeDataAfterConfidential.clients.find(
      (c: { client_id: string }) => c.client_id === confidentialClientId,
    );
    expect(savedConfidential).toBeDefined();
    expect(savedConfidential.client_secret).toBe(confidentialClientSecret);
    expect(savedConfidential.token_endpoint_auth_method).toBe('client_secret_post');

    // Reject unknown/unsupported auth methods
    const registerUnsupportedRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Unsupported Auth Client',
        redirect_uris: ['http://localhost:54321/callback'],
        token_endpoint_auth_method: 'tls_client_auth',
      });
    expect(registerUnsupportedRes.status).toBe(400);
    expect(registerUnsupportedRes.body.error).toBe('invalid_client_metadata');

    // Confidential client authorizes with admin passphrase and exchanges token with secret
    const confAuthRes = await request(appRestarted)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_id: confidentialClientId,
        redirect_uri: 'http://localhost:54321/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        state: 'conf-state',
        passphrase: 'correct-horse-battery-staple',
      });
    expect(confAuthRes.status).toBe(302);
    const confAuthCode = new URL(confAuthRes.headers.location).searchParams.get('code');
    expect(confAuthCode).toBeTruthy();

    // Exchange fails if client_secret is missing or incorrect
    const badSecretTokenRes = await request(appRestarted)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: confidentialClientId,
        client_secret: 'wrong-secret',
        code: confAuthCode!,
        code_verifier: codeVerifier,
        redirect_uri: 'http://localhost:54321/callback',
      });
    expect(badSecretTokenRes.status).toBe(400);
    expect(badSecretTokenRes.body.error).toBe('invalid_client');

    // Exchange succeeds with valid client_secret in POST body
    const goodSecretTokenRes = await request(appRestarted)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: confidentialClientId,
        client_secret: confidentialClientSecret,
        code: confAuthCode!,
        code_verifier: codeVerifier,
        redirect_uri: 'http://localhost:54321/callback',
      });
    expect(goodSecretTokenRes.status).toBe(200);
    expect(goodSecretTokenRes.body.token_type).toBe('bearer');
    expect(goodSecretTokenRes.body.access_token).toEqual(expect.any(String));

    // Also support Basic Auth header for token exchange
    // Obtain another code for the confidential client
    const confAuthRes2 = await request(appRestarted)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_id: confidentialClientId,
        redirect_uri: 'http://localhost:54321/callback',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        state: 'conf-state-2',
        passphrase: 'correct-horse-battery-staple',
      });
    const confAuthCode2 = new URL(confAuthRes2.headers.location).searchParams.get('code');
    expect(confAuthCode2).toBeTruthy();

    const basicAuthCredentials = Buffer.from(
      `${encodeURIComponent(confidentialClientId)}:${encodeURIComponent(confidentialClientSecret)}`,
    ).toString('base64');

    const basicAuthTokenRes = await request(appRestarted)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Basic ${basicAuthCredentials}`)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code: confAuthCode2!,
        code_verifier: codeVerifier,
        redirect_uri: 'http://localhost:54321/callback',
      });
    expect(basicAuthTokenRes.status).toBe(200);
    expect(basicAuthTokenRes.body.access_token).toEqual(expect.any(String));

    // Reject conflicting multiple auth methods per RFC 6749 §2.3
    const conflictingAuthTokenRes = await request(appRestarted)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `Basic ${basicAuthCredentials}`)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_secret: 'body-secret',
        code: confAuthCode2!,
        code_verifier: codeVerifier,
        redirect_uri: 'http://localhost:54321/callback',
      });
    expect(conflictingAuthTokenRes.status).toBe(400);
    expect(conflictingAuthTokenRes.body.error).toBe('invalid_request');

    // Confidential client token revocation requires valid client_secret
    const badSecretRevokeRes = await request(appRestarted)
      .post('/revoke')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        token: basicAuthTokenRes.body.access_token,
        client_id: confidentialClientId,
        client_secret: 'wrong-secret',
      });
    expect(badSecretRevokeRes.status).toBe(400);
    expect(badSecretRevokeRes.body.error).toBe('invalid_client');

    const goodSecretRevokeRes = await request(appRestarted)
      .post('/revoke')
      .set('Host', 'mcp.example.com')
      .set('Authorization', `basic ${basicAuthCredentials}`)
      .type('form')
      .send({
        token: basicAuthTokenRes.body.access_token,
      });
    expect(goodSecretRevokeRes.status).toBe(200);

    // Dynamic registration variants: client_secret_basic and omitted token_endpoint_auth_method
    const registerBasicRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Basic Client',
        redirect_uris: ['http://localhost:54321/callback'],
        token_endpoint_auth_method: 'client_secret_basic',
      });
    expect(registerBasicRes.status).toBe(201);
    expect(registerBasicRes.body.client_secret).toBeDefined();
    expect(registerBasicRes.body.token_endpoint_auth_method).toBe('client_secret_basic');

    const registerDefaultRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Default Client (omitted auth method)',
        redirect_uris: ['http://localhost:54321/callback'],
      });
    expect(registerDefaultRes.status).toBe(201);
    expect(registerDefaultRes.body.client_secret).toBeDefined();
    expect(registerDefaultRes.body.token_endpoint_auth_method).toBe('client_secret_basic');

    // Dynamic registration resilience variants (Google OpenAuth / client quirks)
    // A: Singular redirect_uri instead of redirect_uris array
    const registerSingularRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Singular redirect_uri Client',
        redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/custom-google-path',
        scope: ['mcp:tools'],
        client_uri: '',
      });
    expect(registerSingularRes.status).toBe(201);
    expect(registerSingularRes.body.redirect_uris).toEqual([
      'https://oauth-redirect.googleusercontent.com/r/custom-google-path',
    ]);
    expect(registerSingularRes.body.client_secret).toBeDefined();

    // B: Form-urlencoded POST /register with comma-separated redirect_uris
    const registerFormRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_name: 'Form-encoded Client',
        redirect_uri: 'http://localhost:54321/form-callback',
        token_endpoint_auth_method: 'client_secret_post',
      });
    expect(registerFormRes.status).toBe(201);
    expect(registerFormRes.body.redirect_uris).toEqual(['http://localhost:54321/form-callback']);
    expect(registerFormRes.body.client_secret).toBeDefined();

    // C: Real-world Google OpenAuth multi-environment payload from Gemini Connected Apps
    const registerGoogleRealPayloadRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('User-Agent', 'OpenAuth')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Google',
        redirect_uris: [
          'https://oauth-redirect-sandbox.googleusercontent.com/r/user_bound_custom-mcp-107817641131327074800-mcp_peliu_uk',
          'https://oauth-redirect-test.googleusercontent.com/r/user_bound_custom-mcp-107817641131327074800-mcp_peliu_uk',
          'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-107817641131327074800-mcp_peliu_uk',
          'https://oauth-redirect-sandbox.googleusercontent.com/a/user_bound_custom-mcp-107817641131327074800-mcp_peliu_uk',
          'https://oauth-redirect-test.googleusercontent.com/a/user_bound_custom-mcp-107817641131327074800-mcp_peliu_uk',
          'https://oauth-redirect.googleusercontent.com/a/user_bound_custom-mcp-107817641131327074800-mcp_peliu_uk',
        ],
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'client_secret_post',
      });
    expect(registerGoogleRealPayloadRes.status).toBe(201);
    expect(registerGoogleRealPayloadRes.body.client_secret).toBeDefined();
    expect(registerGoogleRealPayloadRes.body.redirect_uris).toHaveLength(6);

    // 7. Prevent cross-client redirect URI leakage
    // Client A registers with a dedicated specific path
    const registerDedicatedRes = await request(appRestarted)
      .post('/register')
      .set('Host', 'mcp.example.com')
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'Client Dedicated',
        redirect_uris: ['http://localhost:54321/client-dedicated-only'],
        token_endpoint_auth_method: 'none',
      });
    expect(registerDedicatedRes.status).toBe(201);
    const dedicatedClientId = registerDedicatedRes.body.client_id;

    // A different unregistered on-the-fly client should not have client-dedicated-only in its allowed list if base config has an explicit path
    const configWithExplicitPath = loadConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: '3000',
      DATA_DIR: tempDataDir,
      OAUTH_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      OAUTH_ALLOWED_REDIRECT_URIS: 'http://localhost/global-callback',
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'actual-password',
      ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
    });
    const appExplicit = createApp({ config: configWithExplicitPath, budgetGateway: createStubGateway() });

    // An unknown on-the-fly client trying to use dedicatedClientId's URI must be rejected
    const authLeakAttemptRes = await request(appExplicit)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_id: 'unknown-client-other',
        redirect_uri: 'http://localhost/client-dedicated-only',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        passphrase: 'correct-horse-battery-staple',
      });
    expect(authLeakAttemptRes.status).toBe(400);

    // 8. Reject normalized path traversal in prefix matching
    const authTraversalAttemptRes = await request(appRestarted)
      .post('/authorize')
      .set('Host', 'mcp.example.com')
      .type('form')
      .send({
        client_id: publicClientId,
        redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/../evil',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        passphrase: 'correct-horse-battery-staple',
      });
    expect(authTraversalAttemptRes.status).toBe(400);
  });
});
