/**
 * Server Initialization Module
 *
 * Pre-initializes critical server resources before first request.
 * Called from instrumentation.ts to warm up databases and caches.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

// Force Node.js runtime - this module uses Node.js APIs
export const runtime = 'nodejs';

/**
 * Initialize server resources
 * Called once when server starts.
 * Uses dynamic await import() so the Next.js bundler resolves @/ aliases.
 */
export async function initializeServer(): Promise<void> {
  // Lazy imports via dynamic import() — Next.js bundler resolves @/ aliases
  const { createLogger } = await import('@/lib/utils/logger');
  const logger = createLogger('ServerInit');

  const getDbMod = async () => {
    const mod = await import('@/lib/database/connection-shim');
    return mod.getDatabase();
  };

  logger.info('Initializing server resources...');

  // SEV-2: Fast-fail at boot if SQLite is not loaded. The previous
  // try/catch wrapper silently demoted this to "Database init will complete
  // lazily" which masked the silent-fallback into an in-memory store — a
  // mass data-loss anti-pattern. Replace with hard-fail so a misconfigured
  // deployment is loudly rejected by whatever orchestrator is launching it
  // (systemd / pm2 / Docker / k8s all surface non-zero exit codes).
  const db = await getDbMod();
  if (!db) {
    throw new Error(
      '[server-init] FATAL: Database initialization returned null — refusing to start ' +
        'with in-memory persistence (SEV-2 data-loss risk). Check upstream logs for the ' +
        'root cause (better-sqlite3 native binding load failure, schema drift, etc.).',
    );
  }
  logger.info('✓ Database initialized successfully');

  // SEV-2: Verify the SessionStore in particular resolved to a persisted
  // SQLite store, not the in-memory Map fallback. Throws if the fallback
  // was taken or if the SQLite handle is null.
  const { assertSessionStorePersisted } = await import('@/lib/storage/session-store');
  assertSessionStorePersisted();
  logger.info('✓ SessionStore persistence verified');

  // Pre-compile /api/chat route at startup to eliminate cold start latency
  // Dynamic import triggers module initialization without executing handlers
  /*
  try {
    logger.info('Pre-compiling /api/chat route...');
    await import('@/app/api/chat/route');
    logger.info('✓ /api/chat route compiled successfully');
  } catch (error) {
    logger.warn('⏳ /api/chat will compile on first request', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  */

  // Load all powers into the singleton registry (auto-inject, core SKILL.md, capabilities)
  // This must run before any request that calls appendAutoInjectPowers() or powersRegistry.get().
  try {
    const { loadAllPowers } = await import('@/lib/tools/loader');
    const result = await loadAllPowers();
    const loaded = result?.loaded || 0;
    const loadErrors = result?.errors || [];
    
    if (loadErrors.length > 0) {
      logger.warn('Power loading completed with errors', { errors: loadErrors });
    }
    logger.info(`✓ Powers loaded: ${loaded} registered`);
  } catch (error) {
    logger.warn('⏳ Power loading failed — powers will be unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Initialize task store and register cache export shutdown hook
  try {
    const { initializeTaskStore } = await import('@/lib/memory/task-persistence');
    await initializeTaskStore();
    logger.info('✓ Task store initialized');
  } catch (error) {
    logger.warn('⏳ Task store initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Register cache export shutdown hook (Node.js only)
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
    try {
      const { registerShutdownHook } = await import('@/lib/memory/cache-exporter');
      registerShutdownHook();
      logger.info('✓ Cache export shutdown hook registered');
    } catch (error) {
      logger.warn('⏳ Cache export shutdown hook registration failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Server initialization complete');
}
