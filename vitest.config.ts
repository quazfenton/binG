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
    // NOTE: This ROOT config governs ALL tests run via `pnpm test` from the
    // project root. The web-level config at /opt/bing/web/vitest.config.ts is
    // loaded ONLY when vitest is invoked from /opt/bing/web/ directly (e.g.
    // `pnpm --filter web test`). Both configs include `.test.tsx` patterns so
    // JSX-renderable test files (e.g. components/ui/__tests__/drawer.test.tsx)
    // auto-discover under either workflow; vitest dedupes overlapping matches.
    // include[] moved to /opt/bing/vitest.workspace.ts (project `web`).
    // workspace.ts overrides this file entirely per vitest 4 docs:
    // "When vitest.workspace.ts exists, vitest takes precedence."
    // Kept here as a stub for legacy tooling probes (IDE tests, hooks).
    include: [],
    exclude: [
      '**/node_modules/**',
      '**/web/**',
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