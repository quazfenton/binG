/**
 * Enhanced Workforce Manager
 * 
 * Task spawning and concurrency control with execution graph tracking
 * and background jobs integration.
 * 
 * Features:
 * - YAML-based state persistence (survives restarts)
 * - Concurrency control with configurable limits
 * - Execution graph integration for task tracking
 * - Background jobs support for recurring tasks
 * - Integration with task router for execution
 */

import { createLogger } from '../utils/logger';
import { addTask, loadState, updateTask, type WorkforceTask } from './workforce-state';
import { taskRouter } from './task-router';
import { executionGraphEngine } from './execution-graph';
import { enhancedBackgroundJobsManager } from './enhanced-background-jobs';

const logger = createLogger('Agent:WorkforceManager');

export interface SpawnTaskInput {
  title: string;
  description: string;
  agent: 'opencode' | 'nullclaw' | 'cli';
  scope?: string;
  cliCommand?: { command: string; args?: string[] };
  // Enhanced fields
  isRecurring?: boolean;
  interval?: number; // seconds, for recurring tasks
  tags?: string[];
  priority?: number;
}

class WorkforceManager {
  private activeTasks = new Map<string, Promise<void>>();
  private maxConcurrency = parseInt(process.env.WORKFORCE_MAX_CONCURRENCY || '4', 10);
  private executionGraphs = new Map<string, string>(); // conversationId -> graphId

  /**
   * Set execution graph engine for task tracking
   */
  setExecutionGraphEngine(executionGraphEngine: any): void {
    // Engine is imported, this is for future customization
    logger.debug('Execution graph engine set for workforce manager');
  }

  async spawnTask(
    userId: string,
    conversationId: string,
    input: SpawnTaskInput,
  ): Promise<WorkforceTask> {
    const task: WorkforceTask = {
      id: `task-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      title: input.title,
      description: input.description,
      agent: input.agent,
      scope: input.scope,
      status: 'pending',
      assignedAt: new Date().toISOString(),
    };

    // Create execution graph node for tracking
    const graphId = await this.getOrCreateExecutionGraph(userId, conversationId);
    if (graphId) {
      const graph = executionGraphEngine.getGraph(graphId);
      if (graph) {
        executionGraphEngine.addNode(graph, {
          id: task.id,
          type: 'agent_step',
          name: task.title,
          description: task.description,
          dependencies: [],
          metadata: {
            agent: task.agent,
            scope: task.scope,
            isRecurring: input.isRecurring,
            tags: input.tags,
            priority: input.priority,
          },
        });
      }
    }

    await addTask(userId, conversationId, task);

    // Handle recurring task
    if (input.isRecurring && input.interval) {
      await this.startRecurringTask(userId, conversationId, task, input);
    } else {
      this.runTask(userId, conversationId, task, input.cliCommand);
    }

    return task;
  }

  /**
   * Start a recurring background task
   */
  private async startRecurringTask(
    userId: string,
    conversationId: string,
    task: WorkforceTask,
    input: SpawnTaskInput,
  ): Promise<void> {
    try {
      // Start background job for recurring task
      const job = await enhancedBackgroundJobsManager.startJob({
        sessionId: conversationId,
        sandboxId: task.id, // Use task ID as sandbox identifier
        command: input.cliCommand?.command || 'echo "Recurring task"',
        args: input.cliCommand?.args,
        interval: input.interval!,
        description: task.title,
        tags: input.tags,
        quotaCategory: 'compute',
      });

      logger.info(`Recurring task started as background job`, {
        taskId: task.id,
        jobId: job.jobId,
        interval: input.interval,
      });
    } catch (error: any) {
      logger.error(`Failed to start recurring task as background job:`, error);
      // Fallback to simple interval-based execution
      this.runTask(userId, conversationId, task, input.cliCommand);
    }
  }

  /**
   * Get or create execution graph for conversation
   */
  private async getOrCreateExecutionGraph(userId: string, conversationId: string): Promise<string | null> {
    const existingGraphId = this.executionGraphs.get(conversationId);
    if (existingGraphId) {
      return existingGraphId;
    }

    try {
      const graph = executionGraphEngine.createGraph(conversationId);
      this.executionGraphs.set(conversationId, graph.id);
      return graph.id;
    } catch (error: any) {
      logger.warn(`Failed to create execution graph:`, error);
      return null;
    }
  }

  async processPending(userId: string, conversationId: string): Promise<void> {
    const state = await loadState(userId, conversationId);
    for (const task of state.tasks.filter(t => t.status === 'pending')) {
      if (this.activeTasks.size >= this.maxConcurrency) break;
      this.runTask(userId, conversationId, task);
    }
  }

  /**
   * Get task with execution graph tracking
   */
  getTaskStatus(taskId: string, conversationId: string): {
    task?: WorkforceTask;
    executionNode?: any;
  } {
    const graphId = this.executionGraphs.get(conversationId);
    let executionNode;

    if (graphId) {
      const graph = executionGraphEngine.getGraph(graphId);
      if (graph) {
        executionNode = graph.nodes.get(taskId);
      }
    }

    return { executionNode };
  }

  /**
   * Get workforce statistics with execution graph data
   */
  async getStats(userId: string, conversationId: string): Promise<{
    totalTasks: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    activeBackgroundJobs: number;
    executionGraphProgress?: number;
  }> {
    const state = await loadState(userId, conversationId);
    const graphId = this.executionGraphs.get(conversationId);

    let executionGraphProgress: number | undefined;
    if (graphId) {
      const graph = executionGraphEngine.getGraph(graphId);
      if (graph) {
        const nodes = Array.from(graph.nodes.values());
        const completed = nodes.filter(n => n.status === 'completed').length;
        executionGraphProgress = nodes.length > 0 ? (completed / nodes.length) * 100 : 0;
      }
    }

    const backgroundJobsStats = enhancedBackgroundJobsManager.getStats(conversationId);

    return {
      totalTasks: state.tasks.length,
      pending: state.tasks.filter(t => t.status === 'pending').length,
      running: state.tasks.filter(t => t.status === 'running').length,
      completed: state.tasks.filter(t => t.status === 'completed').length,
      failed: state.tasks.filter(t => t.status === 'failed').length,
      activeBackgroundJobs: backgroundJobsStats.running,
      executionGraphProgress,
    };
  }

  private runTask(
    userId: string,
    conversationId: string,
    task: WorkforceTask,
    cliCommand?: { command: string; args?: string[] },
  ): void {
    if (this.activeTasks.size >= this.maxConcurrency) {
      logger.warn('Concurrency limit reached; task will remain pending', { taskId: task.id });
      return;
    }

    // FIX (Bug 11): Attach a .catch handler to prevent unhandled promise rejections.
    // The promise is fire-and-forget (nobody awaits it), so without this catch,
    // any error that escapes the try/catch/finally would become an unhandled rejection.
    const promise = (async () => {
      try {
        await updateTask(userId, conversationId, task.id, {
          status: 'running',
          startedAt: new Date().toISOString(),
        });

        // Update execution graph node status
        this.updateExecutionGraphNode(conversationId, task.id, 'running');

        const result = await taskRouter.executeTask({
          id: task.id,
          userId,
          conversationId,
          task: task.description,
          preferredAgent: task.agent,
          cliCommand,
        });

        await updateTask(userId, conversationId, task.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          result: typeof result?.response === 'string' ? result.response : JSON.stringify(result),
        });

        // Update execution graph node status
        this.updateExecutionGraphNode(conversationId, task.id, 'completed', result);

      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Task failed';
        await updateTask(userId, conversationId, task.id, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: message,
        });

        // Update execution graph node with error
        this.updateExecutionGraphNode(conversationId, task.id, 'failed', undefined, error instanceof Error ? error : new Error(message));
      } finally {
        this.activeTasks.delete(task.id);
      }
    })();

    // Prevent unhandled rejection — errors are already caught inside the IIFE
    promise.catch((err) => {
      // This should never trigger since the inner try/catch handles everything,
      // but it's a safety net for errors in the catch/finally blocks themselves.
      logger.error('[WorkforceManager] Unhandled error in runTask (safety net):', err);
    });

    this.activeTasks.set(task.id, promise);
  }

  /**
   * Update execution graph node status
   */
  private updateExecutionGraphNode(
    conversationId: string,
    taskId: string,
    status: 'pending' | 'running' | 'completed' | 'failed',
    result?: any,
    error?: Error,
  ): void {
    const graphId = this.executionGraphs.get(conversationId);
    if (!graphId) return;

    const graph = executionGraphEngine.getGraph(graphId);
    if (!graph) return;

    const node = graph.nodes.get(taskId);
    if (!node) return;

    node.status = status as any;
    if (result) {
      node.result = result;
    }
    if (error) {
      node.error = error.message;
    }
    if (status === 'completed' || status === 'failed') {
      node.completedAt = Date.now();
    }
    if (status === 'running') {
      node.startedAt = Date.now();
    }
  }
}

export const workforceManager = new WorkforceManager();
