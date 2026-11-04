# 02: Embedded OAuth 2.1 Server, Persistent Token Store & Bearer Auth for Gemini

**What to build:** A self-contained single-tenant Embedded OAuth Server inside `actual-mcp` that protects `/mcp` with Bearer token authentication and completes the full OAuth 2.1 Authorization Code + PKCE flow required by Google Gemini's custom MCP connector, backed by a persistent file-based Token Store so issued tokens survive container restarts and refreshes never rotate the refresh token.

**Blocked by:** 01: Walking Skeleton — Express App, Config, Healthcheck, Stateless MCP & list_accounts

**Status:** resolved

- [x] Unauthenticated requests to `/mcp` return HTTP `401 Unauthorized` with a `WWW-Authenticate: Bearer resource_metadata="..."` header pointing to the Protected Resource Metadata URL.
- [x] `GET /.well-known/oauth-protected-resource/mcp` and the root alias `GET /.well-known/oauth-protected-resource` return RFC 9728 metadata referencing the server's `PUBLIC_URL` as the authorization server.
- [x] `GET /.well-known/oauth-authorization-server` returns RFC 8414 metadata advertising `/authorize`, `/token`, `/revoke`, `S256` PKCE support, and both `client_secret_post` and `client_secret_basic` authentication methods.
- [x] Client redirect URI validation accepts Google's official connector callback patterns (`https://oauth-redirect.googleusercontent.com/r/*`, `https://oauth-redirect-sandbox.googleusercontent.com/r/*`, `https://oauth-redirect-test.googleusercontent.com/r/*`, `https://oauth-redirect.googleusercontent.com/a/*`, `https://oauth-redirect-sandbox.googleusercontent.com/a/*`, `https://oauth-redirect-test.googleusercontent.com/a/*`, and `https://vertexaisearch.cloud.google.com/oauth-redirect`) plus any configured extra redirect URIs, and rejects unlisted redirect URIs.
- [x] `GET /authorize` renders a self-contained HTML consent form displaying the client ID and prompting for the admin passphrase; `POST /authorize` verifies `OAUTH_ADMIN_PASSWORD` in constant time, enforces IP rate-limiting against brute-force attempts, and redirects with a single-use authorization code bound to the PKCE `code_challenge`.
- [x] `POST /token` and `POST /revoke` accept client credentials via both `Authorization: Basic <base64>` (`client_secret_basic`) and form body parameters (`client_secret_post`).
- [x] `POST /token` with `grant_type=authorization_code` validates the PKCE `code_verifier` and returns an access token (`expires_in: 3600`, stored internally with `expiresAt` in epoch seconds) and a refresh token.
- [x] `POST /token` with `grant_type=refresh_token` issues a new access token while returning the exact same `refresh_token` string and extending its sliding expiration.
- [x] Issued access and refresh tokens are persisted atomically to the Token Store (`oauth-tokens.json` in `DATA_DIR`) and reloaded across server restarts.
- [x] Integration tests at the HTTP application seam verify discovery endpoints, `401` challenge, redirect URI allowlisting, passphrase consent + rate limiting, PKCE exchange, Basic vs POST client auth, non-rotating refresh token renewal, token persistence across reloads, and authenticated `POST /mcp` access.
