/**
 * Blaxel Jobs Manager
 *
 * Manages batch job deployment and execution on Blaxel infrastructure.
 * Supports:
 * - Deploying batch jobs from code
 * - Executing jobs with multiple tasks
 * - Polling for job completion
 * - Callback URL integration
 *
 * Documentation: https://docs.blaxel.ai/Jobs/Overview
 * SDK: @blaxel/core
 */

import type { ToolResult } from '../types';

const BLAXEL_API_BASE = process.env.BLAXEL_API_BASE || 'https://api.blaxel.ai';

export interface BatchJobConfig {
  name: string;
  code: string;
  language: 'python' | 'typescript' | 'go';
  timeout?: number;
  memory?: number;
  region?: string;
  callbackUrl?: string;
}

export interface BatchTask {
  id: string;
  data: Record<string, any>;
}

export interface JobExecutionResult {
  id: string;
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results?: any[];
  error?: string;
  duration?: number;
  createdAt?: string;
  completedAt?: string;
}

export interface BlaxelJob {
  id: string;
  name: string;
  status: string;
  runtime: {
    language: string;
    code: string;
    memory: number;
    timeout: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BlaxelExecution {
  id: string;
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results?: any[];
  error?: string;
  duration?: number;
  createdAt: string;
  completedAt?: string;
  tasks: Array<{
    id: string;
    data: Record<string, any>;
    status?: string;
    result?: any;
  }>;
}

export class BlaxelJobsManager {
  private apiKey: string;
  private workspace: string;
  private baseUrl: string;
  private client: any = null;

  constructor(apiKey?: string, workspace?: string) {
    this.apiKey = apiKey || process.env.BLAXEL_API_KEY || '';
    this.workspace = workspace || process.env.BLAXEL_WORKSPACE || 'default';
    this.baseUrl = process.env.BLAXEL_API_BASE || BLAXEL_API_BASE;

    if (!this.apiKey) {
      console.warn('[BlaxelJobs] BLAXEL_API_KEY not configured. Jobs will fail on first use.');
    }
  }

  /**
   * Check if Blaxel is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Get or create Blaxel client
   */
  private async ensureClient(): Promise<any> {
    if (this.client) return this.client;

    try {
      // @ts-ignore - Optional package, only available if @blaxel/sdk is installed
      const { BlaxelClient } = await import('@blaxel/core');
      this.client = new BlaxelClient({
        apiKey: this.apiKey,
        workspace: this.workspace,
      });
      return this.client;
    } catch (error: any) {
      throw new Error(
        `Blaxel SDK not available. Install with: npm install @blaxel/core. Error: ${error.message}`
      );
    }
  }

  /**
   * Deploy batch job
   *
   * Creates a new batch job that can be executed with multiple tasks
   */
  async deployJob(config: BatchJobConfig): Promise<{ id: string; name: string }> {
    try {
      const client = await this.ensureClient();

      const job = await client.jobs.create({
        name: config.name,
        runtime: {
          language: config.language,
          code: config.code,
          memory: config.memory || 2048,
          timeout: config.timeout || 300000, // 5 minutes default
        },
        region: config.region,
      });

      return {
        id: job.id,
        name: job.name,
      };
    } catch (error: any) {
      console.error('[BlaxelJobs] Failed to deploy job:', error);
      throw new Error(`Failed to deploy job: ${error.message}`);
    }
  }

  /**
   * Execute batch job with tasks
   *
   * Creates an execution for the job with the provided tasks
   */
  async executeJob(
    jobId: string,
    tasks: BatchTask[],
    options?: { async?: boolean; callbackUrl?: string }
  ): Promise<JobExecutionResult> {
    try {
      const client = await this.ensureClient();

      const execution = await client.jobs.createExecution({
        jobId,
        tasks: tasks.map((t) => ({
          id: t.id,
          data: t.data,
        })),
        async: options?.async || false,
        callbackUrl: options?.callbackUrl,
      });

      // If async, return immediately with pending status
      if (options?.async) {
        return {
          id: execution.id,
          jobId,
          status: 'pending',
          createdAt: execution.createdAt,
        };
      }

      // Poll for completion
      return await this.pollExecution(execution.id);
    } catch (error: any) {
      console.error('[BlaxelJobs] Failed to execute job:', error);
      return {
        id: '',
        jobId,
        status: 'failed',
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Get job execution status
   */
  async getExecution(executionId: string): Promise<JobExecutionResult> {
    try {
      const client = await this.ensureClient();
      const execution = await client.jobs.getExecution(executionId);

      return {
        id: execution.id,
        jobId: execution.jobId,
        status: execution.status as any,
        results: execution.results,
        error: execution.error,
        duration: execution.duration,
        createdAt: execution.createdAt,
        completedAt: execution.completedAt,
      };
    } catch (error: any) {
      console.error('[BlaxelJobs] Failed to get execution:', error);
      return {
        id: executionId,
        jobId: '',
        status: 'failed',
        error: error.message,
      };
    }
  }

  /**
   * Poll job execution until completion
   *
   * Polls every 5 seconds for up to 5 minutes
   */
  private async pollExecution(executionId: string): Promise<JobExecutionResult> {
    const maxAttempts = 60; // 5 minutes with 5s polling
    const pollInterval = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const execution = await this.getExecution(executionId);

        if (execution.status === 'completed' || execution.status === 'failed') {
          return execution;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        console.error('[BlaxelJobs] Polling error:', error);
        // Continue polling on transient errors
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error('Job execution timed out after 5 minutes');
  }

  /**
   * List all jobs
   */
  async listJobs(): Promise<Array<{ id: string; name: string; status: string }>> {
    try {
      const client = await this.ensureClient();
      const jobs = await client.jobs.list();

      return jobs.map((job: any) => ({
        id: job.id,
        name: job.name,
        status: job.status,
      }));
    } catch (error: any) {
      console.error('[BlaxelJobs] Failed to list jobs:', error);
      return [];
    }
  }

  /**
   * Delete a job
   */
  async deleteJob(jobId: string): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      await client.jobs.delete(jobId);
      return true;
    } catch (error: any) {
      console.error('[BlaxelJobs] Failed to delete job:', error);
      return false;
    }
  }

  /**
   * Cancel a running execution
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      await client.jobs.cancelExecution(executionId);
      return true;
    } catch (error: any) {
      console.error('[BlaxelJobs] Failed to cancel execution:', error);
      return false;
    }
  }
}

/**
 * Execute batch job via API route
 *
 * Helper function for use in API routes
 */
export async function executeBatchJob(
  jobId: string,
  tasks: BatchTask[],
  options?: { async?: boolean; callbackUrl?: string }
): Promise<ToolResult> {
  const jobsManager = new BlaxelJobsManager();

  if (!jobsManager.isConfigured()) {
    return {
      success: false,
      output: 'BLAXEL_API_KEY not configured. Set BLAXEL_API_KEY in environment.',
    };
  }

  try {
    const result = await jobsManager.executeJob(jobId, tasks, options);

    return {
      success: result.status === 'completed',
      output: JSON.stringify({
        executionId: result.id,
        status: result.status,
        results: result.results,
        duration: result.duration,
      }),
    };
  } catch (error: any) {
    return {
      success: false,
      output: `Error: ${error.message}`,
    };
  }
}

export async function deployBatchJob(config: BatchJobConfig): Promise<ToolResult> {
  const jobsManager = new BlaxelJobsManager();

  if (!jobsManager.isConfigured()) {
    return {
      success: false,
      output: 'BLAXEL_API_KEY not configured. Set BLAXEL_API_KEY in environment.',
    };
  }

  try {
    const job = await jobsManager.deployJob(config);

    return {
      success: true,
      output: JSON.stringify({
        jobId: job.id,
        name: job.name,
        message: `Job deployed successfully. Use jobId to execute tasks.`,
      }),
    };
  } catch (error: any) {
    return {
      success: false,
      output: `Error: ${error.message}`,
    };
  }
}
