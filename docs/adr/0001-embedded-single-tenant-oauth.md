# Embedded Single-Tenant OAuth 2.1 Server for Gemini Connector

> *Superseded in part by [ADR 0006](0006-public-client-pkce-oauth.md) regarding client secrets and dynamic redirect allowlists.*

Google Gemini's custom MCP connector requires an OAuth 2.0 Authorization Code flow with a pre-configured `Client ID` and `Client Secret`, dynamic Google redirect URI suffixes (`https://oauth-redirect.googleusercontent.com/r/*`, etc.), and persistent non-rotating refresh tokens. Rather than deploying and operating an external identity provider (Keycloak, Auth0, or Ory), `actual-mcp` embeds a single-tenant OAuth 2.1 Authorization and Resource Server in the same Express process using `@modelcontextprotocol/sdk`'s `mcpAuthRouter`, backed by environment-configured credentials (`OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_ADMIN_PASSWORD`) and a persistent file-backed Token Store (`/data/oauth-tokens.json`).

## Consequences

- `actual-mcp` includes a tiny middleware shim before `/token` and `/revoke` that decodes `Authorization: Basic` into `req.body.client_id` / `req.body.client_secret` because `@modelcontextprotocol/sdk`'s `authenticateClient` only reads body parameters (`client_secret_post`).
- Client redirect URI validation matches incoming redirect URIs against an allowlist of Google's redirect URI patterns rather than relying solely on static string equality.
- Refresh token exchanges (`grant_type=refresh_token`) return a fresh access token while preserving the existing refresh token and extending its sliding expiration so the Gemini link never drops across token refreshes or container restarts.
