/**
 * Agent Worker - Runs OpenCode engine loop with Git-Backed VFS
 *
 * Features:
 * - Pull jobs from Redis queue
 * - Persistent OpenCode engine (no CLI spawn)
 * - Redis PubSub + Streams for events
 * - Checkpoint/resume for crash recovery
 * - Tool execution via ToolIntegrationManager
 * - Git-backed VFS for automatic commits and rollbacks
 * - Integration with task-router and provider-router for optimal execution
 */

import Redis from 'ioredis';
import { createLogger } from './logger';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import { getOpenCodeEngine, OpenCodeEngine, type OpenCodeEvent } from './opencode-engine';
import { checkpointManager, type AgentCheckpoint } from './checkpoint-manager';
import { taskRouter } from '../../../task-router';
import { providerRouter, latencyTracker } from '../../../../sandbox/provider-router';
import { determineExecutionPolicy } from '../../../../sandbox/types';

const logger = createLogger('Agent:Worker');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'agent:events';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:8888';
const NULLCLAW_URL = process.env.NULLCLAW_URL || 'http://localhost:3000';
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'opencode/minimax-m2.5-free';
const OPENCODE_MAX_STEPS = parseInt(process.env.OPENCODE_MAX_STEPS || '15');
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '4');
const GIT_VFS_AUTO_COMMIT = process.env.GIT_VFS_AUTO_COMMIT !== 'false';

// Redis clients
const redis = new Redis(REDIS_URL);
const redisPub = new Redis(REDIS_URL); // Dedicated publisher

// Constants
const PUBSUB_CHANNEL = 'agent:events';
const JOB_QUEUE = 'agent:jobs';

interface AgentJob {
  id: string;
  sessionId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  context?: string;
  tools?: string[];
  model?: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface ToolResult {
  success: boolean;
  output: string;
  exitCode: number;
}

interface AgentEvent {
  type: string;
  sessionId: string;
  data: any;
  timestamp: number;
}

// Persistent OpenCode engine (singleton)
let opencodeEngine: OpenCodeEngine;

/**
 * Publish event to Redis pubsub + stream
 */
async function publishEvent(event: AgentEvent): Promise<void> {
  const message = JSON.stringify(event);
  
  // Publish to pubsub for real-time subscribers
  await redisPub.publish(PUBSUB_CHANNEL, message);
  
  // Add to stream for persistence/replay
  try {
    await redis.xadd(REDIS_STREAM_KEY, '*', 'event', message);
  } catch (e) {
    logger.warn('Failed to add event to stream', { error: e });
  }
}

// Execute tool via ToolIntegrationManager (with MCP fallback)
async function executeTool(
  toolName: string,
  args: Record<string, any>,
  userId: string,
  conversationId: string,
  sessionId: string
): Promise<ToolResult> {
  try {
    // Try ToolIntegrationManager first (unified tool execution)
    const { getToolManager } = await import('@/lib/tools');
    const toolManager = getToolManager();
    
    const result = await toolManager.executeTool(
      toolName,
      args,
      {
        userId,
        conversationId,
        metadata: { sessionId }
      }
    );
    
    return {
      success: result.success ?? true,
      output: result.output ?? JSON.stringify(result),
      exitCode: result.success ? 0 : 1,
    };
  } catch (managerError: any) {
    logger.warn('ToolIntegrationManager failed, falling back to MCP', { toolName, error: managerError.message });
    
    // Fallback to direct MCP execution
    try {
      const response = await fetch(`${MCP_SERVER_URL}/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, args }),
      });

      if (!response.ok) {
        return {
          success: false,
          output: `MCP error: ${response.statusText}`,
          exitCode: 1,
        };
      }

      const result: any = await response.json();
      return {
        success: result.success ?? true,
        output: result.output ?? JSON.stringify(result),
        exitCode: result.success ? 0 : 1,
      };
    } catch (error: any) {
      logger.error('Tool execution failed', { toolName, error: error.message });
      return {
        success: false,
        output: `Tool execution failed: ${error.message}`,
        exitCode: 1,
      };
    }
  }
}

// Run OpenCode with persistent engine and task routing
async function runOpenCode(job: AgentJob): Promise<void> {
  const { id: jobId, sessionId, userId, conversationId, prompt, context, model } = job;
  const startTime = Date.now();

  logger.info('Starting job with task routing', { jobId, sessionId, userId });

  // Update job status
  job.status = 'processing';
  await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600);

  // Create workspace directory
  const workspaceDir = `/workspace/users/${userId}/sessions/${conversationId}`;
  await fs.mkdir(workspaceDir, { recursive: true }).catch(() => {});

  try {
    // Step 1: Analyze task and determine execution policy
    const executionPolicy = determineExecutionPolicy({
      task: prompt,
      requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(prompt),
      requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(prompt),
      requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(prompt),
      requiresGUI: /gui|desktop|browser|electron|tauri/i.test(prompt),
      isLongRunning: /server|daemon|service|long-running|persistent/i.test(prompt),
    });

    logger.info('Execution policy determined', { policy: executionPolicy, jobId });

    // Step 2: Select optimal provider using provider-router
    const providerSelection = await providerRouter.selectWithServices({
      type: 'agent',
      duration: executionPolicy === 'local-safe' ? 'short' : 'medium',
      requiresPersistence: executionPolicy === 'persistent-sandbox',
      needsServices: executionPolicy === 'desktop-required' ? ['desktop'] : ['pty'],
      performancePriority: 'latency',
    });

    logger.info('Provider selected', {
      provider: providerSelection.provider,
      confidence: providerSelection.confidence,
      reason: providerSelection.reason,
      jobId,
    });

    // Emit start events
    await publishEvent({
      type: 'job:started',
      sessionId,
      data: {
        jobId,
        prompt: prompt.substring(0, 100),
        executionPolicy,
        selectedProvider: providerSelection.provider,
      },
      timestamp: Date.now(),
    });

    await publishEvent({
      type: 'init',
      sessionId,
      data: {
        agent: 'opencode',
        sessionId,
        timestamp: Date.now(),
        gitVfsEnabled: GIT_VFS_AUTO_COMMIT,
        executionPolicy,
        provider: providerSelection.provider,
      },
      timestamp: Date.now(),
    });

    // Step 3: Execute task using task-router or direct V2 execution
    const result = await taskRouter.executeTask({
      id: jobId,
      userId,
      conversationId,
      task: prompt,
      stream: false,
      onStreamChunk: (chunk) => {
        publishEvent({
          type: 'token',
          sessionId,
          data: { content: chunk, timestamp: Date.now() },
          timestamp: Date.now(),
        }).catch(() => {});
      },
      onToolExecution: (toolName, args, result) => {
        publishEvent({
          type: 'tool:result',
          sessionId,
          data: { tool: toolName, args, result, timestamp: Date.now() },
          timestamp: Date.now(),
        }).catch(() => {});
      },
    });

    // Record latency for provider router
    const latency = Date.now() - startTime;
    latencyTracker.record(providerSelection.provider, latency);

    // Emit completion
    await publishEvent({
      type: 'done',
      sessionId,
      data: {
        response: result.response,
        timestamp: Date.now(),
        latency,
        provider: providerSelection.provider,
        executionPolicy,
      },
      timestamp: Date.now(),
    });

    logger.info('Job completed', {
      jobId,
      latency,
      success: result.success,
      provider: providerSelection.provider,
    });

  } catch (error: any) {
    const latency = Date.now() - startTime;
    logger.error('Job failed', { jobId, error: error.message });

    // Record failed latency
    try {
      latencyTracker.record('daytona' as any, latency);
    } catch {}

    await publishEvent({
      type: 'error',
      sessionId,
      data: { error: error.message, timestamp: Date.now() },
      timestamp: Date.now(),
    });
  }
}

// Main worker loop
async function startWorker(): Promise<void> {
  logger.info('Agent Worker starting', { concurrency: WORKER_CONCURRENCY });

  // Initialize persistent OpenCode engine (one per worker)
  opencodeEngine = getOpenCodeEngine({
    model: OPENCODE_MODEL,
    maxSteps: OPENCODE_MAX_STEPS,
  });

  // Wait for engine to be ready
  await opencodeEngine.ready();
  logger.info('OpenCode engine ready');

  // Process multiple jobs concurrently
  const workers: Promise<void>[] = [];

  for (let i = 0; i < WORKER_CONCURRENCY; i++) {
    const workerId = i;
    const worker = (async () => {
      while (true) {
        try {
          // Blocking pop from queue
          const result = await redis.brpop(JOB_QUEUE, 5);
          
          if (result) {
            const [, jobData] = result;
            const job: AgentJob = JSON.parse(jobData);
            logger.info(`Worker ${workerId} processing job`, { jobId: job.id });
            
            await runOpenCode(job);
          }
        } catch (error: any) {
          logger.error(`Worker ${workerId} error`, { error: error.message });
          await new Promise(resolve => setTimeout(resolve, 1000)); // Back off on error
        }
      }
    })();

    workers.push(worker);
  }

  await Promise.all(workers);
}

// Health check endpoint
const http = require('http');
const server = http.createServer(async (req: any, res: any) => {
  if (req.url === '/health') {
    const engineHealthy = opencodeEngine?.isHealthy() ?? false;
    let redisHealthy = false;
    try {
      await redis.ping();
      redisHealthy = true;
    } catch {}
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: engineHealthy && redisHealthy ? 'ok' : 'degraded',
      worker: 'agent-worker',
      engine: engineHealthy ? 'ready' : 'starting',
      redis: redisHealthy ? 'connected' : 'disconnected',
    }));
  } else if (req.url === '/ready') {
    const ready = (opencodeEngine?.isHealthy() ?? false);
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = parseInt(process.env.PORT || '3003');
server.listen(PORT, () => {
  logger.info(`Agent Worker health server listening on port ${PORT}`);
});

// Start worker
startWorker().catch(err => {
  logger.error('Worker failed to start', { error: err.message });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Worker shutting down');
  await opencodeEngine?.shutdown();
  await redis.quit();
  await redisPub.quit();
  process.exit(0);
});
