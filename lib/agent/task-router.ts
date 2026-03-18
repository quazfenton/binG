/**
 * Task Router - Routes tasks between OpenCode and Nullclaw with execution policy selection
 *
 * OpenCode: Coding tasks (file ops, bash, code generation)
 * Nullclaw: Non-coding tasks (messaging, browsing, automation)
 *
 * Execution Policies:
 * - local-safe: Simple prompts, read-only
 * - sandbox-required: Bash, file writes
 * - sandbox-heavy: Full-stack apps, databases
 * - desktop-required: GUI, browser automation
 */

import { createLogger } from '../utils/logger';
import type { ExecutionPolicy } from '../sandbox/types';
import { determineExecutionPolicy } from '../sandbox/types';

const logger = createLogger('Agent:TaskRouter');

export type TaskType = 'coding' | 'messaging' | 'browsing' | 'automation' | 'api' | 'unknown';

// FIX (Bug 7): Separate the routing target from the preferred-agent type so
// the dispatch is explicit and unreachable branches can't silently fire.
type RoutingTarget = 'opencode' | 'nullclaw' | 'cli';

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

    // FIX (Bug 6): Normalise confidence against the keyword count of the
    // winning category so it stays in [0, 1] and is actually meaningful.
    const keywordSets: Record<string, string[]> = {
      coding:     this.CODING_KEYWORDS,
      messaging:  this.MESSAGING_KEYWORDS,
      browsing:   this.BROWSING_KEYWORDS,
      automation: this.AUTOMATION_KEYWORDS,
    };
    const totalKeywordsInWinningSet = keywordSets[primaryType]?.length ?? 1;

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

  async executeTask(request: TaskRequest): Promise<any> {
    // FIX (Bug 5 & 7): Handle preferred agent explicitly before routing.
    if (request.preferredAgent) {
      logger.info(`Routing task to preferred agent: ${request.preferredAgent}`);
      return this.dispatchToTarget(request.preferredAgent, request);
    }

    const routing = this.analyzeTask(request.task);
    logger.info(`Routing task to ${routing.target} (${routing.type})`);
    return this.dispatchToTarget(routing.target, request);
  }

  /** Single dispatch point — no ambiguous else-chains. */
  private async dispatchToTarget(target: RoutingTarget, request: TaskRequest): Promise<any> {
    switch (target) {
      case 'opencode': return this.executeWithOpenCode(request);
      case 'nullclaw': return this.executeWithNullclaw(request, this.analyzeTask(request.task).type);
      case 'cli':      return this.executeWithCliAgent(request);
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
