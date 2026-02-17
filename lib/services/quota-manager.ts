/**
 * Quota Manager - Tracks tool/sandbox call usage per provider and disables
 * providers when monthly quotas are reached to prevent overages.
 */

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

  constructor() {
    this.initializeQuotas();
  }

  private initializeQuotas(): void {
    for (const [provider, defaultLimit] of Object.entries(DEFAULT_QUOTAS)) {
      const envKey = `QUOTA_${provider.toUpperCase()}_MONTHLY`;
      const limit = process.env[envKey] ? parseInt(process.env[envKey]!, 10) : defaultLimit;
      
      this.quotas.set(provider, {
        provider,
        monthlyLimit: limit,
        currentUsage: 0,
        resetDate: this.getNextResetDate(),
        isDisabled: false,
      });
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
    }
  }

  /**
   * Record a usage event for a provider.
   * Returns false if the provider is now over quota (just disabled).
   */
  recordUsage(provider: string, count: number = 1): boolean {
    const quota = this.quotas.get(provider);
    if (!quota) return true; // Unknown provider, allow

    this.checkAndResetIfNeeded(quota);

    quota.currentUsage += count;

    if (quota.currentUsage >= quota.monthlyLimit) {
      quota.isDisabled = true;
      console.warn(
        `[QuotaManager] Provider '${provider}' has reached its monthly limit ` +
        `(${quota.currentUsage}/${quota.monthlyLimit}). Disabled until ${quota.resetDate}.`
      );
      return false;
    }

    return true;
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
