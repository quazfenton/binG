/**
 * Agent Worker - Runs OpenCode engine loop with Git-Backed VFS
 *
 * Features:
 * - Pull jobs from Redis queue
 * - Persistent OpenCode engine (no CLI spawn)
 * - Redis PubSub + Streams for events
 * - Checkpoint/resume for crash recovery
 * - Tool execution via MCP server
 * - Git-backed VFS for automatic commits and rollbacks
 */

import Redis from 'ioredis';
import { createLogger } from './logger';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import { getOpenCodeEngine, OpenCodeEngine, type OpenCodeEvent } from './opencode-engine';
import { checkpointManager, type AgentCheckpoint } from './checkpoint-manager';

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

// Execute tool via MCP server
async function executeTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
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

// Run OpenCode with persistent engine
async function runOpenCode(job: AgentJob): Promise<void> {
  const { id: jobId, sessionId, userId, conversationId, prompt, context, model } = job;
  
  logger.info('Starting job with persistent engine', { jobId, sessionId, userId });

  // Update job status
  job.status = 'processing';
  await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600);

  // Create workspace directory
  const workspaceDir = `/workspace/users/${userId}/sessions/${conversationId}`;
  await fs.mkdir(workspaceDir, { recursive: true }).catch(() => {});

  try {
    // Emit start events
    await publishEvent({
      type: 'job:started',
      sessionId,
      data: { jobId, prompt: prompt.substring(0, 100) },
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
      },
      timestamp: Date.now(),
    });

    // Initialize git-backed VFS for this session
    let gitVFS: any = null;
    if (GIT_VFS_AUTO_COMMIT) {
      try {
        // Dynamic import to avoid circular dependencies
        const { virtualFilesystem } = await import('../../../../../lib/virtual-filesystem/virtual-filesystem-service');
        gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
          autoCommit: true,
          sessionId,
          enableShadowCommits: true,
        });
        logger.info('Git-backed VFS initialized', { sessionId, userId });
      } catch (vfsError: any) {
        logger.warn('Failed to initialize git-backed VFS, continuing without', { error: vfsError.message });
      }
    }

    // Track file changes for git commit
    const fileChanges: Array<{ path: string; content: string; operation: string }> = [];

    // Run with persistent engine (no CLI spawn!)
    await opencodeEngine.run({
      sessionId,
      prompt,
      context,
      onEvent: async (event) => {
        // Transform and publish events
        switch (event.type) {
          case 'text':
            await publishEvent({
              type: 'token',
              sessionId,
              data: { content: event.data.text, timestamp: Date.now() },
              timestamp: Date.now(),
            });
            break;

          case 'tool':
            const toolName = event.data.tool;
            const toolArgs = event.data.args;

            await publishEvent({
              type: 'tool:start',
              sessionId,
              data: { tool: toolName, args: toolArgs, timestamp: Date.now() },
              timestamp: Date.now(),
            });

            // Execute tool and get result
            const toolResult = await executeTool(toolName, toolArgs);

            // Track file changes for git commit
            if (gitVFS && toolName && (toolName.includes('write') || toolName.includes('edit') || toolName.includes('create'))) {
              const filePath = toolArgs.path || toolArgs.file;
              const content = toolArgs.content;
              if (filePath && content) {
                fileChanges.push({ path: filePath, content, operation: toolName });
                // Write to git-backed VFS (auto-commits)
                try {
                  await gitVFS.writeFile(userId, filePath, content);
                  logger.debug('File written to git-backed VFS', { path: filePath, sessionId });
                } catch (vfsError: any) {
                  logger.warn('Failed to write to git-backed VFS', { path: filePath, error: vfsError.message });
                }
              }
            }

            await publishEvent({
              type: 'tool:result',
              sessionId,
              data: { tool: toolName, args: toolArgs, result: toolResult, timestamp: Date.now() },
              timestamp: Date.now(),
            });
            break;

          case 'done':
            // Commit all file changes as single commit
            if (gitVFS && fileChanges.length > 0) {
              try {
                await gitVFS.commitChanges(userId, `Agent completed: ${prompt.substring(0, 50)}...`);
                logger.info('Git commit created for file changes', { count: fileChanges.length, sessionId });
                
                await publishEvent({
                  type: 'git:commit',
                  sessionId,
                  data: { 
                    filesChanged: fileChanges.length,
                    paths: fileChanges.map(fc => fc.path),
                    timestamp: Date.now(),
                  },
                  timestamp: Date.now(),
                });
              } catch (commitError: any) {
                logger.warn('Failed to commit changes to git', { error: commitError.message });
              }
            }

            await publishEvent({
              type: 'done',
              sessionId,
              data: { 
                response: event.data.response, 
                timestamp: Date.now(),
                filesChanged: fileChanges.length,
              },
              timestamp: Date.now(),
            });
            break;

          case 'error':
            // Rollback on error if git VFS enabled
            if (gitVFS && GIT_VFS_AUTO_COMMIT) {
              try {
                const state = await gitVFS.getState(userId);
                if (state.version > 0) {
                  await gitVFS.rollback(userId, state.version - 1);
                  logger.info('Rolled back changes due to error', { sessionId, version: state.version });
                }
              } catch (rollbackError: any) {
                logger.warn('Failed to rollback', { error: rollbackError.message });
              }
            }

            await publishEvent({
              type: 'error',
              sessionId,
              data: { error: event.data.error, timestamp: Date.now() },
              timestamp: Date.now(),
            });
            break;
        }
      },
    });

    // Update job status
    job.status = 'completed';
    await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600);

    await publishEvent({
      type: 'job:completed',
      sessionId,
      data: { jobId, status: 'completed' },
      timestamp: Date.now(),
    });

    logger.info('Job completed', { jobId });

  } catch (error: any) {
    logger.error('Job failed', { jobId, error: error.message });

    job.status = 'failed';
    await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600);

    await publishEvent({
      type: 'error',
      sessionId,
      data: { jobId, error: error.message, timestamp: Date.now() },
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
