// Vitest setup file - runs before each test file
// Force mock database usage during tests to avoid schema initialization issues
// The mock now has all required tables (including VFS tables from migrations)

process.env.SKIP_DB_INIT = 'true';
process.env.SKIP_DB_INIT_TEMP = 'true'; // Backup in case first is not checked

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