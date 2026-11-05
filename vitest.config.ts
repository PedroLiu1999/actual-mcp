import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});

