import type { Nango } from '@nangohq/node';

export interface NangoConnectionConfig {
  providerConfigKey: string;
  connectionId: string;
}

export interface NangoConnectionInfo {
  provider: string;
  connectionId: string;
  createdAt?: string;
  updatedAt?: string;
}

export class NangoConnectionManager {
  private nango: Nango | null = null;
  private connectionCache: Map<string, { data: any; cachedAt: number }> = new Map();
  private cacheTtlMs: number;
  private initialized = false;

  constructor(cacheTtlMs: number = 300000) {
    this.cacheTtlMs = cacheTtlMs;
    // Lazy initialization - don't create Nango instance at construction time
    // This prevents build failures when NANGO_SECRET_KEY is not set
  }

  /**
   * Lazy initialization of Nango client
   */
  private initialize(): void {
    if (this.initialized) return;
    
    // Skip initialization during build
    const env = typeof process !== 'undefined' ? process.env : {};
    const isBuild = env.NEXT_BUILD === 'true' || 
                    env.NEXT_BUILD === '1' || 
                    env.NEXT_PHASE === 'build' ||
                    env.SKIP_DB_INIT === 'true';
    
    if (isBuild) {
      console.warn('[NangoConnectionManager] Skipping initialization during build');
      this.initialized = true;
      return;
    }
    
    const secretKey = env.NANGO_SECRET_KEY;
    
    if (!secretKey) {
      console.warn('[NangoConnectionManager] NANGO_SECRET_KEY not configured');
    }

    // Lazy require to avoid bundling issues
    const { Nango } = require('@nangohq/node');
    this.nango = new Nango({
      secretKey: secretKey || '',
    });
    this.initialized = true;
  }

  /**
   * Get the Nango instance, initializing if needed
   */
  private getNango(): Nango {
    if (!this.initialized) {
      this.initialize();
    }
    if (!this.nango) {
      // Return a mock Nango for build-time or when not configured
      const { Nango } = require('@nangohq/node');
      this.nango = new Nango({ secretKey: 'dummy-key-for-build' });
    }
    return this.nango;
  }

  /**
   * Get a Nango connection with caching
   */
  async getConnection(
    providerConfigKey: string,
    connectionId: string
  ): Promise<any> {
    const cacheKey = `${providerConfigKey}:${connectionId}`;
    
    // Check cache first
    const cached = this.connectionCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.data;
    }

    try {
      const connection = await this.getNango().getConnection(
        providerConfigKey,
        connectionId
      );
      
      // Cache the connection
      this.connectionCache.set(cacheKey, {
        data: connection,
        cachedAt: Date.now(),
      });
      
      return connection;
    } catch (error) {
      throw new Error(
        `Failed to get Nango connection: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List all Nango connections
   */
  async listConnections(): Promise<NangoConnectionInfo[]> {
    try {
      const response = await this.getNango().listConnections();
      // Handle both array and object response formats
      const connections = Array.isArray(response) ? response : (response as any).connections || [];
      return connections.map((c: any) => ({
        provider: c.provider_config_key,
        connectionId: c.connection_id,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      }));
    } catch (error) {
      console.error('[Nango] Failed to list connections:', error);
      return [];
    }
  }

  /**
   * Check if a connection exists and is valid
   */
  async validateConnection(
    providerConfigKey: string,
    connectionId: string
  ): Promise<boolean> {
    try {
      const connection = await this.getConnection(providerConfigKey, connectionId);
      return !!connection && !connection.error;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate cached connections
   */
  invalidateCache(connectionId?: string): void {
    if (connectionId) {
      for (const key of this.connectionCache.keys()) {
        if (key.includes(connectionId)) {
          this.connectionCache.delete(key);
        }
      }
    } else {
      this.connectionCache.clear();
    }
  }

  /**
   * Execute a Nango proxy request with error handling
   */
  async proxy<T = any>(options: {
    connectionId: string;
    providerConfigKey?: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    endpoint: string;
    body?: any;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  }): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      const result = await this.getNango().proxy({
        ...options,
        providerConfigKey: options.providerConfigKey,
      });
      
      return {
        success: true,
        data: result.data as T,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Get connection status for health check
   */
  async getHealthStatus(): Promise<{
    available: boolean;
    connectionCount: number;
    providers: string[];
  }> {
    try {
      const connections = await this.listConnections();
      const providers = [...new Set(connections.map(c => c.provider))];
      
      return {
        available: true,
        connectionCount: connections.length,
        providers,
      };
    } catch {
      return {
        available: false,
        connectionCount: 0,
        providers: [],
      };
    }
  }
}

export const nangoConnectionManager = new NangoConnectionManager();
