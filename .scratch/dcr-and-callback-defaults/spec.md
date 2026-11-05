# Dynamic Client Registration (/register) and Well-Known Callback Allowlist Defaults

## Summary

Add an RFC 7591 dynamic client registration endpoint (`/register`) to allow automated client registration without pre-shared client credentials, pre-populate well-known callback endpoints by default in `.env` and `setup-wizard.sh`, and remove mention of client credentials in the wizard instructions.

## Requirements

1. **RFC 7591 `/register` Endpoint**:
   - Advertise `registration_endpoint` in RFC 8414 metadata.
   - Enforce public client PKCE model (`token_endpoint_auth_method: 'none'`).
   - Validate redirect URIs against server allowlist policy.
   - Prevent overwriting existing client registrations.
   - Persist registrations to `/data/oauth-tokens.json`.
2. **Well-Known Callback Defaults**:
   - Default `OAUTH_ALLOWED_REDIRECT_URIS` includes loopback, Google Gemini (`https://oauth-redirect.googleusercontent.com/r/`, `/a/`), and Vertex AI.
   - Support trailing-slash path prefix matching for remote HTTPS callbacks.
3. **Setup Wizard Refinement**:
   - Update Stage 2 to suggest well-known callbacks when upgrading from loopback-only.
   - Remove mention of Client ID and Secret in Stage 6 copy & paste instructions.
