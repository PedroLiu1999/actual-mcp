# 01: Strict Env Redirects, Wizard Auto-population, and Registration Resilience

Status: resolved

## Overview

Implement the decisions established in `.scratch/oauth-redirect-and-registration-resilience/spec.md`:
1. Keep default `OAUTH_ALLOWED_REDIRECT_URIS` in code strictly loopback-only (`http://localhost`, `http://127.0.0.1`), requiring remote URLs to come from `.env`.
2. Standardize Google Gemini's redirect URI to base `https://oauth-redirect.googleusercontent.com/` in `.env.example`, setup wizard, and tests, removing the domain-level code bypass in `isAllowedRedirectUri`.
3. In `scripts/setup-wizard.sh`, use the agent multiselect pattern to auto-populate `OAUTH_ALLOWED_REDIRECT_URIS` based on chosen AI clients, including when upgrading existing configurations. Rename helper parameters (`join_by`).
4. Set `client_secret_basic` as default `token_endpoint_auth_method` when omitted in dynamic client registration (RFC 7591 §2).
5. Extract registration request normalization to `src/auth/registration.ts`, deduplicating list parsing and simplifying `src/app.ts`.
6. Write ADR-0009 documenting these changes.
7. Bump version to 0.4.4, verify all tests pass, and publish.

## Resolution

- In `src/config.ts`, restricted `DEFAULT_ALLOWED_REDIRECT_URIS` strictly to `['http://localhost', 'http://127.0.0.1']`.
- In `src/auth/provider.ts`, removed special-case hostname bypass for Google so all non-loopback URIs follow standard prefix matching against allowed entries.
- In `src/auth/provider.ts`, updated omitted `token_endpoint_auth_method` to default to `'client_secret_basic'` per RFC 7591 §2.
- Created `src/auth/registration.ts` exporting `parseList`, `normalizeRegistrationBody`, and `extractCandidateRedirectUris`, simplifying `src/app.ts`.
- In `scripts/setup-wizard.sh`, updated Gemini preset to base `https://oauth-redirect.googleusercontent.com/`, explicitly surfaced Claude Web, refactored `join_by` parameter names (`delim`, `first_item`), and only pre-selected Gemini when upgrading from true loopback-only configurations.
- Documented decisions in `docs/adr/0009-explicit-env-redirect-allowlist-and-registration-resilience.md` and added reciprocal amendment notes to ADR-0007 and ADR-0008.
- All 15 test suites and 142 tests passing cleanly.
