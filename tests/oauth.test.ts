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
      OAUTH_CLIENT_ID: 'gemini-client',
      OAUTH_CLIENT_SECRET: 'super-secret-value',
      OAUTH_ADMIN_PASSWORD: 'correct-horse-battery-staple',
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

  it('serves RFC 8414 Authorization Server Metadata at /.well-known/oauth-authorization-server advertising /authorize, /token, /revoke, S256, and both client_secret_post and client_secret_basic', async () => {
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
      response_types_supported: ['code'],
      grant_types_supported: expect.arrayContaining(['authorization_code', 'refresh_token']),
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: expect.arrayContaining([
        'client_secret_post',
        'client_secret_basic',
      ]),
      revocation_endpoint_auth_methods_supported: expect.arrayContaining([
        'client_secret_post',
        'client_secret_basic',
      ]),
    });
  });

  it('validates client_id and allows Google connector redirect URI patterns plus OAUTH_EXTRA_REDIRECT_URIS on GET /authorize while rejecting unlisted redirect URIs', async () => {
    const customConfig = loadConfig({
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: '3000',
      DATA_DIR: tempDataDir,
      OAUTH_CLIENT_ID: 'gemini-client',
      OAUTH_CLIENT_SECRET: 'super-secret-value',
      OAUTH_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      OAUTH_EXTRA_REDIRECT_URIS: 'https://custom-client.example.org/oauth/callback',
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'actual-password',
      ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
    });
    const app = createApp({ config: customConfig, budgetGateway: createStubGateway() });

    const allowedRedirectUris = [
      'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123',
      'https://oauth-redirect-sandbox.googleusercontent.com/r/gemini-sbx-456',
      'https://oauth-redirect-test.googleusercontent.com/r/gemini-test-789',
      'https://oauth-redirect.googleusercontent.com/a/agent-prod-123',
      'https://oauth-redirect-sandbox.googleusercontent.com/a/agent-sbx-456',
      'https://oauth-redirect-test.googleusercontent.com/a/agent-test-789',
      'https://vertexaisearch.cloud.google.com/oauth-redirect',
      'https://custom-client.example.org/oauth/callback',
    ];

    for (const redirectUri of allowedRedirectUris) {
      const res = await request(app)
        .get('/authorize')
        .set('Host', 'mcp.example.com')
        .query({
          response_type: 'code',
          client_id: 'gemini-client',
          redirect_uri: redirectUri,
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          state: 'state-123',
          scope: 'mcp:tools',
        });

      expect(res.status, `Expected 200 for allowed redirect_uri ${redirectUri}`).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('gemini-client');
      expect(res.text).toContain('/logo.png');
      expect(res.text).toMatch(/type="password"/);
    }

    const rejectedRedirectUris = [
      'https://evil.example.com/callback',
      'http://oauth-redirect.googleusercontent.com/r/insecure',
      'https://oauth-redirect.googleusercontent.com/other/path',
      'https://oauth-redirect.googleusercontent.com/r/',
      'https://oauth-redirect.googleusercontent.com.evil.com/r/123',
      'https://vertexaisearch.cloud.google.com/oauth-redirect/extra',
    ];

    for (const badUri of rejectedRedirectUris) {
      const res = await request(app)
        .get('/authorize')
        .set('Host', 'mcp.example.com')
        .query({
          response_type: 'code',
          client_id: 'gemini-client',
          redirect_uri: badUri,
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          state: 'state-123',
        });

      expect(res.status, `Expected 400 for unlisted redirect_uri ${badUri}`).toBe(400);
    }

    const badClientRes = await request(app)
      .get('/authorize')
      .set('Host', 'mcp.example.com')
      .query({
        response_type: 'code',
        client_id: 'unknown-client',
        redirect_uri: 'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
      });

    expect(badClientRes.status).toBe(400);
  });

  it('verifies OAUTH_ADMIN_PASSWORD on POST /authorize, rejecting wrong passphrases with 401 and redirecting with code and state when valid', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });
    const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123';

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
    const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123';

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
    const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123';
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
        client_secret: 'super-secret-value',
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
        client_secret: 'super-secret-value',
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
        client_secret: 'super-secret-value',
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

  it('accepts client credentials via both Authorization: Basic (client_secret_basic) and form body (client_secret_post) on POST /token and POST /revoke', async () => {
    const app = createApp({ config, budgetGateway: createStubGateway() });
    const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123';
    const codeVerifier = 'basic-auth-verifier-with-sufficient-entropy-1234567890-abcdef';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const basicHeader = `Basic ${Buffer.from('gemini-client:super-secret-value', 'utf8').toString('base64')}`;

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
        password: 'correct-horse-battery-staple',
      });
    const code = new URL(authRes.headers.location).searchParams.get('code')!;

    // Exchange token using client_secret_basic only (no client_id or client_secret in body)
    const tokenRes = await request(app)
      .post('/token')
      .set('Host', 'mcp.example.com')
      .set('Authorization', basicHeader)
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

    expect(tokenRes.status).toBe(200);
    const accessToken = tokenRes.body.access_token as string;
    expect(accessToken).toEqual(expect.any(String));

    // Revoke token using client_secret_basic only
    const revokeRes = await request(app)
      .post('/revoke')
      .set('Host', 'mcp.example.com')
      .set('Authorization', basicHeader)
      .type('form')
      .send({
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
    const redirectUri = 'https://oauth-redirect.googleusercontent.com/r/gemini-prod-123';
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
        client_secret: 'super-secret-value',
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
        client_secret: 'super-secret-value',
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
        client_secret: 'super-secret-value',
        refresh_token: 'non-existent-refresh-token',
      });
    expect(badRefreshRes.status).toBe(400);
    expect(badRefreshRes.body.error).toBe('invalid_grant');
  });
});
