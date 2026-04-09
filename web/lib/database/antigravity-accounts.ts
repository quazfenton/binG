/**
 * Antigravity Accounts Database Helper
 *
 * Loads and manages user Antigravity OAuth accounts from SQLite.
 * Supports both per-user accounts and a master server-level account.
 *
 * Account Priority:
 * 1. Per-user OAuth account (user connected their own Google account)
 * 2. Master server account (configured via env vars, shared by all users)
 *
 * Used by LLM provider for multi-account rate-limit rotation.
 */

import { getDatabase } from '@/lib/database/connection';

export interface AntigravityAccount {
  id: string;
  userId: string;
  email: string;
  refreshToken: string;
  projectId: string;
  enabled: boolean;
  lastUsedAt: number;
  quotaUpdatedAt: number;
  cachedQuota?: Record<string, unknown>;
  isMaster?: boolean; // Flag to identify master account
}

/**
 * Get the master (server-level) Antigravity account from environment variables.
 * This account is shared by all users when no per-user account is available.
 */
function getMasterAccount(): AntigravityAccount | null {
  const refreshToken = process.env.ANTIGRAVITY_REFRESH_TOKEN;
  if (!refreshToken) {
    return null; // No master account configured
  }

  return {
    id: 'antigravity-master',
    userId: 'master',
    email: process.env.ANTIGRAVITY_MASTER_EMAIL || 'master@antigravity.local',
    refreshToken,
    projectId: process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID || 'rising-fact-p41fc',
    enabled: true,
    lastUsedAt: Date.now(),
    quotaUpdatedAt: 0,
    isMaster: true,
  };
}

/**
 * Get all enabled Antigravity accounts for a user.
 * Returns per-user accounts first, then master account as fallback.
 * In multi-user mode, filter by userId. For single-user, pass 'default'.
 */
export async function getAntigravityAccounts(
  userId: string
): Promise<AntigravityAccount[]> {
  try {
    const db = getDatabase();

    // Ensure table exists (idempotent)
    db.exec(`
      CREATE TABLE IF NOT EXISTS antigravity_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'rising-fact-p41fc',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_used_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        quota_updated_at INTEGER NOT NULL DEFAULT 0,
        cached_quota TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_antigravity_user ON antigravity_accounts(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_antigravity_enabled ON antigravity_accounts(enabled)`);

    const rows = db.prepare(`
      SELECT id, user_id as userId, email, refresh_token as refreshToken,
             project_id as projectId, enabled, last_used_at as lastUsedAt,
             quota_updated_at as quotaUpdatedAt, cached_quota as cachedQuota
      FROM antigravity_accounts
      WHERE user_id = ? AND enabled = 1
      ORDER BY last_used_at ASC
    `).all(userId) as AntigravityAccount[];

    const userAccounts = rows.map(row => ({
      ...row,
      enabled: Boolean(row.enabled),
      cachedQuota: row.cachedQuota ? JSON.parse(String(row.cachedQuota)) : undefined,
      isMaster: false,
    }));

    // Add master account as fallback if configured
    const masterAccount = getMasterAccount();
    if (masterAccount) {
      return [...userAccounts, masterAccount];
    }

    return userAccounts;
  } catch (error: any) {
    console.error('[Antigravity Accounts] Failed to load accounts:', error.message);
    return [];
  }
}

/**
 * Save a new Antigravity account
 */
export async function saveAntigravityAccount(account: {
  userId: string;
  email: string;
  refreshToken: string;
  projectId: string;
}): Promise<void> {
  const db = getDatabase();

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS antigravity_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'rising-fact-p41fc',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      quota_updated_at INTEGER NOT NULL DEFAULT 0,
      cached_quota TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const id = `antigravity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO antigravity_accounts (id, user_id, email, refresh_token, project_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, account.userId, account.email, account.refreshToken, account.projectId);
}

/**
 * Update last used timestamp for an account
 */
export async function touchAntigravityAccount(accountId: string): Promise<void> {
  try {
    const db = getDatabase();
    db.prepare(`UPDATE antigravity_accounts SET last_used_at = strftime('%s', 'now') WHERE id = ?`).run(accountId);
  } catch {
    // Non-critical — ignore
  }
}

/**
 * Disable an account (e.g., token revoked)
 */
export async function disableAntigravityAccount(accountId: string): Promise<void> {
  try {
    const db = getDatabase();
    db.prepare(`UPDATE antigravity_accounts SET enabled = 0 WHERE id = ?`).run(accountId);
  } catch {
    // Non-critical — ignore
  }
}

/**
 * Check if a master account is configured via environment variables
 */
export function isMasterAccountConfigured(): boolean {
  return !!process.env.ANTIGRAVITY_REFRESH_TOKEN;
}

/**
 * Get master account info (if configured)
 * Returns null if no master account is configured
 */
export function getMasterAccountInfo(): { email: string; projectId: string } | null {
  const refreshToken = process.env.ANTIGRAVITY_REFRESH_TOKEN;
  if (!refreshToken) {
    return null;
  }

  return {
    email: process.env.ANTIGRAVITY_MASTER_EMAIL || 'master@antigravity.local',
    projectId: process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID || 'rising-fact-p41fc',
  };
}
