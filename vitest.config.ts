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
