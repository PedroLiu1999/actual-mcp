# 01: Global Security Headers and Health Probe Sanitization

**What to build:** Add global defensive HTTP security headers (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, and `X-Content-Type-Options: nosniff`) to every server response to guard the administrative authorization consent interface against Clickjacking and UI redressing, and sanitize unauthenticated `GET /healthz` responses by removing the internal Target Budget Sync ID while continuing to report overall readiness and synchronization timestamps.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] `GET /authorize` and all API responses include `X-Frame-Options: DENY`.
- [x] `GET /authorize` and all API responses include `Content-Security-Policy` with `frame-ancestors 'none'`.
- [x] All server responses include `X-Content-Type-Options: nosniff`.
- [x] `GET /healthz` returns `status: "ok"` along with `ready` (boolean) and `lastSyncedAt` (string or null).
- [x] `GET /healthz` does not include `syncId` in its response body.
- [x] Integration tests at the HTTP application seam verify the presence of all security headers and assert that `syncId` is omitted from `/healthz`.
