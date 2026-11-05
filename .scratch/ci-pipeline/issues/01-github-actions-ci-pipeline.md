# 01: GitHub Actions CI Pipeline Configuration and Verification

**What to build:** Create `.github/workflows/ci.yml` defining the continuous integration pipeline for `actual-mcp`. Matrix test across Node.js versions 22 and 24, run `npm ci` with cache, typecheck with `npm run typecheck`, run test suite with `npm test`, compile with `npm run build`, and verify build artifact integrity. Add packaging tests in `tests/packaging.test.ts` to assert CI workflow validity, and document the CI workflow in `README.md`.

**Blocked by:** none

**Status:** resolved

- [x] Create `.github/workflows/ci.yml` with push/pull_request triggers, concurrency controls, Node 22/24 matrix, typecheck, test, build, and artifact verification.
- [x] Add regression test in `tests/packaging.test.ts` verifying workflow definition and triggers.
- [x] Update `README.md` to document the CI pipeline and verification commands.
- [x] Validate full test suite, typechecking, and build pass locally.

## Comments

- Implemented `.github/workflows/ci.yml` with matrix testing over Node 22.x (Active LTS) and Node 24.x, running `npm ci` with dependency caching, strict TypeScript typechecking (`npm run typecheck`), full Vitest suite (`npm test`), and compilation (`npm run build`).
- Added artifact verification step confirming `dist/index.js` exists and is non-empty.
- Added regression test to `tests/packaging.test.ts` to assert that the CI pipeline is present and correctly configured.
- Updated `README.md` and `docs/adr/0003-container-image-distribution-and-ci.md` to document the CI pipeline.
