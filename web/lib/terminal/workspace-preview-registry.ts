/**
 * Phase 8: Workspace Preview Registry
 *
 * Bridges workspace service port detection to provider-specific preview URL
 * generation. When a daemon service (npm run dev, flask run, etc.) emits a
 * port in its output, this registry:
 *
 *   1. Receives the detected port + provider/sandbox info
 *   2. Generates a provider-specific public preview URL
 *   3. Registers it per-workspace so AI agents can inspect it in real-time
 *   4. Tracks health (reachable, stale) and service ownership
 *
 * Integration:
 *   workspaceServiceManager.detectPorts()
 *     → workspacePreviewRegistry.registerPreview()
 *     → AI agent queries getWorkspacePreviews() → inspects live URLs
 *
 * @see lib/terminal/workspace-service-manager.ts — Port detection source
 * @see lib/sandbox/preview-manager.ts — Provider URL patterns
 * @see lib/previews/enhanced-port-detector.ts — Port detection patterns
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '@/lib/utils/logger';
import type { PortDetectionResult } from '@/lib/previews/enhanced-port-detector';
import type { SandboxProviderType } from '@/lib/sandbox/providers';
import { previewRouter } from '@/lib/previews/preview-router';


const logger = createLogger('Phase8:PreviewRegistry');

// ============================================================================
// Types
// ============================================================================

export type PreviewStatus = 'active' | 'starting' | 'unreachable' | 'stale' | 'stopped';

/**
 * A registered workspace preview — a public URL for a running service.
 * AI agents can query these to inspect live application state.
 */
export interface WorkspacePreview {
  /** Unique preview ID */
  id: string;
  /** The workspace this preview belongs to */
  workspaceId: string;
  /** The service that owns this preview */
  serviceId: string;
  /** Human-readable service name */
  serviceName: string;
  /** The port being exposed */
  port: number;
  /** Protocol (http/https) */
  protocol: 'http' | 'https' | 'tcp';
  /** Public preview URL */
  url: string;
  /** When the preview was first registered */
  registeredAt: number;
  /** Last time the preview URL was verified reachable */
  lastReachableAt?: number;
  /** Current status */
  status: PreviewStatus;
  /** The sandbox provider hosting this service */
  provider?: SandboxProviderType;
  /** The sandbox ID */
  sandboxId?: string;
  /** Port detection confidence */
  confidence: 'high' | 'medium' | 'low';
  /** Framework hint (react, nextjs, flask, etc.) */
  framework?: string;
}

/**
 * Preview registry statistics for monitoring.
 */
export interface PreviewRegistryStats {
  totalPreviews: number;
  activePreviews: number;
  unreachablePreviews: number;
  byProvider: Record<string, number>;
}

// ============================================================================
// Provider-specific URL patterns
// ============================================================================

/**
 * Generate a provider-specific preview URL from port and sandbox info.
 * These patterns mirror the provider-specific preview modules but operate
 * without needing a full SandboxHandle — just the sandbox ID and provider type.
 */
export function generatePreviewUrl(
  sandboxId: string,
  provider: SandboxProviderType,
  port: number,
  protocol: 'http' | 'https' | 'tcp' = 'http',
): string {
  // For TCP-only detections, use HTTP as the default protocol for the URL
  const urlProtocol = protocol === 'tcp' ? 'http' : protocol;
  switch (provider) {
    case 'codesandbox':
      return `https://${sandboxId}-${port}.csb.app/`;

    case 'daytona':
      return `https://${sandboxId}-${port}.${provider}.daytona.app/`;

    case 'sprites':
      return `https://${sandboxId}.sprite.sh/port/${port}/`;

    case 'e2b':
      return `https://${port}-${sandboxId}.e2b.dev/`;

    case 'modal-com':
      return `https://${sandboxId}--${port}.modal.run/`;

    case 'runloop':
      return `https://${sandboxId}-${port}.runloop.dev/`;

    case 'vercel-sandbox':
      return `https://${sandboxId}-${port}.vercel.app/`;

    case 'blaxel':
    case 'blaxel-mcp':
      return `https://${sandboxId}-${port}.blaxel.dev/`;

    case 'webcontainer':
      return `https://${port}-${sandboxId}.webcontainer.io/`;

    case 'opensandbox':
    case 'microsandbox':
      // Local/sandbox providers — use localhost
      return `${urlProtocol}://localhost:${port}`;

    default:
      return `${urlProtocol}://localhost:${port}`;
  }
}

// ============================================================================
// Framework hints from service names and commands
// ============================================================================

const FRAMEWORK_HINTS: Record<string, string> = {
  'nextjs': 'nextjs',
  'dev-server': 'generic-dev',
  'vite-dev': 'vite',
  'flask': 'flask',
  'fastapi': 'fastapi',
  'django': 'django',
  'gunicorn': 'gunicorn',
  'app-server': 'node',
  'api-server': 'node',
  'redis': 'redis',
  'postgres': 'postgres',
};

/**
 * Infer a framework hint from a service name.
 */
export function inferFramework(serviceName: string): string | undefined {
  return FRAMEWORK_HINTS[serviceName];
}

// ============================================================================
// Workspace Preview Registry
// ============================================================================

export class WorkspacePreviewRegistry extends EventEmitter {
  /** Per-workspace registries: workspaceId → Map<previewId, WorkspacePreview> */
  private registries = new Map<string, Map<string, WorkspacePreview>>();
  /** Auto-incrementing preview ID counter */
  private idCounter = 0;

  /**
   * Register a preview URL for a workspace service.
   * Called when port detection identifies a listening port from daemon output.
   */
  registerPreview(params: {
    workspaceId: string;
    serviceId: string;
    serviceName: string;
    port: PortDetectionResult;
    provider?: SandboxProviderType;
    sandboxId?: string;
    framework?: string;
  }): WorkspacePreview {
    // Check if a preview already exists for this workspace+service+port
    const existing = this.findPreviewsByPort(params.workspaceId, params.port.port)
      .find(p => p.serviceId === params.serviceId);
    if (existing) {
      let changed = false;

      // Update confidence if higher, touch timestamp
      if (params.port.confidence === 'high' && existing.confidence !== 'high') {
        existing.confidence = 'high';
        changed = true;
      }
      existing.lastReachableAt = Date.now();
      if (existing.status === 'starting') {
        existing.status = 'active';
        changed = true;
      }

      if (changed) {
        this.emit('preview:updated', existing);
      }

      logger.debug('Preview already registered, updated', {
        previewId: existing.id,
        url: existing.url,
        port: existing.port,
      });
      return existing;
    }
    const registry = this.getOrCreateRegistry(params.workspaceId);

    const previewId = `preview-${++this.idCounter}`;
    const protocol = params.port.protocol;
    const port = params.port.port;

    // Generate provider-specific URL or fall back to localhost
    const url = params.sandboxId && params.provider
      ? generatePreviewUrl(params.sandboxId, params.provider, port, protocol)
      : params.port.url || `${protocol}://localhost:${port}`;

    const framework = params.framework || inferFramework(params.serviceName);

    const preview: WorkspacePreview = {
      id: previewId,
      workspaceId: params.workspaceId,
      serviceId: params.serviceId,
      serviceName: params.serviceName,
      port,
      protocol,
      url,
      registeredAt: Date.now(),
      status: params.port.confidence === 'high' ? 'active' : 'starting',
      lastReachableAt: params.port.confidence === 'high' ? Date.now() : undefined,
      provider: params.provider,
      sandboxId: params.sandboxId,
      confidence: params.port.confidence,
      framework,
    };

    registry.set(previewId, preview);

    // Emit event for dashboard subscribers
    this.emit('preview:registered', preview);

    // Phase 9: Also register with the PreviewRouter so HTTP requests to
    // the preview URL are proxied through the router with fallback orchestration.
    if (params.sandboxId) {
      previewRouter.registerPreview({
        sandboxId: params.sandboxId,
        port,
        backendUrl: url,
        metadata: {
          serviceId: params.serviceId,
          serviceName: params.serviceName,
          framework: framework,
          provider: params.provider,
          previewId,
        },
      }).catch(err => {
        logger.warn('Failed to register preview with PreviewRouter', {
          previewId,
          sandboxId: params.sandboxId,
          error: err.message,
        });
      });
    }

    logger.info('Preview registered', {
      previewId,
      url,
      port,
      service: params.serviceName,
      provider: params.provider,
      workspaceId: params.workspaceId,
    });

    return preview;
  }

  /**
   * Update a preview's status (e.g., after health check).
   */
  updateStatus(
    previewId: string,
    workspaceId: string,
    status: PreviewStatus,
  ): void {
    const preview = this.getPreview(previewId, workspaceId);
    if (!preview) return;

    preview.status = status;
    if (status === 'active') {
      preview.lastReachableAt = Date.now();
    }

    // Terminal statuses → unregister from PreviewRouter so it stops proxying
    if ((status === 'stopped' || status === 'unreachable') && preview.sandboxId) {
      this.unregisterFromRouter(preview, `status:${status}`);
    }

    logger.debug('Preview status updated', { previewId, status, url: preview.url });

    // Emit event for dashboard subscribers
    this.emit('preview:updated', preview);
  }

  /**
   * Get all previews for a workspace.
   * This is the primary query for AI agents inspecting workspace state.
   */
  getWorkspacePreviews(workspaceId: string): WorkspacePreview[] {
    const registry = this.registries.get(workspaceId);
    if (!registry) return [];
    return Array.from(registry.values());
  }

  /**
   * Get active (reachable) previews for a workspace.
   */
  getActivePreviews(workspaceId: string): WorkspacePreview[] {
    return this.getWorkspacePreviews(workspaceId)
      .filter(p => p.status === 'active' || p.status === 'starting');
  }

  /**
   * Get a specific preview by ID.
   */
  getPreview(previewId: string, workspaceId: string): WorkspacePreview | undefined {
    const registry = this.registries.get(workspaceId);
    return registry?.get(previewId);
  }

  /**
   * Find previews by port number across a workspace.
   */
  findPreviewsByPort(workspaceId: string, port: number): WorkspacePreview[] {
    return this.getWorkspacePreviews(workspaceId)
      .filter(p => p.port === port);
  }

  /**
   * Find previews by service ID.
   */
  findPreviewsByService(workspaceId: string, serviceId: string): WorkspacePreview[] {
    return this.getWorkspacePreviews(workspaceId)
      .filter(p => p.serviceId === serviceId);
  }

  /**
   * Remove a preview from the registry.
   */
  removePreview(previewId: string, workspaceId: string): boolean {
    const registry = this.registries.get(workspaceId);
    if (!registry) return false;

    const preview = registry.get(previewId);
    if (!preview) return false;

    const deleted = registry.delete(previewId);
    if (deleted) {
      this.unregisterFromRouter(preview, 'removed');
      this.emit('preview:removed', { preview, workspaceId });
      logger.info('Preview removed', { previewId, workspaceId });
    }
    return deleted;
  }

  /**
   * Mark a preview as stale (service stopped but URL may still resolve briefly).
   *
   * Calls updateStatus() so the 'preview:updated' event fires with status='stale'.
   */
  markStale(previewId: string, workspaceId: string): void {
    const preview = this.getPreview(previewId, workspaceId);
    if (preview) {
      this.unregisterFromRouter(preview, 'stale');
    }
    this.updateStatus(previewId, workspaceId, 'stale');
  }

  /**
   * Clear all previews for a workspace.
   */
  clearWorkspace(workspaceId: string): void {
    const registry = this.registries.get(workspaceId);
    if (registry) {
      for (const preview of registry.values()) {
        this.unregisterFromRouter(preview, 'workspace-cleared');
      }
    }
    this.registries.delete(workspaceId);
    this.emit('workspace:cleared', { workspaceId });
    logger.info('Workspace previews cleared', { workspaceId });
  }

  /**
   * Get a structured summary for AI agent consumption.
   */
  getWorkspacePreviewSummary(workspaceId: string): {
    previews: Array<{
      id: string;
      serviceName: string;
      url: string;
      port: number;
      status: PreviewStatus;
      framework?: string;
      provider?: string;
    }>;
    activeCount: number;
    totalCount: number;
  } {
    const previews = this.getWorkspacePreviews(workspaceId);

    return {
      previews: previews.map(p => ({
        id: p.id,
        serviceName: p.serviceName,
        url: p.url,
        port: p.port,
        status: p.status,
        framework: p.framework,
        provider: p.provider,
      })),
      activeCount: previews.filter(p => p.status === 'active').length,
      totalCount: previews.length,
    };
  }

  /**
   * Get registry-wide statistics for monitoring.
   */
  getStats(): PreviewRegistryStats {
    let totalPreviews = 0;
    let activePreviews = 0;
    let unreachablePreviews = 0;
    const byProvider: Record<string, number> = {};

    for (const registry of this.registries.values()) {
      for (const preview of registry.values()) {
        totalPreviews++;
        if (preview.status === 'active') activePreviews++;
        if (preview.status === 'unreachable') unreachablePreviews++;
        if (preview.provider) {
          byProvider[preview.provider] = (byProvider[preview.provider] || 0) + 1;
        }
      }
    }

    return { totalPreviews, activePreviews, unreachablePreviews, byProvider };
  }
  // ==========================================================================
  // DB Rehydration
  // ==========================================================================

  /**
   * Rehydrate in-memory preview registry from the workspace_ports DB table.
   * Idempotent — safe to call multiple times. Only loads previews for the
   * given workspaceId. Existing in-memory previews with the same ID are
   * overwritten (DB wins on conflicts).
   */
  rehydrate(workspaceId: string): void {
    try {
      const { getDatabase } = require('@/lib/database/connection');
      const db = getDatabase();
      if (!db) return;

      // Clear existing in-memory entries to prevent stale data accumulation
      let registry = this.registries.get(workspaceId);
      if (registry) {
        registry.clear();
      } else {
        registry = new Map();
        this.registries.set(workspaceId, registry);
      }
      const rows = db.prepare(
        'SELECT * FROM workspace_ports WHERE workspace_id = ?'
      ).all(workspaceId) as Array<{
        id: string;
        workspace_id: string;
        service_id: string;
        service_name: string;
        port: number;
        protocol: string;
        url: string;
        status: string;
        provider: string | null;
        sandbox_id: string | null;
        confidence: string;
        framework: string | null;
        registered_at: number;
        last_reachable_at: number | null;
      }>;

      // Track the highest ID counter to avoid clashes
      let maxIdNum = this.idCounter;

      for (const row of rows) {
        const idMatch = row.id.match(/(\d+)$/);
        if (idMatch) {
          const idNum = parseInt(idMatch[1], 10);
          if (idNum > maxIdNum) {
            maxIdNum = idNum;
          }
        }

        const preview: WorkspacePreview = {
          id: row.id,
          workspaceId: row.workspace_id,
          serviceId: row.service_id,
          serviceName: row.service_name,
          port: row.port,
          protocol: row.protocol as 'http' | 'https' | 'tcp',
          url: row.url,
          status: row.status as PreviewStatus,
          provider: row.provider as SandboxProviderType | undefined,
          sandboxId: row.sandbox_id ?? undefined,
          confidence: row.confidence as 'high' | 'medium' | 'low',
          framework: row.framework ?? undefined,
          registeredAt: row.registered_at,
          lastReachableAt: row.last_reachable_at ?? undefined,
        };

        registry.set(preview.id, preview);
      }

      this.idCounter = maxIdNum;

      if (rows.length > 0) {
        logger.debug('Rehydrated previews from DB', {
          workspaceId,
          count: rows.length,
        });
      }
    } catch (error: any) {
      logger.warn('Failed to rehydrate previews from DB', {
        workspaceId,
        error: error.message,
      });
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private getOrCreateRegistry(workspaceId: string): Map<string, WorkspacePreview> {
    let registry = this.registries.get(workspaceId);
    if (!registry) {
      registry = new Map();
      this.registries.set(workspaceId, registry);
    }
    return registry;
  }

  /**
   * Unregister a preview from the PreviewRouter (fire-and-forget, never throws).
   */
  private unregisterFromRouter(preview: WorkspacePreview, reason: string): void {
    if (!preview.sandboxId) return;
    previewRouter.unregisterPreview(preview.sandboxId, preview.port).catch(err => {
      logger.warn(`Failed to unregister preview from PreviewRouter (${reason})`, {
        previewId: preview.id,
        sandboxId: preview.sandboxId,
        error: err.message,
      });
    });
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspacePreviewRegistry = new WorkspacePreviewRegistry();
