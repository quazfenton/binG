/**
 * Session Lock - Metrics and Monitoring
 *
 * Provides comprehensive metrics for session lock operations across all strategies.
 * Includes alerting for low success rates and performance degradation.
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Session:Lock:Metrics');

const MAX_METRICS = 1000;
const ALERT_THRESHOLD = parseFloat(process.env.SESSION_LOCK_ALERT_THRESHOLD || '0.9');
const ALERT_INTERVAL_MS = 60000; // Check every minute

export interface LockMetric {
  strategy: 'redis' | 'memory' | 'queue';
  sessionId: string;
  timestamp: number;
  duration: number;
  attempts: number;
  error?: string;
  expired?: boolean;
}

const metrics: LockMetric[] = [];
const alertHistory: Array<{ timestamp: number; successRate: number; totalAttempts: number }> = [];

/**
 * Record a lock acquisition metric
 */
export function recordLockMetric(metric: LockMetric): void {
  metrics.push(metric);
  
  // Trim to max size
  if (metrics.length > MAX_METRICS) {
    metrics.shift();
  }
}

/**
 * Get comprehensive lock metrics
 */
export function getLockMetrics(): {
  totalAttempts: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDuration: number;
  avgAttempts: number;
  byStrategy: Record<string, {
    attempts: number;
    successes: number;
    failures: number;
    successRate: number;
    avgDuration: number;
  }>;
  recent: {
    last5Minutes: { successRate: number; attempts: number };
    last15Minutes: { successRate: number; attempts: number };
    last60Minutes: { successRate: number; attempts: number };
  };
} {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const fifteenMinAgo = now - 15 * 60 * 1000;
  const hourAgo = now - 60 * 60 * 1000;

  const byStrategy: Record<string, {
    attempts: number;
    successes: number;
    failures: number;
    totalDuration: number;
    totalAttempts: number;
  }> = {};

  let totalAttempts = 0;
  let successes = 0;
  let failures = 0;
  let totalDuration = 0;
  let totalAttemptsCount = 0;

  const recent5Min: LockMetric[] = [];
  const recent15Min: LockMetric[] = [];
  const recent60Min: LockMetric[] = [];

  for (const m of metrics) {
    // Overall stats
    totalAttempts++;
    totalDuration += m.duration;
    totalAttemptsCount += m.attempts;
    
    if (m.error) {
      failures++;
    } else {
      successes++;
    }

    // By strategy
    if (!byStrategy[m.strategy]) {
      byStrategy[m.strategy] = {
        attempts: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0,
        totalAttempts: 0,
      };
    }
    byStrategy[m.strategy].attempts++;
    byStrategy[m.strategy].totalDuration += m.duration;
    byStrategy[m.strategy].totalAttempts += m.attempts;
    
    if (m.error) {
      byStrategy[m.strategy].failures++;
    } else {
      byStrategy[m.strategy].successes++;
    }

    // Recent windows
    if (m.timestamp >= fiveMinAgo) recent5Min.push(m);
    if (m.timestamp >= fifteenMinAgo) recent15Min.push(m);
    if (m.timestamp >= hourAgo) recent60Min.push(m);
  }

  // Calculate rates and averages
  const result: any = {
    totalAttempts,
    successes,
    failures,
    successRate: totalAttempts > 0 ? successes / totalAttempts : 0,
    avgDuration: totalAttempts > 0 ? totalDuration / totalAttempts : 0,
    avgAttempts: totalAttempts > 0 ? totalAttemptsCount / totalAttempts : 0,
    byStrategy: {},
    recent: {
      last5Minutes: calculateRecentStats(recent5Min),
      last15Minutes: calculateRecentStats(recent15Min),
      last60Minutes: calculateRecentStats(recent60Min),
    },
  };

  // Process by-strategy stats
  for (const [strategy, data] of Object.entries(byStrategy)) {
    result.byStrategy[strategy] = {
      attempts: data.attempts,
      successes: data.successes,
      failures: data.failures,
      successRate: data.attempts > 0 ? data.successes / data.attempts : 0,
      avgDuration: data.attempts > 0 ? data.totalDuration / data.attempts : 0,
    };
  }

  return result;
}

/**
 * Calculate stats for recent time window
 */
function calculateRecentStats(metrics: LockMetric[]): {
  successRate: number;
  attempts: number;
} {
  if (metrics.length === 0) {
    return { successRate: 0, attempts: 0 };
  }
  
  const successes = metrics.filter(m => !m.error).length;
  return {
    successRate: successes / metrics.length,
    attempts: metrics.length,
  };
}

/**
 * Start alerting monitor
 */
let alertMonitor: NodeJS.Timeout | null = null;

export function startAlertMonitor(): void {
  if (alertMonitor) {
    clearInterval(alertMonitor);
  }

  alertMonitor = setInterval(() => {
    const recent = metrics.slice(-100); // Last 100 attempts
    
    if (recent.length >= 10) {
      const successes = recent.filter(m => !m.error).length;
      const successRate = successes / recent.length;

      if (successRate < ALERT_THRESHOLD) {
        const alert = {
          timestamp: Date.now(),
          successRate,
          totalAttempts: recent.length,
        };
        
        alertHistory.push(alert);
        
        // Keep last 10 alerts
        if (alertHistory.length > 10) {
          alertHistory.shift();
        }

        log.error('🚨 ALERT: Session lock success rate below threshold', {
          successRate: (successRate * 100).toFixed(1) + '%',
          threshold: (ALERT_THRESHOLD * 100).toFixed(1) + '%',
          totalAttempts: recent.length,
          failures: recent.length - successes,
          byStrategy: getStrategyBreakdown(recent),
        });

        // Emit to monitoring system (if configured)
        emitToMonitoringSystem(successRate, recent.length);
      }
    }
  }, ALERT_INTERVAL_MS);

  log.info('Lock alert monitor started', { 
    alertThreshold: (ALERT_THRESHOLD * 100).toFixed(1) + '%',
    checkInterval: ALERT_INTERVAL_MS,
  });
}

/**
 * Stop alerting monitor
 */
export function stopAlertMonitor(): void {
  if (alertMonitor) {
    clearInterval(alertMonitor);
    alertMonitor = null;
    log.info('Lock alert monitor stopped');
  }
}

/**
 * Get strategy breakdown for recent metrics
 */
function getStrategyBreakdown(recentMetrics: LockMetric[]): Record<string, {
  attempts: number;
  failures: number;
  failureRate: number;
}> {
  const breakdown: Record<string, { attempts: number; failures: number }> = {};
  
  for (const m of recentMetrics) {
    if (!breakdown[m.strategy]) {
      breakdown[m.strategy] = { attempts: 0, failures: 0 };
    }
    breakdown[m.strategy].attempts++;
    if (m.error) {
      breakdown[m.strategy].failures++;
    }
  }

  const result: any = {};
  for (const [strategy, data] of Object.entries(breakdown)) {
    result[strategy] = {
      attempts: data.attempts,
      failures: data.failures,
      failureRate: data.attempts > 0 ? (data.failures / data.attempts * 100).toFixed(1) + '%' : '0%',
    };
  }

  return result;
}

/**
 * Emit metrics to external monitoring system
 */
function emitToMonitoringSystem(successRate: number, totalAttempts: number): void {
  // StatsD integration
  if (process.env.STATSD_HOST) {
    try {
      // Create UDP socket for StatsD
      const dgram = require('dgram');
      const socket = dgram.createSocket('udp4');

      socket.on('error', (err: Error) => {
        log.warn('StatsD socket error', { error: err });
      });

      const statsdHost = process.env.STATSD_HOST.split(':')[0];
      const statsdPort = parseInt(process.env.STATSD_HOST.split(':')[1] || '8125');
      const metrics = getLockMetrics();
      const strategyEntries = Object.entries(metrics.byStrategy);
      let pendingSends = 2 + strategyEntries.length;

      const onSend = (err: Error | null) => {
        if (err) {
          log.warn('Failed to send StatsD metric', { error: err });
        }
        pendingSends--;
        if (pendingSends === 0) {
          socket.close();
          log.debug('Emitted metrics to StatsD', { successRate, totalAttempts });
        }
      };

      // Send success rate metric
      const successRateMsg = `session_lock.success_rate:${successRate * 100}|g`;
      socket.send(Buffer.from(successRateMsg), 0, successRateMsg.length, statsdPort, statsdHost, onSend);

      // Send total attempts metric
      const attemptsMsg = `session_lock.attempts:${totalAttempts}|c`;
      socket.send(Buffer.from(attemptsMsg), 0, attemptsMsg.length, statsdPort, statsdHost, onSend);

      // Send by-strategy metrics
      for (const [strategy, data] of strategyEntries) {
        const strategyMsg = `session_lock.${strategy}.success_rate:${data.successRate * 100}|g`;
        socket.send(Buffer.from(strategyMsg), 0, strategyMsg.length, statsdPort, statsdHost, onSend);
      }
    } catch (error) {
      log.warn('Failed to emit to StatsD', { error });
    }
  }

  // Prometheus/OpenTelemetry integration via webhook
  if (process.env.LOCK_ALERT_WEBHOOK_URL) {
    const payload = {
      alert: 'session_lock_low_success_rate',
      successRate,
      totalAttempts,
      timestamp: Date.now(),
      threshold: ALERT_THRESHOLD,
      metrics: getLockMetrics(),
    };

    fetch(process.env.LOCK_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(error => {
      log.warn('Failed to send webhook alert', { error });
    });
  }

  // OpenTelemetry metrics (if available)
  if (process.env.ENABLE_OTEL === 'true') {
    try {
      // Dynamic import to avoid hard dependency
      import('@opentelemetry/api').then(({ metrics }) => {
        const meter = metrics.getMeter('session-lock');
        const successRateHistogram = meter.createHistogram('session_lock_success_rate', {
          description: 'Session lock success rate',
        });
        successRateHistogram.record(successRate * 100);
      }).catch(() => {
        // OpenTelemetry not available
      });
    } catch (error) {
      log.debug('OpenTelemetry metrics not available');
    }
  }
}

/**
 * Get alert history
 */
export function getAlertHistory(): Array<{
  timestamp: number;
  successRate: number;
  totalAttempts: number;
}> {
  return [...alertHistory];
}

/**
 * Get lock health status
 */
export function getLockHealth(): {
  status: 'healthy' | 'degraded' | 'unhealthy';
  successRate: number;
  recentAttempts: number;
  recommendation?: string;
} {
  const metrics = getLockMetrics();
  const recent = metrics.recent.last5Minutes;

  if (recent.attempts === 0) {
    return {
      status: 'healthy',
      successRate: 1,
      recentAttempts: 0,
      recommendation: 'No recent lock attempts',
    };
  }

  if (recent.successRate >= ALERT_THRESHOLD) {
    return {
      status: 'healthy',
      successRate: recent.successRate,
      recentAttempts: recent.attempts,
    };
  }

  if (recent.successRate >= ALERT_THRESHOLD - 0.2) {
    return {
      status: 'degraded',
      successRate: recent.successRate,
      recentAttempts: recent.attempts,
      recommendation: 'Consider checking Redis connectivity and memory lock fallback',
    };
  }

  return {
    status: 'unhealthy',
    successRate: recent.successRate,
    recentAttempts: recent.attempts,
    recommendation: 'Immediate attention required - check all lock strategies',
  };
}

/**
 * Clear all metrics (for testing only)
 */
export function __clearAllMetrics__(): void {
  metrics.length = 0;
  alertHistory.length = 0;
  log.warn('All lock metrics cleared (testing only)');
}

// Auto-start alert monitor if enabled
if (process.env.SESSION_LOCK_METRICS_ENABLED !== 'false') {
  startAlertMonitor();
}
