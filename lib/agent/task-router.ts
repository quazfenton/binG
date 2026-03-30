/**
 * Task Router - Routes tasks between OpenCode, Nullclaw, and Advanced Agent Tasks
 *
 * OpenCode: Coding tasks (file ops, bash, code generation)
 * Nullclaw: Non-coding tasks (messaging, browsing, automation)
 * Advanced Tasks: Mid-to-long term goals requiring external agent spawning
 *
 * Execution Policies:
 * - local-safe: Simple prompts, read-only
 * - sandbox-required: Bash, file writes
 * - sandbox-heavy: Full-stack apps, databases
 * - desktop-required: GUI, browser automation
 *
 * Advanced Task Detection:
 * Routes to event system when task suggests:
 * - Persistent agent loops (background cognition)
 * - Multi-step research with depth control
 * - DAG workflows with multiple dependencies
 * - Skill bootstrapping (self-extending agents)
 * - Cross-agent communication/specialization
 */

import { createLogger } from '../utils/logger';
import type { ExecutionPolicy } from '../sandbox/types';
import { determineExecutionPolicy } from '../sandbox/types';
import { scheduleTask } from '@/lib/events/trigger-integration';
import { emitEvent } from '@/lib/events/bus';
import { EventTypes } from '@/lib/events/schema';
import { getAgentKernel, AgentType, AgentPriority } from './agent-kernel';

const logger = createLogger('Agent:TaskRouter');

export type TaskType = 'coding' | 'messaging' | 'browsing' | 'automation' | 'api' | 'unknown' | 'advanced';

// FIX (Bug 7): Separate the routing target from the preferred-agent type so
// the dispatch is explicit and unreachable branches can't silently fire.
type RoutingTarget = 'opencode' | 'nullclaw' | 'cli' | 'advanced';

/**
 * Advanced Task Types - Mid-to-long term goals requiring external agent spawning
 * These are routed to the event system for background processing
 */
export type AdvancedTaskType =
  | 'agent-loop'      // Persistent background cognition
  | 'research'        // Multi-step research with depth
  | 'dag-workflow'    // Multi-node workflow execution
  | 'skill-build'     // Extract reusable skills
  | 'consensus'       // Multi-agent debate/negotiation
  | 'reflection'      // Self-improvement after execution
  | 'tool-discover'   // Dynamic tool ranking
  | 'cross-agent'     // Agent-to-agent communication;

export interface TaskRequest {
  id: string;
  userId: string;
  conversationId: string;
  task: string;
  stream?: boolean;
  onStreamChunk?: (chunk: string) => void;
  onToolExecution?: (toolName: string, args: Record<string, any>, result: any) => void;
  preferredAgent?: RoutingTarget;
  executionPolicy?: ExecutionPolicy;
  cliCommand?: {
    command: string;
    args?: string[];
  };
}

export interface TaskRoutingResult {
  type: TaskType;
  /** Normalised 0-1 score based on keyword hits per total keywords checked */
  confidence: number;
  target: RoutingTarget;
  reasoning: string;
}

/**
 * Task Router - Determines which agent should handle a task
 */
class TaskRouter {
  private readonly CODING_KEYWORDS = [
    'code', 'program', 'function', 'class', 'variable', 'import', 'export',
    'file', 'directory', 'folder', 'path', 'read', 'write', 'create', 'delete',
    'bash', 'shell', 'command', 'terminal', 'execute', 'run', 'build', 'compile',
    'test', 'debug', 'refactor', 'git', 'commit', 'push', 'pull',
    'npm', 'pnpm', 'yarn', 'pip', 'install', 'dependency', 'package',
    'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'react', 'vue',
    'api', 'endpoint', 'route', 'server', 'database', 'query', 'schema',
  ];

  private readonly MESSAGING_KEYWORDS = [
    'discord', 'telegram', 'slack', 'message', 'send', 'chat', 'notify',
    'channel', 'user', 'bot', 'webhook', 'mention', 'ping',
  ];

  private readonly BROWSING_KEYWORDS = [
    'browse', 'website', 'url', 'http', 'https', 'www', 'scrape', 'crawl',
    'fetch', 'download', 'webpage', 'search', 'google', 'find information',
  ];

  private readonly AUTOMATION_KEYWORDS = [
    'automate', 'schedule', 'cron', 'repeat', 'daily', 'hourly',
    'server', 'deploy', 'restart', 'backup', 'monitor', 'alert',
    'workflow', 'pipeline', 'ci', 'cd', 'integration',
  ];

  // ============================================================================
  // Advanced Task Keywords - Mid-to-long term goals requiring external agents
  // ============================================================================
  
  private readonly ADVANCED_TASK_KEYWORDS = {
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

  analyzeTask(task: string): TaskRoutingResult {
    const lowerTask = task.toLowerCase();

    const scores = {
      coding:     this.scoreKeywords(lowerTask, this.CODING_KEYWORDS),
      messaging:  this.scoreKeywords(lowerTask, this.MESSAGING_KEYWORDS),
      browsing:   this.scoreKeywords(lowerTask, this.BROWSING_KEYWORDS),
      automation: this.scoreKeywords(lowerTask, this.AUTOMATION_KEYWORDS),
    };

    const maxScore = Math.max(...Object.values(scores));
    const primaryType = (Object.entries(scores)
      .find(([, score]) => score === maxScore)?.[0] ?? 'unknown') as TaskType;

    // FIX (Bug 5 & 7): Explicit target assignment with no fall-through ambiguity.
    let target: RoutingTarget;
    let reasoning: string;

    // FIX: If no keywords matched (all scores are 0), classify as 'unknown' instead of defaulting to 'coding'
    if (maxScore === 0) {
      target = 'cli';
      reasoning = 'No specific keywords detected, task may be a simple query or command';
    } else {
      switch (primaryType) {
        case 'coding':
          target = 'opencode';
          reasoning = 'Task involves coding, file operations, or shell commands';
          break;
        case 'messaging':
        case 'browsing':
          target = 'nullclaw';
          reasoning = `Task involves ${primaryType} which requires external API access`;
          break;
        case 'automation':
          if (scores.coding > 0) {
            target = 'opencode';
            reasoning = 'Automation task with coding components';
          } else {
            target = 'nullclaw';
            reasoning = 'Automation task requiring external services';
          }
          break;
        default:
          target = 'cli';
          reasoning = 'Unknown task type, using CLI agent';
      }
    }

    // FIX Bug 6: Normalize confidence against keyword count, not character length
    const maxPossibleScore = Math.max(
      this.CODING_KEYWORDS.length,
      this.MESSAGING_KEYWORDS.length,
      this.BROWSING_KEYWORDS.length,
      this.AUTOMATION_KEYWORDS.length,
    );
    // Confidence is now meaningful [0, 1] range
    const confidence = maxScore > 0
      ? Math.min(1, maxScore / Math.max(maxPossibleScore * 0.3, 1))
      : 0;

    const result: TaskRoutingResult = { type: primaryType, confidence, target, reasoning };

    logger.debug(
      `Task routed: ${task.substring(0, 50)}... → ${target} (${primaryType}, confidence: ${confidence.toFixed(2)})`,
    );

    return result;
  }

  private scoreKeywords(task: string, keywords: string[]): number {
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = task.match(regex);
      if (matches) score += matches.length;
    }
    return score;
  }

  // ============================================================================
  // Advanced Task Detection - End of routing tree for mid-to-long term goals
  // ============================================================================

  /**
   * Analyze if task requires advanced agent spawning (mid-to-long term goals)
   * Called at end of routing tree when basic routing is ambiguous or task
   * suggests persistent/background/external agent work
   * 
   * @param task - The user's task prompt
   * @returns AdvancedTaskType or null if not an advanced task
   */
  analyzeAdvancedTask(task: string): AdvancedTaskType | null {
    const lowerTask = task.toLowerCase();
    const scores: Record<AdvancedTaskType, number> = {
      'agent-loop': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['agent-loop']),
      'research': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['research']),
      'dag-workflow': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['dag-workflow']),
      'skill-build': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['skill-build']),
      'consensus': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['consensus']),
      'reflection': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['reflection']),
      'tool-discover': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['tool-discover']),
      'cross-agent': this.scoreKeywords(lowerTask, this.ADVANCED_TASK_KEYWORDS['cross-agent']),
    };

    const maxScore = Math.max(...Object.values(scores));
    const threshold = 2; // Require at least 2 keyword matches

    if (maxScore >= threshold) {
      const advancedType = (Object.entries(scores)
        .find(([, score]) => score === maxScore)?.[0] ?? null) as AdvancedTaskType | null;
      
      logger.info(`[TaskRouter] Advanced task detected: ${advancedType} (score: ${maxScore})`);
      return advancedType;
    }

    return null;
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
    const hasActionKeywords = this.scoreKeywords(lowerTask, [
      'build', 'create', 'implement', 'write', 'make', 'develop',
      'fix', 'refactor', 'deploy', 'run', 'execute', 'automate',
    ]) > 0;
    
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
      
      return {
        success: true,
        agentId,
        type: advancedType,
        kernelManaged: true,
        message: `Agent ${agentId} spawned and managed by Kernel`,
      };
    } catch (error: any) {
      // Fallback to event system if kernel fails
      logger.error(`[TaskRouter] Kernel execution failed, falling back to event system:`, error.message);
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

      // Also schedule the task for immediate execution
      return await scheduleTask({
        taskType: fallbackConfig.taskType,
        schedule: fallbackConfig.schedule,
        payload: { ...fallbackConfig.payload, prompt: fallbackConfig.payload.prompt || task },
        metadata: {
          ...fallbackConfig.metadata,
          eventId: eventResult.eventId,
        },
        userId,
      });
    } catch (error: any) {
      logger.error(`[TaskRouter] Fallback execution failed:`, error.message);

      // Emit failure event
      try {
        await emitEvent(
          {
            type: EventTypes.WORKFLOW,
            templateId: advancedType,
            sessionId: request.conversationId,
            userId: request.userId,
            phase: 'failed',
            error: error.message,
          },
          request.userId,
          request.conversationId
        );
      } catch (emitError: any) {
        logger.error(`[TaskRouter] Failed to emit failure event:`, emitError.message);
      }

      return { success: false, error: error.message, type: advancedType };
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
    const routing = this.analyzeTask(request.task);
    
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
      case 'nullclaw': return this.executeWithNullclaw(request, this.analyzeTask(request.task).type);
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
      const { createOpenCodeEngine } = await import('../session/agent/opencode-engine-service');
      const engine = createOpenCodeEngine({
        model: process.env.OPENCODE_MODEL,
        workingDir: `/workspace/users/${request.userId}/sessions/${request.conversationId}`,
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

    const { OpencodeV2Provider } = await import('../sandbox/spawn/opencode-cli');
    const { agentSessionManager } = await import('../session/agent/agent-session-manager');
    const { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } = await import('../mcp');

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

      const nullclawType: 'message' | 'browse' | 'automate' =
        taskType === 'messaging' ? 'message' :
        taskType === 'browsing'  ? 'browse'  :
        'automate';

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
    } catch (error: any) {
      logger.error('[TaskRouter] Nullclaw execution failed:', error.message);
      throw error;
    }
  }

  private async executeWithCliAgent(request: TaskRequest): Promise<any> {
    const { agentSessionManager } = await import('../session/agent/agent-session-manager');
    const session = await agentSessionManager.getOrCreateSession(
      request.userId, request.conversationId, { mode: 'opencode' },
    );

    const command = request.cliCommand?.command;
    if (!command) {
      throw new Error('CLI agent requires cliCommand.command');
    }

    const args = request.cliCommand?.args || [];
    const fullCommand = [command, ...args].join(' ');
    const result = await session.sandboxHandle.executeCommand(fullCommand, session.workspacePath);

    request.onToolExecution?.('cli_exec', { command: fullCommand }, result);

    return {
      success: result.success,
      response: result.output,
      agent: 'cli',
      exitCode: result.exitCode,
    };
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
