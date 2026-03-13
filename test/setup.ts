/**
 * Test Setup
 * 
 * Global test configuration and mocks
 */

import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock console methods to reduce noise in tests
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

if (process.env.TEST_QUIET === 'true') {
  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
}

// Restore after tests
afterAll(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

// Global test timeout
vi.setConfig({
  testTimeout: 30000,
  hookTimeout: 10000,
});

// Mock crypto for tests if needed
if (typeof global.crypto === 'undefined') {
  global.crypto = require('crypto').webcrypto as any;
}

// Mock environment variables for tests
vi.stubEnv('JWT_SECRET', 'test-secret-key-for-testing-only-min-16-chars');
vi.stubEnv('NODE_ENV', 'test');

