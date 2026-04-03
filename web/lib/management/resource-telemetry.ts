/**
 * Unified Resource Telemetry
 *
 * Feeds resource metrics into provider routing by tracking
 * per-provider load, latency, failure rate, and queue depth.
 *
 * Bridges the gap between the resource monitor (which collects raw metrics)
 * and the provider router (which selects providers).
 *
 * Features:
 * - Per-provider call recording
 * - Rolling-window aggregation
 * - Provider scoring for routing decisions
 * - Queue depth tracking
 * - Integration-ready with provider-router
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Telemetry:Resource');

export interface ProviderTelemetryRecord {
  provider: string;
  latencyMs: number;
  success: boolean;
  timestamp: number;
}

export interface ProviderTelemetryScore {
  provider: string;
  /** Composite routing score 0-1 (1 = best choice) */
  score: number;
  /** Average latency in the window */
  avgLatencyMs: number;
  /** Failure rate 0-1 */
  failureRate: number;
  /** Current estimated queue depth */
  queueDepth: number;
  /** Active concurrent requests */
  activeRequests: number;
  /** Total calls in window */
  totalCalls: number;
}

export interface ResourceTelemetryConfig {
  /** Rolling window in ms (default: 2 minutes) */
  windowMs: number;
  /** Maximum records to retain (default: 5000) */
  maxRecords: number;
  /** Weight for latency in score (default: 0.3) */
  latencyWeight: number;
  /** Weight for failure rate in score (default: 0.4) */
  failureWeight: number;
  /** Weight for queue depth in score (default: 0.3) */
  queueWeight: number;
  /** Max acceptable latency in ms for scoring (default: 5000) */
  maxAcceptableLatencyMs: number;
  /** Max acceptable queue depth for scoring (default: 20) */
  maxAcceptableQueueDepth: number;
}

const DEFAULT_CONFIG: ResourceTelemetryConfig = {
  windowMs: 2 * 60 * 1000,
  maxRecords: 5000,
  latencyWeight: 0.3,
  failureWeight: 0.4,
  queueWeight: 0.3,
  maxAcceptableLatencyMs: 5000,
  maxAcceptableQueueDepth: 20,
};

/**
 * Resource Telemetry Collector
 */
export class ResourceTelemetry {
  private records: ProviderTelemetryRecord[] = [];
  private activeRequests = new Map<string, number>();
  private queueDepths = new Map<string, number>();
  private config: ResourceTelemetryConfig;

  constructor(config?: Partial<ResourceTelemetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a provider call outcome
   */
  recordProviderCall(provider: string, latencyMs: number, success: boolean): void {
    this.records.push({
      provider,
      latencyMs,
      success,
      timestamp: Date.now(),
    });

    // Trim old records
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-Math.floor(this.config.maxRecords * 0.8));
    }

    logger.debug('Provider call recorded', { provider, latencyMs, success });
  }

  /**
   * Track request start (increments active count)
   */
  trackRequestStart(provider: string): void {
    const current = this.activeRequests.get(provider) ?? 0;
    this.activeRequests.set(provider, current + 1);
  }

  /**
   * Track request end (decrements active count)
   */
  trackRequestEnd(provider: string): void {
    const current = this.activeRequests.get(provider) ?? 0;
    this.activeRequests.set(provider, Math.max(0, current - 1));
  }

  /**
   * Update queue depth for a provider
   */
  updateQueueDepth(provider: string, depth: number): void {
    this.queueDepths.set(provider, depth);
  }

  /**
   * Get routing score for a provider (higher = better)
   */
  getProviderScore(provider: string): number {
    return this.computeScore(provider).score;
  }

  /**
   * Get full telemetry score with breakdown
   */
  getProviderTelemetry(provider: string): ProviderTelemetryScore {
    return this.computeScore(provider);
  }

  /**
   * Get scores for all known providers, sorted by score descending
   */
  getAllScores(): ProviderTelemetryScore[] {
    const providers = new Set(this.records.map(r => r.provider));
    const scores = Array.from(providers).map(p => this.computeScore(p));
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Get the best provider from candidates
   */
  getBestProvider(candidates: string[]): string | null {
    if (candidates.length === 0) return null;

    const scores = candidates.map(p => this.computeScore(p));
    scores.sort((a, b) => b.score - a.score);

    return scores[0].provider;
  }

  /**
   * Reset all telemetry data
   */
  reset(): void {
    this.records = [];
    this.activeRequests.clear();
    this.queueDepths.clear();
    logger.info('Resource telemetry reset');
  }

  private computeScore(provider: string): ProviderTelemetryScore {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const windowRecords = this.records.filter(
      r => r.provider === provider && r.timestamp >= windowStart
    );

    const totalCalls = windowRecords.length;
    const failures = windowRecords.filter(r => !r.success).length;
    const failureRate = totalCalls > 0 ? failures / totalCalls : 0;

    const successRecords = windowRecords.filter(r => r.success);
    const avgLatencyMs = successRecords.length > 0
      ? successRecords.reduce((s, r) => s + r.latencyMs, 0) / successRecords.length
      : 0;

    const activeReqs = this.activeRequests.get(provider) ?? 0;
    const queueDepth = this.queueDepths.get(provider) ?? 0;

    // Normalize components to 0-1 (1 = good)
    const latencyScore = Math.max(0, 1 - avgLatencyMs / this.config.maxAcceptableLatencyMs);
    const failureScore = 1 - failureRate;
    const queueScore = Math.max(0, 1 - queueDepth / this.config.maxAcceptableQueueDepth);

    // Weighted composite
    const score = totalCalls === 0
      ? 1.0 // No data — assume healthy
      : (
        latencyScore * this.config.latencyWeight +
        failureScore * this.config.failureWeight +
        queueScore * this.config.queueWeight
      );

    return {
      provider,
      score: Math.round(score * 1000) / 1000,
      avgLatencyMs: Math.round(avgLatencyMs),
      failureRate: Math.round(failureRate * 1000) / 1000,
      queueDepth,
      activeRequests: activeReqs,
      totalCalls,
    };
  }
}

// Singleton instance
export const resourceTelemetry = new ResourceTelemetry();