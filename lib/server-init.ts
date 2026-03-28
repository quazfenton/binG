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
  
  logger.info('Server initialization complete');
}
