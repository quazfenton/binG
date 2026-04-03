/**
 * Server Startup Initialization for Event System
 *
 * Initialize event system on server startup.
 * Import this module in your app's root layout or middleware.
 *
 * @module lib/events/init
 */

import { initializeEventSystem, startEventProcessing, stopEventProcessing } from '@/lib/events';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Init');

let initialized = false;
let timers: { schedulerTimer: NodeJS.Timeout; processorTimer: NodeJS.Timeout } | null = null;

/**
 * Initialize event system on server startup
 * Call this once in your app's root layout or middleware
 */
export async function initializeEventSystemOnStartup(): Promise<void> {
  if (initialized) {
    logger.warn('Event system already initialized');
    return;
  }

  try {
    logger.info('Initializing event system...');

    // Initialize all tables and register handlers
    await initializeEventSystem();

    // Start background processing
    timers = startEventProcessing({
      schedulerIntervalMs: 5 * 60 * 1000, // 5 minutes
      processorIntervalMs: 5000, // 5 seconds
    });

    initialized = true;

    logger.info('Event system initialized successfully', {
      schedulerIntervalMs: 5 * 60 * 1000,
      processorIntervalMs: 5000,
    });
  } catch (error: any) {
    logger.error('Failed to initialize event system', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Stop event system on server shutdown
 * Call this in your cleanup handler
 */
export function stopEventSystemOnShutdown(): void {
  if (!initialized || !timers) {
    logger.warn('Event system not initialized');
    return;
  }

  try {
    logger.info('Stopping event system...');

    stopEventProcessing(timers);

    initialized = false;
    timers = null;

    logger.info('Event system stopped successfully');
  } catch (error: any) {
    logger.error('Failed to stop event system', {
      error: error.message,
    });
  }
}

/**
 * Check if event system is initialized
 */
export function isEventSystemInitialized(): boolean {
  return initialized;
}

/**
 * Get event system status
 */
export async function getEventSystemStatus(): Promise<{
  initialized: boolean;
  schedulerRunning: boolean;
  processorRunning: boolean;
  stats?: any;
}> {
  const status = {
    initialized,
    schedulerRunning: false,
    processorRunning: false,
    stats: undefined,
  };

  if (initialized) {
    try {
      const { getEventStats, getProcessingStats } = await import('@/lib/events');
      const [eventStats, processingStats] = await Promise.all([
        getEventStats(),
        getProcessingStats(),
      ]);

      status.stats = {
        ...eventStats,
        ...processingStats,
      };
      status.schedulerRunning = true;
      status.processorRunning = true;
    } catch (error: any) {
      logger.error('Failed to get event system status', { error: error.message });
    }
  }

  return status;
}

// Auto-initialize in development (optional)
if (process.env.NODE_ENV === 'development' && process.env.EVENT_SYSTEM_AUTO_INIT === 'true') {
  initializeEventSystemOnStartup().catch(console.error);

  // Cleanup on process exit
  process.on('SIGINT', () => stopEventSystemOnShutdown());
  process.on('SIGTERM', () => stopEventSystemOnShutdown());
}
