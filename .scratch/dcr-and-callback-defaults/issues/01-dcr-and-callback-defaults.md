---
status: closed
role: ready-for-human
---

# Implement RFC 7591 Dynamic Client Registration and Callback Defaults

- [x] Implement `registerClient` in `EmbeddedOAuthProvider`
- [x] Persist registered clients in `FileTokenStore` (`oauth-tokens.json`)
- [x] Enforce public-client-only (`token_endpoint_auth_method: none`)
- [x] Prevent client registration overwrite
- [x] Support remote trailing-slash path prefix matching in `isAllowedRedirectUri`
- [x] Update `.env.example`, `config.ts`, and `setup-wizard.sh` with well-known callbacks
- [x] Refine `setup-wizard.sh` final instructions and upgrade flow
- [x] Document ADR-0007 and update `GLOSSARY.md`
