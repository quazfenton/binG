/**
 * Quota Manager - Tracks tool/sandbox call usage per provider and disables
 * providers when monthly quotas are reached to prevent overages.
 * 
 * Uses SQLite database for persistent storage across server restarts.
 */

import { getDatabase } from '@/lib/database/connection';

export interface ProviderQuota {
  provider: string;
  monthlyLimit: number;
  currentUsage: number;
  resetDate: string; // ISO date of next reset
  isDisabled: boolean;
}

// Default monthly limits (can be overridden via env vars)
const DEFAULT_QUOTAS: Record<string, number> = {
  composio: 20000,
  arcade: 10000,
  nango: 10000,
  daytona: 5000,
  runloop: 5000,
  microsandbox: 10000,
};

class QuotaManager {
  private quotas: Map<string, ProviderQuota> = new Map();
  private db: any;
  private initialized = false;

  constructor() {
    try {
      this.db = getDatabase();
      this.initializeQuotas();
      this.initialized = true;
    } catch (error) {
      console.error('[QuotaManager] Failed to initialize:', error);
      // Fallback to in-memory only
      this.initializeQuotas();
      this.initialized = false;
    }
  }

  private initializeQuotas(): void {
    // If database is available, load from DB
    if (this.db && this.initialized) {
      this.loadQuotasFromDatabase();
    } else {
      // Fallback to in-memory initialization
      for (const [provider, defaultLimit] of Object.entries(DEFAULT_QUOTAS)) {
        const envKey = `QUOTA_${provider.toUpperCase()}_MONTHLY`;
        let limit = defaultLimit;

        if (process.env[envKey]) {
          const parsed = parseInt(process.env[envKey]!, 10);
          // Validate parsed value to prevent NaN limits
          if (!isNaN(parsed) && parsed > 0) {
            limit = parsed;
          } else {
            console.warn(`[QuotaManager] Invalid ${envKey} value: "${process.env[envKey]}". Using default limit: ${defaultLimit}`);
          }
        }

        this.quotas.set(provider, {
          provider,
          monthlyLimit: limit,
          currentUsage: 0,
          resetDate: this.getNextResetDate(),
          isDisabled: false,
        });
      }
    }
  }

  private loadQuotasFromDatabase(): void {
    try {
      const stmt = this.db.prepare('SELECT * FROM provider_quotas');
      const rows = stmt.all() as any[];

      for (const row of rows) {
        this.quotas.set(row.provider, {
          provider: row.provider,
          monthlyLimit: row.monthly_limit,
          currentUsage: row.current_usage,
          resetDate: row.reset_date,
          isDisabled: !!row.is_disabled,
        });
      }

      // Add any providers not in DB yet
      for (const [provider, defaultLimit] of Object.entries(DEFAULT_QUOTAS)) {
        if (!this.quotas.has(provider)) {
          const envKey = `QUOTA_${provider.toUpperCase()}_MONTHLY`;
          let limit = defaultLimit;

          if (process.env[envKey]) {
            const parsed = parseInt(process.env[envKey]!, 10);
            if (!isNaN(parsed) && parsed > 0) {
              limit = parsed;
            }
          }

          const quota = {
            provider,
            monthlyLimit: limit,
            currentUsage: 0,
            resetDate: this.getNextResetDate(),
            isDisabled: false,
          };
          this.quotas.set(provider, quota);
          this.saveQuotaToDatabase(quota);
        }
      }

      console.log(`[QuotaManager] Loaded ${this.quotas.size} provider quotas from database`);
    } catch (error) {
      console.error('[QuotaManager] Failed to load quotas from database:', error);
      // Fallback to in-memory
      this.initializeQuotasFromDefaults();
    }
  }

  private initializeQuotasFromDefaults(): void {
    for (const [provider, defaultLimit] of Object.entries(DEFAULT_QUOTAS)) {
      const envKey = `QUOTA_${provider.toUpperCase()}_MONTHLY`;
      let limit = defaultLimit;

      if (process.env[envKey]) {
        const parsed = parseInt(process.env[envKey]!, 10);
        if (!isNaN(parsed) && parsed > 0) {
          limit = parsed;
        }
      }

      this.quotas.set(provider, {
        provider,
        monthlyLimit: limit,
        currentUsage: 0,
        resetDate: this.getNextResetDate(),
        isDisabled: false,
      });
    }
  }

  private saveQuotaToDatabase(quota: ProviderQuota): void {
    if (!this.db || !this.initialized) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO provider_quotas 
        (provider, monthly_limit, current_usage, reset_date, is_disabled, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(
        quota.provider,
        quota.monthlyLimit,
        quota.currentUsage,
        quota.resetDate,
        quota.isDisabled ? 1 : 0
      );
    } catch (error) {
      console.error('[QuotaManager] Failed to save quota to database:', error);
    }
  }

  private getNextResetDate(): string {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
  }

  private checkAndResetIfNeeded(quota: ProviderQuota): void {
    const now = new Date();
    if (now >= new Date(quota.resetDate)) {
      quota.currentUsage = 0;
      quota.resetDate = this.getNextResetDate();
      quota.isDisabled = false;
      console.log(`[QuotaManager] Reset quota for ${quota.provider}. New reset date: ${quota.resetDate}`);
      this.saveQuotaToDatabase(quota);
    }
  }

  /**
   * Record a usage event for a provider.
   * Returns false if the provider is now over quota (just disabled).
   */
  recordUsage(provider: string, count: number = 1): boolean {
    const quota = this.quotas.get(provider);
    if (!quota) return true; // Unknown provider, allow

    // Reject negative counts to prevent quota bypass
    if (count < 0) {
      console.warn(`[QuotaManager] Attempted to record negative usage for provider '${provider}': ${count}`);
      return true;
    }

    this.checkAndResetIfNeeded(quota);

    quota.currentUsage += count;

    if (quota.currentUsage >= quota.monthlyLimit) {
      quota.isDisabled = true;
      console.warn(
        `[QuotaManager] Provider '${provider}' has reached its monthly limit ` +
        `(${quota.currentUsage}/${quota.monthlyLimit}). Disabled until ${quota.resetDate}.`
      );
    }

    // Persist to database
    this.saveQuotaToDatabase(quota);

    return quota.currentUsage < quota.monthlyLimit;
  }

  /**
   * Check if a provider is available (not over quota).
   */
  isAvailable(provider: string): boolean {
    const quota = this.quotas.get(provider);
    if (!quota) return true;

    this.checkAndResetIfNeeded(quota);
    return !quota.isDisabled;
  }

  /**
   * Get remaining calls for a provider.
   */
  getRemainingCalls(provider: string): number {
    const quota = this.quotas.get(provider);
    if (!quota) return Infinity;

    this.checkAndResetIfNeeded(quota);
    return Math.max(0, quota.monthlyLimit - quota.currentUsage);
  }

  /**
   * Get usage percentage for a provider.
   */
  getUsagePercent(provider: string): number {
    const quota = this.quotas.get(provider);
    if (!quota) return 0;

    this.checkAndResetIfNeeded(quota);
    return Math.min(100, (quota.currentUsage / quota.monthlyLimit) * 100);
  }

  /**
   * Get all quota statuses.
   */
  getAllQuotas(): ProviderQuota[] {
    const results: ProviderQuota[] = [];
    for (const quota of this.quotas.values()) {
      this.checkAndResetIfNeeded(quota);
      results.push({ ...quota });
    }
    return results;
  }

  /**
   * Override quota limit for a provider (useful for plan upgrades).
   */
  setLimit(provider: string, newLimit: number): void {
    const quota = this.quotas.get(provider);
    if (quota) {
      quota.monthlyLimit = newLimit;
      if (quota.currentUsage < quota.monthlyLimit) {
        quota.isDisabled = false;
      }
      this.saveQuotaToDatabase(quota);
    }
  }

  /**
   * Find an alternative provider that is still within quota.
   * Useful for fallback when primary provider is over quota.
   */
  findAlternative(providerType: 'tool' | 'sandbox', excludeProvider: string): string | null {
    const toolProviders = ['composio', 'arcade', 'nango'];
    const sandboxProviders = ['daytona', 'runloop', 'microsandbox'];

    const candidates = providerType === 'tool' ? toolProviders : sandboxProviders;

    for (const provider of candidates) {
      if (provider !== excludeProvider && this.isAvailable(provider)) {
        return provider;
      }
    }

    return null;
  }
}

export const quotaManager = new QuotaManager();
