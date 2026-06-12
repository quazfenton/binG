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

export function getChatMetrics(): {
  orchestrationFallbacks: OrchestrationFallbackRecord;
  doubleWriteBlocked: { count: number; paths: string[] };
  incompleteResponses: { count: number; lastAt: number | null };
  injectedSteers: { count: number; byKind: Record<string, number> };
} {
  const s = getState();
  return {
    orchestrationFallbacks: { ...s.orchestrationFallbacks },
    doubleWriteBlocked: { count: s.doubleWriteBlocked.count, paths: [...s.doubleWriteBlocked.paths] },
    incompleteResponses: { ...s.incompleteResponses },
    injectedSteers: { count: s.injectedSteers.count, byKind: { ...s.injectedSteers.byKind } },
  };
}

export function _resetChatMetricsForTests(): void {
  if (globalThis.__chatMetrics__) {
    globalThis.__chatMetrics__.orchestrationFallbacks = { count: 0, lastReason: null, lastAt: null };
    globalThis.__chatMetrics__.doubleWriteBlocked = { count: 0, paths: [] };
    globalThis.__chatMetrics__.incompleteResponses = { count: 0, lastAt: null };
    globalThis.__chatMetrics__.injectedSteers = { count: 0, byKind: {} };
  }
}
