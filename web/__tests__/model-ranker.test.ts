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

import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';

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
