/**
 * Amp Agent Service (OpenAI Codex Successor)
 * 
 * Containerized OpenAI Amp implementation for advanced coding tasks.
 * Provides:
 * - Code generation and completion
 * - Code review and refactoring
 * - Test generation
 * - Documentation writing
 * 
 * @see https://platform.openai.com/docs/amp
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger';
import type { AgentInstance, PromptRequest, PromptResponse, AgentEvent } from './agent-service-manager';

const logger = createLogger('Agents:Amp');

// ============================================================================
// Types
// ============================================================================

export interface AmpConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Workspace directory */
  workspaceDir: string;
  /** Model to use (default: amp-coder-1) */
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

export interface AmpMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string | Array<{
    type: 'text' | 'image_url' | 'input_audio' | 'output_audio';
    text?: string;
    image_url?: { url: string; detail?: string };
    input_audio?: { data: string; format: 'wav' | 'mp3' };
    output_audio?: { format: 'pcm16' };
  }>;
}

export interface AmpTool {
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

// Built-in Amp tools
export const AMP_TOOLS: Record<string, AmpTool> = {
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
// Amp Agent Service
// ============================================================================

export class AmpAgent extends EventEmitter {
  private config: AmpConfig;
  private agent?: AgentInstance;
  private sessionMessages: AmpMessage[] = [];

  constructor(config: AmpConfig) {
    super();
    this.config = {
      model: config.model || 'amp-coder-1',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
      ...config,
    };
  }

  /**
   * Start the Amp agent
   */
  async start(): Promise<void> {
    logger.info('Starting Amp agent', {
      model: this.config.model,
      workspace: this.config.workspaceDir,
    });

    const { getAgentServiceManager } = await import('./agent-service-manager');
    const manager = getAgentServiceManager();

    this.agent = await manager.startAgent({
      type: 'amp',
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

    logger.info('Amp agent started', {
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

    logger.info('Stopping Amp agent', { agentId: this.agent.agentId });

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
      throw new Error('Amp agent not started');
    }

    logger.debug('Sending prompt to Amp', {
      messageLength: request.message.length,
    });

    // Add developer message (Amp-specific role for instructions)
    this.sessionMessages.push({
      role: 'developer',
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
          tools: Object.values(AMP_TOOLS),
          stream: request.stream,
        }),
        signal: AbortSignal.timeout(request.timeout || 300000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Amp API error: ${response.status} ${errorText}`);
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

      logger.info('Amp completed prompt', {
        duration: result.duration,
        tokens: result.usage?.totalTokens,
      });

      return result;
    } catch (error: any) {
      logger.error('Amp prompt failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract file changes from tool calls
   */
  private extractFileChanges(toolCalls?: any[]): Array<{ path: string; action: string; diff?: string }> {
    if (!toolCalls) return [];

    return toolCalls
      .filter(tc => ['write_file', 'edit_file'].includes(tc.name))
      .map(tc => ({
        path: tc.arguments.path,
        action: tc.name === 'write_file' ? 'create' : 'modify',
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
  getSessionMessages(): AmpMessage[] {
    return [...this.sessionMessages];
  }

  /**
   * Clear session history
   */
  clearSession(): void {
    this.sessionMessages = [];
    logger.debug('Amp session cleared');
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

export async function createAmpAgent(config: AmpConfig): Promise<AmpAgent> {
  const agent = new AmpAgent(config);
  await agent.start();
  return agent;
}

export default AmpAgent;
