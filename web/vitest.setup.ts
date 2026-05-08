// Vitest setup file - runs before each test file
import { vi } from 'vitest';

// Force mock database usage during tests to avoid schema initialization issues
process.env.SKIP_DB_INIT = 'true';
process.env.SKIP_DB_INIT_TEMP = 'true';

// Mock @bing/shared/FS/fs-bridge for all tests that depend on virtual-filesystem-service
// This must be at module level (top of file) for Vitest mock hoisting to work properly
vi.mock('@bing/shared/FS/fs-bridge', () => ({
  fsBridge: { readFile: vi.fn(), writeFile: vi.fn(), exists: vi.fn(() => false), mkdir: vi.fn(), readdir: vi.fn() },
  isUsingLocalFS: false,
  initializeFSBridge: vi.fn(async () => {}),
}));
vi.mock('@bing/shared/FS/index', () => ({
  FileSystemWatchEvent: { Created: 'created', Modified: 'modified', Deleted: 'deleted' },
}));

// Reset mock database singleton before each test to ensure clean state
// This is a workaround for Vitest module caching
try {
  const { resetMockDatabase } = require('./lib/database/connection');
  if (typeof resetMockDatabase === 'function') {
    resetMockDatabase();
  }
} catch {
  // Connection module may not be loaded yet, that's fine
}