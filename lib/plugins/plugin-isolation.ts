/**
 * Plugin Isolation System
 * Provides sandboxing, resource monitoring, and error isolation for plugins
 */

export interface PluginResourceLimits {
  maxMemoryMB: number;
  maxCpuPercent: number;
  maxNetworkRequests: number;
  maxStorageKB: number;
  timeoutMs: number;
}

export interface PluginResourceUsage {
  memoryMB: number;
  cpuPercent: number;
  networkRequests: number;
  storageKB: number;
  executionTimeMs: number;
}

export interface PluginError {
  id: string;
  pluginId: string;
  type: 'runtime' | 'resource' | 'timeout' | 'security' | 'dependency';
  message: string;
  stack?: string;
  timestamp: number;
  recoverable: boolean;
}

export interface PluginIsolationConfig {
  sandboxed: boolean;
  resourceLimits: PluginResourceLimits;
  errorRecovery: boolean;
  autoRestart: boolean;
  maxRestarts: number;
  restartCooldownMs: number;
}

export interface PluginSandbox {
  id: string;
  pluginId: string;
  status: 'initializing' | 'running' | 'paused' | 'error' | 'terminated';
  resourceUsage: PluginResourceUsage;
  errors: PluginError[];
  restartCount: number;
  lastRestart?: number;
  createdAt: number;
}

export class PluginIsolationManager {
  private sandboxes = new Map<string, PluginSandbox>();
  private resourceMonitors = new Map<string, NodeJS.Timeout>();
  private errorHandlers = new Map<string, (error: PluginError) => void>();
  private defaultLimits: PluginResourceLimits = {
    maxMemoryMB: 100,
    maxCpuPercent: 25,
    maxNetworkRequests: 50,
    maxStorageKB: 1024,
    timeoutMs: 30000
  };

  /**
   * Create an isolated sandbox for a plugin
   */
  createSandbox(
    pluginId: string, 
    config: Partial<PluginIsolationConfig> = {}
  ): string {
    const sandboxId = `sandbox_${pluginId}_${Date.now()}`;
    const fullConfig: PluginIsolationConfig = {
      sandboxed: true,
      resourceLimits: { ...this.defaultLimits, ...config.resourceLimits },
      errorRecovery: true,
      autoRestart: true,
      maxRestarts: 3,
      restartCooldownMs: 5000,
      ...config
    };

    const sandbox: PluginSandbox = {
      id: sandboxId,
      pluginId,
      status: 'initializing',
      resourceUsage: {
        memoryMB: 0,
        cpuPercent: 0,
        networkRequests: 0,
        storageKB: 0,
        executionTimeMs: 0
      },
      errors: [],
      restartCount: 0,
      createdAt: Date.now()
    };

    this.sandboxes.set(sandboxId, sandbox);
    
    if (fullConfig.sandboxed) {
      this.startResourceMonitoring(sandboxId, fullConfig);
    }

    return sandboxId;
  }

  /**
   * Execute plugin code within the sandbox
   */
  async executeInSandbox<T>(
    sandboxId: string,
    operation: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    if (sandbox.status === 'error' || sandbox.status === 'terminated') {
      throw new Error(`Sandbox ${sandboxId} is in ${sandbox.status} state`);
    }

    const startTime = Date.now();
    sandbox.status = 'running';

    try {
      // Create timeout promise
      const timeout = timeoutMs || this.defaultLimits.timeoutMs;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Plugin execution timeout after ${timeout}ms`));
        }, timeout);
      });

      // Execute with timeout
      const result = await Promise.race([
        operation(),
        timeoutPromise
      ]);

      // Update execution time
      sandbox.resourceUsage.executionTimeMs += Date.now() - startTime;
      
      return result;
    } catch (error) {
      const pluginError: PluginError = {
        id: `error_${Date.now()}`,
        pluginId: sandbox.pluginId,
        type: error instanceof Error && error.message.includes('timeout') ? 'timeout' : 'runtime',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
        recoverable: true
      };

      sandbox.errors.push(pluginError);
      sandbox.status = 'error';

      // Trigger error handler
      const errorHandler = this.errorHandlers.get(sandbox.pluginId);
      if (errorHandler) {
        errorHandler(pluginError);
      }

      // Attempt recovery if enabled
      await this.handlePluginError(sandboxId, pluginError);

      throw error;
    }
  }

  /**
   * Start monitoring resource usage for a sandbox
   */
  private startResourceMonitoring(
    sandboxId: string, 
    config: PluginIsolationConfig
  ): void {
    const monitor = setInterval(() => {
      this.checkResourceUsage(sandboxId, config.resourceLimits);
    }, 1000); // Check every second

    this.resourceMonitors.set(sandboxId, monitor);
  }

  /**
   * Check if plugin is exceeding resource limits
   */
  private checkResourceUsage(
    sandboxId: string, 
    limits: PluginResourceLimits
  ): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status !== 'running') return;

    const usage = this.getCurrentResourceUsage(sandboxId);
    sandbox.resourceUsage = usage;

    // Check memory limit
    if (usage.memoryMB > limits.maxMemoryMB) {
      this.handleResourceViolation(sandboxId, 'memory', usage.memoryMB, limits.maxMemoryMB);
    }

    // Check CPU limit
    if (usage.cpuPercent > limits.maxCpuPercent) {
      this.handleResourceViolation(sandboxId, 'cpu', usage.cpuPercent, limits.maxCpuPercent);
    }

    // Check network requests
    if (usage.networkRequests > limits.maxNetworkRequests) {
      this.handleResourceViolation(sandboxId, 'network', usage.networkRequests, limits.maxNetworkRequests);
    }

    // Check storage usage
    if (usage.storageKB > limits.maxStorageKB) {
      this.handleResourceViolation(sandboxId, 'storage', usage.storageKB, limits.maxStorageKB);
    }
  }

  /**
   * Get current resource usage (simplified implementation)
   */
  private getCurrentResourceUsage(sandboxId: string): PluginResourceUsage {
    // In a real implementation, this would measure actual resource usage
    // For now, we'll simulate with basic tracking
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return {
        memoryMB: 0,
        cpuPercent: 0,
        networkRequests: 0,
        storageKB: 0,
        executionTimeMs: 0
      };
    }

    // Simulate resource usage growth over time
    const runtime = Date.now() - sandbox.createdAt;
    return {
      memoryMB: Math.min(50, runtime / 1000), // Simulate memory growth
      cpuPercent: Math.random() * 20, // Simulate CPU usage
      networkRequests: sandbox.resourceUsage.networkRequests,
      storageKB: sandbox.resourceUsage.storageKB,
      executionTimeMs: sandbox.resourceUsage.executionTimeMs
    };
  }

  /**
   * Handle resource limit violations
   */
  private handleResourceViolation(
    sandboxId: string,
    resource: string,
    current: number,
    limit: number
  ): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;

    const error: PluginError = {
      id: `resource_${Date.now()}`,
      pluginId: sandbox.pluginId,
      type: 'resource',
      message: `Resource limit exceeded: ${resource} (${current} > ${limit})`,
      timestamp: Date.now(),
      recoverable: false
    };

    sandbox.errors.push(error);
    sandbox.status = 'error';

    // Pause the plugin to prevent further resource consumption
    this.pauseSandbox(sandboxId);

    // Trigger error handler
    const errorHandler = this.errorHandlers.get(sandbox.pluginId);
    if (errorHandler) {
      errorHandler(error);
    }
  }

  /**
   * Handle plugin errors with recovery mechanisms
   */
  private async handlePluginError(
    sandboxId: string,
    error: PluginError
  ): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;

    // Check if error is recoverable
    if (!error.recoverable) {
      sandbox.status = 'terminated';
      this.terminateSandbox(sandboxId);
      return;
    }

    // Attempt restart if auto-restart is enabled
    const config = this.getConfigForSandbox(sandboxId);
    if (config?.autoRestart && sandbox.restartCount < (config.maxRestarts || 3)) {
      await this.restartSandbox(sandboxId, config);
    } else {
      sandbox.status = 'terminated';
      this.terminateSandbox(sandboxId);
    }
  }

  /**
   * Restart a failed sandbox
   */
  private async restartSandbox(
    sandboxId: string,
    config: PluginIsolationConfig
  ): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;

    // Check cooldown period
    if (sandbox.lastRestart && 
        Date.now() - sandbox.lastRestart < config.restartCooldownMs) {
      return;
    }

    sandbox.restartCount++;
    sandbox.lastRestart = Date.now();
    sandbox.status = 'initializing';
    sandbox.resourceUsage = {
      memoryMB: 0,
      cpuPercent: 0,
      networkRequests: 0,
      storageKB: 0,
      executionTimeMs: 0
    };

    // Clear recent errors
    sandbox.errors = sandbox.errors.slice(-5); // Keep last 5 errors

    // Restart resource monitoring
    this.stopResourceMonitoring(sandboxId);
    this.startResourceMonitoring(sandboxId, config);

    sandbox.status = 'running';
  }

  /**
   * Pause a sandbox
   */
  pauseSandbox(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      sandbox.status = 'paused';
      this.stopResourceMonitoring(sandboxId);
    }
  }

  /**
   * Resume a paused sandbox
   */
  resumeSandbox(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox && sandbox.status === 'paused') {
      sandbox.status = 'running';
      const config = this.getConfigForSandbox(sandboxId);
      if (config) {
        this.startResourceMonitoring(sandboxId, config);
      }
    }
  }

  /**
   * Terminate a sandbox and clean up resources
   */
  terminateSandbox(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      sandbox.status = 'terminated';
      this.stopResourceMonitoring(sandboxId);
      this.sandboxes.delete(sandboxId);
    }
  }

  /**
   * Stop resource monitoring for a sandbox
   */
  private stopResourceMonitoring(sandboxId: string): void {
    const monitor = this.resourceMonitors.get(sandboxId);
    if (monitor) {
      clearInterval(monitor);
      this.resourceMonitors.delete(sandboxId);
    }
  }

  /**
   * Register error handler for a plugin
   */
  registerErrorHandler(
    pluginId: string, 
    handler: (error: PluginError) => void
  ): void {
    this.errorHandlers.set(pluginId, handler);
  }

  /**
   * Get sandbox information
   */
  getSandboxInfo(sandboxId: string): PluginSandbox | undefined {
    return this.sandboxes.get(sandboxId);
  }

  /**
   * Get all sandboxes for a plugin
   */
  getPluginSandboxes(pluginId: string): PluginSandbox[] {
    return Array.from(this.sandboxes.values())
      .filter(sandbox => sandbox.pluginId === pluginId);
  }

  /**
   * Get configuration for a sandbox (simplified)
   */
  private getConfigForSandbox(sandboxId: string): PluginIsolationConfig | null {
    // In a real implementation, this would retrieve the stored config
    return {
      sandboxed: true,
      resourceLimits: this.defaultLimits,
      errorRecovery: true,
      autoRestart: true,
      maxRestarts: 3,
      restartCooldownMs: 5000
    };
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    // Stop all monitors
    for (const monitor of this.resourceMonitors.values()) {
      clearInterval(monitor);
    }
    this.resourceMonitors.clear();

    // Clear all sandboxes
    this.sandboxes.clear();
    this.errorHandlers.clear();
  }
}

// Global instance
export const pluginIsolationManager = new PluginIsolationManager();