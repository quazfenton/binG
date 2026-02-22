/**
 * Email Quota Manager - Tracks email sending usage per provider and 
 * automatically switches providers when monthly quotas are reached.
 * 
 * Supports automatic fallback chain:
 * Brevo (300/month free) → Resend → SendGrid → SMTP
 * 
 * Uses SQLite database for persistent storage across server restarts.
 */

import { getDatabase } from '@/lib/database/connection';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface EmailProviderQuota {
  provider: 'brevo' | 'resend' | 'sendgrid' | 'smtp';
  monthlyLimit: number;
  currentUsage: number;
  resetDate: string; // ISO date of next reset
  isDisabled: boolean;
  priority: number; // Lower = higher priority
}

// Default monthly limits for email providers
const DEFAULT_EMAIL_QUOTAS: Record<string, { limit: number; priority: number }> = {
  brevo: { limit: 9000, priority: 1 },       // 300 emails/day × 30 days
  mailersend: { limit: 3000, priority: 2 },  // 100 emails/day × 30 days
  resend: { limit: 3000, priority: 3 },      // 3000 emails/month free
  sendgrid: { limit: 3000, priority: 4 },    // 100 emails/day × 30 days
  smtp: { limit: 10000, priority: 5 },       // SMTP relay - typically high limits
};

class EmailQuotaManager {
  private quotas: Map<string, EmailProviderQuota> = new Map();
  private db: any = null;
  private initialized = false;
  private dbInitialized = false;
  private readonly quotaFilePath: string;

  constructor() {
    this.quotaFilePath = process.env.EMAIL_QUOTA_FALLBACK_FILE_PATH || 
      join(process.cwd(), 'data', 'email-provider-quotas.json');
    this.initializeQuotas();
  }

  /**
   * Lazily initialize database connection only when needed
   */
  private ensureDatabase(): void {
    if (this.dbInitialized) return;

    try {
      this.db = getDatabase();
      this.ensureSchema();
      this.dbInitialized = true;
    } catch (error) {
      console.error('[EmailQuotaManager] Failed to initialize database:', error);
      this.db = null;
      this.dbInitialized = false;
    }
  }

  private ensureSchema(): void {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS email_provider_quotas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL UNIQUE,
          monthly_limit INTEGER NOT NULL DEFAULT 0,
          current_usage INTEGER NOT NULL DEFAULT 0,
          reset_date DATETIME NOT NULL,
          is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
          priority INTEGER NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_email_quotas_provider ON email_provider_quotas(provider);
      `);
    } catch (error) {
      console.error('[EmailQuotaManager] Failed to ensure schema:', error);
    }
  }

  private initializeQuotas(): void {
    for (const [provider, config] of Object.entries(DEFAULT_EMAIL_QUOTAS)) {
      const envKey = `EMAIL_QUOTA_${provider.toUpperCase()}_MONTHLY`;
      let limit = config.limit;

      if (process.env[envKey]) {
        const parsed = parseInt(process.env[envKey]!, 10);
        if (!isNaN(parsed) && parsed > 0) {
          limit = parsed;
        } else {
          console.warn(`[EmailQuotaManager] Invalid ${envKey} value. Using default: ${config.limit}`);
        }
      }

      this.quotas.set(provider, {
        provider: provider as EmailProviderQuota['provider'],
        monthlyLimit: limit,
        currentUsage: 0,
        resetDate: this.getNextResetDate(),
        isDisabled: false,
        priority: config.priority,
      });
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.initializeQuotas();
    this.loadQuotasFromDatabase();
    this.loadQuotasFromFile();
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
          priority: number;
        }>
      };

      if (!parsed?.quotas) return;
      for (const [provider, fromFile] of Object.entries(parsed.quotas)) {
        const existing = this.quotas.get(provider);
        if (!existing) {
          this.quotas.set(provider, {
            provider: provider as EmailProviderQuota['provider'],
            monthlyLimit: fromFile.monthlyLimit,
            currentUsage: fromFile.currentUsage,
            resetDate: fromFile.resetDate,
            isDisabled: !!fromFile.isDisabled,
            priority: fromFile.priority || DEFAULT_EMAIL_QUOTAS[provider]?.priority || 99,
          });
          continue;
        }

        // Merge: preserve highest usage, keep configured limit
        existing.currentUsage = Math.max(existing.currentUsage, fromFile.currentUsage);
        existing.monthlyLimit = Math.max(existing.monthlyLimit, fromFile.monthlyLimit || 0);
        existing.resetDate = new Date(fromFile.resetDate) > new Date(existing.resetDate)
          ? fromFile.resetDate
          : existing.resetDate;
        existing.isDisabled = existing.currentUsage >= existing.monthlyLimit || !!fromFile.isDisabled;
        existing.priority = fromFile.priority || existing.priority;
      }
    } catch (error) {
      console.warn('[EmailQuotaManager] Failed to load quota file:', error);
    }
  }

  private saveAllQuotasToFile(): void {
    try {
      const dir = dirname(this.quotaFilePath);
      mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.quotaFilePath}.tmp`;
      const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        quotas: Object.fromEntries(
          Array.from(this.quotas.entries()).map(([provider, quota]) => [
            provider,
            {
              monthlyLimit: quota.monthlyLimit,
              currentUsage: quota.currentUsage,
              resetDate: quota.resetDate,
              isDisabled: quota.isDisabled,
              priority: quota.priority,
            },
          ])
        ),
      };
      writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
      renameSync(tmpPath, this.quotaFilePath);
    } catch (error) {
      console.warn('[EmailQuotaManager] Failed to save quota file:', error);
    }
  }

  private loadQuotasFromDatabase(): void {
    this.ensureDatabase();
    if (!this.db) {
      this.initializeQuotas();
      return;
    }

    try {
      const stmt = this.db.prepare('SELECT * FROM email_provider_quotas');
      const rows = stmt.all() as any[];

      for (const row of rows) {
        this.quotas.set(row.provider, {
          provider: row.provider,
          monthlyLimit: row.monthly_limit,
          currentUsage: row.current_usage,
          resetDate: row.reset_date,
          isDisabled: !!row.is_disabled,
          priority: row.priority || DEFAULT_EMAIL_QUOTAS[row.provider]?.priority || 99,
        });
      }

      // Add any providers not in DB yet
      for (const [provider, config] of Object.entries(DEFAULT_EMAIL_QUOTAS)) {
        if (!this.quotas.has(provider)) {
          const quota = {
            provider: provider as EmailProviderQuota['provider'],
            monthlyLimit: config.limit,
            currentUsage: 0,
            resetDate: this.getNextResetDate(),
            isDisabled: false,
            priority: config.priority,
          };
          this.quotas.set(provider, quota);
          this.saveQuotaToDatabase(quota);
        }
      }

      console.log(`[EmailQuotaManager] Loaded ${this.quotas.size} email provider quotas`);
    } catch (error: any) {
      if (error.code === 'SQLITE_ERROR' && error.message.includes('no such table')) {
        console.log('[EmailQuotaManager] Quota table not found, using in-memory storage');
        this.initializeQuotas();
      } else {
        console.error('[EmailQuotaManager] Failed to load quotas from database:', error);
        this.initializeQuotas();
      }
    }
  }

  private saveQuotaToDatabase(quota: EmailProviderQuota): void {
    this.ensureDatabase();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO email_provider_quotas
        (provider, monthly_limit, current_usage, reset_date, is_disabled, priority, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(
        quota.provider,
        quota.monthlyLimit,
        quota.currentUsage,
        quota.resetDate,
        quota.isDisabled ? 1 : 0,
        quota.priority
      );
    } catch (error) {
      console.error('[EmailQuotaManager] Failed to save quota to database:', error);
    }
  }

  private persistQuota(quota: EmailProviderQuota): void {
    this.saveQuotaToDatabase(quota);
    this.saveAllQuotasToFile();
  }

  private getNextResetDate(): string {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
  }

  private checkAndResetIfNeeded(quota: EmailProviderQuota): void {
    const now = new Date();
    if (now >= new Date(quota.resetDate)) {
      quota.currentUsage = 0;
      quota.resetDate = this.getNextResetDate();
      quota.isDisabled = false;
      console.log(`[EmailQuotaManager] Reset quota for ${quota.provider}. New reset date: ${quota.resetDate}`);
      this.saveQuotaToDatabase(quota);
    }
  }

  /**
   * Record an email sent event for a provider.
   * Returns false if the provider is now over quota.
   */
  recordUsage(provider: string, count: number = 1): boolean {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (!quota) return true; // Unknown provider, allow

    if (count < 0) {
      console.warn(`[EmailQuotaManager] Attempted negative usage for '${provider}': ${count}`);
      return true;
    }

    this.checkAndResetIfNeeded(quota);
    quota.currentUsage += count;

    if (quota.currentUsage >= quota.monthlyLimit) {
      quota.isDisabled = true;
      console.warn(
        `[EmailQuotaManager] Provider '${provider}' reached monthly limit ` +
        `(${quota.currentUsage}/${quota.monthlyLimit}). Disabled until ${quota.resetDate}.`
      );
    }

    this.persistQuota(quota);
    return quota.currentUsage < quota.monthlyLimit;
  }

  /**
   * Check if a provider is available (not over quota).
   */
  isAvailable(provider: string): boolean {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (!quota) return true;

    this.checkAndResetIfNeeded(quota);
    return !quota.isDisabled;
  }

  /**
   * Get remaining emails for a provider.
   */
  getRemaining(provider: string): number {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (!quota) return Infinity;

    this.checkAndResetIfNeeded(quota);
    return Math.max(0, quota.monthlyLimit - quota.currentUsage);
  }

  /**
   * Get usage percentage for a provider.
   */
  getUsagePercent(provider: string): number {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (!quota) return 0;

    this.checkAndResetIfNeeded(quota);
    return Math.min(100, (quota.currentUsage / quota.monthlyLimit) * 100);
  }

  /**
   * Get the best available provider based on priority and quota.
   * Returns null if no providers are available.
   */
  getBestAvailableProvider(): string | null {
    this.ensureInitialized();

    // Sort by priority (lower = higher priority)
    const sorted = Array.from(this.quotas.values())
      .map(q => {
        this.checkAndResetIfNeeded(q);
        return q;
      })
      .filter(q => !q.isDisabled)
      .sort((a, b) => a.priority - b.priority);

    for (const quota of sorted) {
      if (!quota.isDisabled && quota.currentUsage < quota.monthlyLimit) {
        return quota.provider;
      }
    }

    return null;
  }

  /**
   * Get fallback provider chain in priority order.
   * Excludes the specified provider.
   */
  getFallbackChain(excludeProvider?: string): string[] {
    this.ensureInitialized();

    return Array.from(this.quotas.values())
      .filter(q => q.provider !== excludeProvider)
      .sort((a, b) => a.priority - b.priority)
      .map(q => {
        this.checkAndResetIfNeeded(q);
        return q;
      })
      .filter(q => !q.isDisabled)
      .map(q => q.provider);
  }

  /**
   * Get all quota statuses.
   */
  getAllQuotas(): EmailProviderQuota[] {
    this.ensureInitialized();
    const results: EmailProviderQuota[] = [];
    for (const quota of this.quotas.values()) {
      this.checkAndResetIfNeeded(quota);
      results.push({ ...quota });
    }
    return results;
  }

  /**
   * Get quota status for a specific provider.
   */
  getQuota(provider: string): EmailProviderQuota | null {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (!quota) return null;
    
    this.checkAndResetIfNeeded(quota);
    return { ...quota };
  }

  /**
   * Manually disable a provider (e.g., on API errors).
   */
  disableProvider(provider: string, reason?: string): void {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (quota) {
      quota.isDisabled = true;
      console.warn(`[EmailQuotaManager] Manually disabled provider '${provider}': ${reason || 'Quota exceeded'}`);
      this.persistQuota(quota);
    }
  }

  /**
   * Manually enable a provider (e.g., after fixing issues).
   */
  enableProvider(provider: string): void {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (quota) {
      quota.isDisabled = false;
      console.log(`[EmailQuotaManager] Manually enabled provider '${provider}'`);
      this.persistQuota(quota);
    }
  }

  /**
   * Reset usage for a provider (admin action).
   */
  resetUsage(provider: string): void {
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (quota) {
      quota.currentUsage = 0;
      quota.isDisabled = false;
      console.log(`[EmailQuotaManager] Manually reset usage for provider '${provider}'`);
      this.persistQuota(quota);
    }
  }
}

export const emailQuotaManager = new EmailQuotaManager();
