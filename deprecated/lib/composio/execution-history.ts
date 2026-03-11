/**
 * Composio Execution History Tracker
 * 
 * Tracks tool execution history for analytics, debugging, and optimization.
 * Provides insights into tool usage patterns and performance.
 * 
 * @see https://docs.composio.dev/docs/webhooks Composio Webhooks
 */

import { EventEmitter } from 'events';
import { generateSecureId } from '@/lib/utils';

/**
 * Execution record
 */
export interface ExecutionRecord {
  /**
   * Unique execution ID
   */
  id: string;
  
  /**
   * User ID
   */
  userId: string;
  
  /**
   * Tool name
   */
  toolName: string;
  
  /**
   * Toolkit slug
   */
  toolkit: string;
  
  /**
   * Execution status
   */
  status: 'success' | 'failure' | 'timeout';
  
  /**
   * Input parameters
   */
  input: Record<string, any>;
  
  /**
   * Output data
   */
  output?: any;
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Execution duration in ms
   */
  duration: number;
  
  /**
   * Token usage
   */
  tokenUsage?: {
    input: number;
    output: number;
  };
  
  /**
   * Timestamp
   */
  timestamp: number;
  
  /**
   * Session ID
   */
  sessionId?: string;
}

/**
 * Execution statistics
 */
export interface ExecutionStats {
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
   * Average duration
   */
  averageDuration: number;
  
  /**
   * Success rate (0-100)
   */
  successRate: number;
  
  /**
   * Executions by tool
   */
  byTool: Record<string, {
    count: number;
    success: number;
    failed: number;
    avgDuration: number;
  }>;
  
  /**
   * Executions by hour (last 24h)
   */
  byHour: Array<{
    hour: number;
    count: number;
  }>;
}

/**
 * Composio Execution History Tracker
 * 
 * Tracks and analyzes tool execution history.
 */
export class ComposioExecutionHistory extends EventEmitter {
  private records: ExecutionRecord[] = [];
  private readonly MAX_RECORDS = 10000;
  private readonly TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor() {
    super();
    
    // Auto-cleanup old records
    setInterval(() => {
      this.cleanupOldRecords();
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Record execution
   * 
   * @param record - Execution record
   */
  recordExecution(record: Omit<ExecutionRecord, 'id' | 'timestamp'>): ExecutionRecord {
    const fullRecord: ExecutionRecord = {
      ...record,
      id: generateSecureId('exec'),
      timestamp: Date.now(),
    };

    this.records.push(fullRecord);
    this.emit('execution', fullRecord);

    // Enforce max records
    if (this.records.length > this.MAX_RECORDS) {
      this.records = this.records.slice(-this.MAX_RECORDS);
    }

    return fullRecord;
  }

  /**
   * Get executions by user
   * 
   * @param userId - User ID
   * @param limit - Max records to return
   * @returns Array of execution records
   */
  getUserExecutions(userId: string, limit: number = 100): ExecutionRecord[] {
    return this.records
      .filter(r => r.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get executions by tool
   * 
   * @param toolName - Tool name
   * @param limit - Max records to return
   * @returns Array of execution records
   */
  getToolExecutions(toolName: string, limit: number = 100): ExecutionRecord[] {
    return this.records
      .filter(r => r.toolName === toolName)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get executions by session
   * 
   * @param sessionId - Session ID
   * @returns Array of execution records
   */
  getSessionExecutions(sessionId: string): ExecutionRecord[] {
    return this.records
      .filter(r => r.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get failed executions
   * 
   * @param limit - Max records to return
   * @returns Array of failed execution records
   */
  getFailedExecutions(limit: number = 100): ExecutionRecord[] {
    return this.records
      .filter(r => r.status === 'failure')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get execution statistics
   * 
   * @param userId - Optional user ID filter
   * @param timeRangeMs - Time range in ms (default: 24h)
   * @returns Execution statistics
   */
  getStats(userId?: string, timeRangeMs: number = 24 * 60 * 60 * 1000): ExecutionStats {
    const now = Date.now();
    const cutoff = now - timeRangeMs;

    let filtered = this.records.filter(r => r.timestamp >= cutoff);
    
    if (userId) {
      filtered = filtered.filter(r => r.userId === userId);
    }

    const totalExecutions = filtered.length;
    const successfulExecutions = filtered.filter(r => r.status === 'success').length;
    const failedExecutions = filtered.filter(r => r.status === 'failure').length;
    const averageDuration = filtered.length > 0
      ? filtered.reduce((sum, r) => sum + r.duration, 0) / filtered.length
      : 0;
    const successRate = totalExecutions > 0
      ? (successfulExecutions / totalExecutions) * 100
      : 0;

    // By tool
    const byTool: ExecutionStats['byTool'] = {};
    for (const record of filtered) {
      if (!byTool[record.toolName]) {
        byTool[record.toolName] = {
          count: 0,
          success: 0,
          failed: 0,
          avgDuration: 0,
        };
      }
      
      const tool = byTool[record.toolName];
      tool.count++;
      if (record.status === 'success') tool.success++;
      if (record.status === 'failure') tool.failed++;
      tool.avgDuration = (tool.avgDuration * (tool.count - 1) + record.duration) / tool.count;
    }

    // By hour (last 24h)
    const byHour: ExecutionStats['byHour'] = [];
    const hourCounts = new Map<number, number>();
    
    for (let i = 0; i < 24; i++) {
      const hourStart = now - ((i + 1) * 60 * 60 * 1000);
      const hourEnd = now - (i * 60 * 60 * 1000);
      const count = filtered.filter(r => r.timestamp >= hourStart && r.timestamp < hourEnd).length;
      hourCounts.set(23 - i, count);
    }
    
    for (let i = 0; i < 24; i++) {
      byHour.push({
        hour: i,
        count: hourCounts.get(i) || 0,
      });
    }

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageDuration,
      successRate,
      byTool,
      byHour,
    };
  }

  /**
   * Get most used tools
   * 
   * @param limit - Max tools to return
   * @param timeRangeMs - Time range in ms
   * @returns Array of tool names with usage counts
   */
  getMostUsedTools(limit: number = 10, timeRangeMs: number = 24 * 60 * 60 * 1000): Array<{
    toolName: string;
    count: number;
    successRate: number;
  }> {
    const now = Date.now();
    const cutoff = now - timeRangeMs;

    const toolCounts = new Map<string, { count: number; success: number }>();
    
    for (const record of this.records) {
      if (record.timestamp < cutoff) continue;
      
      if (!toolCounts.has(record.toolName)) {
        toolCounts.set(record.toolName, { count: 0, success: 0 });
      }
      
      const tool = toolCounts.get(record.toolName)!;
      tool.count++;
      if (record.status === 'success') tool.success++;
    }

    return Array.from(toolCounts.entries())
      .map(([toolName, data]) => ({
        toolName,
        count: data.count,
        successRate: data.count > 0 ? (data.success / data.count) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get execution by ID
   * 
   * @param id - Execution ID
   * @returns Execution record or null
   */
  getExecutionById(id: string): ExecutionRecord | null {
    return this.records.find(r => r.id === id) || null;
  }

  /**
   * Clear execution history
   * 
   * @param userId - Optional user ID filter
   */
  clearHistory(userId?: string): void {
    if (userId) {
      this.records = this.records.filter(r => r.userId !== userId);
    } else {
      this.records = [];
    }
  }

  /**
   * Export execution history
   * 
   * @returns Array of execution records
   */
  exportHistory(): ExecutionRecord[] {
    return [...this.records];
  }

  /**
   * Import execution history
   * 
   * @param records - Records to import
   */
  importHistory(records: ExecutionRecord[]): void {
    this.records = [...records];
  }

  /**
   * Cleanup old records
   */
  private cleanupOldRecords(): void {
    const cutoff = Date.now() - this.TTL_MS;
    this.records = this.records.filter(r => r.timestamp >= cutoff);
  }

  /**
   * Get record count
   */
  getRecordCount(): number {
    return this.records.length;
  }
}

// Singleton instance
export const executionHistory = new ComposioExecutionHistory();

/**
 * Create execution history tracker
 * 
 * @returns Execution history tracker
 */
export function createExecutionHistory(): ComposioExecutionHistory {
  return new ComposioExecutionHistory();
}

/**
 * Decorator for tracking tool executions
 * 
 * @param toolName - Tool name
 * @param toolkit - Toolkit slug
 */
export function trackExecution(toolName: string, toolkit: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        
        executionHistory.recordExecution({
          userId: this.userId || 'unknown',
          toolName,
          toolkit,
          status: 'success',
          input: args[0] || {},
          output: result,
          duration: Date.now() - startTime,
          sessionId: this.sessionId,
        });
        
        return result;
      } catch (error: any) {
        executionHistory.recordExecution({
          userId: this.userId || 'unknown',
          toolName,
          toolkit,
          status: 'failure',
          input: args[0] || {},
          error: error.message,
          duration: Date.now() - startTime,
          sessionId: this.sessionId,
        });
        
        throw error;
      }
    };

    return descriptor;
  };
}
