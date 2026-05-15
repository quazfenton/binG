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
 * Uses dynamic import with bundler-resolved paths (@/ alias)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // Use dynamic import() so the Next.js bundler resolves the @/ alias
      const mod = await import('@/lib/backend/server-init');
      await mod.initializeServer();
    } catch (error) {
      console.error('[Instrumentation] Failed to initialize server:', error);
    }
  }
}
