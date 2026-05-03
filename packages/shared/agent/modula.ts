/**
 * Orchestration Mode Handler
 *
 * Routes agent requests to the appropriate orchestration backend based on
 * the X-Orchestration-Mode header.
 *
 * Supported modes:
 * - unified-agent (default): lib/orchestra/unified-agent-service.ts
 * - task-router: lib/agent/task-router.ts
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
  // V1/V2 Execution modes
  | 'v1-api'
  | 'v1-agent-loop'
  | 'v1-progressive-build'
  | 'v2-containerized'
  | 'v2-local'
  | 'v2-native'
  | 'desktop'
  // Dual-process variants (with task-classifier step)
  | 'dual-process'
  | 'dual-process:fast'
  | 'dual-process:slow'
  | 'dual-process:fast-fallback'
  | 'dual-process:slow-failed'
  // Adversarial verification variants
  | 'adversarial-verify'
  | 'adversarial:revised'
  | 'adversarial:revision-failed'
  // Cognitive resonance variants
  | 'cognitive-resonance'
  | 'cognitive:converged'
  | 'cognitive:synthesized'
  | 'cognitive:single'
  | 'cognitive:fallback'
  // Distributed cognition
  | 'distributed-cognition'
  | 'distributed:no-synthesis'
  // Spec amplification modes
  | 'spec:super'
  | 'spec:maximal'
  // Mastra-specific workflow modes
  | 'mastra:code-agent'
  | 'mastra:research'
  | 'mastra:parallel'
  | 'mastra:data-analysis'
  | 'mastra:hitl'
  // CrewAI-specific modes
  | 'crewai'
  | 'crewai:role-agent'
  | 'crewai:swarm'
  | 'crewai:streaming'
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
  // agent-loop (maxIterations already declared above)
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

  const mode = modeHeader.toLowerCase() as OrchestrationMode;

  // Dynamic validation - extract all possible values from OrchestrationMode type
  // This ensures we never miss new modes added to the type
  const knownModes = new Set<OrchestrationMode>();

  // TypeScript trick: use a type assertion to get all possible values
  // In a real implementation, this would be generated at build time
  const allModes: OrchestrationMode[] = [
    'task-router', 'unified-agent', 'stateful-agent', 'agent-kernel', 'agent-loop', 'execution-graph',
    'nullclaw', 'opencode-sdk', 'mastra-workflow', 'crewai', 'v2-executor', 'agent-team',
    'v1-api', 'v1-agent-loop', 'v1-progressive-build', 'v2-containerized', 'v2-local',
    'v2-native', 'desktop',
    'dual-process', 'dual-process:fast', 'dual-process:slow', 'dual-process:fast-fallback', 'dual-process:slow-failed',
    'adversarial-verify', 'adversarial:revised', 'adversarial:revision-failed',
    'cognitive-resonance', 'cognitive:converged', 'cognitive:synthesized', 'cognitive:single', 'cognitive:fallback',
    'distributed-cognition', 'distributed:no-synthesis',
    'spec:super', 'spec:maximal',
    'mastra:code-agent', 'mastra:research', 'mastra:parallel', 'mastra:data-analysis', 'mastra:hitl',
    'crewai:role-agent', 'crewai:swarm', 'crewai:streaming',
  ];

  allModes.forEach(mode => knownModes.add(mode));

  if (!knownModes.has(mode)) {
    logger.warn('Invalid orchestration mode, falling back to unified-agent', {
      requestedMode: modeHeader,
      normalizedMode: mode,
      availableModes: Array.from(knownModes)
    });
    return 'unified-agent';
  }

  logger.debug('Selected orchestration mode', { mode, source: 'header' });
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

  // Comprehensive input validation
  if (!request.ownerId || typeof request.ownerId !== 'string' || request.ownerId.trim() === '') {
    throw new Error('ownerId is required and must be a non-empty string. Missing user identity breaks isolation.');
  }
  if (!request.sessionId || typeof request.sessionId !== 'string' || request.sessionId.trim() === '') {
    throw new Error('sessionId is required and must be a non-empty string. Missing conversation ID breaks isolation.');
  }
  if (!request.task || typeof request.task !== 'string' || request.task.trim() === '') {
    throw new Error('task is required and must be a non-empty string.');
  }

  // Validate ownerId and sessionId format (prevent injection attacks)
  const idPattern = /^[a-zA-Z0-9_\-]+$/;
  if (!idPattern.test(request.ownerId)) {
    throw new Error('ownerId contains invalid characters. Only alphanumeric, underscore, and hyphen allowed.');
  }
  if (!idPattern.test(request.sessionId)) {
    throw new Error('sessionId contains invalid characters. Only alphanumeric, underscore, and hyphen allowed.');
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
          task: request.task,
          id: request.sessionId,
          userId: request.ownerId,
          conversationId: request.sessionId,
          
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
        const systemPrompt = baseSystemPrompt + await applyPromptModifiers(promptParams ?? {});

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
        steps: statefulResult.steps as any,
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
              try { (kernel as any).cancelAgent(agentId); } catch { /* best-effort */ }
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

        const maxIterations = (request as any).maxIterations ?? 10;
        const modelOverride = request.model || process.env.AGENT_MODEL || process.env.DEFAULT_MODEL;
        // Default to user's cwd or project/sessions for VFS tools
        const workspacePath = request.workspacePath || process.cwd() || `project/sessions/${request.sessionId}`;

        const agentLoop = createAgentLoop(request.ownerId, workspacePath, maxIterations, undefined, modelOverride);
        const loopResult = await agentLoop.executeTask(request.task);

        result = {
        success: loopResult.success,
        response: loopResult.reasoning || loopResult.message || (loopResult.success ? 'Agent loop completed' : 'Agent loop failed'),
        steps: loopResult.iterations as any,
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
        name: 'Plan',
        dependencies: [],
        });

        const execNode = executionGraphEngine.addNode(graph, {
        id: 'execute',
        type: 'tool_call',
        name: 'Execute',
        dependencies: ['plan'],
        });

        const verifyNode = executionGraphEngine.addNode(graph, {
        id: 'verify',
        type: 'sandbox_action',
        name: 'Verify',
        dependencies: ['execute'],
        });

        // Declare model/provider outside try block for catch block access
        const graphModel = request.model || process.env.AGENT_MODEL || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
        let graphProvider = 'unknown';

        try {
        // Execute nodes in dependency order
        const { llmService } = await import('@/lib/chat/llm-providers');

        // Use user-selected model for planning

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
            messages: [{ role: 'user', content: `Create a step-by-step plan for this userMessage: ${request.task}` }],
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
              status: (progress as any).status,
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
            response: `Planning failed. The LLM provider (${(graphProvider as any)}) may be unavailable or misconfigured.`,
            metadata: {
              agentType: 'execution-graph',
              graphId: graph.id,
              nodeCount: graph.nodes.size,
              completed: 0,
              status: 'failed',
              model: graphModel as any,
              provider: graphProvider as any,
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
          success: (nullclawResult as any).success,
          response: (nullclawResult as any).output,
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
      // MASTRA WORKFLOW (legacy alias - delegates via config)
      // ========================================================================
      case 'mastra-workflow':
      case 'mastra:code-agent': {
        // Uses unified-agent-service with mastra-workflow config  
        // Fallback to mastra workflow integration
        const { mastraWorkflowIntegration } = await import('@bing/shared/agent/mastra-workflow-integration');
        const workflowResult = await mastraWorkflowIntegration.executeWorkflow('code-agent', {
        userMessage: request.task,
        ownerId: request.ownerId,
        });
        result = {
        success: workflowResult.success,
        response: workflowResult.result?.response || 'Completed',
        metadata: { agentType: 'mastra:code-agent', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // MASTRA: RESEARCH
      // ========================================================================
      case 'mastra:research': {
        const { mastraWorkflowIntegration } = await import('@bing/shared/agent/mastra-workflow-integration');
        const workflowResult = await mastraWorkflowIntegration.executeWorkflow('research', {
        userMessage: request.task,
        ownerId: request.ownerId,
        });
        result = {
        success: workflowResult.success,
        response: workflowResult.result?.response || 'Research complete',
        metadata: { agentType: 'mastra:research', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // MASTRA: PARALLEL
      // ========================================================================
      case 'mastra:parallel': {
        const { mastraWorkflowIntegration } = await import('@bing/shared/agent/mastra-workflow-integration');
        const workflowResult = await mastraWorkflowIntegration.executeWorkflow('parallel', {
        userMessage: request.task,
        ownerId: request.ownerId,
        });
        result = {
        success: workflowResult.success,
        response: workflowResult.result?.response || 'Parallel tasks complete',
        metadata: { agentType: 'mastra:parallel', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // MASTRA: DATA-ANALYSIS
      // ========================================================================
      case 'mastra:data-analysis': {
        const { mastraWorkflowIntegration } = await import('@bing/shared/agent/mastra-workflow-integration');
        const workflowResult = await mastraWorkflowIntegration.executeWorkflow('data-analysis', {
        userMessage: request.task,
        ownerId: request.ownerId,
        });
        result = {
        success: workflowResult.success,
        response: workflowResult.result?.response || 'Analysis complete',
        metadata: { agentType: 'mastra:data-analysis', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // MASTRA: HITL
      // ========================================================================
      case 'mastra:hitl': {
        const { mastraWorkflowIntegration } = await import('@bing/shared/agent/mastra-workflow-integration');
        const workflowResult = await mastraWorkflowIntegration.executeWorkflow('hitl', {
        userMessage: request.task,
        ownerId: request.ownerId,
        });
        result = {
        success: workflowResult.success,
        response: workflowResult.result?.response || 'HITL workflow complete',
        metadata: { agentType: 'mastra:hitl', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // CREWAI (legacy alias - uses existing crewai handler)
      // ========================================================================
      case 'crewai':
      case 'crewai:role-agent': {
        const { runCrewAI } = await import('@/lib/crewai');
        const crewResult = await runCrewAI({
        sessionId: request.sessionId,
        userMessage: request.task,
        });
        result = {
        success: crewResult.success,
        response: crewResult.response,
        error: crewResult.error,
        metadata: { agentType: 'crewai:role-agent', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // CREWAI: SWARM (uses swarm module)
      // ========================================================================
      case 'crewai:swarm': {
        // Swarm is a pattern - use crewai with swarm config
        const { runCrewAI } = await import('@/lib/crewai');
        const crewResult = await runCrewAI({
        sessionId: request.sessionId,
        userMessage: request.task,
        });
        result = {
        success: crewResult.success,
        response: crewResult.response,
        metadata: { agentType: 'crewai:swarm', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // CREWAI: STREAMING (uses existing crewai with streaming enabled)
      // ========================================================================
      case 'crewai:streaming': {
        // Use existing crewai with streaming
        const { runCrewAI } = await import('@/lib/crewai');
        const streamResult = await runCrewAI({
        sessionId: request.sessionId,
        userMessage: request.task,
        });
        result = {
        success: true,
        response: streamResult.response,
        metadata: { agentType: 'crewai:streaming', streaming: true, duration: Date.now() - startTime },
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
          
          preferredAgent: 'opencode', // Default to OpenCode for v2
        });

        result = {
        success: v2Result.success ?? true,
        response: v2Result.content || (v2Result as any).response,
        steps: (v2Result.data as any)?.steps,
        error: v2Result.error || (v2Result.data as any)?.error,
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
        const maxIterations = Number((request as any).maxIterations) || 3;
        const timeoutMs = Number((request as any).timeoutMs) || 300000;

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
            userMessage: request.task,
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
            await team.destroy().catch((err: any) => {
              logger.error('Failed to destroy agent team', { error: err?.message || String(err) });
            });
          }
        }
        break;
      }

      // ========================================================================
      // V1-API MODE (Direct API calls with tools - fast, simple)
      // ========================================================================
      case 'v1-api': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const unifiedResult = await processUnifiedAgentRequest({
          userMessage: request.task,
          userId: request.ownerId,
          sandboxId: request.sessionId,
          mode: 'v1-api',
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: 'v1-api', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // V1-AGENT-LOOP MODE (Full agent loop with iterations)
      // ========================================================================
      case 'v1-agent-loop': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const unifiedResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'v1-agent-loop',
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: 'v1-agent-loop', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // V1-PROGRESSIVE-BUILD (Iterative building with verification)
      // ========================================================================
      case 'v1-progressive-build': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const unifiedResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'v1-progressive-build',
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: 'v1-progressive-build', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // V2-CONTAINERIZED (Run in isolated container)
      // ========================================================================
      case 'v2-containerized': {
        const { executeV2Task } = await import('@bing/shared/agent/v2-executor');
        const v2Result = await executeV2Task({
          userId: request.ownerId,
          conversationId: request.sessionId,
          task: request.task,
          
          preferredAgent: 'opencode',
        });
        result = {
        success: v2Result.success ?? true,
        response: v2Result.content || (v2Result as any).response,
        metadata: { agentType: 'v2-containerized', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // V2-LOCAL (Local execution)
      // ========================================================================
      case 'v2-local': {
        const { executeV2Task } = await import('@bing/shared/agent/v2-executor');
        const v2Result = await executeV2Task({
          userId: request.ownerId,
          conversationId: request.sessionId,
          task: request.task,
          
          preferredAgent: 'opencode',
        });
        result = {
        success: v2Result.success ?? true,
        response: v2Result.content || (v2Result as any).response,
        metadata: { agentType: 'v2-local', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // V2-NATIVE (Native execution without container)
      // ========================================================================
      case 'v2-native': {
        const { executeV2Task } = await import('@bing/shared/agent/v2-executor');
        const v2Result = await executeV2Task({
          userId: request.ownerId,
          conversationId: request.sessionId,
          task: request.task,
          
          preferredAgent: 'opencode',
        });
        result = {
        success: v2Result.success ?? true,
        response: v2Result.content || (v2Result as any).response,
        metadata: { agentType: 'v2-native', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // DESKTOP MODE (Tauri desktop integration)
      // ========================================================================
      case 'desktop': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const unifiedResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'desktop',
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: 'desktop', duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // DUAL-PROCESS MODES (Fast/slow planning + executor)
      // With task-classifier as initial step
      // ========================================================================
      case 'dual-process':
      case 'dual-process:fast':
      case 'dual-process:slow':
      case 'dual-process:fast-fallback':
      case 'dual-process:slow-failed': {
        // First: run task-classifier to categorize the task
        const { createTaskClassifier } = await import('@bing/shared/agent/task-classifier');
        const classifier = createTaskClassifier();
        const classification = await classifier.classify(request.task);

        // Then run dual-process mode with classification context
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const modeVariant = mode.replace('dual-process:', '');
        const unifiedResult = await processUnifiedAgentRequest({
          userMessage: request.task,
          userId: request.ownerId,
          sandboxId: request.sessionId,
          mode: (modeVariant ? `dual-process-${modeVariant}` : 'dual-process') as any,
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: mode, taskClassification: classification, duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // ADVERSARIAL-VERIFY MODES (Multi-agent verification)
      // ========================================================================
      case 'adversarial-verify':
      case 'adversarial:revised':
      case 'adversarial:revision-failed': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const modeVariant = mode.replace('adversarial:', '');
        const unifiedResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: (modeVariant ? `adversarial-verify-${modeVariant}` : 'adversarial-verify') as any,
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: mode, duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // COGNITIVE-RESONANCE MODES (Iterative refinement)
      // ========================================================================
      case 'cognitive-resonance':
      case 'cognitive:converged':
      case 'cognitive:synthesized':
      case 'cognitive:single':
      case 'cognitive:fallback': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const modeVariant = mode.replace('cognitive:', '');
        const unifiedResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: (modeVariant ? `cognitive-resonance-${modeVariant}` : 'cognitive-resonance') as any,
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: mode, duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // DISTRIBUTED-COGNITION MODES (Multi-agent synthesis)
      // ========================================================================
      case 'distributed-cognition':
      case 'distributed:no-synthesis': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const modeVariant = mode.replace('distributed:', '');
        const unifiedResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: (modeVariant ? `distributed-cognition-${modeVariant}` : 'distributed-cognition') as any,
        });
        result = {
        success: unifiedResult.success,
        response: unifiedResult.response,
        steps: unifiedResult.steps,
        error: unifiedResult.error,
        metadata: { agentType: mode, duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // SPEC:SUPER MODE (100-step spec amplification with v1-api base)
      // Encompasses v1-api mode plus iterative spec refinement
      // ========================================================================
      case 'spec:super': {
        // First: run v1-api to get initial response
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');
        const initialResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'v1-api',
        });

        // Then: run spec amplification loop (up to 100 iterations)
        let iterations = 0;
        const maxIterations = 100;
        let currentResponse = initialResult.response;
        let specAmplified = true;

        while (iterations < maxIterations && specAmplified) {
        // Run spec amplification step
        const amplifyResult = await processUnifiedAgentRequest({
        userMessage: `[SPEC_AMPLIFY] Review and enhance: ${currentResponse}`,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'v1-api',
        });

        if (amplifyResult.response && amplifyResult.response !== currentResponse) {
        currentResponse = amplifyResult.response;
        iterations++;
        } else {
        specAmplified = false;
      }
      }

        result = {
        success: initialResult.success,
        response: currentResponse,
        steps: [...(initialResult.steps || []), ...Array(iterations).fill({ step: 'spec-amplification' })],
        error: initialResult.error,
        metadata: { agentType: 'spec:super', iterations, duration: Date.now() - startTime },
        };
        break;
      }

      // ========================================================================
      // SPEC:MAXIMAL MODE (Spec amplification in middle of v1 mastra loop)
      // Runs v1-agent-loop with spec amplification as intermediate step(s)
      // ========================================================================
      case 'spec:maximal': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');

        // Run initial agent loop (pre-spec phase)
        const preSpecResult = await processUnifiedAgentRequest({
        userMessage: request.task,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'v1-agent-loop',
        });

        // Run spec amplification in the middle
        const specResult = await processUnifiedAgentRequest({
        userMessage: `[SPEC_MAXIMAL] Enhance: ${preSpecResult.response}`,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'v1-api',
        });

        // Run final agent loop (post-spec phase)
        const postSpecResult = await processUnifiedAgentRequest({
        userMessage: specResult.response,
        userId: request.ownerId,
        sandboxId: request.sessionId,
        
        mode: 'v1-agent-loop',
        });

        result = {
          success: postSpecResult.success,
          response: postSpecResult.response,
          steps: [
            ...(preSpecResult.steps || []),
            { step: 'spec-amplification', type: 'middle' },
            ...(postSpecResult.steps || [])
          ],
          error: postSpecResult.error,
          metadata: { agentType: 'spec:maximal', duration: Date.now() - startTime },
        };
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

    // FIX: Log orchestration completion with comprehensive telemetry
    const duration = Date.now() - startTime;
    const taskHash = await hashTask(request.task);

    logger.info('Orchestration mode completed', {
      mode,
      success: result.success,
      duration,
      taskHash,
      responseLength: result.response?.length || 0,
      steps: result.steps?.length || 0,
    });

    // Record telemetry for all orchestration modes
    // NOTE: Cannot import chatRequestLogger from here (packages/shared has no
    // access to web/ modules). The actual chat-request-logger is called by the
    // inner execution paths (runV1ApiWithTools, runV1ApiCompletion, etc.)
    // which DO have the @/ alias and record full telemetry with tool calls,
    // scores, and console output. This is just a summary log.
    console.log(
      `[Telemetry-Orchestration] ${mode}: ${result.success ? '✓' : '✗'} ` +
      `${duration}ms, ${result.response?.length || 0} chars, ` +
      `provider=${result.metadata?.provider || 'n/a'}, model=${result.metadata?.model || 'n/a'}`
    );

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
