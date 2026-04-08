/**
 * Cloud Agent Spawner
 * 
 * Spawns serverless OpenCode instances in cloud sandboxes:
 * - E2B: Creates sandbox with OpenCode CLI
 * - Daytona: Creates workspace with OpenCode
 * 
 * Use cases:
 * - Large refactoring tasks → spawn cloud OpenCode
 * - Parallel tasks → multiple OpenCode instances
 * - Heavy compute → E2B AMP agent
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    CloudAgentSpawner                           │
 * │  ┌─────────────────────────────────────────────────────┐  │
 * │  │  Agent Pool Manager                                   │  │
 * │  │  - Active agents                                     │  │
 * │  │  - Resource tracking                                  │  │
 * │  │  - Auto-scaling                                      │  │
 * │  └─────────────────────────────────────────────────────┘  │
 * │           │                      │                        │
 * │           ▼                      ▼                        │
 * │  ┌──────────────┐      ┌──────────────────┐             │
 * │  │   E2B        │      │    Daytona        │             │
 * │  │  OpenCode    │      │   OpenCode       │             │
 * │  │  Sandbox     │      │   Workspace      │             │
 * │  └──────────────┘      └──────────────────┘             │
 * └─────────────────────────────────────────────────────────────┘
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@/lib/utils/logger';
import { getSandboxProvider, type SandboxProviderType } from '../providers';
import { sandboxBridge } from '../sandbox-service-bridge';
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync';

const logger = createLogger('CloudAgent:Spawner');

export interface CloudAgentConfig {
  provider: 'e2b' | 'daytona';
  model?: string;
  systemPrompt?: string;
  maxSteps?: number;
  timeout?: number;
  userId?: string;
}

export interface CloudAgentInstance {
  id: string;
  provider: 'e2b' | 'daytona';
  sandboxId: string;
  workspaceUrl: string;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
  createdAt: number;
  lastActivity: number;
  resources: {
    cpu: number;
    memory: number;
  };
}

export interface SpawnResult {
  success: boolean;
  agent?: CloudAgentInstance;
  error?: string;
  metadata?: {
    spawnTime: number;
    cost?: number;
  };
}

interface AgentMetrics {
  totalSteps: number;
  totalBashCommands: number;
  totalCost: number;
  uptime: number;
  lastActivity: number;
}

const DEFAULT_CONFIG = {
  maxAgents: 10,
  idleTimeout: 30 * 60 * 1000, // 30 minutes
  maxUptime: 60 * 60 * 1000, // 1 hour
};

class CloudAgentSpawner {
  private agents = new Map<string, CloudAgentInstance>();
  private agentMetrics = new Map<string, AgentMetrics>();
  private config = DEFAULT_CONFIG;

  /**
   * Spawn a new OpenCode agent in the cloud
   */
  async spawnAgent(config: CloudAgentConfig): Promise<SpawnResult> {
    const startTime = Date.now();
    const agentId = `agent-${uuidv4()}`;

    logger.info(`Spawning cloud OpenCode agent: ${agentId} on ${config.provider}`);

    try {
      const providerType = config.provider === 'e2b' ? 'e2b' : 'daytona';
      const provider = await getSandboxProvider(providerType);

      // Create sandbox
      const handle = await provider.createSandbox({
        language: 'typescript',
        envVars: {
          OPENCODE_MODEL: config.model || process.env.OPENCODE_MODEL || 'claude-3-5-sonnet',
          OPENCODE_SYSTEM_PROMPT: config.systemPrompt || 'You are an expert software engineer.',
          TERM: 'xterm-256color',
        },
        resources: {
          cpu: 2,
          memory: 4,
        },
      });

      // Install OpenCode in sandbox
      await handle.executeCommand(
        'npm install -g opencode-ai 2>/dev/null || echo "OpenCode installation attempted"'
      );

      // Get workspace URL
      let workspaceUrl = '';
      try {
        const preview = await handle.getPreviewLink?.(22);
        workspaceUrl = preview?.url || `ssh://${handle.id}`;
      } catch {
        workspaceUrl = `sandbox://${handle.id}`;
      }

      const agent: CloudAgentInstance = {
        id: agentId,
        provider: config.provider,
        sandboxId: handle.id,
        workspaceUrl,
        status: 'ready',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        resources: {
          cpu: 2,
          memory: 4,
        },
      };

      this.agents.set(agentId, agent);
      this.agentMetrics.set(agentId, {
        totalSteps: 0,
        totalBashCommands: 0,
        totalCost: 0,
        uptime: 0,
        lastActivity: Date.now(),
      });

      logger.info(`Cloud agent spawned: ${agentId}, sandbox: ${handle.id}`);

      // Start VFS sync for bidirectional file sync between VFS database and sandbox
      try {
        const userId = config.userId || agentId;
        sandboxFilesystemSync.startSync(handle.id, userId);
        logger.info(`VFS sync started for cloud agent: ${handle.id}`);
      } catch (syncErr: any) {
        logger.warn(`Failed to start VFS sync for cloud agent:`, syncErr.message);
      }

      return {
        success: true,
        agent,
        metadata: {
          spawnTime: Date.now() - startTime,
        },
      };

    } catch (error: any) {
      logger.error(`Failed to spawn agent: ${agentId}`, error);
      return {
        success: false,
        error: error.message || 'Failed to spawn agent',
        metadata: {
          spawnTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): CloudAgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all active agents
   */
  getActiveAgents(): CloudAgentInstance[] {
    return Array.from(this.agents.values()).filter(
      a => a.status === 'ready' || a.status === 'running'
    );
  }

  /**
   * Execute task on agent
   */
  async executeOnAgent(
    agentId: string,
    task: string,
    tools?: Array<{ name: string; description: string; parameters: any }>
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    if (agent.status !== 'ready' && agent.status !== 'running') {
      return { success: false, error: `Agent status is ${agent.status}` };
    }

    try {
      const providerType = agent.provider === 'e2b' ? 'e2b' : 'daytona';
      const provider = await getSandboxProvider(providerType);
      const handle = await provider.getSandbox(agent.sandboxId);

      // Prepare task payload
      const payload = JSON.stringify({
        prompt: task,
        tools: tools || [],
      });

      // Write task to file
      await handle.writeFile('/tmp/task.json', payload);

      // Execute OpenCode
      const result = await handle.executeCommand(
        `cat /tmp/task.json | opencode chat --json --model ${process.env.OPENCODE_MODEL || 'claude-3-5-sonnet'}`,
        '/home/user',
        300 // 5 minute timeout
      );

      // Update metrics
      const metrics = this.agentMetrics.get(agentId);
      if (metrics) {
        metrics.totalSteps++;
        metrics.lastActivity = Date.now();
      }

      agent.lastActivity = Date.now();
      agent.status = 'running';

      return {
        success: result.success,
        output: result.output,
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Stop agent
   */
  async stopAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    try {
      const providerType = agent.provider === 'e2b' ? 'e2b' : 'daytona';
      const provider = await getSandboxProvider(providerType);
      await provider.destroySandbox(agent.sandboxId);

      agent.status = 'stopped';
      this.agents.delete(agentId);
      this.agentMetrics.delete(agentId);

      logger.info(`Agent stopped: ${agentId}`);

      return { success: true };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop all idle agents
   */
  async cleanupIdleAgents(): Promise<number> {
    const now = Date.now();
    let stopped = 0;

    for (const [agentId, agent] of this.agents.entries()) {
      if (now - agent.lastActivity > this.config.idleTimeout) {
        const result = await this.stopAgent(agentId);
        if (result.success) {
          stopped++;
        }
      }
    }

    return stopped;
  }

  /**
   * Get agent statistics
   */
  getStats(): {
    totalAgents: number;
    activeAgents: number;
    byProvider: Record<string, number>;
  } {
    const byProvider: Record<string, number> = {
      e2b: 0,
      daytona: 0,
    };

    let active = 0;
    for (const agent of this.agents.values()) {
      if (agent.status === 'ready' || agent.status === 'running') {
        active++;
        byProvider[agent.provider]++;
      }
    }

    return {
      totalAgents: this.agents.size,
      activeAgents: active,
      byProvider,
    };
  }
}

export const cloudAgentSpawner = new CloudAgentSpawner();
