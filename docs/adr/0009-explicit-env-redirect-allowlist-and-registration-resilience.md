# Explicit Environment Redirect Allowlist, Google Base Matching, and Registration Normalization

> **Status**: Accepted (Amends [ADR-0007](0007-dynamic-client-registration.md) and [ADR-0008](0008-confidential-and-public-client-oauth.md))

## Context

ADR-0007 §3 and ADR-0008 implemented dynamic client registration (`/register`) and well-known callback allowlists. However, several architectural divergences arose in production operation:
1. Code-level default `OAUTH_ALLOWED_REDIRECT_URIS` contained remote third-party URLs (`oauth-redirect.googleusercontent.com/r/` and `/a/`), coupling codebase defaults to external infrastructure rather than enforcing operator-controlled environment configuration.
2. Google Gemini dynamic registration requests use varied subpaths (`/r/...`, `/callback`, project-specific hashes). Strict subpath matching previously led to attempts at hardcoded hostname bypasses in code, violating ADR-0007's requirement that matching strictly follow configured allowlists.
3. RFC 7591 §2 specifies that when `token_endpoint_auth_method` is omitted, the default is `client_secret_basic`. ADR-0008 erroneously defaulted omitted methods to `client_secret_post`.
4. Cloud clients such as Google OpenAuth submit payloads with client-side variations (singular `redirect_uri` string, comma-separated lists, array `scope`, empty-string URLs) that failed Zod validation before reaching registration logic.

## Decision

1. **Strictly Environment-Driven Remote Allowlist**:
   - `DEFAULT_ALLOWED_REDIRECT_URIS` in code is strictly restricted to loopback interfaces (`http://localhost`, `http://127.0.0.1`).
   - All remote OAuth redirect URLs must be explicitly configured via `OAUTH_ALLOWED_REDIRECT_URIS` in `.env`.
   - Setup wizard (`scripts/setup-wizard.sh`) auto-populates `OAUTH_ALLOWED_REDIRECT_URIS` based on interactive AI client selection.

2. **Standard Base URL Prefix Matching for Google Gemini**:
   - Google Gemini's allowed callback entry in `.env` is standardized to `https://oauth-redirect.googleusercontent.com/` (base URL ending with `/`).
   - Standard trailing-slash prefix matching in `isAllowedRedirectUri` cleanly validates all dynamic Google callbacks without hardcoded domain exceptions in code.

3. **RFC 7591 §2 Conforming Default Auth Method**:
   - When `token_endpoint_auth_method` is omitted in dynamic client registration, the server defaults to `client_secret_basic` per RFC 7591 §2.
   - Both `client_secret_basic` and `client_secret_post` remain fully supported at `/token` and `/revoke`.

4. **Dedicated Registration Normalization Module**:
   - Request body normalization and list parsing are encapsulated in `src/auth/registration.ts`, decoupling RFC-resilience logic from route wiring in `src/app.ts`.
