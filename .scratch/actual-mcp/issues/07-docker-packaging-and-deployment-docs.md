# 07: Standalone Docker Packaging, docker-compose.yml & Deployment Guide

**What to build:** Production containerization (`Dockerfile`, `.dockerignore`, standalone `docker-compose.yml`, and `.env.example`) and operator documentation (`README.md`) for running `actual-mcp` on a VPS alongside an existing self-hosted Actual Budget Sync Server and Cloudflare Tunnel and linking it to Google Gemini's custom MCP connector.

**Blocked by:** 02: Embedded OAuth 2.1 Server, Persistent Token Store & Bearer Auth for Gemini, 05: Analytics Read Tools — get_spending_summary & run_aql_query, 06: Write Tools — Transaction CRUD & set_budget_amount with Reversibility

**Status:** resolved

- [x] Multi-stage `Dockerfile` uses `node:22-bookworm-slim`, installs `tini` as PID 1 (`ENTRYPOINT ["/usr/bin/tini", "--"]`), compiles TypeScript, installs production dependencies (including native `better-sqlite3`), creates a writable `/data` directory, and defines a `HEALTHCHECK` probing `http://127.0.0.1:3000/healthz`.
- [x] Standalone `docker-compose.yml` defines the `actual-mcp` service binding `127.0.0.1:${PORT:-3000}:3000`, mapping `extra_hosts: ["host.docker.internal:host-gateway"]`, mounting `./data:/data`, loading `.env`, and setting `restart: unless-stopped`.
- [x] `.env.example` documents every required and optional environment variable with clear comments and example values.
- [x] `README.md` documents the architecture, all 12 MCP tools, environment variables, VPS deployment steps (connecting to an existing `actual-server` and routing a public hostname in an existing `cloudflared` tunnel), and step-by-step instructions for connecting in Google Gemini's "Connect to an MCP server" dialog (`MCP server URL`, `Client ID`, `Client Secret`).
- [x] The full test suite (`npm test`), typecheck (`npm run typecheck`), and production build (`npm run build`) pass cleanly.
