/**
 * Backend Initialization Service
 * 
 * Centralized backend service initialization
 * Call once on app startup to initialize all backend components
 */

import { createLogger } from '@/lib/utils/logger';
import {
  webSocketTerminalServer,
  getS3Backend,
  getLocalBackend,
  getFirecrackerRuntime,
  getProcessRuntime,
  sandboxMetrics,
} from '@/lib/backend';
import { quotaManager } from '@/lib/management/quota';
import { snapshotManager } from '@/lib/virtual-filesystem/sync/snapshot-manager';
import { initializeMCPForArchitecture2 } from '@/lib/mcp';

const logger = createLogger('Backend:Init');

export interface BackendConfig {
  // Storage configuration
  storageType: 'local' | 's3';
  s3Endpoint?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3Bucket?: string;
  s3Region?: string;
  localSnapshotDir?: string;

  // Runtime configuration
  runtimeType: 'process' | 'firecracker' | 'auto';
  firecrackerBin?: string;
  jailerBin?: string;
  firecrackerBaseDir?: string;
  workspaceDir?: string;

  // WebSocket configuration
  websocketPort: number;

  // Quota configuration
  enableQuotas: boolean;
  maxExecutionsPerHour: number;
  maxStorageMB: number;
}

const DEFAULT_CONFIG: BackendConfig = {
  storageType: (process.env.STORAGE_TYPE as 'local' | 's3') || 'local',
  s3Endpoint: process.env.S3_ENDPOINT,
  s3AccessKey: process.env.S3_ACCESS_KEY,
  s3SecretKey: process.env.S3_SECRET_KEY,
  s3Bucket: process.env.S3_BUCKET || 'ephemeral-snapshots',
  s3Region: process.env.S3_REGION || 'us-east-1',
  localSnapshotDir: process.env.LOCAL_SNAPSHOT_DIR || '/tmp/snapshots',
  runtimeType: (process.env.RUNTIME_TYPE as 'process' | 'firecracker' | 'auto') || 'auto',
  firecrackerBin: process.env.FIRECRACKER_BIN,
  jailerBin: process.env.JAILER_BIN,
  firecrackerBaseDir: process.env.FIRECRACKER_BASE_DIR || '/tmp/firecracker',
  workspaceDir: process.env.WORKSPACE_DIR || '/tmp/workspaces',
  websocketPort: parseInt(process.env.WEBSOCKET_PORT || '8080'),
  enableQuotas: process.env.ENABLE_QUOTAS !== 'false',
  maxExecutionsPerHour: parseInt(process.env.MAX_EXECUTIONS_PER_HOUR || '1000'),
  maxStorageMB: parseInt(process.env.MAX_STORAGE_MB || '1000'),
};

export interface BackendStatus {
  initialized: boolean;
  storage: {
    type: string;
    healthy: boolean;
    error?: string;
  };
  runtime: {
    type: string;
    healthy: boolean;
    error?: string;
  };
  websocket: {
    port: number;
    running: boolean;
    sessions: number;
    error?: string;
  };
  quotas: {
    enabled: boolean;
  };
}

class BackendService {
  private initialized = false;
  private initializing = false;
  private config: BackendConfig;
  private initPromise: Promise<BackendStatus> | null = null;
  private status: BackendStatus = {
    initialized: false,
    storage: { type: 'unknown', healthy: false },
    runtime: { type: 'unknown', healthy: false },
    websocket: { port: 0, running: false, sessions: 0 },
    quotas: { enabled: false },
  };

  constructor(config: Partial<BackendConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize all backend services
   * Call this once on app startup
   */
  async initialize(config?: Partial<BackendConfig>): Promise<BackendStatus> {
    // Update config if provided
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Return existing status if already initialized
    if (this.initialized) {
      logger.debug('Backend already initialized');
      return this.status;
    }

    // Wait for ongoing initialization (prevents race condition)
    if (this.initializing && this.initPromise) {
      logger.debug('Backend initialization in progress, waiting...');
      return this.initPromise;
    }

    this.initializing = true;
    const startTime = Date.now();

    // Store promise to allow concurrent callers to wait
    this.initPromise = (async () => {
      try {
        logger.info('Starting backend initialization...', {
          storage: this.config.storageType,
          runtime: this.config.runtimeType,
          websocketPort: this.config.websocketPort,
        });

        // 1. Initialize storage backend
        await this.initializeStorage();

        // 2. Initialize runtime
        await this.initializeRuntime();

        // 3. Start WebSocket terminal server
        await this.initializeWebSocket();

        // 4. Configure quotas
        this.initializeQuotas();

        // 5. Initialize snapshot manager
        await this.initializeSnapshotManager();

        // 6. Initialize MCP CLI server for V2 agents (optional)
        await this.initializeMCPServer();

        this.initialized = true;
        this.status.initialized = true;

        const duration = Date.now() - startTime;
        logger.info('Backend initialization complete', {
          duration,
          storage: this.status.storage,
          runtime: this.status.runtime,
          websocket: this.status.websocket,
        });

        return this.status;
      } catch (error) {
        // Only log as error if we haven't successfully initialized
        if (!this.initialized) {
          logger.error('Backend initialization failed', error as Error);
          throw error;
        } else {
          // Already initialized, this might be a post-init async operation
          logger.warn('Post-initialization error (non-fatal)', error as Error);
        }
      } finally {
        this.initializing = false;
      }
    })();

    return this.initPromise;
  }

  private async initializeStorage(): Promise<void> {
    logger.info('Initializing storage backend...', { type: this.config.storageType });

    try {
      if (this.config.storageType === 's3') {
        if (!this.config.s3AccessKey || !this.config.s3SecretKey) {
          throw new Error('S3 credentials required (S3_ACCESS_KEY, S3_SECRET_KEY)');
        }

        const s3Backend = getS3Backend({
          endpointUrl: this.config.s3Endpoint,
          accessKey: this.config.s3AccessKey,
          secretKey: this.config.s3SecretKey,
          bucket: this.config.s3Bucket!,
          region: this.config.s3Region!,
          prefix: 'snapshots/',
        });

        // Wire S3 backend to snapshot manager
        const { snapshotManager } = await import('../virtual-filesystem/sync/snapshot-manager');
        (snapshotManager as any).storageBackend = s3Backend;

        this.status.storage = {
          type: 's3',
          healthy: true,
        };
      } else {
        const localBackend = getLocalBackend(this.config.localSnapshotDir!);

        // Wire local backend to snapshot manager
        const { snapshotManager } = await import('../virtual-filesystem/sync/snapshot-manager');
        (snapshotManager as any).storageBackend = localBackend;

        this.status.storage = {
          type: 'local',
          healthy: true,
        };
      }

      logger.info('Storage backend initialized', this.status.storage);
    } catch (error) {
      this.status.storage = {
        type: this.config.storageType,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      throw error;
    }
  }

  private async initializeRuntime(): Promise<void> {
    logger.info('Initializing runtime...', { type: this.config.runtimeType });

    try {
      const runtimeType = this.config.runtimeType === 'auto'
        ? 'process' // Default to process for now
        : this.config.runtimeType;

      if (runtimeType === 'firecracker') {
        getFirecrackerRuntime({
          firecrackerBin: this.config.firecrackerBin,
          jailerBin: this.config.jailerBin,
          baseDir: this.config.firecrackerBaseDir,
        });

        this.status.runtime = {
          type: 'firecracker',
          healthy: true,
        };
      } else {
        getProcessRuntime(this.config.workspaceDir);

        this.status.runtime = {
          type: 'process',
          healthy: true,
        };
      }

      logger.info('Runtime initialized', this.status.runtime);
    } catch (error) {
      this.status.runtime = {
        type: this.config.runtimeType,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      throw error;
    }
  }

  private async initializeWebSocket(): Promise<void> {
    logger.info('Starting WebSocket terminal server...', { port: this.config.websocketPort });

    const websocketRequired = process.env.WEBSOCKET_REQUIRED === 'true';
    try {
      await webSocketTerminalServer.start(this.config.websocketPort);

      this.status.websocket = {
        port: this.config.websocketPort,
        running: true,
        sessions: webSocketTerminalServer.getActiveSessions(),
      };

      logger.info('WebSocket terminal server started', this.status.websocket);
    } catch (error) {
      this.status.websocket = {
        port: this.config.websocketPort,
        running: false,
        sessions: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      if (websocketRequired) {
        throw error;
      }
      logger.warn('WebSocket terminal server unavailable; continuing without internal WS server', error as Error);
    }
  }

  private initializeQuotas(): void {
    if (this.config.enableQuotas) {
      quotaManager.configure({
        maxExecutionsPerHour: this.config.maxExecutionsPerHour,
        maxStorageMB: this.config.maxStorageMB,
      });

      this.status.quotas = {
        enabled: true,
      };

      logger.info('Quotas configured', {
        maxExecutionsPerHour: this.config.maxExecutionsPerHour,
        maxStorageMB: this.config.maxStorageMB,
      });
    } else {
      this.status.quotas = {
        enabled: false,
      };
      logger.info('Quotas disabled');
    }
  }

  private async initializeSnapshotManager(): Promise<void> {
    logger.info('Initializing snapshot manager...');

    try {
      // Snapshot manager is already a singleton, just ensure it's configured
      await snapshotManager;
      logger.info('Snapshot manager initialized');
    } catch (error) {
      logger.warn('Snapshot manager initialization skipped', error as Error);
    }
  }

  private async initializeMCPServer(): Promise<void> {
    if (process.env.MCP_ENABLED !== 'true') {
      logger.info('MCP disabled; skipping MCP CLI server initialization');
      return;
    }

    try {
      const port = parseInt(process.env.MCP_CLI_PORT || '8888', 10);
      await initializeMCPForArchitecture2(port);
      logger.info(`MCP CLI server initialized on port ${port}`);
    } catch (error) {
      logger.warn('MCP CLI server initialization failed', error as Error);
    }
  }

  /**
   * Get current backend status
   */
  getStatus(): BackendStatus {
    return { ...this.status };
  }

  /**
   * Check if backend is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get WebSocket server for direct access
   */
  getWebSocketServer() {
    return webSocketTerminalServer;
  }
}

// Export class for testing
export { BackendService };

// Export singleton instance
export const backendService = new BackendService();

/**
 * Convenience function for app initialization
 * Call this in app/layout.tsx or server.ts
 */
export async function initializeBackend(config?: Partial<BackendConfig>): Promise<BackendStatus> {
  return backendService.initialize(config);
}

/**
 * Get backend status
 */
export function getBackendStatus(): BackendStatus {
  return backendService.getStatus();
}
