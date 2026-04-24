/**
 * Event Store - SQLite append-only event persistence
 *
 * Provides durable storage for all events with support for:
 * - Event retrieval by status/type/user
 * - Status transitions (pending → running → completed/failed)
 * - Retry tracking
 * - Replay of failed events
 *
 * @module events/store
 */

import { getDatabase } from '@/lib/database/connection';
import { execSchemaFile } from '@/lib/database/schema';
import { AnyEvent, EventType } from './schema';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:Store');

/**
 * Event record interface (database row)
 */
export interface EventRecord {
  id: string;
  type: string;
  payload: any;
  status: EventStatus;
  retryCount: number;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  userId: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Event status enum
 */
export type EventStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Create a new event in the store
 */
export async function createEvent(
  event: AnyEvent,
  userId: string,
  sessionId?: string
): Promise<EventRecord> {
  const db = getDatabase();
  const id = crypto.randomUUID();

  try {
    const stmt = db.prepare(`
      INSERT INTO events
      (id, type, payload, status, retry_count, user_id, session_id, created_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(id, event.type, JSON.stringify(event), userId, sessionId || null);

    logger.info('Event created', {
      eventId: id,
      type: event.type,
      userId,
      sessionId,
    });

    return {
      id,
      type: event.type,
      payload: event,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      userId,
      sessionId,
    };
  } catch (error: any) {
    logger.error('Failed to create event', {
      error: error.message,
      event,
      userId,
    });
    throw error;
  }
}

/**
 * Get pending events for processing
 */
export async function getPendingEvents(limit: number = 10): Promise<EventRecord[]> {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];

    return rows.map((row) => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  } catch (error: any) {
    logger.error('Failed to get pending events', { error: error.message });
    return [];
  }
}

/**
 * Get events by status
 */
export async function getEventsByStatus(status: EventStatus, limit: number = 50): Promise<EventRecord[]> {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE status = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(status, limit) as any[];

    return rows.map((row) => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  } catch (error: any) {
    logger.error('Failed to get events by status', { error: error.message, status });
    return [];
  }
}

/**
 * Get events by user
 */
export async function getEventsByUser(userId: string, limit: number = 50): Promise<EventRecord[]> {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(userId, limit) as any[];

    return rows.map((row) => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  } catch (error: any) {
    logger.error('Failed to get events by user', { error: error.message, userId });
    return [];
  }
}

/**
 * Get events by session
 */
export async function getEventsBySession(sessionId: string, limit: number = 100): Promise<EventRecord[]> {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(sessionId, limit) as any[];

    return rows.map((row) => ({
      ...row,
      payload: JSON.parse(row.payload),
    }));
  } catch (error: any) {
    logger.error('Failed to get events by session', { error: error.message, sessionId });
    return [];
  }
}

/**
 * Get event by ID
 */
export async function getEventById(id: string): Promise<EventRecord | null> {
  const db = getDatabase();

  try {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any;

    if (!row) {
      return null;
    }

    return {
      ...row,
      payload: JSON.parse(row.payload),
    };
  } catch (error: any) {
    logger.error('Failed to get event by ID', { error: error.message, id });
    return null;
  }
}

/**
 * Mark event as running
 */
export async function markEventRunning(id: string): Promise<void> {
  const db = getDatabase();

  try {
    db.prepare(`
      UPDATE events
      SET status = 'running',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    logger.debug('Event marked as running', { eventId: id });
  } catch (error: any) {
    logger.error('Failed to mark event as running', { error: error.message, id });
    throw error;
  }
}

/**
 * Mark event as complete
 */
export async function markEventComplete(id: string, result?: any): Promise<void> {
  const db = getDatabase();

  try {
    db.prepare(`
      UPDATE events
      SET status = 'completed',
          updated_at = CURRENT_TIMESTAMP,
          completed_at = CURRENT_TIMESTAMP,
          metadata = ?
      WHERE id = ?
    `).run(JSON.stringify({ result }), id);

    logger.info('Event completed', { eventId: id });
  } catch (error: any) {
    logger.error('Failed to mark event as complete', { error: error.message, id });
    throw error;
  }
}

/**
 * Mark event as failed
 */
export async function markEventFailed(id: string, error: string): Promise<void> {
  const db = getDatabase();

  try {
    db.prepare(`
      UPDATE events
      SET status = 'failed',
          error = ?,
          retry_count = retry_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(error, id);

    logger.warn('Event failed', { eventId: id, error });
  } catch (err: any) {
    logger.error('Failed to mark event as failed', { error: err.message, id });
    throw err;
  }
}

/**
 * Mark event as cancelled
 */
export async function markEventCancelled(id: string): Promise<void> {
  const db = getDatabase();

  try {
    db.prepare(`
      UPDATE events
      SET status = 'cancelled',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    logger.info('Event cancelled', { eventId: id });
  } catch (error: any) {
    logger.error('Failed to mark event as cancelled', { error: error.message, id });
    throw error;
  }
}

/**
 * Replay failed events (reset to pending for retry)
 */
export async function replayFailedEvents(maxRetries: number = 3): Promise<number> {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      UPDATE events
      SET status = 'pending',
          error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'failed'
        AND retry_count < ?
    `);

    const result = stmt.run(maxRetries);

    logger.info('Replayed failed events', {
      replayed: result.changes,
      maxRetries,
    });

    return result.changes;
  } catch (error: any) {
    logger.error('Failed to replay failed events', { error: error.message });
    return 0;
  }
}

/**
 * Get event statistics
 */
export async function getEventStats(): Promise<{
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}> {
  const db = getDatabase();

  try {
    const stats: any = {};

    const total = db.prepare('SELECT COUNT(*) as count FROM events').get() as any;
    stats.total = total.count;

    const pending = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'pending'").get() as any;
    stats.pending = pending.count;

    const running = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'running'").get() as any;
    stats.running = running.count;

    const completed = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'completed'").get() as any;
    stats.completed = completed.count;

    const failed = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'failed'").get() as any;
    stats.failed = failed.count;

    const cancelled = db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'cancelled'").get() as any;
    stats.cancelled = cancelled.count;

    return stats as any;
  } catch (error: any) {
    logger.error('Failed to get event statistics', { error: error.message });
    return { total: 0, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  }
}

/**
 * Purge old completed events (cleanup)
 */
export async function purgeOldEvents(olderThanDays: number = 7): Promise<number> {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      DELETE FROM events
      WHERE status IN ('completed', 'cancelled')
        AND completed_at < datetime('now', ?)
    `);

    const result = stmt.run(`-${olderThanDays} days`);

    logger.info('Purged old events', {
      purged: result.changes,
      olderThanDays,
    });

    return result.changes;
  } catch (error: any) {
    logger.error('Failed to purge old events', { error: error.message });
    return 0;
  }
}

/**
 * Initialize event store (create tables if not exist)
 */
export async function initializeEventStore(): Promise<void> {
  const db = getDatabase();

  try {
    // Single source of truth — events-schema.sql defines events + all related tables
    execSchemaFile(db, 'events-schema');

    logger.info('Event store initialized');
  } catch (error: any) {
    logger.error('Failed to initialize event store', { error: error.message });
    throw error;
  }
}
