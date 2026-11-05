import { createHash } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';

export interface IssueBearerTokenOptions {
  clientId?: string;
  redirectUri?: string;
  adminPassword?: string;
}

export async function issueBearerToken(
  app: Express,
  options: IssueBearerTokenOptions = {},
): Promise<string> {
  const clientId = options.clientId ?? 'test-client';
  const redirectUri = options.redirectUri ?? 'http://localhost:54321/callback';
  const adminPassword = options.adminPassword ?? 'admin-password';

  const codeVerifier = 'test-pkce-verifier-with-sufficient-entropy-0123456789-abcdef';
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const authRes = await request(app)
    .post('/authorize')
    .set('Host', 'mcp.example.com')
    .type('form')
    .send({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      password: adminPassword,
    });

  const code = new URL(authRes.headers.location).searchParams.get('code')!;
  const tokenRes = await request(app)
    .post('/token')
    .set('Host', 'mcp.example.com')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });

  return tokenRes.body.access_token as string;
}
