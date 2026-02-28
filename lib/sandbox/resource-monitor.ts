/**
 * Sandbox Resource Monitoring
 * 
 * Monitors sandbox resource usage (CPU, memory, disk, network).
 * Provides alerts and automatic scaling recommendations.
 * 
 * Features:
 * - Real-time resource monitoring
 * - Usage alerts
 * - Scaling recommendations
 * - Historical metrics
 */

import { EventEmitter } from 'events';

/**
 * Resource metrics
 */
export interface ResourceMetrics {
  /**
   * Sandbox ID
   */
  sandboxId: string;
  
  /**
   * CPU usage percentage (0-100)
   */
  cpuUsage: number;
  
  /**
   * Memory usage in MB
   */
  memoryUsage: number;
  
  /**
   * Memory limit in MB
   */
  memoryLimit: number;
  
  /**
   * Disk usage in MB
   */
  diskUsage: number;
  
  /**
   * Disk limit in MB
   */
  diskLimit: number;
  
  /**
   * Network bytes sent
   */
  networkSent: number;
  
  /**
   * Network bytes received
   */
  networkReceived: number;
  
  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Resource alert
 */
export interface ResourceAlert {
  /**
   * Alert ID
   */
  id: string;
  
  /**
   * Sandbox ID
   */
  sandboxId: string;
  
  /**
   * Alert type
   */
  type: 'cpu_high' | 'memory_high' | 'disk_high' | 'network_high';
  
  /**
   * Alert severity
   */
  severity: 'warning' | 'critical';
  
  /**
   * Current value
   */
  currentValue: number;
  
  /**
   * Threshold value
   */
  threshold: number;
  
  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Scaling recommendation
 */
export interface ScalingRecommendation {
  /**
   * Sandbox ID
   */
  sandboxId: string;
  
  /**
   * Recommended action
   */
  action: 'scale_up' | 'scale_down' | 'no_change';
  
  /**
   * Reason for recommendation
   */
  reason: string;
  
  /**
   * Recommended CPU
   */
  recommendedCpu?: number;
  
  /**
   * Recommended memory
   */
  recommendedMemory?: number;
  
  /**
   * Confidence score (0-1)
   */
  confidence: number;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  /**
   * CPU warning threshold (percentage)
   */
  cpuWarningThreshold: number;
  
  /**
   * CPU critical threshold (percentage)
   */
  cpuCriticalThreshold: number;
  
  /**
   * Memory warning threshold (percentage)
   */
  memoryWarningThreshold: number;
  
  /**
   * Memory critical threshold (percentage)
   */
  memoryCriticalThreshold: number;
  
  /**
   * Monitoring interval in ms
   */
  monitoringInterval: number;
}

/**
 * Sandbox Resource Monitor
 * 
 * Monitors and alerts on resource usage.
 */
export class SandboxResourceMonitor extends EventEmitter {
  private metrics: Map<string, ResourceMetrics[]> = new Map();
  private alerts: ResourceAlert[] = [];
  private config: MonitoringConfig;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly MAX_METRICS_PER_SANDBOX = 1000;
  
  private readonly DEFAULT_CONFIG: MonitoringConfig = {
    cpuWarningThreshold: 70,
    cpuCriticalThreshold: 90,
    memoryWarningThreshold: 70,
    memoryCriticalThreshold: 90,
    monitoringInterval: 5000, // 5 seconds
  };

  constructor(config?: Partial<MonitoringConfig>) {
    super();
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * Start monitoring sandbox
   * 
   * @param sandboxId - Sandbox ID
   */
  startMonitoring(sandboxId: string): void {
    if (this.monitoringIntervals.has(sandboxId)) {
      return;
    }

    // Initialize metrics array
    if (!this.metrics.has(sandboxId)) {
      this.metrics.set(sandboxId, []);
    }

    // Start monitoring interval
    const interval = setInterval(() => {
      this.collectMetrics(sandboxId);
    }, this.config.monitoringInterval);

    this.monitoringIntervals.set(sandboxId, interval);
    this.emit('monitoring-started', sandboxId);
  }

  /**
   * Stop monitoring sandbox
   * 
   * @param sandboxId - Sandbox ID
   */
  stopMonitoring(sandboxId: string): void {
    const interval = this.monitoringIntervals.get(sandboxId);
    
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(sandboxId);
      this.emit('monitoring-stopped', sandboxId);
    }
  }

  /**
   * Collect metrics from sandbox
   * 
   * @param sandboxId - Sandbox ID
   */
  async collectMetrics(sandboxId: string): Promise<void> {
    // In production, this would fetch from sandbox provider API
    // For now, simulate metrics collection
    const metrics: ResourceMetrics = {
      sandboxId,
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 1024,
      memoryLimit: 2048,
      diskUsage: Math.random() * 5000,
      diskLimit: 10000,
      networkSent: Math.floor(Math.random() * 1000000),
      networkReceived: Math.floor(Math.random() * 1000000),
      timestamp: Date.now(),
    };

    // Store metrics
    const sandboxMetrics = this.metrics.get(sandboxId) || [];
    sandboxMetrics.push(metrics);
    
    // Enforce max metrics
    if (sandboxMetrics.length > this.MAX_METRICS_PER_SANDBOX) {
      sandboxMetrics.shift();
    }
    
    this.metrics.set(sandboxId, sandboxMetrics);

    // Check thresholds and generate alerts
    this.checkThresholds(metrics);

    this.emit('metrics-collected', metrics);
  }

  /**
   * Check resource thresholds
   * 
   * @param metrics - Resource metrics
   */
  private checkThresholds(metrics: ResourceMetrics): void {
    // CPU checks
    const cpuPercentage = metrics.cpuUsage;
    if (cpuPercentage >= this.config.cpuCriticalThreshold) {
      this.generateAlert(metrics.sandboxId, 'cpu_high', 'critical', cpuPercentage, this.config.cpuCriticalThreshold);
    } else if (cpuPercentage >= this.config.cpuWarningThreshold) {
      this.generateAlert(metrics.sandboxId, 'cpu_high', 'warning', cpuPercentage, this.config.cpuWarningThreshold);
    }

    // Memory checks
    const memoryPercentage = (metrics.memoryUsage / metrics.memoryLimit) * 100;
    if (memoryPercentage >= this.config.memoryCriticalThreshold) {
      this.generateAlert(metrics.sandboxId, 'memory_high', 'critical', memoryPercentage, this.config.memoryCriticalThreshold);
    } else if (memoryPercentage >= this.config.memoryWarningThreshold) {
      this.generateAlert(metrics.sandboxId, 'memory_high', 'warning', memoryPercentage, this.config.memoryWarningThreshold);
    }
  }

  /**
   * Generate alert
   * 
   * @param sandboxId - Sandbox ID
   * @param type - Alert type
   * @param severity - Alert severity
   * @param currentValue - Current value
   * @param threshold - Threshold value
   */
  private generateAlert(
    sandboxId: string,
    type: ResourceAlert['type'],
    severity: ResourceAlert['severity'],
    currentValue: number,
    threshold: number
  ): void {
    // Check if we already have a recent alert of this type
    const recentAlert = this.alerts.find(
      a => a.sandboxId === sandboxId && 
           a.type === type && 
           Date.now() - a.timestamp < 60000 // 1 minute cooldown
    );

    if (recentAlert) {
      return;
    }

    const alert: ResourceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sandboxId,
      type,
      severity,
      currentValue,
      threshold,
      timestamp: Date.now(),
    };

    this.alerts.push(alert);
    this.emit('alert', alert);
  }

  /**
   * Get current metrics for sandbox
   * 
   * @param sandboxId - Sandbox ID
   * @returns Current metrics or null
   */
  getCurrentMetrics(sandboxId: string): ResourceMetrics | null {
    const sandboxMetrics = this.metrics.get(sandboxId);
    
    if (!sandboxMetrics || sandboxMetrics.length === 0) {
      return null;
    }

    return sandboxMetrics[sandboxMetrics.length - 1];
  }

  /**
   * Get historical metrics
   * 
   * @param sandboxId - Sandbox ID
   * @param durationMs - Duration in ms
   * @returns Array of metrics
   */
  getHistoricalMetrics(sandboxId: string, durationMs: number = 3600000): ResourceMetrics[] {
    const sandboxMetrics = this.metrics.get(sandboxId) || [];
    const cutoff = Date.now() - durationMs;
    
    return sandboxMetrics.filter(m => m.timestamp >= cutoff);
  }

  /**
   * Get alerts for sandbox
   * 
   * @param sandboxId - Sandbox ID
   * @param durationMs - Duration in ms
   * @returns Array of alerts
   */
  getAlerts(sandboxId: string, durationMs: number = 3600000): ResourceAlert[] {
    const cutoff = Date.now() - durationMs;
    
    return this.alerts.filter(
      a => a.sandboxId === sandboxId && a.timestamp >= cutoff
    );
  }

  /**
   * Get scaling recommendation
   * 
   * @param sandboxId - Sandbox ID
   * @returns Scaling recommendation
   */
  getScalingRecommendation(sandboxId: string): ScalingRecommendation {
    const metrics = this.getHistoricalMetrics(sandboxId, 300000); // Last 5 minutes
    
    if (metrics.length === 0) {
      return {
        sandboxId,
        action: 'no_change',
        reason: 'No metrics available',
        confidence: 0,
      };
    }

    // Calculate averages
    const avgCpu = metrics.reduce((sum, m) => sum + m.cpuUsage, 0) / metrics.length;
    const avgMemory = metrics.reduce((sum, m) => sum + m.memoryUsage, 0) / metrics.length;
    const avgMemoryPercentage = (avgMemory / metrics[0].memoryLimit) * 100;

    // Determine action
    let action: ScalingRecommendation['action'] = 'no_change';
    let reason = 'Resource usage within normal range';
    let recommendedCpu: number | undefined;
    let recommendedMemory: number | undefined;
    let confidence = 0.8;

    if (avgCpu > 80 || avgMemoryPercentage > 80) {
      action = 'scale_up';
      reason = `High resource usage: CPU ${avgCpu.toFixed(1)}%, Memory ${avgMemoryPercentage.toFixed(1)}%`;
      recommendedCpu = avgCpu > 80 ? 2 : undefined;
      recommendedMemory = avgMemoryPercentage > 80 ? 4096 : undefined;
      confidence = 0.9;
    } else if (avgCpu < 20 && avgMemoryPercentage < 20) {
      action = 'scale_down';
      reason = `Low resource usage: CPU ${avgCpu.toFixed(1)}%, Memory ${avgMemoryPercentage.toFixed(1)}%`;
      recommendedCpu = 0.5;
      recommendedMemory = 512;
      confidence = 0.7;
    }

    const recommendation: ScalingRecommendation = {
      sandboxId,
      action,
      reason,
      recommendedCpu,
      recommendedMemory,
      confidence,
    };

    this.emit('scaling-recommendation', recommendation);

    return recommendation;
  }

  /**
   * Get all sandbox IDs being monitored
   * 
   * @returns Array of sandbox IDs
   */
  getMonitoredSandboxes(): string[] {
    return Array.from(this.monitoringIntervals.keys());
  }

  /**
   * Get monitoring statistics
   */
  getStats(): {
    monitoredSandboxes: number;
    totalAlerts: number;
    activeAlerts: number;
    totalMetrics: number;
  } {
    const now = Date.now();
    const activeAlerts = this.alerts.filter(a => now - a.timestamp < 300000).length;
    const totalMetrics = Array.from(this.metrics.values()).reduce(
      (sum, m) => sum + m.length,
      0
    );

    return {
      monitoredSandboxes: this.monitoringIntervals.size,
      totalAlerts: this.alerts.length,
      activeAlerts,
      totalMetrics,
    };
  }

  /**
   * Clear alerts
   * 
   * @param sandboxId - Optional sandbox ID filter
   */
  clearAlerts(sandboxId?: string): void {
    if (sandboxId) {
      this.alerts = this.alerts.filter(a => a.sandboxId !== sandboxId);
    } else {
      this.alerts = [];
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
    } else {
      this.metrics.clear();
    }
  }

  /**
   * Destroy monitor
   */
  destroy(): void {
    // Stop all monitoring
    for (const sandboxId of this.getMonitoredSandboxes()) {
      this.stopMonitoring(sandboxId);
    }
    
    this.clearAlerts();
    this.clearMetrics();
    this.removeAllListeners();
  }
}

/**
 * Create resource monitor
 * 
 * @param config - Monitoring configuration
 * @returns Resource monitor
 */
export function createResourceMonitor(config?: Partial<MonitoringConfig>): SandboxResourceMonitor {
  return new SandboxResourceMonitor(config);
}

/**
 * Quick monitoring helper
 * 
 * @param sandboxId - Sandbox ID
 * @param durationMs - Monitoring duration
 * @returns Promise that resolves after duration
 */
export async function quickMonitor(
  sandboxId: string,
  durationMs: number = 60000
): Promise<ResourceMetrics[]> {
  const monitor = createResourceMonitor();
  
  return new Promise((resolve) => {
    const metrics: ResourceMetrics[] = [];
    
    monitor.on('metrics-collected', (m) => {
      if (m.sandboxId === sandboxId) {
        metrics.push(m);
      }
    });
    
    monitor.startMonitoring(sandboxId);
    
    setTimeout(() => {
      monitor.stopMonitoring(sandboxId);
      monitor.destroy();
      resolve(metrics);
    }, durationMs);
  });
}
