/**
 * Bootstrapped Agency System
 *
 * Enables agents to learn from past executions and improve over time.
 * Features:
 * - Execution history tracking
 * - Pattern recognition for successful strategies
 * - Adaptive capability selection
 * - Self-improvement through feedback loops
 *
 * @example
 * ```typescript
 * const agency = createBootstrappedAgency({
 *   sessionId: 'my-session',
 *   enableLearning: true,
 * });
 *
 * // Execute with learning
 * const result = await agency.execute({
 *   task: 'Create a React component',
 *   capabilities: ['file.read', 'file.write', 'sandbox.shell'],
 * });
 *
 * // Agency learns from success/failure
 * // Future executions will be optimized
 * ```
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('BootstrappedAgency');

export interface ExecutionRecord {
  id: string;
  taskId: string;
  task: string;
  capabilities: string[];
  chainUsed: boolean;
  success: boolean;
  duration: number;
  stepsExecuted: number;
  errors: string[];
  timestamp: number;
  feedback?: {
    quality: number; // 0-1
    efficiency: number; // 0-1
    notes?: string;
  };
}

export interface AgencyConfig {
  sessionId: string;
  /** Enable learning from executions (default: true) */
  enableLearning?: boolean;
  /** Max history to keep (default: 1000) */
  maxHistorySize?: number;
  /** Enable pattern recognition (default: true) */
  enablePatternRecognition?: boolean;
  /** Enable adaptive capability selection (default: true) */
  enableAdaptiveSelection?: boolean;
  /** Minimum executions before adaptation (default: 5) */
  minExecutionsForAdaptation?: number;
}

export interface AgencyMetrics {
  totalExecutions: number;
  successRate: number;
  averageDuration: number;
  mostUsedCapabilities: Map<string, number>;
  successPatterns: string[];
  failurePatterns: string[];
  improvementTrend: 'improving' | 'stable' | 'declining';
}

/**
 * Bootstrapped Agency
 */
export class BootstrappedAgency {
  private config: AgencyConfig;
  private executionHistory: ExecutionRecord[] = [];
  private capabilityStats = new Map<string, {
    executions: number;
    successes: number;
    failures: number;
    averageDuration: number;
  }>();
  private taskPatterns = new Map<string, {
    successfulCapabilities: string[];
    averageDuration: number;
    successRate: number;
    executions: number;
  }>();

  constructor(config: AgencyConfig) {
    this.config = {
      sessionId: config.sessionId,
      enableLearning: true,
      maxHistorySize: 1000,
      enablePatternRecognition: true,
      enableAdaptiveSelection: true,
      minExecutionsForAdaptation: 5,
      ...config,
    };

    log.info('Bootstrapped Agency initialized', {
      sessionId: this.config.sessionId,
      enableLearning: this.config.enableLearning,
    });
  }

  /**
   * Execute a task with learning
   */
  async execute(params: {
    task: string;
    capabilities?: string[];
    chain?: boolean;
  }): Promise<{
    success: boolean;
    result: any;
    duration: number;
    learned: boolean;
  }> {
    const startTime = Date.now();
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    log.info('Starting agency execution', {
      taskId,
      task: params.task.substring(0, 100),
      capabilities: params.capabilities,
    });

    try {
      // Select optimal capabilities if not provided
      const selectedCapabilities = params.capabilities || 
        this.selectOptimalCapabilities(params.task);

      // Execute with selected capabilities
      const result = await this.executeWithCapabilities(
        params.task,
        selectedCapabilities,
        params.chain ?? true
      );

      const duration = Date.now() - startTime;

      // Record execution
      const record: ExecutionRecord = {
        id: `exec-${Date.now()}`,
        taskId,
        task: params.task,
        capabilities: selectedCapabilities,
        chainUsed: params.chain ?? true,
        success: result.success,
        duration,
        stepsExecuted: selectedCapabilities.length,
        errors: result.success ? [] : [result.error || 'Unknown error'],
        timestamp: Date.now(),
      };

      this.recordExecution(record);

      // Learn from execution
      const learned = this.config.enableLearning && 
        this.learnFromExecution(record);

      log.info('Agency execution completed', {
        taskId,
        success: result.success,
        duration: `${Math.round(duration / 1000)}s`,
        learned,
      });

      return {
        success: result.success,
        result: result.data,
        duration,
        learned,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Record failure
      const record: ExecutionRecord = {
        id: `exec-${Date.now()}`,
        taskId,
        task: params.task,
        capabilities: params.capabilities || [],
        chainUsed: params.chain ?? true,
        success: false,
        duration,
        stepsExecuted: params.capabilities?.length || 0,
        errors: [error.message],
        timestamp: Date.now(),
      };

      this.recordExecution(record);

      log.error('Agency execution failed', {
        taskId,
        error: error.message,
        duration: `${Math.round(duration / 1000)}s`,
      });

      return {
        success: false,
        result: null,
        duration,
        learned: false,
      };
    }
  }

  /**
   * Select optimal capabilities based on task and past learning
   */
  private selectOptimalCapabilities(task: string): string[] {
    if (!this.config.enableAdaptiveSelection) {
      // Return default capabilities
      return ['file.read', 'file.write', 'sandbox.shell'];
    }

    // Find similar past tasks
    const similarTasks = this.findSimilarTasks(task);

    if (similarTasks.length >= (this.config.minExecutionsForAdaptation || 5)) {
      // Use successful patterns from similar tasks
      const successfulCapabilities = this.extractSuccessfulCapabilities(similarTasks);
      
      log.debug('Selected capabilities based on similar tasks', {
        task: task.substring(0, 50),
        similarTasksCount: similarTasks.length,
        selectedCapabilities: successfulCapabilities,
      });

      return successfulCapabilities;
    }

    // Not enough data, use default
    return ['file.read', 'file.write', 'sandbox.shell'];
  }

  /**
   * Execute with specific capabilities
   */
  private async executeWithCapabilities(
    task: string,
    capabilities: string[],
    useChain: boolean
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    // This would integrate with the capability chain system
    // For now, return a placeholder
    log.debug('Executing with capabilities', {
      task: task.substring(0, 50),
      capabilities,
      useChain,
    });

    // Placeholder - would integrate with actual capability execution
    return {
      success: true,
      data: { message: 'Executed successfully' },
    };
  }

  /**
   * Record execution in history
   */
  private recordExecution(record: ExecutionRecord): void {
    this.executionHistory.push(record);

    // Trim history if needed
    if (this.executionHistory.length > (this.config.maxHistorySize || 1000)) {
      this.executionHistory = this.executionHistory.slice(
        -((this.config.maxHistorySize || 1000))
      );
    }

    // Update capability stats
    this.updateCapabilityStats(record);

    // Update task patterns
    if (this.config.enablePatternRecognition) {
      this.updateTaskPatterns(record);
    }
  }

  /**
   * Learn from execution
   */
  private learnFromExecution(record: ExecutionRecord): boolean {
    if (!record.success) {
      // Learn from failures
      this.learnFromFailure(record);
      return true;
    }

    // Learn from successes
    this.learnFromSuccess(record);
    return true;
  }

  /**
   * Learn from successful execution
   */
  private learnFromSuccess(record: ExecutionRecord): void {
    // Reinforce successful capability combinations
    const patternKey = this.getTaskPatternKey(record.task);
    const existing = this.taskPatterns.get(patternKey);

    if (existing) {
      existing.successRate = (existing.successRate * existing.executions + 1) / (existing.executions + 1);
      existing.executions++;
      existing.averageDuration = (existing.averageDuration * (existing.executions - 1) + record.duration) / existing.executions;
    } else {
      this.taskPatterns.set(patternKey, {
        successfulCapabilities: record.capabilities,
        averageDuration: record.duration,
        successRate: 1.0,
        executions: 1,
      });
    }

    log.debug('Learned from successful execution', {
      task: record.task.substring(0, 50),
      capabilities: record.capabilities,
      duration: record.duration,
    });
  }

  /**
   * Learn from failed execution
   */
  private learnFromFailure(record: ExecutionRecord): void {
    // Identify problematic capability combinations
    const patternKey = this.getTaskPatternKey(record.task);
    const existing = this.taskPatterns.get(patternKey);

    if (existing) {
      existing.successRate = (existing.successRate * existing.executions) / (existing.executions + 1);
      existing.executions++;
    } else {
      this.taskPatterns.set(patternKey, {
        successfulCapabilities: [],
        averageDuration: record.duration,
        successRate: 0.0,
        executions: 1,
      });
    }

    log.debug('Learned from failed execution', {
      task: record.task.substring(0, 50),
      errors: record.errors,
    });
  }

  /**
   * Update capability statistics
   */
  private updateCapabilityStats(record: ExecutionRecord): void {
    for (const capability of record.capabilities) {
      const stats = this.capabilityStats.get(capability) || {
        executions: 0,
        successes: 0,
        failures: 0,
        averageDuration: 0,
      };

      stats.executions++;
      if (record.success) {
        stats.successes++;
      } else {
        stats.failures++;
      }

      stats.averageDuration = (stats.averageDuration * (stats.executions - 1) + record.duration) / stats.executions;

      this.capabilityStats.set(capability, stats);
    }
  }

  /**
   * Update task patterns
   */
  private updateTaskPatterns(record: ExecutionRecord): void {
    const patternKey = this.getTaskPatternKey(record.task);
    const existing = this.taskPatterns.get(patternKey);

    if (existing && record.success) {
      // Update successful capabilities
      existing.successfulCapabilities = record.capabilities;
    }
  }

  /**
   * Find similar tasks from history
   */
  private findSimilarTasks(task: string, limit: number = 10): ExecutionRecord[] {
    // Simple keyword-based similarity
    const taskKeywords = task.toLowerCase().split(/\s+/);
    
    const similar = this.executionHistory.filter(record => {
      const recordKeywords = record.task.toLowerCase().split(/\s+/);
      const overlap = taskKeywords.filter(k => recordKeywords.includes(k));
      return overlap.length >= 2; // At least 2 keywords in common
    });

    return similar.slice(0, limit);
  }

  /**
   * Extract successful capabilities from similar tasks
   */
  private extractSuccessfulCapabilities(similarTasks: ExecutionRecord[]): string[] {
    const successfulTasks = similarTasks.filter(t => t.success);
    
    if (successfulTasks.length === 0) {
      return ['file.read', 'file.write', 'sandbox.shell'];
    }

    // Count capability frequency in successful tasks
    const capabilityCounts = new Map<string, number>();
    
    for (const task of successfulTasks) {
      for (const capability of task.capabilities) {
        capabilityCounts.set(capability, (capabilityCounts.get(capability) || 0) + 1);
      }
    }

    // Sort by frequency and return top capabilities
    const sorted = Array.from(capabilityCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return sorted.map(([capability]) => capability);
  }

  /**
   * Get task pattern key
   */
  private getTaskPatternKey(task: string): string {
    // Extract key verbs and nouns from task
    const keywords = task
      .toLowerCase()
      .match(/\b(create|build|edit|fix|read|write|delete|test|run|execute)\b|\b(file|component|page|function|test|app)\b/g)
      ?.join('-') || 'general';

    return keywords;
  }

  /**
   * Get agency metrics
   */
  getMetrics(): AgencyMetrics {
    const totalExecutions = this.executionHistory.length;
    const successfulExecutions = this.executionHistory.filter(r => r.success).length;
    const successRate = totalExecutions > 0 ? successfulExecutions / totalExecutions : 0;
    const averageDuration = totalExecutions > 0
      ? this.executionHistory.reduce((sum, r) => sum + r.duration, 0) / totalExecutions
      : 0;

    // Calculate improvement trend
    const recentExecutions = this.executionHistory.slice(-20);
    const olderExecutions = this.executionHistory.slice(-40, -20);
    
    let improvementTrend: 'improving' | 'stable' | 'declining' = 'stable';
    
    if (recentExecutions.length >= 10 && olderExecutions.length >= 10) {
      const recentSuccessRate = recentExecutions.filter(r => r.success).length / recentExecutions.length;
      const olderSuccessRate = olderExecutions.filter(r => r.success).length / olderExecutions.length;
      
      if (recentSuccessRate > olderSuccessRate + 0.1) {
        improvementTrend = 'improving';
      } else if (recentSuccessRate < olderSuccessRate - 0.1) {
        improvementTrend = 'declining';
      }
    }

    return {
      totalExecutions,
      successRate,
      averageDuration,
      mostUsedCapabilities: this.getMostUsedCapabilities(),
      successPatterns: this.getSuccessPatterns(),
      failurePatterns: this.getFailurePatterns(),
      improvementTrend,
    };
  }

  /**
   * Get most used capabilities
   */
  private getMostUsedCapabilities(): Map<string, number> {
    const counts = new Map<string, number>();
    
    for (const record of this.executionHistory) {
      for (const capability of record.capabilities) {
        counts.set(capability, (counts.get(capability) || 0) + 1);
      }
    }

    return new Map(Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10));
  }

  /**
   * Get success patterns
   */
  private getSuccessPatterns(): string[] {
    const patterns: string[] = [];
    
    for (const [patternKey, pattern] of this.taskPatterns.entries()) {
      if (pattern.successRate > 0.8 && pattern.executions >= 3) {
        patterns.push(`${patternKey} (${Math.round(pattern.successRate * 100)}% success)`);
      }
    }

    return patterns.slice(0, 10);
  }

  /**
   * Get failure patterns
   */
  private getFailurePatterns(): string[] {
    const patterns: string[] = [];
    
    for (const [patternKey, pattern] of this.taskPatterns.entries()) {
      if (pattern.successRate < 0.5 && pattern.executions >= 3) {
        patterns.push(`${patternKey} (${Math.round((1 - pattern.successRate) * 100)}% failure)`);
      }
    }

    return patterns.slice(0, 10);
  }

  /**
   * Reset learning history
   */
  reset(): void {
    this.executionHistory = [];
    this.capabilityStats.clear();
    this.taskPatterns.clear();
    
    log.info('Agency learning history reset', {
      sessionId: this.config.sessionId,
    });
  }
}

/**
 * Create bootstrapped agency
 */
export function createBootstrappedAgency(config: AgencyConfig): BootstrappedAgency {
  return new BootstrappedAgency(config);
}
