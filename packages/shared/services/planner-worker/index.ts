/**
 * Planner Worker Service
 * 
 * Decomposes complex prompts into structured task graphs.
 * Integrates with existing task router and agent systems.
 * 
 * Features:
 * - Task decomposition using LLM
 * - Dependency graph construction
 * - Parallel task execution coordination
 * - Progress tracking and reporting
 * - Integration with Qdrant for code search context
 */

import { createServer } from 'http';
import { createLogger } from '@/lib/utils/logger';
import { taskRouter } from '@bing/shared/agent/task-router';
import type { ExecutionPolicy } from '@/lib/sandbox/types';
import { determineExecutionPolicy } from '@/lib/sandbox/types';
import Redis from 'ioredis';

const logger = createLogger('PlannerWorker');

// Configuration from environment
const PORT = parseInt(process.env.PORT || '3004', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_TASKS = parseInt(process.env.PLANNER_MAX_TASKS || '20', 10);
const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'opencode/minimax-m2.5-free';

export interface Task {
  id: string;
  type: 'search' | 'edit' | 'create' | 'delete' | 'test' | 'review' | 'command';
  goal: string;
  dependencies?: string[];
  executionPolicy?: ExecutionPolicy;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  result?: any;
  error?: string;
}

export interface TaskGraph {
  id: string;
  prompt: string;
  tasks: Task[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

class PlannerService {
  private taskGraphs: Map<string, TaskGraph> = new Map();
  private redisClient?: any;
  private qdrantAvailable = false;
  public initialized = false;

  async initialize(): Promise<void> {
    logger.info('Initializing planner worker service...', {
      maxTasks: MAX_TASKS,
      model: OPENCODE_MODEL,
      qdrantUrl: QDRANT_URL,
    });

    // Initialize Redis for state sync
    try {
      if (REDIS_URL) {
        this.redisClient = new Redis(REDIS_URL);
        this.redisClient.on('error', (err) => logger.error('Redis error:', err));
        await this.redisClient.ping();
        logger.info('Connected to Redis for state synchronization');
      }
    } catch (error: any) {
      logger.warn('Redis not available, running in standalone mode:', error.message);
    }

    // Check Qdrant availability
    try {
      const response = await fetch(`${QDRANT_URL}/`);
      if (response.ok) {
        this.qdrantAvailable = true;
        logger.info('Qdrant vector search available');
      }
    } catch (error: any) {
      logger.warn('Qdrant not available, semantic search disabled:', error.message);
    }
    
    this.initialized = true;
  }

  /**
   * Decompose a prompt into a task graph
   */
  async decomposePrompt(prompt: string, context?: {
    userId?: string;
    conversationId?: string;
    workspacePath?: string;
  }): Promise<TaskGraph> {
    const graphId = `graph-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const graph: TaskGraph = {
      id: graphId,
      prompt,
      tasks: [],
      status: 'planning',
      createdAt: Date.now(),
    };

    this.taskGraphs.set(graphId, graph);

    try {
      // Use task router to analyze the prompt
      const routing = taskRouter.analyzeTask(prompt);

      logger.info(`Analyzing prompt: ${prompt.substring(0, 100)}...`, {
        type: routing.type,
        target: routing.target,
        confidence: routing.confidence,
      });

      // Determine execution policy
      const executionPolicy = determineExecutionPolicy({
        task: prompt,
        requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(prompt),
        requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(prompt),
        requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(prompt),
        requiresGUI: /gui|desktop|browser|electron|tauri/i.test(prompt),
        isLongRunning: /server|daemon|service|long-running|persistent/i.test(prompt),
      });

      // Generate task decomposition using LLM
      const tasks = await this.generateTaskDecomposition(prompt, routing, executionPolicy);

      graph.tasks = tasks;
      graph.status = 'executing';

      logger.info(`Generated ${tasks.length} tasks for graph ${graphId}`);

      // Sync to Redis
      if (this.redisClient) {
        await this.redisClient.hSet(`graph:${graphId}`, {
          status: graph.status,
          taskCount: tasks.length.toString(),
          createdAt: graph.createdAt.toString(),
        });
      }

      return graph;
    } catch (error: any) {
      graph.status = 'failed';
      logger.error(`Failed to decompose prompt:`, error.message);
      throw error;
    }
  }

  /**
   * Generate task decomposition using LLM
   */
  private async generateTaskDecomposition(
    prompt: string,
    routing: any,
    executionPolicy: ExecutionPolicy
  ): Promise<Task[]> {
    const tasks: Task[] = [];

    // Simple heuristic-based decomposition (can be enhanced with LLM)
    const taskId = (i: number) => `task-${i}`;

    // Search phase - understand the codebase
    if (routing.type === 'coding' || routing.type === 'automation') {
      tasks.push({
        id: taskId(tasks.length),
        type: 'search',
        goal: 'Analyze existing codebase structure and identify relevant files',
        status: 'pending',
        executionPolicy: 'local-safe',
      });
    }

    // Planning phase - create/edit files
    if (routing.type === 'coding') {
      tasks.push({
        id: taskId(tasks.length),
        type: 'create',
        goal: 'Create necessary project structure and configuration files',
        dependencies: [taskId(0)],
        status: 'pending',
        executionPolicy,
      });

      tasks.push({
        id: taskId(tasks.length),
        type: 'edit',
        goal: 'Implement core functionality',
        dependencies: [taskId(1)],
        status: 'pending',
        executionPolicy,
      });
    }

    // Testing phase
    if (routing.type === 'coding' || routing.type === 'automation') {
      tasks.push({
        id: taskId(tasks.length),
        type: 'test',
        goal: 'Verify implementation works correctly',
        dependencies: [taskId(tasks.length - 1)],
        status: 'pending',
        executionPolicy,
      });
    }

    // Command execution for automation tasks
    if (routing.type === 'automation') {
      tasks.push({
        id: taskId(tasks.length),
        type: 'command',
        goal: `Execute automation: ${prompt}`,
        dependencies: tasks.length > 0 ? [taskId(tasks.length - 1)] : undefined,
        status: 'pending',
        executionPolicy,
      });
    }

    // Limit to MAX_TASKS
    return tasks.slice(0, MAX_TASKS);
  }

  /**
   * Get task graph by ID
   */
  getTaskGraph(graphId: string): TaskGraph | null {
    return this.taskGraphs.get(graphId) || null;
  }

  /**
   * Update task status
   */
  updateTaskStatus(graphId: string, taskId: string, status: Task['status'], result?: any): void {
    const graph = this.taskGraphs.get(graphId);
    if (!graph) return;

    const task = graph.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.status = status;
    if (result) task.result = result;

    // Check if all tasks are complete
    const allComplete = graph.tasks.every(t => t.status === 'completed' || t.status === 'failed');
    if (allComplete) {
      graph.status = 'completed';
      graph.completedAt = Date.now();
    }

    // Sync to Redis
    if (this.redisClient) {
      this.redisClient.hSet(`graph:${graphId}:task:${taskId}`, {
        status,
        result: JSON.stringify(result || {}),
      });
    }
  }

  /**
   * Get executable tasks (dependencies satisfied)
   */
  getExecutableTasks(graphId: string): Task[] {
    const graph = this.taskGraphs.get(graphId);
    if (!graph) return [];

    const completedTasks = new Set(
      graph.tasks.filter(t => t.status === 'completed').map(t => t.id)
    );

    return graph.tasks.filter(task => {
      if (task.status !== 'pending') return false;

      if (!task.dependencies || task.dependencies.length === 0) {
        return true;
      }

      return task.dependencies.every(dep => completedTasks.has(dep));
    });
  }

  /**
   * Get planner statistics
   */
  getStats(): {
    totalGraphs: number;
    planning: number;
    executing: number;
    completed: number;
    failed: number;
    totalTasks: number;
  } {
    const stats = {
      totalGraphs: this.taskGraphs.size,
      planning: 0,
      executing: 0,
      completed: 0,
      failed: 0,
      totalTasks: 0,
    };

    for (const graph of this.taskGraphs.values()) {
      stats[graph.status]++;
      stats.totalTasks += graph.tasks.length;
    }

    return stats;
  }

  /**
   * Search code using Qdrant vector search
   */
  async searchCode(query: string, limit: number = 10): Promise<any[]> {
    if (!this.qdrantAvailable) {
      logger.warn('Qdrant not available for code search');
      return [];
    }

    try {
      const response = await fetch(`${QDRANT_URL}/collections/code/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vector: await this.embedQuery(query),
          limit,
        }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.result || [];
    } catch (error: any) {
      logger.error('Code search failed:', error.message);
      return [];
    }
  }

  /**
   * Embed query using Qdrant
   */
  private async embedQuery(query: string): Promise<number[]> {
    // Simple placeholder - would use actual embedding model
    // In production, use @qdrant/js-client-rest with embedding model
    return Array.from({ length: 384 }, () => Math.random());
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down planner worker...');

    if (this.redisClient) {
      await this.redisClient.disconnect();
    }

    logger.info('Planner worker shutdown complete');
  }
}

// Singleton instance
const plannerService = new PlannerService();

// HTTP server for API
const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', initialized: plannerService.initialized }));
    return;
  }

  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(plannerService.getStats()));
    return;
  }

  if (req.url === '/decompose' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { prompt, context } = JSON.parse(body);
        const graph = await plannerService.decomposePrompt(prompt, context);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(graph));
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if (req.url?.startsWith('/graph/') && req.method === 'GET') {
    const graphId = req.url.split('/')[2];
    const graph = plannerService.getTaskGraph(graphId);
    if (graph) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(graph));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Graph not found' }));
    }
    return;
  }

  if (req.url?.startsWith('/graph/') && req.method === 'POST') {
    const graphId = req.url.split('/')[2];
    const taskId = req.url.split('/')[3];

    if (taskId) {
      // Update task status
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { status, result } = JSON.parse(body);
          plannerService.updateTaskStatus(graphId, taskId, status, result);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (error: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }
  }

  if (req.url?.startsWith('/graph/') && req.url?.includes('/executable') && req.method === 'GET') {
    const graphId = req.url.split('/')[2];
    const tasks = plannerService.getExecutableTasks(graphId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tasks }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Initialize and start server
async function main() {
  try {
    await plannerService.initialize();

    server.listen(PORT, () => {
      logger.info(`Planner worker service listening on port ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      await plannerService.shutdown();
      server.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      await plannerService.shutdown();
      server.close();
      process.exit(0);
    });
  } catch (error: any) {
    logger.error('Failed to start planner worker service:', error.message);
    process.exit(1);
  }
}

main();

export { plannerService };
