import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import express, { type Express, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { EmbeddedOAuthProvider } from './auth/provider.js';
import type { AppConfig } from './config.js';
import type { BudgetGateway } from './gateway/types.js';
import { BRAND_ICON_DATA_URI } from './mcp/icon.js';
import { createMcpServer } from './mcp/server.js';

export interface CreateAppOptions {
  config: AppConfig;
  budgetGateway: BudgetGateway;
}

const basicClientAuthShim: RequestHandler = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith('basic ')) {
    next();
    return;
  }

  if (!req.body || typeof req.body !== 'object') {
    req.body = {};
  }

  if (req.body.client_id === undefined) {
    try {
      const encoded = authHeader.slice(6).trim();
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex !== -1) {
        const rawClientId = decoded.slice(0, colonIndex);
        const rawClientSecret = decoded.slice(colonIndex + 1);
        req.body.client_id = decodeURIComponent(rawClientId);
        req.body.client_secret = decodeURIComponent(rawClientSecret);
      }
    } catch {
      // Fall through and let downstream client authentication reject malformed credentials
    }
  }

  next();
};

export function createApp({ config, budgetGateway }: CreateAppOptions): Express {
  const app = express();
  app.set('trust proxy', 1);

  const publicHostname = new URL(config.PUBLIC_URL).hostname;
  const allowedHosts = Array.from(
    new Set([publicHostname, 'localhost', '127.0.0.1', '[::1]']),
  );

  app.use(hostHeaderValidation(allowedHosts));
  app.use(express.json());

  const issuerUrl = new URL(config.PUBLIC_URL);
  const resourceServerUrl = new URL(`${config.PUBLIC_URL}/mcp`);
  const scopesSupported = ['mcp:tools'];
  const oauthProvider = new EmbeddedOAuthProvider(config);

  const oauthMetadata: OAuthMetadata = {
    ...createOAuthMetadata({
      provider: oauthProvider,
      issuerUrl,
      scopesSupported,
    }),
    issuer: config.PUBLIC_URL,
    logo_uri: BRAND_ICON_DATA_URI,
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  };

  const protectedResourceMetadata: OAuthProtectedResourceMetadata = {
    resource: resourceServerUrl.href,
    authorization_servers: [config.PUBLIC_URL],
    scopes_supported: scopesSupported,
    bearer_methods_supported: ['header'],
    resource_name: 'Actual Budget MCP Server',
    logo_uri: BRAND_ICON_DATA_URI,
  };

  const brandAssetsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../docs/assets/logo/dist',
  );

  app.get('/favicon.ico', (_req, res) => {
    res.type('image/x-icon').sendFile(path.join(brandAssetsDir, 'favicon.ico'));
  });

  app.get('/logo.png', (_req, res) => {
    res.type('image/png').sendFile(path.join(brandAssetsDir, 'logo.png'));
  });

  app.get('/apple-touch-icon.png', (_req, res) => {
    res.type('image/png').sendFile(path.join(brandAssetsDir, 'apple-touch-icon.png'));
  });

  app.get('/logo.svg', (_req, res) => {
    res.type('image/svg+xml; charset=utf-8').sendFile(path.join(brandAssetsDir, 'logo.svg'));
  });

  app.use(
    '/.well-known/oauth-protected-resource/mcp',
    metadataHandler(protectedResourceMetadata),
  );
  app.use(
    '/.well-known/oauth-protected-resource',
    metadataHandler(protectedResourceMetadata),
  );
  app.use(
    '/.well-known/oauth-authorization-server',
    metadataHandler(oauthMetadata),
  );

  const authorizePostLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post('/authorize', authorizePostLimiter);

  app.use('/authorize', express.urlencoded({ extended: false }), (req, _res, next) => {
    if (req.method === 'POST') {
      req.body = {
        response_type: 'code',
        code_challenge_method: 'S256',
        ...req.query,
        ...(typeof req.body === 'object' && req.body !== null ? req.body : {}),
      };
    }
    const candidate = req.method === 'POST' ? req.body?.redirect_uri : req.query?.redirect_uri;
    oauthProvider.recordCandidateRedirectUri(candidate);
    next();
  });

  app.use('/token', express.urlencoded({ extended: false }), basicClientAuthShim);
  app.use('/revoke', express.urlencoded({ extended: false }), basicClientAuthShim);

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      resourceServerUrl,
      scopesSupported,
      resourceName: 'Actual Budget MCP Server',
    }),
  );

  const bearerAuth = requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
  });

  app.get('/healthz', (_req, res) => {
    const readiness = budgetGateway.getReadiness();
    res.status(200).json({
      status: 'ok',
      targetBudget: readiness,
    });
  });

  app.post('/mcp', bearerAuth, async (req, res) => {
    const server = createMcpServer(budgetGateway, config.PUBLIC_URL);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  });

  return app;
}
