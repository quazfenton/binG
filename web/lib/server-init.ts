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

// Use require to avoid Edge Runtime analysis
const { getDatabase } = require('./database/connection');
const { createLogger } = require('./utils/logger');

const logger = createLogger('ServerInit');

/**
 * Initialize server resources
 * Called once when server starts
 */
export async function initializeServer(): Promise<void> {
  logger.info('Initializing server resources...');

  // Pre-initialize database to avoid first-request delay
  // This triggers database initialization synchronously
  const db = getDatabase();

  if (db) {
    logger.info('✓ Database initialized successfully');
  } else {
    logger.info('⏳ Database initialization in progress (will be ready shortly)');
    // Wait a bit for background initialization to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Pre-compile /api/chat route at startup to eliminate cold start latency
  // Dynamic import triggers module initialization without executing handlers
  try {
    logger.info('Pre-compiling /api/chat route...');
    await import('@/app/api/chat/route');
    logger.info('✓ /api/chat route compiled successfully');
  } catch (error) {
    logger.warn('⏳ /api/chat will compile on first request', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Load all powers into the singleton registry (auto-inject, core SKILL.md, capabilities)
  // This must run before any request that calls appendAutoInjectPowers() or powersRegistry.get().
  try {
    const { loadAllPowers } = require('./tools/loader');
    const { loaded, errors: loadErrors } = await loadAllPowers();
    if (loadErrors.length > 0) {
      logger.warn('Power loading completed with errors', { errors: loadErrors });
    }
    logger.info(`✓ Powers loaded: ${loaded} registered`);
  } catch (error) {
    logger.warn('⏳ Power loading failed — powers will be unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Server initialization complete');
}
