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
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  EmbeddedOAuthProvider,
  SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS,
} from './auth/provider.js';
import type { AppConfig } from './config.js';
import type { BudgetGateway } from './gateway/types.js';
import { BRAND_ICON_DATA_URI } from './mcp/icon.js';
import { createMcpServer } from './mcp/server.js';

export interface CreateAppOptions {
  config: AppConfig;
  budgetGateway: BudgetGateway;
}

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
  const logoUrl = config.LOGO_URL ?? `${config.PUBLIC_URL}/logo.png`;

  const oauthMetadata: OAuthMetadata = {
    ...createOAuthMetadata({
      provider: oauthProvider,
      issuerUrl,
      scopesSupported,
    }),
    issuer: config.PUBLIC_URL,
    logo_uri: logoUrl,
    token_endpoint_auth_methods_supported: Array.from(SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS),
    revocation_endpoint_auth_methods_supported: Array.from(SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS),
  };

  const protectedResourceMetadata: OAuthProtectedResourceMetadata = {
    resource: resourceServerUrl.href,
    authorization_servers: [config.PUBLIC_URL],
    scopes_supported: scopesSupported,
    bearer_methods_supported: ['header'],
    resource_name: 'Actual Budget MCP Server',
    logo_uri: logoUrl,
  };

  const brandAssetsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../docs/assets/logo/dist',
  );

  const sendBrandAsset = (res: express.Response, filename: string, contentType?: string) => {
    if (contentType) {
      res.type(contentType);
    }
    res.sendFile(path.join(brandAssetsDir, filename), { dotfiles: 'allow' });
  };

  app.get('/favicon.ico', (_req, res) => {
    sendBrandAsset(res, 'favicon.ico', 'image/x-icon');
  });

  app.get('/logo.png', (_req, res) => {
    sendBrandAsset(res, 'logo.png', 'image/png');
  });

  app.get('/apple-touch-icon.png', (_req, res) => {
    sendBrandAsset(res, 'apple-touch-icon.png', 'image/png');
  });

  app.get('/logo.svg', (_req, res) => {
    sendBrandAsset(res, 'logo.svg', 'image/svg+xml; charset=utf-8');
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

  const basicAuthToBody = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const authHeader = req.headers.authorization;
    if (authHeader && /^Basic\s+/i.test(authHeader)) {
      try {
        const credentials = Buffer.from(authHeader.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8');
        const colonIdx = credentials.indexOf(':');
        if (colonIdx !== -1) {
          const clientId = decodeURIComponent(credentials.slice(0, colonIdx));
          const clientSecret = decodeURIComponent(credentials.slice(colonIdx + 1));
          if (req.body && typeof req.body === 'object') {
            if (req.body.client_secret || (req.body.client_id && req.body.client_id !== clientId)) {
              res.status(400).json({
                error: 'invalid_request',
                error_description: 'Multiple client authentication methods found in request',
              });
              return;
            }
            req.body.client_id = clientId;
            req.body.client_secret = clientSecret;
          }
        }
      } catch {
        // Ignore parse error; downstream clientAuth will handle missing/invalid credentials
      }
    }
    next();
  };

  app.use('/token', express.urlencoded({ extended: false }), basicAuthToBody);
  app.use('/revoke', express.urlencoded({ extended: false }), basicAuthToBody);

  app.use(
    '/register',
    express.json(),
    express.urlencoded({ extended: false }),
    (req, res, next) => {
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode >= 400) {
          console.error(
            `[register] ❌ ${res.statusCode} registration failed:`,
            JSON.stringify(body),
          );
        } else {
          console.log(
            `[register] ✅ ${res.statusCode} client registered:`,
            JSON.stringify(body),
          );
        }
        return originalJson(body);
      };

      if (req.method === 'POST') {
        console.log(`[register] 📥 incoming registration request:`, {
          contentType: req.headers['content-type'],
          userAgent: req.headers['user-agent'],
          body: req.body,
        });

        if (req.body && typeof req.body === 'object') {
          // 1. Normalize singular redirect_uri to redirect_uris array
          if (req.body.redirect_uri && !req.body.redirect_uris) {
            req.body.redirect_uris = [req.body.redirect_uri];
          } else if (typeof req.body.redirect_uris === 'string') {
            req.body.redirect_uris = req.body.redirect_uris
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean);
          }

          // 2. Normalize scope / scopes (array vs string)
          if (Array.isArray(req.body.scope)) {
            req.body.scope = req.body.scope.join(' ');
          } else if (!req.body.scope && Array.isArray(req.body.scopes)) {
            req.body.scope = req.body.scopes.join(' ');
          } else if (!req.body.scope && typeof req.body.scopes === 'string') {
            req.body.scope = req.body.scopes;
          }

          // 3. Normalize grant_types & response_types
          if (typeof req.body.grant_types === 'string') {
            req.body.grant_types = req.body.grant_types
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean);
          }
          if (typeof req.body.response_types === 'string') {
            req.body.response_types = req.body.response_types
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean);
          }

          // 4. Normalize contacts
          if (typeof req.body.contacts === 'string') {
            req.body.contacts = [req.body.contacts];
          }

          // 5. Remove empty string fields that fail Zod url validation
          for (const key of ['client_uri', 'logo_uri', 'tos_uri', 'policy_uri', 'jwks_uri']) {
            if (req.body[key] === '') {
              delete req.body[key];
            }
          }

          // 6. Record candidate redirect URIs
          if (Array.isArray(req.body.redirect_uris)) {
            for (const uri of req.body.redirect_uris) {
              oauthProvider.recordCandidateRedirectUri(uri);
            }
          }
        }
      }
      next();
    },
  );

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
