# 02: Dynamic Client Registration Rate Limiting, Client Cap, and Sanitized Logging

**What to build:** Protect the public `POST /register` endpoint against Denial of Service and storage exhaustion by attaching a dedicated IP-based rate limiter, enforcing an upper bound of 20 total registered clients in persistent storage, and sanitizing registration logs to avoid echoing arbitrary request bodies.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `POST /register` enforces IP rate limiting (5 requests per 15 minutes per IP), returning HTTP 429 Too Many Requests with standard rate limit headers when exceeded.
- [ ] The persistent token store enforces a maximum ceiling of 20 registered clients.
- [ ] Attempting to dynamically register a client when the store is at maximum capacity returns an RFC-compliant client registration rejection without modifying disk storage or crashing.
- [ ] Registration logging records only sanitized metadata (client ID, auth method, redirect URI count) without logging arbitrary unvalidated payload bodies.
- [ ] Valid registration requests under the limit continue to succeed with HTTP 201 Created.
- [ ] Integration tests at the HTTP application seam verify the rate limit threshold, client cap enforcement, and successful registration flows.
