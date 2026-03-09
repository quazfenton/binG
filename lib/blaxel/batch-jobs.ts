/**
 * Blaxel Batch Jobs Manager
 * 
 * Manages batch job execution with task dependencies and parallel processing.
 * Enables complex multi-task workflows with dependency resolution.
 * 
 * Features:
 * - Task dependency management
 * - Parallel task execution
 * - Job status tracking
 * - Result aggregation
 */

import { EventEmitter } from 'events';

/**
 * Task status
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Batch task definition
 */
export interface BatchTask {
  /**
   * Task ID
   */
  id: string;
  
  /**
   * Task command
   */
  command: string;
  
  /**
   * Task dependencies (task IDs)
   */
  dependencies?: string[];
  
  /**
   * Task status
   */
  status: TaskStatus;
  
  /**
   * Task output
   */
  output?: string;
  
  /**
   * Task error
   */
  error?: string;
  
  /**
   * Start time
   */
  startTime?: number;
  
  /**
   * End time
   */
  endTime?: number;
  
  /**
   * Exit code
   */
  exitCode?: number;
}

/**
 * Batch job status
 */
export type BatchJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Batch job definition
 */
export interface BatchJob {
  /**
   * Job ID
   */
  id: string;
  
  /**
   * Job name
   */
  name: string;
  
  /**
   * Tasks in job
   */
  tasks: Map<string, BatchTask>;
  
  /**
   * Job status
   */
  status: BatchJobStatus;
  
  /**
   * Created timestamp
   */
  createdAt: number;
  
  /**
   * Started timestamp
   */
  startedAt?: number;
  
  /**
   * Completed timestamp
   */
  completedAt?: number;
  
  /**
   * Total tasks
   */
  totalTasks: number;
  
  /**
   * Completed tasks
   */
  completedTasks: number;
  
  /**
   * Failed tasks
   */
  failedTasks: number;
}

/**
 * Blaxel Batch Jobs Manager
 * 
 * Manages batch job execution.
 */
export class BlaxelBatchJobsManager extends EventEmitter {
  private jobs: Map<string, BatchJob> = new Map();
  private readonly MAX_JOBS = 100;

  constructor() {
    super();
  }

  /**
   * Create batch job
   * 
   * @param name - Job name
   * @param tasks - Task definitions
   * @returns Batch job
   */
  createJob(name: string, tasks: Array<{
    id: string;
    command: string;
    dependencies?: string[];
  }>): BatchJob {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const taskMap = new Map<string, BatchTask>();
    for (const task of tasks) {
      taskMap.set(task.id, {
        ...task,
        status: 'pending',
      });
    }

    const job: BatchJob = {
      id: jobId,
      name,
      tasks: taskMap,
      status: 'pending',
      createdAt: Date.now(),
      totalTasks: tasks.length,
      completedTasks: 0,
      failedTasks: 0,
    };

    this.jobs.set(jobId, job);
    this.emit('job-created', job);

    // Enforce max jobs
    if (this.jobs.size > this.MAX_JOBS) {
      const firstKey = this.jobs.keys().next().value;
      if (firstKey) {
        this.jobs.delete(firstKey);
      }
    }

    return job;
  }

  /**
   * Start job execution
   * 
   * @param jobId - Job ID
   */
  async startJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    job.status = 'running';
    job.startedAt = Date.now();
    this.emit('job-started', job);

    // Execute tasks with dependency resolution
    await this.executeTasks(job);
  }

  /**
   * Execute tasks with dependency resolution
   */
  private async executeTasks(job: BatchJob): Promise<void> {
    const executed = new Set<string>();
    const failed = new Set<string>();

    while (executed.size + failed.size < job.totalTasks) {
      // Find ready tasks (all dependencies met)
      const readyTasks = Array.from(job.tasks.values()).filter(task => {
        if (task.status !== 'pending') return false;
        if (!task.dependencies) return true;
        
        // Check if all dependencies are completed
        return task.dependencies.every(depId => {
          const depTask = job.tasks.get(depId);
          return depTask?.status === 'completed';
        });
      });

      if (readyTasks.length === 0) {
        // No ready tasks, check for failures
        const hasFailures = Array.from(job.tasks.values()).some(t => 
          t.status === 'failed' && !failed.has(t.id)
        );
        
        if (hasFailures) {
          // Mark remaining tasks as skipped
          for (const task of job.tasks.values()) {
            if (task.status === 'pending') {
              task.status = 'skipped';
            }
          }
          break;
        }
        
        // Small delay before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      // Execute ready tasks in parallel
      const executions = readyTasks.map(task => this.executeTask(job, task));
      await Promise.all(executions);

      // Update job progress
      job.completedTasks = Array.from(job.tasks.values()).filter(
        t => t.status === 'completed'
      ).length;
      job.failedTasks = Array.from(job.tasks.values()).filter(
        t => t.status === 'failed'
      ).length;

      this.emit('job-progress', job);
    }

    // Complete job
    job.completedAt = Date.now();
    job.status = job.failedTasks > 0 ? 'failed' : 'completed';
    this.emit('job-completed', job);
  }

  /**
   * Execute single task
   */
  private async executeTask(job: BatchJob, task: BatchTask): Promise<void> {
    task.status = 'running';
    task.startTime = Date.now();
    this.emit('task-started', { job, task });

    try {
      // In production, this would execute via Blaxel API
      // For now, simulate execution
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
      
      task.status = 'completed';
      task.exitCode = 0;
      task.output = `Task ${task.id} completed successfully`;
    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      task.exitCode = 1;
    }

    task.endTime = Date.now();
    this.emit('task-completed', { job, task });
  }

  /**
   * Get job by ID
   * 
   * @param jobId - Job ID
   * @returns Batch job or null
   */
  getJob(jobId: string): BatchJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get task by ID
   * 
   * @param jobId - Job ID
   * @param taskId - Task ID
   * @returns Batch task or null
   */
  getTask(jobId: string, taskId: string): BatchTask | null {
    const job = this.jobs.get(jobId);
    return job?.tasks.get(taskId) || null;
  }

  /**
   * Cancel job
   * 
   * @param jobId - Job ID
   */
  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    
    if (job) {
      job.status = 'cancelled';
      job.completedAt = Date.now();
      
      // Mark running tasks as cancelled
      for (const task of job.tasks.values()) {
        if (task.status === 'running' || task.status === 'pending') {
          task.status = 'skipped';
        }
      }
      
      this.emit('job-cancelled', job);
    }
  }

  /**
   * Get job statistics
   */
  getStats(): {
    totalJobs: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    averageDuration: number;
  } {
    const jobs = Array.from(this.jobs.values());
    
    const pending = jobs.filter(j => j.status === 'pending').length;
    const running = jobs.filter(j => j.status === 'running').length;
    const completed = jobs.filter(j => j.status === 'completed').length;
    const failed = jobs.filter(j => j.status === 'failed').length;
    const cancelled = jobs.filter(j => j.status === 'cancelled').length;
    
    const completedJobs = jobs.filter(j => j.completedAt && j.startedAt);
    const totalDuration = completedJobs.reduce(
      (sum, j) => sum + (j.completedAt! - j.startedAt!),
      0
    );
    const averageDuration = completedJobs.length > 0
      ? totalDuration / completedJobs.length
      : 0;

    return {
      totalJobs: jobs.length,
      pending,
      running,
      completed,
      failed,
      cancelled,
      averageDuration,
    };
  }

  /**
   * Clear jobs
   * 
   * @param status - Optional status filter
   */
  clearJobs(status?: BatchJobStatus): void {
    if (status) {
      for (const [id, job] of this.jobs.entries()) {
        if (job.status === status) {
          this.jobs.delete(id);
        }
      }
    } else {
      this.jobs.clear();
    }
  }
}

// Singleton instance
export const blaxelBatchJobs = new BlaxelBatchJobsManager();

/**
 * Create batch jobs manager
 * 
 * @returns Batch jobs manager
 */
export function createBatchJobsManager(): BlaxelBatchJobsManager {
  return new BlaxelBatchJobsManager();
}

/**
 * Quick batch execution helper
 * 
 * @param name - Job name
 * @param commands - Array of commands
 * @returns Job result
 */
export async function quickBatchExecute(
  name: string,
  commands: string[]
): Promise<{
  success: boolean;
  results: Array<{ command: string; output?: string; error?: string }>;
  duration: number;
}> {
  const manager = createBatchJobsManager();
  
  const job = manager.createJob(name, commands.map((cmd, i) => ({
    id: `task_${i}`,
    command: cmd,
  })));

  const startTime = Date.now();
  
  try {
    await manager.startJob(job.id);
    
    const results = Array.from(job.tasks.values()).map(task => ({
      command: task.command,
      output: task.output,
      error: task.error,
    }));

    return {
      success: job.status === 'completed',
      results,
      duration: Date.now() - startTime,
    };
  } finally {
    manager.clearJobs();
  }
}
