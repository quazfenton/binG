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
    // SEV-2: DO NOT swallow initialization failures. The previous version
    // wrapped mod.initializeServer() in a try/catch that logged and continued
    // — which silently defeated the SEV-2 hard-fail policy on SessionStore
    // persistence. We now log + rethrow so the orchestration layer (systemd,
    // pm2, Docker, k8s) sees a non-zero process exit and surfaces the
    // misconfiguration to the operator instead of running with in-memory state.
    const mod = await import('@/lib/backend/server-init');
    try {
      await mod.initializeServer();
    } catch (error) {
      console.error(
        '[Instrumentation] FATAL: server initialization failed — refusing to start. ' +
          '(For SEV-2 specifically, this means SessionStore fell back to in-memory and ' +
          'all session/OAuth/VFS state would be lost on restart.)',
        error,
      );
      // Rethrow so the process exits non-zero. Stack trace stays intact for diagnosis.
      throw error;
    }
  }
}
