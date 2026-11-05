# Support Both Public and Confidential Clients in Dynamic Client Registration

> **Status**: Accepted (Amends [ADR-0007](0007-dynamic-client-registration.md))

## Context

ADR 0007 provided an RFC 7591 dynamic client registration endpoint (`/register`) that enforced public-client-only authentication (`token_endpoint_auth_method: 'none'`). However, cloud-hosted AI client backends (specifically Google Gemini's OpenAuth service in Gemini Connected Apps) register as confidential clients expecting an auto-generated client secret and authenticating token exchanges via `client_secret_post` or `client_secret_basic`. Enforcing `none` caused Google's registration to be rejected with HTTP 400.

## Decision

1. **Dual Client Support in Dynamic Registration**:
   - Support both public clients (`token_endpoint_auth_method: 'none'`) and confidential clients (`client_secret_post` and `client_secret_basic`, or omitted which defaults to confidential per RFC 7591 §2).
   - For confidential clients, generate a 32-byte cryptographically secure random hexadecimal `client_secret` and persist it with the client record in `/data/oauth-tokens.json`.
   - For public clients, enforce `client_secret: undefined`.
   - Reject unsupported client authentication methods (e.g. `tls_client_auth`) with HTTP 400 `invalid_client_metadata`.

2. **Client Authentication at `/token` and `/revoke`**:
   - Confidential clients must authenticate using their registered `client_secret`, either in the form-encoded request body (`client_secret_post`) or via an HTTP Basic Authorization header (`client_secret_basic`).
   - If both an Authorization header and body credentials are provided conflictingly, reject multiple authentication methods per RFC 6749 §2.3.
   - Public clients and unregistered on-the-fly PKCE clients continue to authenticate with `token_endpoint_auth_method: 'none'` without a secret.

3. **Metadata Advertising**:
   - RFC 8414 metadata at `/.well-known/oauth-authorization-server` advertises `['none', 'client_secret_post', 'client_secret_basic']` for both `token_endpoint_auth_methods_supported` and `revocation_endpoint_auth_methods_supported`.
