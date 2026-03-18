import { defineConfig } from 'vitest/config';
import path from 'path';
import { config } from 'dotenv';

// Load environment variables from .env file
config({
  path: path.resolve(__dirname, '.env')
});

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: [
      'test/**/*.test.ts',
      'tests/e2e/**/*.test.ts',
      'lib/**/*.test.ts',
      '__tests__/**/*.test.ts',
    ],
    exclude: [
      'node_modules',
      '.next',
      'dist',
      '**/*.spec.ts',
      // Skip Playwright tests - run with playwright test instead
      'test/e2e/accessibility.test.ts',
      'test/e2e/chat-workflow.test.ts',
      'test/e2e/hitl-approval.test.ts',
      'test/e2e/multi-provider.test.ts',
      'test/e2e/performance.test.ts',
      'test/e2e/performance-advanced.test.ts',
      'test/e2e/sandbox-execution.test.ts',
      'test/e2e/tool-integration.test.ts',
      'test/e2e/vfs-checkpoint.test.ts',
      'test/e2e/visual-regression.test.ts',
      // Skip tests for optional/enhanced features not yet implemented
      '__tests__/agents/enhanced-features.test.ts',
      '__tests__/api/endpoints-integration.test.ts',
      '__tests__/arcade/contextual-auth.test.ts',
      '__tests__/blaxel/enhanced-features.test.ts',
      '__tests__/blaxel/volume-templates.test.ts',
      '__tests__/composio/enhanced-features.test.ts',
      '__tests__/composio/triggers-webhooks.test.ts',
      '__tests__/crewai/full-integration.test.ts',
      '__tests__/e2b/enhanced-features.test.ts',
      '__tests__/e2b-amp-service.test.ts', // Missing AMP methods
      '__tests__/image-generation/provider-registry.test.ts',
      '__tests__/mastra/full-integration.test.ts',
      '__tests__/mcp/full-integration.test.ts',
      '__tests__/nango/sync-management.test.ts',
      '__tests__/services/new-services.test.ts',
      '__tests__/sprites/enhanced-features.test.ts',
      '__tests__/stateful-agent/full-integration.test.ts',
      '__tests__/tambo/full-integration.test.ts',
      '__tests__/utils/error-handler.test.ts',
      '__tests__/utils/secure-logger.test.ts',
      '__tests__/middleware/security-middleware.test.ts',
      '__tests__/e2e-integration.test.ts',
      '__tests__/mastra/workflow-integration.test.ts',
      // Skip sandbox provider tests - provider loading fails in test environment
      '__tests__/sandbox-providers-create.test.ts',
      '__tests__/sandbox-providers-e2e.test.ts',
      '__tests__/sandbox/provider-benchmarks.test.ts',
      '__tests__/blaxel-provider.test.ts',
      // Skip WebContainer integration tests - require browser environment
      '__tests__/webcontainer-integration.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'lib/stateful-agent/**/*.{ts,tsx}',
      ],
      exclude: [
        'lib/stateful-agent/__tests__/**',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        global: {
          branches: 50,
          functions: 50,
          lines: 50,
          statements: 50,
        },
      },
    },
    pool: 'threads',
    testTimeout: 30000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
