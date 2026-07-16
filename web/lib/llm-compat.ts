/**
 * LLM Compatibility Helpers
 *
 * Shared utilities for determining whether a model/provider supports
 * function calling (FC), and whether tools should be stripped for
 * text-only fallback paths.
 *
 * Extracted from vercel-ai-streaming.ts to share across callers
 * (e.g., orchestrator callLLM paths).
 */

// ─── Known-good FC models ─────────────────────────────────────────────

/**
 * Models that are explicitly known to support function calling well.
 * Used to override conservative SDK capability detection and force
 * tool usage on.
 */
export const knownGoodFCModels: string[] = [
  'mistral-large-latest',
  'mistral-large-2411',
  'mistral-large-2407',
  'mistral-medium-latest',
  'mistral-small-latest',
  'gpt-4',
  'gpt-3.5',
  'claude-3',
  'claude-sonnet',
  'claude-opus',
  'gemini-1.5',
  'gemini-2.0',
];

// ─── FC-GATE Positive Cache (Bug #3) ───────────────────────────────────

/**
 * Cache of provider/model pairs that have successfully used function calling.
 * Key format: "provider:model" (lowercase).
 * Value: { successCount, lastSuccessAt, toolCallCount }
 *
 * This cache allows us to skip the two-phase strategy for models that have
 * already demonstrated successful tool use in this process lifetime.
 * Cleared on 429/provider rotation to avoid false positives after quota reset.
 */
interface FCSuccessEntry {
  successCount: number;
  lastSuccessAt: number;
  toolCallCount: number;
}

const fcSuccessCache = new Map<string, FCSuccessEntry>();

/**
 * Record a successful function-calling result for a provider/model.
 * Call this when a model successfully invokes tools.
 */
export function recordFCSuccess(provider: string, modelName: string, toolCallCount: number = 1): void {
  const normalizedToolCallCount =
    Number.isFinite(toolCallCount) && toolCallCount > 0
      ? Math.floor(toolCallCount)
      : 1;
  const key = `${provider.toLowerCase()}:${modelName.toLowerCase()}`;
  const existing = fcSuccessCache.get(key);
  if (existing) {
    existing.successCount++;
    existing.lastSuccessAt = Date.now();
    existing.toolCallCount += normalizedToolCallCount;
  } else {
    fcSuccessCache.set(key, {
      successCount: 1,
      lastSuccessAt: Date.now(),
      toolCallCount: normalizedToolCallCount,
    });
  }
}

/**
 * Check if a provider/model has previously demonstrated successful FC.
 * Returns the entry if found, undefined otherwise.
 */
export function getFCSuccessCache(provider: string, modelName: string): FCSuccessEntry | undefined {
  const key = `${provider.toLowerCase()}:${modelName.toLowerCase()}`;
  return fcSuccessCache.get(key);
}

/**
 * Clear the FC success cache for a specific provider (e.g., after 429).
 * Call this when a provider rotates or hits rate limits.
 */
export function clearFCSuccessCacheForProvider(provider: string): void {
  const prefix = `${provider.toLowerCase()}:`;
  for (const key of fcSuccessCache.keys()) {
    if (key.startsWith(prefix)) {
      fcSuccessCache.delete(key);
    }
  }
}

/**
 * Clear the entire FC success cache.
 */
export function clearFCSuccessCache(): void {
  fcSuccessCache.clear();
}

/**
 * Get the size of the FC success cache (for telemetry).
 */
export function getFCSuccessCacheSize(): number {
  return fcSuccessCache.size;
}

// ─── Compatibility checks ─────────────────────────────────────────────

/**
 * Check whether `modelName` is in the known-good function-calling list.
 * Uses substring matching so partial names (e.g. "gpt-4-turbo") match.
 */
export function isKnownGoodFC(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return knownGoodFCModels.some(m => lower.includes(m.toLowerCase()));
}

/**
 * Models (by substring) that are known NOT to support FC at NVIDIA NIM.
 *
 * When these models receive tool-call schemas, NVIDIA NIM returns a 400 error
 * with "DEGRADED function cannot be invoked".
 */
const nonFCModels = [
  'google/gemma-3-27b-it',
  'google/gemma-3-12b-it',
  'google/gemma-3-4b-it',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.3-70b-instruct',
  'mistral-small-latest',
  'mistral-small-2402',
];

/**
 * Determine whether tools should be stripped for a given provider/model.
 *
 * Returns `true` when the model is known to reject function-calling
 * schemas (e.g. NVIDIA NIM 400 errors, Mistral Small flakiness,
 * GitHub Copilot schema rejection).
 *
 * @param provider   - Lowercase provider identifier (e.g. "mistral", "nvidia")
 * @param modelName  - Model name as returned by the provider
 * @returns          - `true` if tools should be stripped
 */
export function shouldStripTools(provider: string, modelName: string): boolean {
  const lowerProvider = provider.toLowerCase();
  const lowerModel = modelName.toLowerCase();

  // NVIDIA: some models return 400 for tool calls
  if (lowerProvider === 'nvidia') {
    return nonFCModels.some(m => lowerModel.includes(m));
  }

  // Mistral Small: unreliable FC unless explicitly known-good
  if (lowerProvider === 'mistral' && /mistral-small/.test(lowerModel)) {
    return !isKnownGoodFC(modelName);
  }

  // GitHub Copilot (via ninerouter): rejects tool schemas entirely
  if (lowerProvider === 'ninerouter' && lowerModel.startsWith('gh/')) {
    return true;
  }

  return false;
}

/**
 * Build a sentence instructing the model to respond in plain text
 * (no tool calls / structured output).
 *
 * Used as a system-level override when tools must be stripped.
 */
export function getTextModeInstructions(): string {
  return [
    'Respond in plain text only. Do not use any function calls, tool calls,',
    'or structured output formats. Provide your answer directly as natural',
    'language without any markup or JSON.',
  ].join(' ');
}
