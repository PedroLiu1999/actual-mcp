# Public Client PKCE OAuth and Explicit Redirect Allowlist

`actual-mcp` originally required pre-shared `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` environment variables and hardcoded Google redirect URI patterns to support the Google Gemini connector (ADR 0001). To achieve a zero-friction setup matching the Home Assistant MCP model for modern AI clients (Claude Desktop, Cursor, and web-based agents), we retired client secret verification and switched exclusively to OAuth 2.1 Public Clients with PKCE (`token_endpoint_auth_methods_supported: ['none']`).

Clients can supply any `client_id` on the fly without an RFC 7591 dynamic registration endpoint. Security is enforced by requiring the `OAUTH_ADMIN_PASSWORD` on the browser consent screen and restricting authorization redirects to an explicit `OAUTH_ALLOWED_REDIRECT_URIS` allowlist in `.env`, matching loopback URIs (`localhost` and `127.0.0.1`) on any port per RFC 8252 §7.3 while requiring exact string matching for remote HTTPS URIs.
