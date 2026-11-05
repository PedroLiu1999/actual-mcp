# Container Image Distribution and CI/CD Pipeline

To enable zero-compilation deployment for VPS hosts, Raspberry Pi, and Apple Silicon devices, `actual-mcp` distributes multi-architecture container images (`linux/amd64`, `linux/arm64`) via GitHub Container Registry (`ghcr.io/pedroliu1999/actual-mcp`).

The automated GitHub Actions workflows:
1. `.github/workflows/ci.yml`: Continuous integration pipeline that validates all pushes and pull requests to `main` across supported Node.js versions (`22.x`, `24.x`) by executing strict typechecking (`npm run typecheck`), full Vitest unit/integration test suites (`npm test`), and production compilation (`npm run build`).
2. `.github/workflows/docker-publish.yml`:
   - Builds multi-platform images with Docker Buildx and QEMU (`linux/amd64`, `linux/arm64`).
   - Automatically ships semantic version tags from git release tags (`v*.*.*`), commit short SHAs, and the `latest` floating tag on release tag pushes.
   - Validates pull requests targeting `main` by executing the Docker build without pushing.
   - Caches build stages with GitHub Actions cache (`type=gha`) to keep CI fast.

## Consequences

- `docker-compose.yml` configures `image: ghcr.io/pedroliu1999/actual-mcp:${ACTUAL_MCP_VERSION:-latest}` alongside the existing `build:` directive. Users can immediately pull and launch with `docker compose pull && docker compose up -d`, pin specific versions via `ACTUAL_MCP_VERSION` in `.env`, or build from source using `docker compose up -d --build`.
- GitHub repository name normalization (`tr '[:upper:]' '[:lower:]'`) is enforced in CI to prevent registry push failures caused by uppercase characters in GitHub usernames or repository paths.
