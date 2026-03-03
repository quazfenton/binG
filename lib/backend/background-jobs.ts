/**
 * Background Job Executor
 * Provides interval-based job execution with lifecycle management
 * Migrated from ephemeral/serverless_workers_sdk/background.py
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export interface BackgroundJobConfig {
  sandboxId: string;
  command: string;
  args?: string[];
  interval: number; // seconds
  timeout?: number; // seconds
}

export interface BackgroundJob {
  jobId: string;
  sandboxId: string;
  command: string;
  args: string[];
  interval: number;
  timeout: number;
  task: NodeJS.Timeout;
  createdAt: Date;
  lastExecuted?: Date;
  executionCount: number;
  lastError?: Error;
  status: 'running' | 'paused' | 'stopped';
}

export interface JobExecutionResult {
  jobId: string;
  sandboxId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  error?: Error;
}

export interface JobExecutor {
  execCommand(
    sandboxId: string,
    command: string,
    args?: string[],
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  ensureBackground(sandboxId: string, job: BackgroundJob): Promise<void>;
  removeBackground(sandboxId: string, jobId: string): Promise<void>;
}

export class BackgroundExecutor extends EventEmitter {
  private jobs: Map<string, BackgroundJob> = new Map();
  private executor?: JobExecutor;

  constructor(executor?: JobExecutor) {
    super();
    this.executor = executor;
  }

  setExecutor(executor: JobExecutor): void {
    this.executor = executor;
  }

  /**
   * Start a repeating background job
   */
  async startJob(config: BackgroundJobConfig): Promise<BackgroundJob> {
    const jobId = randomUUID();
    const { sandboxId, command, args = [], interval, timeout = 10 } = config;

    const job: BackgroundJob = {
      jobId,
      sandboxId,
      command,
      args,
      interval: interval * 1000, // Convert to ms
      timeout: timeout * 1000,
      task: null as any,
      createdAt: new Date(),
      executionCount: 0,
      status: 'running',
    };

    // Create execution loop
    const executeLoop = async () => {
      while (job.status === 'running') {
        try {
          const startTime = Date.now();
          
          // Execute command
          let result: { stdout: string; stderr: string; exitCode: number | null };
          
          if (this.executor) {
            result = await this.executor.execCommand(sandboxId, command, args, timeout);
          } else {
            // Fallback: use child_process directly
            const { spawn } = require('child_process');
            result = await new Promise((resolve) => {
              const proc = spawn(command, args, {
                timeout,
                stdio: ['pipe', 'pipe', 'pipe'],
              });

              let stdout = '';
              let stderr = '';

              proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
              });

              proc.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
              });

              proc.on('close', (exitCode) => {
                resolve({ stdout, stderr, exitCode });
              });

              proc.on('error', (error: Error) => {
                resolve({ stdout: '', stderr: error.message, exitCode: null });
              });
            });
          }

          const duration = Date.now() - startTime;
          job.lastExecuted = new Date();
          job.executionCount++;

          this.emit('executed', {
            jobId,
            sandboxId,
            command,
            duration,
            exitCode: result.exitCode,
          } as JobExecutionResult);

        } catch (error: any) {
          job.lastError = error;
          this.emit('error', { jobId, sandboxId, error });
          
          // Log error but continue the loop
          console.error(`Background job ${jobId} error:`, error.message);
        }

        // Wait for next interval
        if (job.status === 'running') {
          await this.sleep(job.interval);
        }
      }
    };

    // Start the loop
    job.task = setTimeout(executeLoop, 0);
    
    this.jobs.set(jobId, job);
    
    // Notify executor if available
    if (this.executor) {
      await this.executor.ensureBackground(sandboxId, job);
    }

    this.emit('started', job);
    
    return job;
  }

  /**
   * Stop a background job
   */
  async stopJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    // Change status to stop the loop
    job.status = 'stopped';

    // Clear the timeout
    if (job.task) {
      clearTimeout(job.task);
    }

    // Remove from tracking
    this.jobs.delete(jobId);

    // Notify executor if available
    if (this.executor) {
      await this.executor.removeBackground(job.sandboxId, jobId);
    }

    this.emit('stopped', { jobId, sandboxId: job.sandboxId });

    return true;
  }

  /**
   * Pause a background job (can be resumed)
   */
  pauseJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    job.status = 'paused';
    
    if (job.task) {
      clearTimeout(job.task);
    }

    this.emit('paused', { jobId, sandboxId: job.sandboxId });

    return true;
  }

  /**
   * Resume a paused background job
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') {
      return false;
    }

    job.status = 'running';

    // Restart the execution loop
    const executeLoop = async () => {
      while (job.status === 'running') {
        try {
          let result: { stdout: string; stderr: string; exitCode: number | null };
          
          if (this.executor) {
            result = await this.executor.execCommand(
              job.sandboxId,
              job.command,
              job.args,
              job.timeout / 1000
            );
          } else {
            const { spawn } = require('child_process');
            result = await new Promise((resolve) => {
              const proc = spawn(job.command, job.args, {
                timeout: job.timeout,
                stdio: ['pipe', 'pipe', 'pipe'],
              });

              let stdout = '';
              let stderr = '';

              proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
              });

              proc.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
              });

              proc.on('close', (exitCode) => {
                resolve({ stdout, stderr, exitCode });
              });

              proc.on('error', (error: Error) => {
                resolve({ stdout: '', stderr: error.message, exitCode: null });
              });
            });
          }

          job.lastExecuted = new Date();
          job.executionCount++;

          this.emit('executed', {
            jobId,
            sandboxId: job.sandboxId,
            command: job.command,
            exitCode: result.exitCode,
          });

        } catch (error: any) {
          job.lastError = error;
          this.emit('error', { jobId, sandboxId: job.sandboxId, error });
        }

        if (job.status === 'running') {
          await this.sleep(job.interval);
        }
      }
    };

    job.task = setTimeout(executeLoop, 0);

    this.emit('resumed', { jobId, sandboxId: job.sandboxId });

    return true;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): BackgroundJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * List all jobs for a sandbox
   */
  listJobs(sandboxId?: string): BackgroundJob[] {
    if (!sandboxId) {
      return Array.from(this.jobs.values());
    }

    return Array.from(this.jobs.values()).filter(job => job.sandboxId === sandboxId);
  }

  /**
   * Get job statistics
   */
  getStats(sandboxId?: string): {
    total: number;
    running: number;
    paused: number;
    stopped: number;
    totalExecutions: number;
  } {
    const jobs = sandboxId ? this.listJobs(sandboxId) : Array.from(this.jobs.values());
    
    return {
      total: jobs.length,
      running: jobs.filter(j => j.status === 'running').length,
      paused: jobs.filter(j => j.status === 'paused').length,
      stopped: jobs.filter(j => j.status === 'stopped').length,
      totalExecutions: jobs.reduce((sum, j) => sum + j.executionCount, 0),
    };
  }

  /**
   * Shutdown all jobs gracefully
   */
  async shutdown(): Promise<void> {
    const jobsCopy = Array.from(this.jobs.entries());
    
    // Stop all jobs
    for (const [jobId, job] of jobsCopy) {
      job.status = 'stopped';
      if (job.task) {
        clearTimeout(job.task);
      }
    }

    // Wait a bit for jobs to finish
    await this.sleep(1000);

    // Clear all jobs
    this.jobs.clear();

    this.emit('shutdown');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const backgroundExecutor = new BackgroundExecutor();
