import { defineConfig } from 'vitest/config';
import path from 'path';
import { INTEGRATION_TEST_PATTERNS } from './vitest.config';

/**
 * Config for `pnpm test:integration`.
 *
 * Runs only the tests that require live external services. These expect real
 * credentials / running infrastructure (Modal, v2 worker, Redis, backend server…)
 * and will fail when those aren't available.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    include: INTEGRATION_TEST_PATTERNS,
    exclude: ['**/node_modules/**', '**/deprecated/**', '**/.next/**'],
    testTimeout: 120000, // integration runs tend to be slower
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@bing/platform/env': path.resolve(__dirname, '../packages/platform/src/env.ts'),
      '@bing/platform': path.resolve(__dirname, '../packages/platform/src'),
      '@bing/shared': path.resolve(__dirname, '../packages/shared'),
      '@bing/shared/agent': path.resolve(__dirname, '../packages/shared/agent'),
    },
  },
});
