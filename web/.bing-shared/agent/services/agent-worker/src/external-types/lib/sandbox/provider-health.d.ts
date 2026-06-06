/**
 * Type declarations for @/lib/sandbox/provider-health
 * Stub for agent-worker — mirrors real exports from web/lib/sandbox/provider-health.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */

declare class ProviderHealthTracker {
  recordCall(provider: string, success: boolean, latencyMs: number, error?: string): void;
  getProviderHealth(provider: string): any;
  getHealthScore(provider: string): number;
  getDegradedProviders(): string[];
  getHealthyProviders(): string[];
  isProviderHealthy(provider: string): boolean;
  getLastError(provider: string): string | null;
}

export const providerHealthTracker: ProviderHealthTracker;
