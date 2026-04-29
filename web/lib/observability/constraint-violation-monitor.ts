/**
 * Database Constraint Violation Monitor
 * 
 * Monitors and alerts on database constraint violations, particularly during
 * user deletion operations where foreign key constraints may fail.
 * 
 * @module observability/constraint-violation-monitor
 */

import { metricRegistry, METRICS } from './metrics';

/**
 * Constraint violation types
 */
export type ConstraintViolationType = 
  | 'foreign_key'
  | 'unique'
  | 'not_null'
  | 'check'
  | 'primary_key';

/**
 * Constraint violation details
 */
export interface ConstraintViolation {
  type: ConstraintViolationType;
  table: string;
  column?: string;
  constraintName?: string;
  referencedTable?: string;
  message: string;
  userId?: string;
  operation?: string;
  timestamp: Date;
  stackTrace?: string;
}

/**
 * Alert level for constraint violations
 */
export type AlertLevel = 'info' | 'warning' | 'critical';

/**
 * Constraint violation alert
 */
export interface ConstraintViolationAlert {
  level: AlertLevel;
  violation: ConstraintViolation;
  affectedRows?: number;
  resolution?: string;
}

/**
 * Alert throttling configuration
 */
export interface AlertThrottleConfig {
  /** Enable throttling */
  enabled: boolean;
  /** Throttle mode: 'debounce' (wait for quiet period) or 'rate_limit' (max per interval) */
  mode: 'debounce' | 'rate_limit';
  /** For debounce: wait this many ms after last violation before sending alert */
  debounceWindowMs: number;
  /** For rate_limit: max alerts per interval */
  maxAlertsPerInterval: number;
  /** Rate limit interval in ms */
  rateLimitIntervalMs: number;
  /** Batch similar violations into single alert */
  batchSimilar: boolean;
  /** Group violations by type/table within batch window */
  batchWindowMs: number;
  /** Maximum violations to batch in single alert */
  maxBatchSize: number;
}

/**
 * Throttle state for tracking alert timing
 */
interface ThrottleState {
  lastAlertTime: number;
  alertCountInWindow: number;
  pendingViolations: ConstraintViolation[];
  pendingTimer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
}

/**
 * Default throttle configuration
 */
const DEFAULT_THROTTLE_CONFIG: AlertThrottleConfig = {
  enabled: true,
  mode: 'rate_limit',
  debounceWindowMs: 5000,      // 5 seconds debounce
  maxAlertsPerInterval: 10,    // Max 10 alerts per interval
  rateLimitIntervalMs: 60000,  // 1 minute window
  batchSimilar: true,
  batchWindowMs: 1000,         // Batch violations within 1 second
  maxBatchSize: 50,            // Max 50 violations per batch alert
};

/**
 * AlertThrottler - Prevents alert spam by debouncing or rate-limiting alerts
 */
class AlertThrottler {
  private config: AlertThrottleConfig;
  private state: ThrottleState;
  private onFlush: (alert: ConstraintViolationAlert) => void;
  private onDropped?: () => void;

  constructor(
    config: Partial<AlertThrottleConfig>,
    onFlush: (alert: ConstraintViolationAlert) => void,
    onDropped?: () => void
  ) {
    this.config = { ...DEFAULT_THROTTLE_CONFIG, ...config };
    this.onFlush = onFlush;
    this.onDropped = onDropped;
    this.resetState();
  }

  private resetState(): void {
    this.state = {
      lastAlertTime: 0,
      alertCountInWindow: 0,
      pendingViolations: [],
      pendingTimer: null,
      retryCount: 0,
    };
  }

  /**
   * Check if we should send an alert immediately or queue it
   */
  shouldSendImmediately(): boolean {
    if (!this.config.enabled) return true;
    
    const now = Date.now();
    const windowStart = now - this.config.rateLimitIntervalMs;

    // Check if we're within rate limit
    if (this.state.lastAlertTime > windowStart) {
      return this.state.alertCountInWindow < this.config.maxAlertsPerInterval;
    }

    // Rate limit window expired, reset
    return true;
  }

  /**
   * Queue an alert (debounced or batched)
   */
  queueAlert(alert: ConstraintViolationAlert): void {
    if (!this.config.enabled) {
      this.onFlush(alert);
      return;
    }

    // Enforce max batch size - if exceeded, flush oldest first
    if (this.state.pendingViolations.length >= this.config.maxBatchSize) {
      // Force flush current batch before adding new violation
      this.flushBatch();
    }

    // Add to pending violations
    this.state.pendingViolations.push(alert.violation);

    // If batching is enabled, check if we should batch
    if (this.config.batchSimilar) {
      this.scheduleBatchFlush();
    } else {
      this.flushNow(alert);
    }
  }

  /**
   * Schedule a batch flush after batch window
   */
  private scheduleBatchFlush(): void {
    if (this.state.pendingTimer) {
      // Already scheduled, just add violation
      return;
    }

    this.state.pendingTimer = setTimeout(() => {
      this.flushBatch();
    }, this.config.batchWindowMs);
  }

  /**
   * Flush all pending violations as a batch alert
   */
  private flushBatch(): void {
    if (this.state.pendingViolations.length === 0) {
      this.state.pendingTimer = null;
      return;
    }

    // Use the most recent alert as base
    const lastAlert = this.state.pendingViolations[this.state.pendingViolations.length - 1];
    
    // Check rate limit before flushing
    if (!this.shouldSendImmediately()) {
      console.log(
        `[AlertThrottler] Rate limit exceeded, queuing batch of ${this.state.pendingViolations.length} violations`
      );
      
      // Limit retries to prevent infinite recursion
      if (this.state.retryCount >= 3) {
        console.log(
          `[AlertThrottler] Max retries exceeded, dropping ${this.state.pendingViolations.length} violations`
        );
        this.state.pendingViolations = [];
        this.state.pendingTimer = null;
        this.state.retryCount = 0;
        return;
      }

      this.state.retryCount++;
      // Schedule retry after rate limit window
      setTimeout(() => this.flushBatch(), this.config.rateLimitIntervalMs);
      return;
    }

    // Reset retry count on successful flush
    this.state.retryCount = 0;

    // Create batch alert
    const batchAlert: ConstraintViolationAlert = {
      level: this.determineBatchLevel(),
      violation: {
        ...lastAlert,
        timestamp: new Date(),
        message: `Batch of ${this.state.pendingViolations.length} violations: ${this.getViolationSummary()}`,
      },
      resolution: `Review batched violations. ${this.state.pendingViolations.length} total violations detected.`,
    };

    // Update rate limit state
    this.state.lastAlertTime = Date.now();
    this.state.alertCountInWindow++;
    this.state.pendingTimer = null;
    this.state.pendingViolations = [];

    this.onFlush(batchAlert);
  }

  /**
   * Flush single alert immediately
   */
  private flushNow(alert: ConstraintViolationAlert): void {
    if (!this.shouldSendImmediately()) {
      console.log(
        `[AlertThrottler] Rate limit exceeded, dropping alert for ${alert.violation.table}`
      );
      this.onDropped?.();
      return;
    }

    // Update rate limit state
    this.state.lastAlertTime = Date.now();
    this.state.alertCountInWindow++;

    this.onFlush(alert);
  }

  /**
   * Determine alert level based on batched violations
   */
  private determineBatchLevel(): AlertLevel {
    const hasCritical = this.state.pendingViolations.some(
      v => v.type === 'foreign_key' || v.type === 'primary_key'
    );
    return hasCritical ? 'critical' : 'warning';
  }

  /**
   * Get summary of violations for batch message
   */
  private getViolationSummary(): string {
    const byType: Record<string, number> = {};
    const byTable: Record<string, number> = {};

    for (const v of this.state.pendingViolations) {
      byType[v.type] = (byType[v.type] || 0) + 1;
      byTable[v.table] = (byTable[v.table] || 0) + 1;
    }

    const typeSummary = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');

    const tableSummary = Object.keys(byTable).slice(0, 3).join(', ');

    return `types: [${typeSummary}] on tables: [${tableSummary}]`;
  }

  /**
   * Force flush any pending alerts (e.g., on shutdown)
   */
  flushPending(): void {
    if (this.state.pendingTimer) {
      clearTimeout(this.state.pendingTimer);
    }
    if (this.state.pendingViolations.length > 0) {
      this.flushBatch();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AlertThrottleConfig>): void {
    // Clear any pending timer before updating config
    if (this.state.pendingTimer) {
      clearTimeout(this.state.pendingTimer);
      this.state.pendingTimer = null;
    }
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): AlertThrottleConfig {
    return { ...this.config };
  }

  /**
   * Get current state for monitoring
   */
  getState(): { pendingCount: number; lastAlertTime: number; alertCountInWindow: number } {
    return {
      pendingCount: this.state.pendingViolations.length,
      lastAlertTime: this.state.lastAlertTime,
      alertCountInWindow: this.state.alertCountInWindow,
    };
  }
}

/**
 * Configuration for constraint violation monitoring
 */
export interface ConstraintMonitorConfig {
  /** Enable/disable the monitor */
  enabled: boolean;
  /** Alert on critical violations (FK cascade failures) */
  alertOnCritical: boolean;
  /** Alert on warning violations (orphaned data) */
  alertOnWarning: boolean;
  /** Log violations to audit trail */
  logToAudit: boolean;
  /** Send alerts to external monitoring (e.g., PagerDuty, Slack) */
  externalAlerts: boolean;
  /** Threshold for critical alert (number of violations) */
  criticalThreshold: number;
  /** Throttle configuration for alert rate limiting */
  throttle?: Partial<AlertThrottleConfig>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ConstraintMonitorConfig = {
  enabled: true,
  alertOnCritical: true,
  alertOnWarning: true,
  logToAudit: true,
  externalAlerts: process.env.NODE_ENV === 'production',
  criticalThreshold: 5,
};

/**
 * Violation statistics
 */
interface ViolationStats {
  total: number;
  byType: Record<ConstraintViolationType, number>;
  byTable: Record<string, number>;
  recentViolations: ConstraintViolation[];
}

/**
 * Database Constraint Violation Monitor
 * 
 * Singleton class that monitors constraint violations during database operations,
 * particularly during user deletion cascades.
 */
export class ConstraintViolationMonitor {
  private static instance: ConstraintViolationMonitor;
  private config: ConstraintMonitorConfig;
  private stats: ViolationStats;
  private alertCallbacks: Array<(alert: ConstraintViolationAlert) => void> = [];
  private throttler: AlertThrottler;
  private totalAlertsSent: number = 0;
  private totalAlertsDropped: number = 0;
  
  private constructor(config: Partial<ConstraintMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      total: 0,
      byType: {
        foreign_key: 0,
        unique: 0,
        not_null: 0,
        check: 0,
        primary_key: 0,
      },
      byTable: {},
      recentViolations: [],
    };
    
    // Initialize throttler with config and callbacks
    this.throttler = new AlertThrottler(
      this.config.throttle || {},
      (alert) => this.flushThrottledAlert(alert),
      () => { this.totalAlertsDropped++; }  // Track dropped alerts
    );
    
    // Register metrics for constraint violations
    this.registerMetrics();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConstraintViolationMonitor {
    if (!ConstraintViolationMonitor.instance) {
      ConstraintViolationMonitor.instance = new ConstraintViolationMonitor();
    }
    return ConstraintViolationMonitor.instance;
  }

  /**
   * Register Prometheus metrics for constraint violations
   */
  private registerMetrics(): void {
    // Add constraint violation metrics to the METRICS object
    const violationMetric = {
      name: 'bing_constraint_violations_total',
      type: 'counter' as const,
      description: 'Total number of database constraint violations',
      labels: ['constraint_type', 'table', 'operation', 'severity'],
    };
    
    metricRegistry.register(violationMetric);
  }

  /**
   * Register an alert callback
   */
  onAlert(callback: (alert: ConstraintViolationAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Remove an alert callback
   */
  offAlert(callback: (alert: ConstraintViolationAlert) => void): void {
    const index = this.alertCallbacks.indexOf(callback);
    if (index > -1) {
      this.alertCallbacks.splice(index, 1);
    }
  }

  /**
   * Parse SQLite constraint violation error
   */
  parseConstraintViolationError(error: Error | string): ConstraintViolation | null {
    const errorMessage = typeof error === 'string' ? error : error.message;
    
    // SQLite constraint violation patterns
    const patterns = {
      foreign_key: /FOREIGN KEY constraint failed|FK constraint|foreign key.*violation/i,
      unique: /UNIQUE constraint failed|unique constraint.*violation|duplicate key/i,
      not_null: /NOT NULL constraint failed|not null constraint.*violation/i,
      check: /CHECK constraint failed|check constraint.*violation/i,
      primary_key: /PRIMARY KEY constraint failed|primary key.*violation/i,
    };

    // Table extraction patterns
    const tablePattern = /table\s+[`"']?(\w+)[`"']?/i;
    const constraintPattern = /constraint\s+[`"']?(\w+)[`"']?/i;

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(errorMessage)) {
        const tableMatch = errorMessage.match(tablePattern);
        const constraintMatch = errorMessage.match(constraintPattern);
        
        return {
          type: type as ConstraintViolationType,
          table: tableMatch ? tableMatch[1].replace(/['\"']/g, '') : 'unknown',
          constraintName: constraintMatch ? constraintMatch[1].replace(/['\"']/g, '') : undefined,
          message: errorMessage,
          timestamp: new Date(),
          stackTrace: typeof error === 'object' ? error.stack : undefined,
        };
      }
    }

    return null;
  }

  /**
   * Record a constraint violation
   */
  recordViolation(
    violation: ConstraintViolation,
    context?: { userId?: string; operation?: string }
  ): void {
    if (!this.config.enabled) return;

    // Update violation with context
    if (context) {
      violation.userId = context.userId;
      violation.operation = context.operation;
    }

    // Update stats
    this.stats.total++;
    this.stats.byType[violation.type]++;
    this.stats.byTable[violation.table] = (this.stats.byTable[violation.table] || 0) + 1;
    
    // Keep recent violations (last 100)
    this.stats.recentViolations.unshift(violation);
    if (this.stats.recentViolations.length > 100) {
      this.stats.recentViolations.pop();
    }

    // Record Prometheus metric
    metricRegistry.increment(
      'bing_constraint_violations_total',
      1,
      {
        constraint_type: violation.type,
        table: violation.table,
        operation: violation.operation || 'unknown',
        severity: this.getViolationSeverity(violation.type),
      }
    );

    // Determine alert level
    const alert = this.createAlert(violation);
    
    // Log based on configuration
    if (alert.level === 'critical' && this.config.alertOnCritical) {
      this.logCriticalViolation(violation, alert);
    } else if (alert.level === 'warning' && this.config.alertOnWarning) {
      this.logWarningViolation(violation);
    } else {
      this.logInfoViolation(violation);
    }

    // Notify callbacks via throttler (batched/rate-limited)
    this.throttler.queueAlert(alert);
    
    // Track dropped alerts
    if (!this.throttler.shouldSendImmediately()) {
      this.totalAlertsDropped++;
    }
  }

  /**
   * Record a violation from an error during user deletion
   */
  recordUserDeletionViolation(
    error: Error | string,
    userId: string,
    additionalContext?: Record<string, unknown>
  ): void {
    const parsed = this.parseConstraintViolationError(error);
    
    if (parsed) {
      parsed.userId = userId;
      parsed.operation = 'user_deletion';
      
      this.recordViolation(parsed, { userId, operation: 'user_deletion' });
      
      // Log additional context
      if (additionalContext) {
        console.warn(
          `[ConstraintMonitor] User deletion violation context:`,
          JSON.stringify(additionalContext, null, 2)
        );
      }
    } else {
      // Unparseable error - still log it
      console.error(
        `[ConstraintMonitor] Unparseable constraint error during user deletion:`,
        typeof error === 'string' ? error : error.message
      );
    }
  }

  /**
   * Execute a database operation with constraint monitoring
   */
  async executeWithMonitoring<T>(
    operation: () => T,
    options: {
      operationName: string;
      userId?: string;
      onError?: (error: Error, violation: ConstraintViolation | null) => void;
    }
  ): Promise<T> {
    try {
      return operation();
    } catch (error) {
      const parsed = this.parseConstraintViolationError(error as Error);
      
      if (parsed) {
        parsed.userId = options.userId;
        parsed.operation = options.operationName;
        
        this.recordViolation(parsed, {
          userId: options.userId,
          operation: options.operationName,
        });
        
        if (options.onError) {
          options.onError(error as Error, parsed);
        }
      }
      
      throw error;
    }
  }

  /**
   * Get violation severity
   */
  private getViolationSeverity(type: ConstraintViolationType): string {
    switch (type) {
      case 'foreign_key':
        return 'critical';
      case 'primary_key':
        return 'critical';
      case 'unique':
        return 'warning';
      case 'not_null':
        return 'warning';
      case 'check':
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Create alert from violation
   */
  private createAlert(violation: ConstraintViolation): ConstraintViolationAlert {
    const severity = this.getViolationSeverity(violation.type);
    
    let level: AlertLevel;
    switch (severity) {
      case 'critical':
        level = 'critical';
        break;
      case 'warning':
        level = 'warning';
        break;
      default:
        level = 'info';
    }

    return {
      level,
      violation,
      resolution: this.getResolution(violation),
    };
  }

  /**
   * Get resolution suggestion for violation
   */
  private getResolution(violation: ConstraintViolation): string {
    switch (violation.type) {
      case 'foreign_key':
        return `Ensure ${violation.table} has no orphaned rows referencing non-existent parent tables. Consider using ON DELETE CASCADE or manually cleaning up related records before deletion.`;
      case 'unique':
        return `Check for duplicate values in ${violation.table}.${violation.column || 'columns'} before inserting.`;
      case 'not_null':
        return `Provide non-null value for ${violation.table}.${violation.column || 'required columns'}.`;
      case 'check':
        return `Verify data meets check constraint in ${violation.table}.`;
      default:
        return `Review constraint requirements for ${violation.table}.`;
    }
  }

  /**
   * Log critical violation
   */
  private logCriticalViolation(violation: ConstraintViolation, alert: ConstraintViolationAlert): void {
    console.error(
      `[ConstraintMonitor:CRITICAL] Database constraint violation detected!\n` +
      `  Type: ${violation.type}\n` +
      `  Table: ${violation.table}\n` +
      `  Operation: ${violation.operation || 'unknown'}\n` +
      `  User ID: ${violation.userId || 'N/A'}\n` +
      `  Message: ${violation.message}\n` +
      `  Timestamp: ${violation.timestamp.toISOString()}\n` +
      `  Resolution: ${alert.resolution}`
    );
  }

  /**
   * Log warning violation
   */
  private logWarningViolation(violation: ConstraintViolation): void {
    console.warn(
      `[ConstraintMonitor:WARNING] Database constraint violation:\n` +
      `  Type: ${violation.type}\n` +
      `  Table: ${violation.table}\n` +
      `  Operation: ${violation.operation || 'unknown'}\n` +
      `  Message: ${violation.message}`
    );
  }

  /**
   * Log info violation
   */
  private logInfoViolation(violation: ConstraintViolation): void {
    console.log(
      `[ConstraintMonitor:INFO] Database constraint violation:\n` +
      `  Type: ${violation.type}\n` +
      `  Table: ${violation.table}\n` +
      `  Operation: ${violation.operation || 'unknown'}`
    );
  }

  /**
   * Send external alert
   */
  private sendExternalAlert(alert: ConstraintViolationAlert): void {
    // Hook for external alert integration (PagerDuty, Slack, etc.)
    const alertEnv = process.env.CONSTRAINT_ALERT_WEBHOOK_URL;
    
    if (alertEnv) {
      // Prepare alert payload
      const payload = {
        level: alert.level,
        type: alert.violation.type,
        table: alert.violation.table,
        operation: alert.violation.operation,
        userId: alert.violation.userId,
        message: alert.violation.message,
        timestamp: alert.violation.timestamp.toISOString(),
        resolution: alert.resolution,
      };

      // In production, this would send to external monitoring service
      // For now, log to console for integration debugging
      console.log(
        `[ConstraintMonitor] External alert payload:`,
        JSON.stringify(payload, null, 2)
      );
    }
  }

  /**
   * Get violation statistics
   */
  getStats(): ViolationStats & { config: ConstraintMonitorConfig } {
    return {
      ...this.stats,
      config: this.config,
    };
  }

  /**
   * Get recent violations
   */
  getRecentViolations(limit: number = 50): ConstraintViolation[] {
    return this.stats.recentViolations.slice(0, limit);
  }

  /**
   * Check if threshold exceeded for alert
   */
  isThresholdExceeded(): boolean {
    return this.stats.total >= this.config.criticalThreshold;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      total: 0,
      byType: {
        foreign_key: 0,
        unique: 0,
        not_null: 0,
        check: 0,
        primary_key: 0,
      },
      byTable: {},
      recentViolations: [],
    };
    console.log('[ConstraintMonitor] Statistics reset');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ConstraintMonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[ConstraintMonitor] Configuration updated:', this.config);
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    console.log(`[ConstraintMonitor] Monitoring ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get monitoring status
   */
  getStatus(): {
    enabled: boolean;
    totalViolations: number;
    criticalCount: number;
    thresholdExceeded: boolean;
    throttleStatus: ReturnType<AlertThrottler['getState']>;
    alertsSent: number;
    alertsDropped: number;
  } {
    return {
      enabled: this.config.enabled,
      totalViolations: this.stats.total,
      criticalCount: this.stats.byType.foreign_key + this.stats.byType.primary_key,
      thresholdExceeded: this.isThresholdExceeded(),
      throttleStatus: this.throttler.getState(),
      alertsSent: this.totalAlertsSent,
      alertsDropped: this.totalAlertsDropped,
    };
  }

  /**
   * Callback when throttler flushes an alert
   */
  private flushThrottledAlert(alert: ConstraintViolationAlert): void {
    this.totalAlertsSent++;
    
    // Notify callbacks
    this.alertCallbacks.forEach(callback => {
      try {
        callback(alert);
      } catch (e) {
        console.error('[ConstraintMonitor] Alert callback error:', e);
      }
    });

    // Send external alert if configured
    if (this.config.externalAlerts && alert.level !== 'info') {
      this.sendExternalAlert(alert);
    }
  }

  /**
   * Flush any pending throttled alerts (call on shutdown)
   */
  flushPendingAlerts(): void {
    this.throttler.flushPending();
  }

  /**
   * Update throttle configuration
   */
  updateThrottleConfig(config: Partial<AlertThrottleConfig>): void {
    this.throttler.updateConfig(config);
  }

  /**
   * Get throttle statistics
   */
  getThrottleStats(): { sent: number; dropped: number; pending: number } {
    return {
      sent: this.totalAlertsSent,
      dropped: this.totalAlertsDropped,
      pending: this.throttler.getState().pendingCount,
    };
  }
}

/**
 * Export singleton instance
 */
export const constraintMonitor = ConstraintViolationMonitor.getInstance();

/**
 * Decorator for wrapping database operations with constraint monitoring
 */
export function withConstraintMonitoring(
  operationName: string,
  userId?: string
) {
  return function <T>(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const monitor = ConstraintViolationMonitor.getInstance();
      
      return monitor.executeWithMonitoring(
        () => originalMethod.apply(this, args),
        { operationName, userId }
      );
    };

    return descriptor;
  };
}