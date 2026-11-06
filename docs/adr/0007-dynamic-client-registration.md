# RFC 7591 Dynamic Client Registration and Well-Known Callback Allowlist Defaults

> **Status**: Accepted (Amends [ADR-0006](0006-public-client-pkce-oauth.md); Amended by [ADR-0008](0008-confidential-and-public-client-oauth.md), [ADR-0009](0009-explicit-env-redirect-allowlist-and-registration-resilience.md))

## Context

ADR 0006 established an OAuth 2.1 Public Client PKCE architecture accepting on-the-fly dynamic `client_id`s without requiring dynamic client registration (DCR). However, several AI assistants (including Google Gemini and automated MCP clients) implement RFC 7591 Dynamic Client Registration to automatically provision and bind their redirect URIs without requiring human intervention.

## Decision

1. **RFC 7591 Dynamic Client Registration (`POST /register`)**:
   - Provide an automatic dynamic client registration endpoint (`/register`) advertised in RFC 8414 Authorization Server metadata.
   - Enforce public client authentication only: registered clients have `token_endpoint_auth_method: 'none'` and no `client_secret`.
   - Prevent client overwrites: registration attempts with existing client IDs are rejected.
   - Persist registered clients in `/data/oauth-tokens.json` so registrations survive container restarts.
2. **Preserve On-The-Fly Public Clients**:
   - Clients that omit DCR continue to be accepted on the fly at `/authorize` using their supplied `client_id` and the server's allowlisted redirect URIs.
3. **Well-Known Callback Allowlist Defaults**:
   - Pre-populate `OAUTH_ALLOWED_REDIRECT_URIS` with loopback URIs and well-known callback endpoints (`https://oauth-redirect.googleusercontent.com/r/`, `https://oauth-redirect.googleusercontent.com/a/`, and `https://vertexaisearch.cloud.google.com/oauth-redirect`).
   - Implement trailing-slash path prefix matching for remote HTTPS callbacks so dynamic subpaths (e.g. Google project IDs) match safely without wildcard bypasses.
