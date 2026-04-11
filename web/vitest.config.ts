import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks', // Required for AsyncLocalStorage support (toolContextStore)
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/deprecated/**', '**/.next/**'],
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
