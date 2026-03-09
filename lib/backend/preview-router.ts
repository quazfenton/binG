/**
 * Preview Router
 * Routes HTTP requests to sandbox previews with fallback support
 * Migrated from ephemeral/preview_router.py
 */

import http from 'http';
import { EventEmitter } from 'events';

export interface PreviewTarget {
  sandboxId: string;
  port: number;
  effectiveUrl: string;
  useFallback: boolean;
  metadata?: Record<string, string>;
}

export interface PreviewRegistration {
  sandboxId: string;
  port: number;
  backendUrl: string;
  metadata?: Record<string, string>;
}

export class PreviewRegistry extends EventEmitter {
  private targets: Map<string, PreviewTarget> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(private healthCheckIntervalMs: number = 30000) {
    super();
    this.startHealthChecks();
  }

  async register(registration: PreviewRegistration): Promise<void> {
    const key = `${registration.sandboxId}:${registration.port}`;
    const target: PreviewTarget = {
      sandboxId: registration.sandboxId,
      port: registration.port,
      effectiveUrl: registration.backendUrl,
      useFallback: false,
      metadata: registration.metadata,
    };
    this.targets.set(key, target);
    this.emit('registered', target);
  }

  async resolve(sandboxId: string, port: number): Promise<PreviewTarget | null> {
    const key = `${sandboxId}:${port}`;
    return this.targets.get(key) || null;
  }

  async markFallback(sandboxId: string, port: number, fallbackUrl: string): Promise<void> {
    const key = `${sandboxId}:${port}`;
    const target = this.targets.get(key);
    if (target) {
      target.effectiveUrl = fallbackUrl;
      target.useFallback = true;
      this.targets.set(key, target);
      this.emit('fallback', target);
    }
  }

  async unregister(sandboxId: string, port: number): Promise<void> {
    const key = `${sandboxId}:${port}`;
    this.targets.delete(key);
    this.emit('unregistered', { sandboxId, port });
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckIntervalMs);
  }

  private async performHealthChecks(): Promise<void> {
    for (const [key, target] of this.targets.entries()) {
      try {
        const healthy = await this.checkHealth(target.effectiveUrl);
        if (!healthy && !target.useFallback) {
          this.emit('unhealthy', target);
        }
      } catch (error) {
        this.emit('health_check_failed', { target, error });
      }
    }
  }

  private async checkHealth(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(url, { timeout: 5000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.targets.clear();
  }
}

export class FallbackOrchestrator {
  private fallbackContainers: Map<string, { url: string; pid?: number }> = new Map();

  async promoteToContainer(sandboxId: string): Promise<string> {
    // In production, this would start a real container
    // For now, return a mock URL
    const url = `http://localhost:8080/${sandboxId}`;
    this.fallbackContainers.set(sandboxId, { url });
    return url;
  }

  async cleanupStale(): Promise<void> {
    // Clean up stale fallback containers
    for (const [sandboxId, container] of this.fallbackContainers.entries()) {
      if (container.pid) {
        try {
          process.kill(container.pid, 'SIGTERM');
        } catch (error) {
          // Process already dead
        }
      }
      this.fallbackContainers.delete(sandboxId);
    }
  }
}

export class PreviewRouter {
  private registry: PreviewRegistry;
  private fallback: FallbackOrchestrator;

  constructor() {
    this.registry = new PreviewRegistry();
    this.fallback = new FallbackOrchestrator();
  }

  async route(sandboxId: string, port: number, path: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const target = await this.registry.resolve(sandboxId, port);
    
    if (!target) {
      response.statusCode = 404;
      response.end('Preview target not registered');
      return;
    }

    const pathUrl = this.stripPathPrefix(target.effectiveUrl, path);
    
    try {
      await this.proxy(pathUrl, request, response);
    } catch (error: any) {
      if (error.statusCode === 502 && !target.useFallback) {
        // Promote fallback and retry
        const fallbackUrl = await this.fallback.promoteToContainer(sandboxId);
        await this.registry.markFallback(sandboxId, port, fallbackUrl);
        const fallbackPathUrl = this.stripPathPrefix(fallbackUrl, path);
        await this.proxy(fallbackPathUrl, request, response);
      } else {
        response.statusCode = 502;
        response.end(`Upstream error: ${error.message}`);
      }
    }
  }

  private stripPathPrefix(baseUrl: string, path: string): string {
    return baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  private async proxy(url: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.request(url, {
        method: request.method,
        headers: request.headers,
      }, (res) => {
        response.statusCode = res.statusCode || 200;
        res.pipe(response);
        res.on('end', resolve);
      });
      
      req.on('error', reject);
      request.pipe(req);
    });
  }

  async registerPreview(registration: PreviewRegistration): Promise<void> {
    await this.registry.register(registration);
  }

  async shutdown(): Promise<void> {
    await this.registry.shutdown();
    await this.fallback.cleanupStale();
  }
}

// Singleton instance
export const previewRouter = new PreviewRouter();
