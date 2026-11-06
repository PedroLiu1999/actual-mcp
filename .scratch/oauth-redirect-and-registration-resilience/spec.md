# Strict Environment-Driven Redirect Allowlist, Setup Wizard Agent Auto-population, and Registration Resilience

## Problem Statement

Users configuring and running `actual-mcp` face three interconnected authentication challenges:
1. Default redirect URI configuration previously embedded remote Google domains into the codebase fallback defaults instead of requiring operators to configure them explicitly in `.env`, while path matching relied on a special-case hostname bypass for Google rather than uniform trailing-slash prefix matching against configured base URLs (e.g. `https://oauth-redirect.googleusercontent.com/`).
2. When Google Gemini OpenAuth omits `token_endpoint_auth_method`, the server defaulted to `client_secret_post`, violating RFC 7591 §2 which mandates `client_secret_basic` as the specification default for confidential clients.
3. The setup wizard's agent selection flow was separated across stages and did not smoothly auto-populate `.env` when upgrading existing loopback installations, while `src/app.ts` accumulated inline payload mutation and duplicate normalization logic that belongs in the auth domain layer.

## Solution

1. Restrict default `OAUTH_ALLOWED_REDIRECT_URIS` in code strictly to loopback (`http://localhost`, `http://127.0.0.1`). All remote callbacks must be configured via `.env`.
2. Explicitly configure Google Gemini's multi-environment callback prefixes in `.env` and `scripts/setup-wizard.sh` (`https://oauth-redirect.googleusercontent.com/r/`, `https://oauth-redirect.googleusercontent.com/a/`, `https://oauth-redirect-sandbox.googleusercontent.com/r/`, `https://oauth-redirect-sandbox.googleusercontent.com/a/`, `https://oauth-redirect-test.googleusercontent.com/r/`, `https://oauth-redirect-test.googleusercontent.com/a/`, and `https://vertexaisearch.cloud.google.com/oauth-redirect`), allowing standard trailing-slash prefix matching to handle all dynamic Google Gemini registration paths uniformly without special-cased code bypasses.
3. Use the agent multiselect pattern in `scripts/setup-wizard.sh` to auto-populate `OAUTH_ALLOWED_REDIRECT_URIS` in `.env` based on selected AI clients (Google Gemini, Claude Desktop, Cursor, ChatGPT, etc.), including during configuration upgrades.
4. Set `client_secret_basic` as the default `token_endpoint_auth_method` when omitted in dynamic registration per RFC 7591 §2, while continuing to support `client_secret_basic`, `client_secret_post`, and `none`.
5. Extract registration normalization into a dedicated auth module (`src/auth/registration.ts`), deduplicating comma-separated list splitting and keeping `src/app.ts` as a clean routing seam.
6. Record architectural decisions in ADR-0009.

## User Stories

1. As a self-hosting operator, I want remote OAuth redirect URIs to be configured strictly in my `.env` file rather than hardcoded in the codebase defaults, so that my server only trusts external domains I explicitly approve.
2. As a self-hosting operator running `actual-mcp` locally with default settings, I want loopback (`http://localhost` and `http://127.0.0.1`) to work out-of-the-box without extra configuration for local CLI and desktop clients.
3. As a Google Gemini Connected Apps user, I want the server to accept dynamic callbacks under `https://oauth-redirect.googleusercontent.com/`, so that Gemini can dynamically register and complete the OAuth handshake without manual Client ID and Client Secret copy-pasting.
4. As an operator using `setup-wizard.sh`, I want to select the AI clients I plan to use from an interactive menu, so that the wizard automatically populates the appropriate `OAUTH_ALLOWED_REDIRECT_URIS` entries in my `.env`.
5. As an operator upgrading an existing loopback-only `.env` via `setup-wizard.sh`, I want the wizard to offer agent selection and add newly chosen remote endpoints seamlessly, so that I don't have to manually format comma-separated URL lists.
6. As a confidential OAuth client implementing RFC 7591 without specifying an auth method, I want the server to default to `client_secret_basic`, so that dynamic registration adheres strictly to the RFC specification.
7. As a client authenticating at `/token` or `/revoke`, I want both HTTP Basic Auth (`client_secret_basic`) and form body credentials (`client_secret_post`) to be supported transparently.
8. As a developer maintaining `actual-mcp`, I want registration payload normalization logic to live in an auth domain module rather than inline in `app.ts`, so that route composition remains clean and easy to test.
9. As an operator debugging client connection issues, I want incoming registration requests and rejection reasons logged to stdout, so that I can immediately identify payload incompatibilities via `docker logs`.

## Implementation Decisions

1. **Default Allowlist Scope**:
   - `DEFAULT_ALLOWED_REDIRECT_URIS` in `src/config.ts` is strictly `['http://localhost', 'http://127.0.0.1']`.
   - `.env.example` documents `OAUTH_ALLOWED_REDIRECT_URIS` with loopback and Google Gemini `/r/` and `/a/` endpoints across production, sandbox, and test environments.
2. **Uniform Prefix Matching**:
   - Remove special-case hostname checks for Google in `isAllowedRedirectUri`. All remote HTTPS URLs are matched strictly if:
     - exact match with an allowed entry, OR
     - an allowed entry ends with `/` and the candidate URL's protocol, host, and path prefix match.
   - For Google Gemini, the allowed entries cover `https://oauth-redirect*.googleusercontent.com/r/` and `/a/` explicitly via `.env`.
3. **Setup Wizard Agent Auto-population**:
   - `scripts/setup-wizard.sh` presents an AI client multiselect:
     - Google Gemini (`https://oauth-redirect*.googleusercontent.com/(r|a)/`)
     - Claude Desktop (`http://localhost`)
     - Cursor (`http://127.0.0.1`)
     - ChatGPT (`https://chatgpt.com/aip/`)
     - Claude Web (`https://claude.ai/api/mcp/oauth/callback`)
   - Auto-populates `OAUTH_ALLOWED_REDIRECT_URIS` in `.env` based on selections.
   - When inspecting existing configuration, if upgrading, prompts user to select clients and merges selections.
   - Refactor parameter names in helper functions (`join_by`) to descriptive identifiers (`delim`, `first_item`).
4. **RFC 7591 Default Auth Method**:
   - When `token_endpoint_auth_method` is omitted in `registerClient`, default to `'client_secret_basic'` (RFC 7591 §2).
   - In `provider.ts`, emit `'client_secret_basic'` as the registered auth method when omitted.
5. **Auth Normalization Module**:
   - Create `src/auth/registration.ts` exporting `normalizeRegistrationBody(body: unknown): unknown`.
   - Deduplicate comma-split string parsing via a shared helper `parseList(val: unknown): string[]`.
   - Support `redirect_uri` (singular string) → `redirect_uris` (array).
   - Support `scope` / `scopes` (array → space-separated string).
   - Support `grant_types`, `response_types`, `contacts`.
   - Strip empty string URL properties.
   - `src/app.ts` imports and delegates to `normalizeRegistrationBody`.
6. **Architecture Decision Record**:
   - Create `docs/adr/0009-explicit-env-redirect-allowlist-and-registration-resilience.md`.

## Testing Decisions

- **Test Seam**: Probed primarily at the HTTP server seam (`createApp`) via `supertest` in `tests/oauth.test.ts` and `tests/config.test.ts`.
- **External Behavior Only**: Verify HTTP status codes (`201 Created`, `400 Bad Request`, `401 Unauthorized`), response headers (`Cache-Control`, `WWW-Authenticate`), and returned JSON bodies without testing private implementation methods.
- **Config Seam**: Probed in `tests/config.test.ts` verifying that default configuration only includes loopback, and custom environment strings properly parse into allowed arrays.
- **Wizard Seam**: Probed in `tests/packaging.test.ts` or standalone bash execution testing agent selection and `.env` generation.

## Out of Scope

- Implementing OAuth 2.0 PKCE code exchange or token storage changes (already complete and tested).
- Adding multi-tenant user authentication or database backends (single-budget single-tenant architecture preserved).

## Further Notes

- Version target: patch bump to `0.4.4` to distribute the updated container image to Docker Hub / GHCR for VPS deployment.
