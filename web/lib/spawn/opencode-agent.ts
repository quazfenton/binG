/**
 * OpenCode Agent Service
 * 
 * Containerized OpenCode server implementation.
 * Open-source alternative to Claude Code and Amp with:
 * - Self-hosted deployment
 * - Customizable models
 * - Full control over data
 * - No API costs
 * 
 * @see https://github.com/anomalyco/opencode
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { createLogger } from '../utils/logger';
import { findOpencodeBinarySync } from '@/lib/agent-bins/find-opencode-binary';
import { waitForLocalServer, spawnLocalAgent, connectToRemoteAgent } from './local-server-utils';
import type { AgentInstance, PromptRequest, PromptResponse, AgentEvent } from './agent-service-manager';

const logger = createLogger('Agents:OpenCode');

// ============================================================================
// Types
// ============================================================================

export interface OpenCodeConfig {
  /** OpenCode server API key (if authentication enabled) */
  apiKey?: string;
  /** Workspace directory */
  workspaceDir: string;
  /** Model to use */
  model?: string;
  /** Container port */
  port?: number;
  /** Agent ID */
  agentId?: string;
  /** Max tokens for responses */
  maxTokens?: number;
  /** Temperature for generation */
  temperature?: number;
  /** System prompt override */
  systemPrompt?: string;
  /** OpenCode server hostname */
  hostname?: string;
  /** Provider ID for model */
  providerId?: string;
  /**
   * Remote address of an already-running OpenCode server.
   * When set, skips local binary spawn and containerized fallback, and
   * connects directly to the remote endpoint.
   */
  remoteAddress?: string;
}

export interface OpenCodeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image' | 'tool_use' | 'tool_result';
    text?: string;
    image?: string;
    tool_use_id?: string;
    name?: string;
    input?: any;
    content?: any;
  }>;
}

export interface OpenCodeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// Built-in OpenCode tools
export const OPENCODE_TOOLS: Record<string, OpenCodeTool> = {
  'read': {
    name: 'read',
    description: 'Read file contents',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  'write': {
    name: 'write',
    description: 'Write content to a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  'edit': {
    name: 'edit',
    description: 'Edit a file with search and replace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        search: { type: 'string', description: 'Text to search for' },
        replace: { type: 'string', description: 'Text to replace with' },
      },
      required: ['path', 'search', 'replace'],
    },
  },
  'shell': {
    name: 'shell',
    description: 'Execute a shell command',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
  },
  'glob': {
    name: 'glob',
    description: 'Search for files matching a pattern',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
        path: { type: 'string', description: 'Directory to search in' },
      },
      required: ['pattern'],
    },
  },
  'grep': {
    name: 'grep',
    description: 'Search for text in files',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory to search in' },
      },
      required: ['pattern'],
    },
  },
};

// ============================================================================
// OpenCode Agent Service
// ============================================================================

export class OpenCodeAgent extends EventEmitter {
  private config: Required<Omit<OpenCodeConfig, 'apiKey'>> & { apiKey?: string };
  private agent?: AgentInstance;
  private localProcess?: ChildProcess;
  private localPort?: number;
  private sessionId?: string;
  private sessionMessages: OpenCodeMessage[] = [];

  constructor(config: OpenCodeConfig) {
    super();
    this.config = {
      model: config.model || 'anthropic/claude-sonnet-4-5-20250929',
      maxTokens: config.maxTokens || 8192,
      temperature: config.temperature || 0.7,
      hostname: config.hostname || 'localhost',
      port: config.port || 4096,
      providerId: config.providerId || 'anthropic',
      workspaceDir: config.workspaceDir,
      agentId: config.agentId || `opencode-${Date.now()}`,
      systemPrompt: config.systemPrompt || undefined,
      ...config,
    } as any;
  }

  /**
   * Start the OpenCode agent.
   * Prefers a local `opencode` binary (found via findOpencodeBinarySync) and
   * spawns it as a subprocess. Falls back to containerized mode via the
   * agent-service-manager when no local binary is available.
   */
  async start(): Promise<void> {
    logger.info('Starting OpenCode agent', {
      model: this.config.model,
      workspace: this.config.workspaceDir,
      port: this.config.port,
      remoteAddress: this.config.remoteAddress || undefined,
    });

    // 0. If a remote address is configured, connect directly
    if (this.config.remoteAddress) {
      this.agent = await connectToRemoteAgent({
        remoteAddress: this.config.remoteAddress,
        agentType: 'opencode',
        agentId: this.config.agentId,
        workspaceDir: this.config.workspaceDir,
      });

      // Create a new session on the remote server
      await this.createSession();
      return;
    }

    // 1. Try to find and spawn a local opencode binary
    const opencodeBin = findOpencodeBinarySync();
    if (opencodeBin) {
      try {
        this.localPort = this.config.port || 4096;

        logger.info('Spawning local opencode binary', { binary: opencodeBin, port: this.localPort });

        this.localProcess = spawnLocalAgent(
          opencodeBin,
          ['serve', '--port', String(this.localPort), '--host', '0.0.0.0'],
          {
            cwd: this.config.workspaceDir,
            label: 'opencode',
            env: {
              OPENCODE_MODEL: this.config.model,
              OPENCODE_MAX_TOKENS: String(this.config.maxTokens),
              OPENCODE_TEMPERATURE: String(this.config.temperature),
              OPENCODE_PROVIDER: this.config.providerId,
              ...(this.config.systemPrompt ? { OPENCODE_SYSTEM_PROMPT: this.config.systemPrompt } : {}),
              ...(this.config.apiKey ? { OPENCODE_API_KEY: this.config.apiKey } : {}),
            },
            onExit: () => { this.localProcess = undefined; },
            onError: () => { this.localProcess = undefined; },
          },
        );

        // Create a synthetic AgentInstance pointing to the local subprocess
        this.agent = {
          agentId: this.config.agentId || `opencode-local-${Date.now()}`,
          type: 'opencode',
          containerId: '',
          port: this.localPort,
          apiUrl: `http://127.0.0.1:${this.localPort}`,
          workspaceDir: this.config.workspaceDir,
          startedAt: Date.now(),
          lastActivity: Date.now(),
          status: 'starting',
          health: 'unknown',
        };

        // Wait for local server to be ready (up to 30s)
        await waitForLocalServer(this.localPort);
        this.agent.status = 'ready';
        this.agent.health = 'healthy';

        // Create a new session
        await this.createSession();

        logger.info('OpenCode agent started (local binary)', {
          agentId: this.agent.agentId,
          apiUrl: this.agent.apiUrl,
          sessionId: this.sessionId,
        });
        return;
      } catch (err: any) {
        logger.warn('Local opencode binary spawn failed, falling back to containerized mode', {
          error: err.message,
        });
        // Clean up failed local process
        this.localProcess?.kill();
        this.localProcess = undefined;
        this.localPort = undefined;
        this.agent = undefined;
      }
    }

    // 2. Fall back to containerized mode
    logger.info('No local opencode binary found, using containerized mode');
    const { getAgentServiceManager } = await import('./agent-service-manager');
    const manager = getAgentServiceManager();

    this.agent = await manager.startAgent({
      type: 'opencode',
      agentId: this.config.agentId,
      workspaceDir: this.config.workspaceDir,
      apiKey: this.config.apiKey || 'opencode-local-key',
      port: this.config.port,
      env: {
        'OPENCODE_MODEL': this.config.model,
        'OPENCODE_MAX_TOKENS': String(this.config.maxTokens),
        'OPENCODE_TEMPERATURE': String(this.config.temperature),
        'OPENCODE_PROVIDER': this.config.providerId,
        ...(this.config.systemPrompt ? { 'OPENCODE_SYSTEM_PROMPT': this.config.systemPrompt } : {}),
        ...(this.config.apiKey ? { 'OPENCODE_API_KEY': this.config.apiKey } : {}),
      },
    });

    // Create a new session
    await this.createSession();

    logger.info('OpenCode agent started (containerized)', {
      agentId: this.agent.agentId,
      apiUrl: this.agent.apiUrl,
      sessionId: this.sessionId,
    });
  }

  /**
   * Stop the agent (kills local subprocess or stops containerized agent)
   */
  async stop(): Promise<void> {
    // Stop local subprocess first
    if (this.localProcess) {
      logger.info('Stopping local opencode subprocess', { pid: this.localProcess.pid });
      this.localProcess.kill();
      this.localProcess = undefined;
      this.localPort = undefined;
    }

    if (!this.agent) {
      return;
    }

    logger.info('Stopping OpenCode agent', { agentId: this.agent.agentId });

    // Only stop via service manager for containerized agents
    if (this.agent.containerId) {
      const { getAgentServiceManager } = await import('./agent-service-manager');
      const manager = getAgentServiceManager();
      await manager.stopAgent(this.agent.agentId);
    }

    this.agent = undefined;
    this.sessionId = undefined;
    this.sessionMessages = [];
  }

  /**
   * Create a new session
   */
  async createSession(title?: string): Promise<string> {
    if (!this.agent) {
      throw new Error('OpenCode agent not started');
    }

    try {
      const response = await fetch(`${this.agent.apiUrl}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          title,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const data = await response.json();
      this.sessionId = data.id;
      this.sessionMessages = [];

      logger.debug('OpenCode session created', { sessionId: this.sessionId });
      return this.sessionId;
    } catch (error: any) {
      logger.error('Failed to create OpenCode session', { error: error.message });
      throw error;
    }
  }

  /**
   * Send a prompt and get response
   */
  async prompt(request: PromptRequest): Promise<PromptResponse> {
    if (!this.agent || !this.sessionId) {
      throw new Error('OpenCode agent not started or no session');
    }

    logger.debug('Sending prompt to OpenCode', {
      messageLength: request.message.length,
      sessionId: this.sessionId,
    });

    // Add user message to session
    this.sessionMessages.push({
      role: 'user',
      content: request.message,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.agent.apiUrl}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          session_id: this.sessionId,
          message: request.message,
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: request.system || this.config.systemPrompt,
          stream: request.stream,
        }),
        signal: AbortSignal.timeout(request.timeout || 300000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenCode API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // Extract response
      const content = data.response || data.message || '';
      
      // Add assistant response to session
      this.sessionMessages.push({
        role: 'assistant',
        content: content,
      });

      // Extract tool calls
      const toolCalls = data.tool_calls?.map((tc: any) => ({
        name: tc.name,
        arguments: tc.arguments || tc.input,
        result: tc.result,
      }));

      // Extract file changes from tool calls
      const filesModified = toolCalls
        ?.filter(tc => ['write', 'edit'].includes(tc.name))
        .map(tc => ({
          path: tc.arguments.path,
          action: tc.name === 'write' ? 'create' : 'modify' as const,
        }));

      const result: PromptResponse = {
        response: content,
        duration: Date.now() - startTime,
        toolCalls,
        filesModified,
        usage: data.usage ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      };

      logger.info('OpenCode completed prompt', {
        duration: result.duration,
        tokens: result.usage?.totalTokens,
      });

      return result;
    } catch (error: any) {
      logger.error('OpenCode prompt failed', { error: error.message });
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
    const response = await this.prompt({
      message: `Use the ${operation} tool to ${operation} the file ${filePath}${content ? ' with content' : ''}${search ? ` by searching for "${search}" and replacing with "${replace}"` : ''}`,
      timeout: 60000,
    });

    return response.response;
  }

  /**
   * Execute a shell command
   */
  async executeCommand(command: string, cwd?: string): Promise<string> {
    const response = await this.prompt({
      message: `Use the shell tool to execute: ${command}${cwd ? ` in directory ${cwd}` : ''}`,
      timeout: 120000,
    });

    return response.response;
  }

  /**
   * Search for files
   */
  async searchFiles(pattern: string, path?: string): Promise<string> {
    const response = await this.prompt({
      message: `Use the glob tool to search for files matching: ${pattern}${path ? ` in directory ${path}` : ''}`,
      timeout: 60000,
    });

    return response.response;
  }

  /**
   * Search for text in files
   */
  async searchText(pattern: string, path?: string): Promise<string> {
    const response = await this.prompt({
      message: `Use the grep tool to search for pattern: ${pattern}${path ? ` in directory ${path}` : ''}`,
      timeout: 60000,
    });

    return response.response;
  }

  /**
   * Get session messages
   */
  getSessionMessages(): OpenCodeMessage[] {
    return [...this.sessionMessages];
  }

  /**
   * Get session ID
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /**
   * Clear session history
   */
  clearSession(): void {
    this.sessionMessages = [];
    logger.debug('OpenCode session cleared', { sessionId: this.sessionId });
  }

  /**
   * Fork current session
   */
  async forkSession(title?: string): Promise<string> {
    if (!this.sessionId) {
      throw new Error('No active session to fork');
    }

    const newSessionId = await this.createSession(title);
    
    // Copy messages from parent session
    this.sessionMessages = [...this.sessionMessages];

    logger.info('Session forked', {
      parentSession: this.sessionId,
      newSession: newSessionId,
    });

    return newSessionId;
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

  /**
   * Get git diff for current session
   */
  async getGitDiff(): Promise<string> {
    const response = await this.prompt({
      message: 'Show me the git diff for changes made in this session',
      timeout: 60000,
    });

    return response.response;
  }

  /**
   * Revert to a specific message
   */
  async revertToMessage(messageId: string): Promise<void> {
    if (!this.agent || !this.sessionId) {
      throw new Error('OpenCode agent not started or no session');
    }

    try {
      await fetch(`${this.agent.apiUrl}/message/${messageId}/revert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          session_id: this.sessionId,
        }),
      });

      logger.debug('Reverted to message', { messageId });
    } catch (error: any) {
      logger.error('Failed to revert message', { error: error.message });
      throw error;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createOpenCodeAgent(
  config: OpenCodeConfig
): Promise<OpenCodeAgent> {
  const agent = new OpenCodeAgent(config);
  await agent.start();
  return agent;
}

export default OpenCodeAgent;
