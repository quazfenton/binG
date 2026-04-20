/**
 * OpenAI Agent Base — Shared logic for OpenAI-based coding agents
 *
 * Provides the common start/stop/prompt/subscribe lifecycle used by both
 * AmpAgent and CodexAgent. Subclasses only need to supply their own
 * binary finder, tool definitions, default config values, and the
 * role used for user prompts.
 *
 * @see amp-agent.ts
 * @see codex-agent.ts
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { createLogger } from '../utils/logger';
import { waitForLocalServer, spawnLocalAgent, connectToRemoteAgent } from './local-server-utils';
import type { AgentInstance, PromptRequest, PromptResponse, AgentEvent } from './agent-service-manager';

// ============================================================================
// Types
// ============================================================================

export interface OpenAIAgentTool {
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

/**
 * Minimal message shape required by the base class.
 * Concrete agents extend this with their own content types.
 */
export interface OpenAIAgentMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string | unknown[];
}

export interface OpenAIAgentConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Workspace directory */
  workspaceDir: string;
  /** Model identifier */
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
  /**
   * Remote address of an already-running agent server (e.g. "https://codex.example.com:8080").
   * When set, the agent skips local binary spawn AND containerized fallback, and
   * connects directly to the remote endpoint. This supports web-hosted / cloud
   * deployments where the CLI agent runs on a remote server.
   */
  remoteAddress?: string;
}

/** Parameters a subclass must provide to the base constructor */
export interface OpenAIAgentDescriptor {
  /** Agent type string used in AgentInstance and logs */
  agentType: string;
  /** Logger label */
  loggerLabel: string;
  /** Default model name */
  defaultModel: string;
  /** Default port */
  defaultPort: number;
  /** Spawn arguments for the local binary (e.g. ['serve', '--port', '…']) */
  spawnArgs: (port: number) => string[];
  /** Find the local binary (sync). Returns null if not found. */
  findBinary: () => string | null;
  /** Built-in tools record */
  tools: Record<string, OpenAIAgentTool>;
  /** Message role for user prompts ('user' | 'developer') */
  promptRole: 'user' | 'developer';
  /** Environment variable prefix (e.g. 'OPENAI') */
  envPrefix: string;
}

// ============================================================================
// OpenAI Agent Base
// ============================================================================

export abstract class OpenAIAgentBase<
  TConfig extends OpenAIAgentConfig,
  TMessage extends OpenAIAgentMessage = OpenAIAgentMessage,
  TTool extends OpenAIAgentTool = OpenAIAgentTool,
> extends EventEmitter {
  protected config: TConfig;
  protected agent?: AgentInstance;
  protected localProcess?: ChildProcess;
  protected localPort?: number;
  protected sessionMessages: TMessage[] = [];

  /** Descriptor supplied by the concrete subclass via constructor */
  protected readonly desc: OpenAIAgentDescriptor;

  private _logger: ReturnType<typeof createLogger> | null = null;

  protected get logger() {
    if (!this._logger) {
      this._logger = createLogger(this.desc.loggerLabel);
    }
    return this._logger;
  }

  constructor(desc: OpenAIAgentDescriptor, config: TConfig) {
    super();
    this.desc = desc;
    this.config = {
      model: config.model || desc.defaultModel,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
      ...config,
    } as TConfig;
  }

  /**
   * Start the agent.
   * Prefers a local binary (found via desc.findBinary) and spawns it as a
   * subprocess. Falls back to containerized mode via the agent-service-manager
   * when no local binary is available.
   */
  async start(): Promise<void> {
    const desc = this.desc;
    const log = this.logger;

    log.info(`Starting ${desc.agentType} agent`, {
      model: this.config.model,
      workspace: this.config.workspaceDir,
      remoteAddress: this.config.remoteAddress || undefined,
    });

    // 0. If a remote address is configured, connect directly — no local spawn or container needed
    if (this.config.remoteAddress) {
      this.agent = await connectToRemoteAgent({
        remoteAddress: this.config.remoteAddress,
        agentType: desc.agentType,
        agentId: this.config.agentId,
        workspaceDir: this.config.workspaceDir,
      });
      return;
    }

    // 1. Try to find and spawn a local binary
    const binary = desc.findBinary();
    if (binary) {
      try {
        this.localPort = this.config.port || desc.defaultPort;

        log.info(`Spawning local ${desc.agentType} binary`, { binary, port: this.localPort });

        const envPrefix = desc.envPrefix;

        this.localProcess = spawnLocalAgent(
          binary,
          desc.spawnArgs(this.localPort),
          {
            cwd: this.config.workspaceDir,
            label: desc.agentType,
            env: {
              [`${envPrefix}_API_KEY`]: this.config.apiKey,
              [`${envPrefix}_MODEL`]: this.config.model,
              [`${envPrefix}_MAX_TOKENS`]: String(this.config.maxTokens),
              [`${envPrefix}_TEMPERATURE`]: String(this.config.temperature),
              ...(this.config.systemPrompt ? { [`${envPrefix}_SYSTEM_PROMPT`]: this.config.systemPrompt } : {}),
            },
            onExit: () => { this.localProcess = undefined; },
            onError: () => { this.localProcess = undefined; },
          },
        );

        // Create a synthetic AgentInstance pointing to the local subprocess
        this.agent = {
          agentId: this.config.agentId || `${desc.agentType}-local-${Date.now()}`,
          type: desc.agentType as any,
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

        log.info(`${desc.agentType} agent started (local binary)`, {
          agentId: this.agent.agentId,
          apiUrl: this.agent.apiUrl,
        });
        return;
      } catch (err: any) {
        log.warn(`Local ${desc.agentType} binary spawn failed, falling back to containerized mode`, {
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
    log.info(`No local ${desc.agentType} binary found, using containerized mode`);
    const { getAgentServiceManager } = await import('./agent-service-manager');
    const manager = getAgentServiceManager();
    const envPrefix = desc.envPrefix;

    this.agent = await manager.startAgent({
      type: desc.agentType as any,
      agentId: this.config.agentId,
      workspaceDir: this.config.workspaceDir,
      apiKey: this.config.apiKey,
      port: this.config.port,
      env: {
        [`${envPrefix}_MODEL`]: this.config.model,
        [`${envPrefix}_MAX_TOKENS`]: String(this.config.maxTokens),
        [`${envPrefix}_TEMPERATURE`]: String(this.config.temperature),
        ...(this.config.systemPrompt ? { [`${envPrefix}_SYSTEM_PROMPT`]: this.config.systemPrompt } : {}),
      },
    });

    log.info(`${desc.agentType} agent started (containerized)`, {
      agentId: this.agent.agentId,
      apiUrl: this.agent.apiUrl,
    });
  }

  /**
   * Stop the agent (kills local subprocess or stops containerized agent)
   */
  async stop(): Promise<void> {
    const desc = this.desc;

    // Stop local subprocess first
    if (this.localProcess) {
      this.logger.info(`Stopping local ${desc.agentType} subprocess`, { pid: this.localProcess.pid });
      this.localProcess.kill();
      this.localProcess = undefined;
      this.localPort = undefined;
    }

    if (!this.agent) {
      return;
    }

    this.logger.info(`Stopping ${desc.agentType} agent`, { agentId: this.agent.agentId });

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
      throw new Error(`${this.desc.agentType} agent not started`);
    }

    const desc = this.desc;

    this.logger.debug(`Sending prompt to ${desc.agentType}`, {
      messageLength: request.message.length,
    });

    // Add user/developer message to session
    this.sessionMessages.push({
      role: desc.promptRole,
      content: request.message,
    } as TMessage);

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
          tools: Object.values(desc.tools),
          stream: request.stream,
        }),
        signal: AbortSignal.timeout(request.timeout || 300000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${desc.agentType} API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // Extract response
      const content = data.choices?.[0]?.message?.content || '';

      // Add assistant response to session
      this.sessionMessages.push({
        role: 'assistant',
        content: content,
      } as TMessage);

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

      this.logger.info(`${desc.agentType} completed prompt`, {
        duration: result.duration,
        tokens: result.usage?.totalTokens,
      });

      return result;
    } catch (error: any) {
      this.logger.error(`${desc.agentType} prompt failed`, { error: error.message });
      throw error;
    }
  }

  /**
   * Extract file changes from tool calls
   */
  protected extractFileChanges(toolCalls?: any[]): Array<{ path: string; action: 'create' | 'delete' | 'modify'; diff?: string }> {
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
  getSessionMessages(): TMessage[] {
    return [...this.sessionMessages];
  }

  /**
   * Clear session history
   */
  clearSession(): void {
    this.sessionMessages = [];
    this.logger.debug(`${this.desc.agentType} session cleared`);
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
