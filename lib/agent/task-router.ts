/**
 * Task Router - Routes tasks between OpenCode and Nullclaw
 * 
 * OpenCode: Coding tasks (file ops, bash, code generation)
 * Nullclaw: Non-coding tasks (messaging, browsing, automation)
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Agent:TaskRouter');

export type TaskType = 'coding' | 'messaging' | 'browsing' | 'automation' | 'api' | 'unknown';

export interface TaskRequest {
  id: string;
  userId: string;
  conversationId: string;
  task: string;
  stream?: boolean;
  onStreamChunk?: (chunk: string) => void;
  onToolExecution?: (toolName: string, args: Record<string, any>, result: any) => void;
  preferredAgent?: 'opencode' | 'nullclaw' | 'cli';
  cliCommand?: {
    command: string;
    args?: string[];
  };
}

export interface TaskRoutingResult {
  type: TaskType;
  confidence: number;
  target: 'opencode' | 'nullclaw';
  reasoning: string;
}

/**
 * Task Router - Determines which agent should handle a task
 */
class TaskRouter {
  /**
   * Keywords that indicate coding tasks
   */
  private readonly CODING_KEYWORDS = [
    'code', 'program', 'function', 'class', 'variable', 'import', 'export',
    'file', 'directory', 'folder', 'path', 'read', 'write', 'create', 'delete',
    'bash', 'shell', 'command', 'terminal', 'execute', 'run', 'build', 'compile',
    'test', 'debug', 'refactor', 'git', 'commit', 'push', 'pull',
    'npm', 'pnpm', 'yarn', 'pip', 'install', 'dependency', 'package',
    'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'react', 'vue',
    'api', 'endpoint', 'route', 'server', 'database', 'query', 'schema',
  ];

  /**
   * Keywords that indicate messaging tasks
   */
  private readonly MESSAGING_KEYWORDS = [
    'discord', 'telegram', 'slack', 'message', 'send', 'chat', 'notify',
    'channel', 'user', 'bot', 'webhook', 'mention', 'ping',
  ];

  /**
   * Keywords that indicate browsing tasks
   */
  private readonly BROWSING_KEYWORDS = [
    'browse', 'website', 'url', 'http', 'https', 'www', 'scrape', 'crawl',
    'fetch', 'download', 'webpage', 'search', 'google', 'find information',
  ];

  /**
   * Keywords that indicate automation tasks
   */
  private readonly AUTOMATION_KEYWORDS = [
    'automate', 'schedule', 'cron', 'repeat', 'daily', 'hourly',
    'server', 'deploy', 'restart', 'backup', 'monitor', 'alert',
    'workflow', 'pipeline', 'ci', 'cd', 'integration',
  ];

  /**
   * Analyze task and determine routing
   */
  analyzeTask(task: string): TaskRoutingResult {
    const lowerTask = task.toLowerCase();
    
    const scores = {
      coding: this.scoreKeywords(lowerTask, this.CODING_KEYWORDS),
      messaging: this.scoreKeywords(lowerTask, this.MESSAGING_KEYWORDS),
      browsing: this.scoreKeywords(lowerTask, this.BROWSING_KEYWORDS),
      automation: this.scoreKeywords(lowerTask, this.AUTOMATION_KEYWORDS),
    };

    // Find highest scoring category
    const maxScore = Math.max(...Object.values(scores));
    const primaryType = Object.entries(scores)
      .find(([_, score]) => score === maxScore)?.[0] as TaskType || 'unknown';

    // Determine target agent
    let target: 'opencode' | 'nullclaw';
    let reasoning: string;

    if (primaryType === 'coding') {
      target = 'opencode';
      reasoning = 'Task involves coding, file operations, or shell commands';
    } else if (primaryType === 'messaging' || primaryType === 'browsing') {
      target = 'nullclaw';
      reasoning = `Task involves ${primaryType} which requires external API access`;
    } else if (primaryType === 'automation') {
      // Automation could go either way - check for coding keywords
      if (scores.coding > 0) {
        target = 'opencode';
        reasoning = 'Automation task with coding components';
      } else {
        target = 'nullclaw';
        reasoning = 'Automation task requiring external services';
      }
    } else {
      // Default to OpenCode for unknown tasks
      target = 'opencode';
      reasoning = 'Unknown task type, defaulting to coding agent';
    }

    const result: TaskRoutingResult = {
      type: primaryType,
      confidence: maxScore / Math.max(lowerTask.length, 1),
      target,
      reasoning,
    };

    logger.debug(`Task routed: ${task.substring(0, 50)}... → ${target} (${primaryType}, confidence: ${result.confidence.toFixed(2)})`);

    return result;
  }

  /**
   * Score a task based on keyword matches
   */
  private scoreKeywords(task: string, keywords: string[]): number {
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = task.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    return score;
  }

  /**
   * Execute task with appropriate agent
   */
  async executeTask(request: TaskRequest): Promise<any> {
    const routing = request.preferredAgent
      ? {
          type: 'unknown' as TaskType,
          confidence: 1,
          target: request.preferredAgent,
          reasoning: 'Preferred agent override',
        }
      : this.analyzeTask(request.task);

    logger.info(`Routing task to ${routing.target} (${routing.type})`);

    if (routing.target === 'opencode') {
      return this.executeWithOpenCode(request);
    } else if (routing.target === 'nullclaw') {
      return this.executeWithNullclaw(request, routing.type);
    } else {
      return this.executeWithCliAgent(request);
    }
  }

  /**
   * Execute task with OpenCode agent
   */
  private async executeWithOpenCode(request: TaskRequest): Promise<any> {
    const useV2 =
      process.env.OPENCODE_CONTAINERIZED === 'true' ||
      process.env.V2_AGENT_ENABLED === 'true';

    if (!useV2) {
      // Fallback to local OpenCode engine
      const { createOpenCodeEngine } = await import('../api/opencode-engine-service');
      const engine = createOpenCodeEngine({
        model: process.env.OPENCODE_MODEL,
        workingDir: `/workspace/users/${request.userId}/sessions/${request.conversationId}`,
        enableBash: true,
        enableFileOps: true,
        enableCodegen: true,
      });

      if (request.stream) {
        return {
          type: 'stream',
          stream: engine.executeStream(request.task),
        };
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

    const { OpencodeV2Provider } = await import('../sandbox/providers/opencode-v2-provider');
    const { agentSessionManager } = await import('./agent-session-manager');
    const { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } = await import('../mcp');

    const session = await agentSessionManager.getOrCreateSession(
      request.userId,
      request.conversationId,
      { enableMCP: true, enableNullclaw: true, mode: 'hybrid' },
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

    const tools = await getMCPToolsForAI_SDK();

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
        return {
          success: toolResult.success,
          output: toolResult.output,
          exitCode: toolResult.success ? 0 : 1,
        };
      },
    });

    // Extract file changes from V2 agent steps
    const fileChanges: Array<{ path: string; action: string; content?: string }> = [];
    if (result.steps) {
      for (const step of result.steps) {
        // Look for file operation tool calls in steps
        if (step.toolName && ['write_file', 'read_file', 'delete_file', 'edit_file', 'Bash'].includes(step.toolName)) {
          const args = step.args || {};
          const path = args.path || args.file || args.target || '';
          if (path) {
            if (step.toolName === 'Bash' && args.command) {
              // Extract file paths from bash commands like "echo > file.txt"
              const match = args.command.match(/(?:>\s*|tee\s+|cat\s*>\s*)([^\s|]+)/);
              if (match) {
                fileChanges.push({ path: match[1], action: 'modify' });
              }
            } else {
              fileChanges.push({ path, action: step.toolName === 'delete_file' ? 'delete' : 'modify' });
            }
          }
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

  /**
   * Execute task with Nullclaw agent
   */
  private async executeWithNullclaw(request: TaskRequest, taskType: TaskType): Promise<any> {
    const { nullclawIntegration } = await import('./nullclaw-integration');

    // Initialize Nullclaw if needed
    const endpoint = await nullclawIntegration.initializeForSession(
      request.userId,
      request.conversationId,
    );

    if (!endpoint) {
      throw new Error('Nullclaw not available');
    }

    // Build Nullclaw task based on type
    const task = {
      id: request.id,
      type: taskType === 'messaging' ? 'message' : taskType === 'browsing' ? 'browse' : 'automate',
      description: request.task,
      params: this.extractParams(request.task, taskType),
      status: 'pending' as const,
      createdAt: new Date(),
    };

    const result = await nullclawIntegration.executeTask(
      request.userId,
      request.conversationId,
      task,
    );

    request.onToolExecution?.('nullclaw_task', task.params, result);

    return {
      success: result.status === 'completed',
      response: result.result,
      error: result.error,
      agent: 'nullclaw',
    };
  }

  /**
   * Execute task with a generic CLI agent inside the sandbox
   */
  private async executeWithCliAgent(request: TaskRequest): Promise<any> {
    const { agentSessionManager } = await import('./agent-session-manager');
    const session = await agentSessionManager.getOrCreateSession(
      request.userId,
      request.conversationId,
      { mode: 'opencode' },
    );

    const command = request.cliCommand?.command;
    if (!command) {
      throw new Error('CLI agent requires cliCommand.command');
    }

    const args = request.cliCommand?.args || [];
    const fullCommand = [command, ...args].join(' ');
    const result = await session.sandboxHandle.executeCommand(
      fullCommand,
      session.workspacePath,
    );

    request.onToolExecution?.('cli_exec', { command: fullCommand }, result);

    return {
      success: result.success,
      response: result.output,
      agent: 'cli',
      exitCode: result.exitCode,
    };
  }

  /**
   * Extract parameters from task description
   */
  private extractParams(task: string, taskType: TaskType): Record<string, any> {
    const params: Record<string, any> = {};

    if (taskType === 'messaging') {
      // Extract channel/user IDs from task
      const channelMatch = task.match(/channel[:\s]*(\w+)/i);
      if (channelMatch) {
        params.channelId = channelMatch[1];
      }

      const messageMatch = task.match(/message[:\s]*(.+)/i);
      if (messageMatch) {
        params.message = messageMatch[1].trim();
      }
    } else if (taskType === 'browsing') {
      // Extract URL from task
      const urlMatch = task.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        params.url = urlMatch[0];
      }
    }

    return params;
  }
}

// Singleton instance
export const taskRouter = new TaskRouter();
