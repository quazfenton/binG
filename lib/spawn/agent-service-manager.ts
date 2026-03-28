/**
 * Containerized AI Coding Agent Services
 * 
 * Provides remote server implementations for popular AI coding agents:
 * - Claude Code (Anthropic)
 * - Amp (OpenAI Codex successor)
 * - OpenCode CLI Server
 * - Custom agent containers
 * 
 * Each agent runs in an isolated Docker container with:
 * - Persistent sessions
 * - Workspace volume mounting
 * - API endpoint exposure
 * - Health monitoring
 * - Auto-scaling support
 * 
 * @example
 * ```typescript
 * import { AgentServiceManager } from '@/lib/agents/agent-service-manager';
 * 
 * const manager = new AgentServiceManager();
 * 
 * // Start Claude Code agent
 * const claudeAgent = await manager.startAgent({
 *   type: 'claude-code',
 *   workspaceDir: '/workspace/my-project',
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 * 
 * // Send prompt
 * const result = await claudeAgent.prompt({
 *   message: 'Refactor the authentication module',
 *   model: 'claude-sonnet-4-5-20250929',
 * });
 * 
 * // Get streaming events
 * const events = await claudeAgent.subscribe();
 * ```
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger';
import type { ToolResult } from '../sandbox/types';

const logger = createLogger('Agents:ServiceManager');

// ============================================================================
// Types
// ============================================================================

export type AgentType = 
  | 'claude-code'      // Anthropic Claude Code
  | 'amp'              // OpenAI Amp (Codex successor)
  | 'opencode'         // OpenCode CLI server
  | 'custom';          // Custom agent container

export interface AgentConfig {
  /** Agent type */
  type: AgentType;
  /** Unique agent ID (auto-generated if not provided) */
  agentId?: string;
  /** Workspace directory to mount */
  workspaceDir: string;
  /** API key for the agent service */
  apiKey: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Container image (default: agent-specific) */
  image?: string;
  /** Port to expose (default: agent-specific) */
  port?: number;
  /** Container name prefix */
  containerName?: string;
  /** Auto-stop after inactivity (seconds) */
  autoStopTimeout?: number;
  /** Resource limits */
  resources?: {
    cpu?: number;
    memory?: string;
  };
}

export interface AgentInstance {
  /** Agent ID */
  agentId: string;
  /** Agent type */
  type: AgentType;
  /** Container ID */
  containerId: string;
  /** Exposed port */
  port: number;
  /** API endpoint URL */
  apiUrl: string;
  /** Workspace directory */
  workspaceDir: string;
  /** When agent was started */
  startedAt: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Agent status */
  status: 'starting' | 'ready' | 'busy' | 'idle' | 'stopping' | 'error';
  /** Health check status */
  health: 'healthy' | 'unhealthy' | 'unknown';
  /** Error message if failed */
  error?: string;
}

export interface PromptRequest {
  /** Prompt message */
  message: string;
  /** Model to use */
  model?: string;
  /** System prompt override */
  system?: string;
  /** Additional context */
  context?: string[];
  /** Whether to stream responses */
  stream?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

export interface PromptResponse {
  /** Response text */
  response: string;
  /** Reasoning/thought process */
  reasoning?: string;
  /** Tool calls made */
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: any;
  }>;
  /** Files modified */
  filesModified?: Array<{
    path: string;
    action: 'create' | 'modify' | 'delete';
    diff?: string;
  }>;
  /** Execution time in ms */
  duration: number;
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AgentEvent {
  type: 'message' | 'tool_call' | 'file_change' | 'status_change' | 'error';
  agentId: string;
  timestamp: number;
  data: any;
}

// ============================================================================
// Agent Type Configurations
// ============================================================================

const AGENT_DEFAULTS: Record<AgentType, {
  image: string;
  port: number;
  command: string[];
  healthcheck?: string;
}> = {
  'claude-code': {
    image: 'anthropic/claude-code:latest',
    port: 8080,
    command: ['claude', '--server', '--port', '8080', '--host', '0.0.0.0'],
    healthcheck: 'curl -f http://localhost:8080/health || exit 1',
  },
  'amp': {
    image: 'openai/amp:latest',
    port: 3000,
    command: ['amp', 'serve', '--port', '3000'],
    healthcheck: 'curl -f http://localhost:3000/health || exit 1',
  },
  'opencode': {
    image: 'opencode/opencode:latest',
    port: 4096,
    command: ['opencode', 'server', '--port', '4096', '--host', '0.0.0.0'],
    healthcheck: 'curl -f http://localhost:4096/health || exit 1',
  },
  'custom': {
    image: 'custom-agent:latest',
    port: 8000,
    command: [],
  },
};

// ============================================================================
// Agent Service Manager
// ============================================================================

export class AgentServiceManager extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private dockerAvailable: boolean = false;

  constructor() {
    super();
    this.checkDockerAvailability();
  }

  /**
   * Check if Docker is available
   */
  private async checkDockerAvailability(): Promise<void> {
    try {
      // Dynamic import to avoid Docker dependency when not used
      const dockerodeModule = await import('dockerode');
      const Dockerode = (dockerodeModule as any).default || dockerodeModule;
      const docker = new Dockerode();
      await docker.ping();
      this.dockerAvailable = true;
      logger.info('Docker available for agent containers');
    } catch (error) {
      this.dockerAvailable = false;
      logger.warn('Docker not available, agents will use remote API mode', { error });
    }
  }

  /**
   * Start an AI coding agent
   */
  async startAgent(config: AgentConfig): Promise<AgentInstance> {
    const agentId = config.agentId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const defaults = AGENT_DEFAULTS[config.type];
    
    logger.info(`Starting ${config.type} agent: ${agentId}`, {
      workspace: config.workspaceDir,
      port: config.port || defaults.port,
    });

    // Create agent instance record
    const agent: AgentInstance = {
      agentId,
      type: config.type,
      containerId: '',
      port: config.port || defaults.port,
      apiUrl: `http://localhost:${config.port || defaults.port}`,
      workspaceDir: config.workspaceDir,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      status: 'starting',
      health: 'unknown',
    };

    this.agents.set(agentId, agent);

    try {
      if (this.dockerAvailable && !config.image?.includes('://')) {
        // Start Docker container
        await this.startDockerContainer(agent, config, defaults);
      } else {
        // Use remote API mode (agent already running elsewhere)
        agent.status = 'ready';
        agent.health = 'healthy';
        logger.info(`Agent ${agentId} using remote API mode`);
      }

      // Wait for agent to be ready
      await this.waitForAgent(agent);

      logger.info(`Agent ${agentId} is ready`, { apiUrl: agent.apiUrl });
      return agent;
    } catch (error: any) {
      agent.status = 'error';
      agent.error = error.message;
      logger.error(`Failed to start agent ${agentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start Docker container for agent
   */
  private async startDockerContainer(
    agent: AgentInstance,
    config: AgentConfig,
    defaults: typeof AGENT_DEFAULTS[AgentType]
  ): Promise<void> {
    const dockerodeModule = await import('dockerode');
    const Dockerode = (dockerodeModule as any).default || dockerodeModule;
    const docker = new Dockerode();

    const containerName = config.containerName || `agent-${agent.agentId}`;

    // Remove existing container with same name
    try {
      const existingContainer = docker.getContainer(containerName);
      await existingContainer.remove({ force: true });
      logger.debug(`Removed existing container: ${containerName}`);
    } catch {
      // Container doesn't exist, continue
    }

    // Create container configuration
    const containerConfig: any = {
      Image: config.image || defaults.image,
      name: containerName,
      Cmd: defaults.command,
      Env: [
        `${agent.type === 'claude-code' ? 'ANTHROPIC' : agent.type === 'amp' ? 'OPENAI' : 'API'}_KEY=${config.apiKey}`,
        `WORKSPACE_DIR=${config.workspaceDir}`,
        ...Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`),
      ],
      HostConfig: {
        Binds: [
          `${config.workspaceDir}:/workspace`,
        ],
        PortBindings: {
          [`${agent.port}/tcp`]: [{ HostPort: String(agent.port) }],
        },
        // Resource limits
        CpuQuota: config.resources?.cpu ? Math.floor(config.resources.cpu * 100000) : undefined,
        Memory: config.resources?.memory ? this.parseMemory(config.resources.memory) : undefined,
        // Auto-remove on stop
        AutoRemove: true,
      },
      WorkingDir: '/workspace',
      Healthcheck: defaults.healthcheck ? {
        Test: ['CMD-SHELL', defaults.healthcheck],
        Interval: 5000000000, // 5 seconds in nanoseconds
        Timeout: 3000000000,  // 3 seconds
        Retries: 3,
      } : undefined,
    };

    logger.debug(`Creating container: ${containerName}`, { image: containerConfig.Image });

    // Create and start container
    const container = await docker.createContainer(containerConfig);
    agent.containerId = container.id;

    await container.start();
    logger.info(`Container started: ${container.id.slice(0, 12)}`);

    // Monitor container events
    container.wait({ condition: 'not-running' }).then(() => {
      logger.warn(`Agent container stopped: ${agent.agentId}`);
      agent.status = 'stopping';
      this.emit('agent:stop', { agentId: agent.agentId });
    });
  }

  /**
   * Wait for agent to be ready
   */
  private async waitForAgent(agent: AgentInstance, timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 1000;
    const maxAttempts = Math.floor(timeoutMs / pollInterval);

    logger.debug(`Waiting for agent ${agent.agentId} to be ready`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const healthy = await this.checkAgentHealth(agent);
        
        if (healthy) {
          agent.status = 'ready';
          agent.health = 'healthy';
          logger.info(`Agent ${agent.agentId} is ready after ${attempt} attempts`);
          return;
        }
      } catch (error: any) {
        logger.debug(`Health check attempt ${attempt} failed: ${error.message}`);
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`Agent ${agent.agentId} did not become ready within ${timeoutMs}ms`);
  }

  /**
   * Check agent health
   */
  async checkAgentHealth(agent: AgentInstance): Promise<boolean> {
    try {
      const response = await fetch(`${agent.apiUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send prompt to agent
   */
  async prompt(agentId: string, request: PromptRequest): Promise<PromptResponse> {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status === 'error') {
      throw new Error(`Agent ${agentId} is in error state: ${agent.error}`);
    }

    logger.info(`Sending prompt to agent ${agentId}`, { 
      messageLength: request.message.length,
      model: request.model,
    });

    agent.status = 'busy';
    agent.lastActivity = Date.now();

    const startTime = Date.now();
    const timeout = request.timeout || 300000; // 5 minutes default

    try {
      const response = await fetch(`${agent.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: request.message,
            },
          ],
          model: request.model,
          stream: request.stream,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Agent API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      const result: PromptResponse = {
        response: data.choices?.[0]?.message?.content || '',
        duration: Date.now() - startTime,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      };

      // Extract reasoning if present
      if (data.choices?.[0]?.message?.reasoning) {
        result.reasoning = data.choices[0].message.reasoning;
      }

      logger.info(`Agent ${agentId} completed prompt in ${result.duration}ms`);
      
      agent.status = 'idle';
      return result;
    } catch (error: any) {
      logger.error(`Agent ${agentId} prompt failed: ${error.message}`);
      agent.status = 'error';
      agent.error = error.message;
      throw error;
    }
  }

  /**
   * Subscribe to agent events (SSE)
   */
  async subscribe(agentId: string): Promise<AsyncGenerator<AgentEvent>> {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    logger.debug(`Subscribing to agent ${agentId} events`);

    const response = await fetch(`${agent.apiUrl}/events`, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to subscribe to agent events: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const stream = {
      async next() {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            return { done: true, value: undefined };
          }

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                return {
                  done: false,
                  value: {
                    type: data.type || 'message',
                    agentId,
                    timestamp: Date.now(),
                    data,
                  } as AgentEvent,
                };
              } catch (error) {
                logger.debug(`Failed to parse event: ${error}`);
              }
            }
          }
        }
      },

      async return() {
        reader.releaseLock();
        return { done: true, value: undefined };
      },

      async throw(error?: any) {
        reader.releaseLock();
        throw error;
      },

      async [Symbol.asyncDispose]() {
        reader.releaseLock();
      },

      [Symbol.asyncIterator]() {
        return this;
      },
    } as AsyncGenerator<AgentEvent>;

    return stream;
  }

  /**
   * Stop an agent
   */
  async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      logger.warn(`Agent ${agentId} not found, cannot stop`);
      return;
    }

    logger.info(`Stopping agent ${agentId}`);
    agent.status = 'stopping';

    try {
      if (agent.containerId && this.dockerAvailable) {
        const dockerodeModule = await import('dockerode');
        const Dockerode = (dockerodeModule as any).default || dockerodeModule;
        const docker = new (Dockerode as any)();
        const container = docker.getContainer(agent.containerId);
        // Cast to any to bypass TypeScript strict typing for dockerode options
        await (container as any).stop({ timeout: 10 });
        logger.info(`Agent container stopped: ${agent.containerId.slice(0, 12)}`);
      }

      this.agents.delete(agentId);
      this.emit('agent:stop', { agentId });
    } catch (error: any) {
      logger.error(`Failed to stop agent ${agentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all agents
   */
  listAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Clean up idle agents
   */
  async cleanupIdleAgents(maxIdleTime: number = 3600000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [agentId, agent] of Array.from(this.agents.entries())) {
      if (agent.status === 'idle' && (now - agent.lastActivity) > maxIdleTime) {
        logger.info(`Cleaning up idle agent: ${agentId} (idle for ${now - agent.lastActivity}ms)`);
        await this.stopAgent(agentId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Parse memory string to bytes
   */
  private parseMemory(memory: string): number {
    const units: Record<string, number> = {
      'b': 1,
      'k': 1024,
      'm': 1024 * 1024,
      'g': 1024 * 1024 * 1024,
    };
    
    const match = memory.match(/^(\d+)([bkmg])?$/i);
    if (!match) {
      return 512 * 1024 * 1024; // Default 512MB
    }

    const value = parseInt(match[1]);
    const unit = (match[2] || 'm').toLowerCase();
    return value * units[unit];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let agentServiceManagerInstance: AgentServiceManager | null = null;

export function getAgentServiceManager(): AgentServiceManager {
  if (!agentServiceManagerInstance) {
    agentServiceManagerInstance = new AgentServiceManager();
  }
  return agentServiceManagerInstance;
}

export function resetAgentServiceManager(): void {
  agentServiceManagerInstance = null;
}
