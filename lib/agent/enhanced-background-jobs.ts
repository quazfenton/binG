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
import { createLogger } from '../utils/logger';
import type { Session } from '../session/session-manager';
import type { ExecutionGraph, ExecutionNode } from '../agent/execution-graph';
import type { UnifiedAgentState } from '../orchestra/unified-agent-state';

const logger = createLogger('Agent:EnhancedBackgroundJobs');

// ============================================================================
// Types
// ============================================================================

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

export interface EnhancedJob extends EnhancedJobConfig {
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

    // Check quota before starting
    if (this.sessionManager && sessionId) {
      const session = await this.sessionManager.getSession(sessionId);
      if (session && !this.checkQuotaAvailable(session, quotaCategory)) {
        logger.warn('Insufficient quota for background job', { jobId, sessionId, quotaCategory });
        throw new Error(`Insufficient ${quotaCategory} quota for background job`);
      }
    }

    const job: EnhancedJob = {
      jobId,
      sessionId,
      sandboxId,
      command,
      args,
      interval: interval * 1000,
      timeout: timeout * 1000,
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
    }

    // Start execution loop
    this.executeJobLoop(job);

    this.jobs.set(jobId, job);
    this.emit('job:started', job);

    logger.info('Background job started', {
      jobId,
      sessionId,
      sandboxId,
      command,
      interval,
    });

    return job;
  }

  /**
   * Execute job loop with comprehensive tracking
   */
  private async executeJobLoop(job: EnhancedJob): Promise<void> {
    const executeLoop = async () => {
      while (job.status === 'running') {
        try {
          const startTime = Date.now();

          // Execute command
          let result: { stdout: string; stderr: string; exitCode: number | null };

          if (this.executor) {
            result = await this.executor.execCommand(
              job.sandboxId,
              job.command,
              job.args,
              job.timeout / 1000
            );
          } else {
            // Fallback to direct child_process
            const { spawn } = require('child_process');
            result = await new Promise((resolve) => {
              const proc = spawn(job.command, job.args, {
                timeout: job.timeout,
                stdio: ['pipe', 'pipe', 'pipe'],
              });

              let stdout = '';
              let stderr = '';

              proc.stdout?.on('data', (data: Buffer) => (stdout += data.toString()));
              proc.stderr?.on('data', (data: Buffer) => (stderr += data.toString()));

              proc.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
              proc.on('error', (error: Error) =>
                resolve({ stdout: '', stderr: error.message, exitCode: null })
              );
            });
          }

          const duration = Date.now() - startTime;
          job.lastExecuted = new Date();
          job.nextExecution = new Date(Date.now() + job.interval);
          job.executionCount++;

          // Calculate quota usage
          const quotaUsed = this.calculateQuotaUsage(duration, job.quotaCategory || 'compute');

          // Track quota
          if (this.sessionManager && job.sessionId) {
            await this.sessionManager.recordMetric(job.sessionId, {
              type: 'background_job',
              jobId: job.jobId,
              computeTime: quotaUsed.computeMs,
              ioOps: quotaUsed.ioOps,
              apiCalls: quotaUsed.apiCalls,
              duration,
            });

            // Check if quota exceeded
            const session = await this.sessionManager.getSession(job.sessionId);
            if (session && !this.checkQuotaAvailable(session, job.quotaCategory || 'compute')) {
              logger.warn('Job exceeded quota, stopping', { jobId: job.jobId });
              job.status = 'completed';
              this.emit('job:quota-exceeded', job.jobId);
              break;
            }
          }

          // Create execution result
          const execResult: JobExecutionResult = {
            jobId: job.jobId,
            sandboxId: job.sandboxId,
            command: job.command,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            duration,
            quotaUsed,
          };

          job.lastResult = execResult;

          // Update execution graph node
          this.updateExecutionGraphNode(job, execResult);

          // Update state if manager available
          this.updateStateForResult(job, execResult);

          // Emit execution event
          this.emit('job:executed', execResult);

          // Check max executions
          if (job.executionCount >= job.maxExecutions) {
            logger.info('Job reached max executions', { jobId: job.jobId, count: job.executionCount });
            job.status = 'completed';
            this.emit('job:max-executions', job.jobId);
            break;
          }

          // Check stop condition (LLM-evaluated)
          if (job.stopCondition && this.stateManager) {
            const shouldStop = await this.evaluateStopCondition(job, result.stdout);
            if (shouldStop) {
              logger.info('Job stop condition met', { jobId: job.jobId, condition: job.stopCondition });
              job.status = 'completed';
              this.emit('job:stop-condition', job.jobId, job.stopCondition);
              break;
            }
          }

        } catch (error: any) {
          job.lastError = error;
          this.emit('job:failed', job.jobId, error);

          // Update execution graph with error
          this.updateExecutionGraphNodeError(job, error);

          logger.error('Background job execution error', {
            jobId: job.jobId,
            error: error.message,
          });

          // Continue loop on error (jobs are resilient)
        }

        // Wait for next interval
        if (job.status === 'running') {
          await this.sleep(job.interval);
        }
      }
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
  private checkQuotaAvailable(session: Session, category: string): boolean {
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

      const result = await generateObject({
        model: this.stateManager.getModel?.() || 'gpt-4o-mini',
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
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.status = 'stopped';

    // Update execution graph
    if (this.executionGraphEngine && job.executionGraphId && job.executionGraphNodeId) {
      const graph = this.executionGraphEngine.getGraph(job.executionGraphId);
      if (graph) {
        const node = graph.nodes.get(job.executionGraphNodeId);
        if (node) {
          node.status = 'cancelled';
          node.metadata = { ...node.metadata, stopReason: reason };
        }
      }
    }

    this.jobs.delete(jobId);
    this.emit('job:stopped', jobId, reason);

    logger.info('Background job stopped', { jobId, reason });

    // Notify executor if available
    if (this.executor?.removeBackground) {
      await this.executor.removeBackground(job.sandboxId, jobId);
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

    job.status = 'running';
    job.nextExecution = new Date(Date.now() + job.interval);

    // Restart execution loop
    this.executeJobLoop(job);

    this.emit('job:resumed', jobId);

    logger.info('Background job resumed', { jobId });

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
