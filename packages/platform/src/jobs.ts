/**
 * Background Jobs Abstraction
 *
 * Provides a unified interface for running background tasks:
 * - Desktop: Offloads to Rust via Tauri invoke (true parallelism)
 * - Web: Runs in JavaScript (single-threaded, uses setTimeout/Web Workers)
 *
 * Use cases:
 * - Embedding documents
 * - Indexing files
 * - Long-running completions
 * - Data synchronization
 *
 * Usage:
 * ```ts
 * import { runJob } from '@/lib/platform/jobs';
 *
 * // Run a background job
 * const result = await runJob('index-files', { paths: ['/docs'] });
 *
 * // Check job status
 * const status = await getJobStatus('index-files');
 * ```
 */

import { isDesktopMode } from './env';

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface JobRunResult {
  jobId: string;
  result: JobResult;
}

export interface JobStatus {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: JobResult;
}

// Simple in-memory job registry for web
const webJobRegistry = new Map<string, JobStatus>();

/**
 * Run a background job
 */
export async function runJob(name: string, payload: any): Promise<JobRunResult> {
  if (isDesktopMode()) {
    // Offload to Rust via Tauri invoke
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<JobResult>(name, payload);
      return { jobId: `${name}-${Date.now()}`, result };
    } catch (error: any) {
      return {
        jobId: '',
        result: {
          success: false,
          error: error.message || String(error),
        },
      };
    }
  }

  // Web fallback: run in JS (single-threaded)
  const jobId = `${name}-${Date.now()}`;
  webJobRegistry.set(jobId, {
    id: jobId,
    name,
    status: 'running',
    progress: 0,
  });

  try {
    // Look for registered JS job handlers
    const handler = jobHandlers.get(name);
    if (handler) {
      const data = await handler(payload);
      webJobRegistry.set(jobId, {
        id: jobId,
        name,
        status: 'completed',
        progress: 100,
        result: { success: true, data },
      });
      return { jobId, result: { success: true, data } };
    }

    return { jobId, result: { success: false, error: `No handler registered for job: ${name}` } };
  } catch (error: any) {
    webJobRegistry.set(jobId, {
      id: jobId,
      name,
      status: 'failed',
      progress: 0,
      result: { success: false, error: error.message },
    });
    return { jobId, result: { success: false, error: error.message } };
  }
}

// Job handler registry for web
const jobHandlers = new Map<string, (payload: any) => Promise<any>>();

/**
 * Register a job handler (for web environment)
 */
export function registerJobHandler(name: string, handler: (payload: any) => Promise<any>): void {
  jobHandlers.set(name, handler);
}

/**
 * Unregister a job handler
 */
export function unregisterJobHandler(name: string): void {
  jobHandlers.delete(name);
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  if (isDesktopMode()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<JobStatus>('get_job_status', { jobId });
    } catch {
      return null;
    }
  }

  return webJobRegistry.get(jobId) || null;
}

/**
 * Cancel a running job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  if (isDesktopMode()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('cancel_job', { jobId });
    } catch {
      return false;
    }
  }

  const job = webJobRegistry.get(jobId);
  if (job && job.status === 'running') {
    webJobRegistry.set(jobId, { ...job, status: 'failed', result: { success: false, error: 'Cancelled' } });
    return true;
  }
  return false;
}
