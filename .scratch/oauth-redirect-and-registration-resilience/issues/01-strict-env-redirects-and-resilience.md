# 01: Strict Env Redirects, Wizard Auto-population, and Registration Resilience

Status: ready-for-agent

## Overview

Implement the decisions established in `.scratch/oauth-redirect-and-registration-resilience/spec.md`:
1. Keep default `OAUTH_ALLOWED_REDIRECT_URIS` in code strictly loopback-only (`http://localhost`, `http://127.0.0.1`), requiring remote URLs to come from `.env`.
2. Standardize Google Gemini's redirect URI to base `https://oauth-redirect.googleusercontent.com/` in `.env.example`, setup wizard, and tests, removing the domain-level code bypass in `isAllowedRedirectUri`.
3. In `scripts/setup-wizard.sh`, use the agent multiselect pattern to auto-populate `OAUTH_ALLOWED_REDIRECT_URIS` based on chosen AI clients, including when upgrading existing configurations. Rename helper parameters (`join_by`).
4. Set `client_secret_basic` as default `token_endpoint_auth_method` when omitted in dynamic client registration (RFC 7591 §2).
5. Extract registration request normalization to `src/auth/registration.ts`, deduplicating list parsing and simplifying `src/app.ts`.
6. Write ADR-0009 documenting these changes.
7. Bump version to 0.4.4, verify all tests pass, and publish.
