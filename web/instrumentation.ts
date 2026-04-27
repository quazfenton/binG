/**
 * Next.js Instrumentation File
 * 
 * Runs when the server starts - perfect for initializing databases, caches, etc.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * 
 * FORCE NODE.JS RUNTIME - This file initializes server-side resources
 * that require Node.js APIs (database, file system, etc.)
 */
export const runtime = 'nodejs';

/**
 * Initialize server resources
 * Uses dynamic require to avoid Edge Runtime analysis
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    /*
    try {
      // Use require instead of import to avoid Edge Runtime analysis
      const { initializeServer } = require('./lib/server-init');
      await initializeServer();
    } catch (error) {
      console.error('[Instrumentation] Failed to initialize server:', error);
    }
    */
  }
}
