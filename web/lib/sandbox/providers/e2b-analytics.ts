/**
 * E2B Analytics & Metrics Tracking
 * 
 * Provides comprehensive analytics and metrics for E2B sandbox usage.
 * Tracks execution time, costs, resource usage, and performance.
 * 
 * Features:
 * - Execution metrics tracking
 * - Cost estimation
 * - Resource usage analytics
 * - Performance monitoring
 */

import { EventEmitter } from 'node:events';

/**
 * Execution metrics
 */
export interface ExecutionMetrics {
  /**
   * Sandbox ID
   */
  sandboxId: string;
  
  /**
   * Execution start time
   */
  startTime: number;
  
  /**
   * Execution end time
   */
  endTime?: number;
  
  /**
   * Execution duration in ms
   */
  duration?: number;
  
  /**
   * Commands executed
   */
  commandsExecuted: number;
  
  /**
   * Files created
   */
  filesCreated: number;
  
  /**
   * Files read
   */
  filesRead: number;
  
  /**
   * Files written
   */
  filesWritten: number;
  
  /**
   * CPU time used (estimated)
   */
  cpuTimeMs?: number;
  
  /**
   * Memory peak usage in MB
   */
  memoryPeakMB?: number;
  
  /**
   * Network bytes sent
   */
  networkSent: number;
  
  /**
   * Network bytes received
   */
  networkReceived: number;
}

/**
 * Cost breakdown
 */
export interface CostBreakdown {
  /**
   * Compute cost
   */
  compute: number;
  
  /**
   * Network cost
   */
  network: number;
  
  /**
   * Storage cost
   */
  storage: number;
  
  /**
   * Total cost
   */
  total: number;
  
  /**
   * Currency
   */
  currency: string;
}

/**
 * Usage statistics
 */
export interface UsageStats {
  /**
   * Total executions
   */
  totalExecutions: number;
  
  /**
   * Successful executions
   */
  successfulExecutions: number;
  
  /**
   * Failed executions
   */
  failedExecutions: number;
  
  /**
   * Average duration in ms
   */
  averageDuration: number;
  
  /**
   * Total cost
   */
  totalCost: number;
  
  /**
   * Total commands
   */
  totalCommands: number;
  
  /**
   * Total files operations
   */
  totalFileOps: number;
}

/**
 * E2B Analytics Manager
 * 
 * Tracks and analyzes E2B sandbox usage.
 */
export class E2BAnalyticsManager extends EventEmitter {
  private metrics: Map<string, ExecutionMetrics> = new Map();
  private completedMetrics: ExecutionMetrics[] = [];
  private readonly MAX_COMPLETED = 10000;
  
  // Pricing (example - update with actual E2B pricing)
  private readonly PRICING = {
    computePerSecond: 0.0001, // $0.0001 per second
    networkPerGB: 0.01, // $0.01 per GB
    storagePerGBMonth: 0.10, // $0.10 per GB per month
  };

  constructor() {
    super();
  }

  /**
   * Start tracking execution
   * 
   * @param sandboxId - Sandbox ID
   */
  startExecution(sandboxId: string): void {
    const metrics: ExecutionMetrics = {
      sandboxId,
      startTime: Date.now(),
      commandsExecuted: 0,
      filesCreated: 0,
      filesRead: 0,
      filesWritten: 0,
      networkSent: 0,
      networkReceived: 0,
    };

    this.metrics.set(sandboxId, metrics);
    this.emit('execution-started', metrics);
  }

  /**
   * End tracking execution
   * 
   * @param sandboxId - Sandbox ID
   * @param additionalMetrics - Additional metrics
   * @returns Completed metrics
   */
  endExecution(
    sandboxId: string,
    additionalMetrics?: Partial<ExecutionMetrics>
  ): ExecutionMetrics | null {
    const metrics = this.metrics.get(sandboxId);
    
    if (!metrics) {
      return null;
    }

    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    
    if (additionalMetrics) {
      Object.assign(metrics, additionalMetrics);
    }

    // Calculate CPU time (estimate based on duration and commands)
    metrics.cpuTimeMs = metrics.duration * 0.8; // Assume 80% CPU utilization
    
    // Store completed metrics
    this.completedMetrics.push(metrics);
    this.metrics.delete(sandboxId);

    // Enforce max completed
    if (this.completedMetrics.length > this.MAX_COMPLETED) {
      this.completedMetrics.shift();
    }

    this.emit('execution-completed', metrics);

    return metrics;
  }

  /**
   * Track command execution
   * 
   * @param sandboxId - Sandbox ID
   */
  trackCommand(sandboxId: string): void {
    const metrics = this.metrics.get(sandboxId);
    if (metrics) {
      metrics.commandsExecuted++;
    }
  }

  /**
   * Track file operation
   * 
   * @param sandboxId - Sandbox ID
   * @param type - Operation type
   */
  trackFileOp(sandboxId: string, type: 'create' | 'read' | 'write'): void {
    const metrics = this.metrics.get(sandboxId);
    if (metrics) {
      if (type === 'create') metrics.filesCreated++;
      else if (type === 'read') metrics.filesRead++;
      else if (type === 'write') metrics.filesWritten++;
    }
  }

  /**
   * Track network usage
   * 
   * @param sandboxId - Sandbox ID
   * @param sent - Bytes sent
   * @param received - Bytes received
   */
  trackNetwork(sandboxId: string, sent: number, received: number): void {
    const metrics = this.metrics.get(sandboxId);
    if (metrics) {
      metrics.networkSent += sent;
      metrics.networkReceived += received;
    }
  }

  /**
   * Get current metrics
   * 
   * @param sandboxId - Sandbox ID
   * @returns Current metrics or null
   */
  getCurrentMetrics(sandboxId: string): ExecutionMetrics | null {
    return this.metrics.get(sandboxId) || null;
  }

  /**
   * Get cost breakdown for execution
   * 
   * @param metrics - Execution metrics
   * @returns Cost breakdown
   */
  getCostBreakdown(metrics: ExecutionMetrics): CostBreakdown {
    const durationSeconds = (metrics.duration || 0) / 1000;
    const networkGB = (metrics.networkSent + metrics.networkReceived) / (1024 * 1024 * 1024);
    
    // Estimate storage (assume 100MB average per execution)
    const storageGB = 0.1 / 1024;
    const storageMonthly = storageGB * this.PRICING.storagePerGBMonth;
    const storageCost = storageMonthly / 30 / 24 / 60 / 60 * (metrics.duration || 0) / 1000;

    return {
      compute: durationSeconds * this.PRICING.computePerSecond,
      network: networkGB * this.PRICING.networkPerGB,
      storage: storageCost,
      total: durationSeconds * this.PRICING.computePerSecond + networkGB * this.PRICING.networkPerGB + storageCost,
      currency: 'USD',
    };
  }

  /**
   * Get usage statistics
   * 
   * @param durationMs - Duration in ms (default: 24h)
   * @returns Usage statistics
   */
  getUsageStats(durationMs: number = 24 * 60 * 60 * 1000): UsageStats {
    const cutoff = Date.now() - durationMs;
    const filtered = this.completedMetrics.filter(m => m.startTime >= cutoff);

    const totalExecutions = filtered.length;
    const successfulExecutions = filtered.filter(m => !m.endTime || (m.endTime - m.startTime) < 300000).length;
    const failedExecutions = totalExecutions - successfulExecutions;
    
    const totalDuration = filtered.reduce((sum, m) => sum + (m.duration || 0), 0);
    const averageDuration = totalExecutions > 0 ? totalDuration / totalExecutions : 0;
    
    const totalCost = filtered.reduce((sum, m) => {
      const cost = this.getCostBreakdown(m);
      return sum + cost.total;
    }, 0);
    
    const totalCommands = filtered.reduce((sum, m) => sum + m.commandsExecuted, 0);
    const totalFileOps = filtered.reduce((sum, m) => sum + m.filesCreated + m.filesRead + m.filesWritten, 0);

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageDuration,
      totalCost,
      totalCommands,
      totalFileOps,
    };
  }

  /**
   * Get top sandboxes by usage
   * 
   * @param limit - Max sandboxes to return
   * @param durationMs - Duration in ms
   * @returns Array of sandbox IDs with usage counts
   */
  getTopSandboxes(limit: number = 10, durationMs: number = 24 * 60 * 60 * 1000): Array<{
    sandboxId: string;
    executions: number;
    totalDuration: number;
    totalCost: number;
  }> {
    const cutoff = Date.now() - durationMs;
    const filtered = this.completedMetrics.filter(m => m.startTime >= cutoff);

    const sandboxUsage = new Map<string, {
      executions: number;
      totalDuration: number;
      totalCost: number;
    }>();

    for (const metrics of filtered) {
      const existing = sandboxUsage.get(metrics.sandboxId) || {
        executions: 0,
        totalDuration: 0,
        totalCost: 0,
      };

      existing.executions++;
      existing.totalDuration += metrics.duration || 0;
      existing.totalCost += this.getCostBreakdown(metrics).total;

      sandboxUsage.set(metrics.sandboxId, existing);
    }

    return Array.from(sandboxUsage.entries())
      .map(([sandboxId, data]) => ({
        sandboxId,
        ...data,
      }))
      .sort((a, b) => b.totalDuration - a.totalDuration)
      .slice(0, limit);
  }

  /**
   * Export metrics
   * 
   * @param format - Export format
   * @returns Exported data
   */
  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify({
        active: Array.from(this.metrics.values()),
        completed: this.completedMetrics,
      }, null, 2);
    } else {
      // CSV format
      const headers = 'sandboxId,startTime,endTime,duration,commandsExecuted,filesCreated,filesRead,filesWritten,networkSent,networkReceived\n';
      const rows = this.completedMetrics.map(m => 
        `${m.sandboxId},${m.startTime},${m.endTime || ''},${m.duration || ''},${m.commandsExecuted},${m.filesCreated},${m.filesRead},${m.filesWritten},${m.networkSent},${m.networkReceived}`
      ).join('\n');
      
      return headers + rows;
    }
  }

  /**
   * Clear metrics
   * 
   * @param sandboxId - Optional sandbox ID filter
   */
  clearMetrics(sandboxId?: string): void {
    if (sandboxId) {
      this.metrics.delete(sandboxId);
      this.completedMetrics = this.completedMetrics.filter(m => m.sandboxId !== sandboxId);
    } else {
      this.metrics.clear();
      this.completedMetrics = [];
    }
  }

  /**
   * Get analytics summary
   */
  getSummary(): {
    activeExecutions: number;
    completedExecutions: number;
    totalCostToday: number;
    averageExecutionTime: number;
    successRate: number;
  } {
    const now = Date.now();
    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    
    const todayMetrics = this.completedMetrics.filter(m => m.startTime >= todayStart);
    const totalCostToday = todayMetrics.reduce((sum, m) => sum + this.getCostBreakdown(m).total, 0);
    
    const averageExecutionTime = todayMetrics.length > 0
      ? todayMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / todayMetrics.length
      : 0;
    
    const successfulToday = todayMetrics.filter(m => !m.endTime || (m.endTime - m.startTime) < 300000).length;
    const successRate = todayMetrics.length > 0 ? (successfulToday / todayMetrics.length) * 100 : 0;

    return {
      activeExecutions: this.metrics.size,
      completedExecutions: this.completedMetrics.length,
      totalCostToday,
      averageExecutionTime,
      successRate,
    };
  }
}

// Singleton instance
export const e2bAnalytics = new E2BAnalyticsManager();

/**
 * Create analytics manager
 * 
 * @returns Analytics manager
 */
export function createE2BAnalytics(): E2BAnalyticsManager {
  return new E2BAnalyticsManager();
}

/**
 * Decorator for tracking execution
 * 
 * @param sandboxIdProperty - Property name containing sandbox ID
 */
export function trackExecution(sandboxIdProperty: string = 'sandboxId') {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const sandboxId = this[sandboxIdProperty];
      
      if (sandboxId) {
        e2bAnalytics.startExecution(sandboxId);
      }

      try {
        const result = await originalMethod.apply(this, args);
        
        if (sandboxId) {
          e2bAnalytics.endExecution(sandboxId);
        }
        
        return result;
      } catch (error) {
        if (sandboxId) {
          e2bAnalytics.endExecution(sandboxId);
        }
        throw error;
      }
    };

    return descriptor;
  };
}
