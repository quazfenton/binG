/**
 * Quota Manager - Tracks tool/sandbox call usage per provider and disables
 * providers when quotas are reached to prevent overages.
 *
 * Uses SQLite database for persistent storage across server restarts.
 *
 * NOTE: Quotas ONLY apply to tool, sandbox, and specific media providers.
 * Regular LLM chat requests are NOT tracked.
 */

import { getDatabase } from '@/lib/database/connection';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createLogger } from '@/lib/utils/logger'

const log = createLogger('QuotaManager')

export interface ProviderQuota {
  provider: string;
  monthlyLimit: number; // Keep this name for schema compatibility, use for daily too
  currentUsage: number;
  resetDate: string; // ISO date of next reset
  isDisabled: boolean;
  resetPeriod?: 'monthly' | 'daily';
}

// Default limits (can be overridden via env vars)
const DEFAULT_QUOTAS: Record<string, { limit: number, period: 'monthly' | 'daily' }> = {
  composio: { limit: 20000, period: 'monthly' },
  arcade: { limit: 10000, period: 'monthly' },
  nango: { limit: 10000, period: 'monthly' },
  daytona: { limit: 5000, period: 'monthly' },
  runloop: { limit: 5000, period: 'monthly' },
  microsandbox: { limit: 10000, period: 'monthly' },
  e2b: { limit: 1000, period: 'monthly' },
  mistral: { limit: 2000, period: 'monthly' },
  blaxel: { limit: 5000, period: 'monthly' },
  sprites: { limit: 2000, period: 'monthly' },
  google_imagen: { limit: 500, period: 'daily' },
};

class QuotaManager {
  private quotas: Map<string, ProviderQuota> = new Map();
  private db: any = null;
  private initialized = false;
  private dbInitialized = false;
  private readonly quotaFilePath: string;

  constructor() {
    this.quotaFilePath = process.env.QUOTA_FALLBACK_FILE_PATH || join(process.cwd(), 'data', 'provider-quotas.json');
  }

  private ensureDatabase(): void {
    if (this.dbInitialized) return;
    this.dbInitialized = true;

    try {
      this.db = getDatabase();
      if (!this.db) return;

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS provider_quotas (
          provider TEXT PRIMARY KEY,
          monthly_limit INTEGER,
          current_usage INTEGER DEFAULT 0,
          reset_date TEXT,
          is_disabled INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_provider_quotas_provider ON provider_quotas(provider);
      `);

      // Migration: add reset_period column if missing
      try {
        this.db.exec("ALTER TABLE provider_quotas ADD COLUMN reset_period TEXT DEFAULT 'monthly'");
      } catch (e) {
        // Column probably exists
      }
    } catch (error) {
      console.error('[QuotaManager] Failed to ensure quota schema:', error);
    }
  }

  private initializeQuotasFromDefaults(): void {
    for (const [provider, config] of Object.entries(DEFAULT_QUOTAS)) {
      const envKey = `QUOTA_${provider.toUpperCase()}_${config.period.toUpperCase()}`;
      let limit = config.limit;

      if (process.env[envKey]) {
        const parsed = parseInt(process.env[envKey]!, 10);
        if (!isNaN(parsed) && parsed > 0) {
          limit = parsed;
        }
      }

      if (!this.quotas.has(provider)) {
        this.quotas.set(provider, {
          provider,
          monthlyLimit: limit,
          currentUsage: 0,
          resetDate: this.getNextResetDate(config.period),
          isDisabled: false,
          resetPeriod: config.period,
        });
      }
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.initializeQuotasFromDefaults();
    this.loadQuotasFromDatabase();
    this.loadQuotasFromFile();
  }

  private loadQuotasFromDatabase(): void {
    this.ensureDatabase();
    if (!this.db) return;

    try {
      const rows = this.db.prepare('SELECT * FROM provider_quotas').all();
      for (const row of rows) {
        this.quotas.set(row.provider, {
          provider: row.provider,
          monthlyLimit: row.monthly_limit,
          currentUsage: row.current_usage,
          resetDate: row.reset_date,
          isDisabled: row.is_disabled === 1,
          resetPeriod: row.reset_period as 'monthly' | 'daily' || 'monthly',
        });
      }
    } catch (error) {
      console.warn('[QuotaManager] Failed to load quotas from database:', error);
    }
  }

  private loadQuotasFromFile(): void {
    try {
      if (!existsSync(this.quotaFilePath)) return;
      const raw = readFileSync(this.quotaFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        quotas?: Record<string, {
          monthlyLimit: number;
          currentUsage: number;
          resetDate: string;
          isDisabled: boolean;
          resetPeriod?: 'monthly' | 'daily';
        }>
      };

      if (!parsed?.quotas) return;
      for (const [provider, fromFile] of Object.entries(parsed.quotas)) {
        const existing = this.quotas.get(provider);
        if (!existing) {
          this.quotas.set(provider, {
            provider,
            monthlyLimit: fromFile.monthlyLimit,
            currentUsage: fromFile.currentUsage,
            resetDate: fromFile.resetDate,
            isDisabled: !!fromFile.isDisabled,
            resetPeriod: fromFile.resetPeriod || 'monthly',
          });
          continue;
        }

        existing.currentUsage = Math.max(existing.currentUsage, fromFile.currentUsage);
        existing.monthlyLimit = Math.max(existing.monthlyLimit, fromFile.monthlyLimit || 0);
        if (new Date(fromFile.resetDate) > new Date(existing.resetDate)) {
           existing.resetDate = fromFile.resetDate;
        }
        existing.isDisabled = existing.currentUsage >= existing.monthlyLimit || !!fromFile.isDisabled;
      }
    } catch (error) {
      console.warn('[QuotaManager] Failed to load quota file fallback:', error);
    }
  }

  private saveAllQuotasToFile(): void {
    try {
      const dir = dirname(this.quotaFilePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const payload = {
        version: 2,
        updatedAt: new Date().toISOString(),
        quotas: Object.fromEntries(
          Array.from(this.quotas.entries()).map(([provider, quota]) => [
            provider,
            {
              monthlyLimit: quota.monthlyLimit,
              currentUsage: quota.currentUsage,
              resetDate: quota.resetDate,
              isDisabled: quota.isDisabled,
              resetPeriod: quota.resetPeriod,
            }
          ])
        )
      };
      writeFileSync(this.quotaFilePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
      console.warn('[QuotaManager] Failed to save quotas to file:', error);
    }
  }

  private saveQuotaToDatabase(quota: ProviderQuota): void {
    this.ensureDatabase();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO provider_quotas
        (provider, monthly_limit, current_usage, reset_date, is_disabled, reset_period, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(
        quota.provider,
        quota.monthlyLimit,
        quota.currentUsage,
        quota.resetDate,
        quota.isDisabled ? 1 : 0,
        quota.resetPeriod || 'monthly'
      );
    } catch (error) {
      console.error('[QuotaManager] Failed to save quota to database:', error);
    }
  }

  private getNextResetDate(period: 'monthly' | 'daily' = 'monthly'): string {
    const now = new Date();
    if (period === 'daily') {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return tomorrow.toISOString();
    }
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
  }

  private checkAndResetIfNeeded(quota: ProviderQuota): void {
    const now = new Date();
    if (now >= new Date(quota.resetDate)) {
      quota.currentUsage = 0;
      quota.resetDate = this.getNextResetDate(quota.resetPeriod);
      quota.isDisabled = false;
      log.info(`[QuotaManager] Reset quota for ${quota.provider}. New reset date: ${quota.resetDate}`);
      this.saveQuotaToDatabase(quota);
    }
  }

  checkQuota(provider: string): { allowed: boolean; remaining: number; isDisabled: boolean } {
    this.ensureInitialized();
    
    const quota = this.quotas.get(provider);
    if (!quota) {
      return { allowed: true, remaining: Infinity, isDisabled: false };
    }

    this.checkAndResetIfNeeded(quota);

    if (quota.isDisabled) {
      return { allowed: false, remaining: 0, isDisabled: true };
    }

    const remaining = quota.monthlyLimit - quota.currentUsage;
    const allowed = remaining > 0;

    if (!allowed && !quota.isDisabled) {
      quota.isDisabled = true;
      this.saveQuotaToDatabase(quota);
      this.saveAllQuotasToFile();
    }

    return { allowed, remaining, isDisabled: quota.isDisabled };
  }

  incrementUsage(provider: string, amount: number = 1): void {
    this.ensureInitialized();
    
    const quota = this.quotas.get(provider);
    if (!quota) return;

    quota.currentUsage += amount;
    if (quota.currentUsage >= quota.monthlyLimit) {
      quota.isDisabled = true;
    }

    this.saveQuotaToDatabase(quota);
    this.saveAllQuotasToFile();
  }

  getAllQuotas(): ProviderQuota[] {
    this.ensureInitialized();
    return Array.from(this.quotas.values());
  }
}

export const quotaManager = new QuotaManager();
