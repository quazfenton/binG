/**
 * Performance Monitoring Utilities
 *
 * Provides performance tracking, metrics collection,
 * and optimization suggestions for binG operations.
 */

import { createLogger } from './logger';

const logger = createLogger('Performance');

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  startTime: number;
  endTime: number;
  metadata?: Record<string, any>;
  memoryUsage?: NodeJS.MemoryUsage;
}

/**
 * Performance monitor class
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private activeOperations = new Map<string, { startTime: number; metadata?: any }>();

  /**
   * Start timing an operation
   */
  start(operation: string, metadata?: Record<string, any>): string {
    const id = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    this.activeOperations.set(id, { startTime, metadata });

    logger.debug(`Started operation: ${operation}`, { id, metadata });

    return id;
  }

  /**
   * End timing an operation
   */
  end(id: string): PerformanceMetrics | null {
    const operation = this.activeOperations.get(id);
    if (!operation) {
      logger.warn(`No active operation found for id: ${id}`);
      return null;
    }

    const endTime = Date.now();
    const duration = endTime - operation.startTime;

    const metrics: PerformanceMetrics = {
      operation: id.split('_')[0], // Extract operation name from id
      duration,
      startTime: operation.startTime,
      endTime,
      metadata: operation.metadata,
      memoryUsage: process.memoryUsage()
    };

    this.metrics.push(metrics);
    this.activeOperations.delete(id);

    logger.debug(`Completed operation: ${metrics.operation}`, {
      duration: `${duration}ms`,
      memoryUsage: `${Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024)}MB`
    });

    return metrics;
  }

  /**
   * Time a synchronous operation
   */
  timeSync<T>(operation: string, fn: () => T, metadata?: Record<string, any>): T {
    const id = this.start(operation, metadata);
    try {
      const result = fn();
      this.end(id);
      return result;
    } catch (error) {
      this.end(id);
      throw error;
    }
  }

  /**
   * Time an asynchronous operation
   */
  async timeAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const id = this.start(operation, metadata);
    try {
      const result = await fn();
      this.end(id);
      return result;
    } catch (error) {
      this.end(id);
      throw error;
    }
  }

  /**
   * Get performance statistics
   */
  getStats(): {
    totalOperations: number;
    averageDuration: number;
    slowestOperation: PerformanceMetrics | null;
    fastestOperation: PerformanceMetrics | null;
    operationsByType: Record<string, { count: number; avgDuration: number }>;
  } {
    if (this.metrics.length === 0) {
      return {
        totalOperations: 0,
        averageDuration: 0,
        slowestOperation: null,
        fastestOperation: null,
        operationsByType: {}
      };
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const averageDuration = totalDuration / this.metrics.length;

    const slowestOperation = this.metrics.reduce((slowest, current) =>
      current.duration > slowest.duration ? current : slowest
    );

    const fastestOperation = this.metrics.reduce((fastest, current) =>
      current.duration < fastest.duration ? current : fastest
    );

    const operationsByType: Record<string, { count: number; avgDuration: number }> = {};

    this.metrics.forEach(metrics => {
      const type = metrics.operation;
      if (!operationsByType[type]) {
        operationsByType[type] = { count: 0, avgDuration: 0 };
      }
      operationsByType[type].count++;
      operationsByType[type].avgDuration =
        (operationsByType[type].avgDuration * (operationsByType[type].count - 1) + metrics.duration) /
        operationsByType[type].count;
    });

    return {
      totalOperations: this.metrics.length,
      averageDuration,
      slowestOperation,
      fastestOperation,
      operationsByType
    };
  }

  /**
   * Clear collected metrics
   */
  clear(): void {
    this.metrics = [];
    this.activeOperations.clear();
  }

  /**
   * Get recent metrics (last N operations)
   */
  getRecentMetrics(limit: number = 10): PerformanceMetrics[] {
    return this.metrics.slice(-limit);
  }
}

/**
 * Global performance monitor instance
 */
export const performanceMonitor = new PerformanceMonitor();

/**
 * Decorator for timing class methods
 */
export function timed(operation?: string) {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const operationName = operation || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = function(...args: any[]) {
      return performanceMonitor.timeAsync(operationName, () => {
        return originalMethod.apply(this, args);
      });
    };
  };
}

/**
 * Utility for measuring memory usage
 */
export function measureMemoryUsage(): NodeJS.MemoryUsage {
  return process.memoryUsage();
}

/**
 * Check if operation is running slowly
 */
export function isSlowOperation(duration: number, threshold: number = 5000): boolean {
  return duration > threshold;
}

/**
 * Generate performance report
 */
export function generatePerformanceReport(): string {
  const stats = performanceMonitor.getStats();

  let report = '# Performance Report\n\n';

  report += `Total Operations: ${stats.totalOperations}\n`;
  report += `Average Duration: ${Math.round(stats.averageDuration)}ms\n\n`;

  if (stats.slowestOperation) {
    report += `Slowest Operation: ${stats.slowestOperation.operation} (${stats.slowestOperation.duration}ms)\n`;
  }

  if (stats.fastestOperation) {
    report += `Fastest Operation: ${stats.fastestOperation.operation} (${stats.fastestOperation.duration}ms)\n`;
  }

  report += '\n## Operations by Type\n';
  Object.entries(stats.operationsByType).forEach(([type, stats]) => {
    report += `- ${type}: ${stats.count} operations, avg ${Math.round(stats.avgDuration)}ms\n`;
  });

  return report;
}