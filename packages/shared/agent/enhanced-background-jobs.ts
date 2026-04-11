/**
 * Enhanced Background Jobs Integration
 *
 * Integrates background jobs with session management, execution graph,
 * and unified agent state for comprehensive job tracking and execution.
 *
 * Features:
 * - Session-aware job management
 * - Execution graph integration for job tracking
 * - VFS state synchronization
 * - Quota-aware job scheduling
 * - Event emission for real-time updates
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/utils/logger';
import type { ExecutionGraph, ExecutionNode } from './execution-graph';

const logger = createLogger('Agent:EnhancedBackgroundJobs');

// ============================================================================
// Types
// ============================================================================

/**
 * Session interface for quota checking (avoid circular dependency)
 */
interface SessionLike {
  quota?: {
    computeMinutes: number;
    computeUsed: number;
    storageBytes: number;
    storageUsed: number;
    apiCalls: number;
    apiCallsUsed: number;
  };
  metrics?: {
    computeTime?: number;
    ioOps?: number;
    apiCalls?: number;
  };
}

export interface EnhancedJobConfig {
  jobId?: string;
  sessionId?: string;
  sandboxId: string;
  command: string;
  args?: string[];
  interval: number; // seconds
  timeout?: number; // seconds
  description?: string;
  tags?: string[];
  quotaCategory?: 'compute' | 'io' | 'api';
  maxExecutions?: number;
  stopCondition?: string; // LLM-evaluated condition to stop job
}

/**
 * Enhanced job interface with separated time units
 * - Public API uses seconds (interval, timeout)
 * - Internal timers use milliseconds (intervalMs, timeoutMs)
 */
export interface EnhancedJob extends Omit<EnhancedJobConfig, 'interval' | 'timeout'> {
  jobId: string;
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  createdAt: Date;
  lastExecuted?: Date;
  nextExecution?: Date;
  executionCount: number;
  lastError?: Error;
  lastResult?: JobExecutionResult;
  executionGraphId?: string;
  executionGraphNodeId?: string;
  // Public API: seconds
  interval: number;
  timeout?: number;
  // Internal: milliseconds (not exposed in public API)
  intervalMs: number;
  timeoutMs?: number;
  // Loop token to prevent duplicate loops on resume
  loopToken?: number;
}

export interface JobExecutionResult {
  jobId: string;
  sandboxId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  quotaUsed: {
    computeMs: number;
    ioOps: number;
    apiCalls: number;
  };
  error?: Error;
}

export interface JobExecutor {
  execCommand(
    sandboxId: string,
    command: string,
    args?: string[],
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  ensureBackground?(sandboxId: string, job: EnhancedJob): Promise<void>;
  removeBackground?(sandboxId: string, jobId: string): Promise<void>;
}

export interface EnhancedBackgroundJobsEvents {
  'job:started': (job: EnhancedJob) => void;
  'job:executed': (result: JobExecutionResult) => void;
  'job:stopped': (jobId: string, reason: string) => void;
  'job:paused': (jobId: string) => void;
  'job:resumed': (jobId: string) => void;
  'job:failed': (jobId: string, error: Error) => void;
  'job:completed': (jobId: string) => void;
  'job:quota-exceeded': (jobId: string) => void;
  'job:max-executions': (jobId: string) => void;
  'job:stop-condition': (jobId: string, condition: string) => void;
  'shutdown': () => void;
}

// ============================================================================
// Enhanced Background Jobs Manager
// ============================================================================

export class EnhancedBackgroundJobsManager extends EventEmitter {
  private jobs: Map<string, EnhancedJob> = new Map();
  private executor?: JobExecutor;
  private sessionManager?: any;
  private executionGraphEngine?: any;
  private stateManager?: any;
  private readonly DEFAULT_MAX_EXECUTIONS = 1000;
  private readonly QUOTA_LIMITS = {
    compute: 300000, // 5 minutes in ms
    io: 1000, // operations
    api: 100, // calls
  };

  constructor() {
    super();
  }

  /**
   * Set job executor implementation
   */
  setExecutor(executor: JobExecutor): void {
    this.executor = executor;
  }

  /**
   * Set session manager for quota tracking
   */
  setSessionManager(sessionManager: any): void {
    this.sessionManager = sessionManager;
  }

  /**
   * Set execution graph engine for job tracking
   */
  setExecutionGraphEngine(executionGraphEngine: any): void {
    this.executionGraphEngine = executionGraphEngine;
  }

  /**
   * Set state manager for VFS sync
   */
  setStateManager(stateManager: any): void {
    this.stateManager = stateManager;
  }

  /**
   * Start a new background job with enhanced tracking
   */
  async startJob(config: EnhancedJobConfig): Promise<EnhancedJob> {
    const jobId = config.jobId || randomUUID();
    
    logger.debug('Starting background job', {
      jobId,
      sandboxId: config.sandboxId,
      command: config.command.substring(0, 100),
      interval: config.interval,
      timeout: config.timeout,
    });

    // Validate: reject duplicate jobId to avoid orphaned concurrent jobs
    if (this.jobs.has(jobId)) {
      logger.error('Attempted to start job with duplicate ID', { jobId });
      throw new Error(`Background job already exists: ${jobId}`);
    }

    const {
      sessionId,
      sandboxId,
      command,
      args = [],
      interval,
      timeout = 10,
      description,
      tags = [],
      quotaCategory = 'compute',
      maxExecutions = this.DEFAULT_MAX_EXECUTIONS,
      stopCondition,
    } = config;

    // Validate schedule inputs before creating the job
    if (!Number.isFinite(interval) || interval <= 0) {
      logger.error('Invalid interval for background job', { jobId, interval });
      throw new Error('interval must be a positive number of seconds');
    }
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      logger.error('Invalid timeout for background job', { jobId, timeout });
      throw new Error('timeout must be a positive number of seconds');
    }
    if (maxExecutions !== undefined && (!Number.isInteger(maxExecutions) || maxExecutions <= 0)) {
      logger.error('Invalid maxExecutions for background job', { jobId, maxExecutions });
      throw new Error('maxExecutions must be a positive integer');
    }

    // Edge case: Warn about very short intervals that could cause high load
    if (interval < 5) {
      logger.warn('Very short interval detected - this may cause high system load', {
        jobId,
        interval,
        recommendation: 'Consider using interval >= 5 seconds',
      });
    }

    // Edge case: Warn about very long timeouts
    if (timeout && timeout > 3600) {
      logger.warn('Very long timeout detected - job may run for extended period', {
        jobId,
        timeout,
        timeoutHours: timeout / 3600,
      });
    }

    // Check quota before starting
    if (this.sessionManager && sessionId) {
      try {
        const session = await this.sessionManager.getSession(sessionId);
        if (session && !this.checkQuotaAvailable(session, quotaCategory)) {
          logger.warn('Insufficient quota for background job', {
            jobId,
            sessionId,
            quotaCategory,
            sessionQuota: session.quota,
          });
          throw new Error(`Insufficient ${quotaCategory} quota for background job`);
        }
      } catch (quotaError: any) {
        logger.error('Quota check failed for background job', {
          jobId,
          sessionId,
          error: quotaError.message,
        });
        throw quotaError;
      }
    }

    // Convert to milliseconds for internal timers
    const intervalMs = interval * 1000;
    const timeoutMs = timeout * 1000;

    logger.debug('Creating job object', {
      jobId,
      intervalMs,
      timeoutMs,
      maxExecutions,
      hasStopCondition: !!stopCondition,
    });

    const job: EnhancedJob = {
      jobId,
      sessionId,
      sandboxId,
      command,
      args,
      // Public API: seconds
      interval,
      timeout,
      // Internal: milliseconds
      intervalMs,
      timeoutMs,
      description,
      tags,
      quotaCategory,
      maxExecutions,
      stopCondition,
      status: 'running',
      createdAt: new Date(),
      executionCount: 0,
    };

    // Create execution graph node if engine available
    if (this.executionGraphEngine && sessionId) {
      try {
        const graph = this.executionGraphEngine.createGraph(sessionId);
        const node = this.executionGraphEngine.addNode(graph, {
          id: `job-${jobId}`,
          type: 'sandbox_action',
          name: description || `Background Job: ${command}`,
          description: `Interval: ${interval}s, Timeout: ${timeout}s`,
          dependencies: [],
          metadata: {
            jobId,
            sandboxId,
            command,
            interval,
            quotaCategory,
          },
        });
        job.executionGraphId = graph.id;
        job.executionGraphNodeId = node.id;
        logger.debug('Execution graph node created', {
          jobId,
          graphId: graph.id,
          nodeId: node.id,
        });
      } catch (graphError: any) {
        logger.warn('Failed to create execution graph node - job will run without graph tracking', {
          jobId,
          error: graphError.message,
        });
        // Continue without graph tracking - not fatal
      }
    }

    // Start execution loop
    this.executeJobLoop(job);

    this.jobs.set(jobId, job);
    this.emit('job:started', job);

    logger.info('Background job started successfully', {
      jobId,
      sessionId,
      sandboxId,
      command: command.substring(0, 100),
      interval,
      timeout,
      maxExecutions,
      quotaCategory,
    });

    return job;
  }

  /**
   * Execute job loop with comprehensive tracking
   */
  private async executeJobLoop(job: EnhancedJob): Promise<void> {
    // Increment loop token to prevent duplicate loops on resume
    job.loopToken = (job.loopToken || 0) + 1;
    const currentToken = job.loopToken;

    logger.debug('Starting job execution loop', {
      jobId: job.jobId,
      command: job.command.substring(0, 100),
      interval: job.interval,
      maxExecutions: job.maxExecutions,
      loopToken: currentToken,
    });

    const executeLoop = async () => {
      let executionAttempt = 0;
      
      while (job.status === 'running' && job.loopToken === currentToken) {
        executionAttempt++;
        const startTime = Date.now();

        try {
          logger.debug('Executing job iteration', {
            jobId: job.jobId,
            executionAttempt,
            command: job.command.substring(0, 100),
          });

          // Execute command
          let result: { stdout: string; stderr: string; exitCode: number | null };

          if (this.executor) {
            // Use internal timeoutMs, convert to seconds for executor API
            result = await this.executor.execCommand(
              job.sandboxId,
              job.command,
              job.args,
              job.timeoutMs / 1000
            );
          } else {
            // SECURITY: Removed child_process.spawn fallback to prevent arbitrary code execution
            // Jobs MUST run in sandboxed environment for security
            logger.error('Background job requires sandbox executor - job cannot run without sandbox', {
              jobId: job.jobId,
              sandboxId: job.sandboxId,
            });
            result = {
              stdout: '',
              stderr: 'Sandbox executor not available - job requires sandboxed environment',
              exitCode: 1,
            };
          }

          const duration = Date.now() - startTime;
          job.lastExecuted = new Date();
          // Use internal intervalMs for next execution calculation
          job.nextExecution = new Date(Date.now() + job.intervalMs);
          job.executionCount++;

          // Track stderr in job result for error observation
          const jobResult: JobExecutionResult = {
            jobId: job.jobId,
            sandboxId: job.sandboxId,
            command: job.command,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            duration,
            quotaUsed: this.calculateQuotaUsage(duration, job.quotaCategory || 'compute'),
          };

          job.lastResult = jobResult;

          // Log execution results
          if (result.exitCode === 0) {
            logger.debug('Job execution completed successfully', {
              jobId: job.jobId,
              executionAttempt,
              duration,
              exitCode: result.exitCode,
              stdoutLength: result.stdout.length,
              stderrLength: result.stderr.length,
            });
          } else {
            logger.warn('Job execution completed with non-zero exit code', {
              jobId: job.jobId,
              executionAttempt,
              duration,
              exitCode: result.exitCode,
              stderr: result.stderr.substring(0, 500),
            });
          }

          // Update execution graph node
          this.updateExecutionGraphNode(job, jobResult);

          // Update state if manager available
          this.updateStateForResult(job, jobResult);

          // Emit execution event
          this.emit('job:executed', jobResult);

          // Check max executions
          if (job.executionCount >= job.maxExecutions) {
            logger.info('Job reached max executions - marking as completed', {
              jobId: job.jobId,
              executionCount: job.executionCount,
              maxExecutions: job.maxExecutions,
            });
            job.status = 'completed';
            this.emit('job:max-executions', job.jobId);
            break;
          }

          // Check stop condition (LLM-evaluated)
          if (job.stopCondition && this.stateManager) {
            try {
              const shouldStop = await this.evaluateStopCondition(job, result.stdout);
              if (shouldStop) {
                logger.info('Job stop condition evaluated to true - marking as completed', {
                  jobId: job.jobId,
                  condition: job.stopCondition.substring(0, 100),
                });
                job.status = 'completed';
                this.emit('job:stop-condition', job.jobId, job.stopCondition);
                break;
              }
            } catch (conditionError: any) {
              logger.warn('Stop condition evaluation failed - continuing job', {
                jobId: job.jobId,
                error: conditionError.message,
              });
            }
          }

        } catch (error: any) {
          job.lastError = error;
          this.emit('job:failed', job.jobId, error);

          // Update execution graph with error
          this.updateExecutionGraphNodeError(job, error);

          logger.error('Background job execution error - will retry on next interval', {
            jobId: job.jobId,
            executionAttempt,
            error: error.message,
            stack: error.stack?.substring(0, 500),
          });

          // Continue loop on error (jobs are resilient)
          // Edge case: Track consecutive failures
          if (executionAttempt > 10) {
            logger.warn('Job has failed 10+ consecutive times', {
              jobId: job.jobId,
              executionAttempt,
              recommendation: 'Consider stopping this job and investigating the issue',
            });
          }
        }

        // Wait for next interval - use internal intervalMs
        if (job.status === 'running') {
          logger.debug('Job sleeping until next interval', {
            jobId: job.jobId,
            nextExecution: job.nextExecution.toISOString(),
            intervalMs: job.intervalMs,
          });
          await this.sleep(job.intervalMs);
        } else {
          logger.debug('Job loop exiting - job no longer in running status', {
            jobId: job.jobId,
            status: job.status,
          });
        }
      }
      
      logger.info('Job execution loop terminated', {
        jobId: job.jobId,
        finalStatus: job.status,
        totalExecutions: job.executionCount,
      });
    };

    // Start the loop
    setTimeout(executeLoop, 0);
  }

  /**
   * Calculate quota usage based on execution
   */
  private calculateQuotaUsage(duration: number, category: string): {
    computeMs: number;
    ioOps: number;
    apiCalls: number;
  } {
    const base: any = { computeMs: duration, ioOps: 0, apiCalls: 0 };

    switch (category) {
      case 'io':
        base.ioOps = 1;
        break;
      case 'api':
        base.apiCalls = 1;
        break;
      default:
        base.computeMs = duration;
    }

    return base;
  }

  /**
   * Check if quota is available for job execution
   */
  private checkQuotaAvailable(session: SessionLike, category: string): boolean {
    if (!session.quota) return true;

    const limits = this.QUOTA_LIMITS;
    const metrics = session.metrics || {};

    switch (category) {
      case 'compute':
        return (metrics.computeTime || 0) < limits.compute;
      case 'io':
        return (metrics.ioOps || 0) < limits.io;
      case 'api':
        return (metrics.apiCalls || 0) < limits.api;
      default:
        return true;
    }
  }

  /**
   * Update execution graph node with result
   */
  private updateExecutionGraphNode(job: EnhancedJob, result: JobExecutionResult): void {
    if (!this.executionGraphEngine || !job.executionGraphId || !job.executionGraphNodeId) return;

    const graph = this.executionGraphEngine.getGraph(job.executionGraphId);
    if (!graph) return;

    const node = graph.nodes.get(job.executionGraphNodeId);
    if (!node) return;

    node.status = 'completed';
    node.result = result;
    node.completedAt = Date.now();
    node.metadata = {
      ...node.metadata,
      lastExecutionTime: job.lastExecuted?.toISOString(),
      executionCount: job.executionCount,
      exitCode: result.exitCode,
    };

    logger.debug('Execution graph node updated', {
      graphId: job.executionGraphId,
      nodeId: job.executionGraphNodeId,
      status: node.status,
    });
  }

  /**
   * Update execution graph node with error
   */
  private updateExecutionGraphNodeError(job: EnhancedJob, error: Error): void {
    if (!this.executionGraphEngine || !job.executionGraphId || !job.executionGraphNodeId) return;

    const graph = this.executionGraphEngine.getGraph(job.executionGraphId);
    if (!graph) return;

    const node = graph.nodes.get(job.executionGraphNodeId);
    if (!node) return;

    node.status = 'failed';
    node.error = error.message;
    node.retryCount = (node.retryCount || 0) + 1;

    logger.debug('Execution graph node failed', {
      graphId: job.executionGraphId,
      nodeId: job.executionGraphNodeId,
      error: error.message,
      retryCount: node.retryCount,
    });
  }

  /**
   * Update state manager with job result
   */
  private updateStateForResult(job: EnhancedJob, result: JobExecutionResult): void {
    if (!this.stateManager || !job.sessionId) return;

    // Update VFS state if job produced file changes
    if (result.stdout) {
      this.stateManager.addStateMessage(job.sessionId, {
        role: 'system',
        content: `Background job ${job.jobId} executed: ${job.command}\nOutput: ${result.stdout.substring(0, 500)}`,
        timestamp: Date.now(),
        metadata: {
          type: 'background_job',
          jobId: job.jobId,
          exitCode: result.exitCode,
        },
      });
    }
  }

  /**
   * Evaluate stop condition using LLM
   */
  private async evaluateStopCondition(job: EnhancedJob, output: string): Promise<boolean> {
    if (!job.stopCondition || !this.stateManager) return false;

    try {
      // Use LLM to evaluate stop condition
      const { generateObject } = await import('ai');
      const { z } = await import('zod');

      // generateObject requires a LanguageModel provider object, not a string
      const model = this.stateManager.getModel?.();
      if (!model) {
        logger.warn('Stop condition evaluation skipped: no model configured', { jobId: job.jobId });
        return false;
      }

      const result = await generateObject({
        model,
        schema: z.object({
          shouldStop: z.boolean().describe('Whether the job should stop based on the condition'),
          reason: z.string().describe('Reason for the decision'),
        }),
        messages: [
          {
            role: 'system',
            content: 'You evaluate whether a background job should stop based on a condition and output.',
          },
          {
            role: 'user',
            content: `Stop condition: ${job.stopCondition}\n\nJob output: ${output.substring(0, 1000)}`,
          },
        ],
      });

      return result.object.shouldStop;
    } catch (error) {
      logger.error('Failed to evaluate stop condition', { error });
      return false;
    }
  }

  /**
   * Stop a background job
   */
  async stopJob(jobId: string, reason: string = 'Manual stop'): Promise<boolean> {
    logger.info('Stopping background job', { jobId, reason });

    const job = this.jobs.get(jobId);
    if (!job) {
      logger.warn('Attempted to stop non-existent job', { jobId });
      return false;
    }

    logger.debug('Stopping job execution', {
      jobId,
      currentStatus: job.status,
      executionCount: job.executionCount,
      lastExecuted: job.lastExecuted?.toISOString(),
    });

    job.status = 'stopped';

    // Update execution graph
    if (this.executionGraphEngine && job.executionGraphId && job.executionGraphNodeId) {
      try {
        const graph = this.executionGraphEngine.getGraph(job.executionGraphId);
        if (graph) {
          const node = graph.nodes.get(job.executionGraphNodeId);
          if (node) {
            node.status = 'cancelled';
            node.metadata = { ...node.metadata, stopReason: reason };
            logger.debug('Execution graph node updated', {
              jobId,
              graphId: job.executionGraphId,
              nodeId: job.executionGraphNodeId,
            });
          }
        }
      } catch (graphError: any) {
        logger.warn('Failed to update execution graph on stop', { jobId, error: graphError.message });
      }
    }

    this.jobs.delete(jobId);
    this.emit('job:stopped', jobId, reason);

    logger.info('Background job stopped locally', {
      jobId,
      reason,
      finalExecutionCount: job.executionCount,
      totalRuntime: Date.now() - job.createdAt.getTime(),
    });

    // Notify executor if available - handle cleanup failures without breaking stop semantics
    if (this.executor?.removeBackground) {
      try {
        logger.debug('Requesting executor to remove background process', { jobId, sandboxId: job.sandboxId });
        await this.executor.removeBackground(job.sandboxId, jobId);
        logger.debug('Executor successfully removed background process', { jobId });
      } catch (error: any) {
        logger.warn('Failed to remove background process in executor - job stopped locally but external cleanup failed', {
          jobId,
          sandboxId: job.sandboxId,
          error: error?.message,
        });
      }
    } else {
      logger.debug('No executor configured for external cleanup', { jobId });
    }

    return true;
  }

  /**
   * Pause a background job
   */
  pauseJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.status = 'paused';
    this.emit('job:paused', jobId);

    logger.debug('Background job paused', { jobId });

    return true;
  }

  /**
   * Resume a paused background job
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') return false;

    // Increment loop token to cancel any stale loops
    job.loopToken = (job.loopToken || 0) + 1;

    job.status = 'running';
    // Use internal intervalMs for next execution calculation
    job.nextExecution = new Date(Date.now() + job.intervalMs);

    // Restart execution loop
    this.executeJobLoop(job);

    this.emit('job:resumed', jobId);

    logger.info('Background job resumed', { jobId, loopToken: job.loopToken });

    return true;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): EnhancedJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * List jobs with filters
   */
  listJobs(filters?: {
    sessionId?: string;
    sandboxId?: string;
    status?: string;
    tags?: string[];
  }): EnhancedJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filters) {
      if (filters.sessionId) {
        jobs = jobs.filter(j => j.sessionId === filters.sessionId);
      }
      if (filters.sandboxId) {
        jobs = jobs.filter(j => j.sandboxId === filters.sandboxId);
      }
      if (filters.status) {
        jobs = jobs.filter(j => j.status === filters.status);
      }
      if (filters.tags?.length) {
        jobs = jobs.filter(j => j.tags?.some(t => filters.tags!.includes(t)));
      }
    }

    return jobs;
  }

  /**
   * Get job statistics
   */
  getStats(sessionId?: string): {
    total: number;
    running: number;
    paused: number;
    stopped: number;
    completed: number;
    failed: number;
    totalExecutions: number;
    totalComputeMs: number;
  } {
    const jobs = sessionId ? this.listJobs({ sessionId }) : this.listJobs();

    return {
      total: jobs.length,
      running: jobs.filter(j => j.status === 'running').length,
      paused: jobs.filter(j => j.status === 'paused').length,
      stopped: jobs.filter(j => j.status === 'stopped').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      totalExecutions: jobs.reduce((sum, j) => sum + j.executionCount, 0),
      totalComputeMs: jobs.reduce((sum, j) => sum + (j.lastResult?.duration || 0), 0),
    };
  }

  /**
   * Shutdown all jobs gracefully
   */
  async shutdown(): Promise<void> {
    const jobsCopy = Array.from(this.jobs.entries());

    logger.info('Shutting down background Jobs Manager', { jobCount: jobsCopy.length });

    // Stop all jobs
    for (const [jobId, job] of jobsCopy) {
      job.status = 'stopped';
    }

    // Wait for jobs to finish current execution
    await this.sleep(2000);

    // Clear all jobs
    this.jobs.clear();

    this.emit('shutdown');

    logger.info('Background Jobs Manager shut down complete');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const enhancedBackgroundJobsManager = new EnhancedBackgroundJobsManager();
