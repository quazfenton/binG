/**
 * Test Setup
 *
 * Global test configuration and mocks
 */

import '@testing-library/jest-dom/vitest';
import { vi, afterAll, afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// ============================================================================
// Console Mocking
// ============================================================================

// Store original console methods
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalInfo = console.info;
const originalDebug = console.debug;

// Quiet mode for CI
if (process.env.TEST_QUIET === 'true') {
  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  console.info = vi.fn();
  console.debug = vi.fn();
}

// Restore console methods after all tests
afterAll(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  console.info = originalInfo;
  console.debug = originalDebug;
});

// ============================================================================
// React Testing Library Cleanup
// ============================================================================

// Cleanup after each test for React components
afterEach(() => {
  cleanup();
});

// ============================================================================
// Global Test Configuration
// ============================================================================

vi.setConfig({
  testTimeout: 30000, // 30 seconds
  hookTimeout: 10000, // 10 seconds
});

// ============================================================================
// Environment Variables
// ============================================================================

// Mock environment variables for tests
vi.stubEnv('JWT_SECRET', 'test-secret-key-for-testing-only-min-16-chars');
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('TEST_ENV', 'true');

// ============================================================================
// Crypto Mock
// ============================================================================

// Mock crypto for tests if needed
if (typeof global.crypto === 'undefined') {
  global.crypto = require('crypto').webcrypto as any;
}

// ============================================================================
// Fetch Mock
// ============================================================================

// Global fetch mock
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Helper to create fetch mock responses
export function createFetchResponse<T>(data: T, options?: { status?: number; statusText?: string }): Response {
  return {
    ok: (options?.status ?? 200) >= 200 && (options?.status ?? 200) < 300,
    status: options?.status ?? 200,
    statusText: options?.statusText ?? 'OK',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => data,
    text: async () => JSON.stringify(data),
    blob: async () => new Blob([JSON.stringify(data)]),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(data)).buffer,
    body: null,
    bodyUsed: false,
    clone: function () { return this; },
    formData: async () => new FormData(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
  } as Response;
}

// Helper to mock fetch success
export function mockFetchSuccess<T>(data: T, options?: { status?: number }): void {
  (global.fetch as any).mockResolvedValue(createFetchResponse(data, options));
}

// Helper to mock fetch failure
export function mockFetchError(status: number = 500, message: string = 'Server Error'): void {
  (global.fetch as any).mockResolvedValue(
    createFetchResponse({ error: message }, { status, statusText: message })
  );
}

// Helper to mock fetch network error
export function mockFetchNetworkError(error: Error | string = 'Network Error'): void {
  (global.fetch as any).mockRejectedValue(
    typeof error === 'string' ? new Error(error) : error
  );
}

// ============================================================================
// Timer Mocks
// ============================================================================

// Use fake timers by default (can be overridden per-test)
vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });

afterEach(() => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

// Helper to advance time (works with fake timers)
export async function advanceTime(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await new Promise(resolve => process.nextTick(resolve));
}

// Helper to run all pending timers (works with fake timers)
export async function runAllTimers(): Promise<void> {
  vi.runAllTimers();
  await new Promise(resolve => process.nextTick(resolve));
}

// ============================================================================
// LocalStorage Mock
// ============================================================================

const localStorageMock = {
  store: new Map<string, string>(),
  getItem: vi.fn(function(key: string) { return this.store.get(key) || null; }),
  setItem: vi.fn(function(key: string, value: string) { this.store.set(key, value); }),
  removeItem: vi.fn(function(key: string) { this.store.delete(key); }),
  clear: vi.fn(function() { this.store.clear(); }),
  key: vi.fn(function(index: number) { return Array.from(this.store.keys())[index] || null; }),
  get length() { return this.store.size; },
};

beforeEach(() => {
  localStorageMock.store.clear();
  Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
});

// ============================================================================
// SessionStorage Mock
// ============================================================================

const sessionStorageMock = {
  store: new Map<string, string>(),
  getItem: vi.fn(function(key: string) { return this.store.get(key) || null; }),
  setItem: vi.fn(function(key: string, value: string) { this.store.set(key, value); }),
  removeItem: vi.fn(function(key: string) { this.store.delete(key); }),
  clear: vi.fn(function() { this.store.clear(); }),
  key: vi.fn(function(index: number) { return Array.from(this.store.keys())[index] || null; }),
  get length() { return this.store.size; },
};

beforeEach(() => {
  sessionStorageMock.store.clear();
  Object.defineProperty(global, 'sessionStorage', {
    value: sessionStorageMock,
    writable: true,
    configurable: true,
  });
});

// ============================================================================
// MatchMedia Mock
// ============================================================================

beforeEach(() => {
  Object.defineProperty(global, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// ============================================================================
// ResizeObserver Mock
// ============================================================================

beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

// ============================================================================
// IntersectionObserver Mock
// ============================================================================

beforeEach(() => {
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    takeRecords: vi.fn().mockReturnValue([]),
  }));
});

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Common test data fixtures
 */
export const fixtures = {
  // User fixtures
  user: {
    id: 'test-user-123',
    email: 'test@example.com',
    name: 'Test User',
  },

  // File fixtures
  files: {
    typescript: {
      path: 'src/test.ts',
      content: 'export const test = "hello";',
      language: 'typescript',
    },
    javascript: {
      path: 'src/test.js',
      content: 'export const test = "hello";',
      language: 'javascript',
    },
    python: {
      path: 'src/test.py',
      content: 'test = "hello"',
      language: 'python',
    },
    json: {
      path: 'package.json',
      content: '{"name": "test", "version": "1.0.0"}',
      language: 'json',
    },
    react: {
      path: 'src/App.tsx',
      content: 'export default function App() { return <div>Hello</div>; }',
      language: 'typescript',
    },
  },

  // Sandbox fixtures
  sandbox: {
    id: 'test-sandbox-123',
    workspaceDir: '/project/workspace',
    status: 'running' as const,
  },

  // Preview fixtures
  preview: {
    url: 'https://test-preview.csb.app',
    port: 3000,
    ready: true,
  },

  // Error fixtures
  errors: {
    notFound: new Error('Not found'),
    unauthorized: new Error('Unauthorized'),
    network: new Error('Network error'),
    timeout: new Error('Request timeout'),
  },
};

/**
 * Create a mock VirtualFile
 */
export function createMockVirtualFile(overrides?: Partial<any>): any {
  return {
    path: 'src/test.ts',
    content: 'export const test = "hello";',
    language: 'typescript',
    version: 1,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    size: 26,
    ...overrides,
  };
}

/**
 * Create a mock DiffOperation
 */
export function createMockDiffOperation(overrides?: Partial<any>): any {
  return {
    operation: 'replace' as const,
    lineRange: [1, 1] as [number, number],
    content: 'export const updated = "world";',
    description: 'Test update',
    confidence: 0.95,
    ...overrides,
  };
}

/**
 * Create a mock SandboxHandle
 */
export function createMockSandboxHandle(overrides?: Partial<any>): any {
  return {
    id: 'test-sandbox-123',
    workspaceDir: '/project/workspace',
    executeCommand: vi.fn().mockResolvedValue({ success: true, output: '' }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockResolvedValue({ success: true, content: '' }),
    listDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    ...overrides,
  };
}

/**
 * Create a mock PreviewRequest
 */
export function createMockPreviewRequest(overrides?: Partial<any>): any {
  return {
    files: [],
    framework: 'react',
    previewMode: 'sandpack' as const,
    shouldOffload: false,
    ...overrides,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wait for a condition to be true (works with fake timers)
 */
export async function waitFor(condition: () => boolean, timeout: number = 1000): Promise<void> {
  const maxAttempts = timeout / 10;
  for (let i = 0; i < maxAttempts; i++) {
    if (condition()) return;
    vi.advanceTimersByTime(10);
    await new Promise(resolve => process.nextTick(resolve));
  }
  throw new Error('waitFor timeout');
}

/**
 * Wait for next tick
 */
export async function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Suppress console output for a test
 */
export function suppressConsole(): { restore: () => void } {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  console.info = vi.fn();
  console.debug = vi.fn();

  return {
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
      console.info = original.info;
      console.debug = original.debug;
    },
  };
}

// ============================================================================
// Export globals for test usage
// ============================================================================

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vi {
    interface Assertion<T = any> {
      toBeValidDate(): void;
      toBeWithinRange(a: number, b: number): void;
    }
  }
}

// Custom matcher for date validation
// Note: Vitest handles global matchers differently - these are for compatibility
try {
  // Only extend if expect is available (skip in environments where it's not set up)
  // eslint-disable-next-line no-var
  if (typeof (globalThis as any).expect !== 'undefined' && (globalThis as any).expect.extend) {
    // eslint-disable-next-line no-var
    (globalThis as any).expect.extend({
      toBeValidDate(received: any) {
        const date = new Date(received);
        const pass = !isNaN(date.getTime());
        return {
          pass,
          message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid date`,
        };
      },
      toBeWithinRange(received: number, a: number, b: number) {
        const pass = received >= a && received <= b;
        return {
          pass,
          message: () => `expected ${received} ${pass ? 'not ' : ''}to be within range [${a}, ${b}]`,
        };
      },
    });
  }
} catch (error) {
  // Silently fail - custom matchers are optional
  console.debug('[Test Setup] Custom matchers not available:', error);
}

