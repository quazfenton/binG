/**
 * Shared Worker Job Schemas
 *
 * Unified type definitions for all worker implementations across the codebase.
 * Ensures consistency in job data structures for:
 * - Agent Worker (BullMQ)
 * - Mastra Worker (BullMQ)
 * - Background Worker
 * - Planner Worker
 *
 * This eliminates duplication and ensures all workers can interoperate.
 */

import type { ExecutionPolicy } from '@/lib/sandbox/types';

/**
 * Base job type definition
 */
export type JobType = 'agent-task' | 'workflow' | 'batch' | 'background-index' | 'planning';

/**
 * Job status lifecycle
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'blocked';

/**
 * Agent task job - executed by Agent Worker
 */
export interface AgentTaskJob {
  type: 'agent-task';
  sessionId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  context?: string;
  tools?: string[];
  model?: string;
  executionPolicy?: ExecutionPolicy;
  timeout?: number; // milliseconds
  retryCount?: number;
  createdAt: number;
}

/**
 * Workflow job - executed by Mastra Worker
 */
export interface WorkflowJob {
  type: 'workflow';
  workflowId: string;
  inputData: Record<string, any>;
  ownerId: string;
  priority?: number;
  retryCount?: number;
  createdAt: number;
}

/**
 * Batch processing job - executed by Mastra Worker
 */
export interface BatchJob {
  type: 'batch';
  items: any[];
  ownerId: string;
  concurrency?: number;
  createdAt: number;
}

/**
 * Background indexing job - executed by Background Worker
 */
export interface BackgroundIndexJob {
  type: 'background-index';
  workspacePath: string;
  filePattern?: string;
  createdAt: number;
}

/**
 * Planning/decomposition job - executed by Planner Worker
 */
export interface PlanningJob {
  type: 'planning';
  prompt: string;
  context?: {
    userId?: string;
    conversationId?: string;
    workspacePath?: string;
  };
  createdAt: number;
}

/**
 * Union type of all job types
 */
export type AnyWorkerJob =
  | AgentTaskJob
  | WorkflowJob
  | BatchJob
  | BackgroundIndexJob
  | PlanningJob;

/**
 * Job execution result
 */
export interface JobResult {
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
  metadata?: {
    provider?: string;
    executionPolicy?: ExecutionPolicy;
    retries?: number;
  };
}

/**
 * Job metadata for tracking
 */
export interface JobMetadata {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  error?: string;
  attempts?: number;
}

/**
 * Type guard to determine job type
 */
export function isAgentTaskJob(job: AnyWorkerJob): job is AgentTaskJob {
  return job.type === 'agent-task';
}

export function isWorkflowJob(job: AnyWorkerJob): job is WorkflowJob {
  return job.type === 'workflow';
}

export function isBatchJob(job: AnyWorkerJob): job is BatchJob {
  return job.type === 'batch';
}

export function isBackgroundIndexJob(job: AnyWorkerJob): job is BackgroundIndexJob {
  return job.type === 'background-index';
}

export function isPlanningJob(job: AnyWorkerJob): job is PlanningJob {
  return job.type === 'planning';
}

/**
 * Default timeouts by job type
 */
export const DEFAULT_JOB_TIMEOUTS: Record<JobType, number> = {
  'agent-task': 3600000, // 1 hour
  'workflow': 1800000,   // 30 minutes
  'batch': 600000,       // 10 minutes
  'background-index': 300000, // 5 minutes
  'planning': 180000,    // 3 minutes
};

/**
 * Default retry counts by job type
 */
export const DEFAULT_RETRY_COUNTS: Record<JobType, number> = {
  'agent-task': 2,
  'workflow': 3,
  'batch': 2,
  'background-index': 1,
  'planning': 1,
};

/**
 * Get timeout for job type
 */
export function getJobTimeout(jobType: JobType, customTimeout?: number): number {
  return customTimeout ?? DEFAULT_JOB_TIMEOUTS[jobType];
}

/**
 * Get max retries for job type
 */
export function getMaxRetries(jobType: JobType, customRetries?: number): number {
  return customRetries ?? DEFAULT_RETRY_COUNTS[jobType];
}
