# Research: Displaying Custom Connector Logos in Google Gemini & MCP Clients

This document captures primary-source findings on how Google Gemini, the Model Context Protocol (MCP), and OAuth 2.1 handle visual branding, logos, and icons for custom remote connectors.

---

## 1. Executive Summary

When integrating a custom remote MCP server (such as `actual-mcp`) into **Google Gemini** (via Gemini Advanced Custom Connectors or the Gemini Enterprise Connected Apps hub), the client discovers visual identity through **three complementary standards**:

1. **MCP Handshake Metadata (`SEP-973`)**: The server declares its visual branding directly in the `InitializeResult` response inside `serverInfo.icons`.
2. **OAuth 2.1 Discovery Metadata (`RFC 8414` §2)**: The authorization server advertises a public `logo_uri` in `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`.
3. **Origin Web Discovery (`/favicon.ico` & `/apple-touch-icon.png`)**: Web clients, browser extensions, and crawler proxies fall back to fetching the origin's root favicon when custom metadata is unparsed or client-side caching prefers origin assets.
4. **OAuth Consent Dialog (`/authorize`)**: The server-rendered HTML consent screen displays the branding during the authorization code handshake.

Implementing all four ensures the logo renders consistently across the Gemini connector drawer, tool invocation logs, and authentication screens.

---

## 2. Primary Source Standards & Specifications

### 2.1 Model Context Protocol: SEP-973 (`serverInfo.icons`)
* **Standard**: [Model Context Protocol Specification — SEP-973: "Expose additional metadata for Implementations, Resources, Tools and Prompts"](https://modelcontextprotocol.io/specification) / [GitHub Proposal Discussion](https://github.com/modelcontextprotocol/specification)
* **Location in Protocol**: Returned by the server during the `initialize` JSON-RPC handshake (`method: "initialize"`).
* **Schema**:
  ```json
  {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "actual-mcp",
      "version": "0.1.0",
      "title": "Actual Budget MCP",
      "websiteUrl": "https://github.com/your-repo/actual-mcp",
      "icons": [
        {
          "src": "https://<PUBLIC_URL>/logo.png",
          "mimeType": "image/png",
          "sizes": ["128x128"]
        },
        {
          "src": "https://<PUBLIC_URL>/favicon.svg",
          "mimeType": "image/svg+xml",
          "sizes": ["any"]
        }
      ]
    }
  }
  ```
* **Base64 Data URI Support**: `src` can also be a `data:image/png;base64,...` URI. This guarantees delivery even if the client's web environment enforces strict cross-origin image isolation.

---

### 2.2 OAuth 2.1 Authorization Server Metadata (`RFC 8414` §2)
* **Standard**: [IETF RFC 8414: "OAuth 2.0 Authorization Server Metadata"](https://www.rfc-editor.org/rfc/rfc8414)
* **Endpoint**: `GET /.well-known/oauth-authorization-server`
* **Relevant Field**:
  - `logo_uri`: *"URL that references a logo for the authorization server. The contents of the resource MUST be an image file."*
* **Example Payload**:
  ```json
  {
    "issuer": "https://actual-mcp.example.com",
    "authorization_endpoint": "https://actual-mcp.example.com/authorize",
    "token_endpoint": "https://actual-mcp.example.com/token",
    "logo_uri": "https://actual-mcp.example.com/logo.png",
    "service_documentation": "https://github.com/your-repo/actual-mcp"
  }
  ```
* When Gemini registers or authorizes against an OAuth 2.1 server, its identity layer crawls this metadata to brand the connection dialog.

---

### 2.3 OAuth Protected Resource Metadata (`RFC 9700` / draft-ietf-oauth-resource-metadata)
* **Standard**: [IETF RFC 9700: "OAuth 2.0 Protected Resource Metadata"](https://datatracker.ietf.org/doc/rfc9700/)
* **Endpoint**: `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`
* **Relevant Fields**:
  - `resource_name`: Human-readable name of the protected API (e.g., `"Actual Budget MCP"`).
  - `logo_uri`: URI of the protected resource's brand icon.

---

### 2.4 Origin Favicon Discovery (HTTP Root Discovery)
* **Standard**: W3C HTML5 Specification & IETF standard web practices.
* **Mechanism**:
  When a user enters `https://actual-mcp.example.com/mcp` into Google Gemini's connector modal:
  1. The client parses the origin: `https://actual-mcp.example.com`.
  2. The frontend web application attempts to fetch `GET /favicon.ico` or `GET /apple-touch-icon.png` from that origin to display in the side drawer.
  3. If the server does not serve static assets at the root or responds with 404, the UI falls back to a generic connector symbol or initial badge (e.g. `[A]`).

---

## 3. Implementation Blueprint for `actual-mcp`

To ensure the new logo shows reliably across all client contexts, make four specific changes in the codebase:

### 3.1 Serve Static Brand Assets from Express (`src/app.ts`)
Serve the pre-rendered icons (`favicon.ico`, `logo.png`, `apple-touch-icon.png`) from a static route at root:

```typescript
// In src/app.ts
import path from 'node:path';

// Serve root web discovery assets
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../docs/assets/logo/dist/favicon.ico'));
});

app.get('/logo.png', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../docs/assets/logo/dist/actual-mcp-symbol-app-icon-512.png'));
});

app.get('/apple-touch-icon.png', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../docs/assets/logo/dist/apple-touch-icon.png'));
});
```

---

### 3.2 Add `icons` to MCP `serverInfo` (`src/mcp/server.ts`)
Pass the icon definitions into `createMcpServer`:

```typescript
// In src/mcp/server.ts
export function createMcpServer(budgetGateway: BudgetGateway, publicUrl?: string): McpServer {
  const logoUrl = publicUrl ? `${publicUrl}/logo.png` : undefined;

  const server = new McpServer(
    {
      name: 'actual-mcp',
      version: '0.1.0',
      ...(logoUrl
        ? {
            icons: [
              {
                src: logoUrl,
                mimeType: 'image/png',
                sizes: ['512x512', '128x128'],
              },
            ],
          }
        : {}),
    },
    {
      instructions: 'Actual Budget MCP Server...',
    },
  );
  // ...
}
```

---

### 3.3 Add `logo_uri` to OAuth Metadata (`src/app.ts`)
Update `oauthMetadata` and `protectedResourceMetadata`:

```typescript
// In src/app.ts
const logoUrl = `${config.PUBLIC_URL}/logo.png`;

const oauthMetadata: OAuthMetadata = {
  ...createOAuthMetadata({ provider: oauthProvider, issuerUrl, scopesSupported }),
  issuer: config.PUBLIC_URL,
  logo_uri: logoUrl,
  token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  revocation_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
};

const protectedResourceMetadata: OAuthProtectedResourceMetadata = {
  resource: resourceServerUrl.href,
  authorization_servers: [config.PUBLIC_URL],
  scopes_supported: scopesSupported,
  bearer_methods_supported: ['header'],
  resource_name: 'Actual Budget MCP Server',
  logo_uri: logoUrl,
};
```

---

### 3.4 Brand the Embedded OAuth Consent Screen (`src/auth/provider.ts`)
In `renderConsentHtml()`, include the squircle app icon or vector mark and style the authorization dialog with Actual Budget Purple (`#6B46C1`):

```html
<div style="text-align: center; margin-bottom: 2rem;">
  <img src="/logo.png" alt="actual-mcp" width="72" height="72" style="border-radius: 18px; box-shadow: 0 4px 12px rgba(107, 70, 193, 0.25);" />
  <h1 style="color: #0F172A; margin-top: 1rem; font-size: 1.5rem;">Authorize Actual Budget MCP</h1>
</div>
```

---

## 4. Primary Sources & References

1. **Model Context Protocol Specification**:
   - SEP-973: *Expose additional metadata for Implementations, Resources, Tools and Prompts* (`modelcontextprotocol.io`).
   - Implementation Schema: `Implementation.icons` array with `src`, `mimeType`, `sizes`.
2. **IETF RFC 8414**:
   - *OAuth 2.0 Authorization Server Metadata* (§2: `logo_uri`).
3. **IETF RFC 9700**:
   - *OAuth 2.0 Protected Resource Metadata* (Resource Identifiers & Metadata).
4. **W3C Web App Manifest**:
   - Icons descriptor specification (`sizes`, `src`, `type`, `purpose`).
5. **Google Gemini Custom Connectors & Connected Apps Documentation**:
   - Transport specifications (StreamableHTTP over public HTTPS endpoints).
   - OAuth 2.0 Authorization Code flow requirements.
