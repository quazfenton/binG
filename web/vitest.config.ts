import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Tests that require live external services (Redis, Modal, a running v2 gateway/worker,
 * the Next.js dev server, etc.) are excluded from the default `pnpm test` run and
 * must be invoked explicitly via `pnpm test:integration`.
 *
 * Keep this list narrow — only tests that cannot pass without real external
 * infrastructure belong here.
 */
export const INTEGRATION_TEST_PATTERNS = [
  // v2 agent gateway / worker / full session — need a running v2 server + Redis queue
  '**/__tests__/v2-agent-gateway.test.ts',
  '**/__tests__/v2-agent-worker.test.ts',
  '**/__tests__/integration/full-session.test.ts',
  // Monitoring e2e — needs a running backend to reach health endpoints
  '**/__tests__/monitoring-observability-e2e.test.ts',
  // Modal provider — requires real MODAL_API_TOKEN_ID/SECRET to authenticate
  '**/__tests__/sandbox/modal-com-provider.test.ts',
  // Performance thresholds — flaky on CI/unloaded machines
  '**/__tests__/performance/advanced-performance.test.ts',
  // Legacy E2E scripts that hit real APIs
  '**/tests/e2e/**',
];

/**
 * Tests that describe the intended surface of modules which have never been
 * implemented in this codebase. They should be un-excluded once the target
 * module lands. Keeping them in the suite would give false red signal for
 * unrelated work.
 */
export const UNIMPLEMENTED_MODULE_TEST_PATTERNS = [
  '**/__tests__/preview-offloader.test.ts',
  '**/__tests__/cloud-agent-preview-integration.test.ts',
  '**/__tests__/v2-nullclaw-integration.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks', // Required for AsyncLocalStorage support (toolContextStore)
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/deprecated/**',
      '**/.next/**',
      ...INTEGRATION_TEST_PATTERNS,
      ...UNIMPLEMENTED_MODULE_TEST_PATTERNS,
    ],
    testTimeout: 30000,
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
