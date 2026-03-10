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
    const routing = this.analyzeTask(request.task);

    logger.info(`Routing task to ${routing.target} (${routing.type})`);

    if (routing.target === 'opencode') {
      return this.executeWithOpenCode(request);
    } else {
      return this.executeWithNullclaw(request, routing.type);
    }
  }

  /**
   * Execute task with OpenCode agent
   */
  private async executeWithOpenCode(request: TaskRequest): Promise<any> {
    // Import dynamically to avoid circular dependencies
    const { createOpenCodeEngine } = await import('../api/opencode-engine-service');
    
    const engine = createOpenCodeEngine({
      model: process.env.OPENCODE_MODEL,
      workingDir: `/workspace/users/${request.userId}/${request.conversationId}`,
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
      fileChanges: result.fileChanges,
      agent: 'opencode',
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

    return {
      success: result.status === 'completed',
      response: result.result,
      error: result.error,
      agent: 'nullclaw',
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
