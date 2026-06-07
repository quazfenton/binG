/**
 * Workspace Job Manager
 *
 * Persistent wrapper around EnhancedBackgroundJobsManager that persists
 * long-running background jobs to the workspace_jobs DB table so they
 * survive process restarts and can be rehydrated on bootstrap/reconnect.
 *
 * Architecture:
 *   User/AI starts a background job (training, build, crawler, etc.)
 *     → WorkspaceJobManager.startJob() creates the job via EnhancedBackgroundJobsManager
 *     → Job state is persisted to workspace_jobs table
 *     → Event listeners keep DB in sync (status, lastExecution, executionCount)
 *     → On reconnect/restart, rehydrate() loads all workspace jobs from DB
 *     → On workspace clear, all jobs are stopped and removed from DB
 *
 * @see packages/shared/agent/enhanced-background-jobs.ts — In-memory job engine
 */

import { createLogger } from '@/lib/utils/logger';
import { enhancedBackgroundJobsManager, type EnhancedJobConfig, type EnhancedJob, type JobExecutionResult } from '@bing/shared/agent/enhanced-background-jobs';

const logger = createLogger('WorkspaceJobManager');

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceJobRecord {
  id: string;
  workspaceId: string;
  userId: string;
  sessionId?: string;
  sandboxId: string;
  command: string;
  args?: string[];
  intervalSec: number;
  timeoutSec?: number;
  description?: string;
  tags?: string[];
  quotaCategory: 'compute' | 'io' | 'api';
  maxExecutions: number;
  stopCondition?: string;
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  createdAt: number;
  lastExecutedAt?: number;
  lastError?: string;
  executionCount: number;
  dedupId?: string;
}

// ============================================================================
// Workspace Job Manager
// ============================================================================

export class WorkspaceJobManager {
  /** Track which workspaces have had their event listeners registered */
  private registeredWorkspaces = new Set<string>();
  /** Whether event listeners have been set up on the jobs manager */
  private eventsRegistered = false;
  /** Whether DB schema has been loaded */
  private schemaLoaded = false;

  /**
   * Start a background job with DB persistence.
   */
  async startJob(
    workspaceId: string,
    userId: string,
    config: EnhancedJobConfig & { description?: string; tags?: string[]; quotaCategory?: 'compute' | 'io' | 'api'; maxExecutions?: number },
  ): Promise<EnhancedJob> {
    this.ensureSchemaLoaded();
    this.ensureEventListeners();

    const job = await enhancedBackgroundJobsManager.startJob(config);

    // Persist to DB
    try {
      this.persistJob(workspaceId, userId, job, config);
    } catch (err: any) {
      // Job is already running in-memory — DB failure is non-fatal
      logger.warn('Failed to persist job to DB (job still running in-memory)', {
        jobId: job.jobId,
        workspaceId,
        error: err.message,
      });
    }

    return job;
  }

  /**
   * Stop a background job and remove from DB.
   */
  async stopJob(jobId: string, reason?: string): Promise<boolean> {
    const stopped = await enhancedBackgroundJobsManager.stopJob(jobId, reason || 'Stopped via WorkspaceJobManager');

    if (stopped) {
      try {
        this.updateJobStatus(jobId, 'stopped');
      } catch (err: any) {
        logger.warn('Failed to update job status in DB after stop', { jobId, error: err.message });
      }
    }

    return stopped;
  }

  /**
   * Pause a background job.
   */
  pauseJob(jobId: string): boolean {
    const paused = enhancedBackgroundJobsManager.pauseJob(jobId);

    if (paused) {
      try {
        this.updateJobStatus(jobId, 'paused');
      } catch (err: any) {
        logger.warn('Failed to update job status in DB after pause', { jobId, error: err.message });
      }
    }

    return paused;
  }

  /**
   * Resume a paused background job.
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const resumed = await enhancedBackgroundJobsManager.resumeJob(jobId);

    if (resumed) {
      try {
        this.updateJobStatus(jobId, 'running');
      } catch (err: any) {
        logger.warn('Failed to update job status in DB after resume', { jobId, error: err.message });
      }
    }

    return resumed;
  }

  /**
   * Get a job by ID.
   */
  getJob(jobId: string): EnhancedJob | null {
    return enhancedBackgroundJobsManager.getJob(jobId);
  }

  /**
   * List all jobs for a workspace from the DB.
   * Falls back to in-memory listing if DB is unavailable.
   */
  listJobs(workspaceId: string, filters?: { status?: string }): WorkspaceJobRecord[] {
    try {
      const { getDatabase } = require('@/lib/database/connection');
      const db = getDatabase();
      if (!db) return [];

      let query = 'SELECT * FROM workspace_jobs WHERE workspace_id = ?';
      const params: any[] = [workspaceId];

      if (filters?.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params) as Array<{
        id: string;
        workspace_id: string;
        user_id: string;
        session_id: string | null;
        sandbox_id: string;
        command: string;
        args: string | null;
        interval_sec: number;
        timeout_sec: number | null;
        description: string | null;
        tags: string | null;
        quota_category: string;
        max_executions: number;
        stop_condition: string | null;
        status: string;
        created_at: number;
        last_executed_at: number | null;
        last_error: string | null;
        execution_count: number;
        dedup_id: string | null;
      }>;

      return rows.map(row => ({
        id: row.id,
        workspaceId: row.workspace_id,
        userId: row.user_id,
        sessionId: row.session_id ?? undefined,
        sandboxId: row.sandbox_id,
        command: row.command,
        args: row.args ? JSON.parse(row.args) : undefined,
        intervalSec: row.interval_sec,
        timeoutSec: row.timeout_sec ?? undefined,
        description: row.description ?? undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        quotaCategory: row.quota_category as 'compute' | 'io' | 'api',
        maxExecutions: row.max_executions,
        stopCondition: row.stop_condition ?? undefined,
        status: row.status as WorkspaceJobRecord['status'],
        createdAt: row.created_at,
        lastExecutedAt: row.last_executed_at ?? undefined,
        lastError: row.last_error ?? undefined,
        executionCount: row.execution_count,
        dedupId: row.dedup_id ?? undefined,
      }));
    } catch (err: any) {
      logger.warn('Failed to list jobs from DB, falling back to in-memory', { workspaceId, error: err.message });
      return [];
    }
  }

  /**
   * Get job statistics for a workspace.
   */
  getStats(workspaceId: string): {
    total: number;
    running: number;
    paused: number;
    stopped: number;
    completed: number;
    failed: number;
  } {
    const jobs = this.listJobs(workspaceId);
    return {
      total: jobs.length,
      running: jobs.filter(j => j.status === 'running').length,
      paused: jobs.filter(j => j.status === 'paused').length,
      stopped: jobs.filter(j => j.status === 'stopped').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
    };
  }

  /**
   * Rehydrate workspace jobs from DB on reconnect/restart.
   * Only restarts jobs that are in 'running' or 'paused' status.
   */
  async rehydrate(workspaceId: string): Promise<number> {
    try {
      const { getDatabase } = require('@/lib/database/connection');
      const db = getDatabase();
      if (!db) return 0;

      const rows = db.prepare(
        `SELECT * FROM workspace_jobs 
         WHERE workspace_id = ? 
           AND status IN ('running', 'paused')
         ORDER BY created_at ASC`
      ).all(workspaceId) as Array<{
        id: string;
        session_id: string | null;
        sandbox_id: string;
        command: string;
        args: string | null;
        interval_sec: number;
        timeout_sec: number | null;
        description: string | null;
        tags: string | null;
        quota_category: string;
        max_executions: number;
        stop_condition: string | null;
        status: string;
      }>;

      let restarted = 0;
      for (const row of rows) {
        try {
          // Only rehydrate if the job isn't already running in-memory
          const existing = enhancedBackgroundJobsManager.getJob(row.id);
          if (existing && existing.status !== 'stopped') {
            logger.debug('Job already active in-memory, skipping rehydration', { jobId: row.id });
            continue;
          }

          const config: EnhancedJobConfig = {
            jobId: row.id,
            sessionId: row.session_id ?? undefined,
            sandboxId: row.sandbox_id,
            command: row.command,
            args: row.args ? JSON.parse(row.args) : undefined,
            interval: row.interval_sec,
            timeout: row.timeout_sec ?? undefined,
            description: row.description ?? undefined,
            tags: row.tags ? JSON.parse(row.tags) : undefined,
            quotaCategory: row.quota_category as 'compute' | 'io' | 'api' | undefined,
            maxExecutions: row.max_executions,
            stopCondition: row.stop_condition ?? undefined,
          };

          await enhancedBackgroundJobsManager.startJob(config);
          restarted++;
          logger.info('Rehydrated workspace job', { jobId: row.id, workspaceId, command: row.command.slice(0, 80) });
        } catch (err: any) {
          logger.warn('Failed to rehydrate individual job', {
            jobId: row.id,
            workspaceId,
            error: err.message,
          });
          // Mark the failed job as stopped so it doesn't block future rehydration attempts
          try {
            db.prepare('UPDATE workspace_jobs SET status = ? WHERE id = ?').run('stopped', row.id);
          } catch { /* best effort */ }
        }
      }

      if (restarted > 0) {
        logger.info('Workspace jobs rehydrated', { workspaceId, count: restarted });
      }

      return restarted;
    } catch (err: any) {
      logger.warn('Failed to rehydrate jobs from DB', { workspaceId, error: err.message });
      return 0;
    }
  }

  /**
   * Clear all jobs for a workspace — stops running jobs and removes from DB.
   */
  async clearWorkspace(workspaceId: string): Promise<void> {
    // Stop all running/paused jobs via the in-memory manager
    const jobs = this.listJobs(workspaceId);
    for (const job of jobs) {
      if (job.status === 'running' || job.status === 'paused') {
        try {
          await enhancedBackgroundJobsManager.stopJob(job.id, 'Workspace cleared');
        } catch (err: any) {
          logger.warn('Failed to stop job during workspace clear', { jobId: job.id, error: err.message });
        }
      }
    }

    // Remove from DB
    try {
      const { getDatabase } = require('@/lib/database/connection');
      const db = getDatabase();
      if (db) {
        db.prepare('DELETE FROM workspace_jobs WHERE workspace_id = ?').run(workspaceId);
      }
    } catch (err: any) {
      logger.warn('Failed to remove jobs from DB during workspace clear', { workspaceId, error: err.message });
    }

    this.registeredWorkspaces.delete(workspaceId);
    logger.info('Workspace jobs cleared', { workspaceId });
  }

  // ============================================================================
  // DB Persistence
  // ============================================================================

  /**
   * Persist a newly created job to the workspace_jobs table.
   */
  private persistJob(
    workspaceId: string,
    userId: string,
    job: EnhancedJob,
    config: EnhancedJobConfig & { description?: string; tags?: string[]; quotaCategory?: 'compute' | 'io' | 'api'; maxExecutions?: number },
  ): void {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO workspace_jobs (
        id, workspace_id, user_id, session_id, sandbox_id,
        command, args, interval_sec, timeout_sec, description, tags,
        quota_category, max_executions, stop_condition,
        status, created_at, last_executed_at, last_error, execution_count, dedup_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      job.jobId,
      workspaceId,
      userId,
      job.sessionId || null,
      job.sandboxId,
      job.command,
      job.args?.length ? JSON.stringify(job.args) : null,
      job.interval,
      job.timeout || null,
      job.description || null,
      job.tags?.length ? JSON.stringify(job.tags) : null,
      job.quotaCategory || 'compute',
      job.maxExecutions ?? 1000,
      job.stopCondition || null,
      job.status,
      job.createdAt ? Math.floor(job.createdAt.getTime() / 1000) : Math.floor(Date.now() / 1000),
      job.lastExecuted ? Math.floor(job.lastExecuted.getTime() / 1000) : null,
      job.lastError?.message?.slice(0, 500) || null,
      job.executionCount,
      job.dedupId || null,
    );

    logger.debug('Job persisted to DB', { jobId: job.jobId, workspaceId });
  }

  /**
   * Update a job's status in the DB.
   */
  private updateJobStatus(jobId: string, status: string): void {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return;

    db.prepare('UPDATE workspace_jobs SET status = ? WHERE id = ?').run(status, jobId);
  }

  /**
   * Update a job's execution tracking in the DB.
   */
  private updateJobExecution(jobId: string, executionCount: number, lastExecutedAt: number): void {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return;

    db.prepare(
      'UPDATE workspace_jobs SET execution_count = ?, last_executed_at = ? WHERE id = ?'
    ).run(executionCount, lastExecutedAt, jobId);
  }

  /**
   * Update a job's last error in the DB.
   */
  private updateJobError(jobId: string, error: string): void {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return;

    db.prepare('UPDATE workspace_jobs SET last_error = ? WHERE id = ?').run(error.slice(0, 500), jobId);
  }

  // ============================================================================
  // Schema & Events
  // ============================================================================

  /**
   * Ensure the workspace_jobs table exists.
   */
  private ensureSchemaLoaded(): void {
    if (this.schemaLoaded) return;
    this.schemaLoaded = true;

    try {
      const { getDatabase } = require('@/lib/database/connection');
      const db = getDatabase();
      if (!db) return;

      const { getSqlFromFile } = require('@/lib/database/schema/loader');
      const schemaSql = getSqlFromFile('workspace-schema');
      if (schemaSql) {
        // Extract just the workspace_jobs CREATE TABLE statement
        const jobsMatch = schemaSql.match(/CREATE TABLE IF NOT EXISTS workspace_jobs[\s\S]*?;/);
        if (jobsMatch) {
          db.exec(jobsMatch[0]);
          logger.debug('workspace_jobs schema loaded');
        }
      }
    } catch (err: any) {
      logger.warn('Failed to load workspace_jobs schema', { error: err.message });
    }
  }

  /**
   * Register event listeners on the EnhancedBackgroundJobsManager to keep
   * the DB in sync. Only runs once (idempotent).
   */
  private ensureEventListeners(): void {
    if (this.eventsRegistered) return;
    this.eventsRegistered = true;

    // Job executed — update execution count and last executed timestamp
    enhancedBackgroundJobsManager.on('job:executed', (result: JobExecutionResult) => {
      try {
        const job = enhancedBackgroundJobsManager.getJob(result.jobId);
        if (job) {
          this.updateJobExecution(
            job.jobId,
            job.executionCount,
            job.lastExecuted ? Math.floor(job.lastExecuted.getTime() / 1000) : Math.floor(Date.now() / 1000),
          );
        }
      } catch (err: any) {
        logger.warn('Failed to persist job execution', { jobId: result.jobId, error: err.message });
      }
    });

    // Job stopped
    enhancedBackgroundJobsManager.on('job:stopped', (jobId: string) => {
      try {
        this.updateJobStatus(jobId, 'stopped');
      } catch (err: any) {
        logger.warn('Failed to persist job stop', { jobId, error: err.message });
      }
    });

    // Job paused
    enhancedBackgroundJobsManager.on('job:paused', (jobId: string) => {
      try {
        this.updateJobStatus(jobId, 'paused');
      } catch (err: any) {
        logger.warn('Failed to persist job pause', { jobId, error: err.message });
      }
    });

    // Job completed (max executions or stop condition)
    enhancedBackgroundJobsManager.on('job:completed', (jobId: string) => {
      try {
        this.updateJobStatus(jobId, 'completed');
      } catch (err: any) {
        logger.warn('Failed to persist job completion', { jobId, error: err.message });
      }
    });

    // Job failed
    enhancedBackgroundJobsManager.on('job:failed', (jobId: string, error: Error) => {
      try {
        this.updateJobError(jobId, error.message);
      } catch (err: any) {
        logger.warn('Failed to persist job failure', { jobId, error: err.message });
      }
    });

    // Job resumed — keep DB in sync if resume happens outside the wrapper
    enhancedBackgroundJobsManager.on('job:resumed', (jobId: string) => {
      try {
        this.updateJobStatus(jobId, 'running');
      } catch (err: any) {
        logger.warn('Failed to persist job resume', { jobId, error: err.message });
      }
    });

    logger.debug('WorkspaceJobManager event listeners registered');
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceJobManager = new WorkspaceJobManager();
