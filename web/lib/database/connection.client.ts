/**
 * Client-safe database stub
 * 
 * This file provides a no-op implementation for client-side code that imports
 * from the database module. The actual database operations are server-only.
 * 
 * Usage: Client components should NOT import from this directly.
 * This is only used when Turbopack analyzes server-only modules for client bundles.
 */

// Mock database that does nothing but satisfies type checks
const mockDb = {
  prepare: () => ({
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    get: () => null,
    all: () => [],
  }),
  exec: () => mockDb,
  pragma: () => {},
  transaction: (fn: Function) => fn,
  close: () => mockDb,
};

// Re-export mock versions for client-safe access
export const getDatabase = () => mockDb;
export const dbOps = {
  getDb: () => mockDb,
  createUser: () => ({}),
  getUserByEmail: () => null,
  getUserById: () => null,
  saveApiCredential: () => ({}),
  getApiCredential: () => null,
};
export const encryptApiKey = () => ({ encrypted: '', hash: '' });
export const decryptApiKey = () => '';
export const migrateLegacyEncryptedKeys = async () => ({ migrated: 0, errors: 0 });
export default getDatabase;
