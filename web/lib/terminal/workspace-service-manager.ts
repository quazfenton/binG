/**
 * Workspace Service Manager
 *
 * Turns long-running terminal processes (npm run dev, python server.py, etc.)
 * into first-class workspace services that survive PTY death and browser reconnects.
 *
 * Inspired by the cloud workstation vision: "npm run dev actually becomes:
 * start daemon, attach logs. Users still see npm run dev, but it survives
 * reconnects, browser refreshes, AI actions."
 *
 * Architecture:
 *   User types: npm run dev
 *     → Execution Router classifies as daemon (Class C)
 *     → Service Manager creates WorkspaceService record
 *     → Port detection finds listening ports from stdout
 *     → Service is registered in the workspace service registry
 *     → AI agents can inspect: services, ports, logs, status
 *     → Service survives PTY close (backgrounded)
 *
 * Key abstractions:
 *   - WorkspaceService: A named long-running process with status, ports, logs
 *   - ServiceRegistry: Per-workspace registry of active services
 *   - PortRegistry: Maps virtual ports to provider-specific ports
 *   - ServiceLogBuffer: Rotating in-memory log buffer per service
 *
 * @see lib/previews/enhanced-port-detector.ts — Port detection
 * @see lib/terminal/execution-router.ts — Command classification (Class C = daemon)
 * @see lib/spawn/agent-service-manager.ts — AI agent service manager (separate system)
 */

import { EnhancedPortDetector, type PortDetectionResult } from '@/lib/previews/enhanced-port-detector';
import { createLogger } from '@/lib/utils/logger';
import { virtualPidRegistry } from '@/lib/terminal/virtual-pid-registry';
import { workspacePreviewRegistry } from '@/lib/terminal/workspace-preview-registry';
import type { SandboxProviderType } from '@/lib/sandbox/providers';

const logger = createLogger('WorkspaceServiceManager');

// ============================================================================
// Types
// ============================================================================

export type ServiceStatus = 'starting' | 'running' | 'stopped' | 'crashed' | 'migrating';

export interface WorkspaceService {
  /** Unique service ID */
  id: string;
  /** Human-readable name (e.g., "dev-server", "api", "frontend") */
  name: string;
  /** The original command that started it */
  command: string;
  /** Working directory when started */
  workingDir: string;
  /** Current status */
  status: ServiceStatus;
  /** Detected ports */
  ports: PortDetectionResult[];
  /** PID on the execution provider (may be virtual) */
  pid?: number;
  /** Which sandbox provider is running this service */
  provider?: string;
  /** When the service was started */
  startedAt: number;
  /** Last time status changed */
  lastActivityAt: number;
  /** Exit code if stopped/crashed */
  exitCode?: number;
  /** Rolling log buffer (last N lines) */
  logs: string[];
  /** Whether this service should restart on crash */
  autoRestart: boolean;
  /** Environment variables snapshot */
  env?: Record<string, string>;
  /** Associated workspace ID */
  workspaceId: string;
  /** User ID who started the service */
  userId: string;
  /** Sandbox provider hosting this service (for preview URL generation) */
  sandboxProvider?: SandboxProviderType;
  /** Sandbox ID hosting this service (for preview URL generation) */
  sandboxId?: string;
}

export interface ServiceCreateOptions {
  name?: string;
  autoRestart?: boolean;
  env?: Record<string, string>;
}

// ============================================================================
// Service Name Inference
// ============================================================================

/** Common dev server commands and their inferred service names */
const SERVICE_NAME_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /npm\s+(run\s+)?dev/, name: 'dev-server' },
  { pattern: /npm\s+(run\s+)?start/, name: 'app-server' },
  { pattern: /npm\s+(run\s+)?build/, name: 'build' },
  { pattern: /pnpm\s+(run\s+)?dev/, name: 'dev-server' },
  { pattern: /yarn\s+dev/, name: 'dev-server' },
  { pattern: /next\s+dev/, name: 'nextjs' },
  { pattern: /\bvite\b/, name: 'vite-dev' },
  { pattern: /python.*manage\.py\s+runserver/, name: 'django' },
  { pattern: /flask\s+run/, name: 'flask' },
  { pattern: /\buvicorn\b/, name: 'fastapi' },
  { pattern: /\bgunicorn\b/, name: 'gunicorn' },
  { pattern: /node\s+server\b/, name: 'api-server' },
  { pattern: /node\s+app\b/, name: 'app-server' },
  { pattern: /python\s+.*\.py/, name: 'python-script' },
  { pattern: /\bpostgres\b/, name: 'postgres' },
  { pattern: /redis-server/, name: 'redis' },
  { pattern: /docker\s+(compose\s+)?up/, name: 'docker-compose' },
];

/** Infer a service name from the command string */
export function inferServiceName(command: string): string {
  for (const { pattern, name } of SERVICE_NAME_PATTERNS) {
    if (pattern.test(command)) return name;
  }
  // Default: use the first word of the command
  const firstWord = command.trim().split(/\s+/)[0];
  return firstWord || 'service';
}

// ============================================================================
// Service Log Buffer
// ============================================================================

const MAX_LOG_LINES = 500; // Rolling buffer size

/**
 * Append a log line to a service, maintaining the rolling buffer.
 */
function appendServiceLog(service: WorkspaceService, line: string): void {
  service.logs.push(line);
  if (service.logs.length > MAX_LOG_LINES) {
    service.logs.splice(0, service.logs.length - MAX_LOG_LINES);
  }
}

// ============================================================================
// Workspace Service Manager
// ============================================================================

export class WorkspaceServiceManager {
  /** Per-workspace service registries: workspaceId → Map<serviceId, WorkspaceService> */
  private registries = new Map<string, Map<string, WorkspaceService>>();
  /** Per-workspace port detector instances */
  private portDetectors = new Map<string, EnhancedPortDetector>();
  /** Auto-incrementing service ID counter per workspace */
  private idCounters = new Map<string, number>();

  /**
   * Create a new workspace service.
   */
  createService(
    workspaceId: string,
    userId: string,
    command: string,
    workingDir: string,
    options?: ServiceCreateOptions,
  ): WorkspaceService {
    const registry = this.getOrCreateRegistry(workspaceId);
    const counter = (this.idCounters.get(workspaceId) || 0) + 1;
    this.idCounters.set(workspaceId, counter);

    const serviceId = `svc-${workspaceId.slice(0, 8)}-${counter}`;
    const name = options?.name || inferServiceName(command);

    const service: WorkspaceService = {
      id: serviceId,
      name,
      command,
      workingDir,
      status: 'starting',
      ports: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      logs: [],
      autoRestart: options?.autoRestart ?? false,
      env: options?.env,
      workspaceId,
      userId,
    };

    registry.set(serviceId, service);
    logger.info('Workspace service created', { serviceId, name, command: command.slice(0, 80), workspaceId });

    return service;
  }

  /**
   * Update service status.
   */
  updateStatus(serviceId: string, workspaceId: string, status: ServiceStatus, exitCode?: number): void {
    const service = this.getService(serviceId, workspaceId);
    if (!service) return;

    service.status = status;
    service.lastActivityAt = Date.now();
    if (exitCode !== undefined) service.exitCode = exitCode;

    // If the service has a PID and is running, register it in the virtual PID registry
    if (status === 'running' && service.pid && service.provider) {
      virtualPidRegistry.registerProcess({
        workspaceId,
        realPid: service.pid,
        provider: service.provider,
        sandboxId: workspaceId, // Use workspaceId as sandboxId for now
        command: service.command,
        user: service.userId,
        isService: true,
        serviceId: service.id,
      });
    }

    // If the service stopped or crashed, unregister from the virtual PID registry
    if ((status === 'stopped' || status === 'crashed') && service.pid) {
      // Find and unregister the vPID for this service
      const processList = virtualPidRegistry.getProcessList(workspaceId);
      const mapping = processList.find(p => p.serviceId === serviceId);
      if (mapping) {
        virtualPidRegistry.unregisterProcess(workspaceId, mapping.vPid);
      }
    }

    logger.info('Service status updated', { serviceId, status, exitCode });
  }

  /**
   * Detect ports from service output and register them.
   */
  detectPorts(serviceId: string, workspaceId: string, output: string): PortDetectionResult[] {
    const service = this.getService(serviceId, workspaceId);
    if (!service) return [];

    const detector = this.getOrCreatePortDetector(workspaceId);
    const detected = detector.detectPorts(output);

    // Merge new ports into the service's port list
    for (const port of detected) {
      const existing = service.ports.find(p => p.port === port.port);
      if (!existing) {
        service.ports.push(port);
        logger.info('Port detected for service', {
          serviceId,
          service: service.name,
          port: port.port,
          protocol: port.protocol,
          confidence: port.confidence,
        });
      } else if (port.confidence === 'high' && existing.confidence !== 'high') {
        // Upgrade confidence if we got a high-confidence match
        Object.assign(existing, port);
      }
    }

    return detected;
  }

  /**
   * Feed output to a service — appends to log buffer, scans for ports,
   * and auto-registers detected ports as workspace previews.
   */
  feedOutput(serviceId: string, workspaceId: string, output: string): void {
    const service = this.getService(serviceId, workspaceId);
    if (!service) return;

    // Append to log buffer (split by lines for cleanliness)
    for (const line of output.split('\n')) {
      if (line.trim()) appendServiceLog(service, line);
    }

    service.lastActivityAt = Date.now();

    // Scan for ports
    const detectedPorts = this.detectPorts(serviceId, workspaceId, output);

    // Phase 8: Auto-register detected ports as workspace previews
    for (const port of detectedPorts) {
      try {
        workspacePreviewRegistry.registerPreview({
          workspaceId,
          serviceId: service.id,
          serviceName: service.name,
          port,
          provider: service.sandboxProvider,
          sandboxId: service.sandboxId,
        });
      } catch (err: any) {
        logger.warn('Failed to register preview for detected port', {
          port: port.port,
          service: service.name,
          error: err.message,
        });
      }
    }
  }

  /**
   * Get a service by ID.
   */
  getService(serviceId: string, workspaceId: string): WorkspaceService | undefined {
    const registry = this.registries.get(workspaceId);
    return registry?.get(serviceId);
  }

  /**
   * List all services in a workspace.
   */
  listServices(workspaceId: string): WorkspaceService[] {
    const registry = this.registries.get(workspaceId);
    if (!registry) return [];
    return Array.from(registry.values());
  }

  /**
   * Find services by name prefix.
   */
  findServicesByName(workspaceId: string, name: string): WorkspaceService[] {
    return this.listServices(workspaceId).filter(s => s.name.includes(name));
  }

  /**
   * Get all detected ports across all services in a workspace.
   */
  getWorkspacePorts(workspaceId: string): Array<{ service: WorkspaceService; port: PortDetectionResult }> {
    const result: Array<{ service: WorkspaceService; port: PortDetectionResult }> = [];
    for (const service of this.listServices(workspaceId)) {
      for (const port of service.ports) {
        result.push({ service, port });
      }
    }
    return result;
  }

  /**
   * Get service logs (returns the rolling buffer).
   */
  getServiceLogs(serviceId: string, workspaceId: string, maxLines?: number): string[] {
    const service = this.getService(serviceId, workspaceId);
    if (!service) return [];
    const logs = service.logs;
    if (maxLines && maxLines < logs.length) {
      return logs.slice(logs.length - maxLines);
    }
    return [...logs];
  }

  /**
   * Remove a service from the registry.
   */
  removeService(serviceId: string, workspaceId: string): boolean {
    const registry = this.registries.get(workspaceId);
    if (!registry) return false;

    const deleted = registry.delete(serviceId);
    if (deleted) {
      logger.info('Workspace service removed', { serviceId, workspaceId });
    }
    return deleted;
  }

  /**
   * Clear all services for a workspace.
   */
  clearWorkspace(workspaceId: string): void {
    this.registries.delete(workspaceId);
    this.portDetectors.delete(workspaceId);
    this.idCounters.delete(workspaceId);
    // Phase 8: Clear preview registry for this workspace too
    workspacePreviewRegistry.clearWorkspace(workspaceId);
    logger.info('Workspace services cleared', { workspaceId });
  }

  /**
   * Get a structured summary of all workspace services (for AI agents).
   * Returns a JSON-serializable object that AI can reason over.
   */
  getWorkspaceSummary(workspaceId: string): {
    services: Array<{
      id: string;
      name: string;
      command: string;
      status: ServiceStatus;
      ports: number[];
      uptime: number;
      logTail: string;
    }>;
    totalPorts: number[];
    runningCount: number;
    crashedCount: number;
  } {
    const services = this.listServices(workspaceId);
    const now = Date.now();

    const serviceSummaries = services.map(s => ({
      id: s.id,
      name: s.name,
      command: s.command.slice(0, 100),
      status: s.status,
      ports: s.ports.map(p => p.port),
      uptime: now - s.startedAt,
      logTail: s.logs.slice(-3).join(' ... '),
    }));

    const allPorts = [...new Set(services.flatMap(s => s.ports.map(p => p.port)))];

    return {
      services: serviceSummaries,
      totalPorts: allPorts,
      runningCount: services.filter(s => s.status === 'running').length,
      crashedCount: services.filter(s => s.status === 'crashed').length,
    };
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private getOrCreateRegistry(workspaceId: string): Map<string, WorkspaceService> {
    let registry = this.registries.get(workspaceId);
    if (!registry) {
      registry = new Map();
      this.registries.set(workspaceId, registry);
    }
    return registry;
  }

  private getOrCreatePortDetector(workspaceId: string): EnhancedPortDetector {
    let detector = this.portDetectors.get(workspaceId);
    if (!detector) {
      detector = new EnhancedPortDetector();
      this.portDetectors.set(workspaceId, detector);
    }
    return detector;
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceServiceManager = new WorkspaceServiceManager();
