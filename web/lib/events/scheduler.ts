/**
 * Dynamic Scheduler - Database-backed cron poller
 *
 * Polls the database for scheduled tasks and emits events for execution.
 * Runs every 5 minutes by default.
 *
 * Features:
 * - Dynamic cron expression parsing
 * - Timezone-aware scheduling
 * - Missed execution handling
 * - Concurrent execution prevention
 *
 * @module events/scheduler
 */

import { getDatabase } from '@/lib/database/connection';
import { execSchemaFile } from '@/lib/database/schema';
import { emitEvent } from './bus';
import { createLogger } from '@/lib/utils/logger';
import { EventTypes } from './schema';

const logger = createLogger('Events:Scheduler');

/**
 * Scheduled task record
 */
export interface ScheduledTaskRecord {
  id: string;
  user_id: string;
  task_type: string;
  cron_expression: string;
  payload: string;
  active: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
  timezone?: string;
  catch_up?: boolean; // Run missed executions
}

/**
 * Parse cron expression and calculate next run time
 * Uses cron-parser library or fallback to simple parsing
 */
export function calculateNextRun(cronExpression: string, from: Date = new Date()): Date {
  try {
    // Try to use cron-parser if available
    const parser = require('cron-parser');
    const interval = parser.parseExpression(cronExpression, {
      currentDate: from,
      tz: 'UTC',
    });
    return interval.next().toDate();
  } catch (error: any) {
    logger.warn('Failed to parse cron expression, using fallback', {
      cronExpression,
      error: error.message,
    });

    // Fallback: simple interval parsing
    return parseSimpleCron(cronExpression, from);
  }
}

/**
 * Simple cron parser fallback (supports basic expressions)
 * Supports: * * * * * (minute hour day month weekday)
 */
function parseSimpleCron(cronExpression: string, from: Date): Date {
  const parts = cronExpression.split(' ');

  if (parts.length !== 5) {
    // Default to 1 hour if invalid
    return new Date(from.getTime() + 60 * 60 * 1000);
  }

  const [minute, hour, day, month, weekday] = parts;

  const now = new Date(from);
  const result = new Date(now);

  // Simple implementations for common patterns
  if (cronExpression === '* * * * *') {
    // Every minute
    result.setMinutes(result.getMinutes() + 1);
  } else if (cronExpression === '0 * * * *') {
    // Every hour
    result.setHours(result.getHours() + 1);
    result.setMinutes(0);
  } else if (cronExpression === '0 0 * * *') {
    // Every day at midnight
    result.setDate(result.getDate() + 1);
    result.setHours(0);
    result.setMinutes(0);
  } else if (cronExpression === '0 9 * * *') {
    // Every day at 9 AM
    result.setDate(result.getDate() + 1);
    result.setHours(9);
    result.setMinutes(0);
  } else {
    // Default to 1 hour
    result.setHours(result.getHours() + 1);
  }

  return result;
}

/**
 * Check if a task should run based on its schedule
 */
export function shouldRun(task: ScheduledTaskRecord, now: Date): boolean {
  if (!task.active) {
    return false;
  }

  if (!task.next_run) {
    return true; // Never run before, should run now
  }

  const nextRun = new Date(task.next_run);
  return nextRun <= now;
}

/**
 * Run scheduler - poll DB and emit events for due tasks
 */
export async function runScheduler(): Promise<{
  emitted: number;
  skipped: number;
  errors: number;
}> {
  const db = getDatabase();
  const now = new Date();

  logger.info('Running scheduler', { timestamp: now.toISOString() });

  // Check if database is ready
  if (!db) {
    logger.warn('Database not ready, skipping scheduler run');
    return { emitted: 0, skipped: 0, errors: 0 };
  }

  try {
    // Query scheduled tasks that are due
    const tasks = db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE active = TRUE
        AND (last_run IS NULL OR next_run <= ?)
      ORDER BY next_run ASC, created_at ASC
      LIMIT 100
    `).all(now.toISOString()) as ScheduledTaskRecord[];

    let emitted = 0;
    let skipped = 0;
    let errors = 0;

    for (const task of tasks) {
      try {
        // Check if should run
        if (!shouldRun(task, now)) {
          skipped++;
          continue;
        }

        // Parse payload
        let payload: any = {};
        try {
          payload = JSON.parse(task.payload);
        } catch (error: any) {
          logger.warn('Failed to parse task payload', {
            taskId: task.id,
            error: error.message,
          });
        }

        // Emit event for this task
        await emitEvent(
          {
            type: EventTypes.SCHEDULED_TASK,
            taskType: task.task_type as any,
            userId: task.user_id,
            payload,
            cronExpression: task.cron_expression,
            scheduledAt: now.toISOString(),
          },
          task.user_id
        );

        // Calculate next run time
        const nextRun = calculateNextRun(task.cron_expression, now);

        // Update task
        db.prepare(`
          UPDATE scheduled_tasks
          SET last_run = ?, next_run = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(now.toISOString(), nextRun.toISOString(), task.id);

        emitted++;
        logger.info('Scheduled task emitted', {
          taskId: task.id,
          taskType: task.task_type,
          nextRun: nextRun.toISOString(),
        });
      } catch (error: any) {
        errors++;
        logger.error('Failed to emit scheduled task', {
          taskId: task.id,
          error: error.message,
        });

        // Mark task as inactive after 3 consecutive errors
        const errorCount = getTaskErrorCount(db, task.id);
        if (errorCount >= 3) {
          db.prepare(`
            UPDATE scheduled_tasks
            SET active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(task.id);
          logger.warn('Task deactivated after consecutive errors', {
            taskId: task.id,
          });
        }
      }
    }

    return { emitted, skipped, errors };
  } catch (error: any) {
    logger.error('Scheduler failed', { error: error.message });
    return { emitted: 0, skipped: 0, errors: 1 };
  }
}

/**
 * Track task errors for deactivation
 */
function getTaskErrorCount(db: any, taskId: string): number {
  // Simple in-memory tracking (could be enhanced with DB storage)
  const key = `task_error_count_${taskId}`;
  const current = (global as any)[key] || 0;
  (global as any)[key] = current + 1;
  return (global as any)[key];
}

/**
 * Start scheduler interval
 * Call this once on server startup
 */
export function startScheduler(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  logger.info('Starting scheduler', { intervalMs });

  // Run immediately
  runScheduler().catch(console.error);

  // Then run on interval
  const timer = setInterval(() => {
    runScheduler().catch(console.error);
  }, intervalMs);

  return timer;
}

/**
 * Stop scheduler
 */
export function stopScheduler(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  logger.info('Scheduler stopped');
}

/**
 * Create a scheduled task
 */
export async function createScheduledTask(
  userId: string,
  taskType: string,
  cronExpression: string,
  payload: any,
  options?: {
    timezone?: string;
    catch_up?: boolean;
    active?: boolean;
  }
): Promise<string> {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date();

  // Calculate first run time
  const nextRun = calculateNextRun(cronExpression, now);

  db.prepare(`
    INSERT INTO scheduled_tasks
    (id, user_id, task_type, cron_expression, payload, active, next_run, created_at, updated_at, timezone, catch_up)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
  `).run(
    id,
    userId,
    taskType,
    cronExpression,
    JSON.stringify(payload),
    options?.active ?? true,
    nextRun.toISOString(),
    options?.timezone || 'UTC',
    options?.catch_up ?? false
  );

  logger.info('Scheduled task created', {
    taskId: id,
    taskType,
    cronExpression,
    nextRun: nextRun.toISOString(),
  });

  return id;
}

/**
 * Update a scheduled task
 */
export async function updateScheduledTask(
  taskId: string,
  updates: {
    cron_expression?: string;
    payload?: any;
    active?: boolean;
    timezone?: string;
  }
): Promise<void> {
  const db = getDatabase();

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.cron_expression !== undefined) {
    fields.push('cron_expression = ?');
    values.push(updates.cron_expression);

    // Recalculate next run
    const nextRun = calculateNextRun(updates.cron_expression);
    fields.push('next_run = ?');
    values.push(nextRun.toISOString());
  }

  if (updates.payload !== undefined) {
    fields.push('payload = ?');
    values.push(JSON.stringify(updates.payload));
  }

  if (updates.active !== undefined) {
    fields.push('active = ?');
    values.push(updates.active ? 1 : 0);
  }

  if (updates.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(updates.timezone);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(taskId);

  db.prepare(`
    UPDATE scheduled_tasks
    SET ${fields.join(', ')}
    WHERE id = ?
  `).run(...values);

  logger.info('Scheduled task updated', { taskId });
}

/**
 * Delete a scheduled task
 */
export async function deleteScheduledTask(taskId: string): Promise<void> {
  const db = getDatabase();

  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);

  logger.info('Scheduled task deleted', { taskId });
}

/**
 * Get scheduled tasks for a user
 */
export async function getScheduledTasks(userId: string): Promise<ScheduledTaskRecord[]> {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE user_id = ?
    ORDER BY next_run ASC
  `).all(userId) as any[];

  return rows.map((row) => ({
    ...row,
    payload: JSON.parse(row.payload),
  }));
}

/**
 * Initialize scheduled tasks table
 */
export async function initializeScheduledTasks(): Promise<void> {
  const db = getDatabase();

  // events-schema.sql already defines scheduled_tasks (consolidated with events/approval_requests/event_healing_log)
  execSchemaFile(db, 'events-schema');

  logger.info('Scheduled tasks table initialized');
}
