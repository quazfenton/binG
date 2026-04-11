/**
 * Provider Health Prediction
 *
 * Tracks provider failure rates, latency, and predicts failures
 * before they happen. Feeds into provider routing to deprioritize
 * unhealthy providers.
 *
 * Features:
 * - Per-provider call tracking (success/failure/latency)
 * - Rolling window failure rate calculation
 * - Latency spike detection
 * - Health score computation (0-1)
 * - Deprioritization recommendations
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Sandbox:ProviderHealth');

export interface ProviderCallRecord {
  provider: string;
  success: boolean;
  latencyMs: number;
  timestamp: number;
  error?: string;
}

export interface ProviderHealthScore {
  provider: string;
  /** Overall health score 0-1 (1 = perfectly healthy) */
  score: number;
  /** Failure rate in current window (0-1) */
  failureRate: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** p95 latency in ms */
  p95LatencyMs: number;
  /** Total calls in window */
  totalCalls: number;
  /** Whether this provider should be deprioritized */
  shouldDeprioritize: boolean;
  /** Reason for deprioritization (if applicable) */
  deprioritizeReason?: string;
  /** Last successful call timestamp */
  lastSuccessAt?: number;
  /** Last failure timestamp */
  lastFailureAt?: number;
}

export interface ProviderHealthConfig {
  /** Rolling window size in milliseconds (default: 5 minutes) */
  windowMs: number;
  /** Failure rate threshold to deprioritize (default: 0.3 = 30%) */
  failureRateThreshold: number;
  /** Latency spike multiplier — deprioritize if avg latency is Nx the baseline (default: 3) */
  latencySpikeMultiplier: number;
  /** Minimum calls in window before making decisions (default: 5) */
  minCallsForDecision: number;
  /** Baseline latency per provider in ms (default: 2000) */
  baselineLatencyMs: number;
  /** Cooldown period after deprioritization before re-checking (default: 60s) */
  deprioritizeCooldownMs: number;
}

const DEFAULT_CONFIG: ProviderHealthConfig = {
  windowMs: 5 * 60 * 1000,
  failureRateThreshold: 0.3,
  latencySpikeMultiplier: 3,
  minCallsForDecision: 5,
  baselineLatencyMs: 2000,
  deprioritizeCooldownMs: 60_000,
};

/**
 * Provider Health Tracker
 *
 * Records call outcomes and computes health scores for sandbox providers.
 */
export class ProviderHealthTracker {
  private records: ProviderCallRecord[] = [];
  private config: ProviderHealthConfig;
  private deprioritizedUntil = new Map<string, number>();
  private readonly MAX_RECORDS = 10_000;

  constructor(config?: Partial<ProviderHealthConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a provider call outcome
   */
  recordCall(provider: string, success: boolean, latencyMs: number, error?: string): void {
    const record: ProviderCallRecord = {
      provider,
      success,
      latencyMs,
      timestamp: Date.now(),
      error,
    };

    this.records.push(record);

    // Evict oldest records if over limit
    if (this.records.length > this.MAX_RECORDS) {
      this.records = this.records.slice(-Math.floor(this.MAX_RECORDS * 0.8));
    }

    logger.debug('Provider call recorded', {
      provider,
      success,
      latencyMs,
      totalRecords: this.records.length,
    });
  }

  /**
   * Get health score for a provider
   */
  getHealthScore(provider: string): ProviderHealthScore {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const windowRecords = this.records.filter(
      r => r.provider === provider && r.timestamp >= windowStart
    );

    const totalCalls = windowRecords.length;
    const failures = windowRecords.filter(r => !r.success).length;
    const successes = windowRecords.filter(r => r.success);
    const failureRate = totalCalls > 0 ? failures / totalCalls : 0;

    // Latency stats (only from successful calls)
    const latencies = successes.map(r => r.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((s, l) => s + l, 0) / latencies.length
      : 0;
    const p95LatencyMs = latencies.length > 0
      ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1]
      : 0;

    // Last success/failure timestamps
    const lastSuccess = successes.length > 0
      ? successes[successes.length - 1].timestamp
      : undefined;
    const failedRecords = windowRecords.filter(r => !r.success);
    const lastFailure = failedRecords.length > 0
      ? failedRecords[failedRecords.length - 1].timestamp
      : undefined;

    // Compute health score
    const { shouldDeprioritize, reason, score } = this.computeHealth(
      provider, totalCalls, failureRate, avgLatencyMs, p95LatencyMs
    );

    return {
      provider,
      score,
      failureRate,
      avgLatencyMs,
      p95LatencyMs,
      totalCalls,
      shouldDeprioritize,
      deprioritizeReason: reason,
      lastSuccessAt: lastSuccess,
      lastFailureAt: lastFailure,
    };
  }

  /**
   * Check whether a provider should be deprioritized
   */
  shouldDeprioritize(provider: string): boolean {
    // Check cooldown
    const cooldownUntil = this.deprioritizedUntil.get(provider);
    if (cooldownUntil && Date.now() < cooldownUntil) {
      return true;
    }

    const health = this.getHealthScore(provider);
    if (health.shouldDeprioritize) {
      this.deprioritizedUntil.set(provider, Date.now() + this.config.deprioritizeCooldownMs);
      logger.warn('Provider deprioritized', {
        provider,
        reason: health.deprioritizeReason,
        score: health.score,
        failureRate: health.failureRate,
        cooldownMs: this.config.deprioritizeCooldownMs,
      });
    }

    return health.shouldDeprioritize;
  }

  /**
   * Get health scores for all known providers
   */
  getAllHealthScores(): ProviderHealthScore[] {
    const providers = new Set(this.records.map(r => r.provider));
    return Array.from(providers).map(p => this.getHealthScore(p));
  }

  /**
   * Get the healthiest provider from a list of candidates
   */
  getHealthiest(candidates: string[]): string | null {
    if (candidates.length === 0) return null;

    const scores = candidates.map(p => ({
      provider: p,
      ...this.getHealthScore(p),
    }));

    // Sort by score descending (healthiest first)
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    if (best.shouldDeprioritize) {
      logger.warn('All candidate providers are unhealthy', {
        candidates,
        bestScore: best.score,
      });
    }

    return best.provider;
  }

  /**
   * Clear deprioritization for a provider (e.g., after manual recovery)
   */
  clearDeprioritization(provider: string): void {
    this.deprioritizedUntil.delete(provider);
    logger.info('Provider deprioritization cleared', { provider });
  }

  /**
   * Reset all tracking data
   */
  reset(): void {
    this.records = [];
    this.deprioritizedUntil.clear();
    logger.info('Provider health tracker reset');
  }

  private computeHealth(
    provider: string,
    totalCalls: number,
    failureRate: number,
    avgLatencyMs: number,
    p95LatencyMs: number,
  ): { shouldDeprioritize: boolean; reason?: string; score: number } {
    // Not enough data — assume healthy
    if (totalCalls < this.config.minCallsForDecision) {
      return { shouldDeprioritize: false, score: 1.0 };
    }

    // Score components
    const failureComponent = 1 - failureRate; // 1.0 = no failures
    const latencyComponent = Math.max(0, 1 - (avgLatencyMs / (this.config.baselineLatencyMs * this.config.latencySpikeMultiplier)));
    const score = failureComponent * 0.7 + latencyComponent * 0.3;

    // Check failure rate threshold
    if (failureRate >= this.config.failureRateThreshold) {
      return {
        shouldDeprioritize: true,
        reason: `Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(this.config.failureRateThreshold * 100).toFixed(1)}%`,
        score,
      };
    }

    // Check latency spikes
    const latencyThreshold = this.config.baselineLatencyMs * this.config.latencySpikeMultiplier;
    if (avgLatencyMs > latencyThreshold) {
      return {
        shouldDeprioritize: true,
        reason: `Average latency ${avgLatencyMs.toFixed(0)}ms exceeds ${latencyThreshold}ms (${this.config.latencySpikeMultiplier}x baseline)`,
        score,
      };
    }

    return { shouldDeprioritize: false, score };
  }
}

// Singleton instance
export const providerHealthTracker = new ProviderHealthTracker();
