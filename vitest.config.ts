import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Main alias: maps @/* to web/* for tests importing web modules
      '@': path.resolve(__dirname, 'web'),
      // Point @bing/shared directly at the source so vitest's Node ESM loader
      // doesn't trip on the package.json exports conditions. This is test-only
      // and does not affect production builds (Wrangler uses its own resolver).
      '@bing/shared': path.resolve(__dirname, 'packages/shared'),
      // Same for @bing/platform — needed for unified-agent-service tests.
      // Use full subpath aliases since @bing/platform isn't linked in node_modules.
      '@bing/platform/env': path.resolve(__dirname, 'packages/platform/src/env.ts'),
      '@bing/platform': path.resolve(__dirname, 'packages/platform/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.spec.ts', '**/__tests__/**/*.test.ts'],
    exclude: [
      'node_modules/',
      'dist/',
      '.git/',
    ],
    // Durable resolution for @bing/shared internal exports (avoids editing node_modules)
    server: {
      deps: {
        inline: ['@bing/shared'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.d.ts',
        '**/*.map',
      ],
    },
  },
});