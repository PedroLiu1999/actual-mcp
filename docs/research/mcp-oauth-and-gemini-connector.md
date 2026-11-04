# MCP Authorization (OAuth 2.1), Streamable HTTP Transport (`@modelcontextprotocol/sdk`), and Google Gemini Custom MCP Connector Requirements

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [MCP Specification: Authorization (OAuth 2.1, RFC 9728, RFC 8414, RFC 8707)](#2-mcp-specification-authorization-oauth-21-rfc-9728-rfc-8414-rfc-8707)
   - [2.1 Architectural Roles & Standards Profile](#21-architectural-roles--standards-profile)
   - [2.2 Step-by-Step Discovery & Authorization Code + PKCE Flow](#22-step-by-step-discovery--authorization-code--pkce-flow)
   - [2.3 RFC 9728 Protected Resource Metadata (`/.well-known/oauth-protected-resource`)](#23-rfc-9728-protected-resource-metadata-well-knownoauth-protected-resource)
   - [2.4 RFC 8414 Authorization Server Metadata (`/.well-known/oauth-authorization-server`)](#24-rfc-8414-authorization-server-metadata-well-knownoauth-authorization-server)
   - [2.5 Pre-Configured `Client ID` & `Client Secret` vs. DCR & CIMD](#25-pre-configured-client-id--client-secret-vs-dcr--cimd)
   - [2.6 RFC 8707 Resource Indicators & Token Validation Requirements](#26-rfc-8707-resource-indicators--token-validation-requirements)
3. [`@modelcontextprotocol/sdk` (TypeScript) Server Auth & Streamable HTTP Transport](#3-modelcontextprotocolsdk-typescript-server-auth--streamable-http-transport)
   - [3.1 Exact Subpath Exports & Import Paths](#31-exact-subpath-exports--import-paths)
   - [3.2 `server/auth`: `mcpAuthRouter`, `mcpAuthMetadataRouter`, `OAuthServerProvider`, and `requireBearerAuth`](#32-serverauth-mcpauthrouter-mcpauthmetadatarouter-oauthserverprovider-and-requirebearerauth)
   - [3.3 Built-In Handler & Middleware Nuances (Critical Implementation Details)](#33-built-in-handler--middleware-nuances-critical-implementation-details)
   - [3.4 `StreamableHTTPServerTransport`: Stateful vs. Stateless Session Handling](#34-streamablehttpservertransport-stateful-vs-stateless-session-handling)
   - [3.5 Running Behind a Reverse Proxy / Cloudflare Tunnel](#35-running-behind-a-reverse-proxy--cloudflare-tunnel)
4. [Google Gemini Custom Connected Apps / MCP Server Connector Requirements](#4-google-gemini-custom-connected-apps--mcp-server-connector-requirements)
   - [4.1 Gemini Connection Surfaces ("Connect to an MCP server" Modal, Developer Mode, Connected Console)](#41-gemini-connection-surfaces-connect-to-an-mcp-server-modal-developer-mode-connected-console)
   - [4.2 Protocol Version & Transport Constraints](#42-protocol-version--transport-constraints)
   - [4.3 OAuth 2.1 Discovery & Metadata Requirements in Gemini](#43-oauth-21-discovery--metadata-requirements-in-gemini)
   - [4.4 Required Redirect URIs & Wildcard Caveats](#44-required-redirect-uris--wildcard-caveats)
   - [4.5 Token Refresh & Persistent Linking (No Refresh Token Rotation)](#45-token-refresh--persistent-linking-no-refresh-token-rotation)
   - [4.6 Network, Headers, Domain Verification, and Cloudflare Tunnel Considerations](#46-network-headers-domain-verification-and-cloudflare-tunnel-considerations)
5. [Primary Sources Reference List](#5-primary-sources-reference-list)

---

## 1. Executive Summary

- **MCP Authorization Architecture**: Since specification revision `2025-06-18` (and continuing through `2025-11-25` and `2026-07-28`), an HTTP-based MCP server acts as an **OAuth 2.1 Resource Server (RS)** that advertises its trusted **Authorization Server(s) (AS)** via **RFC 9728 OAuth 2.0 Protected Resource Metadata** (`/.well-known/oauth-protected-resource`) ([MCP Spec 2025-11-25 Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)). The Authorization Server may be co-hosted on the same Express/HTTP server (using `mcpAuthRouter`) or separated into an external identity provider (using `mcpAuthMetadataRouter`).
- **Pre-Registered `Client ID` & `Client Secret` Flow**: Both the MCP specification ([MCP Spec 2025-11-25 Client Registration](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#preregistration)) and Google Gemini's custom MCP connector ([Gemini Apps Help: Connect & manage custom apps](https://support.google.com/gemini/answer/17209137?hl=en), [Gemini Developer Mode Usage](https://developers.google.com/connected-apps/mcp/dev-mode/usage)) explicitly support static pre-registered `Client ID` and `Client Secret` credentials entered by the user under **Additional settings / Advanced features > Show more** when Dynamic Client Registration (RFC 7591) is not used or when the operator wants to restrict access to a single pre-configured client.
- **`@modelcontextprotocol/sdk` (`v1.32.2`) Capabilities & Gotchas**:
  - `mcpAuthRouter` mounts `/authorize`, `/token`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource[/<path>]`, and optionally `/register` (only if `provider.clientsStore.registerClient` is defined) and `/revoke` (only if `provider.revokeToken` is defined) ([`src/server/auth/router.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/router.ts)).
  - **Client Authentication Gotcha**: The SDK's built-in `authenticateClient` middleware ([`src/server/auth/middleware/clientAuth.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/middleware/clientAuth.ts)) and metadata (`token_endpoint_auth_methods_supported: ['client_secret_post', 'none']`) only parse `client_id` and `client_secret` from the `application/x-www-form-urlencoded` POST body (`client_secret_post`). If an OAuth client sends credentials via `Authorization: Basic ...` (`client_secret_basic`) without body fields, a tiny pre-middleware normalizing Basic Auth into `req.body.client_id` / `req.body.client_secret` prevents `InvalidRequestError` failures.
  - **Protected Resource Metadata Path Gotcha**: `mcpAuthMetadataRouter` mounts `/.well-known/oauth-protected-resource${rsPath}` (e.g., `/.well-known/oauth-protected-resource/mcp` when `resourceServerUrl` is `https://example.com/mcp`) ([`src/server/auth/router.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/router.ts)). Because some clients (including Google's validator) also probe root `/.well-known/oauth-protected-resource` ([MCP Spec 2025-11-25 Discovery](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#protected-resource-metadata-discovery-requirements), [Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting)), serving the JSON document at **both** `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource` guarantees compatibility.
  - **DNS Rebinding / `Host` Header Gotcha**: `createMcpExpressApp()` defaults to `host: '127.0.0.1'` and automatically installs `localhostHostValidation()`, which rejects any request whose `Host` header is not `localhost`, `127.0.0.1`, or `[::1]` with `HTTP 403 Invalid Host` ([`src/server/express.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/express.ts), [`src/server/middleware/hostHeaderValidation.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/middleware/hostHeaderValidation.ts)). Behind Cloudflare Tunnel, `Host` is your public tunnel hostname, so you must either pass `allowedHosts: ['your-domain.example.com', 'localhost', '127.0.0.1']` or use a standard `express()` app.
- **Google Gemini Connector Specifics**:
  - Supports **Streamable HTTP** (`2025-03-26` up to `2025-11-25`; legacy `2024-11-05` HTTP+SSE is rejected) ([Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization)).
  - Sends `User-Agent: Google` and `Accept: application/json, text/event-stream` on JSON-RPC `POST` requests ([Google MCP Flow](https://developers.google.com/connected-apps/mcp/mcp-flow), [Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization)).
  - Uses OAuth Redirect URIs under `https://oauth-redirect.googleusercontent.com/r/*`, `https://oauth-redirect-sandbox.googleusercontent.com/r/*`, `https://oauth-redirect-test.googleusercontent.com/r/*`, `https://oauth-redirect.googleusercontent.com/a/*`, `https://oauth-redirect-sandbox.googleusercontent.com/a/*`, and `https://oauth-redirect-test.googleusercontent.com/a/*` (plus `https://vertexaisearch.cloud.google.com/oauth-redirect` for Vertex AI / Gemini Enterprise) ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth), [Google Cloud Blog: Developer's Guide to MCP Apps in Gemini](https://cloud.google.com/blog/topics/developers-practitioners/devs-guide-to-mcp-apps-in-gemini)).
  - **Persistent Linking Requirement**: On `grant_type=refresh_token`, Google explicitly instructs servers **not** to rotate the refresh token, but instead to return a new access token alongside the **exact same refresh token** (and extend its backend expiry) ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)).

---

## 2. MCP Specification: Authorization (OAuth 2.1, RFC 9728, RFC 8414, RFC 8707)

### 2.1 Architectural Roles & Standards Profile

The Model Context Protocol defines transport-level authorization for HTTP-based transports (`Streamable HTTP`) using a curated subset of IETF OAuth specifications ([MCP Spec 2025-11-25 Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [MCP Spec 2025-06-18 Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)):

- **Roles**:
  - **MCP Server**: Acts as an **OAuth 2.1 Resource Server (RS)** ([`draft-ietf-oauth-v2-1-13` Section 1.1](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13#name-roles)) that accepts and responds to protected resource requests using bearer access tokens.
  - **MCP Client**: Acts as an **OAuth 2.1 Client** making protected resource requests on behalf of a resource owner.
  - **Authorization Server (AS)**: Interacts with the user and issues access tokens for the MCP server. The AS may be co-located within the MCP server process or deployed as a separate service ([MCP Spec 2025-11-25 Roles](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#roles)).
- **Core Standards**:
  - **OAuth 2.1 Draft** ([`draft-ietf-oauth-v2-1-13`](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13))
  - **OAuth 2.0 Protected Resource Metadata (PRM)** ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728))
  - **OAuth 2.0 Authorization Server Metadata** ([RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)) and **OpenID Connect Discovery 1.0** ([OIDC Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html))
  - **Resource Indicators for OAuth 2.0** ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html))
  - **OAuth 2.0 Dynamic Client Registration Protocol (DCR)** ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591))
  - **OAuth Client ID Metadata Documents (CIMD)** ([`draft-ietf-oauth-client-id-metadata-document-00`](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00), added in `2025-11-25`)

> **Evolution Note (`2025-03-26` vs. `2025-06-18` / `2025-11-25`)**: In the initial `2025-03-26` spec ([MCP Spec 2025-03-26 Authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)), the MCP server acted directly as the Authorization Server at root `/.well-known/oauth-authorization-server` with fallback paths `/authorize`, `/token`, and `/register`. Starting in `2025-06-18` ([MCP Spec 2025-06-18 Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)) and `2025-11-25` ([MCP Spec 2025-11-25 Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)), RFC 9728 (`/.well-known/oauth-protected-resource`) and RFC 8707 (`resource` parameter) became **MUST** requirements.

### 2.2 Step-by-Step Discovery & Authorization Code + PKCE Flow

Per [MCP Spec 2025-11-25 Authorization Flow Steps](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-flow-steps):

1. **Unauthenticated Request & `401` Challenge**:
   The MCP client sends an HTTP request without an `Authorization` header to the MCP endpoint (e.g., `POST /mcp`). The MCP server responds with `HTTP 401 Unauthorized` and a `WWW-Authenticate` header containing `resource_metadata` (and optionally `scope`):
   ```http
   HTTP/1.1 401 Unauthorized
   WWW-Authenticate: Bearer error="invalid_token",
                            error_description="Missing Authorization header",
                            resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
                            scope="mcp:tools"
   ```
   ([MCP Spec 2025-11-25 Protected Resource Metadata Discovery](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#protected-resource-metadata-discovery-requirements), [RFC 9728 Section 5.1](https://datatracker.ietf.org/doc/html/rfc9728#name-www-authenticate-response)).
2. **Protected Resource Metadata Discovery (RFC 9728)**:
   The client fetches the `resource_metadata` URL from the `WWW-Authenticate` header, or if absent, probes:
   1. Path-inserted well-known URI: `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`
   2. Root well-known URI: `https://mcp.example.com/.well-known/oauth-protected-resource`
   ([MCP Spec 2025-11-25 Protected Resource Metadata Discovery](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#protected-resource-metadata-discovery-requirements)).
3. **Authorization Server Metadata Discovery (RFC 8414 / OIDC)**:
   From the `authorization_servers` array in the Protected Resource Metadata, the client selects an issuer URL and fetches its Authorization Server Metadata (`/.well-known/oauth-authorization-server` or `/.well-known/openid-configuration`) ([MCP Spec 2025-11-25 AS Metadata Discovery](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-server-metadata-discovery)).
4. **Client Identification**:
   The client uses pre-registered client credentials (`client_id` / `client_secret`), Client ID Metadata Documents (CIMD), or Dynamic Client Registration (`POST /register`) ([MCP Spec 2025-11-25 Client Registration Approaches](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches)).
5. **Authorization Request with PKCE (`S256`) + Resource Indicator**:
   The client verifies that `code_challenge_methods_supported` includes `"S256"` ([MCP Spec 2025-11-25 Authorization Code Protection](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-code-protection)), generates a PKCE `code_verifier` and `code_challenge`, and redirects the user's browser to `authorization_endpoint` with:
   - `response_type=code`
   - `client_id=<client_id>`
   - `redirect_uri=<callback_url>`
   - `code_challenge=<s256_hash>`
   - `code_challenge_method=S256`
   - `state=<opaque_state>`
   - `resource=<canonical_mcp_server_uri>` (RFC 8707)
   - `scope=<selected_scopes>`
6. **User Consent & Code Callback**:
   After authenticating the resource owner and obtaining consent, the AS redirects the user-agent back to `redirect_uri?code=<auth_code>&state=<opaque_state>`.
7. **Token Exchange (`POST /token`)**:
   The client sends an `application/x-www-form-urlencoded` `POST` request to `token_endpoint` with:
   - `grant_type=authorization_code`
   - `code=<auth_code>`
   - `code_verifier=<code_verifier>`
   - `redirect_uri=<callback_url>`
   - `client_id=<client_id>` (and `client_secret=<client_secret>` for confidential clients)
   - `resource=<canonical_mcp_server_uri>`
8. **Authenticated MCP Requests**:
   The client sends `Authorization: Bearer <access_token>` on **every** HTTP request (`POST`, `GET`, `DELETE`) to the MCP server, even within the same logical session. Access tokens **MUST NOT** be sent in URI query strings ([MCP Spec 2025-11-25 Access Token Usage](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#access-token-usage)).

### 2.3 RFC 9728 Protected Resource Metadata (`/.well-known/oauth-protected-resource`)

Per [MCP Spec 2025-11-25 Authorization Server Location](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-server-location) and [RFC 9728 Section 2](https://datatracker.ietf.org/doc/html/rfc9728#section-2), the Protected Resource Metadata JSON document returned by the MCP server **MUST** include `resource` and `authorization_servers` (with at least one issuer URL):

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://mcp.example.com/"
  ],
  "scopes_supported": [
    "mcp:tools"
  ],
  "bearer_methods_supported": [
    "header"
  ],
  "resource_name": "Actual Budget MCP Server"
}
```

### 2.4 RFC 8414 Authorization Server Metadata (`/.well-known/oauth-authorization-server`)

Per [MCP Spec 2025-11-25 AS Metadata Discovery](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-server-metadata-discovery) and [RFC 8414 Section 2](https://datatracker.ietf.org/doc/html/rfc8414#section-2):

- For an issuer URL **without** a path component (`https://auth.example.com`), clients query:
  1. `https://auth.example.com/.well-known/oauth-authorization-server`
  2. `https://auth.example.com/.well-known/openid-configuration`
- For an issuer URL **with** a path component (`https://auth.example.com/tenant1`), MCP clients try in priority order:
  1. `https://auth.example.com/.well-known/oauth-authorization-server/tenant1` (RFC 8414 path insertion)
  2. `https://auth.example.com/.well-known/openid-configuration/tenant1`
  3. `https://auth.example.com/tenant1/.well-known/openid-configuration` (OIDC path appending)
- **Mandatory PKCE Metadata Check**: Per [MCP Spec 2025-11-25 Authorization Code Protection](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-code-protection), if `code_challenge_methods_supported` is absent from the AS metadata response, MCP clients **MUST** refuse to proceed.

### 2.5 Pre-Configured `Client ID` & `Client Secret` vs. DCR & CIMD

In [MCP Spec 2025-11-25 Client Registration Approaches](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches) (and [MCP Spec 2026-07-28 Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)), client registration follows a strict priority order:

1. **Pre-registered client information** (highest priority if configured by the user or client):
   > "1. Use pre-registered client information for the server if the client has it available"
   > "MCP clients **SHOULD** support an option for static client credentials such as those supplied by a preregistration flow. This could be: 1. Hardcode a client ID (and, if applicable, client credentials)... or 2. Present a UI to users that allows them to enter these details, after registering an OAuth client themselves" ([MCP Spec 2025-11-25 Preregistration](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#preregistration)).
2. **Client ID Metadata Documents (CIMD)** (if `client_id_metadata_document_supported: true` in AS metadata).
3. **Dynamic Client Registration (RFC 7591)** (if `registration_endpoint` is present in AS metadata; note that in `2026-07-28` DCR is marked deprecated in favor of CIMD/pre-registration, though still used by clients like Google Gemini when pre-registered credentials are not supplied).
4. **Prompt user to enter client credentials**.

When a user enters a pre-configured `Client ID` and `Client Secret` in Gemini's **"Connect to an MCP server"** modal (under **Additional settings > Show more** / **Advanced features > Show more**):
- The client skips Dynamic Client Registration (`POST /register`).
- Still performs Protected Resource Metadata (`/.well-known/oauth-protected-resource`) and Authorization Server Metadata (`/.well-known/oauth-authorization-server`) discovery to find `authorization_endpoint` and `token_endpoint` ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth), [Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting)).
- Initiates the Authorization Code + PKCE (`S256`) flow at `authorization_endpoint` using the pre-configured `client_id`, and authenticates at `token_endpoint` using both `client_id` and `client_secret` ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)).

### 2.6 RFC 8707 Resource Indicators & Token Validation Requirements

Per [MCP Spec 2025-11-25 Resource Parameter Implementation](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#resource-parameter-implementation) and [Access Token Privilege Restriction](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#access-token-privilege-restriction):

- **Client Requirement**: MCP clients **MUST** send the `resource` parameter in both authorization requests (`GET /authorize`) and token requests (`POST /token`), set to the canonical URI of the MCP server (e.g., `https://mcp.example.com/mcp` or `https://mcp.example.com`, without a fragment and preferably without a trailing slash unless semantically significant) ([RFC 8707 Section 2](https://www.rfc-editor.org/rfc/rfc8707.html#section-2)).
- **Server Requirement**: MCP servers **MUST** validate inbound access tokens ([OAuth 2.1 Section 5.2](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13#section-5.2)), verify expiration, and verify that the token was issued specifically for them as the intended audience/resource. Invalid or expired tokens **MUST** receive `HTTP 401 Unauthorized` with a `WWW-Authenticate` header; insufficient scopes **SHOULD** receive `HTTP 403 Forbidden` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="..."` ([MCP Spec 2025-11-25 Error Handling](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#error-handling)).

---

## 3. `@modelcontextprotocol/sdk` (TypeScript) Server Auth & Streamable HTTP Transport

All findings below are verified directly against `@modelcontextprotocol/sdk` **`v1.32.2`** (`gitHead: 3b73021a0a2272c0c04c3917bcdb03398b3ec63f`, [`modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk/tree/3b73021a0a2272c0c04c3917bcdb03398b3ec63f)), whose `LATEST_PROTOCOL_VERSION` is `'2025-11-25'` and `SUPPORTED_PROTOCOL_VERSIONS` are `['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']` ([`src/types.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/types.ts)).

### 3.1 Exact Subpath Exports & Import Paths

In `@modelcontextprotocol/sdk/package.json` ([`package.json`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/package.json#L21-L67)), `"./*"` maps to `"./dist/esm/*"` (ESM) and `"./dist/cjs/*"` (CJS). The exact TypeScript import paths are:

```typescript
// High-level MCP Server & Express helper
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  hostHeaderValidation,
  localhostHostValidation,
} from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';

// Streamable HTTP Transports
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
  type EventStore,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  WebStandardStreamableHTTPServerTransport,
  type WebStandardStreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

// OAuth Routers & Metadata Helpers
import {
  mcpAuthRouter,
  mcpAuthMetadataRouter,
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  type AuthRouterOptions,
  type AuthMetadataOptions,
} from '@modelcontextprotocol/sdk/server/auth/router.js';

// OAuth Provider & Client Store Interfaces
import {
  type OAuthServerProvider,
  type OAuthTokenVerifier,
  type AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  type OAuthRegisteredClientsStore,
} from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  type AuthInfo,
} from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  ProxyOAuthServerProvider,
  type ProxyOptions,
} from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';

// Bearer Auth & Client Auth Middleware
import {
  requireBearerAuth,
  type BearerAuthMiddlewareOptions,
} from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  authenticateClient,
  type ClientAuthMiddlewareOptions,
} from '@modelcontextprotocol/sdk/server/auth/middleware/clientAuth.js';

// OAuth Error Classes
import {
  OAuthError,
  InvalidRequestError,
  InvalidClientError,
  InvalidGrantError,
  UnauthorizedClientError,
  UnsupportedGrantTypeError,
  InvalidScopeError,
  AccessDeniedError,
  ServerError,
  InvalidTokenError,
  InsufficientScopeError,
  InvalidTargetError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

// Shared Auth Schemas, Types & Resource URI Utilities
import {
  type OAuthClientInformationFull,
  type OAuthClientMetadata,
  type OAuthTokens,
  type OAuthMetadata,
  type OAuthProtectedResourceMetadata,
  type OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  resourceUrlFromServerUrl,
  checkResourceAllowed,
} from '@modelcontextprotocol/sdk/shared/auth-utils.js';
```

### 3.2 `server/auth`: `mcpAuthRouter`, `mcpAuthMetadataRouter`, `OAuthServerProvider`, and `requireBearerAuth`

#### 1. `OAuthServerProvider` and `OAuthRegisteredClientsStore`
Defined in [`src/server/auth/provider.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/provider.ts) and [`src/server/auth/clients.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/clients.ts):

```typescript
export type AuthorizationParams = {
  state?: string;
  scopes?: string[];
  codeChallenge: string;
  redirectUri: string;
  resource?: URL;
};

export interface OAuthRegisteredClientsStore {
  getClient(
    clientId: string
  ): OAuthClientInformationFull | undefined | Promise<OAuthClientInformationFull | undefined>;

  /**
   * Optional: If unimplemented, dynamic client registration (/register) is disabled.
   */
  registerClient?(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): OAuthClientInformationFull | Promise<OAuthClientInformationFull>;
}

export interface OAuthServerProvider {
  get clientsStore(): OAuthRegisteredClientsStore;

  authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void>;

  challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string>;

  exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens>;

  exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens>;

  verifyAccessToken(token: string): Promise<AuthInfo>;

  revokeToken?(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void>;

  skipLocalPkceValidation?: boolean;
}
```

And `AuthInfo` ([`src/server/auth/types.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/types.ts)):
```typescript
export interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  /** When the token expires (in seconds since epoch). REQUIRED by requireBearerAuth! */
  expiresAt?: number;
  /** The RFC 8707 resource server identifier for which this token is valid. */
  resource?: URL;
  extra?: Record<string, unknown>;
}
```

#### 2. `mcpAuthRouter(options: AuthRouterOptions)`
Defined in [`src/server/auth/router.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/router.ts). Must be mounted at the Express application root (`app.use(mcpAuthRouter(...))`). It automatically registers:
- `GET` & `POST /authorize` (`authorizationHandler`)
- `POST /token` (`tokenHandler`, with `cors()` and `express.urlencoded({ extended: false })`)
- `GET /.well-known/oauth-authorization-server` (`metadataHandler`, with `cors()`)
- `GET /.well-known/oauth-protected-resource${rsPath === '/' ? '' : rsPath}` (`metadataHandler`, with `cors()`, where `rsPath` comes from `resourceServerUrl ?? baseUrl ?? issuerUrl`)
- `POST /register` (`clientRegistrationHandler`, **only if** `provider.clientsStore.registerClient` is defined)
- `POST /revoke` (`revocationHandler`, **only if** `provider.revokeToken` is defined)

`createOAuthMetadata` constructs the RFC 8414 metadata document with:
- `response_types_supported: ['code']`
- `code_challenge_methods_supported: ['S256']`
- `token_endpoint_auth_methods_supported: ['client_secret_post', 'none']`
- `grant_types_supported: ['authorization_code', 'refresh_token']`

#### 3. `requireBearerAuth(options: BearerAuthMiddlewareOptions)`
Defined in [`src/server/auth/middleware/bearerAuth.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/middleware/bearerAuth.ts).
- Extracts `Authorization: Bearer <token>`.
- Calls `verifier.verifyAccessToken(token)` (which `OAuthServerProvider` implements directly).
- If `expectedResource` is set, compares `authInfo.resource` against `expectedResource` (ignoring `#fragment` and a single trailing `/`); throws `InvalidTokenError` (`401`) if mismatched.
- Checks `requiredScopes` against `authInfo.scopes`; throws `InsufficientScopeError` (`403`) if missing.
- **Expiration Requirement**: Checks `typeof authInfo.expiresAt !== 'number' || isNaN(authInfo.expiresAt)` — if `expiresAt` is missing or not a Unix timestamp in **seconds** (`Date.now() / 1000`), `requireBearerAuth` throws `InvalidTokenError('Token has no expiration time')` (`401`)!
- Sets `req.auth = authInfo`, which `StreamableHTTPServerTransport.handleRequest(req, res, req.body)` automatically reads from `req.auth` and forwards to tool handlers as `extra.authInfo` ([`src/server/streamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/streamableHttp.ts#L131-L139)).
- On `401` or `403`, sets `WWW-Authenticate: Bearer error="...", error_description="..."[, scope="..."][, resource_metadata="..."]`.

### 3.3 Built-In Handler & Middleware Nuances (Critical Implementation Details)

Inspecting the SDK source files reveals six critical implementation details when building a self-contained OAuth 2.1 MCP server with pre-registered `Client ID` and `Client Secret`:

1. **Pre-Registered Client Without DCR vs. Google's Discovery Check**:
   - In `clients.d.ts`, `registerClient` is optional. If omitted on `clientsStore`, `createOAuthMetadata` omits `registration_endpoint` and `mcpAuthRouter` does not mount `/register`.
   - **However**, Google's OAuth 2.1 guide notes under *Common integration errors*:
     > *"Missing registration endpoint: Even if your server supports Client ID Metadata Documents, the Gemini app (acting as the OAuth client connecting to your server) currently requires a dedicated `registration_endpoint` to be present in the discovery JSON."* ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)).
   - Meanwhile, when using pre-registered `Client ID` and `Client Secret`, `clientsStore.getClient(clientId)` can return the pre-configured `OAuthClientInformationFull` object. If you also want `registration_endpoint` to appear in `/.well-known/oauth-authorization-server` to satisfy strict discovery validators, you can either implement `registerClient` (if DCR is desired) or ensure `registration_endpoint` is advertised while pre-populating `clientsStore` with your static `Client ID` and `Client Secret`.
2. **`client_secret_post` vs. `client_secret_basic` on `/token` and `/revoke`**:
   - `authenticateClient` in [`src/server/auth/middleware/clientAuth.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/middleware/clientAuth.ts) parses `client_id` and `client_secret` strictly from `req.body` (`ClientAuthenticatedRequestSchema = z.object({ client_id: z.string(), client_secret: z.string().optional() })`).
   - Although `createOAuthMetadata` advertises `token_endpoint_auth_methods_supported: ['client_secret_post', 'none']`, some OAuth 2.0 / 2.1 clients (including standard Google OAuth token-exchange clients when a `Client Secret` is configured) send `Authorization: Basic base64(client_id:client_secret)` per RFC 6749 Section 2.3.1.
   - Adding a lightweight Express middleware before `mcpAuthRouter` on `/token` and `/revoke` that decodes `Authorization: Basic ...` and populates `req.body.client_id` and `req.body.client_secret` (when not already present in `req.body`) ensures both `client_secret_basic` and `client_secret_post` work seamlessly.
3. **Redirect URI Validation in `authorize.js`**:
   - In [`src/server/auth/handlers/authorize.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/handlers/authorize.ts#L17-L37), `redirectUriMatches(requested, registered)` requires an **exact string match** for non-loopback URIs (`requested === registered`). It does **not** expand wildcards (`*`)!
   - When using a pre-registered client in `clientsStore.getClient(clientId)`, if the client's exact callback URL is dynamic (e.g., `https://oauth-redirect.googleusercontent.com/r/<app-id>` or `https://vertexaisearch.cloud.google.com/oauth-redirect`), either:
     - Register the exact redirect URIs in `client.redirect_uris`, **or**
     - Have `clientsStore.getClient(clientId)` return a client object whose `redirect_uris` includes the allowlisted Google callback prefixes/URLs (or dynamically includes a validated `https://oauth-redirect*.googleusercontent.com/...` / `https://vertexaisearch.cloud.google.com/oauth-redirect` URI).
4. **PKCE Validation in `token.js`**:
   - By default (`skipLocalPkceValidation` falsy), `tokenHandler` ([`src/server/auth/handlers/token.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/handlers/token.ts#L66-L73)) calls `provider.challengeForAuthorizationCode(client, code)` and verifies `code_verifier` against `codeChallenge` using `pkce-challenge` (`verifyChallenge`) **before** calling `provider.exchangeAuthorizationCode(...)`.
   - Therefore, `challengeForAuthorizationCode` **must** return the stored `codeChallenge` without deleting the authorization code yet; `exchangeAuthorizationCode` is called immediately afterward and should consume/delete the one-time authorization code.
5. **Protected Resource Metadata Path Mounting (`/.well-known/oauth-protected-resource`)**:
   - In [`src/server/auth/router.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/router.ts#L95-L97), `mcpAuthMetadataRouter` mounts:
     ```javascript
     const rsPath = new URL(options.resourceServerUrl.href).pathname;
     router.use(`/.well-known/oauth-protected-resource${rsPath === '/' ? '' : rsPath}`, metadataHandler(protectedResourceMetadata));
     ```
   - If `resourceServerUrl` is `https://mcp.example.com/mcp`, `mcpAuthRouter` only mounts `/.well-known/oauth-protected-resource/mcp` and returns `404` for root `/.well-known/oauth-protected-resource`.
   - Because Google's Connected Console troubleshooting guide explicitly checks `/.well-known/oauth-protected-resource` ([Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting)), you should also mount a `GET /.well-known/oauth-protected-resource` route returning the same RFC 9728 metadata JSON if `rsPath !== '/'`.
6. **`issuerUrl` HTTPS Enforcement**:
   - `checkIssuerUrl(issuer)` in `router.js` throws `Error('Issuer URL must be HTTPS')` unless `issuer.protocol === 'https:'`, `issuer.hostname === 'localhost'`, `issuer.hostname === '127.0.0.1'`, or `process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL === 'true'`. When running behind Cloudflare Tunnel, pass the public `https://<tunnel-domain>` as `issuerUrl`.

### 3.4 `StreamableHTTPServerTransport`: Stateful vs. Stateless Session Handling

`StreamableHTTPServerTransport` ([`src/server/streamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/streamableHttp.ts)) wraps `WebStandardStreamableHTTPServerTransport` ([`src/server/webStandardStreamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/webStandardStreamableHttp.ts)) using `@hono/node-server`'s `getRequestListener(..., { overrideGlobalObjects: false })`.

#### Request Validation Performed by `StreamableHTTPServerTransport`
- **`POST /mcp`**:
  - Requires `Accept` header to contain **both** `application/json` and `text/event-stream`; otherwise returns `406 Not Acceptable` ([`webStandardStreamableHttp.ts#L470-L473`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/webStandardStreamableHttp.ts#L470-L473)).
  - Requires `Content-Type` media type to be `application/json`; otherwise returns `415 Unsupported Media Type` ([`webStandardStreamableHttp.ts#L475-L479`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/webStandardStreamableHttp.ts#L475-L479)).
  - For non-initialization requests, validates `MCP-Protocol-Version` header if present against `SUPPORTED_PROTOCOL_VERSIONS` (`400 Bad Request` if unsupported).
  - If the POST body contains only JSON-RPC notifications (such as `notifications/initialized`) or responses, returns `202 Accepted` with an empty body.
  - If the POST body contains a JSON-RPC request:
    - By default (`enableJsonResponse: false`), returns `200 OK` with `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`, and arms a keep-alive timer (`keepAliveMs`, default `15000` ms) that writes `: keepalive\n\n` comment frames.
    - If `enableJsonResponse: true`, returns a single `200 OK` `Content-Type: application/json` response once all request responses are ready.

#### Mode A: Stateless Mode (`sessionIdGenerator: undefined`)
In stateless mode ([`src/examples/server/simpleStatelessStreamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/examples/server/simpleStatelessStreamableHttp.ts)):
- **Critical SDK Rule**: A stateless `StreamableHTTPServerTransport` instance **cannot be reused across requests**. In `webStandardStreamableHttp.js` line 176:
  ```javascript
  if (!this.sessionIdGenerator && this._hasHandledRequest) {
      throw new Error('Stateless transport cannot be reused across requests. Create a new transport per request.');
  }
  ```
- Therefore, in stateless mode, **every `POST /mcp` request** creates a fresh `McpServer` (or connects a per-request server instance) and a fresh `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, calls `await server.connect(transport)` and `await transport.handleRequest(req, res, req.body)`, and closes both on `res.on('close', ...)`.
- No `Mcp-Session-Id` header is emitted or checked (`validateSession` returns `undefined` immediately when `sessionIdGenerator === undefined`).
- Even if a client sends `initialize` on request 1 and `tools/list` or `tools/call` on request 2 without a session ID (or with any session ID), `Server` ([`src/server/index.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/index.ts)) does **not** block `tools/list` or `tools/call` on a fresh `McpServer` instance—it executes the handler directly!
- `GET /mcp` and `DELETE /mcp` return `405 Method Not Allowed`, which both the MCP specification ([MCP Spec 2025-11-25 Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server)) and Google's Connected Apps Platform explicitly support:
  > *"GET stream & 405 Method Not Allowed. Clients may attempt an optional `GET` stream on the endpoint for server-to-client notifications. If your server is stateless or request-response only, returning `HTTP 405 Method Not Allowed` is explicitly supported and handled cleanly by the client proxy of the Google applicable product."* ([Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization)).

#### Mode B: Stateful Mode (`sessionIdGenerator: () => randomUUID()`)
In stateful mode ([`src/examples/server/simpleStreamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/examples/server/simpleStreamableHttp.ts)):
- On `POST /mcp` with `isInitializeRequest(req.body)` and no `mcp-session-id` header, the server creates a new `StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (sid) => sessions.set(sid, transport) })`, connects it to `McpServer`, and returns `mcp-session-id: <uuid>` in the response header.
- Subsequent `POST /mcp`, `GET /mcp`, and `DELETE /mcp` requests look up the transport by `req.headers['mcp-session-id']` in the in-memory `sessions` map.
- If a server restarts (e.g., container restart behind Cloudflare Tunnel) while a client still holds an old `Mcp-Session-Id`, the server returns `404 Not Found` (`Session not found`), which per [MCP Spec 2025-11-25 Session Management](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management) instructs the client to re-initialize.

**Why Stateless Mode (or `enableJsonResponse: true` with Stateless Mode) Is Ideal Behind Cloudflare Tunnel for Tool Servers**:
- If your MCP server only exposes tools/resources/prompts and does not initiate unsolicited server-to-client requests (`sampling/createMessage` or `elicitation/create`), **stateless mode** (`sessionIdGenerator: undefined`) eliminates all session-stickiness and server-restart `404` edge cases when accessed through Cloudflare Tunnel or multiple Gemini backend workers.

### 3.5 Running Behind a Reverse Proxy / Cloudflare Tunnel

1. **`Host` Header Validation (`createMcpExpressApp`)**:
   - `createMcpExpressApp()` ([`src/server/express.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/express.ts)) enables `localhostHostValidation()` whenever `host` is `'127.0.0.1'` (the default), `'localhost'`, or `'::1'`.
   - When `cloudflared` forwards requests from `https://mcp.yourdomain.com` to `http://127.0.0.1:3000`, the incoming `Host` header is `mcp.yourdomain.com`. `localhostHostValidation()` will reject every request with `HTTP 403 {"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host: mcp.yourdomain.com"},"id":null}`.
   - **Solution**: Either configure `createMcpExpressApp({ allowedHosts: ['mcp.yourdomain.com', 'localhost', '127.0.0.1'] })` or configure `app.set('trust proxy', 1)` on a standard Express app.
2. **Express `trust proxy` and Rate Limiting (`mcpAuthRouter`)**:
   - `mcpAuthRouter` uses `express-rate-limit` on `/authorize`, `/token`, `/register`, and `/revoke` ([`src/server/auth/handlers/authorize.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/handlers/authorize.ts#L61-L70)).
   - Behind Cloudflare Tunnel, `X-Forwarded-For` and `CF-Connecting-IP` headers are present. Setting `app.set('trust proxy', 1)` in Express prevents `express-rate-limit` from throwing `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` and ensures rate-limiting keys on the client IP rather than `127.0.0.1`.
3. **SSE Buffering & Timeouts**:
   - `WebStandardStreamableHTTPServerTransport` automatically sets `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, and `X-Accel-Buffering: no`, and sends `: keepalive\n\n` every 15 seconds ([`src/server/webStandardStreamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/webStandardStreamableHttp.ts#L82-L105)), preventing Cloudflare's 100-second idle connection timeout during long-running tool calls.

---

## 4. Google Gemini Custom Connected Apps / MCP Server Connector Requirements

### 4.1 Gemini Connection Surfaces ("Connect to an MCP server" Modal, Developer Mode, Connected Console)

Google provides three ways to connect a custom remote MCP server to Gemini:

1. **Gemini Web App — Custom Connected Apps (`Settings > Connected Apps > Add a custom app`)**:
   - Available at `gemini.google.com` for personal Google Accounts (18+, Keep Activity enabled) ([Gemini Apps Help: Connect & manage custom apps](https://support.google.com/gemini/answer/17209137?hl=en)).
   - Users enter the **MCP Server URL** (`https://...`).
   - If the server requires static OAuth credentials rather than Dynamic Client Registration, clicking **Show more** next to **Advanced features** (or **Additional settings > Show more**) reveals inputs for **OAuth Client ID** and **Client secret** ([Gemini Apps Help: Connect & manage custom apps](https://support.google.com/gemini/answer/17209137?hl=en), [Gemini Developer Mode Usage](https://developers.google.com/connected-apps/mcp/dev-mode/usage)).
   - Once connected on the web, the custom connected app is usable on both the Gemini web app and the Gemini mobile app (`@AppName` mentions or natural language) ([Gemini Apps Help: Connect & manage custom apps](https://support.google.com/gemini/answer/17209137?hl=en)).
2. **Gemini Apps Developer Mode (`gemini.google.com/devmode`)**:
   - Interactive split-pane debugging workspace (`Settings > Gemini Apps Developer Mode`) ([Gemini Developer Mode Overview](https://developers.google.com/connected-apps/mcp/dev-mode)).
   - Clicking **+ Create new** opens the **Connect to an MCP server** modal where you enter your public HTTPS **MCP Server URL** and optionally click **Additional settings > Show more** to enter your **OAuth Client ID** and **Client secret** ([Gemini Developer Mode Usage](https://developers.google.com/connected-apps/mcp/dev-mode/usage)).
   - Includes an **Event Log** tab (showing raw JSON-RPC requests/responses, HTTP status codes, latency), **Tool Schemas** tab (with a **Sync schema** button that re-fetches `tools/list` without clearing chat history), **Environment** tab, and **Authentication** tab (switching between Dynamic Client Registration and Manual Client Registration) ([Gemini Developer Mode Usage](https://developers.google.com/connected-apps/mcp/dev-mode/usage)).
3. **Google Connected Console (`/connected-apps/gpc`) & Gemini Enterprise**:
   - Used for publishing Connected Apps across Google products or connecting custom MCP servers in Google Cloud / Gemini Enterprise ([Google Connected Console Guide](https://developers.google.com/connected-apps/gpc/perform-the-steps), [Google Cloud Blog: Developer's Guide to MCP Apps in Gemini](https://cloud.google.com/blog/topics/developers-practitioners/devs-guide-to-mcp-apps-in-gemini)).

### 4.2 Protocol Version & Transport Constraints

Per [Google MCP Connected App Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization):

- **Supported MCP Protocol Versions**: Up to **`2025-11-25`** (`2025-03-26`, `2025-06-18`, `2025-11-25`). Newer draft/2026 specification releases are not yet supported by the Connected Apps Platform ([Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization)).
- **Transport**: Strictly **Streamable HTTP** (`HTTP POST` to a single endpoint, e.g. `https://api.example.com/mcp`, with `Accept: application/json, text/event-stream`). Legacy `2024-11-05` multi-endpoint HTTP+SSE is **not supported** and fails with an HTTP 405 transport error ([Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization), [Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting)).
- **Server Instructions**: Google's validator checks that the `initialize` response includes a non-empty `instructions` field (`McpServer` options `{ instructions: "..." }`), and logs a warning if missing ([Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting)).
- **Tool Output Format**: Because `structuredContent` is not yet supported in the Connected Apps Platform, tools returning structured data should serialize JSON into `TextContent` (`{ type: 'text', text: JSON.stringify(data, null, 2) }`) ([Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization)).
- **Tool Annotations**: Declare `readOnlyHint: true` on read-only tools and `destructiveHint: true` on state-changing/write tools (which triggers Gemini's runtime user confirmation card before execution) ([Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization)).

### 4.3 OAuth 2.1 Discovery & Metadata Requirements in Gemini

Per [Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth) and [Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting):

1. **Protected Resource Metadata (`/.well-known/oauth-protected-resource`)**:
   - Must exist on the MCP server domain and return `HTTP 200 OK` with `authorization_servers` pointing to your OAuth issuer URL ([Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting)).
   - If you use a dedicated subdomain (e.g., `https://mcp.yourdomain.com`), the `resource` field in `/.well-known/oauth-protected-resource` and RFC 8707 audience validation must match that exact subdomain ([Google MCP Integration Standards](https://developers.google.com/connected-apps/mcp/server-optimization)).
2. **Authorization Server Metadata Discovery Order**:
   - Gemini fetches configuration JSON in the following order and **uses the first URL that returns any response—including an error (404/500)** ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)):
     1. `https://<issuer-domain>/.well-known/oauth-authorization-server`
     2. `https://<issuer-domain>/.well-known/openid-configuration`
   - **Caution**: Because Gemini stops if the first URL returns a `404` or `500`, `/.well-known/oauth-authorization-server` **must** return `HTTP 200 OK` with valid JSON ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)).
3. **Required Fields in `/.well-known/oauth-authorization-server`**:
   - `issuer`: Valid HTTPS URL string.
   - `authorization_endpoint`: Valid HTTPS URL string.
   - `token_endpoint`: Valid HTTPS URL string.
   - `response_types_supported`: Must contain `"code"`.
   - `grant_types_supported`: `["authorization_code", "refresh_token"]`.
   - `code_challenge_methods_supported`: `["S256"]`.
   - `scopes_supported`: Array of supported scopes (e.g., `["mcp:tools"]`).
   - `registration_endpoint`: Valid HTTPS URL string (required by Gemini's automated discovery check unless custom endpoints / pre-registered credentials override it) ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)).

### 4.4 Required Redirect URIs & Wildcard Caveats

Per [Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth), [Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting), and [Google Cloud Blog: Developer's Guide to MCP Apps in Gemini](https://cloud.google.com/blog/topics/developers-practitioners/devs-guide-to-mcp-apps-in-gemini):

- **Gemini Apps / Connected Apps Platform Redirect URI Patterns**:
  Google's OAuth client redirects back to callback URLs matching the following six patterns:
  - `https://oauth-redirect.googleusercontent.com/r/*`
  - `https://oauth-redirect-sandbox.googleusercontent.com/r/*`
  - `https://oauth-redirect-test.googleusercontent.com/r/*`
  - `https://oauth-redirect.googleusercontent.com/a/*`
  - `https://oauth-redirect-sandbox.googleusercontent.com/a/*`
  - `https://oauth-redirect-test.googleusercontent.com/a/*`
- **Vertex AI / Gemini Enterprise Redirect URI**:
  - `https://vertexaisearch.cloud.google.com/oauth-redirect`
- **Critical Wildcard Caveat with `@modelcontextprotocol/sdk`**:
  As noted in [Section 3.3](#33-built-in-handler--middleware-nuances-critical-implementation-details), `@modelcontextprotocol/sdk`'s `redirectUriMatches(requested, registered)` in `authorize.js` performs an **exact string comparison** (`requested === registered`) for non-localhost URLs and does **not** match literal `*` wildcards.
  - When connecting from Gemini Developer Mode or Gemini Connected Apps with a custom MCP server URL, you will not know the generated path suffix after `/r/` or `/a/` ahead of time unless you inspect the incoming `/authorize?redirect_uri=...` parameter.
  - **Best Practice for a Self-Hosted MCP OAuth Provider**: In your `clientsStore.getClient(clientId)` implementation (or in a tiny pre-middleware on `/authorize`), inspect the incoming `req.query.redirect_uri` (or `req.body.redirect_uri`). If it matches one of the trusted Google redirect origins/prefixes (`^https://oauth-redirect(-sandbox|-test)?\.googleusercontent\.com/(r|a)/` or `https://vertexaisearch.cloud.google.com/oauth-redirect`), include that exact `redirect_uri` in the `redirect_uris` array returned by `getClient(clientId)`! That satisfies `@modelcontextprotocol/sdk`'s exact-match check in `authorize.js` while still strictly restricting redirects to Google's official OAuth callback endpoints.

### 4.5 Token Refresh & Persistent Linking (No Refresh Token Rotation)

One of the most important Google-specific requirements in the [Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth) is **Persistent Linking** on `POST /token` with `grant_type=refresh_token`:

> *"Tip: To avoid a frustrating user experience and the need to re-link accounts, the single most important detail is to manage Refresh Token lifetime using Persistent Linking."*
> *"Your server must validate the provided Refresh Token and return a new Access Token in the JSON response. Additionally, to implement Persistent Linking, you must avoid rotating the Refresh Token during this exchange. Instead of issuing a new one, return the exact same Refresh Token in the JSON response and extend its expiration date on your backend."* ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)).

Specifically:
1. Issue a `refresh_token` alongside `access_token` in `exchangeAuthorizationCode`.
2. In `exchangeRefreshToken(client, refreshToken, scopes, resource)`, validate `refreshToken`, issue a fresh `access_token` (with `expires_in`), extend the refresh token's backend TTL, and **return the exact same `refresh_token`** in the `OAuthTokens` response object.
3. Implement `revokeToken` on `OAuthServerProvider` so `mcpAuthRouter` mounts `POST /revoke`, which Google calls when a user unlinks or disconnects the custom app in Gemini settings ([Google OAuth 2.1 Implementation Guide](https://developers.google.com/connected-apps/mcp/oauth)).

### 4.6 Network, Headers, Domain Verification, and Cloudflare Tunnel Considerations

1. **`User-Agent` Header**:
   - Google surfaces send `User-Agent: Google` on all outbound JSON-RPC requests (`initialize`, `tools/list`, `tools/call`) ([Google MCP Flow](https://developers.google.com/connected-apps/mcp/mcp-flow)).
   - **Cloudflare Bot Fight Mode / WAF**: Ensure Cloudflare Bot Fight Mode or WAF rules on your Cloudflare Tunnel domain do not challenge (CAPTCHA / JS challenge) requests from Google's outbound IPs or `User-Agent: Google`.
2. **Google Outbound IP Ranges**:
   - If your Cloudflare WAF or firewall restricts source IPs, Google's documented outbound CIDR blocks for Connected Apps are ([Google Connected Console Prerequisites](https://developers.google.com/connected-apps/gpc/prerequisites)):
     - `108.177.64.0/20`
     - `142.250.88.0/22`
     - `172.217.80.0/20`
     - `192.178.20.0/22`
     - `192.179.0.0/20`
     - `74.125.232.0/24`
     - `136.121.40.0/21`
   - Dynamic JSON lists:
     - [`https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json`](https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json)
     - [`https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json`](https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json)
3. **Login / Consent Page Framing Headers (`X-Frame-Options` / `CSP`)**:
   - During OAuth account linking, Gemini opens your `/authorize` login/consent page in a pop-up or dialog. Strict `X-Frame-Options` or `Content-Security-Policy` headers or browser pop-up blockers can block the login window if not configured cleanly ([Google Connected Console Troubleshooting](https://developers.google.com/connected-apps/gpc/troubleshooting)).
   - If the MCP server is a personal single-tenant server where the pre-configured `Client ID` and `Client Secret` already authenticate the owner (or where `/authorize` either auto-approves or shows a simple HTML consent/PIN form), `/authorize` can immediately redirect back to `redirect_uri?code=...&state=...` (or render a simple self-contained HTML form with no restrictive frame headers).
4. **Domain Verification (`/.well-known/google-connected-apps`)**:
   - Only required when registering in the Google Connected Console for publishing; must return `HTTP 200 OK` with `{ "verification_tokens": ["..."] }` and no redirects ([Google Connected Console Prerequisites](https://developers.google.com/connected-apps/gpc/prerequisites)). Not required for personal custom apps in `Settings > Connected Apps` or `gemini.google.com/devmode`.

---

## 5. Primary Sources Reference List

- **Model Context Protocol (MCP) Official Specifications**:
  - [MCP Specification 2025-11-25 — Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) ([GitHub MDX Source](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx))
  - [MCP Specification 2025-11-25 — Transports (Streamable HTTP)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) ([GitHub MDX Source](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/transports.mdx))
  - [MCP Specification 2025-06-18 — Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) ([GitHub MDX Source](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/basic/authorization.mdx))
  - [MCP Specification 2025-03-26 — Authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization) ([GitHub MDX Source](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/authorization.mdx))
  - [MCP Specification 2026-07-28 — Authorization Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
  - [MCP Specification 2026-07-28 — Authorization Server Discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
  - [MCP Specification 2026-07-28 — Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)
  - [MCP Specification 2026-07-28 — Streamable HTTP Transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- **IETF OAuth Specifications Referenced by MCP**:
  - [OAuth 2.1 IETF Draft (`draft-ietf-oauth-v2-1-13`)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13)
  - [RFC 9728 — OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
  - [RFC 8414 — OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
  - [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707.html)
  - [RFC 7591 — OAuth 2.0 Dynamic Client Registration Protocol](https://datatracker.ietf.org/doc/html/rfc7591)
  - [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
- **`@modelcontextprotocol/sdk` TypeScript SDK (`v1.32.2`, Commit `3b73021a0a2272c0c04c3917bcdb03398b3ec63f`)**:
  - [Repository & `package.json`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/package.json)
  - [`src/server/auth/router.ts` (`mcpAuthRouter`, `mcpAuthMetadataRouter`, `createOAuthMetadata`, `getOAuthProtectedResourceMetadataUrl`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/router.ts)
  - [`src/server/auth/provider.ts` (`OAuthServerProvider`, `OAuthTokenVerifier`, `AuthorizationParams`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/provider.ts)
  - [`src/server/auth/clients.ts` (`OAuthRegisteredClientsStore`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/clients.ts)
  - [`src/server/auth/types.ts` (`AuthInfo`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/types.ts)
  - [`src/server/auth/middleware/bearerAuth.ts` (`requireBearerAuth`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/middleware/bearerAuth.ts)
  - [`src/server/auth/middleware/clientAuth.ts` (`authenticateClient`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/middleware/clientAuth.ts)
  - [`src/server/auth/handlers/authorize.ts` (`authorizationHandler`, `redirectUriMatches`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/handlers/authorize.ts)
  - [`src/server/auth/handlers/token.ts` (`tokenHandler`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/handlers/token.ts)
  - [`src/server/auth/handlers/register.ts` (`clientRegistrationHandler`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/handlers/register.ts)
  - [`src/server/auth/handlers/revoke.ts` (`revocationHandler`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/auth/handlers/revoke.ts)
  - [`src/server/streamableHttp.ts` (`StreamableHTTPServerTransport`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/streamableHttp.ts)
  - [`src/server/webStandardStreamableHttp.ts` (`WebStandardStreamableHTTPServerTransport`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/webStandardStreamableHttp.ts)
  - [`src/server/express.ts` (`createMcpExpressApp`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/express.ts)
  - [`src/server/middleware/hostHeaderValidation.ts` (`hostHeaderValidation`, `localhostHostValidation`)](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/server/middleware/hostHeaderValidation.ts)
  - [`src/examples/server/simpleStreamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/examples/server/simpleStreamableHttp.ts)
  - [`src/examples/server/simpleStatelessStreamableHttp.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/examples/server/simpleStatelessStreamableHttp.ts)
  - [`src/examples/server/demoInMemoryOAuthProvider.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/examples/server/demoInMemoryOAuthProvider.ts)
- **Google Gemini & Connected Apps Platform Official Documentation**:
  - [Connected Apps Platform MCP Server Developer Guide](https://developers.google.com/connected-apps/mcp)
  - [OAuth 2.1 Implementation Guide | Connected Apps Platform](https://developers.google.com/connected-apps/mcp/oauth)
  - [MCP Connected App Integration Standards / Server Optimization](https://developers.google.com/connected-apps/mcp/server-optimization)
  - [MCP Flow | Connected Apps Platform](https://developers.google.com/connected-apps/mcp/mcp-flow)
  - [Gemini Apps Developer Mode Overview](https://developers.google.com/connected-apps/mcp/dev-mode)
  - [Test, Debug, and Evaluate in Gemini Apps Developer Mode](https://developers.google.com/connected-apps/mcp/dev-mode/usage)
  - [Prerequisites for Using Connected Apps | Google Connected Console](https://developers.google.com/connected-apps/gpc/prerequisites)
  - [Register, Test, and Publish Your Connected App | Google Connected Console](https://developers.google.com/connected-apps/gpc/perform-the-steps)
  - [Troubleshoot Your Registration | Google Connected Console](https://developers.google.com/connected-apps/gpc/troubleshooting)
  - [Connect & Manage Custom Apps for Gemini Apps | Gemini Apps Help](https://support.google.com/gemini/answer/17209137?hl=en)
  - [A Developer's Guide to MCP Apps in Gemini | Google Cloud Blog](https://cloud.google.com/blog/topics/developers-practitioners/devs-guide-to-mcp-apps-in-gemini)
