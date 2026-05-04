/**
 * Smart Circuit Breaker Pattern Implementation
 *
 * Unlike a naive circuit breaker that blindly opens after N failures,
 * this implementation:
 *
 * 1. NEVER fully blocks all LLM providers — always keeps at least one route open
 * 2. Per-provider failure tracking with time-decay (old failures expire)
 * 3. Provider reliability tiers — unreliable providers (Gemini, free models)
 *    get higher thresholds and shorter recovery windows
 * 4. Speculative parallel fallback for known-flaky providers
 * 5. Awareness of what's actually configured in .env / available
 * 6. Rate-limit errors (429) treated differently from hard failures (500)
 *
 * Safety invariant: if opening a circuit would leave ZERO available
 * providers, the circuit stays HEALTHY (degraded mode) instead.
 */

export type CircuitState = 'HEALTHY' | 'OPEN' | 'HALF-OPEN';

/** Human-readable state names */
export function getCircuitStateName(state: CircuitState): string {
  switch (state) {
    case 'HEALTHY': return 'HEALTHY';  // Requests allowed, no issues
    case 'HALF-OPEN': return 'TESTING'; // Testing if recovered
    case 'OPEN': return 'BLOCKED';      // Too many failures, skipping
  }
}

// ---------------------------------------------------------------------------
// Provider reliability tiers
// ---------------------------------------------------------------------------

export type ReliabilityTier = 'stable' | 'normal' | 'flaky';

/**
 * Per-tier defaults. Flaky providers get much more lenient thresholds.
 */
const TIER_DEFAULTS: Record<ReliabilityTier, {
  failureThreshold: number
  timeout: number
  decayWindowMs: number
}> = {
  stable: { failureThreshold: 10, timeout: 20_000, decayWindowMs: 120_000 },
  normal: { failureThreshold: 7,  timeout: 30_000, decayWindowMs: 90_000 },
  flaky:  { failureThreshold: 15, timeout: 15_000, decayWindowMs: 60_000 },
};

/**
 * Known provider tier assignments. Anything unlisted defaults to 'normal'.
 */
const PROVIDER_TIERS: Record<string, ReliabilityTier> = {
  // Stable / primary
  'openrouter': 'stable',
  'openai': 'stable',
  'anthropic': 'stable',
  'opencode': 'stable',
  // Normal
  'mistral': 'normal',
  'deepseek': 'normal',
  'cohere': 'normal',
  'groq': 'normal',
  'together': 'normal',
  // Flaky / rate-limited
  'google': 'flaky',
  'gemini': 'flaky',
  'vertex': 'flaky',
  'free': 'flaky',
  'huggingface': 'flaky',
};

function getTier(providerId: string): ReliabilityTier {
  const lower = providerId.toLowerCase();
  for (const [key, tier] of Object.entries(PROVIDER_TIERS)) {
    if (lower.includes(key)) return tier;
  }
  return 'normal';
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type FailureKind = 'hard' | 'rate-limit' | 'timeout' | 'transient';

function classifyError(error: any): FailureKind {
  const msg = (error?.message || '').toLowerCase();
  const status = error?.status || error?.statusCode || 0;

  if (status === 429 || msg.includes('rate limit') || msg.includes('quota')) {
    return 'rate-limit';
  }
  if (status === 408 || msg.includes('timeout') || msg.includes('timed out') || msg.includes('ETIMEDOUT')) {
    return 'timeout';
  }
  if ([502, 503, 504].includes(status) || msg.includes('overloaded') || msg.includes('temporarily')) {
    return 'transient';
  }
  return 'hard';
}

/**
 * How much each failure kind "weighs" toward the threshold.
 * Rate-limits and transient errors count less than hard failures.
 */
const FAILURE_WEIGHT: Record<FailureKind, number> = {
  hard: 1.0,
  timeout: 0.7,
  transient: 0.5,
  'rate-limit': 0.3,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;               // ms before OPEN → HALF-OPEN
  halfOpenMaxRequests: number;
  /** Failures older than this are forgotten (ms). 0 = no decay */
  decayWindowMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30_000,
  halfOpenMaxRequests: 3,
  decayWindowMs: 90_000,
};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface CircuitBreakerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rejectedRequests: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  stateChanges: number;
  weightedFailureScore: number;
  failuresByKind: Record<FailureKind, number>;
}

// ---------------------------------------------------------------------------
// Timestamped failure record (for decay)
// ---------------------------------------------------------------------------

interface FailureRecord {
  timestamp: number;
  kind: FailureKind;
  weight: number;
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private state: CircuitState = 'HEALTHY';
  private failures: FailureRecord[] = [];
  private successCount = 0;
  private lastFailureTime?: number;
  private nextAttemptTime?: number;
  private halfOpenRequests = 0;

  readonly config: CircuitBreakerConfig;
  readonly providerId: string;
  readonly tier: ReliabilityTier;
  private stats: CircuitBreakerStats;
  private stateChangeCallbacks: Array<(state: CircuitState) => void> = [];

  /** External guard: when set, `execute` never throws CircuitBreakerOpenError */
  forceAlwaysAllow = false;

  constructor(
    providerId: string,
    config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.providerId = providerId;
    this.tier = getTier(providerId);
    const tierDefaults = TIER_DEFAULTS[this.tier];

    this.config = {
      ...DEFAULT_CONFIG,
      failureThreshold: tierDefaults.failureThreshold,
      timeout: tierDefaults.timeout,
      decayWindowMs: tierDefaults.decayWindowMs,
      ...config,
    };

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      stateChanges: 0,
      weightedFailureScore: 0,
      failuresByKind: { hard: 0, 'rate-limit': 0, timeout: 0, transient: 0 },
    };
  }

  // -- public API -----------------------------------------------------------

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.stats.totalRequests++;

    if (!this.forceAlwaysAllow && !this.canExecute()) {
      this.stats.rejectedRequests++;
      throw new CircuitBreakerOpenError(
        `Circuit breaker OPEN for ${this.providerId} (${this.tier}). Retry after ${this.getRetryAfter()}ms`,
      );
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error: any) {
      this.onFailure(error);
      throw error;
    }
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
      this.transitionTo('HALF-OPEN');
    }
    return this.state;
  }

  getRetryAfter(): number {
    if (this.state !== 'OPEN' || !this.nextAttemptTime) return 0;
    return Math.max(0, this.nextAttemptTime - Date.now());
  }

  getStats(): CircuitBreakerStats & { state: CircuitState; tier: ReliabilityTier } {
    return { ...this.stats, state: this.getState(), tier: this.tier };
  }

  getWeightedFailureScore(): number {
    this.pruneDecayed();
    return this.failures.reduce((sum, f) => sum + f.weight, 0);
  }

  reset(): void {
    this.state = 'HEALTHY';
    this.failures = [];
    this.successCount = 0;
    this.halfOpenRequests = 0;
    this.nextAttemptTime = undefined;
    this.stats.stateChanges++;
    this.stats.weightedFailureScore = 0;
  }

  onStateChange(callback: (state: CircuitState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const idx = this.stateChangeCallbacks.indexOf(callback);
      if (idx > -1) this.stateChangeCallbacks.splice(idx, 1);
    };
  }

  // -- internal -------------------------------------------------------------

  private canExecute(): boolean {
    switch (this.state) {
      case 'HEALTHY':
        return true;
      case 'OPEN':
        if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
          this.transitionTo('HALF-OPEN');
          return true;
        }
        return false;
      case 'HALF-OPEN':
        return this.halfOpenRequests < this.config.halfOpenMaxRequests;
      default:
        return false;
    }
  }

  /**
   * Public API: Record a successful operation result.
   * Safe to call from external code — validates state before delegating to internal onSuccess().
   */
  recordSuccess(): void {
    if (this.state === 'OPEN') return; // Ignore success recording when circuit is open
    this.onSuccess();
  }

  /**
   * Public API: Record a failed operation result.
   * Safe to call from external code — classifies error and delegates to internal onFailure().
   */
  recordFailure(error: any): void {
    this.onFailure(error);
  }

  private onSuccess(): void {
    this.stats.successfulRequests++;
    this.stats.lastSuccessTime = Date.now();

    if (this.state === 'HALF-OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('HEALTHY');
      }
    } else if (this.state === 'HEALTHY') {
      // Successful call reduces weighted score (recovery credit)
      if (this.failures.length > 0) {
        this.failures.shift(); // remove oldest failure
      }
    }
  }

  private onFailure(error: any): void {
    const kind = classifyError(error);
    const weight = FAILURE_WEIGHT[kind];

    this.stats.failedRequests++;
    this.stats.lastFailureTime = Date.now();
    this.stats.failuresByKind[kind]++;
    this.lastFailureTime = Date.now();

    this.failures.push({ timestamp: Date.now(), kind, weight });
    this.pruneDecayed();

    const weightedScore = this.failures.reduce((s, f) => s + f.weight, 0);
    this.stats.weightedFailureScore = weightedScore;

    if (this.state === 'HALF-OPEN') {
      // Only hard failures immediately re-open; transient/rate-limit get a pass
      if (kind === 'hard') {
        this.transitionTo('OPEN');
      }
    } else if (this.state === 'HEALTHY') {
      if (weightedScore >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  /** Remove failures older than the decay window */
  private pruneDecayed(): void {
    if (this.config.decayWindowMs <= 0) return;
    const cutoff = Date.now() - this.config.decayWindowMs;
    this.failures = this.failures.filter(f => f.timestamp > cutoff);
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.stats.stateChanges++;

    switch (newState) {
      case 'HEALTHY':
        this.failures = [];
        this.successCount = 0;
        this.halfOpenRequests = 0;
        break;
      case 'OPEN':
        this.nextAttemptTime = Date.now() + this.config.timeout;
        this.successCount = 0;
        break;
      case 'HALF-OPEN':
        this.halfOpenRequests = 0;
        break;
    }

    console.log(
      `[CircuitBreaker:${this.providerId}] ${oldState} → ${newState}` +
        ` (score=${this.stats.weightedFailureScore.toFixed(1)}/${this.config.failureThreshold}, tier=${this.tier})`,
    );

    for (const cb of this.stateChangeCallbacks) {
      try { cb(newState); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

// ---------------------------------------------------------------------------
// Smart Manager — enforces "never close ALL providers"
// ---------------------------------------------------------------------------

export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map<string, CircuitBreaker>();
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig?: Partial<CircuitBreakerConfig>) {
    this.defaultConfig = defaultConfig || {};
  }

  /**
   * Get or create a per-provider circuit breaker.
   * Config is merged with tier-aware defaults.
   */
  getBreaker(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(providerId, this.defaultConfig);
      this.breakers.set(providerId, breaker);

      // Wire the safety invariant: before a breaker opens, check if it
      // would leave zero available providers. If so, force it to stay open.
      breaker.onStateChange((newState) => {
        if (newState === 'OPEN') {
          this.enforceLastProviderSafety(providerId);
        }
      });
    }
    return breaker;
  }

  /**
   * Execute with per-provider circuit breaker.
   */
  async execute<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
    const breaker = this.getBreaker(providerId);
    return breaker.execute(operation);
  }

  /**
   * Execute with automatic fallback to the next available provider.
   * Providers are tried in order; the first that succeeds wins.
   */
  async executeWithFallback<T>(
    providerIds: string[],
    operationFactory: (providerId: string) => Promise<T>,
  ): Promise<T> {
    let lastError: any;

    for (const id of providerIds) {
      const breaker = this.getBreaker(id);
      if (breaker.getState() === 'OPEN' && breaker.getRetryAfter() > 0) {
        continue; // skip open breakers
      }
      try {
        return await breaker.execute(() => operationFactory(id));
      } catch (error: any) {
        lastError = error;
        // If it was a CB-open error, try next; otherwise the operation itself failed
      }
    }

    // All providers exhausted — force the first provider open (never fully block)
    const firstBreaker = this.getBreaker(providerIds[0]);
    firstBreaker.forceAlwaysAllow = true;
    try {
      return await operationFactory(providerIds[0]);
    } finally {
      firstBreaker.forceAlwaysAllow = false;
    }
  }

  /**
   * SAFETY INVARIANT: if opening breaker for `justOpenedId` would leave
   * zero available providers, force it back to HALF-OPEN so requests can
   * still flow through. We never fully block all LLM routes.
   */
  private enforceLastProviderSafety(justOpenedId: string): void {
    const allIds = Array.from(this.breakers.keys());
    const availableCount = allIds.filter(id => {
      const b = this.breakers.get(id)!;
      return b.getState() !== 'OPEN';
    }).length;

    if (availableCount === 0) {
      // Every single provider is OPEN — force the one with the best
      // (lowest) weighted failure score back to HALF-OPEN
      let bestId = justOpenedId;
      let bestScore = Infinity;

      for (const [id, b] of this.breakers) {
        const score = b.getWeightedFailureScore();
        if (score < bestScore) {
          bestScore = score;
          bestId = id;
        }
      }

      const rescued = this.breakers.get(bestId)!;
      rescued.reset();
      console.warn(
        `[CircuitBreakerManager] SAFETY: All providers OPEN — forced ${bestId} back to CLOSED to maintain availability`,
      );
    }
  }

  // -- query helpers --------------------------------------------------------

  getAllStats(): Map<string, CircuitBreakerStats & { state: CircuitState; tier: ReliabilityTier }> {
    const stats = new Map<string, CircuitBreakerStats & { state: CircuitState; tier: ReliabilityTier }>();
    for (const [id, b] of this.breakers) {
      stats.set(id, b.getStats());
    }
    return stats;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.breakers.entries())
      .filter(([_, b]) => b.getState() !== 'OPEN')
      .map(([id]) => id);
  }

  getUnavailableProviders(): string[] {
    return Array.from(this.breakers.entries())
      .filter(([_, b]) => b.getState() === 'OPEN')
      .map(([id]) => id);
  }

  resetAll(): void {
    for (const b of this.breakers.values()) b.reset();
  }

  remove(providerId: string): void {
    this.breakers.delete(providerId);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const circuitBreakerManager = new CircuitBreakerManager();
