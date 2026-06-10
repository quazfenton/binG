import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordCall,
  shouldDeprioritize,
  getHealthScore,
  _resetHealthForTests,
  _getCallsForTests,
  SLOW_CALL_THRESHOLD_MS,
  DEPRIORITIZE_AFTER_COUNT,
  HEALTH_WINDOW_MS,
} from '../llm-provider-health';

describe('llm-provider-health', () => {
  beforeEach(() => {
    _resetHealthForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports the expected tunables', () => {
    expect(SLOW_CALL_THRESHOLD_MS).toBe(30_000);
    expect(DEPRIORITIZE_AFTER_COUNT).toBe(3);
    expect(HEALTH_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it('recordCall then getHealthScore returns the ratio of good/total', () => {
    recordCall('openai', true, 1000);
    recordCall('openai', true, 2000);
    recordCall('openai', false, 0);
    expect(getHealthScore('openai')).toBeCloseTo(2 / 3, 5);
  });

  it('shouldDeprioritize returns false at 2 bad calls and true at 3', () => {
    recordCall('nvidia', false, 0);
    recordCall('nvidia', false, 0);
    expect(shouldDeprioritize('nvidia')).toBe(false);

    recordCall('nvidia', false, 0);
    expect(shouldDeprioritize('nvidia')).toBe(true);
  });

  it('a slow call (>30s) counts as bad even when ok=true', () => {
    recordCall('together', true, SLOW_CALL_THRESHOLD_MS + 1);
    recordCall('together', true, SLOW_CALL_THRESHOLD_MS + 1);
    recordCall('together', true, SLOW_CALL_THRESHOLD_MS + 1);
    expect(shouldDeprioritize('together')).toBe(true);
  });

  it('a fast call (<30s) does not count as bad', () => {
    recordCall('groq', true, 100);
    recordCall('groq', true, 200);
    recordCall('groq', true, 300);
    expect(shouldDeprioritize('groq')).toBe(false);
    expect(getHealthScore('groq')).toBe(1);
  });

  it('records older than 5min are pruned and stop counting', () => {
    recordCall('chutes', false, 0);
    recordCall('chutes', false, 0);
    recordCall('chutes', false, 0);
    expect(shouldDeprioritize('chutes')).toBe(true);

    // Advance past the rolling window
    vi.advanceTimersByTime(HEALTH_WINDOW_MS + 1000);

    // After advancing time, the public-API calls trigger pruning on access.
    expect(shouldDeprioritize('chutes')).toBe(false);
    expect(getHealthScore('chutes')).toBe(1);
    expect(_getCallsForTests('chutes')).toEqual([]);
  });

  it('two providers have independent state', () => {
    recordCall('openrouter', false, 0);
    recordCall('openrouter', false, 0);
    recordCall('openrouter', false, 0);
    expect(shouldDeprioritize('openrouter')).toBe(true);

    // groq has no history
    expect(shouldDeprioritize('groq')).toBe(false);
    expect(getHealthScore('groq')).toBe(1);
  });

  it('getHealthScore returns 1 for an unknown provider', () => {
    expect(getHealthScore('unknown-provider')).toBe(1);
  });

  it('a recordCall from the preflight path with errorType=unreachable counts as bad', () => {
    // Mirrors the preflightProviderHealthCheck failure path:
    //   recordCall(provider, false, latencyMs, 'unreachable')
    recordCall('fireworks', false, 5000, 'unreachable');
    recordCall('fireworks', false, 5000, 'unreachable');
    recordCall('fireworks', false, 5000, 'unreachable');
    expect(shouldDeprioritize('fireworks')).toBe(true);
  });

  it('case-insensitive: shouldDeprioritize and getHealthScore normalize provider name', () => {
    recordCall('OpenRouter', false, 0);
    recordCall('OpenRouter', false, 0);
    recordCall('OpenRouter', false, 0);
    expect(shouldDeprioritize('openrouter')).toBe(true);
    expect(shouldDeprioritize('OPENROUTER')).toBe(true);
    expect(getHealthScore('openrouter')).toBe(0);
  });

  it('pruning keeps the calls array bounded even with rapid recordCalls', () => {
    // 250 rapid successful calls
    for (let i = 0; i < 250; i++) {
      recordCall('vercel', true, 100);
    }
    // The internal cap of 200 should apply
    expect(_getCallsForTests('vercel').length).toBeLessThanOrEqual(200);
  });
});
