/**
 * Agent Pool Manager
 * 
 * Pre-warms and manages a pool of AI coding agents for instant availability.
 * Reduces cold-start latency from 30-60s to <1s for common scenarios.
 * 
 * Features:
 * - Pre-warmed agent instances
 * - Automatic health monitoring
 * - Load balancing across instances
 * - Resource-aware scaling
 * - Idle timeout cleanup
 * 
 * @example
 * ```typescript
 * import { getAgentPool } from '@bing/shared/agent/agent-pool';
 * 
 * const pool = getAgentPool('claude-code', {
 *   minSize: 2,
 *   maxSize: 10,
 *   idleTimeout: 300000, // 5 minutes
 * });
 * 
 * // Get agent from pool (instant if pre-warmed)
 * const agent = await pool.acquire();
 * 
 * // Use agent
 * const result = await agent.prompt({ message: 'Refactor this' });
 * 
 * // Return to pool
 * await pool.release(agent);
 * 
 * // Or cleanup
 * await pool.destroy();
 * ```
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger';
import type { AgentInstance } from './agent-service-manager';
import type { ClaudeCodeAgent } from './claude-code-agent';
import type { AmpAgent } from './amp-agent';
import type { OpenCodeAgent } from './opencode-agent';
import type { CodexAgent } from './codex-agent';

const logger = createLogger('Agents:Pool');

// ============================================================================
// Types
// ============================================================================

export type PoolAgentType = 'claude-code' | 'amp' | 'opencode' | 'codex';

export type PoolAgent = ClaudeCodeAgent | AmpAgent | OpenCodeAgent | CodexAgent;

export interface AgentPoolConfig {
  /** Minimum number of pre-warmed agents */
  minSize?: number;
  /** Maximum number of agents */
  maxSize?: number;
  /** Time before idle agents are destroyed (ms) */
  idleTimeout?: number;
  /** Health check interval (ms) */
  healthCheckInterval?: number;
  /** Agent configuration */
  agentConfig: {
    apiKey?: string;
    workspaceDir: string;
    model?: string;
    port?: number;
    env?: Record<string, string>;
  };
}

export interface PoolStats {
  /** Total agents in pool */
  total: number;
  /** Available agents */
  available: number;
  /** In-use agents */
  inUse: number;
  /** Unhealthy agents */
  unhealthy: number;
  /** Average acquire time (ms) */
  avgAcquireTime: number;
  /** Total acquires */
  totalAcquires: number;
  /** Total releases */
  totalReleases: number;
  /** Total timeouts */
  totalTimeouts: number;
}

export interface PooledAgent {
  /** Agent instance */
  agent: PoolAgent;
  /** When agent was created */
  createdAt: number;
  /** When agent was last used */
  lastUsed: number;
  /** Number of times acquired */
  acquireCount: number;
  /** Whether currently in use */
  inUse: boolean;
  /** Health status */
  healthy: boolean;
  /** Instance ID */
  id: string;
}

// ============================================================================
// Agent Pool
// ============================================================================

export class AgentPool extends EventEmitter {
  private type: PoolAgentType;
  private config: Required<AgentPoolConfig>;
  private agents: Map<string, PooledAgent> = new Map();
  private waitQueue: Array<{
    resolve: (agent: PoolAgent) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private healthCheckTimer?: NodeJS.Timeout;
  private stats: {
    totalAcquires: number;
    totalReleases: number;
    totalTimeouts: number;
    acquireTimes: number[];
  } = {
    totalAcquires: 0,
    totalReleases: 0,
    totalTimeouts: 0,
    acquireTimes: [],
  };
  private destroyed: boolean = false;

  constructor(type: PoolAgentType, config: AgentPoolConfig) {
    super();
    this.type = type;
    this.config = {
      minSize: config.minSize || 1,
      maxSize: config.maxSize || 5,
      idleTimeout: config.idleTimeout || 300000, // 5 minutes
      healthCheckInterval: config.healthCheckInterval || 30000, // 30 seconds
      agentConfig: config.agentConfig,
    };

    logger.info(`Creating agent pool: ${type}`, {
      minSize: this.config.minSize,
      maxSize: this.config.maxSize,
      workspace: this.config.agentConfig.workspaceDir,
    });

    // Start health check timer
    this.startHealthChecks();

    // Pre-warm minimum agents
    this.preWarm();
  }

  /**
   * Pre-warm minimum number of agents
   */
  private async preWarm(): Promise<void> {
    const currentSize = this.agents.size;
    const toCreate = Math.max(0, this.config.minSize - currentSize);

    if (toCreate === 0) {
      return;
    }

    logger.info(`Pre-warming ${toCreate} ${this.type} agents`);

    const createPromises: Promise<PooledAgent>[] = [];
    for (let i = 0; i < toCreate; i++) {
      createPromises.push(this.createAgent());
    }

    await Promise.all(createPromises);
    logger.info(`Pre-warmed ${toCreate} ${this.type} agents`);
  }

  /**
   * Create a new agent instance
   */
  private async createAgent(): Promise<PooledAgent> {
    const id = `agent-${this.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    logger.debug(`Creating ${this.type} agent: ${id}`);

    let agent: PoolAgent;

    switch (this.type) {
      case 'claude-code': {
        const { createClaudeCodeAgent } = await import('./claude-code-agent');
        agent = await createClaudeCodeAgent({
          ...this.config.agentConfig,
          agentId: id,
        } as any);
        break;
      }
      case 'amp': {
        const { createAmpAgent } = await import('./amp-agent');
        agent = await createAmpAgent({
          ...this.config.agentConfig,
          agentId: id,
        } as any);
        break;
      }
      case 'opencode': {
        const { createOpenCodeAgent } = await import('./opencode-agent');
        agent = await createOpenCodeAgent({
          ...this.config.agentConfig,
          agentId: id,
        } as any);
        break;
      }
      case 'codex': {
        const { createCodexAgent } = await import('./codex-agent');
        agent = await createCodexAgent({
          ...this.config.agentConfig,
          agentId: id,
        } as any);
        break;
      }
    }

    const pooledAgent: PooledAgent = {
      agent,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      acquireCount: 0,
      inUse: false,
      healthy: true,
      id,
    };

    this.agents.set(id, pooledAgent);
    this.emit('agent:create', { id, type: this.type });

    logger.debug(`Created ${this.type} agent: ${id}`);
    return pooledAgent;
  }

  /**
   * Acquire an agent from the pool
   */
  async acquire(timeout: number = 30000): Promise<PoolAgent> {
    if (this.destroyed) {
      throw new Error('Agent pool has been destroyed');
    }

    const startTime = Date.now();

    // Try to get an available healthy agent
    for (const pooled of Array.from(this.agents.values())) {
      if (!pooled.inUse && pooled.healthy) {
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        pooled.acquireCount++;

        const acquireTime = Date.now() - startTime;
        this.recordAcquireTime(acquireTime);

        logger.debug(`Acquired ${this.type} agent: ${pooled.id}`, {
          acquireTime,
          waitTime: 0,
        });

        this.emit('agent:acquire', { id: pooled.id, type: this.type });
        return pooled.agent;
      }
    }

    // No available agent, try to create one if under max
    if (this.agents.size < this.config.maxSize) {
      try {
        const pooled = await this.createAgent();
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        pooled.acquireCount = 1;

        const acquireTime = Date.now() - startTime;
        this.recordAcquireTime(acquireTime);

        logger.debug(`Created and acquired ${this.type} agent: ${pooled.id}`, {
          acquireTime,
        });

        this.emit('agent:acquire', { id: pooled.id, type: this.type });
        return pooled.agent;
      } catch (error: any) {
        logger.error(`Failed to create ${this.type} agent`, { error: error.message });
      }
    }

    // Pool at capacity, wait for an agent to be released
    logger.debug(`Pool at capacity, waiting for ${this.type} agent`);

    return new Promise<PoolAgent>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove from queue
        const index = this.waitQueue.findIndex(w => w.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
          this.stats.totalTimeouts++;
          reject(new Error(`Timeout waiting for ${this.type} agent`));
        }
      }, timeout);

      this.waitQueue.push({ resolve, reject, timeout: timeoutId });
    });
  }

  /**
   * Release an agent back to the pool
   */
  async release(agent: PoolAgent): Promise<void> {
    // Find the pooled agent
    let pooled: PooledAgent | undefined;
    for (const p of Array.from(this.agents.values())) {
      if (p.agent === agent) {
        pooled = p;
        break;
      }
    }

    if (!pooled) {
      logger.warn('Attempted to release unknown agent');
      return;
    }

    // Check health before releasing
    const healthy = await this.checkAgentHealth(pooled.agent);
    pooled.healthy = healthy;
    pooled.inUse = false;
    pooled.lastUsed = Date.now();

    this.stats.totalReleases++;
    this.emit('agent:release', { id: pooled.id, type: this.type, healthy });

    logger.debug(`Released ${this.type} agent: ${pooled.id}`, { healthy });

    // Notify waiters
    if (this.waitQueue.length > 0 && healthy) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        pooled.inUse = true;
        pooled.acquireCount++;
        waiter.resolve(pooled.agent);
      }
    }
  }

  /**
   * Check agent health
   */
  private async checkAgentHealth(agent: PoolAgent): Promise<boolean> {
    try {
      if ('checkAgentHealth' in agent) {
        return await (agent as any).checkAgentHealth();
      }
      // Fallback: assume healthy if no method
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start health check timer
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.runHealthChecks();
    }, this.config.healthCheckInterval);

    logger.debug(`Started ${this.type} pool health checks every ${this.config.healthCheckInterval}ms`);
  }

  /**
   * Run health checks on all agents
   */
  private async runHealthChecks(): Promise<void> {
    const checkPromises: Promise<void>[] = [];

    for (const pooled of Array.from(this.agents.values())) {
      if (pooled.inUse) {
        continue; // Don't check in-use agents
      }

      checkPromises.push(
        (async () => {
          const healthy = await this.checkAgentHealth(pooled.agent);
          
          if (!healthy && pooled.healthy) {
            logger.warn(`${this.type} agent ${pooled.id} became unhealthy`);
            pooled.healthy = false;
            this.emit('agent:unhealthy', { id: pooled.id, type: this.type });
          } else if (healthy && !pooled.healthy) {
            logger.info(`${this.type} agent ${pooled.id} recovered`);
            pooled.healthy = true;
            this.emit('agent:recovered', { id: pooled.id, type: this.type });
          }
        })()
      );
    }

    await Promise.all(checkPromises);

    // Cleanup unhealthy agents
    await this.cleanupUnhealthyAgents();

    // Cleanup idle agents
    await this.cleanupIdleAgents();

    // Ensure minimum size
    await this.preWarm();
  }

  /**
   * Remove unhealthy agents
   */
  private async cleanupUnhealthyAgents(): Promise<void> {
    const toRemove: string[] = [];

    for (const [id, pooled] of Array.from(this.agents.entries())) {
      if (!pooled.healthy && !pooled.inUse) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const pooled = this.agents.get(id);
      if (pooled) {
        logger.info(`Removing unhealthy ${this.type} agent: ${id}`);
        
        try {
          await pooled.agent.stop();
        } catch (error: any) {
          logger.error(`Failed to stop unhealthy agent ${id}`, { error: error.message });
        }

        this.agents.delete(id);
        this.emit('agent:remove', { id, type: this.type, reason: 'unhealthy' });
      }
    }
  }

  /**
   * Remove idle agents
   */
  private async cleanupIdleAgents(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, pooled] of Array.from(this.agents.entries())) {
      if (
        !pooled.inUse &&
        pooled.healthy && // Only remove healthy idle agents
        (now - pooled.lastUsed) > this.config.idleTimeout &&
        this.agents.size > this.config.minSize
      ) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const pooled = this.agents.get(id);
      if (pooled) {
        logger.info(`Removing idle ${this.type} agent: ${id}`);
        
        try {
          await pooled.agent.stop();
        } catch (error: any) {
          logger.error(`Failed to stop idle agent ${id}`, { error: error.message });
        }

        this.agents.delete(id);
        this.emit('agent:remove', { id, type: this.type, reason: 'idle' });
      }
    }
  }

  /**
   * Record acquire time for stats
   */
  private recordAcquireTime(time: number): void {
    this.stats.totalAcquires++;
    this.stats.acquireTimes.push(time);

    // Keep last 100 times
    if (this.stats.acquireTimes.length > 100) {
      this.stats.acquireTimes.shift();
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const available = Array.from(this.agents.values()).filter(p => !p.inUse && p.healthy).length;
    const inUse = Array.from(this.agents.values()).filter(p => p.inUse).length;
    const unhealthy = Array.from(this.agents.values()).filter(p => !p.healthy).length;

    const avgAcquireTime = this.stats.acquireTimes.length > 0
      ? this.stats.acquireTimes.reduce((a, b) => a + b, 0) / this.stats.acquireTimes.length
      : 0;

    return {
      total: this.agents.size,
      available,
      inUse,
      unhealthy,
      avgAcquireTime,
      totalAcquires: this.stats.totalAcquires,
      totalReleases: this.stats.totalReleases,
      totalTimeouts: this.stats.totalTimeouts,
    };
  }

  /**
   * Destroy the pool and all agents
   */
  async destroy(): Promise<void> {
    logger.info(`Destroying ${this.type} agent pool`);

    this.destroyed = true;

    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    // Reject all waiters
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Agent pool destroyed'));
    }
    this.waitQueue = [];

    // Stop all agents
    const stopPromises: Promise<void>[] = [];
    for (const pooled of Array.from(this.agents.values())) {
      stopPromises.push(
        (async () => {
          try {
            await pooled.agent.stop();
          } catch (error: any) {
            logger.error(`Failed to stop agent ${pooled.id}`, { error: error.message });
          }
        })()
      );
    }

    await Promise.all(stopPromises);
    this.agents.clear();

    this.emit('pool:destroy', { type: this.type });
    logger.info(`${this.type} agent pool destroyed`);
  }
}

// ============================================================================
// Pool Manager
// ============================================================================

const pools = new Map<string, AgentPool>();

/**
 * Get or create an agent pool
 */
export function getAgentPool(type: PoolAgentType, config: AgentPoolConfig): AgentPool {
  const key = `${type}:${config.agentConfig.workspaceDir}`;

  if (!pools.has(key)) {
    pools.set(key, new AgentPool(type, config));
  }

  return pools.get(key)!;
}

/**
 * Destroy all pools
 */
export async function destroyAllPools(): Promise<void> {
  const destroyPromises: Promise<void>[] = [];

  for (const pool of Array.from(pools.values())) {
    destroyPromises.push(pool.destroy());
  }

  await Promise.all(destroyPromises);
  pools.clear();

  logger.info('All agent pools destroyed');
}

/**
 * Get all pool stats
 */
export function getAllPoolStats(): Record<string, PoolStats> {
  const stats: Record<string, PoolStats> = {};

  for (const [key, pool] of Array.from(pools.entries())) {
    stats[key] = pool.getStats();
  }

  return stats;
}

export default AgentPool;
