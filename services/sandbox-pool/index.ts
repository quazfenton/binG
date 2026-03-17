/**
 * Sandbox Pool Service
 * 
 * Manages a pool of pre-warmed sandboxes for instant code execution.
 * Integrates with existing sandbox managers and providers.
 * 
 * Features:
 * - Pre-warms N sandboxes on startup
 * - Idle timeout with automatic cleanup
 * - Provider failover (E2B → Daytona → Sprites → CodeSandbox → Microsandbox)
 * - Health monitoring and auto-replacement
 * - Redis-backed state synchronization
 */

import { createServer } from 'http';
import { createLogger } from '@/lib/utils/logger';
import { getSandboxProvider, getSandboxProviderWithFallback } from '@/lib/sandbox/providers';
import type { SandboxHandle, SandboxCreateConfig, SandboxProviderType } from '@/lib/sandbox/providers';
import { backgroundExecutor } from '@/lib/agent/background-jobs';
import { createResourceMonitor, type ResourceMonitor } from '@/lib/sandbox/resource-monitor';
import Redis from 'ioredis';

const logger = createLogger('SandboxPool');

// Configuration from environment
const PORT = parseInt(process.env.PORT || '3005', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const POOL_SIZE = parseInt(process.env.SANDBOX_POOL_SIZE || '5', 10);
const IDLE_TIMEOUT = parseInt(process.env.SANDBOX_IDLE_TIMEOUT || '600', 10) * 1000; // ms
const DEFAULT_PROVIDER = (process.env.DEFAULT_SANDBOX_PROVIDER || 'microsandbox') as SandboxProviderType;
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

interface PooledSandbox {
  id: string;
  handle: SandboxHandle;
  provider: SandboxProviderType;
  createdAt: number;
  lastUsed: number;
  status: 'available' | 'in-use' | 'draining' | 'error';
  resourceMonitor?: ResourceMonitor;
}

class SandboxPoolService {
  private pool: Map<string, PooledSandbox> = new Map();
  private availableQueue: string[] = [];
  private redisClient?: any;
  private healthCheckInterval?: NodeJS.Timeout;
  public initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing sandbox pool service...', {
      poolSize: POOL_SIZE,
      idleTimeout: IDLE_TIMEOUT / 1000,
      defaultProvider: DEFAULT_PROVIDER,
    });

    // Initialize Redis for state sync (optional)
    try {
      if (REDIS_URL) {
        this.redisClient = new Redis(REDIS_URL);
        this.redisClient.on('error', (err) => logger.error('Redis error:', err));
        await this.redisClient.ping();
        logger.info('Connected to Redis for state synchronization');
      }
    } catch (error: any) {
      logger.warn('Redis not available, running in standalone mode:', error.message);
    }

    // Pre-warm sandboxes
    await this.preWarmSandboxes(POOL_SIZE);

    // Start health monitoring
    this.startHealthMonitoring();

    this.initialized = true;
    logger.info('Sandbox pool service initialized');
  }

  /**
   * Pre-warm N sandboxes
   */
  private async preWarmSandboxes(count: number): Promise<void> {
    logger.info(`Pre-warming ${count} sandboxes...`);

    const warmPromises = Array.from({ length: count }, (_, i) =>
      this.createSandbox(`prewarm-${i}`)
    );

    const results = await Promise.allSettled(warmPromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info(`Pre-warming complete: ${successful} successful, ${failed} failed`);
  }

  /**
   * Create a new sandbox and add to pool
   */
  private async createSandbox(label?: string): Promise<PooledSandbox> {
    const sandboxId = label || `sandbox-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      // Get provider with fallback chain
      const { provider, type } = await getSandboxProviderWithFallback(DEFAULT_PROVIDER);

      // Create sandbox configuration
      const config: SandboxCreateConfig = {
        language: 'typescript',
        envVars: {
          NODE_ENV: 'development',
          TERM: 'xterm-256color',
        },
        resources: {
          cpu: 1,
          memory: 2,
        },
        labels: {
          createdBy: 'sandbox-pool',
          poolLabel: label || 'prewarm',
        },
      };

      // Create the sandbox
      const handle = await provider.createSandbox(config);

      const pooled: PooledSandbox = {
        id: handle.id,
        handle,
        provider: type,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        status: 'available',
      };

      // Start resource monitoring
      const monitor = createResourceMonitor();
      pooled.resourceMonitor = monitor;
      monitor.startMonitoring(handle.id, type);

      // Add to pool
      this.pool.set(handle.id, pooled);
      this.availableQueue.push(handle.id);

      logger.info(`Created sandbox: ${handle.id} (provider: ${type})`);

      // Sync to Redis if available
      if (this.redisClient) {
        await this.redisClient.hSet(`sandbox:${handle.id}`, {
          status: 'available',
          provider: type,
          createdAt: pooled.createdAt.toString(),
        });
      }

      return pooled;
    } catch (error: any) {
      logger.error(`Failed to create sandbox ${sandboxId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get an available sandbox from the pool
   */
  async acquire(): Promise<SandboxHandle> {
    if (!this.initialized) {
      throw new Error('Sandbox pool not initialized');
    }

    // Get first available sandbox
    while (this.availableQueue.length > 0) {
      const sandboxId = this.availableQueue.shift()!;
      const pooled = this.pool.get(sandboxId);

      if (!pooled) continue;

      if (pooled.status === 'available') {
        pooled.status = 'in-use';
        pooled.lastUsed = Date.now();

        logger.info(`Acquired sandbox: ${sandboxId}`);

        // Update Redis state
        if (this.redisClient) {
          await this.redisClient.hSet(`sandbox:${sandboxId}`, {
            status: 'in-use',
            lastUsed: Date.now().toString(),
          });
        }

        return pooled.handle;
      }
    }

    // No available sandboxes - create a new one on demand
    logger.info('No available sandboxes, creating on-demand...');
    const pooled = await this.createSandbox('on-demand');
    pooled.status = 'in-use';
    return pooled.handle;
  }

  /**
   * Return a sandbox to the pool
   */
  async release(sandboxId: string): Promise<void> {
    const pooled = this.pool.get(sandboxId);

    if (!pooled) {
      logger.warn(`Attempted to release unknown sandbox: ${sandboxId}`);
      return;
    }

    if (pooled.status === 'draining') {
      // Sandbox is being drained - destroy it
      await this.destroySandbox(sandboxId);
      return;
    }

    pooled.status = 'available';
    pooled.lastUsed = Date.now();

    // Add back to available queue
    this.availableQueue.push(sandboxId);

    logger.info(`Released sandbox: ${sandboxId}`);

    // Update Redis state
    if (this.redisClient) {
      await this.redisClient.hSet(`sandbox:${sandboxId}`, {
        status: 'available',
        lastUsed: Date.now().toString(),
      });
    }
  }

  /**
   * Destroy a sandbox and remove from pool
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const pooled = this.pool.get(sandboxId);

    if (!pooled) {
      logger.warn(`Attempted to destroy unknown sandbox: ${sandboxId}`);
      return;
    }

    logger.info(`Destroying sandbox: ${sandboxId}`);

    // Stop resource monitoring
    if (pooled.resourceMonitor) {
      pooled.resourceMonitor.stopMonitoring(sandboxId);
    }

    // Destroy the sandbox
    try {
      const { getSandboxProvider } = await import('../lib/sandbox/providers');
      const provider = await getSandboxProvider(pooled.provider);
      await provider.destroySandbox(sandboxId);
    } catch (error: any) {
      logger.error(`Failed to destroy sandbox ${sandboxId}:`, error.message);
    }

    // Remove from pool
    this.pool.delete(sandboxId);
    const queueIndex = this.availableQueue.indexOf(sandboxId);
    if (queueIndex > -1) {
      this.availableQueue.splice(queueIndex, 1);
    }

    // Remove from Redis
    if (this.redisClient) {
      await this.redisClient.del(`sandbox:${sandboxId}`);
    }
  }

  /**
   * Start health monitoring and idle cleanup
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      const now = Date.now();

      for (const [sandboxId, pooled] of this.pool.entries()) {
        // Skip in-use sandboxes
        if (pooled.status === 'in-use') continue;

        // Check idle timeout
        if (now - pooled.lastUsed > IDLE_TIMEOUT) {
          logger.info(`Sandbox ${sandboxId} idle for ${IDLE_TIMEOUT / 1000}s, draining...`);
          pooled.status = 'draining';

          // Remove from available queue
          const queueIndex = this.availableQueue.indexOf(sandboxId);
          if (queueIndex > -1) {
            this.availableQueue.splice(queueIndex, 1);
          }

          // Destroy after a grace period
          setTimeout(() => this.destroySandbox(sandboxId), 5000);
        }

        // Check health via resource monitor
        if (pooled.resourceMonitor) {
          const metrics = pooled.resourceMonitor.getCurrentMetrics(sandboxId);
          if (metrics) {
            // Check for critical resource usage
            if (metrics.cpuUsage > 90 || (metrics.memoryUsage / metrics.memoryLimit) > 0.9) {
              logger.warn(`Sandbox ${sandboxId} has critical resource usage, marking for replacement`);
              pooled.status = 'draining';
              // Create replacement
              this.createSandbox('replacement');
            }
          }
        }
      }

      // Ensure pool size is maintained
      const availableCount = this.availableQueue.length;
      if (availableCount < POOL_SIZE) {
        logger.info(`Pool size below threshold (${availableCount}/${POOL_SIZE}), pre-warming...`);
        await this.preWarmSandboxes(POOL_SIZE - availableCount);
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    available: number;
    inUse: number;
    draining: number;
    byProvider: Record<string, number>;
  } {
    const stats = {
      total: this.pool.size,
      available: this.availableQueue.length,
      inUse: 0,
      draining: 0,
      byProvider: {} as Record<string, number>,
    };

    for (const pooled of this.pool.values()) {
      if (pooled.status === 'in-use') stats.inUse++;
      if (pooled.status === 'draining') stats.draining++;

      const providerCount = stats.byProvider[pooled.provider] || 0;
      stats.byProvider[pooled.provider] = providerCount + 1;
    }

    return stats;
  }

  /**
   * Shutdown the pool gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down sandbox pool...');

    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Drain all sandboxes
    const drainPromises = Array.from(this.pool.keys()).map(id => this.destroySandbox(id));
    await Promise.allSettled(drainPromises);

    // Disconnect Redis
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }

    logger.info('Sandbox pool shutdown complete');
  }
}

// Singleton instance
const sandboxPoolService = new SandboxPoolService();

// HTTP server for health checks and metrics
const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', initialized: sandboxPoolService.initialized }));
    return;
  }

  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sandboxPoolService.getStats()));
    return;
  }

  if (req.url === '/acquire' && req.method === 'POST') {
    try {
      const handle = await sandboxPoolService.acquire();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sandboxId: handle.id, workspaceDir: handle.workspaceDir }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.url?.startsWith('/release/') && req.method === 'POST') {
    const sandboxId = req.url.split('/')[2];
    try {
      await sandboxPoolService.release(sandboxId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// Initialize and start server
async function main() {
  try {
    await sandboxPoolService.initialize();

    server.listen(PORT, () => {
      logger.info(`Sandbox pool service listening on port ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      await sandboxPoolService.shutdown();
      server.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      await sandboxPoolService.shutdown();
      server.close();
      process.exit(0);
    });
  } catch (error: any) {
    logger.error('Failed to start sandbox pool service:', error.message);
    process.exit(1);
  }
}

main();

export { sandboxPoolService };
