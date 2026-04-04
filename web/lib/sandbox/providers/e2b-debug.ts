/**
 * E2B Debug Mode
 * 
 * Provides debugging capabilities for E2B sandboxes.
 * Includes logging, tracing, and inspection tools.
 * 
 * Features:
 * - Command logging
 * - Execution tracing
 * - State inspection
 * - Performance profiling
 */

import { EventEmitter } from 'node:events';

/**
 * Debug log entry
 */
export interface DebugLogEntry {
  /**
   * Log timestamp
   */
  timestamp: number;
  
  /**
   * Log level
   */
  level: 'debug' | 'info' | 'warn' | 'error';
  
  /**
   * Log message
   */
  message: string;
  
  /**
   * Sandbox ID
   */
  sandboxId?: string;
  
  /**
   * Additional data
   */
  data?: any;
}

/**
 * Execution trace
 */
export interface ExecutionTrace {
  /**
   * Trace ID
   */
  id: string;
  
  /**
   * Sandbox ID
   */
  sandboxId: string;
  
  /**
   * Operation type
   */
  operation: string;
  
  /**
   * Start time
   */
  startTime: number;
  
  /**
   * End time
   */
  endTime?: number;
  
  /**
   * Duration in ms
   */
  duration?: number;
  
  /**
   * Success status
   */
  success: boolean;
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Input data
   */
  input?: any;
  
  /**
   * Output data
   */
  output?: any;
}

/**
 * E2B Debug Manager
 * 
 * Manages debugging and tracing for sandboxes.
 */
export class E2BDebugManager extends EventEmitter {
  private logs: DebugLogEntry[] = [];
  private traces: Map<string, ExecutionTrace> = new Map();
  private completedTraces: ExecutionTrace[] = [];
  private enabled: boolean = false;
  private readonly MAX_LOGS = 10000;
  private readonly MAX_TRACES = 1000;

  constructor() {
    super();
  }

  /**
   * Enable debug mode
   */
  enable(): void {
    this.enabled = true;
    this.log('info', 'Debug mode enabled');
  }

  /**
   * Disable debug mode
   */
  disable(): void {
    this.enabled = false;
    this.log('info', 'Debug mode disabled');
  }

  /**
   * Check if debug mode is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Log debug message
   * 
   * @param level - Log level
   * @param message - Log message
   * @param data - Additional data
   * @param sandboxId - Optional sandbox ID
   */
  log(
    level: DebugLogEntry['level'],
    message: string,
    data?: any,
    sandboxId?: string
  ): void {
    if (!this.enabled && level !== 'error') {
      return;
    }

    const entry: DebugLogEntry = {
      timestamp: Date.now(),
      level,
      message,
      sandboxId,
      data,
    };

    this.logs.push(entry);
    
    // Enforce max logs
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    this.emit('log', entry);

    // Also log to console in debug mode
    if (this.enabled) {
      const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](`[E2B:${level.toUpperCase()}] ${message}`, data || '');
    }
  }

  /**
   * Start execution trace
   * 
   * @param sandboxId - Sandbox ID
   * @param operation - Operation name
   * @param input - Input data
   * @returns Trace ID
   */
  startTrace(
    sandboxId: string,
    operation: string,
    input?: any
  ): string {
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const trace: ExecutionTrace = {
      id: traceId,
      sandboxId,
      operation,
      startTime: Date.now(),
      success: true,
      input,
    };

    this.traces.set(traceId, trace);
    this.emit('trace-start', trace);

    return traceId;
  }

  /**
   * End execution trace
   * 
   * @param traceId - Trace ID
   * @param output - Output data
   * @param error - Optional error
   * @returns Completed trace
   */
  endTrace(
    traceId: string,
    output?: any,
    error?: string
  ): ExecutionTrace | null {
    const trace = this.traces.get(traceId);
    
    if (!trace) {
      return null;
    }

    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.success = !error;
    trace.output = output;
    trace.error = error;

    this.traces.delete(traceId);
    this.completedTraces.push(trace);

    // Enforce max traces
    if (this.completedTraces.length > this.MAX_TRACES) {
      this.completedTraces.shift();
    }

    this.emit('trace-end', trace);

    return trace;
  }

  /**
   * Get logs
   * 
   * @param options - Filter options
   * @returns Array of log entries
   */
  getLogs(options?: {
    level?: DebugLogEntry['level'];
    sandboxId?: string;
    limit?: number;
    since?: number;
  }): DebugLogEntry[] {
    let filtered = [...this.logs];

    if (options?.level) {
      filtered = filtered.filter(l => l.level === options.level);
    }

    if (options?.sandboxId) {
      filtered = filtered.filter(l => l.sandboxId === options.sandboxId);
    }

    if (options?.since) {
      filtered = filtered.filter(l => l.timestamp >= options.since!);
    }

    const limit = options?.limit || 100;
    return filtered.slice(-limit);
  }

  /**
   * Get traces
   * 
   * @param options - Filter options
   * @returns Array of traces
   */
  getTraces(options?: {
    sandboxId?: string;
    operation?: string;
    success?: boolean;
    limit?: number;
  }): ExecutionTrace[] {
    let filtered = [...this.completedTraces];

    if (options?.sandboxId) {
      filtered = filtered.filter(t => t.sandboxId === options.sandboxId);
    }

    if (options?.operation) {
      filtered = filtered.filter(t => t.operation === options.operation);
    }

    if (options?.success !== undefined) {
      filtered = filtered.filter(t => t.success === options.success);
    }

    const limit = options?.limit || 100;
    return filtered.slice(-limit);
  }

  /**
   * Get active traces
   * 
   * @param sandboxId - Optional sandbox ID
   * @returns Array of active traces
   */
  getActiveTraces(sandboxId?: string): ExecutionTrace[] {
    const traces = Array.from(this.traces.values());
    
    if (sandboxId) {
      return traces.filter(t => t.sandboxId === sandboxId);
    }
    
    return traces;
  }

  /**
   * Get performance statistics
   * 
   * @param operation - Optional operation filter
   * @returns Performance stats
   */
  getPerformanceStats(operation?: string): {
    totalOperations: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    successRate: number;
    p50Duration: number;
    p95Duration: number;
    p99Duration: number;
  } {
    let traces = this.completedTraces;
    
    if (operation) {
      traces = traces.filter(t => t.operation === operation);
    }

    const durations = traces
      .filter(t => t.duration !== undefined)
      .map(t => t.duration!)
      .sort((a, b) => a - b);

    const totalOperations = durations.length;
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const averageDuration = totalOperations > 0 ? totalDuration / totalOperations : 0;
    const minDuration = durations[0] || 0;
    const maxDuration = durations[durations.length - 1] || 0;
    
    const successful = traces.filter(t => t.success).length;
    const successRate = totalOperations > 0 ? (successful / totalOperations) * 100 : 0;

    const p50Index = Math.floor(durations.length * 0.5);
    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);

    return {
      totalOperations,
      averageDuration,
      minDuration,
      maxDuration,
      successRate,
      p50Duration: durations[p50Index] || 0,
      p95Duration: durations[p95Index] || 0,
      p99Duration: durations[p99Index] || 0,
    };
  }

  /**
   * Export debug data
   * 
   * @param format - Export format
   * @returns Exported data
   */
  exportData(format: 'json' | 'text' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify({
        logs: this.logs,
        traces: this.completedTraces,
        activeTraces: Array.from(this.traces.values()),
      }, null, 2);
    } else {
      const lines: string[] = [];
      
      lines.push('=== E2B Debug Export ===\n');
      lines.push(`Generated: ${new Date().toISOString()}`);
      lines.push(`Total Logs: ${this.logs.length}`);
      lines.push(`Total Traces: ${this.completedTraces.length}`);
      lines.push(`Active Traces: ${this.traces.size}\n`);
      
      lines.push('=== Recent Logs ===\n');
      for (const log of this.logs.slice(-20)) {
        lines.push(`[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] ${log.message}`);
      }
      
      lines.push('\n=== Recent Traces ===\n');
      for (const trace of this.completedTraces.slice(-10)) {
        lines.push(`${trace.operation} (${trace.sandboxId}): ${trace.duration}ms - ${trace.success ? 'SUCCESS' : 'FAILED'}`);
      }
      
      return lines.join('\n');
    }
  }

  /**
   * Clear debug data
   * 
   * @param type - Data type to clear
   */
  clear(type: 'logs' | 'traces' | 'all' = 'all'): void {
    if (type === 'logs' || type === 'all') {
      this.logs = [];
    }
    
    if (type === 'traces' || type === 'all') {
      this.traces.clear();
      this.completedTraces = [];
    }
    
    this.emit('cleared', type);
  }
}

// Singleton instance
export const e2bDebug = new E2BDebugManager();

/**
 * Create debug manager
 * 
 * @returns Debug manager
 */
export function createE2BDebug(): E2BDebugManager {
  return new E2BDebugManager();
}

/**
 * Decorator for tracing execution
 * 
 * @param operationName - Operation name
 */
export function traceExecution(operationName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = operationName || propertyKey;

    descriptor.value = async function (...args: any[]) {
      if (!e2bDebug.isEnabled()) {
        return originalMethod.apply(this, args);
      }

      const sandboxId = this.sandboxId || this.id || 'unknown';
      const traceId = e2bDebug.startTrace(sandboxId, name, { args });

      try {
        const result = await originalMethod.apply(this, args);
        e2bDebug.endTrace(traceId, { result });
        return result;
      } catch (error: any) {
        e2bDebug.endTrace(traceId, undefined, error.message);
        throw error;
      }
    };

    return descriptor;
  };
}
