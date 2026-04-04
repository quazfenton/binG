/**
 * Claude Code Agent Service
 * 
 * Containerized Anthropic Claude Code implementation.
 * Provides advanced coding capabilities with:
 * - Multi-file editing
 * - Terminal command execution
 * - Git integration
 * - Web search capabilities
 * 
 * @see https://docs.anthropic.com/claude-code/
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger';
import type { AgentInstance, PromptRequest, PromptResponse, AgentEvent } from './agent-service-manager';

const logger = createLogger('Agents:ClaudeCode');

// ============================================================================
// Types
// ============================================================================

export interface ClaudeCodeConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Workspace directory */
  workspaceDir: string;
  /** Model to use (default: claude-sonnet-4-5-20250929) */
  model?: string;
  /** Container port */
  port?: number;
  /** Agent ID */
  agentId?: string;
  /** Max tokens for responses */
  maxTokens?: number;
  /** System prompt override */
  systemPrompt?: string;
}

export interface ClaudeCodeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image' | 'tool_use' | 'tool_result';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
    id?: string;
    name?: string;
    input?: any;
    output?: any;
  }>;
}

export interface ClaudeCodeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// Built-in Claude Code tools
export const CLAUDE_CODE_TOOLS: Record<string, ClaudeCodeTool> = {
  'Edit': {
    name: 'Edit',
    description: 'Edit a file by providing a search and replace',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file to edit' },
        search: { type: 'string', description: 'Text to search for' },
        replace: { type: 'string', description: 'Text to replace with' },
      },
      required: ['file_path', 'search', 'replace'],
    },
  },
  'WriteFile': {
    name: 'WriteFile',
    description: 'Write content to a file',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['file_path', 'content'],
    },
  },
  'ReadFile': {
    name: 'ReadFile',
    description: 'Read content of a file',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to file' },
      },
      required: ['file_path'],
    },
  },
  'RunBash': {
    name: 'RunBash',
    description: 'Execute a bash command',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command to execute' },
        working_dir: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
  },
};

// ============================================================================
// Claude Code Agent Service
// ============================================================================

export class ClaudeCodeAgent extends EventEmitter {
  private config: ClaudeCodeConfig;
  private agent?: AgentInstance;
  private sessionMessages: ClaudeCodeMessage[] = [];

  constructor(config: ClaudeCodeConfig) {
    super();
    this.config = {
      model: config.model || 'claude-sonnet-4-5-20250929',
      maxTokens: config.maxTokens || 8192,
      ...config,
    };
  }

  /**
   * Start the Claude Code agent
   */
  async start(): Promise<void> {
    logger.info('Starting Claude Code agent', {
      model: this.config.model,
      workspace: this.config.workspaceDir,
    });

    const { getAgentServiceManager } = await import('./agent-service-manager');
    const manager = getAgentServiceManager();

    this.agent = await manager.startAgent({
      type: 'claude-code',
      agentId: this.config.agentId,
      workspaceDir: this.config.workspaceDir,
      apiKey: this.config.apiKey,
      port: this.config.port,
      env: {
        'CLAUDE_CODE_MODEL': this.config.model,
        'CLAUDE_CODE_MAX_TOKENS': String(this.config.maxTokens),
        ...(this.config.systemPrompt ? { 'CLAUDE_CODE_SYSTEM_PROMPT': this.config.systemPrompt } : {}),
      },
    });

    logger.info('Claude Code agent started', {
      agentId: this.agent.agentId,
      apiUrl: this.agent.apiUrl,
    });
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (!this.agent) {
      return;
    }

    logger.info('Stopping Claude Code agent', { agentId: this.agent.agentId });

    const { getAgentServiceManager } = await import('./agent-service-manager');
    const manager = getAgentServiceManager();
    await manager.stopAgent(this.agent.agentId);

    this.agent = undefined;
    this.sessionMessages = [];
  }

  /**
   * Send a prompt and get response
   */
  async prompt(request: PromptRequest): Promise<PromptResponse> {
    if (!this.agent) {
      throw new Error('Claude Code agent not started');
    }

    logger.debug('Sending prompt to Claude Code', {
      messageLength: request.message.length,
    });

    // Add user message to session
    this.sessionMessages.push({
      role: 'user',
      content: request.message,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.agent.apiUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          messages: this.sessionMessages,
          system: this.config.systemPrompt,
          tools: Object.values(CLAUDE_CODE_TOOLS),
          stream: request.stream,
        }),
        signal: AbortSignal.timeout(request.timeout || 300000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude Code API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // Extract response
      const content = data.content?.[0]?.text || '';
      
      // Add assistant response to session
      this.sessionMessages.push({
        role: 'assistant',
        content: content,
      });

      // Extract tool calls
      const toolCalls = data.content
        ?.filter((c: any) => c.type === 'tool_use')
        ?.map((tool: any) => ({
          name: tool.name,
          arguments: tool.input,
        }));

      const result: PromptResponse = {
        response: content,
        duration: Date.now() - startTime,
        toolCalls,
        usage: data.usage ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        } : undefined,
      };

      logger.info('Claude Code completed prompt', {
        duration: result.duration,
        tokens: result.usage?.totalTokens,
      });

      return result;
    } catch (error: any) {
      logger.error('Claude Code prompt failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Execute a file operation
   */
  async executeFileOperation(
    operation: 'read' | 'write' | 'edit',
    filePath: string,
    content?: string,
    search?: string,
    replace?: string
  ): Promise<string> {
    const toolMap = {
      'read': 'ReadFile',
      'write': 'WriteFile',
      'edit': 'Edit',
    };

    const toolName = toolMap[operation];
    
    const response = await this.prompt({
      message: `Use the ${toolName} tool to ${operation} the file ${filePath}${content ? ' with content' : ''}${search ? ` by searching for "${search}" and replacing with "${replace}"` : ''}`,
      timeout: 60000,
    });

    return response.response;
  }

  /**
   * Execute a terminal command
   */
  async executeCommand(command: string, workingDir?: string): Promise<string> {
    const response = await this.prompt({
      message: `Use the RunBash tool to execute: ${command}${workingDir ? ` in directory ${workingDir}` : ''}`,
      timeout: 120000,
    });

    return response.response;
  }

  /**
   * Get session messages
   */
  getSessionMessages(): ClaudeCodeMessage[] {
    return [...this.sessionMessages];
  }

  /**
   * Clear session history
   */
  clearSession(): void {
    this.sessionMessages = [];
    logger.debug('Claude Code session cleared');
  }

  /**
   * Subscribe to agent events
   */
  async subscribe(): Promise<AsyncGenerator<AgentEvent>> {
    if (!this.agent) {
      throw new Error('Agent not started');
    }

    const { getAgentServiceManager } = await import('./agent-service-manager');
    const manager = getAgentServiceManager();
    return manager.subscribe(this.agent.agentId);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createClaudeCodeAgent(
  config: ClaudeCodeConfig
): Promise<ClaudeCodeAgent> {
  const agent = new ClaudeCodeAgent(config);
  await agent.start();
  return agent;
}

export default ClaudeCodeAgent;
