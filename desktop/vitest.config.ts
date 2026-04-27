import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Desktop Integration Tests Configuration
 * 
 * Tests for Tauri desktop, CLI, and shared functionality.
 * Uses same patterns as web/vitest.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    include: ['**/__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
    ],
    testTimeout: 30000,
    hooksTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@bing/shared': path.resolve(__dirname, '../packages/shared'),
      '@bing/shared/FS': path.resolve(__dirname, '../packages/shared/FS'),
      '@bing/shared/cli': path.resolve(__dirname, '../packages/shared/cli'),
    },
  },
});