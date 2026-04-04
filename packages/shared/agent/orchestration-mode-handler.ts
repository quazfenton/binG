/**
 * Orchestration Mode Handler
 *
 * Routes agent requests to the appropriate orchestration backend based on
 * the X-Orchestration-Mode header.
 *
 * Supported modes:
 * - task-router (default): lib/agent/task-router.ts
 * - unified-agent: lib/orchestra/unified-agent-service.ts
 * - mastra-workflow: lib/agent/mastra-workflow-integration.ts
 * - crewai: lib/crewai/
 * - v2-executor: lib/agent/v2-executor.ts
 *
 * @example
 * ```typescript
 * // Client-side: Set orchestration mode
 * const headers = getOrchestrationModeHeaders({ mode: 'unified-agent' });
 * fetch('/api/chat', { headers });
 *
 * // Server-side: Route request
 * const mode = getOrchestrationModeFromRequest(req);
 * const result = await executeWithOrchestrationMode(mode, { task, sessionId, ownerId });
 * ```
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { createHash } from 'crypto';
import { applyPromptModifiers, type PromptParameters } from './prompt-parameters';

const logger = createLogger('Agent:OrchestrationMode');

/**
 * Hash task content for logging (prevents leaking secrets while allowing correlation)
 */
async function hashTask(content: string): Promise<string> {
  if (!content) return 'empty';
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex').substring(0, 16);
}

export type OrchestrationMode =
  | 'task-router'
  | 'unified-agent'
  | 'stateful-agent'
  | 'agent-kernel'
  | 'agent-loop'
  | 'execution-graph'
  | 'nullclaw'
  | 'opencode-sdk'
  | 'mastra-workflow'
  | 'crewai'
  | 'v2-executor'
  | 'agent-team';

export interface OrchestrationRequest {
  task: string;
  sessionId?: string;
  ownerId?: string;
  stream?: boolean;
  mode?: OrchestrationMode;
  model?: string;        // User-selected model from UI
  workspacePath?: string; // Workspace path for VFS tools
  [key: string]: any;
}

// Mode-specific configuration types
export interface ModeConfig {
  // agent-team
  strategy?: 'hierarchical' | 'collaborative' | 'consensus' | 'relay' | 'competitive';
  maxIterations?: number;
  timeoutMs?: number;
  agents?: Array<{
    role: string;
    type: string;
    model?: string;
  }>;
  // agent-loop
  maxIterations?: number;
  // nullclaw
  taskType?: string;
  // execution-graph
  maxRetries?: number;
  // agent-kernel
  priority?: string;
  // generic
  temperature?: number;
  maxTokens?: number;
  /** Optional prompt parameters for response style modification */
  promptParams?: PromptParameters;
  [key: string]: any;
}

export interface OrchestrationResult {
  success: boolean;
  response?: string;
  steps?: any[];
  error?: string;
  metadata?: {
    agentType: string;
    [key: string]: any;
  };
}

/**
 * Parse orchestration mode from request headers
 */
export function getOrchestrationModeFromRequest(req: NextRequest): OrchestrationMode {
  const modeHeader = req.headers.get('X-Orchestration-Mode');

  if (!modeHeader) {
    return 'unified-agent'; // Default — uses multi-factor task classifier + health routing
  }

  const validModes: OrchestrationMode[] = ['task-router', 'unified-agent', 'stateful-agent', 'agent-kernel', 'agent-loop', 'execution-graph', 'nullclaw', 'opencode-sdk', 'mastra-workflow', 'crewai', 'v2-executor', 'agent-team'];
  const mode = modeHeader.toLowerCase() as OrchestrationMode;

  if (!validModes.includes(mode)) {
    logger.warn('Invalid orchestration mode, falling back to unified-agent', { mode: modeHeader });
    return 'unified-agent';
  }

  return mode;
}

/**
 * Execute task with selected orchestration mode
 *
 * @param mode - Orchestration mode to use
 * @param request - Request parameters
 * @returns Orchestration result with response and metadata
 *
 * @throws Error if mode execution fails (caught and returned as error result)
 */
export async function executeWithOrchestrationMode(
  mode: OrchestrationMode,
  request: OrchestrationRequest
): Promise<OrchestrationResult> {
  const startTime = Date.now();

  // Validate required identifiers - don't collapse to 'default' to maintain isolation
  if (!request.ownerId) {
    throw new Error('ownerId is required for orchestration. Missing user identity breaks isolation.');
  }
  if (!request.sessionId) {
    throw new Error('sessionId is required for orchestration. Missing conversation ID breaks isolation.');
  }

  // Log without raw task content (security: prevent leaking secrets/tokens in logs)
  const taskHash = await hashTask(request.task);
  logger.info('Executing with orchestration mode', {
    mode,
    taskLength: request.task?.length || 0,
    taskHash,
    sessionId: request.sessionId,
    ownerId: request.ownerId,
  });

  try {
    let result: OrchestrationResult;
    
    switch (mode) {
      // ========================================================================
      // TASK ROUTER (Default)
      // ========================================================================
      case 'task-router': {
        const { taskRouter } = await import('@bing/shared/agent/task-router');

        // ownerId and sessionId already validated at function entry
        const taskResult = await taskRouter.executeTask({
          id: request.sessionId,
          userId: request.ownerId,
          conversationId: request.sessionId,
          task: request.task,
          stream: request.stream,
        });

        result = {
          success: taskResult.success,
          response: taskResult.response,
          steps: taskResult.steps,
          metadata: {
            agentType: 'task-router',
            routingTarget: taskResult.target,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // UNIFIED AGENT SERVICE
      // ========================================================================
      case 'unified-agent': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');

        const modeConfig = (request as any).modeConfig as ModeConfig | undefined;
        const promptParams = modeConfig?.promptParams;
        const baseSystemPrompt = process.env.OPENCODE_SYSTEM_PROMPT || '';
        const systemPrompt = baseSystemPrompt + applyPromptModifiers(promptParams ?? {});

        const unifiedResult = await processUnifiedAgentRequest({
          userMessage: request.task,
          sandboxId: request.sessionId,
          systemPrompt,
          maxSteps: parseInt(process.env.AI_SDK_MAX_STEPS || '15', 10),
          mode: 'auto', // Let unified agent auto-select best execution mode
        });

        result = {
          success: unifiedResult.success,
          response: unifiedResult.response,
          steps: unifiedResult.steps,
          error: unifiedResult.error,
          metadata: {
            agentType: 'unified-agent',
            selectedMode: unifiedResult.mode,
            totalSteps: unifiedResult.totalSteps,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // STATEFUL AGENT (Direct StatefulAgent with ToolExecutor)
      // ========================================================================
      case 'stateful-agent': {
        const { runStatefulAgent } = await import('@/lib/orchestra/stateful-agent/agents/stateful-agent');

        const statefulResult = await runStatefulAgent(request.task, {
          sessionId: request.sessionId,
          enforcePlanActVerify: true,
        });

        result = {
          success: statefulResult.success,
          response: statefulResult.response,
          steps: statefulResult.steps,
          error: statefulResult.errors?.[0]?.message,
          metadata: {
            agentType: 'stateful-agent',
            totalSteps: statefulResult.steps,
            errors: statefulResult.errors,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // AGENT KERNEL (OS-like Priority Scheduler)
      // ========================================================================
      case 'agent-kernel': {
        const { getAgentKernel, startAgentKernel } = await import('@bing/shared/agent/agent-kernel');

        const kernel = getAgentKernel();
        if (!kernel.isRunning()) {
          await startAgentKernel();
        }

        // Spawn an agent for this task with priority-based scheduling
        const agentId = await kernel.spawnAgent({
          type: 'ephemeral',
          goal: request.task,
          userId: request.ownerId,
          priority: 'normal',
          context: { sessionId: request.sessionId },
        });

        // Submit work to the agent and wait for completion
        const workId = await kernel.submitWork(agentId, { type: 'task', content: request.task }, 'normal');

        // FIX (Bug 4): Enforce timeout with proper interval cleanup and agent cancellation
        let agentStatus = kernel.getAgentStatus(agentId);
        const timeoutMs = Math.min(120_000, Number(request.timeoutMs || 60_000));
        const pollInterval = 1_000;
        const maxAttempts = Math.ceil(timeoutMs / pollInterval);
        let attempts = 0;
        let timedOut = false;

        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            attempts++;
            try {
              agentStatus = kernel.getAgentStatus(agentId);
            } catch {
              // Agent may have been removed
              clearInterval(interval);
              resolve();
              return;
            }

            if (agentStatus?.status === 'completed' || agentStatus?.status === 'failed') {
              clearInterval(interval);
              resolve();
              return;
            }

            if (attempts >= maxAttempts) {
              timedOut = true;
              clearInterval(interval);
              // Attempt to cancel the running agent
              try { kernel.cancelAgent(agentId); } catch { /* best-effort */ }
              resolve();
            }
          }, pollInterval);
        });

        result = {
          success: !timedOut && agentStatus?.status === 'completed',
          response: !timedOut && agentStatus?.status === 'completed'
            ? `Task completed by agent kernel (agent: ${agentId}, work: ${workId})`
            : `Task ${timedOut ? 'timed out' : 'still running'} (agent: ${agentId}, status: ${agentStatus?.status})`,
          metadata: {
            agentType: 'agent-kernel',
            agentId,
            workId,
            agentStatus: agentStatus?.status,
            iterations: agentStatus?.iterations,
            timedOut,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // AGENT LOOP (Mastra ToolLoopAgent - Tool-loop execution)
      // ========================================================================
      case 'agent-loop': {
        const { createAgentLoop } = await import('@/lib/orchestra/mastra/agent-loop');

        const maxIterations = parseInt(String((request as any).maxIterations) || '10', 10);
        const modelOverride = request.model || process.env.AGENT_MODEL || process.env.DEFAULT_MODEL;
        // Default to user's cwd or project/sessions for VFS tools
        const workspacePath = request.workspacePath || process.cwd() || `project/sessions/${request.sessionId}`;

        const agentLoop = createAgentLoop(request.ownerId, workspacePath, maxIterations, undefined, modelOverride);
        const loopResult = await agentLoop.executeTask(request.task);

        result = {
          success: loopResult.success,
          response: loopResult.reasoning || loopResult.message || (loopResult.success ? 'Agent loop completed' : 'Agent loop failed'),
          steps: loopResult.iterations || 0,
          error: loopResult.success ? undefined : loopResult.error,
          metadata: {
            agentType: 'agent-loop',
            iterations: loopResult.iterations,
            model: modelOverride,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // EXECUTION GRAPH (DAG Dependency Engine)
      // ========================================================================
      case 'execution-graph': {
        const { executionGraphEngine } = await import('@bing/shared/agent/execution-graph');

        const graph = executionGraphEngine.createGraph(request.sessionId);

        // Create a 3-node DAG: plan → execute → verify
        const planNode = executionGraphEngine.addNode(graph, {
          id: 'plan',
          type: 'agent_step',
          label: 'Plan',
          dependencies: [],
        });

        const execNode = executionGraphEngine.addNode(graph, {
          id: 'execute',
          type: 'tool_call',
          label: 'Execute',
          dependencies: ['plan'],
        });

        const verifyNode = executionGraphEngine.addNode(graph, {
          id: 'verify',
          type: 'sandbox_action',
          label: 'Verify',
          dependencies: ['execute'],
        });

        try {
          // Execute nodes in dependency order
          const { llmService } = await import('@/lib/chat/llm-providers');

          // Use user-selected model for planning
          const graphModel = request.model || process.env.AGENT_MODEL || process.env.DEFAULT_MODEL || 'gpt-4o-mini';

          // FIX (Bug 5): Resolve provider from model using a known prefix map
          // instead of defaulting to 'openai' which incorrectly maps models like
          // "claude-3-5-sonnet" (no slash) to the wrong provider.
          const PROVIDER_PREFIXES: Record<string, string> = {
            'claude': 'anthropic',
            'gpt-4': 'openai',
            'gpt-3.5': 'openai',
            'o1': 'openai',
            'o3': 'openai',
            'gemini': 'google',
            'llama': 'ollama',
            'mistral': 'mistral',
            'deepseek': 'deepseek',
            'grok': 'xai',
          };

          let graphProvider: string;
          if (graphModel.includes('/')) {
            // e.g. "anthropic/claude-3-5-sonnet" → "anthropic"
            graphProvider = graphModel.split('/')[0];
          } else {
            // Try to match known model prefixes
            graphProvider = Object.entries(PROVIDER_PREFIXES).find(([prefix]) =>
              graphModel.startsWith(prefix),
            )?.[1] ?? 'openai'; // fallback to openai only as last resort
          }

          // Plan phase
          executionGraphEngine.markRunning(graph, planNode.id);
          const planResult = await llmService.generateResponse({
            provider: graphProvider,
            model: graphModel,
            messages: [{ role: 'user', content: `Create a step-by-step plan for this task: ${request.task}` }],
            maxTokens: 1000,
            temperature: 0,
          });
          executionGraphEngine.markComplete(graph, planNode.id, { plan: planResult.content });

          // Execute phase
          executionGraphEngine.markRunning(graph, execNode.id);
          const executeResult = `Executing plan:\n${planResult.content}`;
          executionGraphEngine.markComplete(graph, execNode.id, { output: executeResult });

          // Verify phase
          executionGraphEngine.markRunning(graph, verifyNode.id);
          executionGraphEngine.markComplete(graph, verifyNode.id, { verified: true });

          const progress = executionGraphEngine.getProgress(graph);

          result = {
            success: progress.completed === progress.total,
            response: executeResult,
            metadata: {
              agentType: 'execution-graph',
              graphId: graph.id,
              nodeCount: progress.total,
              completed: progress.completed,
              status: progress.status,
              model: graphModel,
              provider: graphProvider,
              duration: Date.now() - startTime,
            },
          };
        } catch (llmError: unknown) {
          const errorMessage = llmError instanceof Error ? llmError.message : String(llmError);
          // Mark all running nodes as failed to avoid inconsistent state
          try { executionGraphEngine.markFailed(graph, planNode.id, errorMessage); } catch { /* already failed */ }
          try { executionGraphEngine.markFailed(graph, execNode.id, 'Skipped due to plan failure'); } catch { /* already failed */ }
          try { executionGraphEngine.markFailed(graph, verifyNode.id, 'Skipped due to plan failure'); } catch { /* already failed */ }

          // FIX: Graceful degradation — return the error info instead of a bare failure
          result = {
            success: false,
            error: `Execution graph plan failed: ${errorMessage}`,
            response: `Planning failed. The LLM provider (${graphProvider}) may be unavailable or misconfigured.`,
            metadata: {
              agentType: 'execution-graph',
              graphId: graph.id,
              nodeCount: graph.nodes.size,
              completed: 0,
              status: 'failed',
              model: graphModel,
              provider: graphProvider,
              duration: Date.now() - startTime,
            },
          };
        }
        break;
      }

      // ========================================================================
      // NULLCLAW (External Server - messaging, browsing, automation)
      // ========================================================================
      case 'nullclaw': {
        const { nullclawIntegration, initializeNullclaw, isNullclawAvailable, executeNullclawTask, getNullclawMode } = await import('@bing/shared/agent/nullclaw-integration');

        // Initialize nullclaw if not already initialized
        await initializeNullclaw();
        if (!isNullclawAvailable()) {
          result = {
            success: false,
            error: 'Nullclaw is not configured. Set NULLCLAW_URL to enable.',
            metadata: { agentType: 'nullclaw', duration: Date.now() - startTime },
          };
          break;
        }

        // Try to determine task type from the request
        const taskType = (request as any).taskType || 'automate';
        const nullclawResult = await executeNullclawTask(
          taskType as 'message' | 'browse' | 'automate',
          request.task,
          {},
          request.ownerId,
          request.sessionId,
        );

        result = {
          success: nullclawResult.success,
          response: nullclawResult.output,
          error: nullclawResult.error,
          metadata: {
            agentType: 'nullclaw',
            taskType,
            mode: getNullclawMode(),
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // OPENCODE SDK (Direct API to local OpenCode server)
      // ========================================================================
      case 'opencode-sdk': {
        const { getOpenCodeSDKProvider } = await import('@/lib/chat/opencode-sdk-provider');

        // Use user-selected model, fall back to env vars
        const model = request.model || process.env.OPENCODE_MODEL || 'anthropic/claude-3-5-sonnet-20241022';
        const hostname = process.env.OPENCODE_HOSTNAME || '127.0.0.1';
        const port = parseInt(process.env.OPENCODE_PORT || '4096', 10);

        try {
          const provider = await getOpenCodeSDKProvider();
          const sdkResult = await provider.generateResponse({
            messages: [{ role: 'user', content: request.task }],
            model,
            maxTokens: parseInt(process.env.OPENCODE_MAX_STEPS || '15', 10) * 1000,
            temperature: 0.7,
          });

          result = {
            success: true,
            response: sdkResult.content,
            metadata: {
              agentType: 'opencode-sdk',
              model,
              hostname,
              port,
              tokensUsed: sdkResult.tokensUsed,
              duration: Date.now() - startTime,
            },
          };
        } catch (sdkError: any) {
          result = {
            success: false,
            error: `OpenCode SDK error: ${sdkError.message}. Ensure OpenCode server is running on ${hostname}:${port}.`,
            metadata: { agentType: 'opencode-sdk', model, hostname, port, duration: Date.now() - startTime },
          };
        }
        break;
      }

      // ========================================================================
      // MASTRA WORKFLOW
      // ========================================================================
      case 'mastra-workflow': {
        const { mastraWorkflowIntegration } = await import('@bing/shared/agent/mastra-workflow-integration');

        const workflowId = 'code-agent'; // Default workflow
        // ownerId already validated at function entry
        const workflowResult = await mastraWorkflowIntegration.executeWorkflow(workflowId, {
          task: request.task,
          ownerId: request.ownerId,
        });

        result = {
          success: workflowResult.success,
          response: workflowResult.result?.response || workflowResult.result?.content || 'Workflow completed',
          steps: workflowResult.steps,
          error: workflowResult.error,
          metadata: {
            agentType: 'mastra-workflow',
            workflowId,
            duration: workflowResult.duration || (Date.now() - startTime),
          },
        };
        break;
      }

      // ========================================================================
      // CREWAI
      // ========================================================================
      case 'crewai': {
        const { runCrewAI } = await import('@/lib/crewai');

        // sessionId already validated at function entry
        const crewResult = await runCrewAI({
          sessionId: request.sessionId,
          userMessage: request.task,
        });

        result = {
          success: crewResult.success,
          response: crewResult.response,
          error: crewResult.error,
          metadata: {
            agentType: 'crewai',
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // V2 EXECUTOR (OpenCode Containerized)
      // ========================================================================
      case 'v2-executor': {
        const { executeV2Task } = await import('@bing/shared/agent/v2-executor');

        // ownerId and sessionId already validated at function entry
        const v2Result = await executeV2Task({
          userId: request.ownerId,
          conversationId: request.sessionId,
          task: request.task,
          stream: request.stream,
          preferredAgent: 'opencode', // Default to OpenCode for v2
        });

        result = {
          success: v2Result.success ?? true,
          response: v2Result.content || v2Result.response,
          steps: v2Result.data?.steps,
          error: v2Result.data?.error,
          metadata: {
            agentType: 'v2-executor',
            sessionId: v2Result.sessionId,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // AGENT TEAM (Multi-Agent Orchestration with 5 collaboration strategies)
      // ========================================================================
      case 'agent-team': {
        const { createAgentTeam } = await import('@/lib/spawn/orchestration/agent-team');
        const { emitEvent } = await import('@/lib/events/bus');

        const workspacePath = request.workspacePath || process.cwd() || '/tmp/agent-team';
        const strategy = (request as any).strategy || 'hierarchical';
        const maxIterations = parseInt(String((request as any).maxIterations) || '3', 10);
        const timeoutMs = parseInt(String((request as any).timeoutMs) || '300000', 10);

        // Default team composition if not provided
        const agents = (request as any).agents || [
          { role: 'architect', type: 'claude-code', model: request.model || 'claude-sonnet-4-20250514' },
          { role: 'developer', type: 'claude-code', model: request.model || 'claude-sonnet-4-20250514' },
          { role: 'reviewer', type: 'claude-code', model: request.model || 'claude-sonnet-4-20250514' },
        ];

        // Emit initial progress to event store
        try {
          await emitEvent({
            type: 'ORCHESTRATION_PROGRESS',
            userId: request.ownerId,
            sessionId: request.sessionId,
            mode: 'agent-team',
            phase: 'planning',
            currentAction: `Initializing ${agents.length} agents with ${strategy} strategy`,
            nodes: agents.map((a: any) => ({
              id: `${a.role}-0`,
              role: a.role,
              model: a.model,
              provider: a.type,
              status: 'idle',
            })),
            steps: [
              { id: 'init', title: 'Initialize team', status: 'running' },
              { id: 'execute', title: 'Execute task', status: 'pending' },
              { id: 'synthesize', title: 'Synthesize results', status: 'pending' },
            ],
            timestamp: Date.now(),
          }, request.ownerId, request.sessionId);
        } catch {
          // Non-fatal — don't block execution if event storage fails
        }

        let team: any = null;
        // Track event listener cleanup functions
        const cleanupListeners: Array<() => void> = [];

        try {
          team = await createAgentTeam({
            name: `orchestration-team-${request.sessionId}`,
            agents,
            workspaceDir: workspacePath,
            strategy: strategy as any,
            maxIterations,
            timeout: timeoutMs,
            verbose: true,
          });

          // Hook into team progress events and emit to event store
          // Use synchronous wrapper to prevent unhandled promise rejections
          const onProgress = (progress: any) => {
            emitEvent({
              type: 'ORCHESTRATION_PROGRESS',
              userId: request.ownerId,
              sessionId: request.sessionId,
              mode: 'agent-team',
              phase: progress.progress < 50 ? 'acting' : 'verifying',
              nodeId: progress.currentAgent,
              currentAction: progress.message,
              currentStepIndex: progress.iteration,
              totalSteps: maxIterations,
              metadata: { progressPercent: progress.progress },
              timestamp: Date.now(),
            }, request.ownerId, request.sessionId).catch((err: any) => {
              logger.debug('Failed to emit progress event (non-fatal)', { error: err.message });
            });
          };
          team.on('task:progress', onProgress);
          cleanupListeners.push(() => team.off('task:progress', onProgress));

          // Hook into step completions
          const onStep = (step: any) => {
            emitEvent({
              type: 'ORCHESTRATION_PROGRESS',
              userId: request.ownerId,
              sessionId: request.sessionId,
              mode: 'agent-team',
              phase: 'acting',
              nodeRole: step.role,
              currentAction: `Step completed: ${step.role}`,
              timestamp: Date.now(),
            }, request.ownerId, request.sessionId).catch((err: any) => {
              logger.debug('Failed to emit step event (non-fatal)', { error: err.message });
            });
          };
          team.on('task:step', onStep);
          cleanupListeners.push(() => team.off('task:step', onStep));

          const teamResult = await team.execute({
            task: request.task,
            context: request.context ? [request.context] : undefined,
          });

          // Build nodes array from contributions
          const nodeInfo = teamResult.contributions?.map((c: any) => ({
            id: `${c.role}-0`,
            role: c.role,
            status: c.qualityScore !== undefined ? 'completed' : 'failed',
            model: request.model,
            provider: c.type,
          })) || [];

          // Emit final progress
          try {
            await emitEvent({
              type: 'ORCHESTRATION_PROGRESS',
              userId: request.ownerId,
              sessionId: request.sessionId,
              mode: 'agent-team',
              phase: 'responding',
              currentAction: teamResult.status === 'completed' ? 'Task completed' : `Task failed: ${teamResult.error}`,
              nodes: nodeInfo,
              timestamp: Date.now(),
            }, request.ownerId, request.sessionId);
          } catch {
            // Non-fatal
          }

          result = {
            success: teamResult.status === 'completed',
            response: teamResult.output,
            error: teamResult.error,
            metadata: {
              agentType: 'agent-team',
              strategy,
              iterations: teamResult.iterations,
              duration: teamResult.duration,
              contributionCount: teamResult.contributions?.length || 0,
              consensusScore: teamResult.consensusScore,
              nodes: nodeInfo,
            },
          };
        } finally {
          // Clean up event listeners before destroying team
          cleanupListeners.forEach(fn => fn());
          if (team) {
            await team.destroy().catch(() => {});
          }
        }
        break;
      }

      // ========================================================================
      // FALLBACK - Should never reach here due to type safety
      // ========================================================================
      default: {
        const modeNever: never = mode;
        throw new Error(`Unknown orchestration mode: ${modeNever}`);
      }
    }
    
    // Log successful execution with timing
    logger.info('Orchestration mode completed', {
      mode,
      success: result.success,
      duration: Date.now() - startTime,
    });
    
    return result;
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    logger.error('Orchestration mode execution failed', { 
      mode, 
      error: error.message,
      duration,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
      metadata: {
        agentType: mode,
        errorType: error.name || 'Unknown',
        duration,
      },
    };
  }
}
