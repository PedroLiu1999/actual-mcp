# 03: Token Route Rate Limiting and Expired Authorization Code Pruning

**What to build:** Protect token endpoints against automated request flooding by attaching dedicated rate limiting to `POST /token` and `POST /revoke`, and proactively prune expired authorization codes from in-memory storage to prevent unbounded memory retention during long server runtimes.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `POST /token` enforces IP rate limiting (30 requests per minute per IP), returning HTTP 429 Too Many Requests when the limit is exceeded.
- [ ] `POST /revoke` enforces IP rate limiting (30 requests per minute per IP), returning HTTP 429 Too Many Requests when the limit is exceeded.
- [ ] Expired authorization codes (older than 10 minutes) are automatically pruned from in-memory maps during authorization code creation or lookup.
- [ ] Pruned or expired authorization codes cannot be redeemed at `POST /token` and return an `invalid_grant` error.
- [ ] Legitimate token exchanges, token refreshes, and revocation flows within normal limits continue to operate smoothly.
- [ ] Integration tests at the HTTP application seam verify the rate limit rejections and expired code eviction behavior.
