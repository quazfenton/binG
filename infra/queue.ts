/**
 * Queue Infrastructure for Horizontal Scaling
 *
 * Redis-based job queue for distributed Mastra workflow execution.
 * Supports automatic retries, backoff, and job prioritization.
 *
 * @see https://mastra.ai/docs/workflows/distributed-execution
 */

import { Queue, Worker, Job } from 'bullmq';
import { Mastra } from '@mastra/core';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Job types for the queue
 */
export type JobType = 'workflow' | 'agent' | 'tool' | 'batch';

/**
 * Job data structure
 */
export interface JobData {
  type: JobType;
  workflowId?: string;
  inputData: Record<string, any>;
  ownerId: string;
  priority?: number;
  retryCount?: number;
  createdAt: number;
}

/**
 * Job result structure
 */
export interface JobResult {
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
}

/**
 * Queue configuration
 */
const queueConfig = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 1000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      count: 5000, // Keep last 5000 failed jobs for debugging
    },
  },
};

/**
 * Main job queue
 */
export const agentQueue = new Queue('mastra-agent', queueConfig);

/**
 * Result queue for storing execution results
 */
export const resultQueue = new Queue('mastra-result', queueConfig);

/**
 * Priority queue for urgent jobs
 */
export const priorityQueue = new Queue('mastra-priority', {
  ...queueConfig,
  defaultJobOptions: {
    ...queueConfig.defaultJobOptions,
    priority: 1, // Higher priority
  },
});

/**
 * Add a workflow job to the queue
 */
export async function addWorkflowJob(
  workflowId: string,
  inputData: Record<string, any>,
  ownerId: string,
  options?: { priority?: number; delay?: number }
): Promise<string> {
  const jobData: JobData = {
    type: 'workflow',
    workflowId,
    inputData,
    ownerId,
    priority: options?.priority || 0,
    createdAt: Date.now(),
  };

  const job = await agentQueue.add('workflow-execution', jobData, {
    priority: options?.priority,
    delay: options?.delay,
  });

  return job.id!;
}

/**
 * Add a batch job for processing multiple items
 */
export async function addBatchJob(
  items: any[],
  ownerId: string,
  options?: { concurrency?: number }
): Promise<string> {
  const jobData: JobData = {
    type: 'batch',
    inputData: { items },
    ownerId,
    createdAt: Date.now(),
  };

  const job = await agentQueue.add('batch-processing', jobData, {
    priority: options?.concurrency ? 10 - Math.min(options.concurrency, 9) : 5,
  });

  return job.id!;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    agentQueue.getWaitingCount(),
    agentQueue.getActiveCount(),
    agentQueue.getCompletedCount(),
    agentQueue.getFailedCount(),
    agentQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<Job | null> {
  return await agentQueue.getJob(jobId);
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const job = await agentQueue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

/**
 * Pause the queue
 */
export async function pauseQueue(): Promise<void> {
  await agentQueue.pause();
}

/**
 * Resume the queue
 */
export async function resumeQueue(): Promise<void> {
  await agentQueue.resume();
}

/**
 * Clean old jobs
 */
export async function cleanQueue(grace: number, limit: number): Promise<string[]> {
  return await agentQueue.clean(grace, limit, 'completed');
}

/**
 * Close queue connections
 */
export async function closeQueue(): Promise<void> {
  await agentQueue.close();
  await resultQueue.close();
  await priorityQueue.close();
  await redis.quit();
}
