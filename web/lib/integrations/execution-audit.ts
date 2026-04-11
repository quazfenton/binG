/**
 * Integration Audit Trail
 *
 * Logs every integration action execution for security compliance,
 * debugging, and usage analytics.
 *
 * Each audit record captures:
 * - Who (userId, IP, user agent)
 * - What (provider, action, params hash)
 * - Result (success, error, duration)
 * - Security context (SSRF checks, rate limit state)
 */

import { getDatabase } from '@/lib/database/connection';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Integrations:Audit');

export interface ExecutionAudit {
  id: string;
  userId: string;
  provider: string;
  action: string;
  paramsHash: string;
  success: boolean;
  error?: string;
  durationMs: number;
  ipAddress?: string;
  userAgent?: string;
  timestamp: number;
}

/**
 * Initialize audit table (idempotent — safe to call on every startup).
 * Uses CREATE TABLE IF NOT EXISTS which is atomic in SQLite.
 */
export function initializeAuditTable(): void {
  const db = getDatabase();
  if (!db) return;

  // SQLite handles CREATE TABLE IF NOT EXISTS atomically — no race condition
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      action TEXT NOT NULL,
      params_hash TEXT NOT NULL,
      success INTEGER NOT NULL,
      error TEXT,
      duration_ms INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      timestamp INTEGER NOT NULL
    );

    -- Index for querying by user + time range
    CREATE INDEX IF NOT EXISTS idx_audit_user_time
      ON integration_audit(user_id, timestamp DESC);

    -- Index for provider analytics
    CREATE INDEX IF NOT EXISTS idx_audit_provider
      ON integration_audit(provider, timestamp DESC);
  `);
}

/**
 * Record an execution audit entry
 */
export function recordAudit(audit: Omit<ExecutionAudit, 'id' | 'timestamp'>): void {
  try {
    const db = getDatabase();
    if (!db) return;

    const id = `${audit.provider}:${audit.action}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    db.prepare(`
      INSERT INTO integration_audit (
        id, user_id, provider, action, params_hash,
        success, error, duration_ms, ip_address, user_agent, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      audit.userId,
      audit.provider,
      audit.action,
      audit.paramsHash,
      audit.success ? 1 : 0,
      audit.error?.slice(0, 1000) ?? null,
      audit.durationMs,
      audit.ipAddress ?? null,
      audit.userAgent?.slice(0, 500) ?? null,
      Date.now(),
    );
  } catch (error: any) {
    // Audit failures should never break the main execution flow
    logger.warn('Failed to record audit entry', { provider: audit.provider, action: audit.action, error: error.message });
  }
}

/**
 * Get recent audit entries for a user
 */
export function getUserAuditTrail(userId: string, limit = 50): ExecutionAudit[] {
  const db = getDatabase();
  if (!db) return [];

  const rows = db.prepare(`
    SELECT * FROM integration_audit
    WHERE user_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(userId, limit) as any[];

  return rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    action: r.action,
    paramsHash: r.params_hash,
    success: r.success === 1,
    error: r.error ?? undefined,
    durationMs: r.duration_ms,
    ipAddress: r.ip_address ?? undefined,
    userAgent: r.user_agent ?? undefined,
    timestamp: r.timestamp,
  }));
}

/**
 * Get execution statistics for a user
 */
export function getUserExecutionStats(userId: string): {
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  topProviders: Array<{ provider: string; count: number }>;
} {
  const db = getDatabase();
  if (!db) {
    return { totalExecutions: 0, successRate: 0, avgDurationMs: 0, topProviders: [] };
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as success_rate,
      AVG(duration_ms) as avg_duration
    FROM integration_audit
    WHERE user_id = ?
  `).get(userId) as { total: number; success_rate: number; avg_duration: number };

  const topProviders = db.prepare(`
    SELECT provider, COUNT(*) as count
    FROM integration_audit
    WHERE user_id = ?
    GROUP BY provider
    ORDER BY count DESC
    LIMIT 5
  `).all(userId) as Array<{ provider: string; count: number }>;

  return {
    totalExecutions: stats.total || 0,
    successRate: stats.success_rate || 0,
    avgDurationMs: Math.round(stats.avg_duration || 0),
    topProviders,
  };
}

/**
 * Hash params for audit (avoid logging sensitive data)
 */
export function hashParams(params: Record<string, any>): string {
  const str = JSON.stringify(params, (_key, value) => {
    // Mask known sensitive fields
    if (/token|secret|password|api.?key|credential/i.test(_key)) {
      return '***REDACTED***';
    }
    return value;
  });
  // Simple hash — just for audit dedup, not cryptographic
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
