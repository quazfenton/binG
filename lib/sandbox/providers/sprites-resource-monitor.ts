/**
 * Sprites Resource Monitoring
 * 
 * Provides detailed monitoring for Sprites including memory, NVMe, and CPU.
 * Enables proactive resource management and alerting.
 * 
 * Features:
 * - Memory usage monitoring
 * - NVMe storage monitoring
 * - CPU usage tracking
 * - Resource alerts
 */

import { EventEmitter } from 'events';
import { generateSecureId } from '@/lib/utils';

/**
 * Resource metrics
 */
export interface SpritesResourceMetrics {
  /**
   * Sprite ID
   */
  spriteId: string;
  
  /**
   * Memory usage in MB
   */
  memoryUsed: number;
  
  /**
   * Memory limit in MB
   */
  memoryLimit: number;
  
  /**
   * Memory usage percentage
   */
  memoryPercentage: number;
  
  /**
   * NVMe used in GB
   */
  nvmeUsed: number;
  
  /**
   * NVMe limit in GB
   */
  nvmeLimit: number;
  
  /**
   * NVMe usage percentage
   */
  nvmePercentage: number;
  
  /**
   * CPU usage percentage
   */
  cpuPercentage: number;
  
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
   * Sprite ID
   */
  spriteId: string;
  
  /**
   * Resource type
   */
  resourceType: 'memory' | 'nvme' | 'cpu';
  
  /**
   * Alert severity
   */
  severity: 'warning' | 'critical';
  
  /**
   * Current usage percentage
   */
  currentUsage: number;
  
  /**
   * Threshold percentage
   */
  threshold: number;
  
  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Sprites Resource Monitor
 * 
 * Monitors Sprites resource usage.
 */
export class SpritesResourceMonitor extends EventEmitter {
  private metrics: Map<string, SpritesResourceMetrics[]> = new Map();
  private alerts: ResourceAlert[] = [];
  private thresholds = {
    memory: { warning: 70, critical: 90 },
    nvme: { warning: 70, critical: 90 },
    cpu: { warning: 80, critical: 95 },
  };
  private readonly MAX_METRICS = 1000;

  constructor() {
    super();
  }

  /**
   * Update resource metrics
   * 
   * @param metrics - Resource metrics
   */
  updateMetrics(metrics: SpritesResourceMetrics): void {
    // Store metrics
    const spriteMetrics = this.metrics.get(metrics.spriteId) || [];
    spriteMetrics.push(metrics);
    
    // Enforce max metrics
    if (spriteMetrics.length > this.MAX_METRICS) {
      spriteMetrics.shift();
    }
    
    this.metrics.set(metrics.spriteId, spriteMetrics);

    // Check thresholds
    this.checkThresholds(metrics);

    this.emit('metrics-updated', metrics);
  }

  /**
   * Check resource thresholds
   */
  private checkThresholds(metrics: SpritesResourceMetrics): void {
    // Memory check
    if (metrics.memoryPercentage >= this.thresholds.memory.critical) {
      this.generateAlert(metrics.spriteId, 'memory', 'critical', metrics.memoryPercentage);
    } else if (metrics.memoryPercentage >= this.thresholds.memory.warning) {
      this.generateAlert(metrics.spriteId, 'memory', 'warning', metrics.memoryPercentage);
    }

    // NVMe check
    if (metrics.nvmePercentage >= this.thresholds.nvme.critical) {
      this.generateAlert(metrics.spriteId, 'nvme', 'critical', metrics.nvmePercentage);
    } else if (metrics.nvmePercentage >= this.thresholds.nvme.warning) {
      this.generateAlert(metrics.spriteId, 'nvme', 'warning', metrics.nvmePercentage);
    }

    // CPU check
    if (metrics.cpuPercentage >= this.thresholds.cpu.critical) {
      this.generateAlert(metrics.spriteId, 'cpu', 'critical', metrics.cpuPercentage);
    } else if (metrics.cpuPercentage >= this.thresholds.cpu.warning) {
      this.generateAlert(metrics.spriteId, 'cpu', 'warning', metrics.cpuPercentage);
    }
  }

  /**
   * Generate alert
   */
  private generateAlert(
    spriteId: string,
    resourceType: ResourceAlert['resourceType'],
    severity: ResourceAlert['severity'],
    currentUsage: number
  ): void {
    const threshold = this.thresholds[resourceType][severity];
    
    // Check for recent duplicate alert
    const recentAlert = this.alerts.find(
      a => a.spriteId === spriteId &&
           a.resourceType === resourceType &&
           a.severity === severity &&
           Date.now() - a.timestamp < 300000 // 5 minute cooldown
    );

    if (recentAlert) {
      return;
    }

    const alert: ResourceAlert = {
      id: generateSecureId('alert'),
      spriteId,
      resourceType,
      severity,
      currentUsage,
      threshold,
      timestamp: Date.now(),
    };

    this.alerts.push(alert);
    this.emit('alert', alert);
  }

  /**
   * Get current metrics
   * 
   * @param spriteId - Sprite ID
   * @returns Current metrics or null
   */
  getCurrentMetrics(spriteId: string): SpritesResourceMetrics | null {
    const metrics = this.metrics.get(spriteId);
    
    if (!metrics || metrics.length === 0) {
      return null;
    }

    return metrics[metrics.length - 1];
  }

  /**
   * Get historical metrics
   * 
   * @param spriteId - Sprite ID
   * @param durationMs - Duration in ms
   * @returns Array of metrics
   */
  getHistoricalMetrics(spriteId: string, durationMs: number = 3600000): SpritesResourceMetrics[] {
    const metrics = this.metrics.get(spriteId) || [];
    const cutoff = Date.now() - durationMs;
    
    return metrics.filter(m => m.timestamp >= cutoff);
  }

  /**
   * Get alerts
   * 
   * @param spriteId - Optional sprite ID
   * @param durationMs - Duration in ms
   * @returns Array of alerts
   */
  getAlerts(spriteId?: string, durationMs: number = 3600000): ResourceAlert[] {
    const cutoff = Date.now() - durationMs;
    
    return this.alerts.filter(a => {
      if (spriteId && a.spriteId !== spriteId) return false;
      return a.timestamp >= cutoff;
    });
  }

  /**
   * Get resource summary
   * 
   * @param spriteId - Sprite ID
   * @returns Resource summary
   */
  getResourceSummary(spriteId: string): {
    memory: { used: number; limit: number; percentage: number };
    nvme: { used: number; limit: number; percentage: number };
    cpu: { percentage: number };
    health: 'good' | 'warning' | 'critical';
  } {
    const metrics = this.getCurrentMetrics(spriteId);
    
    if (!metrics) {
      return {
        memory: { used: 0, limit: 0, percentage: 0 },
        nvme: { used: 0, limit: 0, percentage: 0 },
        cpu: { percentage: 0 },
        health: 'good',
      };
    }

    // Determine health
    let health: 'good' | 'warning' | 'critical' = 'good';
    const maxUsage = Math.max(
      metrics.memoryPercentage,
      metrics.nvmePercentage,
      metrics.cpuPercentage
    );
    
    if (maxUsage >= 90) health = 'critical';
    else if (maxUsage >= 70) health = 'warning';

    return {
      memory: {
        used: metrics.memoryUsed,
        limit: metrics.memoryLimit,
        percentage: metrics.memoryPercentage,
      },
      nvme: {
        used: metrics.nvmeUsed,
        limit: metrics.nvmeLimit,
        percentage: metrics.nvmePercentage,
      },
      cpu: {
        percentage: metrics.cpuPercentage,
      },
      health,
    };
  }

  /**
   * Clear metrics
   * 
   * @param spriteId - Optional sprite ID
   */
  clearMetrics(spriteId?: string): void {
    if (spriteId) {
      this.metrics.delete(spriteId);
    } else {
      this.metrics.clear();
    }
  }

  /**
   * Clear alerts
   * 
   * @param spriteId - Optional sprite ID
   */
  clearAlerts(spriteId?: string): void {
    if (spriteId) {
      this.alerts = this.alerts.filter(a => a.spriteId !== spriteId);
    } else {
      this.alerts = [];
    }
  }
}

// Singleton instance
export const spritesResourceMonitor = new SpritesResourceMonitor();

/**
 * Create resource monitor
 * 
 * @returns Resource monitor
 */
export function createSpritesResourceMonitor(): SpritesResourceMonitor {
  return new SpritesResourceMonitor();
}
