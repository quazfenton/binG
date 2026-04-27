/**
 * Universal Preview Manager
 * 
 * Provides consistent preview URL management across all sandbox providers.
 * Handles port forwarding, URL caching, and provider-specific preview mechanisms.
 * 
 * @example
 * ```typescript
 * const previewManager = new PreviewManager();
 * 
 * const preview = await previewManager.startPreview({
 *   handle: sandboxHandle,
 *   port: 3000,
 *   startCommand: 'npm run dev',
 *   framework: 'react'
 * });
 * 
 * console.log(preview.url); // https://preview-url.provider.com
 * ```
 */

import { createLogger } from '../utils/logger';
import type { SandboxHandle } from './providers/sandbox-provider';
import type { PreviewInfo } from './types';

const logger = createLogger('Preview:Manager');

// ============================================================================
// Types
// ============================================================================

export interface StartPreviewConfig {
  /** Sandbox handle */
  handle: SandboxHandle;
  /** Port to expose (default: 3000) */
  port?: number;
  /** Command to start the server */
  startCommand: string;
  /** Working directory (default: sandbox.workspaceDir) */
  cwd?: string;
  /** Framework name for provider-specific optimizations */
  framework?: string;
  /** Whether preview should be public (default: true) */
  public?: boolean;
  /** Background execution (default: true) */
  background?: boolean;
}

export interface PreviewResult {
  /** Preview URL */
  url: string;
  /** Port number */
  port: number;
  /** When preview was created */
  createdAt: number;
  /** Provider-specific metadata */
  metadata?: Record<string, any>;
}

export interface PreviewCacheEntry {
  url: string;
  port: number;
  sandboxId: string;
  createdAt: number;
  expiresAt: number;
}

// ============================================================================
// Preview Cache
// ============================================================================

export class PreviewCache {
  private cache = new Map<string, PreviewCacheEntry>();
  private readonly TTL: number;

  constructor(ttlMinutes: number = 30) {
    this.TTL = ttlMinutes * 60 * 1000;
  }

  get(sandboxId: string, port: number): string | null {
    const key = this.getKey(sandboxId, port);
    const entry = this.cache.get(key);

    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.url;
  }

  set(sandboxId: string, port: number, url: string): void {
    const key = this.getKey(sandboxId, port);
    const now = Date.now();

    this.cache.set(key, {
      url,
      port,
      sandboxId,
      createdAt: now,
      expiresAt: now + this.TTL,
    });

    logger.debug(`Cached preview URL for ${sandboxId}:${port}`, { url, ttl: this.TTL });
  }

  delete(sandboxId: string, port?: number): void {
    if (port !== undefined) {
      const key = this.getKey(sandboxId, port);
      this.cache.delete(key);
      logger.debug(`Cleared preview cache for ${sandboxId}:${port}`);
    } else {
      // Clear all entries for this sandbox
      const keysToDelete: string[] = [];
      for (const key of Array.from(this.cache.keys())) {
        if (key.startsWith(`${sandboxId}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.cache.delete(key));
      logger.debug(`Cleared all preview cache entries for ${sandboxId}`);
    }
  }

  private getKey(sandboxId: string, port: number): string {
    return `${sandboxId}:${port}`;
  }

  clear(): void {
    this.cache.clear();
    logger.debug('Preview cache cleared');
  }
}

// ============================================================================
// Port Manager
// ============================================================================

export class PortManager {
  private usedPorts = new Map<string, Set<number>>(); // sandboxId -> ports

  /**
   * Get available port, preferring the specified port
   */
  async getAvailablePort(
    sandboxId: string,
    preferred: number = 3000
  ): Promise<number> {
    const sandboxPorts = this.usedPorts.get(sandboxId) || new Set();

    if (!sandboxPorts.has(preferred)) {
      sandboxPorts.add(preferred);
      this.usedPorts.set(sandboxId, sandboxPorts);
      return preferred;
    }

    // Try common alternative ports
    const alternativePorts = [
      preferred + 1,
      preferred + 100,
      3000, 4000, 5000, 8000, 8080, 9000
    ];

    for (const port of alternativePorts) {
      if (!sandboxPorts.has(port)) {
        sandboxPorts.add(port);
        this.usedPorts.set(sandboxId, sandboxPorts);
        return port;
      }
    }

    // Fallback: find any available port
    for (let port = 3001; port < 65535; port++) {
      if (!sandboxPorts.has(port)) {
        sandboxPorts.add(port);
        this.usedPorts.set(sandboxId, sandboxPorts);
        return port;
      }
    }

    throw new Error('No available ports');
  }

  /**
   * Release a port when preview is stopped
   */
  releasePort(sandboxId: string, port: number): void {
    const sandboxPorts = this.usedPorts.get(sandboxId);
    if (sandboxPorts) {
      sandboxPorts.delete(port);
      if (sandboxPorts.size === 0) {
        this.usedPorts.delete(sandboxId);
      }
      logger.debug(`Released port ${port} for sandbox ${sandboxId}`);
    }
  }

  /**
   * Get all ports used by a sandbox
   */
  getUsedPorts(sandboxId: string): number[] {
    const sandboxPorts = this.usedPorts.get(sandboxId);
    return sandboxPorts ? Array.from(sandboxPorts) : [];
  }

  /**
   * Clear all ports for a sandbox
   */
  clearPorts(sandboxId: string): void {
    this.usedPorts.delete(sandboxId);
    logger.debug(`Cleared all ports for sandbox ${sandboxId}`);
  }
}

// ============================================================================
// Preview Manager
// ============================================================================

export class PreviewManager {
  private cache: PreviewCache;
  private portManager: PortManager;

  constructor() {
    this.cache = new PreviewCache(30); // 30 minute TTL
    this.portManager = new PortManager();
  }

  /** Clear preview cache for a specific sandbox (useful on destroy) */
  clearCacheForSandbox(sandboxId: string): void {
    this.cache.delete(sandboxId);
    logger.debug(`Cleared preview cache for sandbox ${sandboxId}`);
  }

  /**
   * Start a preview server and return URL
   * 
   * Tries provider-specific methods first, then falls back to generic approach.
   */
  async startPreview(config: StartPreviewConfig): Promise<PreviewResult> {
    const {
      handle,
      port: preferredPort,
      startCommand,
      cwd,
      framework,
      public: isPublic = true,
      background = true,
    } = config;

    const sandboxId = handle.id;

    // Check cache FIRST using preferred port to avoid duplicate servers
    const portToCheck = preferredPort || 3000;
    const cachedUrl = this.cache.get(sandboxId, portToCheck);
    if (cachedUrl) {
      logger.info(`Returning cached preview URL for ${sandboxId}:${portToCheck}`);
      return {
        url: cachedUrl,
        port: portToCheck,
        createdAt: Date.now(),
      };
    }

    // Cache miss - allocate a new port and start the preview
    const port = await this.portManager.getAvailablePort(sandboxId, portToCheck);

    try {
      // Try provider-specific preview methods
      let previewUrl: string | null = null;

      // Method 1: Try getPreviewLink if available
      if (handle.getPreviewLink) {
        try {
          logger.debug(`Trying getPreviewLink for port ${port}`);
          const previewInfo = await handle.getPreviewLink(port);
          previewUrl = previewInfo.url;
        } catch (error) {
          logger.debug(`getPreviewLink failed: ${error}`);
        }
      }

      // Method 2: Try getPublicUrl for Sprites
      if (!previewUrl && handle.getPublicUrl) {
        try {
          logger.debug('Trying getPublicUrl (Sprites)');
          previewUrl = await handle.getPublicUrl();
        } catch (error) {
          logger.debug(`getPublicUrl failed: ${error}`);
        }
      }

      // Method 3: Start server and get URL
      if (!previewUrl) {
        logger.info(`Starting preview server on port ${port}`);

        // Start the server
        const serverCommand = background
          ? `${startCommand} &`
          : startCommand;

        const workingDir = cwd || handle.workspaceDir || '/workspace';

        try {
          await handle.executeCommand(serverCommand, workingDir);

          // Wait for server to be ready
          await this.waitForServer(handle, port, workingDir);

          // Get the preview URL
          previewUrl = await this.getPreviewUrl(handle, port, isPublic);

          if (!previewUrl) {
            throw new Error('Could not get preview URL after server started');
          }

          logger.info(`Preview server started: ${previewUrl}`);
        } catch (error: any) {
          logger.error(`Failed to start preview server: ${error.message}`);
          this.portManager.releasePort(sandboxId, port);
          throw error;
        }
      }

      // Cache the URL
      this.cache.set(sandboxId, port, previewUrl);

      return {
        url: previewUrl,
        port,
        createdAt: Date.now(),
        metadata: {
          framework,
          isPublic,
          background,
        },
      };
    } catch (error) {
      logger.error(`Failed to start preview: ${error}`);
      throw error;
    }
  }

  /**
   * Stop preview server and release port
   */
  async stopPreview(sandboxId: string, port: number): Promise<void> {
    logger.info(`Stopping preview for ${sandboxId}:${port}`);

    // Clear cache
    this.cache.delete(sandboxId, port);

    // Release port
    this.portManager.releasePort(sandboxId, port);

    logger.debug(`Preview stopped for ${sandboxId}:${port}`);
  }

  /**
   * Get preview URL for a running server
   */
  async getPreviewUrl(
    handle: SandboxHandle,
    port: number,
    isPublic: boolean = true
  ): Promise<string | null> {
    // Try provider-specific methods
    if (handle.getPreviewLink) {
      try {
        const previewInfo = await handle.getPreviewLink(port);
        return previewInfo.url;
      } catch (error) {
        logger.debug(`getPreviewLink failed: ${error}`);
      }
    }

    if (handle.getPublicUrl) {
      try {
        // Apply provider URL auth mode when supported
        if (handle.updateUrlAuth) {
          await handle.updateUrlAuth(isPublic ? 'public' : 'default');
        }
        return await handle.getPublicUrl();
      } catch (error) {
        logger.debug(`getPublicUrl failed: ${error}`);
      }
    }

    // Fallback: construct URL based on provider info
    if (handle.getProviderInfo) {
      try {
        const info = await handle.getProviderInfo();
        // Provider-specific URL construction would go here
        logger.debug(`Provider info: ${JSON.stringify(info)}`);
      } catch (error) {
        logger.debug(`getProviderInfo failed: ${error}`);
      }
    }

    return null;
  }

  /**
   * Wait for server to be ready on specified port
   */
  private async waitForServer(
    handle: SandboxHandle,
    port: number,
    cwd: string,
    timeoutMs: number = 30000,
    pollIntervalMs: number = 500
  ): Promise<void> {
    const startTime = Date.now();
    const maxAttempts = Math.floor(timeoutMs / pollIntervalMs);

    logger.debug(`Waiting for server on port ${port} (timeout: ${timeoutMs}ms)`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Try to connect to the port
        const result = await handle.executeCommand(
          `sh -c 'curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} || echo 000'`,
          cwd,
          5000
        );

        // Parse the last line as the HTTP code (ignores any error text)
        const statusCode = result.output?.trim().split('\n').pop() || '000';

        // Only consider ready if command succeeded AND returned valid HTTP status
        if (result.success && /^\d{3}$/.test(statusCode) && statusCode !== '000') {
          logger.info(`Server ready on port ${port} (status: ${statusCode}) after ${attempt} attempts`);
          return;
        }
      } catch (error) {
        logger.debug(`Attempt ${attempt} failed: ${error}`);
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    throw new Error(`Server did not become ready on port ${port} within ${timeoutMs}ms`);
  }

  /**
   * Get cached preview URL
   */
  getCachedUrl(sandboxId: string, port: number): string | null {
    return this.cache.get(sandboxId, port);
  }

  /**
   * Clear all preview data for a sandbox
   */
  clearSandbox(sandboxId: string): void {
    this.cache.delete(sandboxId);
    this.portManager.clearPorts(sandboxId);
    logger.info(`Cleared all preview data for sandbox ${sandboxId}`);
  }

  /**
   * Get preview statistics
   */
  getStats(): {
    cachedPreviews: number;
    usedPorts: Record<string, number[]>;
  } {
    const usedPorts: Record<string, number[]> = {};

    // This would need access to portManager's internal state
    // For now, just return cache size
    return {
      cachedPreviews: this.cache['cache'].size,
      usedPorts,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let previewManagerInstance: PreviewManager | null = null;

export function getPreviewManager(): PreviewManager {
  if (!previewManagerInstance) {
    previewManagerInstance = new PreviewManager();
  }
  return previewManagerInstance;
}

export function resetPreviewManager(): void {
  previewManagerInstance = null;
}
