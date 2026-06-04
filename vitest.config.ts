import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Main alias: maps @/* to web/* for tests importing web modules
      '@': path.resolve(__dirname, 'web'),
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