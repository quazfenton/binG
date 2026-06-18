/**
 * Chat Metrics (Bug #40)
 *
 * Lightweight per-process counters for chat-route observability.
 * Persisted on `globalThis` so a Next.js hot-reload doesn't reset them.
 * Exposed via `/api/health?detailed`.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Chat:Metrics');

export interface OrchestrationFallbackRecord {
  count: number;
  lastReason: string | null;
  lastAt: number | null;
}

interface ChatMetricsState {
  orchestrationFallbacks: OrchestrationFallbackRecord;
  doubleWriteBlocked: { count: number; paths: string[] };
  incompleteResponses: { count: number; lastAt: number | null };
  injectedSteers: { count: number; byKind: Record<string, number> };
  classifierFallbacks: { count: number; lastAt: number | null };
  // Bug #61 (Pass-5 audit) — per-provider per-attempt metrics for the
  // fallback chain. Each attempt in the chain (ninerouter/deepseek-v4-flash
  // → nvidia/z-ai/glm-5.1 → mistral-large-latest → google/gemini-3.1-flash)
  // records its outcome so /api/health?detailed can surface "all 4 declined"
  // without grepping run.log. The chain-exhausted counter is a separate
  // bucket from the per-provider one so operators can tell whether the
  // system tried every provider (exhausted) or stopped at a circuit breaker
  // (per-provider block). The cap on `recentAttempts` keeps memory bounded.
  fallbackChainAttempts: {
    count: number;
    success: number;
    failure: number;
    chainExhausted: number;
    lastReason: string | null;
    lastExhaustedAt: number | null;
    recentAttempts: Array<{
      provider: string;
      model: string;
      outcome: 'success' | 'failure' | 'circuit_open' | 'rate_limited';
      reason?: string;
      at: number;
    }>;
  };
  // Bug #119 (Pass-8 audit) — JSON.parse fallback counter. Tracks
  // cases where an LLM- or AI-SDK-emitted JSON string failed to parse
  // and the code path fell through to a default (e.g. `{}` for args).
  // Operators can `grep -c '\\[INVALID-JSON-FALLBACK\\]'` in run.log
  // and cross-reference with this counter; mismatched sources point
  // at hidden io/codepaths that aren't surfacing the warn.
  invalidJsonFallbacks: {
    count: number;
    bySource: Record<string, number>;
    lastAt: number | null;
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __chatMetrics__: ChatMetricsState | undefined;
}

function getState(): ChatMetricsState {
  if (!globalThis.__chatMetrics__) {
    globalThis.__chatMetrics__ = {
      orchestrationFallbacks: { count: 0, lastReason: null, lastAt: null },
      doubleWriteBlocked: { count: 0, paths: [] },
      incompleteResponses: { count: 0, lastAt: null },
      injectedSteers: { count: 0, byKind: {} },
      classifierFallbacks: { count: 0, lastAt: null },
      fallbackChainAttempts: {
        count: 0,
        success: 0,
        failure: 0,
        chainExhausted: 0,
        lastReason: null,
        lastExhaustedAt: null,
        recentAttempts: [],
      },
      // Bug #119 — see ChatMetricsState.invalidJsonFallbacks above.
      invalidJsonFallbacks: {
        count: 0,
        bySource: {},
        lastAt: null,
      },
    };
  }
  return globalThis.__chatMetrics__;
}

export function recordOrchestrationFallback(reason: string): void {
  try {
    const state = getState();
    state.orchestrationFallbacks.count += 1;
    state.orchestrationFallbacks.lastReason = reason;
    state.orchestrationFallbacks.lastAt = Date.now();
  } catch (err) {
    logger.debug('[recordOrchestrationFallback] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function recordDoubleWriteBlocked(path: string): void {
  try {
    const state = getState();
    state.doubleWriteBlocked.count += 1;
    if (state.doubleWriteBlocked.paths.length > 20) {
      state.doubleWriteBlocked.paths.shift();
    }
    state.doubleWriteBlocked.paths.push(path);
  } catch (err) {
    logger.debug('[recordDoubleWriteBlocked] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function recordIncompleteResponse(): void {
  try {
    const state = getState();
    state.incompleteResponses.count += 1;
    state.incompleteResponses.lastAt = Date.now();
  } catch (err) {
    logger.debug('[recordIncompleteResponse] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function recordSteerInjected(kind: string): void {
  try {
    const state = getState();
    state.injectedSteers.count += 1;
    state.injectedSteers.byKind[kind] = (state.injectedSteers.byKind[kind] || 0) + 1;
  } catch (err) {
    logger.debug('[recordSteerInjected] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function recordClassifierFallback(): void {
  try {
    const state = getState();
    state.classifierFallbacks.count += 1;
    state.classifierFallbacks.lastAt = Date.now();
  } catch (err) {
    logger.debug('[recordClassifierFallback] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Bug #61 (Pass-5 audit) — record a single provider attempt in the
 * fallback chain. Called from each iteration of the chain in
 * use-enhanced-chat / llm-providers (and any future per-attempt caller)
 * with the provider, model, and outcome. The record is appended to
 * `recentAttempts` (bounded at 20 entries to keep memory low) so the
 * health endpoint can show the last N attempts to operators debugging
 * a "cascade to text mode" incident.
 */
export function recordFallbackChainAttempt(input: {
  provider: string;
  model: string;
  outcome: 'success' | 'failure' | 'circuit_open' | 'rate_limited';
  reason?: string;
}): void {
  try {
    const state = getState();
    state.fallbackChainAttempts.count += 1;
    if (input.outcome === 'success') {
      state.fallbackChainAttempts.success += 1;
    } else {
      state.fallbackChainAttempts.failure += 1;
    }
    state.fallbackChainAttempts.lastReason = input.reason ?? null;
    state.fallbackChainAttempts.recentAttempts.push({
      provider: input.provider,
      model: input.model,
      outcome: input.outcome,
      reason: input.reason,
      at: Date.now(),
    });
    // Bounded ring of the last 20 attempts
    while (state.fallbackChainAttempts.recentAttempts.length > 20) {
      state.fallbackChainAttempts.recentAttempts.shift();
    }
  } catch (err) {
    logger.debug('[recordFallbackChainAttempt] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Bug #61 (Pass-5 audit) — record that the ENTIRE fallback chain was
 * exhausted (every provider in the chain returned a failure). This is
 * the canonical "cascade to text mode" trigger. The chat-metrics module
 * keeps a separate counter so operators can distinguish "tried every
 * provider in the chain" from "stopped early at a circuit-breaker".
 */
export function recordFallbackChainExhausted(input: {
  reason: string;
  attempts: ReadonlyArray<{ provider: string; model: string }>;
}): void {
  try {
    const state = getState();
    state.fallbackChainAttempts.chainExhausted += 1;
    state.fallbackChainAttempts.lastExhaustedAt = Date.now();
    state.fallbackChainAttempts.lastReason = input.reason;
    logger.warn(
      `[fallback-chain] chain exhausted after ${input.attempts.length} attempts — last reason: ${input.reason}`,
      {
        attempts: input.attempts.map((a) => `${a.provider}/${a.model}`),
        reason: input.reason,
        chainExhaustedTotal: state.fallbackChainAttempts.chainExhausted,
      },
    );
  } catch (err) {
    logger.debug('[recordFallbackChainExhausted] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function getChatMetrics(): {
  orchestrationFallbacks: OrchestrationFallbackRecord;
  doubleWriteBlocked: { count: number; paths: string[] };
  incompleteResponses: { count: number; lastAt: number | null };
  injectedSteers: { count: number; byKind: Record<string, number> };
  classifierFallbacks: { count: number; lastAt: number | null };
  fallbackChainAttempts: {
    count: number;
    success: number;
    failure: number;
    chainExhausted: number;
    lastReason: string | null;
    lastExhaustedAt: number | null;
    recentAttempts: Array<{ provider: string; model: string; outcome: string; reason?: string; at: number }>;
  };
} {
  const s = getState();
  return {
    orchestrationFallbacks: { ...s.orchestrationFallbacks },
    doubleWriteBlocked: { count: s.doubleWriteBlocked.count, paths: [...s.doubleWriteBlocked.paths] },
    incompleteResponses: { ...s.incompleteResponses },
    injectedSteers: { count: s.injectedSteers.count, byKind: { ...s.injectedSteers.byKind } },
    classifierFallbacks: { ...s.classifierFallbacks },
    fallbackChainAttempts: {
      count: s.fallbackChainAttempts.count,
      success: s.fallbackChainAttempts.success,
      failure: s.fallbackChainAttempts.failure,
      chainExhausted: s.fallbackChainAttempts.chainExhausted,
      lastReason: s.fallbackChainAttempts.lastReason,
      lastExhaustedAt: s.fallbackChainAttempts.lastExhaustedAt,
      recentAttempts: s.fallbackChainAttempts.recentAttempts.map((a) => ({ ...a })),
    },
  };
}

export function _resetChatMetricsForTests(): void {
  if (globalThis.__chatMetrics__) {
    globalThis.__chatMetrics__.orchestrationFallbacks = { count: 0, lastReason: null, lastAt: null };
    globalThis.__chatMetrics__.doubleWriteBlocked = { count: 0, paths: [] };
    globalThis.__chatMetrics__.incompleteResponses = { count: 0, lastAt: null };
    globalThis.__chatMetrics__.injectedSteers = { count: 0, byKind: {} };
    globalThis.__chatMetrics__.classifierFallbacks = { count: 0, lastAt: null };
    globalThis.__chatMetrics__.fallbackChainAttempts = {
      count: 0,
      success: 0,
      failure: 0,
      chainExhausted: 0,
      lastReason: null,
      lastExhaustedAt: null,
      recentAttempts: [],
    };
  }
}


/**
 * Bug #119 (Pass-8 audit) — record that a JSON.parse call has fallen
 * back to a default value because the input was malformed. Permanently
 * tied to `chatMetrics.invalidJsonFallbacks` so that `recordInvalidJsonFallback`
 * callers in `bing/web/lib/chat/vercel-ai-streaming.ts` (tool-args parser)
 * and any future caller stay in lockstep. Note: this counter is web-only.
 * The shared-package companion (e.g. `bing/packages/shared/agent/orchestration/
 * plan-act-verify.ts`) uses `logger.warn('[INVALID-JSON-FALLBACK]')` directly
 * because the cross-package boundary (shared → web) is forbidden.
 *
 * @param source — short identifier for the callsite emitting the fallback
 *   (e.g. `'vercel-ai-streaming.tool-call-args-cache'`). Becomes a key
 *   in `bySource` so /api/health?detailed can surface per-source counts.
 */
export function recordInvalidJsonFallback(source: string): void {
  try {
    const state = getState();
    state.invalidJsonFallbacks.count += 1;
    state.invalidJsonFallbacks.bySource[source] =
      (state.invalidJsonFallbacks.bySource[source] ?? 0) + 1;
    state.invalidJsonFallbacks.lastAt = Date.now();
  } catch (err) {
    logger.debug('[recordInvalidJsonFallback] counter update failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
