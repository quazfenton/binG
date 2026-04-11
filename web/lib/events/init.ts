/**
 * Server Startup Initialization for Event System
 *
 * Initialize event system on server startup.
 * Detects Trigger.dev availability and configures the appropriate backend:
 * - Trigger.dev: events dispatched to remote worker (durable, long-running)
 * - Local fallback: SQLite event store with polling processor
 *
 * Import this module in your app's root layout or middleware.
 *
 * @module lib/events/init
 */

import { initializeEventSystem, startEventProcessing, stopEventProcessing } from '@/lib/events';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Init');

let initialized = false;
let backend: 'trigger' | 'local' = 'local';
let timers: { schedulerTimer: NodeJS.Timeout; processorTimer: NodeJS.Timeout } | null = null;

/**
 * Check if Trigger.dev is available and configured
 */
async function detectTriggerBackend(): Promise<'trigger' | 'local'> {
  // Require both SDK and secret key
  if (!process.env.TRIGGER_SECRET_KEY) {
    logger.debug('Trigger.dev not configured (TRIGGER_SECRET_KEY not set)');
    return 'local';
  }

  try {
    const { isTriggerAvailable } = await import('./trigger/utils');
    const available = await isTriggerAvailable();
    if (available) {
      logger.info('Trigger.dev SDK detected and configured');
      return 'trigger';
    }
  } catch {
    // SDK not available
  }
  logger.debug('Trigger.dev SDK not available');
  return 'local';
}

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

    // Detect backend
    backend = await detectTriggerBackend();

    // Initialize all tables and register handlers
    await initializeEventSystem();

    if (backend === 'trigger') {
      logger.info('Event system initialized with Trigger.dev backend', {
        note: 'Events will be dispatched to Trigger.dev workers. Local polling disabled.',
      });
      // Don't start local polling when Trigger.dev is configured
      timers = null;
    } else {
      // Start local background processing
      timers = startEventProcessing({
        schedulerIntervalMs: 5 * 60 * 1000, // 5 minutes
        processorIntervalMs: 5000, // 5 seconds
      });

      logger.info('Event system initialized with local backend', {
        schedulerIntervalMs: 5 * 60 * 1000,
        processorIntervalMs: 5000,
        note: 'Set TRIGGER_SECRET_KEY to enable durable execution via Trigger.dev',
      });
    }

    initialized = true;
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
  if (!initialized) {
    logger.warn('Event system not initialized');
    return;
  }

  try {
    logger.info('Stopping event system...', { backend });

    if (timers) {
      stopEventProcessing(timers);
    }

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
  backend: 'trigger' | 'local';
  schedulerRunning: boolean;
  processorRunning: boolean;
  stats?: any;
}> {
  const status = {
    initialized,
    backend,
    schedulerRunning: false,
    processorRunning: false,
    stats: undefined,
  };

  if (initialized) {
    try {
      const { getEventStats, getProcessingStats } = await import('@/lib/events');
      const [eventStats, processingStats] = await Promise.all([
        getEventStats(),
        backend === 'local' ? getProcessingStats() : Promise.resolve(null),
      ]);

      status.stats = {
        ...eventStats,
        ...(processingStats || {}),
        backend,
      };
      status.schedulerRunning = backend === 'local' && timers !== null;
      status.processorRunning = backend === 'local' && timers !== null;
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
