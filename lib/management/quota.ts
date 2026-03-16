/**
 * Resource Quotas
 * Provides per-sandbox resource limiting and rate limiting
 * Migrated from ephemeral/serverless_workers_sdk/quota.py
 */

import { EventEmitter } from 'node:events';

export interface QuotaConfig {
  maxExecutionsPerHour: number;
  maxConcurrentSandboxes: number;
  maxMemoryMB: number;
  maxStorageMB: number;
  maxCpuCores: number;
  maxNetworkEgressMB: number;
  warningThreshold: number; // Percentage at which to warn (e.g., 80 for 80%)
}

export interface UsageRecord {
  sandboxId: string;
  executions: number;
  memoryMB: number;
  storageMB: number;
  cpuCores: number;
  networkEgressMB: number;
  lastUpdated: Date;
}

export interface QuotaViolation {
  sandboxId: string;
  type: 'execution_rate' | 'concurrent_sandboxes' | 'memory' | 'storage' | 'cpu' | 'network';
  limit: number;
  current: number;
  timestamp: Date;
}

const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  maxExecutionsPerHour: 1000,
  maxConcurrentSandboxes: 10,
  maxMemoryMB: 2048,
  maxStorageMB: 10240, // 10GB
  maxCpuCores: 4,
  maxNetworkEgressMB: 1024, // 1GB
  warningThreshold: 80,
};

export class QuotaManager extends EventEmitter {
  private readonly config: QuotaConfig;
  private usage: Map<string, UsageRecord> = new Map();
  private executionWindows: Map<string, { timestamp: number; count: number }[]> = new Map();
  private violations: QuotaViolation[] = [];

  constructor(config: Partial<QuotaConfig> = {}) {
    super();
    this.config = { ...DEFAULT_QUOTA_CONFIG, ...config };
    
    // Start cleanup interval for old execution windows
    this.startCleanupInterval();
  }

  /**
   * Configure the quota manager with new settings
   */
  configure(config: { maxExecutionsPerHour?: number; maxStorageMB?: number }): void {
    if (config.maxExecutionsPerHour !== undefined) {
      (this.config as any).maxExecutionsPerHour = config.maxExecutionsPerHour;
    }
    if (config.maxStorageMB !== undefined) {
      (this.config as any).maxStorageMB = config.maxStorageMB;
    }
  }

  /**
   * Check if an execution is allowed for the given sandbox
   */
  allowExecution(sandboxId: string): boolean {
    const now = Date.now();
    const windowStart = now - (60 * 60 * 1000); // 1 hour window

    // Get or create execution window for this sandbox
    let windows = this.executionWindows.get(sandboxId) || [];
    
    // Remove old windows outside the 1-hour window
    windows = windows.filter(w => w.timestamp > windowStart);
    
    // Calculate total executions in the window
    const totalExecutions = windows.reduce((sum, w) => sum + w.count, 0);

    if (totalExecutions >= this.config.maxExecutionsPerHour) {
      this.recordViolation(sandboxId, 'execution_rate', this.config.maxExecutionsPerHour, totalExecutions);
      return false;
    }

    // Check warning threshold
    const usagePercentage = (totalExecutions / this.config.maxExecutionsPerHour) * 100;
    if (usagePercentage >= this.config.warningThreshold) {
      this.emit('warning', {
        sandboxId,
        type: 'execution_rate',
        percentage: usagePercentage,
        limit: this.config.maxExecutionsPerHour,
        current: totalExecutions,
      });
    }

    // Record this execution
    const existingWindow = windows.find(w => w.timestamp === now);
    if (existingWindow) {
      existingWindow.count++;
    } else {
      windows.push({ timestamp: now, count: 1 });
    }

    this.executionWindows.set(sandboxId, windows);
    this.updateUsage(sandboxId, { executions: totalExecutions + 1 });

    return true;
  }

  /**
   * Record resource usage for a sandbox
   */
  recordUsage(sandboxId: string, usage: Partial<UsageRecord>): void {
    const record = this.usage.get(sandboxId) || this.createUsageRecord(sandboxId);
    
    if (usage.memoryMB !== undefined) record.memoryMB = usage.memoryMB;
    if (usage.storageMB !== undefined) record.storageMB = usage.storageMB;
    if (usage.cpuCores !== undefined) record.cpuCores = usage.cpuCores;
    if (usage.networkEgressMB !== undefined) record.networkEgressMB = usage.networkEgressMB;
    record.lastUpdated = new Date();

    this.usage.set(sandboxId, record);
    this.checkQuotaLimits(sandboxId, record);
  }

  /**
   * Update usage record (for execution count)
   */
  private updateUsage(sandboxId: string, updates: Partial<UsageRecord>): void {
    const record = this.usage.get(sandboxId) || this.createUsageRecord(sandboxId);
    Object.assign(record, updates);
    record.lastUpdated = new Date();
    this.usage.set(sandboxId, record);
  }

  /**
   * Create a new usage record
   */
  private createUsageRecord(sandboxId: string): UsageRecord {
    return {
      sandboxId,
      executions: 0,
      memoryMB: 0,
      storageMB: 0,
      cpuCores: 0,
      networkEgressMB: 0,
      lastUpdated: new Date(),
    };
  }

  /**
   * Check if usage exceeds quota limits
   */
  private checkQuotaLimits(sandboxId: string, record: UsageRecord): void {
    // Check memory
    if (record.memoryMB > this.config.maxMemoryMB) {
      this.recordViolation(sandboxId, 'memory', this.config.maxMemoryMB, record.memoryMB);
    } else if (record.memoryMB >= this.config.maxMemoryMB * (this.config.warningThreshold / 100)) {
      this.emit('warning', {
        sandboxId,
        type: 'memory',
        percentage: (record.memoryMB / this.config.maxMemoryMB) * 100,
        limit: this.config.maxMemoryMB,
        current: record.memoryMB,
      });
    }

    // Check storage
    if (record.storageMB > this.config.maxStorageMB) {
      this.recordViolation(sandboxId, 'storage', this.config.maxStorageMB, record.storageMB);
    } else if (record.storageMB >= this.config.maxStorageMB * (this.config.warningThreshold / 100)) {
      this.emit('warning', {
        sandboxId,
        type: 'storage',
        percentage: (record.storageMB / this.config.maxStorageMB) * 100,
        limit: this.config.maxStorageMB,
        current: record.storageMB,
      });
    }

    // Check CPU
    if (record.cpuCores > this.config.maxCpuCores) {
      this.recordViolation(sandboxId, 'cpu', this.config.maxCpuCores, record.cpuCores);
    }

    // Check network
    if (record.networkEgressMB > this.config.maxNetworkEgressMB) {
      this.recordViolation(sandboxId, 'network', this.config.maxNetworkEgressMB, record.networkEgressMB);
    }
  }

  /**
   * Record a quota violation
   */
  private recordViolation(
    sandboxId: string,
    type: QuotaViolation['type'],
    limit: number,
    current: number
  ): void {
    const violation: QuotaViolation = {
      sandboxId,
      type,
      limit,
      current,
      timestamp: new Date(),
    };

    this.violations.push(violation);
    this.emit('violation', violation);

    // Keep only last 1000 violations
    if (this.violations.length > 1000) {
      this.violations = this.violations.slice(-1000);
    }
  }

  /**
   * Get current usage for a sandbox
   */
  getUsage(sandboxId: string): UsageRecord | null {
    return this.usage.get(sandboxId) || null;
  }

  /**
   * Get all usage records
   */
  getAllUsage(): UsageRecord[] {
    return Array.from(this.usage.values());
  }

  /**
   * Get violations for a sandbox
   */
  getViolations(sandboxId?: string): QuotaViolation[] {
    if (sandboxId) {
      return this.violations.filter(v => v.sandboxId === sandboxId);
    }
    return this.violations;
  }

  /**
   * Reset usage for a sandbox
   */
  resetUsage(sandboxId: string): void {
    this.usage.delete(sandboxId);
    this.executionWindows.delete(sandboxId);
    this.emit('reset', sandboxId);
  }

  /**
   * Start cleanup interval for old execution windows
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      const windowStart = now - (60 * 60 * 1000); // 1 hour window

      for (const [sandboxId, windows] of this.executionWindows.entries()) {
        const filtered = windows.filter(w => w.timestamp > windowStart);
        if (filtered.length === 0) {
          this.executionWindows.delete(sandboxId);
        } else {
          this.executionWindows.set(sandboxId, filtered);
        }
      }
    }, 60 * 1000); // Run every minute
  }

  /**
   * Get quota configuration
   */
  getConfig(): QuotaConfig {
    return { ...this.config };
  }

  /**
   * Update quota configuration
   */
  updateConfig(newConfig: Partial<QuotaConfig>): void {
    Object.assign(this.config, newConfig);
    this.emit('config_updated', this.config);
  }
}

// Singleton instance
export const quotaManager = new QuotaManager();
