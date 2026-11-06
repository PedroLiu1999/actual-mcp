# Spec: Public Endpoint Security Hardening

Status: ready-for-agent

## Problem Statement

The MCP server exposes several public and OAuth 2.1 endpoints to the internet so that AI clients like Google Gemini and Claude Web can connect to the operator's self-hosted Target Budget. A recent security review revealed multiple vulnerabilities and hardening gaps across these endpoints:

1. Dynamic client registration accepts unauthenticated requests without rate limiting, bounding of total client registrations, or asynchronous I/O isolation, creating a Denial of Service attack vector that can freeze the server event loop and exhaust host disk space.
2. The administrative consent page lacks framing protection headers (`X-Frame-Options` and `Content-Security-Policy: frame-ancestors`), exposing the admin passphrase prompt to Clickjacking and UI redressing attacks.
3. The unauthenticated health check endpoint discloses the internal Target Budget Sync ID to any internet observer.
4. Token exchange and revocation endpoints lack rate limiting, allowing unbounded automated requests against cryptographic operations.
5. Unexchanged authorization codes are retained in server memory indefinitely until process restart.

These gaps expose the operator's self-hosted server to availability disruption, credential coercion, and unnecessary metadata disclosure.

## Solution

Harden all public HTTP endpoints by implementing defense-in-depth protections across the server:

1. Protect dynamic client registration by enforcing strict IP-based rate limiting, setting an upper bound on total registered clients in persistent storage, and preventing event loop starvation during state persistence.
2. Enforce global HTTP security headers that disallow frame embedding (`X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`) and block MIME type sniffing (`X-Content-Type-Options: nosniff`).
3. Sanitize the unauthenticated health endpoint to report operational readiness and synchronization timestamps without revealing the Target Budget's internal Sync ID.
4. Apply IP-based rate limiting to token issuance and token revocation routes.
5. Automatically prune expired authorization codes from memory to prevent unbounded memory growth over long server uptimes.

## User Stories

1. As a budget owner, I want the dynamic client registration endpoint to be strictly rate limited, so that automated attackers cannot flood the server with registration requests.
2. As a budget owner, I want the server to enforce a maximum cap on registered OAuth clients, so that malicious actors cannot exhaust my host disk storage with arbitrary client registrations.
3. As a budget owner, I want client persistence to be non-blocking, so that registration activity does not stall concurrent MCP tool execution.
4. As a budget owner, I want the administrative authorization page to forbid iframe embedding, so that malicious websites cannot execute Clickjacking attacks against my admin passphrase.
5. As a budget owner, I want all server responses to include MIME-sniffing protection headers, so that user browsers do not misinterpret served assets.
6. As a budget owner, I want the public health check endpoint to omit my Target Budget Sync ID, so that unauthorized internet scanners cannot discover my private budget identifier.
7. As a budget owner, I want the public health check endpoint to continue reporting whether the Target Budget is ready and when it was last synced, so that container health probes and uptime monitors work reliably.
8. As a budget owner, I want token exchange requests to be rate limited, so that attackers cannot launch denial-of-service floods against cryptographic exchange routines.
9. As a budget owner, I want token revocation requests to be rate limited, so that automated callers cannot flood the revocation handler and trigger excessive disk writes.
10. As a budget owner, I want unexchanged or abandoned authorization codes to be purged from memory once expired, so that server memory remains stable during extended runtimes.
11. As an AI client connecting over OAuth 2.1, I want valid dynamic client registrations within normal limits to complete smoothly, so that I can establish a connection to the server.
12. As an AI client renewing an access token, I want standard token refreshes to proceed without rate limit interference during normal operation, so that ongoing budget tool calls are never interrupted.
13. As an operator running the server behind a reverse proxy, I want rate limit headers to accurately inform legitimate clients of their remaining quotas, so that client applications can back off gracefully.

## Implementation Decisions

1. **Dynamic Client Registration Protections**:
   - Apply a dedicated rate limiter to the client registration route (5 registration attempts per 15-minute window per IP).
   - Enforce a maximum cap on registered clients in the persistent store (maximum 20 active clients). When the cap is reached, reject further dynamic registrations with an RFC-compliant registration error indicating that the client registration limit has been reached.
   - Log registration attempts with sanitized metadata and avoid logging unbounded raw request bodies.

2. **HTTP Security Headers Middleware**:
   - Register a global Express middleware that sets defensive security headers across all routes:
     - `X-Frame-Options: DENY`
     - `Content-Security-Policy: frame-ancestors 'none'`
     - `X-Content-Type-Options: nosniff`
   - These headers protect both the interactive HTML consent interface and API responses from embedding and MIME confusion.

3. **Public Health Endpoint Sanitization**:
   - Modify the health route handler to return an operational readiness object containing only `ready` (boolean) and `lastSyncedAt` (ISO timestamp string or null).
   - Completely remove the Target Budget `syncId` field from the unauthenticated payload.

4. **Token Route Rate Limiting**:
   - Apply a dedicated rate limiter to the token exchange route and token revocation route (30 requests per minute per IP), preventing abuse while providing generous headroom for normal tool traffic and refresh flows.

5. **Authorization Code Lifecycle and Memory Pruning**:
   - Add proactive eviction of expired authorization codes whenever a new code is created or looked up, ensuring that records older than the 10-minute code lifetime are immediately purged from in-memory maps.

## Testing Decisions

- **Testing Seam**: All protections will be tested through the existing single highest seam: the HTTP application seam using integration tests with an in-memory budget gateway stub and temporary storage directories.
- **Behavioral Assertions**:
  - Verify that exceeding the dynamic client registration rate limit returns HTTP 429 Too Many Requests with standard rate limit headers.
  - Verify that attempting to register more than the maximum permitted number of clients returns an appropriate client registration rejection.
  - Verify that `GET /authorize` and all API responses include `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, and `X-Content-Type-Options: nosniff`.
  - Verify that `GET /healthz` returns `ready` and `lastSyncedAt` but never includes `syncId`.
  - Verify that `POST /token` and `POST /revoke` enforce rate limits when flooded beyond allowed thresholds.
  - Verify that unexchanged authorization codes older than their expiration timestamp are pruned from memory and cannot be redeemed.
  - Verify that standard end-to-end OAuth 2.1 authorization, code exchange, token refresh, and MCP tool execution continue to succeed under normal usage.
- **Prior Art**: Existing HTTP integration tests in `tests/oauth.test.ts`.

## Out of Scope

- Implementing an external Identity Provider (e.g., Keycloak, Okta) integration.
- Moving the single-tenant token store from a local JSON file to a distributed database like Redis or PostgreSQL.
- Adding CAPTCHA or proof-of-work challenges to the authorization screen.

## Further Notes

All rate limiters must respect the server's proxy trust configuration so that client IP addresses are accurately identified behind standard TLS-terminating reverse proxies.
