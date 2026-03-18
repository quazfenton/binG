import { createLogger } from '../utils/logger';
import { addTask, loadState, updateTask, type WorkforceTask } from './workforce-state';
import { taskRouter } from './task-router';

const logger = createLogger('Agent:WorkforceManager');

export interface SpawnTaskInput {
  title: string;
  description: string;
  agent: 'opencode' | 'nullclaw' | 'cli';
  scope?: string;
  cliCommand?: { command: string; args?: string[] };
}

class WorkforceManager {
  private activeTasks = new Map<string, Promise<void>>();
  private maxConcurrency = parseInt(process.env.WORKFORCE_MAX_CONCURRENCY || '4', 10);

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

    await addTask(userId, conversationId, task);
    this.runTask(userId, conversationId, task, input.cliCommand);
    return task;
  }

  async processPending(userId: string, conversationId: string): Promise<void> {
    const state = await loadState(userId, conversationId);
    for (const task of state.tasks.filter(t => t.status === 'pending')) {
      if (this.activeTasks.size >= this.maxConcurrency) break;
      this.runTask(userId, conversationId, task);
    }
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

    const promise = (async () => {
      try {
        await updateTask(userId, conversationId, task.id, {
          status: 'running',
          startedAt: new Date().toISOString(),
        });

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
      } catch (error: any) {
        await updateTask(userId, conversationId, task.id, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: error.message || 'Task failed',
        });
      } finally {
        this.activeTasks.delete(task.id);
      }
    })();

    this.activeTasks.set(task.id, promise);
  }
}

export const workforceManager = new WorkforceManager();
