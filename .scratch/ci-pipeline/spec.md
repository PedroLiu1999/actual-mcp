# Spec: Automated GitHub Actions CI Pipeline

Status: resolved

## Problem Statement

Currently, `actual-mcp` has automated container publishing via `.github/workflows/docker-publish.yml`, but lacks a dedicated continuous integration (CI) workflow for rapid, automated testing of pull requests and pushes to `main`. As a result, code changes (TypeScript compilation, Vitest test suite, build artifacts) are not verified in a clean matrix environment across supported Node.js runtimes prior to merge or release.

## Solution

Create a GitHub Actions CI pipeline in `.github/workflows/ci.yml` that:
1. Triggers on pushes and pull requests to `main`, plus manual workflow dispatch (`workflow_dispatch`).
2. Implements concurrency control to cancel outdated in-progress runs on PRs while preserving runs on `main`.
3. Runs across a matrix of supported Node.js versions (Node 22 LTS Iron and Node 24) matching the engine requirement (`>=22.0.0`).
4. Performs `npm ci` with caching, runs `npm run typecheck` (strict TypeScript validation), executes the complete Vitest test suite (`npm test`), and builds the production output (`npm run build`).
5. Validates the build artifact (`dist/index.js`) to guarantee clean compile outputs.
6. Adds regression verification in `tests/packaging.test.ts` to ensure the CI pipeline configuration remains present, valid, and strictly aligned with project dependencies.
7. Updates repository documentation (`README.md`) to document the CI pipeline and test requirements.
