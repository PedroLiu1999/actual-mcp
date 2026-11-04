import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const validEnv = {
  PUBLIC_URL: 'https://mcp.example.com',
  PORT: '3000',
  DATA_DIR: '/tmp/actual-mcp-data',
  OAUTH_CLIENT_ID: 'gemini-client',
  OAUTH_CLIENT_SECRET: 'super-secret-client-secret',
  OAUTH_ADMIN_PASSWORD: 'admin-consent-passphrase',
  ACTUAL_SERVER_URL: 'http://host.docker.internal:5006',
  ACTUAL_PASSWORD: 'actual-server-password',
  ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
};

describe('loadConfig', () => {
  it('parses valid required environment variables and applies defaults for optional fields', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      PUBLIC_URL: 'https://mcp.example.com',
      PORT: 3000,
      DATA_DIR: '/tmp/actual-mcp-data',
      OAUTH_CLIENT_ID: 'gemini-client',
      OAUTH_CLIENT_SECRET: 'super-secret-client-secret',
      OAUTH_ADMIN_PASSWORD: 'admin-consent-passphrase',
      OAUTH_EXTRA_REDIRECT_URIS: [],
      ACTUAL_SERVER_URL: 'http://host.docker.internal:5006',
      ACTUAL_PASSWORD: 'actual-server-password',
      ACTUAL_SYNC_ID: '11111111-2222-3333-4444-555555555555',
      ACTUAL_ENCRYPTION_PASSWORD: undefined,
      SYNC_TTL_SECONDS: 30,
    });
  });

  it('parses optional ACTUAL_ENCRYPTION_PASSWORD, SYNC_TTL_SECONDS, and OAUTH_EXTRA_REDIRECT_URIS', () => {
    const config = loadConfig({
      ...validEnv,
      ACTUAL_ENCRYPTION_PASSWORD: 'e2e-password',
      SYNC_TTL_SECONDS: '60',
      OAUTH_EXTRA_REDIRECT_URIS: 'https://cb1.example.com/oauth, https://cb2.example.com/oauth',
    });

    expect(config.ACTUAL_ENCRYPTION_PASSWORD).toBe('e2e-password');
    expect(config.SYNC_TTL_SECONDS).toBe(60);
    expect(config.OAUTH_EXTRA_REDIRECT_URIS).toEqual([
      'https://cb1.example.com/oauth',
      'https://cb2.example.com/oauth',
    ]);
  });

  it('fails fast with a descriptive error when required environment variables are missing or invalid', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        PUBLIC_URL: 'not-a-valid-url',
        ACTUAL_SYNC_ID: '',
      }),
    ).toThrow(/Invalid startup configuration.*PUBLIC_URL.*ACTUAL_SYNC_ID/s);
  });
});
