/**
 * Service Health Monitor
 *
 * Periodic reachability probes for workspace services detected by
 * WorkspaceServiceManager. Closes the Phase 4 gap: "No service health
 * check / periodic reachability probe."
 *
 * Architecture:
 *   - On start, begins a periodic (configurable) health check cycle
 *   - Each cycle iterates over all 'running' services in all workspaces
 *   - For services with detected ports, probes port reachability via
 *     sandboxBridge.executeCommand (curl or nc inside the sandbox)
 *   - If a service is unreachable and has autoRestart=true, attempts
 *     to restart it by re-running the original command
 *   - Services failing health checks are marked as 'crashed'
 *   - All health transitions emit log events via createLogger
 *
 * Integration:
 *   - workspace-service-manager.ts creates and owns the monitor
 *   - Called after service creation and status updates
 *   - Works with the sandbox bridge for command execution
 *
 * @see lib/terminal/workspace-service-manager.ts — Service lifecycle
 * @see lib/sandbox/sandbox-service-bridge.ts — Sandbox command execution
 */

import { createLogger } from '@/lib/utils/logger';
import type { WorkspaceService, ServiceStatus } from './workspace-service-manager';

const logger = createLogger('ServiceHealthMonitor');

// ============================================================================
// Configuration
// ============================================================================

/** Interval between health check cycles (ms). */
const DEFAULT_CHECK_INTERVAL_MS = parseInt(
  process.env.SERVICE_HEALTH_CHECK_INTERVAL_MS || '60000',
  10,
); // 60 seconds

/** Timeout for individual health probe commands (ms). */
const PROBE_TIMEOUT_MS = parseInt(
  process.env.SERVICE_HEALTH_PROBE_TIMEOUT_MS || '5000',
  10,
);

/** Whether health checking is enabled. */
const ENABLED = process.env.SERVICE_HEALTH_CHECKS_ENABLED !== 'false';

/** Maximum consecutive failures before marking as crashed. */
const MAX_CONSECUTIVE_FAILURES = parseInt(
  process.env.SERVICE_HEALTH_MAX_FAILURES || '3',
  10,
);

// ============================================================================
// Types
// ============================================================================

export interface ServiceHealthStatus {
  serviceId: string;
  workspaceId: string;
  /** Whether the last probe succeeded */
  healthy: boolean;
  /** Consecutive failure count */
  consecutiveFailures: number;
  /** Timestamp of last health check */
  lastCheckedAt: number;
  /** Error message from the last failed probe */
  lastError?: string;
}

export interface HealthCheckResult {
  /** Total services checked */
  totalChecked: number;
  /** Services that passed */
  healthy: number;
  /** Services that failed */
  unhealthy: number;
  /** Services that were auto-restarted */
  restarted: number;
  /** Duration of the check cycle in ms */
  durationMs: number;
}

// ============================================================================
// Service Health Monitor
// ============================================================================

export class ServiceHealthMonitor {
  private healthStates = new Map<string, ServiceHealthStatus>();
  private checkTimer?: ReturnType<typeof setInterval>;
  private isRunning = false;

  /** Callback to get all running services across all workspaces. */
  private getServices: () => WorkspaceService[];

  /** Callback to restart a service by re-running its command. */
  private restartService: (serviceId: string, workspaceId: string) => Promise<boolean>;

  /** Callback to update service status. */
  private updateServiceStatus: (
    serviceId: string,
    workspaceId: string,
    status: ServiceStatus,
    exitCode?: number,
  ) => void;

  constructor(deps: {
    getServices: () => WorkspaceService[];
    restartService: (serviceId: string, workspaceId: string) => Promise<boolean>;
    updateServiceStatus: (
      serviceId: string,
      workspaceId: string,
      status: ServiceStatus,
      exitCode?: number,
    ) => void;
  }) {
    this.getServices = deps.getServices;
    this.restartService = deps.restartService;
    this.updateServiceStatus = deps.updateServiceStatus;
  }

  /**
   * Start periodic health checks.
   */
  start(): void {
    if (!ENABLED) {
      logger.info('Service health checks disabled via SERVICE_HEALTH_CHECKS_ENABLED');
      return;
    }

    if (this.isRunning) {
      logger.warn('Service health monitor already running');
      return;
    }

    this.isRunning = true;

    // Run initial check after a short delay (let services start up)
    setTimeout(() => this.performHealthCheck(), 10_000);

    this.checkTimer = setInterval(() => {
      this.performHealthCheck();
    }, DEFAULT_CHECK_INTERVAL_MS);

    logger.info('Service health monitor started', {
      intervalMs: DEFAULT_CHECK_INTERVAL_MS,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
      maxFailures: MAX_CONSECUTIVE_FAILURES,
    });
  }

  /**
   * Stop periodic health checks.
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    this.isRunning = false;
    logger.info('Service health monitor stopped');
  }

  /**
   * Get health status for a specific service.
   */
  getServiceHealth(serviceId: string): ServiceHealthStatus | undefined {
    return this.healthStates.get(serviceId);
  }

  /**
   * Get health statuses for all services in a workspace.
   */
  getWorkspaceHealth(workspaceId: string): ServiceHealthStatus[] {
    const results: ServiceHealthStatus[] = [];
    for (const state of this.healthStates.values()) {
      if (state.workspaceId === workspaceId) {
        results.push(state);
      }
    }
    return results;
  }

  /**
   * Check if the monitor is running.
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  // ==========================================================================
  // Health Check Cycle
  // ==========================================================================

  /**
   * Perform a full health check cycle on all running services.
   */
  private async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const services = this.getServices().filter((s) => s.status === 'running');

    if (services.length === 0) {
      return { totalChecked: 0, healthy: 0, unhealthy: 0, restarted: 0, durationMs: 0 };
    }

    let healthy = 0;
    let unhealthy = 0;
    let restarted = 0;

    // Check services in parallel for efficiency
    const results = await Promise.allSettled(
      services.map((svc) => this.checkService(svc)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const outcome = result.value;
        if (outcome === 'healthy') healthy++;
        else if (outcome === 'unhealthy') unhealthy++;
        else if (outcome === 'restarted') {
          unhealthy++;
          restarted++;
        }
      }
    }

    const durationMs = Date.now() - startTime;

    if (healthy + unhealthy > 0) {
      logger.info('Service health check cycle complete', {
        total: services.length,
        healthy,
        unhealthy,
        restarted,
        durationMs,
      });
    }

    return { totalChecked: services.length, healthy, unhealthy, restarted, durationMs };
  }

  /**
   * Check health of a single service.
   * Returns the outcome: 'healthy', 'unhealthy', or 'restarted'.
   */
  private async checkService(
    service: WorkspaceService,
  ): Promise<'healthy' | 'unhealthy' | 'restarted'> {
    const stateKey = `${service.workspaceId}:${service.id}`;

    try {
      // Step 1: Determine how to probe this service
      const isReachable = await this.probeService(service);

      // Step 2: Update health state
      if (isReachable) {
        // Reset failure counter on success
        this.healthStates.set(stateKey, {
          serviceId: service.id,
          workspaceId: service.workspaceId,
          healthy: true,
          consecutiveFailures: 0,
          lastCheckedAt: Date.now(),
        });
        return 'healthy';
      }

      // Service is unreachable
      const currentState = this.healthStates.get(stateKey);
      const failures = (currentState?.consecutiveFailures ?? 0) + 1;

      this.healthStates.set(stateKey, {
        serviceId: service.id,
        workspaceId: service.workspaceId,
        healthy: false,
        consecutiveFailures: failures,
        lastCheckedAt: Date.now(),
        lastError: 'port unreachable',
      });

      // Step 3: Check if we should mark as crashed or attempt restart
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        if (service.autoRestart && service.sandboxId) {
          // Attempt auto-restart
          logger.warn('Service unhealthy — attempting auto-restart', {
            serviceId: service.id,
            serviceName: service.name,
            failures,
            consecutiveFailures: failures,
          });

          const restarted = await this.restartService(service.id, service.workspaceId);

          if (restarted) {
            // Reset health state on successful restart
            this.healthStates.set(stateKey, {
              serviceId: service.id,
              workspaceId: service.workspaceId,
              healthy: true,
              consecutiveFailures: 0,
              lastCheckedAt: Date.now(),
            });
            return 'restarted';
          }
        }

        // Mark as crashed (restart failed or not enabled)
        logger.error('Service marked as crashed after repeated health check failures', {
          serviceId: service.id,
          serviceName: service.name,
          failures,
          autoRestart: service.autoRestart,
        });

        this.updateServiceStatus(service.id, service.workspaceId, 'crashed', -1);
        return 'unhealthy';
      }

      // Still below threshold — just log and continue
      logger.debug('Service health check failed (below threshold)', {
        serviceId: service.id,
        serviceName: service.name,
        failures,
        threshold: MAX_CONSECUTIVE_FAILURES,
      });
      return 'unhealthy';
    } catch (error: any) {
      logger.debug('Service health check error', {
        serviceId: service.id,
        serviceName: service.name,
        error: error.message,
      });
      return 'unhealthy';
    }
  }

  /**
   * Probe a service for reachability.
   *
   * Strategy (in priority order):
   *   1. If the service has detected ports, probe via curl inside the sandbox
   *   2. If no ports but sandbox attached, check if the process is still alive
   *   3. If no sandbox, skip (can't probe)
   */
  private async probeService(service: WorkspaceService): Promise<boolean> {
    // No sandbox attached — can't probe
    if (!service.sandboxId) {
      // For services without sandbox, check if they've had recent activity
      const idleTime = Date.now() - service.lastActivityAt;
      if (idleTime > 300_000) {
        // No activity for 5+ minutes and no sandbox — consider unhealthy
        return false;
      }
      // Assume healthy if recently active
      return true;
    }

    // Strategy 1: Probe detected ports via curl
    if (service.ports.length > 0) {
      for (const port of service.ports) {
        try {
          const reachable = await this.probePort(service.sandboxId, port.port);
          if (reachable) return true;
        } catch {
          // Try next port
        }
      }
      // All ports failed
      return false;
    }

    // Strategy 2: No ports detected — check process existence via ps
    if (service.pid) {
      try {
        const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
        const result = await sandboxBridge.executeCommand(
          service.sandboxId,
          `kill -0 ${service.pid} 2>/dev/null && echo "alive" || echo "dead"`,
          '/workspace',
        );
        return result?.output?.includes('alive') ?? false;
      } catch {
        return false;
      }
    }

    // Strategy 3: Check for recent activity as last resort
    const idleTime = Date.now() - service.lastActivityAt;
    return idleTime < 300_000; // 5 minutes
  }

  /**
   * Probe a specific port inside the sandbox.
   *
   * Tries curl first, falls back to a bash built-in TCP probe (/dev/tcp)
   * which works without any external binaries.
   */
  private async probePort(sandboxId: string, port: number): Promise<boolean> {
    try {
      const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
      const timeoutSec = Math.floor(PROBE_TIMEOUT_MS / 1000);

      // Strategy 1: curl (fast, gives HTTP status codes)
      const result = await sandboxBridge.executeCommand(
        sandboxId,
        `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time ${timeoutSec} http://localhost:${port} 2>/dev/null || echo "000"`,
        '/workspace',
      );

      const output = result?.output?.trim() ?? '';
      const statusCode = parseInt(output, 10);

      if (statusCode >= 200 && statusCode < 500) return true;

      // Strategy 2: bash built-in TCP probe (no external binary needed).
      // Falls through if curl returned 000 (not installed or connection refused).
      // Note: 5xx HTTP errors also fall through — the TCP probe will report
      // "open" but the service may be returning errors. For v1, "port is
      // listening" = healthy. A future refinement could distinguish HTTP health
      // from raw TCP reachability.
      const tcpResult = await sandboxBridge.executeCommand(
        sandboxId,
        `timeout ${timeoutSec} bash -c 'echo >/dev/tcp/localhost/${port}' 2>/dev/null && echo "open" || echo "closed"`,
        '/workspace',
      );

      return tcpResult?.output?.includes('open') ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Clean up health state for removed services.
   */
  cleanup(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of this.healthStates.keys()) {
      if (key.startsWith(prefix)) {
        this.healthStates.delete(key);
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const serviceHealthMonitor = new ServiceHealthMonitor({
  getServices: () => {
    // Lazy import to avoid circular dependency at module load time.
    // Accesses the service manager's registries directly to discover
    // all workspace IDs — this ensures the first health check cycle
    // works even when healthStates is empty.
    try {
      const { workspaceServiceManager } = require('./workspace-service-manager');
      const services: WorkspaceService[] = [];
      // Access the private registries Map to discover all active workspace IDs
      const registries: Map<string, Map<string, WorkspaceService>> =
        workspaceServiceManager['registries'];
      if (registries) {
        for (const [, registry] of registries) {
          for (const svc of registry.values()) {
            services.push(svc);
          }
        }
      }
      return services;
    } catch {
      return [];
    }
  },
  restartService: async (serviceId: string, workspaceId: string) => {
    try {
      const { workspaceServiceManager: wsm } = await import('./workspace-service-manager');
      const service = wsm.getService(serviceId, workspaceId);
      if (!service || !service.sandboxId) return false;

      const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');

      // Kill existing process if we have a PID
      if (service.pid) {
        try {
          await sandboxBridge.executeCommand(
            service.sandboxId,
            `kill ${service.pid} 2>/dev/null; sleep 1; kill -9 ${service.pid} 2>/dev/null`,
            service.workingDir,
          );
        } catch {
          // Process may already be dead
        }
      }

      // Re-run the original command (backgrounded) and capture the new PID
      const safeWorkingDir = service.workingDir.replace(/"/g, '\\"');
      const restartResult = await sandboxBridge.executeCommand(
        service.sandboxId,
        `cd "${safeWorkingDir}" && nohup ${service.command} > /dev/null 2>&1 & echo $!`,
        service.workingDir,
      );

      // Update the service's PID so subsequent health probes target the new process
      const newPidOutput = restartResult?.output?.trim() ?? '';
      const newPid = parseInt(newPidOutput, 10);
      const oldPid = service.pid;
      if (newPid && !isNaN(newPid)) {
        service.pid = newPid;
        logger.debug('Updated service PID after restart', {
          serviceId,
          oldPid,
          newPid,
        });
      }

      logger.info('Service auto-restarted via health monitor', {
        serviceId,
        serviceName: service.name,
        command: service.command.slice(0, 80),
        newPid,
      });

      return true;
    } catch (error: any) {
      logger.warn('Service auto-restart failed', {
        serviceId,
        error: error.message,
      });
      return false;
    }
  },
  updateServiceStatus: (serviceId, workspaceId, status, exitCode) => {
    try {
      const { workspaceServiceManager: wsm } = require('./workspace-service-manager');
      wsm.updateStatus(serviceId, workspaceId, status, exitCode);
    } catch {
      // Best-effort
    }
  },
});
