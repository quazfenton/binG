/**
 * CloudFS Manager - Unified Cloud Filesystem Abstraction
 * 
 * Provides priority-based cloud filesystem access:
 * 1. Sprites CloudFS (if SPRITES_TOKEN)
 * 2. E2B CloudFS (if E2B_API_KEY)
 * 3. Daytona CloudFS (if DAYTONA_API_KEY)
 * 4. Local VFS fallback
 * 
 * Features:
 * - Automatic provider fallback
 * - Quota tracking per provider
 * - Bidirectional sync with local VFS
 * - Checkpoint support
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    CloudFSManager                            │
 * │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
 * │  │  Sprites    │ │    E2B      │ │  Daytona    │          │
 * │  │  CloudFS    │ │  CloudFS    │ │  CloudFS    │          │
 * │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘          │
 * │         │                │                │                 │
 * │         └────────────────┼────────────────┘                 │
 * │                          ▼                                  │
 * │                  ┌─────────────┐                            │
 * │                  │  Fallback   │                            │
 * │                  │    VFS      │                            │
 * │                  └─────────────┘                            │
 * └─────────────────────────────────────────────────────────────┘
 */

import { createLogger } from '../utils/logger';
import { getSandboxProvider, type SandboxProviderType, type SandboxHandle } from '../sandbox/providers';

const logger = createLogger('CloudFS');

export interface CloudFSFile {
  path: string;
  content?: string;
  size?: number;
  lastModified?: Date;
}

export interface CloudFSSnapshot {
  files: CloudFSFile[];
  provider: string;
  timestamp: number;
}

export interface CloudFSSyncResult {
  success: boolean;
  filesSynced: number;
  provider: string;
  duration: number;
  error?: string;
}

export interface CloudFSProviderConfig {
  priority: number;
  enabled: boolean;
  quotaBytes?: number;
  quotaUsed?: number;
}

type CloudProviderName = 'sprites' | 'e2b' | 'daytona' | 'codesandbox' | 'local';

class CloudFSManager {
  private providers = new Map<CloudProviderName, CloudFSProviderConfig>();
  private activeHandle?: SandboxHandle;
  private activeProvider?: CloudProviderName;
  private syncCache = new Map<string, { data: CloudFSSnapshot; expiry: number }>();
  private readonly CACHE_TTL_MS = 30000; // 30 seconds

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize available providers based on API keys
   */
  private initializeProviders(): void {
    // Sprites - highest priority if token available
    if (process.env.SPRITES_TOKEN) {
      this.providers.set('sprites', {
        priority: 1,
        enabled: true,
        quotaBytes: 5 * 1024 * 1024 * 1024, // 5GB default
        quotaUsed: 0,
      });
      logger.info('CloudFS: Sprites provider available');
    }

    // E2B
    if (process.env.E2B_API_KEY) {
      this.providers.set('e2b', {
        priority: 2,
        enabled: true,
        quotaBytes: 1 * 1024 * 1024 * 1024, // 1GB default
        quotaUsed: 0,
      });
      logger.info('CloudFS: E2B provider available');
    }

    // Daytona
    if (process.env.DAYTONA_API_KEY) {
      this.providers.set('daytona', {
        priority: 3,
        enabled: true,
        quotaBytes: 2 * 1024 * 1024 * 1024, // 2GB default
        quotaUsed: 0,
      });
      logger.info('CloudFS: Daytona provider available');
    }

    // CodeSandbox
    if (process.env.CSB_API_KEY) {
      this.providers.set('codesandbox', {
        priority: 4,
        enabled: true,
        quotaBytes: 500 * 1024 * 1024, // 500MB default
        quotaUsed: 0,
      });
      logger.info('CloudFS: CodeSandbox provider available');
    }

    // Local is always available
    this.providers.set('local', {
      priority: 99,
      enabled: true,
      quotaUsed: 0,
    });

    logger.info(`CloudFS initialized with ${this.providers.size} providers`);
  }

  /**
   * Get the best available provider
   */
  private getBestProvider(): CloudProviderName {
    const available = Array.from(this.providers.entries())
      .filter(([_, config]) => config.enabled && config.quotaUsed! < config.quotaBytes!)
      .sort((a, b) => a[1].priority - b[1].priority);

    if (available.length === 0) {
      return 'local';
    }

    return available[0][0];
  }

  /**
   * Connect to a provider
   */
  async connect(provider?: CloudProviderName): Promise<SandboxHandle | null> {
    const targetProvider = provider || this.getBestProvider();
    
    if (targetProvider === 'local') {
      logger.debug('CloudFS: Using local VFS fallback');
      this.activeHandle = undefined;
      this.activeProvider = 'local';
      return undefined;
    }

    try {
      logger.info(`CloudFS: Connecting to ${targetProvider}...`);
      const sandboxProvider = await getSandboxProvider(targetProvider);
      const handle = await sandboxProvider.createSandbox({
        language: 'typescript',
        envVars: {
          TERM: 'xterm-256color',
        },
      });

      this.activeHandle = handle;
      this.activeProvider = targetProvider;
      
      logger.info(`CloudFS: Connected to ${targetProvider}, sandbox: ${handle.id}`);
      return handle;

    } catch (error: any) {
      logger.error(`CloudFS: Failed to connect to ${targetProvider}`, error);
      
      // Try fallback
      const fallbackProviders: CloudProviderName[] = ['sprites', 'e2b', 'daytona', 'codesandbox'];
      const currentIndex = fallbackProviders.indexOf(targetProvider);
      
      if (currentIndex < fallbackProviders.length - 1) {
        return this.connect(fallbackProviders[currentIndex + 1]);
      }
      
      logger.warn('CloudFS: All cloud providers failed, falling back to local');
      return undefined;
    }
  }

  /**
   * Get snapshot from cloud filesystem
   */
  async getSnapshot(sessionId: string, path: string = '/workspace'): Promise<CloudFSSnapshot> {
    // Check cache
    const cacheKey = `${sessionId}:${path}`;
    const cached = this.syncCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    // Connect if needed
    if (!this.activeHandle && !this.activeProvider) {
      await this.connect();
    }

    // Local fallback
    if (!this.activeHandle || this.activeProvider === 'local') {
      return {
        files: [],
        provider: 'local',
        timestamp: Date.now(),
      };
    }

    try {
      // List files recursively (implementation depends on provider)
      const files: CloudFSFile[] = [];
      
      const result = await this.activeHandle.listDirectory(path);
      if (result.success) {
        const entries = result.output.split('\n').filter(Boolean);
        
        for (const entry of entries) {
          const isDir = entry.startsWith('d');
          const entryPath = `${path}/${entry.replace(/^[d-]\s+/, '')}`;
          
          if (isDir) {
            // Recursively get files from subdirectory
            const subFiles = await this.getSnapshot(sessionId, entryPath);
            files.push(...subFiles.files);
          } else {
            // Get file content
            const fileResult = await this.activeHandle.readFile(entryPath);
            if (fileResult.success) {
              files.push({
                path: entryPath,
                content: fileResult.output,
                size: fileResult.output.length,
                lastModified: new Date(),
              });
            }
          }
        }
      }

      const snapshot: CloudFSSnapshot = {
        files,
        provider: this.activeProvider!,
        timestamp: Date.now(),
      };

      // Cache result
      this.syncCache.set(cacheKey, {
        data: snapshot,
        expiry: Date.now() + this.CACHE_TTL_MS,
      });

      return snapshot;

    } catch (error: any) {
      logger.error('CloudFS: Failed to get snapshot', error);
      return {
        files: [],
        provider: this.activeProvider || 'local',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Write file to cloud filesystem
   */
  async writeFile(path: string, content: string): Promise<CloudFSSyncResult> {
    const startTime = Date.now();
    
    if (!this.activeHandle) {
      await this.connect();
    }

    if (!this.activeHandle || this.activeProvider === 'local') {
      return {
        success: false,
        filesSynced: 0,
        provider: 'local',
        duration: 0,
        error: 'No cloud provider available',
      };
    }

    try {
      const result = await this.activeHandle.writeFile(path, content);

      if (result.success) {
        // Update quota usage
        const providerConfig = this.providers.get(this.activeProvider!);
        if (providerConfig) {
          providerConfig.quotaUsed = (providerConfig.quotaUsed || 0) + content.length;
        }

        // Invalidate cache entries that might contain the written path
        // to prevent getSnapshot from returning stale data
        // SECURITY: Use indexOf (FIRST :) not split()[1], because:
        // - cache key format is "ownerId:path" where ownerId never contains :
        // - path MAY contain user-provided : (e.g., Windows paths)
        for (const [cacheKey, cached] of this.syncCache.entries()) {
          const colonIndex = cacheKey.indexOf(':');
          const pathPrefix = colonIndex !== -1 ? cacheKey.slice(colonIndex + 1) : cacheKey;
          if (path.startsWith(pathPrefix) || pathPrefix.startsWith(path.substring(0, path.lastIndexOf('/')))) {
            this.syncCache.delete(cacheKey);
          }
        }
      }

      return {
        success: result.success,
        filesSynced: result.success ? 1 : 0,
        provider: this.activeProvider!,
        duration: Date.now() - startTime,
        error: result.success ? undefined : result.output,
      };

    } catch (error: any) {
      return {
        success: false,
        filesSynced: 0,
        provider: this.activeProvider!,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Sync VFS snapshot to cloud
   */
  async syncToCloud(
    sessionId: string,
    files: Array<{ path: string; content: string }>
  ): Promise<CloudFSSyncResult> {
    const startTime = Date.now();
    
    if (!this.activeHandle) {
      await this.connect();
    }

    if (!this.activeHandle || this.activeProvider === 'local') {
      return {
        success: false,
        filesSynced: 0,
        provider: 'local',
        duration: 0,
        error: 'No cloud provider available',
      };
    }

    try {
      let synced = 0;
      let totalSize = 0;
      const successfulPaths: string[] = [];

      for (const file of files) {
        const result = await this.activeHandle.writeFile(file.path, file.content);
        if (result.success) {
          synced++;
          totalSize += file.content.length;
          successfulPaths.push(file.path);
        }
      }

      // Invalidate cache entries that might contain the written paths
      // SECURITY: Use indexOf (FIRST :) not split()[1], because:
      // - cache key format is "ownerId:path" where ownerId never contains :
      // - path MAY contain user-provided : (e.g., Windows paths)
      for (const [cacheKey, cached] of this.syncCache.entries()) {
        const colonIndex = cacheKey.indexOf(':');
        const pathPrefix = colonIndex !== -1 ? cacheKey.slice(colonIndex + 1) : cacheKey;
        for (const writtenPath of successfulPaths) {
          if (writtenPath.startsWith(pathPrefix) || pathPrefix.startsWith(writtenPath.substring(0, writtenPath.lastIndexOf('/')))) {
            this.syncCache.delete(cacheKey);
            break;
          }
        }
      }

      // Update quota
      const providerConfig = this.providers.get(this.activeProvider!);
      if (providerConfig) {
        providerConfig.quotaUsed = (providerConfig.quotaUsed || 0) + totalSize;
      }
      this.syncCache.clear();

      return {
        success: synced === files.length,
        filesSynced: synced,
        provider: this.activeProvider!,
        duration: Date.now() - startTime,
      };

    } catch (error: any) {
      return {
        success: false,
        filesSynced: 0,
        provider: this.activeProvider!,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Create checkpoint in cloud
   */
  async createCheckpoint(name?: string): Promise<{ success: boolean; checkpointId?: string; error?: string }> {
    if (!this.activeHandle?.createCheckpoint) {
      return { success: false, error: 'Provider does not support checkpoints' };
    }

    try {
      const checkpoint = await this.activeHandle.createCheckpoint(name);
      return { success: true, checkpointId: checkpoint.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get provider quota info
   */
  getQuotaInfo(): Record<string, { used: number; limit: number; available: number }> {
    const info: Record<string, { used: number; limit: number; available: number }> = {};
    
    for (const [name, config] of this.providers.entries()) {
      if (config.quotaBytes) {
        info[name] = {
          used: config.quotaUsed || 0,
          limit: config.quotaBytes,
          available: config.quotaBytes - (config.quotaUsed || 0),
        };
      }
    }
    
    return info;
  }

  /**
   * Get current provider
   */
  getCurrentProvider(): CloudProviderName | undefined {
    return this.activeProvider;
  }

  /**
   * Disconnect from cloud provider
   */
  async disconnect(): Promise<void> {
    if (this.activeHandle && this.activeProvider && this.activeProvider !== 'local') {
      try {
        const provider = await getSandboxProvider(this.activeProvider as SandboxProviderType);
        await provider.destroySandbox(this.activeHandle.id);
      } catch (error: any) {
        logger.error('CloudFS: Failed to disconnect', error);
      }
    }
    
    this.activeHandle = undefined;
    this.activeProvider = undefined;
    this.syncCache.clear();
  }
}

export const cloudFSManager = new CloudFSManager();
