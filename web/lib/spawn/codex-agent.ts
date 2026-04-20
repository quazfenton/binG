/**
 * Codex Agent Service (OpenAI Codex CLI)
 *
 * Containerized OpenAI Codex implementation for coding tasks.
 * Provides:
 * - Code generation and completion
 * - Code review and refactoring
 * - Test generation
 * - Documentation writing
 *
 * @see https://github.com/openai/codex
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { createLogger } from '../utils/logger';
import { findCodexBinarySync } from '@/lib/agent-bins/find-codex-binary';
import { waitForLocalServer, spawnLocalAgent } from './local-server-utils';
import type { AgentInstance, PromptRequest, PromptResponse, AgentEvent } from './agent-service-manager';

const logger = createLogger('Agents:Codex');

// ============================================================================
// Types
// ============================================================================

export interface CodexConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Workspace directory */
  workspaceDir: string;
  /** Model to use (default: codex-1) */
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
}

export interface CodexMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
    text?: string;
    image_url?: { url: string; detail?: string };
    tool_use_id?: string;
    name?: string;
    input?: any;
    content?: any;
  }>;
}

export interface CodexTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

// Built-in Codex tools
export const CODEX_TOOLS: Record<string, CodexTool> = {
  'read_file': {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
  },
  'write_file': {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  'edit_file': {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Apply edits to a file using unified diff format',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          diff: { type: 'string', description: 'Unified diff to apply' },
        },
        required: ['path', 'diff'],
      },
    },
  },
  'run_command': {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['command'],
      },
    },
  },
  'search_code': {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search codebase for patterns',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex supported)' },
          path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['pattern'],
      },
    },
  },
};

// ============================================================================
// Codex Agent Service
// ============================================================================

export class CodexAgent extends EventEmitter {
  private config: CodexConfig;
  private agent?: AgentInstance;
  private localProcess?: ChildProcess;
  private localPort?: number;
  private sessionMessages: CodexMessage[] = [];

  constructor(config: CodexConfig) {
    super();
    this.config = {
      model: config.model || 'codex-1',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
      ...config,
    };
  }

  /**
   * Start the Codex agent.
   * Prefers a local `codex` binary (found via findCodexBinarySync) and
   * spawns it as a subprocess. Falls back to containerized mode via the
   * agent-service-manager when no local binary is available.
   */
  async start(): Promise<void> {
    logger.info('Starting Codex agent', {
      model: this.config.model,
      workspace: this.config.workspaceDir,
    });

    // 1. Try to find and spawn a local codex binary
    const codexBin = findCodexBinarySync();
    if (codexBin) {
      try {
        this.localPort = this.config.port || 5000;

        logger.info('Spawning local codex binary', { binary: codexBin, port: this.localPort });

        this.localProcess = spawnLocalAgent(
          codexBin,
          ['serve', '--port', String(this.localPort)],
          {
            cwd: this.config.workspaceDir,
            label: 'codex',
            env: {
              OPENAI_API_KEY: this.config.apiKey,
              OPENAI_MODEL: this.config.model,
              OPENAI_MAX_TOKENS: String(this.config.maxTokens),
              OPENAI_TEMPERATURE: String(this.config.temperature),
              ...(this.config.systemPrompt ? { OPENAI_SYSTEM_PROMPT: this.config.systemPrompt } : {}),
            },
            onExit: () => { this.localProcess = undefined; },
            onError: () => { this.localProcess = undefined; },
          },
        );

        // Create a synthetic AgentInstance pointing to the local subprocess
        this.agent = {
          agentId: this.config.agentId || `codex-local-${Date.now()}`,
          type: 'codex',
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

        logger.info('Codex agent started (local binary)', {
          agentId: this.agent.agentId,
          apiUrl: this.agent.apiUrl,
        });
        return;
      } catch (err: any) {
        logger.warn('Local codex binary spawn failed, falling back to containerized mode', {
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
    logger.info('No local codex binary found, using containerized mode');
    const { getAgentServiceManager } = await import('./agent-service-manager');
    const manager = getAgentServiceManager();

    this.agent = await manager.startAgent({
      type: 'codex',
      agentId: this.config.agentId,
      workspaceDir: this.config.workspaceDir,
      apiKey: this.config.apiKey,
      port: this.config.port,
      env: {
        'OPENAI_MODEL': this.config.model,
        'OPENAI_MAX_TOKENS': String(this.config.maxTokens),
        'OPENAI_TEMPERATURE': String(this.config.temperature),
        ...(this.config.systemPrompt ? { 'OPENAI_SYSTEM_PROMPT': this.config.systemPrompt } : {}),
      },
    });

    logger.info('Codex agent started (containerized)', {
      agentId: this.agent.agentId,
      apiUrl: this.agent.apiUrl,
    });
  }

  /**
   * Stop the agent (kills local subprocess or stops containerized agent)
   */
  async stop(): Promise<void> {
    // Stop local subprocess first
    if (this.localProcess) {
      logger.info('Stopping local codex subprocess', { pid: this.localProcess.pid });
      this.localProcess.kill();
      this.localProcess = undefined;
      this.localPort = undefined;
    }

    if (!this.agent) {
      return;
    }

    logger.info('Stopping Codex agent', { agentId: this.agent.agentId });

    // Only stop via service manager for containerized agents
    if (this.agent.containerId) {
      const { getAgentServiceManager } = await import('./agent-service-manager');
      const manager = getAgentServiceManager();
      await manager.stopAgent(this.agent.agentId);
    }

    this.agent = undefined;
    this.sessionMessages = [];
  }

  /**
   * Send a prompt and get response
   */
  async prompt(request: PromptRequest): Promise<PromptResponse> {
    if (!this.agent) {
      throw new Error('Codex agent not started');
    }

    logger.debug('Sending prompt to Codex', {
      messageLength: request.message.length,
    });

    // Add user message to session
    this.sessionMessages.push({
      role: 'user',
      content: request.message,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.agent.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          messages: this.sessionMessages,
          tools: Object.values(CODEX_TOOLS),
          stream: request.stream,
        }),
        signal: AbortSignal.timeout(request.timeout || 300000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Codex API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // Extract response
      const content = data.choices?.[0]?.message?.content || '';
      
      // Add assistant response to session
      this.sessionMessages.push({
        role: 'assistant',
        content: content,
      });

      // Extract tool calls
      const toolCalls = data.choices?.[0]?.message?.tool_calls?.map((tc: any) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      const result: PromptResponse = {
        response: content,
        reasoning: data.choices?.[0]?.message?.reasoning_content,
        duration: Date.now() - startTime,
        toolCalls,
        filesModified: this.extractFileChanges(toolCalls),
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      };

      logger.info('Codex completed prompt', {
        duration: result.duration,
        tokens: result.usage?.totalTokens,
      });

      return result;
    } catch (error: any) {
      logger.error('Codex prompt failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract file changes from tool calls
   */
  private extractFileChanges(toolCalls?: any[]): Array<{ path: string; action: 'create' | 'delete' | 'modify'; diff?: string }> {
    if (!toolCalls) return [];

    return toolCalls
      .filter(tc => ['write_file', 'edit_file'].includes(tc.name))
      .map(tc => ({
        path: tc.arguments.path,
        action: tc.name === 'write_file' ? 'create' as const : 'modify' as const,
        diff: tc.arguments.diff,
      }));
  }

  /**
   * Generate code from description
   */
  async generateCode(description: string, language?: string): Promise<string> {
    const response = await this.prompt({
      message: `Generate code for: ${description}${language ? ` in ${language}` : ''}. Provide only the code, no explanations.`,
      timeout: 120000,
    });

    return response.response;
  }

  /**
   * Review code and provide feedback
   */
  async reviewCode(code: string, filePath?: string): Promise<string> {
    const response = await this.prompt({
      message: `Review this code${filePath ? ` from ${filePath}` : ''} and provide feedback on:\n- Code quality\n- Potential bugs\n- Performance issues\n- Security concerns\n- Best practices\n\nCode:\n${code}`,
      timeout: 120000,
    });

    return response.response;
  }

  /**
   * Generate tests for code
   */
  async generateTests(code: string, framework?: string): Promise<string> {
    const response = await this.prompt({
      message: `Generate comprehensive tests for this code${framework ? ` using ${framework}` : ''}:\n\n${code}`,
      timeout: 120000,
    });

    return response.response;
  }

  /**
   * Refactor code
   */
  async refactorCode(code: string, goal?: string): Promise<string> {
    const response = await this.prompt({
      message: `Refactor this code${goal ? ` to ${goal}` : ''}. Provide only the refactored code:\n\n${code}`,
      timeout: 120000,
    });

    return response.response;
  }

  /**
   * Get session messages
   */
  getSessionMessages(): CodexMessage[] {
    return [...this.sessionMessages];
  }

  /**
   * Clear session history
   */
  clearSession(): void {
    this.sessionMessages = [];
    logger.debug('Codex session cleared');
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

export async function createCodexAgent(config: CodexConfig): Promise<CodexAgent> {
  const agent = new CodexAgent(config);
  await agent.start();
  return agent;
}

export default CodexAgent;
