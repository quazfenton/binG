/**
 * Quota Manager - Tracks tool/sandbox call usage per provider and disables
 * providers when monthly quotas are reached to prevent overages.
 * 
 * Uses SQLite database for persistent storage across server restarts.
 */

import { getDatabase } from '@/lib/database/connection';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

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
  e2b: 1000,  // E2B sandbox sessions per month (free tier: 1000 hours/month)
};

class QuotaManager {
  private quotas: Map<string, ProviderQuota> = new Map();
  private db: any = null;
  private initialized = false;
  private dbInitialized = false;
  private readonly quotaFilePath: string;

  constructor() {
    this.quotaFilePath = process.env.QUOTA_FALLBACK_FILE_PATH || join(process.cwd(), 'data', 'provider-quotas.json');
    // Lazy initialization - don't initialize database on construction
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
      console.error('[QuotaManager] Failed to initialize database:', error);
      this.db = null;
      this.dbInitialized = false;
    }
  }

  private ensureSchema(): void {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS provider_quotas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL UNIQUE,
          monthly_limit INTEGER NOT NULL DEFAULT 0,
          current_usage INTEGER NOT NULL DEFAULT 0,
          reset_date DATETIME NOT NULL,
          is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_provider_quotas_provider ON provider_quotas(provider);
      `);
    } catch (error) {
      console.error('[QuotaManager] Failed to ensure quota schema:', error);
    }
  }

  private initializeQuotas(): void {
    // Always use in-memory initialization by default
    // Database loading happens lazily when first accessed
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

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Start with defaults, then merge persisted sources.
    this.initializeQuotasFromDefaults();
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
          });
          continue;
        }

        // Merge additively/safely: preserve highest observed usage so offline writes are not lost.
        existing.currentUsage = Math.max(existing.currentUsage, fromFile.currentUsage);
        // Keep configured monthly limit unless file has a larger explicit value.
        existing.monthlyLimit = Math.max(existing.monthlyLimit, fromFile.monthlyLimit || 0);
        existing.resetDate = new Date(fromFile.resetDate) > new Date(existing.resetDate)
          ? fromFile.resetDate
          : existing.resetDate;
        existing.isDisabled = existing.currentUsage >= existing.monthlyLimit || !!fromFile.isDisabled;
      }
    } catch (error) {
      console.warn('[QuotaManager] Failed to load quota file fallback:', error);
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
            },
          ])
        ),
      };
      writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
      renameSync(tmpPath, this.quotaFilePath);
    } catch (error) {
      console.warn('[QuotaManager] Failed to save quota file fallback:', error);
    }
  }

  private loadQuotasFromDatabase(): void {
    this.ensureDatabase();
    if (!this.db) {
      // Database not available, use defaults
      this.initializeQuotasFromDefaults();
      return;
    }

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
    } catch (error: any) {
      // Table doesn't exist yet - fall back to in-memory
      if (error.code === 'SQLITE_ERROR' && error.message.includes('no such table')) {
        console.log('[QuotaManager] Quota table not found, using in-memory storage');
        this.initializeQuotasFromDefaults();
      } else {
        console.error('[QuotaManager] Failed to load quotas from database:', error);
        this.initializeQuotasFromDefaults();
      }
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
    this.ensureDatabase();
    if (!this.db) return;

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

  private persistQuota(quota: ProviderQuota): void {
    this.saveQuotaToDatabase(quota);
    this.saveAllQuotasToFile();
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
    this.ensureInitialized();
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
   * Get remaining calls for a provider.
   */
  getRemainingCalls(provider: string): number {
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
   * Get all quota statuses.
   */
  getAllQuotas(): ProviderQuota[] {
    this.ensureInitialized();
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
    this.ensureInitialized();
    const quota = this.quotas.get(provider);
    if (quota) {
      quota.monthlyLimit = newLimit;
      if (quota.currentUsage < quota.monthlyLimit) {
        quota.isDisabled = false;
      }
      this.persistQuota(quota);
    }
  }

  /**
   * Find an alternative provider that is still within quota.
   * Useful for fallback when primary provider is over quota.
   */
  findAlternative(providerType: 'tool' | 'sandbox', excludeProvider: string): string | null {
    this.ensureInitialized();
    const toolProviders = ['composio', 'arcade', 'nango'];
    const sandboxProviders = this.getSandboxProviderChain(excludeProvider).filter(p => p !== excludeProvider);

    // Filter out excluded provider from candidates to prevent returning it as an "alternative"
    const candidates = providerType === 'tool'
      ? this.rotateProviderOrder(toolProviders, excludeProvider).filter(p => p !== excludeProvider)
      : sandboxProviders;

    for (const provider of candidates) {
      if (this.isAvailable(provider)) return provider;
    }

    return null;
  }

  /**
   * Returns a circular fallback order for sandbox providers beginning with `primary`.
   */
  getSandboxProviderChain(primary: string): string[] {
    const explicitChains: Record<string, string[]> = {
      daytona: ['daytona', 'runloop', 'microsandbox', 'e2b'],
      runloop: ['runloop', 'microsandbox', 'daytona', 'e2b'],
      microsandbox: ['microsandbox', 'runloop', 'daytona', 'e2b'],
      e2b: ['e2b', 'daytona', 'runloop', 'microsandbox'],
    };
    const base = explicitChains[primary] || [primary, 'daytona', 'runloop', 'microsandbox', 'e2b'];
    const deduped = Array.from(new Set(base));
    return deduped.filter(provider => this.isAvailable(provider));
  }

  pickAvailableSandboxProvider(primary: string): string | null {
    const chain = this.getSandboxProviderChain(primary);
    return chain.length > 0 ? chain[0] : null;
  }

  private rotateProviderOrder(list: string[], preferred: string): string[] {
    const idx = list.indexOf(preferred);
    if (idx === -1) return list;
    return [...list.slice(idx), ...list.slice(0, idx)];
  }
}

export const quotaManager = new QuotaManager();
