/**
 * Model Capability Registry
 *
 * Dynamic, telemetry-powered model lists organized by PURPOSE.
 * Instead of hardcoding static lists (e.g. FC-capable models), this registry
 * queries actual tool-call success telemetry to surface models that reliably
 * perform a given capability.
 *
 * Supported purposes (extensible):
 *   'tool-calling'   — models with >65% tool-call success rate (min 3 calls, rolling 30min window)
 *   'reasoning'      — future: models with high reasoning quality scores
 *   'fast-response'  — future: models with lowest avg latency for quick tasks
 *
 * Architecture:
 *   - tool-call-telemetry.ts → in-memory ModelStats keyed by model name (30min rolling window)
 *   - tool-call-tracker.ts   → SQLite persistence of per-(provider,model,tool) success/failure
 *   - model-capability-registry.ts → aggregates telemetry into per-purpose ranked model lists
 *
 * Usage:
 *   const models = getModelsForPurpose('tool-calling')
 *   // Returns: [{ provider, model, score, toolCallScore, toolSuccessRate, ... }]
 *   // Sorted by tool success rate desc, filtered to minSample + configured providers
 */

import { createLogger } from '@/lib/utils/logger';
import { getToolCallTelemetrySummary } from '@/lib/chat/tool-call-telemetry';
import { isProviderConfigured } from '@/lib/chat/provider-fallback-chains';
import { PROVIDERS } from '@/lib/chat/llm-providers';

const logger = createLogger('model-capability-registry');

// ─── Purpose definitions ───────────────────────────────────────────────────

export type ModelPurpose =
  | 'tool-calling'
  | 'reasoning'
  | 'fast-response';

export interface CapabilityModel {
  provider: string;
  model: string;
  /** Combined score for ranking (higher = better) */
  score: number;
  /** Tool call score from tracker: successes - failures */
  toolCallScore: number;
  /** Fraction of tool calls that succeeded (0–1) */
  toolSuccessRate: number;
  /** Total tool calls observed in the window */
  sampleSize: number;
  /** Purpose this model was selected for */
  purpose: ModelPurpose;
}

// ─── Telemetry thresholds ───────────────────────────────────────────────────

const MIN_SAMPLE_SIZE = 3;        // minimum tool calls before a model is considered reliable
const TOOL_SUCCESS_THRESHOLD = 0.65; // >65% success rate to qualify
const WINDOW_MINUTES = 30;        // only consider recent calls (matches tool-call-telemetry WINDOW_MS)

// Static hardcoded fallback lists — used when telemetry has no data yet
const FALLBACK_MODEL_LISTS: Record<ModelPurpose, Array<{ provider: string; model: string }>> = {
  'tool-calling': [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
    { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'google', model: 'gemini-2.0-flash' },
    { provider: 'google', model: 'gemini-1.5-pro' },
    { provider: 'mistral', model: 'mistral-large-latest' },
    { provider: 'mistral', model: 'mistral-medium-latest' },
    { provider: 'nvidia', model: 'nvidia/llama-3.1-nemotron-70b-instruct' },
  ],
  'reasoning': [
    { provider: 'anthropic', model: 'claude-opus-4-20250514' },
    { provider: 'openai', model: 'o3' },
    { provider: 'openai', model: 'o4-mini' },
  ],
  'fast-response': [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'google', model: 'gemini-2.0-flash' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq', model: 'mixtral-8x7b-32768' },
  ],
};

// ─── In-memory cache ───────────────────────────────────────────────────────

interface CacheEntry {
  models: CapabilityModel[];
  fetchedAt: number;
}

const cache: Partial<Record<ModelPurpose, CacheEntry>> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Helpers (defined before use) ─────────────────────────────────────────

/**
 * Extract provider from a model string like 'meta/llama-3.1-8b-instruct' → 'meta'
 * or 'claude-3-5-sonnet-latest' (no slash) → look up in PROVIDERS.
 */
function providerFromModel(modelName: string): string | null {
  if (modelName.includes('/')) {
    return modelName.split('/')[0];
  }
  for (const [providerName, config] of Object.entries(PROVIDERS ?? {})) {
    if (config?.models?.some(m => {
      const id = typeof m === 'string' ? m : (m as any).id;
      return id === modelName;
    })) {
      return providerName;
    }
  }
  return null;
}

function buildModelList(
  telemetry: Record<string, { totalCalls: number; successCount: number; failureCount: number; lastUpdated: number }>,
  purpose: ModelPurpose,
  minSample: number,
  threshold: number,
): CapabilityModel[] {
  const cutoff = Date.now() - WINDOW_MINUTES * 60 * 1000;

  return Object.entries(telemetry)
    .filter(([model, stats]) => {
      if (stats.totalCalls < minSample) return false;
      if (stats.lastUpdated < cutoff) return false;
      const rate = stats.successCount / stats.totalCalls;
      return rate >= threshold;
    })
    .map(([model, stats]) => {
      const successRate = stats.successCount / stats.totalCalls;
      const toolCallScore = stats.successCount - stats.failureCount;
      return {
        provider: providerFromModel(model),
        model,
        score: toolCallScore + successRate * 10,
        toolCallScore,
        toolSuccessRate: successRate,
        sampleSize: stats.totalCalls,
        purpose,
      };
    })
    .filter((m): m is CapabilityModel => m.provider !== null);
}

function buildFromFallback(purpose: ModelPurpose, existingTelemetry: CapabilityModel[]): CapabilityModel[] {
  const staticList = FALLBACK_MODEL_LISTS[purpose];
  if (!staticList) return [];

  const maxTelemetryScore = existingTelemetry.reduce((max, m) => Math.max(max, m.score), 0);

  return staticList.map((entry, index) => ({
    provider: entry.provider,
    model: entry.model,
    score: Math.max(0, maxTelemetryScore - 10) + (staticList.length - index) * 0.1,
    toolCallScore: 0,
    toolSuccessRate: 0,
    sampleSize: 0,
    purpose,
  }));
}

// ─── Core function ─────────────────────────────────────────────────────────

/**
 * Get ranked models that are GOOD at a given purpose.
 *
 * Strategy:
 *   1. Fetch real telemetry from tool-call-telemetry (in-memory, last 30min)
 *   2. Filter to models with >65% success rate + ≥3 calls
 *   3. Sort by score descending
 *   4. Filter to only configured providers (has API key)
 *   5. If <2 models found, merge in the static fallback list
 *   6. Cache result for 5 minutes
 */
export function getModelsForPurpose(
  purpose: ModelPurpose,
  options?: {
    minSampleSize?: number;
    successThreshold?: number;
    maxModels?: number;
  },
): CapabilityModel[] {
  const minSample = options?.minSampleSize ?? MIN_SAMPLE_SIZE;
  const threshold = options?.successThreshold ?? TOOL_SUCCESS_THRESHOLD;
  const maxModels = options?.maxModels ?? 8;

  // ── Check cache ──
  const cached = cache[purpose];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.models.slice(0, maxModels);
  }

  // ── Fetch telemetry (sync from tool-call-telemetry in-memory store) ──
  let ranked: CapabilityModel[] = [];
  try {
    const telemetry = getToolCallTelemetrySummary();
    if (Object.keys(telemetry).length > 0) {
      ranked = buildModelList(telemetry, purpose, minSample, threshold);
      logger.debug(`[CapabilityRegistry] ${purpose}: ${ranked.length} models from telemetry`);
    }
  } catch (err) {
    logger.warn(`[CapabilityRegistry] Failed to fetch telemetry for ${purpose}:`, err);
  }

  // ── Merge with static fallback if telemetry returned < 2 results ──
  if (ranked.length < 2) {
    const fallbackRanked = buildFromFallback(purpose, ranked);
    const existing = new Set(ranked.map(m => `${m.provider}:${m.model}`));
    const merged = [
      ...ranked,
      ...fallbackRanked.filter(fm => !existing.has(`${fm.provider}:${fm.model}`)),
    ];
    ranked = merged;
    logger.debug(`[CapabilityRegistry] ${purpose}: merged fallback → ${ranked.length} total`);
  }

  // ── Filter to configured providers ──
  const configured = ranked.filter(m => isProviderConfigured(m.provider));
  if (configured.length > 0) ranked = configured;

  // ── Sort by score desc and cap ──
  ranked.sort((a, b) => b.score - a.score);
  const result = ranked.slice(0, maxModels);

  // ── Cache ──
  cache[purpose] = { models: result, fetchedAt: Date.now() };

  logger.info(`[CapabilityRegistry] ${purpose}: returning ${result.length} models`, {
    models: result.map(m => `${m.provider}/${m.model}`),
  });

  return result;
}

/**
 * Invalidate the cache. Call after significant telemetry updates.
 */
export function invalidateCapabilityCache(purpose?: ModelPurpose): void {
  if (purpose) {
    delete cache[purpose];
  } else {
    for (const key of Object.keys(cache) as ModelPurpose[]) {
      delete cache[key];
    }
  }
}

// ─── Convenience helpers ───────────────────────────────────────────────────

/**
 * Get the single best tool-calling model (or null if none available).
 */
export function getBestToolCallingModel(): CapabilityModel | null {
  const models = getModelsForPurpose('tool-calling', { maxModels: 1 });
  return models[0] ?? null;
}

/**
 * Get a fresh (non-cached) list. Useful for immediate retry decisions.
 */
export function getModelsForPurposeFresh(
  purpose: ModelPurpose,
  options?: { minSampleSize?: number; successThreshold?: number; maxModels?: number },
): CapabilityModel[] {
  invalidateCapabilityCache(purpose);
  return getModelsForPurpose(purpose, options);
}