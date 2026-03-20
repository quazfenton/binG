/**
 * Edge-safe database module
 * 
 * This module provides database functionality that works in Edge Runtime
 * by lazily loading Node.js modules only when running in Node.js environment.
 * 
 * For Edge Runtime / Middleware: Returns mock responses, actual DB operations happen in API routes
 */

interface MockDatabase {
  prepare: () => MockStatement
  exec: () => MockDatabase
  transaction: (fn: () => void) => () => void
}

interface MockStatement {
  run: (...args: any[]) => { lastInsertRowid: number; changes: number }
  get: (...args: any[]) => any
  all: (...args: any[]) => any[]
}

/**
 * Check if we're in Edge Runtime (no Node.js)
 */
function isEdgeRuntime(): boolean {
  // In Edge Runtime, process.versions.node is undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (process as any)?.versions?.node === 'undefined';
}

/**
 * Get database instance - lazy loaded
 */
export function getDatabase(): MockDatabase {
  if (isEdgeRuntime()) {
    // Return mock database for Edge Runtime
    // This allows the middleware to load without errors
    // Actual database operations happen in API routes (Node.js runtime)
    console.warn('[DB] Edge Runtime detected - using mock database');
    return createMockDatabase();
  }
  
  // In Node.js runtime, load the actual database
  const db = require('./connection').getDatabase;
  return db();
}

/**
 * Get encryption functions - lazy loaded
 */
export function encryptApiKey(apiKey: string): { encrypted: string; hash: string } {
  if (isEdgeRuntime()) {
    // Mock encryption for Edge
    return { 
      encrypted: Buffer.from(apiKey).toString('base64'), 
      hash: 'mock-hash' 
    };
  }
  
  const { encryptApiKey: fn } = require('./connection');
  return fn(apiKey);
}

export function decryptApiKey(encryptedData: string): string {
  if (isEdgeRuntime()) {
    // Mock decryption for Edge
    return Buffer.from(encryptedData, 'base64').toString('utf8');
  }
  
  const { decryptApiKey: fn } = require('./connection');
  return fn(encryptedData);
}

/**
 * Create mock database for Edge Runtime
 */
function createMockDatabase(): MockDatabase {
  const mockDb: MockDatabase = {
    prepare: () => ({
      run: () => ({ lastInsertRowid: 1, changes: 1 }),
      get: () => null,
      all: () => [],
    }),
    exec: () => mockDb,
    transaction: (fn: () => void) => () => fn(),
  };
  return mockDb;
}

export default { getDatabase, encryptApiKey, decryptApiKey };