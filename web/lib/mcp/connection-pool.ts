/**
 * MCP Connection Pool
 * 
 * Manages pooled connections to MCP servers for better performance and resource utilization
 * Implements connection reuse, health checking, and automatic cleanup
 */

import { MCPClient } from './client';
import type { MCPTransportConfig } from './types';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('MCP:ConnectionPool');

export interface PoolConfig {
  minConnections: number;
  maxConnections: number;
  idleTimeoutMs: number;
  maxLifetimeMs: number;
  healthCheckIntervalMs: number;
}

const DEFAULT_POOL_CONFIG: PoolConfig = {
  minConnections: 1,
  maxConnections: 10,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  maxLifetimeMs: 30 * 60 * 1000, // 30 minutes
  healthCheckIntervalMs: 60 * 1000, // 1 minute
};

interface PooledClient {
  client: MCPClient;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
  healthCheckFailed: number;
}

interface PoolStats {
  totalConnections: number;
  availableConnections: number;
  inUseConnections: number;
  pendingRequests: number;
}

/**
 * MCP Connection Pool
 * 
 * Manages a pool of MCP client connections for efficient resource usage
 */
export class MCPConnectionPool {
  private readonly serverId: string;
  private readonly config: MCPTransportConfig;
  private readonly poolConfig: PoolConfig;
  private readonly pool: PooledClient[] = [];
  private readonly pendingRequests: Array<{
    resolve: (client: MCPClient) => void;
    reject: (error: Error) => void;
    timeout?: NodeJS.Timeout;
  }> = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(
    serverId: string,
    config: MCPTransportConfig,
    poolConfig: Partial<PoolConfig> = {}
  ) {
    this.serverId = serverId;
    this.config = config;
    this.poolConfig = { ...DEFAULT_POOL_CONFIG, ...poolConfig };
    
    // Initialize minimum connections
    this.initializeMinConnections();
    
    // Start health check
    this.startHealthCheck();
    
    logger.info('MCP Connection Pool created', {
      serverId,
      minConnections: this.poolConfig.minConnections,
      maxConnections: this.poolConfig.maxConnections,
    });
  }

  /**
   * Get a client from the pool
   */
  async acquireClient(timeoutMs: number = 5000): Promise<MCPClient> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    // Try to get an available client
    const availableClient = this.pool.find(
      (pooled) => !pooled.inUse && this.isClientHealthy(pooled)
    );

    if (availableClient) {
      availableClient.inUse = true;
      availableClient.lastUsedAt = Date.now();
      logger.debug('Acquired existing client from pool', { serverId: this.serverId });
      return availableClient.client;
    }

    // Create new client if under max
    if (this.pool.length < this.poolConfig.maxConnections) {
      const client = await this.createPooledClient();
      logger.debug('Created new client in pool', { serverId: this.serverId });
      return client;
    }

    // Wait for available client
    logger.debug('Waiting for available client', { 
      serverId: this.serverId,
      pending: this.pendingRequests.length,
    });

    return new Promise<MCPClient>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from pending
        const index = this.pendingRequests.findIndex((p) => p.resolve === resolve);
        if (index !== -1) {
          this.pendingRequests.splice(index, 1);
        }
        reject(new Error('Timeout waiting for available MCP client'));
      }, timeoutMs);

      this.pendingRequests.push({ resolve, reject, timeout });
    });
  }

  /**
   * Release a client back to the pool
   */
  releaseClient(client: MCPClient): void {
    const pooled = this.pool.find((p) => p.client === client);
    
    if (!pooled) {
      logger.warn('Attempted to release unknown client', { serverId: this.serverId });
      return;
    }

    pooled.inUse = false;
    pooled.lastUsedAt = Date.now();

    // Fulfill pending requests
    if (this.pendingRequests.length > 0) {
      const pending = this.pendingRequests.shift();
      if (pending) {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pooled.inUse = true;
        pending.resolve(client);
        return;
      }
    }

    // Cleanup idle connections if over minimum
    if (this.pool.length > this.poolConfig.minConnections) {
      const idleTime = Date.now() - pooled.lastUsedAt;
      if (idleTime > this.poolConfig.idleTimeoutMs) {
        this.removeClient(pooled);
        logger.debug('Removed idle client from pool', { serverId: this.serverId });
      }
    }

    logger.debug('Released client back to pool', { 
      serverId: this.serverId,
      poolSize: this.pool.length,
    });
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const inUse = this.pool.filter((p) => p.inUse).length;
    return {
      totalConnections: this.pool.length,
      availableConnections: this.pool.length - inUse,
      inUseConnections: inUse,
      pendingRequests: this.pendingRequests.length,
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down MCP Connection Pool', { serverId: this.serverId });
    
    this.isShuttingDown = true;
    
    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Reject pending requests
    for (const pending of this.pendingRequests) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error('Connection pool shutting down'));
    }
    this.pendingRequests.length = 0;

    // Close all connections
    const closePromises = this.pool.map((pooled) =>
      this.closeClient(pooled.client)
    );
    
    await Promise.allSettled(closePromises);
    this.pool.length = 0;

    logger.info('MCP Connection Pool shutdown complete', { serverId: this.serverId });
  }

  /**
   * Initialize minimum connections
   */
  private async initializeMinConnections(): Promise<void> {
    try {
      const promises = Array(this.poolConfig.minConnections)
        .fill(null)
        .map(() => this.createPooledClient());
      
      await Promise.allSettled(promises);
      
      logger.info('Initialized minimum connections', {
        serverId: this.serverId,
        count: this.pool.length,
      });
    } catch (error) {
      logger.error('Failed to initialize minimum connections', error as Error);
    }
  }

  /**
   * Create a new pooled client
   */
  private async createPooledClient(): Promise<MCPClient> {
    const client = new MCPClient(this.config);
    
    const pooled: PooledClient = {
      client,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
      healthCheckFailed: 0,
    };

    this.pool.push(pooled);

    // Connect client in background
    client.connect().catch((error) => {
      logger.error('Failed to connect pooled client', error as Error);
      this.removeClient(pooled);
    });

    return client;
  }

  /**
   * Remove a client from the pool
   */
  private removeClient(pooled: PooledClient): void {
    const index = this.pool.indexOf(pooled);
    if (index !== -1) {
      this.pool.splice(index, 1);
      this.closeClient(pooled.client).catch((error) => {
        logger.error('Error closing removed client', error as Error);
      });
    }
  }

  /**
   * Check if client is healthy
   */
  private isClientHealthy(pooled: PooledClient): boolean {
    const now = Date.now();
    
    // Check lifetime
    if (now - pooled.createdAt > this.poolConfig.maxLifetimeMs) {
      return false;
    }

    // Check health check failures
    if (pooled.healthCheckFailed >= 3) {
      return false;
    }

    // Check connection state
    const connectionInfo = pooled.client.getConnectionInfo();
    return connectionInfo.state === 'connected';
  }

  /**
   * Start periodic health check
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.poolConfig.healthCheckIntervalMs);
  }

  /**
   * Perform health check on all clients
   */
  private performHealthCheck(): void {
    for (const pooled of this.pool) {
      if (pooled.inUse) {
        continue; // Skip clients in use
      }

      if (!this.isClientHealthy(pooled)) {
        pooled.healthCheckFailed++;
        
        if (pooled.healthCheckFailed >= 3) {
          logger.warn('Removing unhealthy client from pool', {
            serverId: this.serverId,
            failedCount: pooled.healthCheckFailed,
          });
          this.removeClient(pooled);
        }
      } else {
        pooled.healthCheckFailed = 0;
      }
    }
  }

  /**
   * Close client connection
   */
  private async closeClient(client: MCPClient): Promise<void> {
    try {
      if (client.isConnected()) {
        await client.disconnect();
      }
    } catch (error) {
      logger.error('Error closing client', error as Error);
    }
  }
}

/**
 * Global connection pool registry
 * Manages pools for multiple MCP servers
 */
class PoolRegistry {
  private readonly pools = new Map<string, MCPConnectionPool>();

  /**
   * Get or create a connection pool for a server
   */
  getPool(
    serverId: string,
    config: MCPTransportConfig,
    poolConfig?: Partial<PoolConfig>
  ): MCPConnectionPool {
    let pool = this.pools.get(serverId);
    
    if (!pool) {
      pool = new MCPConnectionPool(serverId, config, poolConfig);
      this.pools.set(serverId, pool);
      
      logger.info('Created new MCP connection pool', { serverId });
    }

    return pool;
  }

  /**
   * Remove and shutdown a pool
   */
  async removePool(serverId: string): Promise<void> {
    const pool = this.pools.get(serverId);
    
    if (pool) {
      await pool.shutdown();
      this.pools.delete(serverId);
      
      logger.info('Removed MCP connection pool', { serverId });
    }
  }

  /**
   * Shutdown all pools
   */
  async shutdownAll(): Promise<void> {
    const promises = Array.from(this.pools.values()).map((pool) =>
      pool.shutdown()
    );
    
    await Promise.allSettled(promises);
    this.pools.clear();
    
    logger.info('Shutdown all MCP connection pools');
  }

  /**
   * Get statistics for all pools
   */
  getAllStats(): Record<string, PoolStats> {
    const stats: Record<string, PoolStats> = {};
    
    for (const [serverId, pool] of this.pools.entries()) {
      stats[serverId] = pool.getStats();
    }
    
    return stats;
  }
}

// Global registry instance
export const mcpPoolRegistry = new PoolRegistry();

/**
 * Get connection pool for an MCP server
 */
export function getMCPConnectionPool(
  serverId: string,
  config: MCPTransportConfig,
  poolConfig?: Partial<PoolConfig>
): MCPConnectionPool {
  return mcpPoolRegistry.getPool(serverId, config, poolConfig);
}

/**
 * Execute operation with pooled client
 */
export async function withPooledClient<T>(
  serverId: string,
  config: MCPTransportConfig,
  operation: (client: MCPClient) => Promise<T>,
  poolConfig?: Partial<PoolConfig>
): Promise<T> {
  const pool = getMCPConnectionPool(serverId, config, poolConfig);
  
  let client: MCPClient | null = null;
  
  try {
    client = await pool.acquireClient();
    return await operation(client);
  } finally {
    if (client) {
      pool.releaseClient(client);
    }
  }
}
