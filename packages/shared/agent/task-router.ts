/**
 * Task Router - Determines which agent should handle a task
 * Uses the declarative intent schema (intent-schema.ts) instead of
 * hardcoded keyword arrays.
 */

import { createLogger } from '@/lib/utils/logger';
import type { IntentMatch } from './intent-schema';
import type { AgentPriority, AgentType } from './agent-kernel';
import { getAgentKernel } from './agent-kernel';
import { determineExecutionPolicy } from '@/lib/sandbox/types';
import { normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { emitEvent } from '@/lib/events/bus';
import { AnyEvent as EventTypes } from '@/lib/events/schema';

/** Task type - what kind of task this is */
export type TaskType = 'coding' | 'automation' | 'messaging' | 'advanced' | 'unknown';

/** Advanced task type - specific types of complex tasks */
export type AdvancedTaskType =
  | 'agent-loop'
  | 'research'
  | 'dag-workflow'
  | 'skill-build'
  | 'consensus'
  | 'reflection'
  | 'tool-discover'
  | 'cross-agent';

/** Routing target type - which system handles the task */
export type RoutingTarget = 'opencode' | 'nullclaw' | 'chat' | 'advanced' | 'cli';

/** Task request interface */
export interface TaskRequest {
  task: string;
  userId: string;
  conversationId: string;
  executionPolicy?: string;
  [key: string]: any;
}

/** Task routing result */
export interface TaskRoutingResult {
  type: TaskType;
  target: RoutingTarget;
  confidence: number;
  reasoning: string;
  intentMatch?: IntentMatch;
}

// Stub for scheduleTask - import from task-scheduler when available
async function scheduleTask(_request: TaskRequest): Promise<any> {
  throw new Error('scheduleTask not implemented');
}

// Create a logger instance for task-router
const logger = createLogger('TaskRouter');

/**
 * Map an intent match to a task type and routing target.
 * This replaces the old switch statement with a data-driven approach.
 */
function intentToTaskRoute(match: IntentMatch): { taskType: TaskType; target: RoutingTarget; reasoning: string } {
  const intent = match.intent;

  switch (intent.routingTarget) {
    case 'opencode':
      return {
        taskType: intent.id === 'sandbox' ? 'automation' : 'coding',
        target: 'opencode',
        reasoning: `Task involves ${intent.id} — coding, file operations, or shell commands`,
      };
    case 'nullclaw':
      return {
        taskType: 'messaging',
        target: 'nullclaw',
        reasoning: `Task involves third-party service actions (${intent.id})`,
      };
    case 'advanced':
      return {
        taskType: 'advanced',
        target: 'advanced',
        reasoning: `Task requires persistent/background agent processing`,
      };
    default:
      return {
        taskType: 'unknown',
        target: 'cli',
        reasoning: 'Unclear intent, using CLI agent as fallback',
      };
  }
}

/**
 * Task Router - Determines which agent should handle a task
 */
class TaskRouter {
  /**
   * Analyze task using the declarative intent schema (two-stage classifier).
   * Stage 1: Fast regex + keyword scoring.
   * Stage 2: LLM-based disambiguation when confidence is low.
   */
  async analyzeTask(task: string): Promise<TaskRoutingResult> {
    // Try fast path first (stage 1 only — no LLM cost)
    const { classifyIntent, getAllStage1Scores } = await import('./intent-schema');
    // stage-1-only returns sync, stage-2 returns Promise
    const stage1Result = await classifyIntent(task, { minConfidence: 0.5, enableStage2: false });

    let intentMatch: IntentMatch;

    if (stage1Result.confidence >= 0.5) {
      intentMatch = stage1Result;
    } else {
      // Stage 1 was ambiguous — use LLM-based stage 2
      intentMatch = await classifyIntent(task, { minConfidence: 0.3, enableStage2: true });
    }

    // Map intent to task type and routing target
    const { taskType, target, reasoning } = intentToTaskRoute(intentMatch);

    // Calculate confidence from intent match
    const confidence = intentMatch.confidence;

    const result: TaskRoutingResult = { type: taskType, confidence, target, reasoning };

    logger.debug(
      `Task routed: ${task.substring(0, 50)}... → ${target} (${taskType}, confidence: ${confidence.toFixed(2)}, stage: ${intentMatch.stage})`,
    );

    return result;
  }

  /**
   * Analyze if task requires advanced agent spawning (mid-to-long term goals)
   * Uses the intent schema's 'advanced' intent patterns.
   */
  async analyzeAdvancedTask(task: string): Promise<AdvancedTaskType | null> {
    const { classifyIntent, INTENT_SCHEMA } = await import('./intent-schema');

    // Check if this matches the 'advanced' intent
    const advancedIntent = INTENT_SCHEMA.find(i => i.id === 'advanced');
    if (!advancedIntent) return null;

    const lowerTask = task.toLowerCase();
    let score = 0;

    // Score against advanced patterns
    for (const { regex, weight } of advancedIntent.patterns) {
      if (regex.test(lowerTask)) score += weight;
    }
    for (const { word, weight } of advancedIntent.keywords) {
      if (lowerTask.includes(word)) score += weight;
    }

    const threshold = 3; // Require meaningful match
    if (score < threshold) return null;

    // Determine specific advanced task type from keyword sub-groups
    const advancedType = this.detectSpecificAdvancedType(lowerTask);
    if (advancedType) {
      logger.info(`[TaskRouter] Advanced task detected: ${advancedType} (score: ${score})`);
    }

    return advancedType;
  }

  /**
   * Detect specific advanced task type from keyword sub-groups.
   * Replaces the hardcoded switch statement with a data-driven approach.
   */
  private detectSpecificAdvancedType(lowerTask: string): AdvancedTaskType | null {
    // Data-driven mapping: each advanced type has its own keyword set
    const advancedKeywords: Record<AdvancedTaskType, string[]> = {
      'agent-loop': [
        'background', 'continuous', 'loop', 'persist', 'ongoing', 'monitor',
        'watch', 'poll', 'cron', 'schedule', 'periodically', 'recurring',
        'long-running', 'daemon', 'service', 'keep running', 'always on',
      ],
      'research': [
        'research', 'deep dive', 'investigate', 'analyze', 'study',
        'comprehensive', 'in-depth', 'thorough', 'explore', 'survey',
        'summarize', 'report', 'find information', 'gather data',
      ],
      'dag-workflow': [
        'workflow', 'pipeline', 'chain', 'sequence', 'steps', 'stages',
        'dependencies', 'multi-step', 'multi-stage', 'execute in order',
        'run after', 'depends on', 'dag', 'graph', 'execution plan',
      ],
      'skill-build': [
        'learn', 'extract', 'pattern', 'template', 'reusable', 'skill',
        'abstraction', 'generalize', 'create function', 'make reusable',
        'build skill', 'bootstrap', 'self-extend', 'improve',
      ],
      'consensus': [
        'debate', 'discuss', 'multiple', 'agents', 'agree', 'consensus',
        'vote', 'compare', 'evaluate', 'different approaches', 'specialist',
        'role', 'team', 'collaborate', 'negotiate', 'argue',
      ],
      'reflection': [
        'reflect', 'improve', 'what went wrong', 'analyze result', 'self-correct',
        'learn from', 'fix', 'debug', 'fix errors', 'retry', 'improve result',
      ],
      'tool-discover': [
        'find tools', 'discover', 'available tools', 'what tools', 'capabilities',
        'rank', 'best tool', 'compare tools', 'which tool', 'tool for',
      ],
      'cross-agent': [
        'tell agent', 'send to', 'delegate', 'ask other', 'another agent',
        'agent communication', 'message agent', 'notify agent', 'inform',
      ],
    };

    let bestType: AdvancedTaskType | null = null;
    let bestScore = 0;

    for (const [type, keywords] of Object.entries(advancedKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (lowerTask.includes(keyword)) score += 1;
      }
      if (score > bestScore && score >= 2) {
        bestScore = score;
        bestType = type as AdvancedTaskType;
      }
    }

    return bestType;
  }

  /**
   * Check if task is a simple query that shouldn't spawn advanced agents
   */
  isSimpleQuery(task: string): boolean {
    const simpleIndicators = [
      'what is', 'how do i', 'can you', 'help me', 'explain',
      'show me', 'find', 'list', 'get', 'just',
    ];
    const lowerTask = task.toLowerCase();

    // Has simple indicator but no action keywords
    const hasSimpleIndicator = simpleIndicators.some(i => lowerTask.includes(i));
    const actionKeywords = [
      'build', 'create', 'implement', 'write', 'make', 'develop',
      'fix', 'refactor', 'deploy', 'run', 'execute', 'automate',
    ];
    const hasActionKeywords = actionKeywords.some(k => lowerTask.includes(k));

    return hasSimpleIndicator && !hasActionKeywords;
  }

  /**
   * Execute advanced task via Agent Kernel (OS-like scheduler)
   * Routes through kernel for proper lifecycle management
   */
  private async executeAdvancedTask(
    request: TaskRequest,
    advancedType: AdvancedTaskType
  ): Promise<any> {
    logger.info(`[TaskRouter] Executing advanced task via Kernel: ${advancedType}`);

    const userId = request.userId;
    const task = request.task;
    const kernel = getAgentKernel();

    // Ensure kernel is started (lazy start)
    if (!(kernel as any).running) {
      kernel.start();
      logger.info('[TaskRouter] Agent Kernel started');
    }

    try {
      // Map advanced task type to kernel agent type and config
      const agentConfig = this.mapAdvancedToKernelConfig(advancedType, userId, task);

      // Spawn agent through kernel
      const agentId = await kernel.spawnAgent(agentConfig);

      logger.info(`[TaskRouter] Agent spawned via kernel`, { agentId, type: advancedType });

      // For non-persistent types, also submit initial work
      if (agentConfig.type !== 'daemon') {
        await kernel.submitWork(agentId, { task, requestId: request.id });
      }

      // FIX (Bug 4): Enforce timeout properly with signal cleanup
      const timeoutMs = Math.min(
        120_000,
        Number((request.executionPolicy as any)?.timeoutMs) || 60_000,
      );
      const pollInterval = 1_000;
      const maxAttempts = Math.ceil(timeoutMs / pollInterval);
      let attempts = 0;
      let timedOut = false;

      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          attempts++;
          try {
            const agentStatus = kernel.getAgentStatus(agentId);
            if (agentStatus?.status === 'completed' || agentStatus?.status === 'failed') {
              clearInterval(interval);
              resolve();
              return;
            }
          } catch {
            // Agent may have been removed — treat as completed
            clearInterval(interval);
            resolve();
            return;
          }

          if (attempts >= maxAttempts) {
            timedOut = true;
            clearInterval(interval);
            // Attempt to cancel the agent
            try { (kernel as any).cancelAgent(agentId); } catch { /* ignore */ }
            resolve(); // Don't reject — return timeout status instead
          }
        }, pollInterval);
      });

      const agentStatus = kernel.getAgentStatus(agentId);

      return {
        success: !timedOut && agentStatus?.status === 'completed',
        agentId,
        type: advancedType,
        kernelManaged: true,
        timedOut,
        agentStatus: agentStatus?.status,
        message: timedOut
          ? `Agent ${agentId} timed out after ${timeoutMs}ms`
          : `Agent ${agentId} ${agentStatus?.status || 'completed'}`,
      };
    } catch (error: unknown) {
      // Fallback to event system if kernel fails
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[TaskRouter] Kernel execution failed, falling back to event system: ${message}`);
      return this.executeAdvancedTaskFallback(request, advancedType);
    }
  }

  /**
   * Map advanced task type to kernel agent configuration
   */
  private mapAdvancedToKernelConfig(
    advancedType: AdvancedTaskType,
    userId: string,
    task: string
  ): {
    type: AgentType;
    name: string;
    goal: string;
    priority: AgentPriority;
    schedule?: string;
    maxIterations?: number;
    context?: Record<string, any>;
    userId: string;
  } {
    // Extract goal from task
    const goalMatch = task.match(/(?:goal|objective|purpose|research|investigate)[:\s]*(.+)/i);
    const goal = goalMatch?.[1] || task;

    switch (advancedType) {
      case 'agent-loop':
    return {
      type: 'persistent',
      name: 'Agent Loop',
      goal,
      priority: 'normal',
      schedule: '*/2 * * * *',
      maxIterations: 100,
      context: { loop: true },
      userId,
    };

      case 'research':
    return {
      type: 'ephemeral',
      name: 'Research Agent',
      goal: `Research: ${goal}`,
      priority: 'high',
      maxIterations: 10,
      context: { depth: 5, sources: ['web', 'news', 'code'] },
      userId,
    };

      case 'dag-workflow':
    return {
      type: 'worker',
      name: 'DAG Worker',
      goal,
      priority: 'normal',
      maxIterations: 20,
      context: { dag: true },
      userId,
    };

      case 'skill-build':
    return {
      type: 'persistent',
      name: 'Skill Builder',
      goal: `Extract skills from: ${goal}`,
      priority: 'low',
      maxIterations: 5,
      context: { skillExtraction: true },
      userId,
    };

      case 'consensus':
    return {
      type: 'ephemeral',
      name: 'Consensus Agent',
      goal: `Debate and find consensus: ${goal}`,
      priority: 'normal',
      maxIterations: 3,
      context: { roles: ['planner', 'executor', 'critic'] },
      userId,
    };

      case 'reflection':
        return {
          type: 'ephemeral',
          name: 'Reflection Agent',
          goal: `Reflect on and improve: ${goal}`,
          priority: 'low',
          maxIterations: 2,
          context: { reflection: true },
          userId,
        };

      case 'tool-discover':
        return {
          type: 'persistent',
          name: 'Tool Discovery',
          goal: 'Discover and rank available tools',
          priority: 'low',
          schedule: '*/15 * * * *', // Every 15 min
          maxIterations: 10,
          context: { toolDiscovery: true },
          userId,
        };

      case 'cross-agent':
        return {
          type: 'worker',
          name: 'Message Router',
          goal,
          priority: 'high',
          maxIterations: 1,
          context: { messaging: true },
          userId,
        };

      default:
        return {
          type: 'ephemeral',
          name: 'Default Agent',
          goal,
          priority: 'normal',
          userId,
        };
    }
  }

  /**
   * Fallback to event system when kernel is unavailable
   */
  private async executeAdvancedTaskFallback(
    request: TaskRequest,
    advancedType: AdvancedTaskType
  ): Promise<any> {
    logger.info(`[TaskRouter] Using fallback event system for: ${advancedType}`);

    const userId = request.userId;
    const task = request.task;
    const sessionId = request.conversationId;

    try {
      // Map advanced type to task type and context with full coverage
      const fallbackConfig = this.getFallbackConfig(advancedType, task);

      // Emit event for durable execution tracking
      const eventResult = await emitEvent(
        {
          type: EventTypes.WORKFLOW,
          templateId: advancedType,
          sessionId,
          userId,
          phase: 'started',
          metadata: {
            taskType: fallbackConfig.taskType,
            goal: fallbackConfig.payload.prompt,
            priority: fallbackConfig.metadata.priority,
          },
        },
        userId,
        sessionId
      );

      logger.info(`[TaskRouter] Event emitted for advanced task`, {
        eventId: eventResult.eventId,
        advancedType,
      });

      // FIX (Bug 11): Catch the scheduleTask promise to prevent unhandled rejections
      try {
        const scheduledTask = await scheduleTask({
          task: fallbackConfig.payload.prompt || task,
          userId,
          conversationId: sessionId || 'default',
          taskType: fallbackConfig.taskType,
          schedule: fallbackConfig.schedule,
          payload: { ...fallbackConfig.payload, prompt: fallbackConfig.payload.prompt || task },
          metadata: {
            ...fallbackConfig.metadata,
            eventId: eventResult.eventId,
          },
        });

        return scheduledTask;
      } catch (scheduleError: unknown) {
        const scheduleMessage = scheduleError instanceof Error ? scheduleError.message : String(scheduleError);
        logger.error(`[TaskRouter] scheduleTask failed: ${scheduleMessage}`);
        // Return partial success — event was emitted even if scheduling failed
        return {
          success: false,
          error: `Event emitted but scheduling failed: ${scheduleMessage}`,
          eventId: eventResult.eventId,
          type: advancedType,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[TaskRouter] Fallback execution failed: ${message}`);

      // Emit failure event
      try {
        await emitEvent(
          {
            type: EventTypes.WORKFLOW,
            templateId: advancedType,
            sessionId: request.conversationId,
            userId: request.userId,
            phase: 'failed',
            error: message,
          },
          request.userId,
          request.conversationId
        );
      } catch {
        // Non-fatal — don't mask the original error
      }

      return { success: false, error: message, type: advancedType };
    }
  }

  /**
   * Get fallback config for all advanced task types
   */
  private getFallbackConfig(
    advancedType: AdvancedTaskType,
    task: string
  ): {
    taskType: string;
    schedule: { type: string; expression?: string; delayMs?: number };
    payload: Record<string, any>;
    metadata: Record<string, any>;
  } {
    const goalMatch = task.match(/(?:goal|objective|purpose|research|investigate)[:\s]*(.+)/i);
    const goal = goalMatch?.[1] || task;
    const intervalMatch = task.match(/(?:every|interval)[:\s]*(\S+)/i);
    const depthMatch = task.match(/(?:depth|level)[:\s]*(\d+)/i);
    
    switch (advancedType) {
      case 'agent-loop':
        return {
          taskType: 'NULLCLAW_AGENT',
          schedule: { type: 'cron', expression: intervalMatch?.[1] || '*/2 * * * *' },
          payload: { prompt: goal, model: 'claude-3-opus', context: { loop: true } },
          metadata: { name: 'Agent Loop', priority: 'normal', maxRetries: 3 },
        };

      case 'research':
        return {
          taskType: 'RESEARCH_TASK',
          schedule: { type: 'immediate' },
          payload: { query: goal, depth: parseInt(depthMatch?.[1] || '5', 10), sources: ['web', 'news', 'code'] },
          metadata: { name: 'Research Task', priority: 'high', timeout: 300000 },
        };

      case 'dag-workflow':
        return {
          taskType: 'CUSTOM_DAG',
          schedule: { type: 'immediate' },
          payload: { url: 'internal://dag', dag: { task } },
          metadata: { name: 'DAG Workflow', priority: 'normal', maxRetries: 3 },
        };

      case 'skill-build':
        return {
          taskType: 'RESEARCH_TASK',
          schedule: { type: 'delay', delayMs: 60000 },
          payload: { query: `Extract reusable skill from: ${goal}`, depth: 3 },
          metadata: { name: 'Skill Builder', priority: 'low' },
        };

      case 'consensus':
        return {
          taskType: 'NULLCLAW_AGENT',
          schedule: { type: 'immediate' },
          payload: { prompt: `Debate and find consensus: ${goal}`, model: 'claude-3-opus', context: { roles: ['planner', 'executor', 'critic'] } },
          metadata: { name: 'Consensus Task', priority: 'normal' },
        };

      case 'reflection':
        return {
          taskType: 'RESEARCH_TASK',
          schedule: { type: 'delay', delayMs: 5000 },
          payload: { query: `Analyze and improve: ${goal}. What went wrong? What can be fixed?`, depth: 2 },
          metadata: { name: 'Reflection Task', priority: 'low' },
        };

      case 'tool-discover':
        return {
          taskType: 'HACKER_NEWS_DAILY',
          schedule: { type: 'immediate' },
          payload: { destination: null },
          metadata: { name: 'Tool Discovery', priority: 'low' },
        };

      case 'cross-agent':
        return {
          taskType: 'WEBHOOK',
          schedule: { type: 'immediate' },
          payload: { url: `internal://agent/default`, method: 'POST', body: { from: 'task-router', message: goal } },
          metadata: { name: 'Cross-Agent Message', priority: 'high' },
        };

      default:
        return {
          taskType: 'NULLCLAW_AGENT',
          schedule: { type: 'immediate' },
          payload: { prompt: task },
          metadata: { name: 'Fallback Task', priority: 'normal' },
        };
    }
  }

  async executeTask(request: TaskRequest): Promise<any> {
    // FIX (Bug 5 & 7): Handle preferred agent explicitly before routing.
    if (request.preferredAgent) {
      logger.info(`Routing task to preferred agent: ${request.preferredAgent}`);
      return this.dispatchToTarget(request.preferredAgent, request);
    }

    // First, do basic routing to determine task type
    const routing = await this.analyzeTask(request.task);

    // END OF ROUTING TREE: Check for advanced tasks (mid-to-long term goals)
    // Only route to advanced tasks if:
    // 1. Task has explicit advanced task keywords
    // 2. Task is NOT a simple query
    const advancedType = this.analyzeAdvancedTask(request.task);
    const isSimple = this.isSimpleQuery(request.task);
    
    if (advancedType && !isSimple) {
      logger.info(`[TaskRouter] Routing to advanced task: ${advancedType} (confidence: ${routing.confidence})`);
      // Cache the advanced type on the request for dispatchToTarget
      (request as any).advancedType = advancedType;
      return this.dispatchToTarget('advanced', request);
    }

    logger.info(`Routing task to ${routing.target} (${routing.type})`);
    return this.dispatchToTarget(routing.target, request);
  }

  /** Single dispatch point — no ambiguous else-chains. */
  private async dispatchToTarget(target: RoutingTarget, request: TaskRequest): Promise<any> {
    switch (target) {
      case 'opencode': return this.executeWithOpenCode(request);
      case 'nullclaw': return this.executeWithNullclaw(request, (await this.analyzeTask(request.task)).type);
      case 'cli':      return this.executeWithCliAgent(request);
      case 'advanced': {
        // END OF ROUTING TREE: Execute advanced task via event system
        // Use cached advanced type from executeTask to avoid re-analysis
        const advancedType = (request as any).advancedType || this.analyzeAdvancedTask(request.task);
        if (!advancedType) {
          // Fallback to nullclaw if no advanced type detected
          return this.executeWithNullclaw(request, 'automation');
        }
        return this.executeAdvancedTask(request, advancedType);
      }
      default: {
        // TypeScript exhaustiveness — should never reach here at runtime
        const _exhaustive: never = target;
        throw new Error(`Unknown routing target: ${String(_exhaustive)}`);
      }
    }
  }

  private async executeWithOpenCode(request: TaskRequest): Promise<any> {
    const executionPolicy = request.executionPolicy || determineExecutionPolicy({
      task: request.task,
      requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(request.task),
      requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(request.task),
      requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(request.task),
    });

    const useV2 =
      process.env.OPENCODE_CONTAINERIZED === 'true' ||
      process.env.V2_AGENT_ENABLED === 'true';

    if (!useV2) {
      const { createOpenCodeEngine } = await import('@/lib/session/agent/opencode-engine-service');
      const engine = createOpenCodeEngine({
        model: process.env.OPENCODE_MODEL,
        // CRITICAL FIX: Normalize conversationId to prevent composite IDs in paths
        workingDir: `/workspace/users/${request.userId}/sessions/${normalizeSessionId(request.conversationId) || request.conversationId}`,
        enableBash: true,
        enableFileOps: true,
        enableCodegen: true,
      });

      if (request.stream) {
        return { type: 'stream', stream: engine.executeStream(request.task) };
      }

      const result = await engine.execute(request.task);
      return {
        success: result.success,
        response: result.response,
        bashCommands: result.bashCommands,
        fileChanges: result.fileChanges || [],
        agent: 'opencode',
        reasoning: result.reasoning,
      };
    }

    const { OpencodeV2Provider } = await import('@/lib/sandbox/spawn/opencode-cli');
    const { agentSessionManager } = await import('@/lib/session/agent/agent-session-manager');
    const { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } = await import('@/lib/mcp');

    const session = await agentSessionManager.getOrCreateSession(
      request.userId,
      request.conversationId,
      { enableMCP: true, enableNullclaw: true, mode: 'hybrid', executionPolicy },
    );

    const provider = new OpencodeV2Provider({
      session: {
        userId: request.userId,
        conversationId: request.conversationId,
        enableMcp: true,
        enableNullclaw: true,
        workspaceDir: session.workspacePath,
      },
      sandboxHandle: session.sandboxHandle,
    });

    const tools = await getMCPToolsForAI_SDK(request.userId);

    const result = await provider.runAgentLoop({
      userMessage: request.task,
      tools: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
      systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
      maxSteps: parseInt(process.env.OPENCODE_MAX_STEPS || '15', 10),
      onStreamChunk: request.onStreamChunk,
      onToolExecution: request.onToolExecution,
      executeTool: async (name, args) => {
        const toolResult = await callMCPToolFromAI_SDK(name, args, request.userId);
        return { success: toolResult.success, output: toolResult.output, exitCode: toolResult.success ? 0 : 1 };
      },
    });

    const fileChanges: Array<{ path: string; action: string; operation: 'write' | 'patch' | 'delete'; content?: string }> = [];
    if (result.steps) {
      for (const step of result.steps) {
        if (step.toolName && ['write_file', 'read_file', 'delete_file', 'edit_file', 'Bash'].includes(step.toolName)) {
          const args = step.args || {};
          if (step.toolName === 'Bash' && args.command) {
            const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
            if (match) {
              fileChanges.push({ path: match[1], action: 'modify', operation: 'patch' });
            }
            continue;
          }
          const filePath = args.path || args.file || args.target || '';
          if (!filePath) continue;
          fileChanges.push({
            path: filePath,
            action: step.toolName === 'delete_file' ? 'delete' : 'modify',
            operation: step.toolName === 'delete_file' ? 'delete' : step.toolName === 'edit_file' ? 'patch' : 'write',
          });
        }
      }
    }

    return {
      success: true,
      response: result.response,
      steps: result.steps,
      totalSteps: result.totalSteps,
      agent: 'opencode',
      sessionId: result.sessionId,
      nullclawTasks: (result as any).nullclawTasks,
      fileChanges,
      reasoning: (result as any).reasoning,
    };
  }

  private async executeWithNullclaw(request: TaskRequest, taskType: TaskType): Promise<any> {
    const { executeNullclawTask, isNullclawAvailable, initializeNullclaw } = await import('./nullclaw-integration');

    try {
      if (!isNullclawAvailable()) {
        await initializeNullclaw();
      }

      // FIX (Bug 3): Map task-router task types to nullclaw task types correctly.
      // task-router returns: 'coding' | 'messaging' | 'browsing' | 'automation' | 'api' | 'unknown'
      // nullclaw expects:   'message' | 'browse' | 'automate' | 'api' | 'schedule'
      const nullclawType: 'message' | 'browse' | 'automate' | 'api' | 'schedule' =
        taskType === 'messaging'  ? 'message' :
        taskType === 'browsing'   ? 'browse'  :
        taskType === 'api'        ? 'api'     :
        taskType === 'automation' ? 'automate' :
        'automate'; // default for coding/unknown

      const task = {
        id: request.id,
        type: nullclawType,
        description: request.task,
        params: this.extractParams(request.task, taskType),
      };

      const result = await executeNullclawTask(
        task.type, task.description, task.params,
        request.userId, request.conversationId,
      );

      request.onToolExecution?.('nullclaw_task', task.params, result);

      return {
        success: result.status === 'completed',
        response: result.result,
        error: result.error,
        agent: 'nullclaw',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TaskRouter] Nullclaw execution failed:', message);

      // Emit failure event for observability
      try {
        await emitEvent(
          {
            type: EventTypes.WORKFLOW,
            templateId: 'nullclaw',
            sessionId: request.conversationId,
            userId: request.userId,
            phase: 'failed',
            error: message,
          },
          request.userId,
          request.conversationId,
        );
      } catch {
        // Non-fatal — don't mask the original error
      }

      throw error;
    }
  }

  private async executeWithCliAgent(request: TaskRequest): Promise<any> {
    const { agentSessionManager } = await import('@/lib/session/agent/agent-session-manager');
    const session = await agentSessionManager.getOrCreateSession(
      request.userId, request.conversationId, { mode: 'opencode' },
    );

    const command = request.cliCommand?.command;
    if (!command) {
      throw new Error('CLI agent requires cliCommand.command');
    }

    // FIX: Guard against missing sandbox handle
    if (!session.sandboxHandle) {
      throw new Error('CLI agent requires an active sandbox session. Ensure sandbox provisioning succeeded before CLI dispatch.');
    }

    const args = request.cliCommand?.args || [];
    const fullCommand = [command, ...args].join(' ');

    try {
      const result = await session.sandboxHandle.executeCommand(fullCommand, session.workspacePath);

      request.onToolExecution?.('cli_exec', { command: fullCommand }, result);

      return {
        success: result.success,
        response: result.output,
        agent: 'cli',
        exitCode: result.exitCode,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TaskRouter] CLI execution failed:', message);
      throw error;
    }
  }

  private extractParams(task: string, taskType: TaskType): Record<string, any> {
    const params: Record<string, any> = {};

    if (taskType === 'messaging') {
      const channelMatch = task.match(/channel[:\s]*(\w+)/i);
      if (channelMatch) params.channelId = channelMatch[1];

      const messageMatch = task.match(/message[:\s]*(.+)/i);
      if (messageMatch) params.message = messageMatch[1].trim();
    } else if (taskType === 'browsing') {
      const urlMatch = task.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) params.url = urlMatch[0];
    }

    return params;
  }
}

export const taskRouter = new TaskRouter();
