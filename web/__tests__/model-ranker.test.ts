/**
 * Unit tests for model-ranker.ts
 *
 * Tests:
 *  - scoreModel() — pure function, tested directly without mocking
 *  - refreshModelTelemetryCache() — verifies mock calls and error handling
 *  - stopRefreshingModelTelemetryCache() — verifies interval cleanup
 *
 * The module has module-level side effects (void refreshModelTelemetryCache()
 * and setInterval at import time). Both chatRequestLogger and toolCallTracker
 * are mocked before import so those side effects resolve cleanly.
 */

import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// ============================================================================
// Mock database-dependent modules before importing model-ranker
// ============================================================================

vi.mock('@/lib/chat/chat-request-logger', () => ({
  chatRequestLogger: {
    getModelPerformance: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/tools/tool-call-tracker', () => ({
  toolCallTracker: {
    getModelToolStats: vi.fn().mockResolvedValue([]),
  },
}));

// ============================================================================
// Imports
// ============================================================================

import {
  scoreModel,
  refreshModelTelemetryCache,
  stopRefreshingModelTelemetryCache,
  getRetryModel,
  recordRateLimitError,
} from '../lib/providers/model-ranker';
import { chatRequestLogger } from '../lib/chat/chat-request-logger';
import { toolCallTracker } from '../lib/tools/tool-call-tracker';

// ============================================================================
// Shared helpers
// ============================================================================

/** Build a minimal ModelStats object with sensible defaults */
function makeStats(overrides: Partial<Parameters<typeof scoreModel>[0]> = {}): Parameters<typeof scoreModel>[0] {
  return {
    provider: 'openai',
    model: 'gpt-4',
    avgLatency: 2000,
    failureRate: 0.1,
    lastUpdated: Date.now(),
    totalCalls: 10,
    successRate: 0.9,
    ...overrides,
  };
}

// ============================================================================
// Setup — clean up the module-level setInterval
// ============================================================================

beforeAll(() => {
  // The module-level setInterval from model-ranker.ts fires every 5 min;
  // stop it here so it doesn't keep the test process alive or fire during
  // the test suite. The cache can still be refreshed manually on demand.
  stopRefreshingModelTelemetryCache();
});

describe('scoreModel', () => {
  // --------------------------------------------------------------------------
  // Baseline / edge cases
  // --------------------------------------------------------------------------

  it('returns Infinity for models with negative failure rate (model-not-found penalty)', () => {
    const result = scoreModel(makeStats({ failureRate: -10, successRate: -10 }));
    expect(result).toBe(Infinity);
  });

  it('computes the base score from latency and failure rate with fresh data', () => {
    const result = scoreModel(makeStats({
      avgLatency: 2000,  // normalized: 0.2
      failureRate: 0.1,
      lastUpdated: Date.now(),
    }));
    // score = (0.2 * 0.6 + 0.1 * 2.5) * 1.0 = 0.12 + 0.25 = 0.37
    expect(result).toBeCloseTo(0.37, 5);
  });

  it('applies the stale penalty when data is older than 10 minutes', () => {
    const result = scoreModel(makeStats({
      lastUpdated: Date.now() - 11 * 60 * 1000, // 11 minutes old
    }));
    // base = (0.12 + 0.25) * 1.2 = 0.444
    expect(result).toBeCloseTo(0.444, 5);
  });

  it('handles zero latency and zero failure rate', () => {
    const result = scoreModel(makeStats({
      avgLatency: 0,
      failureRate: 0,
    }));
    // score = (0.0 * 0.6 + 0.0 * 2.5) * 1.0 = 0
    expect(result).toBe(0);
    // Not Infinity (no penalty)
    expect(result).not.toBe(Infinity);
  });

  // --------------------------------------------------------------------------
  // Tool call stats
  // --------------------------------------------------------------------------

  it('reduces score (prefers model) when tool performance is good', () => {
    const baseline = scoreModel(makeStats({}));
    const withGoodTools = scoreModel(makeStats({
      avgToolScore: 0.8,       // good tool performance
      toolCallTotalCalls: 10,  // full confidence (10/10 = 1.0)
    }));
    // baseline = 0.37
    // toolAdj  = 0.8 * 1.0 * 1.0 = 0.80
    // score    = 0.37 - 0.80 = -0.43
    expect(withGoodTools).toBeLessThan(baseline);
    expect(withGoodTools).toBeCloseTo(-0.43, 5);
  });

  it('increases score (avoids model) when tool performance is bad', () => {
    const baseline = scoreModel(makeStats({}));
    const withBadTools = scoreModel(makeStats({
      avgToolScore: -0.8,       // bad tool performance
      toolCallTotalCalls: 10,
    }));
    // baseline = 0.37
    // toolAdj  = -0.8 * 1.0 * 1.0 = -0.80  →  score += 0.80
    // score    = 0.37 + 0.80 = 1.17
    expect(withBadTools).toBeGreaterThan(baseline);
    expect(withBadTools).toBeCloseTo(1.17, 5);
  });

  it('ignores tool stats when toolCallTotalCalls is below the threshold', () => {
    const baseline = scoreModel(makeStats({}));
    const withFewCalls = scoreModel(makeStats({
      avgToolScore: 0.8,        // good score but …
      toolCallTotalCalls: 2,    // … below MIN_TOOL_CALLS_FOR_SCORING (3)
    }));
    expect(withFewCalls).toBeCloseTo(baseline, 5); // no tool adjustment
  });

  it('scales tool confidence proportionally between threshold and saturation', () => {
    // At 5 tool calls → confidence = 5/10 = 0.5
    // toolAdj = 0.8 * 1.0 * 0.5 = 0.40
    // score   = 0.37 - 0.40 = -0.03
    const result = scoreModel(makeStats({
      avgToolScore: 0.8,
      toolCallTotalCalls: 5,
    }));
    expect(result).toBeCloseTo(-0.03, 5);
  });

  it('handles undefined tool fields without crashing', () => {
    // Neither avgToolScore nor toolCallTotalCalls set
    const result = scoreModel(makeStats({
      toolCallScore: undefined,
      toolSuccessRate: undefined,
      avgToolScore: undefined,
      toolCallTotalCalls: undefined,
    }));
    expect(result).toBeCloseTo(0.37, 5); // baseline, no adjustment
  });

  // --------------------------------------------------------------------------
  // High-failure / edge behaviour
  // --------------------------------------------------------------------------

  it('penalises high-failure models heavily', () => {
    const reliable = scoreModel(makeStats({ failureRate: 0.05 }));
    const unreliable = scoreModel(makeStats({ failureRate: 0.5 }));
    // Additional failure cost = (0.5 - 0.05) * 2.5 = 1.125
    expect(unreliable - reliable).toBeCloseTo(1.125, 5);
  });

  it('produces scores in the expected range for normal inputs', () => {
    const result = scoreModel(makeStats({
      avgLatency: 1000,   // normalized: 0.1
      failureRate: 0.03,
    }));
    // score = (0.1 * 0.6 + 0.03 * 2.5) * 1.0 = 0.06 + 0.075 = 0.135
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });
});

describe('refreshModelTelemetryCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches performance data and tool stats then populates the internal cache', async () => {
    const mockPerf = [
      { provider: 'openai', model: 'gpt-4', avgLatency: 1200, failureRate: 0.05, lastUpdated: Date.now(), totalCalls: 20, successRate: 0.95 },
      { provider: 'anthropic', model: 'claude-3.5', avgLatency: 800, failureRate: 0.02, lastUpdated: Date.now(), totalCalls: 50, successRate: 0.98 },
    ];
    vi.mocked(chatRequestLogger.getModelPerformance).mockResolvedValue(mockPerf);
    vi.mocked(toolCallTracker.getModelToolStats).mockResolvedValue([]);

    await refreshModelTelemetryCache();

    expect(chatRequestLogger.getModelPerformance).toHaveBeenCalledWith(10);
    expect(toolCallTracker.getModelToolStats).toHaveBeenCalledWith(10);
  });

  it('merges tool stats into cache entries by matching provider:model key', async () => {
    const mockPerf = [
      { provider: 'openai', model: 'gpt-4', avgLatency: 1200, failureRate: 0.05, lastUpdated: Date.now(), totalCalls: 20, successRate: 0.95 },
    ];
    const mockToolStats = [
      { provider: 'openai', model: 'gpt-4', toolCallScore: 8, toolSuccessRate: 0.9, avgToolScore: 0.8, totalToolCalls: 10 },
    ];
    vi.mocked(chatRequestLogger.getModelPerformance).mockResolvedValue(mockPerf);
    vi.mocked(toolCallTracker.getModelToolStats).mockResolvedValue(mockToolStats);

    // Should not throw
    await expect(refreshModelTelemetryCache()).resolves.toBeUndefined();
    expect(chatRequestLogger.getModelPerformance).toHaveBeenCalled();
    expect(toolCallTracker.getModelToolStats).toHaveBeenCalled();
  });

  it('does not throw when both sources return empty arrays', async () => {
    vi.mocked(chatRequestLogger.getModelPerformance).mockResolvedValue([]);
    vi.mocked(toolCallTracker.getModelToolStats).mockResolvedValue([]);

    await expect(refreshModelTelemetryCache()).resolves.toBeUndefined();
  });

  it('does not throw when toolCallTracker.getModelToolStats rejects', async () => {
    vi.mocked(chatRequestLogger.getModelPerformance).mockResolvedValue([]);
    vi.mocked(toolCallTracker.getModelToolStats).mockRejectedValue(new Error('DB down'));

    // Should catch internally and resolve without error
    await expect(refreshModelTelemetryCache()).resolves.toBeUndefined();
  });

  it('does not throw when chatRequestLogger.getModelPerformance rejects', async () => {
    vi.mocked(chatRequestLogger.getModelPerformance).mockRejectedValue(new Error('DB down'));
    vi.mocked(toolCallTracker.getModelToolStats).mockResolvedValue([]);

    await expect(refreshModelTelemetryCache()).resolves.toBeUndefined();
  });
});

describe('stopRefreshingModelTelemetryCache', () => {
  it('can be called without throwing (clears the module-level interval)', () => {
    // Calling this in beforeAll already prevents the interval from firing,
    // but verify it doesn't throw even if called again.
    expect(() => stopRefreshingModelTelemetryCache()).not.toThrow();
  });
});

describe('getRetryModel — graceful degraded fallback', () => {
  // Track env mutations so we cleanly restore them around the test.
  const SAVED_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const SAVED_DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER;
  const SAVED_DEFAULT_MODEL = process.env.DEFAULT_MODEL;

  afterAll(() => {
    if (SAVED_OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = SAVED_OPENAI_API_KEY;
    if (SAVED_DEFAULT_PROVIDER === undefined) delete process.env.DEFAULT_PROVIDER;
    else process.env.DEFAULT_PROVIDER = SAVED_DEFAULT_PROVIDER;
    if (SAVED_DEFAULT_MODEL === undefined) delete process.env.DEFAULT_MODEL;
    else process.env.DEFAULT_MODEL = SAVED_DEFAULT_MODEL;
  });

  beforeEach(() => {
    // Remove override env vars before each test so each case starts from a
    // clean slate. Tests that need the override set it themselves in a
    // try/finally so on assertion failure the env state is still restored.
    delete process.env.DEFAULT_PROVIDER;
    delete process.env.DEFAULT_MODEL;
  });

  it('returns a degraded fallback when every configured candidate is rate-limited', async () => {
    // Step 1 — Provide at least one API key so findDegradedFallback has
    // something to pick. Without this the provider list filters to empty and
    // we never exercise the degraded-return branch.
    process.env.OPENAI_API_KEY = 'sk-test-key-for-degraded-fallback';

    // Step 2 — Force every openai model into circuit-breaker-tripped state so
    // `getModelForRotation()` returns null (no openai candidate survives)
    // AND the priority walk earlier in the function reaches its terminal
    // null-return. Tripping = 3 consecutive `recordRateLimitError` calls per
    // model raises consecutive429Count >= RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD.
    const openaiModels = [
      'gpt-5-mini',
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-instruct',
    ];
    for (const m of openaiModels) {
      for (let i = 0; i < 3; i++) recordRateLimitError('openai', m);
    }

    // Step 3 — Empty telemetry rows so the priority walk through stats fails.
    vi.mocked(chatRequestLogger.getModelPerformance).mockResolvedValue([]);
    vi.mocked(toolCallTracker.getModelToolStats).mockResolvedValue([]);

    // Step 4 — Invoke getRetryModel. With stats=[] AND all openai models
    // rate-limited AND no other provider configured, the priority walk
    // exhausts and the new degraded-fallback branch should fire.
    const result = await getRetryModel({
      failedModel: 'gpt-5-mini',
      failedProvider: 'openai',
    });

    // Step 5 — Assertions on the graceful degraded pick.
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.model).toBeTruthy();
    expect(result?.degraded).toBe(true);
    expect(result?.failureRate).toBe(1);
    expect(result?.successRate).toBe(0);
    expect(result?.totalCalls).toBe(0);
    expect(result?.score).toBe(Infinity);
    expect(result?.rank).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('honors DEFAULT_PROVIDER + DEFAULT_MODEL env override when both are set and the override pair is valid', async () => {
    // Auto-discovery would normally pick openai's first model (`gpt-5-mini`)
    // because OPENAI_API_KEY is the only key set. With the env override pair
    // pinning `openai:gpt-4o-mini`, that exact pair should be returned.
    process.env.OPENAI_API_KEY = 'sk-test-key-for-degraded-fallback';
    process.env['DEFAULT_PROVIDER'] = 'openai';
    process.env['DEFAULT_MODEL'] = 'gpt-4o-mini';

    try {
      // Trip every openai model into circuit-breaker state so auto
      // discovery's `getModelForRotation()` returns null and ONLY the env
      // override path can satisfy the request.
      const openaiModels = [
        'gpt-5-mini',
        'gpt-4',
        'gpt-4-turbo',
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-instruct',
      ];
      for (const m of openaiModels) {
        for (let i = 0; i < 3; i++) recordRateLimitError('openai', m);
      }

      vi.mocked(chatRequestLogger.getModelPerformance).mockResolvedValue([]);
      vi.mocked(toolCallTracker.getModelToolStats).mockResolvedValue([]);

      const result = await getRetryModel({
        failedModel: 'gpt-5-mini',
        failedProvider: 'openai',
      });

      expect(result).not.toBeNull();
      expect(result?.provider).toBe('openai');
      // Env override wins: 'gpt-4o-mini' instead of auto-discovery default.
      expect(result?.model).toBe('gpt-4o-mini');
      expect(result?.degraded).toBe(true);
      expect(result?.failureRate).toBe(1);
      expect(result?.score).toBe(Infinity);
      expect(result?.rank).toBe(Number.MAX_SAFE_INTEGER);
    } finally {
      // Restore env. afterAll also enforces this, but finally gives
      // best-effort cleanup even if the test assertion above fails.
      delete process.env['DEFAULT_PROVIDER'];
      delete process.env['DEFAULT_MODEL'];
    }
  });

  it('still returns null when no provider is configured (truly unrecoverable)', async () => {
    // Strip API keys so isProviderConfiguredForTelemetry returns false for
    // every provider AND no env override is set (override requires a
    // configured provider anyway). findDegradedFallback then returns null,
    // and the safe null-return branch fires.
    const savedEnv: Record<string, string | undefined> = {};
    for (const k of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_API_KEY',
      'MISTRAL_API_KEY',
      'OPENROUTER_API_KEY',
      'CHUTES_API_KEY',
      'PORTKEY_API_KEY',
      'GITHUB_MODELS_API_KEY',
      'NVIDIA_API_KEY',
      'GROQ_API_KEY',
      'TOGETHER_API_KEY',
      'FIREWORKS_API_KEY',
      'DEEPINFRA_API_KEY',
      'ZEN_API_KEY',
      'COHERE_API_KEY',
      'AIHUBMIX_API_KEY',
      'CLOUDFLARE_API_KEY',
      'LIVEKIT_API_KEY',
      'POLLINATIONS_API_KEY',
      'CHATANYWHERE_API_KEY',
      'NINEROUTER_API_KEY',
      'QUAZ_API_KEY',
    ]) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }

    try {
      vi.mocked(chatRequestLogger.getModelPerformance).mockResolvedValue([]);
      const result = await getRetryModel({
        failedModel: 'gpt-5-mini',
        failedProvider: 'openai',
      });
      expect(result).toBeNull();
    } finally {
      // Restore env.
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v !== undefined) process.env[k] = v;
      }
    }
  });
});
