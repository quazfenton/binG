/**
 * LLM-specific provider health tracker.
 *
 * SEPARATE FROM web/lib/sandbox/provider-health.ts because:
 * - Sandbox tracks cloud-VM providers (e2b, daytona, codesandbox) — different domain
 * - This tracks LLM API providers (openrouter, nvidia, together, etc.)
 * - Sandbox uses persistence; this is in-memory only (chat path, no durability needed)
 *
 * Self-correcting mechanism for slow/failing LLM providers:
 * - preflightProviderHealthCheck in vercel-ai-streaming.ts calls recordCall()
 * - Provider selection (getProviderForModel / getConfiguredFallbackChain) calls
 *   shouldDeprioritize() to skip or deprioritize unhealthy providers
 * - 5-minute rolling window: recent slow/failed calls count toward deprioritization
 *
 * "Slow" threshold: any call that hit timeout OR took > 30s is treated as slow.
 */

import { chatLogger } from './chat-logger';

const log = chatLogger.child({ module: 'llm-provider-health' });

/** 5-minute rolling window. */
const WINDOW_MS = 5 * 60 * 1000;

/** A call is "slow" if it took longer than this OR failed with a timeout. */
const SLOW_THRESHOLD_MS = 30_000;

/** Number of slow/failed calls in the window that triggers deprioritization. */
const DEPRIORITIZE_THRESHOLD = 3;

export interface ProviderCallRecord {
  /** Timestamp of the call. */
  ts: number;
  /** Whether the call succeeded (true) or failed (false). */
  ok: boolean;
  /** End-to-end latency in ms (0 for hard failures that didn't measure). */
  latencyMs: number;
  /** Optional error type for diagnostics ('timeout' | 'network' | 'rate_limit' | ...). */
  errorType?: string;
}

interface ProviderHealthState {
  calls: ProviderCallRecord[];
  lastUpdated: number;
}

/** In-memory map of provider name (lowercase) → recent call records. */
const providerState = new Map<string, ProviderHealthState>();

/** Threshold used to classify a call as "slow". Exported for tests. */
export const SLOW_CALL_THRESHOLD_MS = SLOW_THRESHOLD_MS;

/** Deprioritization threshold. Exported for tests. */
export const DEPRIORITIZE_AFTER_COUNT = DEPRIORITIZE_THRESHOLD;

/** Window size in ms. Exported for tests. */
export const HEALTH_WINDOW_MS = WINDOW_MS;

/**
 * Drop records older than WINDOW_MS. Mutates the calls array in place.
 */
function pruneOldCalls(state: ProviderHealthState, now: number): void {
  const cutoff = now - WINDOW_MS;
  // Most records are appended in ts order, so prune from the front.
  let drop = 0;
  while (drop < state.calls.length && state.calls[drop].ts < cutoff) {
    drop++;
  }
  if (drop > 0) state.calls.splice(0, drop);
}

/**
 * Record a call outcome for a provider.
 * - `provider`: provider name (e.g. 'openrouter', 'nvidia')
 * - `success`: true if the call produced a valid response
 * - `latencyMs`: end-to-end latency; 0 is fine for hard failures
 * - `errorType`: optional tag for diagnostics ('timeout', 'rate_limit', etc.)
 */
export function recordCall(
  provider: string,
  success: boolean,
  latencyMs: number,
  errorType?: string,
): void {
  const key = provider.toLowerCase();
  const now = Date.now();
  let state = providerState.get(key);
  if (!state) {
    state = { calls: [], lastUpdated: now };
    providerState.set(key, state);
  }
  state.calls.push({ ts: now, ok: success, latencyMs, errorType });
  state.lastUpdated = now;
  pruneOldCalls(state, now);

  // Cap the array to prevent unbounded growth in pathological cases.
  if (state.calls.length > 200) {
    state.calls.splice(0, state.calls.length - 200);
  }
}

/**
 * A call counts as "bad" if it failed OR was slow.
 */
function isBadCall(record: ProviderCallRecord): boolean {
  if (!record.ok) return true;
  if (record.latencyMs > SLOW_THRESHOLD_MS) return true;
  return false;
}

/**
 * Returns true if the provider has accumulated DEPRIORITIZE_THRESHOLD+ bad
 * calls (failed or slow) within the last WINDOW_MS. Provider selection should
 * skip or move the provider to the end of the fallback chain in that case.
 */
export function shouldDeprioritize(provider: string): boolean {
  const key = provider.toLowerCase();
  const state = providerState.get(key);
  if (!state) return false;
  const now = Date.now();
  pruneOldCalls(state, now);
  const badCount = state.calls.filter(isBadCall).length;
  return badCount >= DEPRIORITIZE_THRESHOLD;
}

/**
 * Health score in [0, 1]. 1 = all recent calls succeeded and were fast.
 * 0 = every recent call failed/was slow. Unknown provider → 1 (neutral).
 *
 * Score = (good calls in window) / (total calls in window).
 * Providers with no recent history are treated as fully healthy so new
 * providers aren't penalized before they get a chance to prove themselves.
 */
export function getHealthScore(provider: string): number {
  const key = provider.toLowerCase();
  const state = providerState.get(key);
  if (!state) return 1;
  const now = Date.now();
  pruneOldCalls(state, now);
  if (state.calls.length === 0) return 1;
  const good = state.calls.filter((r) => !isBadCall(r)).length;
  return good / state.calls.length;
}

/**
 * For tests / admin tooling: clear all health state.
 */
export function _resetHealthForTests(): void {
  providerState.clear();
}

/**
 * For tests / admin tooling: get the raw call records for a provider.
 */
export function _getCallsForTests(provider: string): ProviderCallRecord[] {
  const state = providerState.get(provider.toLowerCase());
  return state ? [...state.calls] : [];
}

log.debug('LLM provider health tracker initialized', {
  windowMs: WINDOW_MS,
  slowThresholdMs: SLOW_THRESHOLD_MS,
  deprioritizeAfter: DEPRIORITIZE_THRESHOLD,
});
