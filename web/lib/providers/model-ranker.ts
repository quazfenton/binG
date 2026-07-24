/**
 * Model Ranking Engine
 * 
 * Uses existing telemetry from:
 * - lib/management/resource-telemetry.ts (per-provider latency/failures)
 * - lib/chat/chat-request-logger.ts (per-model performance data)
 * - lib/api/response-router-telemetry.ts (OpenTelemetry integration)
 * 
 * Provides model selection for:
 * - Fast model selection for spec generation
 * - Provider routing optimization
 * - Latency-aware orchestration
 */

import { resourceTelemetry } from '@/lib/management/resource-telemetry'
import { chatRequestLogger } from '@/lib/chat/chat-request-logger'
import { toolCallTracker } from '@/lib/tools/tool-call-tracker'
import { getToolCallTelemetrySummary } from '@/lib/tools/tool-call-telemetry'
import { createLogger } from '@/lib/utils/logger'
import { PROVIDERS } from '@/lib/providers/llm-providers'

const logger = createLogger('Model:Ranker')

// Track which models have been tried for rotation
const triedModels = new Map<string, { lastTryTime: number; successCount: number; failCount: number }>()
const MODEL_ROTATION_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

/** Per-model telemetry snapshot from chatRequestLogger.getModelPerformance()
 *  enriched with tool call stats from toolCallTracker.getModelToolStats().
 *  Used by getModelForRotation's providerFilter path for accurate, model-level
 *  scoring (latency, failure rate, recency) instead of provider-level estimates.
 */
interface ModelTelemetry {
  avgLatency: number;
  failureRate: number;
  lastUpdated: number;
  totalCalls: number;
  successRate: number;
  toolCallScore?: number;
  toolSuccessRate?: number;
  avgToolScore?: number;
  toolCallTotalCalls?: number;
}
const _modelTelemetryCache = new Map<string, ModelTelemetry>();

/**
 * Rec #3 verifier: confirms the tool-call tracker has recorded at least one
 * tool call before model-ranker reads from it. caller's verdict signal:
 *
 *   - `true`  → tracker has at least one recorded tool call → telemetry reads
 *               are well-grounded.
 *   - `false` → tracker is empty (cold-start, post-flush, or test seed) OR
 *               the check threw (logged here so operators see why rotation
 *               fell back to provider-level estimates).
 *
 * Designed to be safe to call repeatedly; does NOT mutate tracker state. NOT
 * exported as a guard that callers should gate `getModelToolStats` on —
 * the cold-start race (first LLM call before any tool fires) would populate
 * the cache with zero tool stats, which is still meaningful for provider/
 * latency scoring. Use it purely as a log-verifier before reading telemetry.
 */
export async function hasRecordedTools(): Promise<boolean> {
  try {
    return await toolCallTracker.hasRecordedTools();
  } catch (error) {
    logger.warn('[ModelRanker] hasRecordedTools() check failed — rotation may run on empty telemetry', {
      error,
    });
    return false;
  }
}

/**
 * Refresh the per-model telemetry cache by fetching the latest performance data
 * and tool call stats. Call this periodically (e.g. every 5 minutes) to keep
 * data current, or call it in tests after seeding telemetry.
 *
 * Telemetry-read failures (both `getModelPerformance` and `getModelToolStats`)
 * propagate to the outer catch — no silent `.catch(() => [])`. Operators see
 * tracked-empty conditions via the explicit logger.warn calls below.
 */
export async function refreshModelTelemetryCache(): Promise<void> {
  try {
    // Rec #3 verifier: BEFORE attempting the cache-refresh, surface whether
    // the tool-call tracker has any recorded data. cold-start (no tool calls
    // yet) is expected — we log it warn-level so operators can correlate
    // downstream rotation decisions with the empty-tracker signal.
    void hasRecordedTools()
      .then((recorded) => {
        if (!recorded) {
          logger.warn(
            '[ModelRanker] refreshModelTelemetryCache: toolCallTracker empty — ' +
              'cache will be populated with provider-level estimates only',
          );
        }
      })
      .catch(() => {
        /* hasRecordedTools() already logs internally; do not double-log */
      });

    // Rec #3 fix: previously this line was `toolCallTracker.getModelToolStats(10).catch(() => [])`
    // which silently swallowed telemetry-read errors and made rotation blind
    // when tracker access failed. Removing the inner .catch(() => []) meant
    // any tracker rejection propagated to the outer catch — visible, but it
    // ALSO aborted the whole refresh, so the fresh `getModelPerformance()`
    // data was discarded and the cache stayed STALE on a tracker hiccup.
    // Compromise: a localized catch that logs the failure (operator visibility
    // preserved) and falls back to [] (so fresh provider-level performance
    // still refreshes the cache). Best of both — see review comment #11.
    const [performance, toolStats] = await Promise.all([
      chatRequestLogger.getModelPerformance(10),
      toolCallTracker.getModelToolStats(10).catch((error) => {
        logger.error('[ModelRanker] getModelToolStats failed — continuing without tool telemetry', { error });
        return [];
      }),
    ]);

    // Index tool stats by provider:model key for O(1) merge
    const toolStatsMap = new Map<string, { toolCallScore: number; toolSuccessRate: number; avgToolScore: number; toolCallTotalCalls: number }>();
    for (const ts of toolStats) {
      toolStatsMap.set(`${ts.provider}:${ts.model}`, {
        toolCallScore: ts.toolCallScore,
        toolSuccessRate: ts.toolSuccessRate,
        avgToolScore: ts.avgToolScore,
        toolCallTotalCalls: ts.totalToolCalls,
      });
    }

    _modelTelemetryCache.clear();
    for (const p of performance) {
      const key = `${p.provider}:${p.model}`;
      const toolData = toolStatsMap.get(key);
      _modelTelemetryCache.set(key, {
        avgLatency: p.avgLatency,
        failureRate: p.failureRate,
        lastUpdated: p.lastUpdated,
        totalCalls: p.totalCalls,
        successRate: p.successRate,
        toolCallScore: toolData?.toolCallScore,
        toolSuccessRate: toolData?.toolSuccessRate,
        avgToolScore: toolData?.avgToolScore,
        toolCallTotalCalls: toolData?.toolCallTotalCalls,
      });
    }
    // Supplement with in-memory tool call telemetry (from vercel-ai-streaming.ts path).
    // The in-memory store captures tool calls from the main streaming code path
    // that may not have been written to the SQLite-backed toolCallTracker yet.
    // Keys are model-only (no provider prefix), so we search cache entries by suffix.
    let inMemorySupplementCount = 0;
    try {
      const inMemoryTelemetry = getToolCallTelemetrySummary();
      for (const [memModel, summary] of Object.entries(inMemoryTelemetry)) {
        if (!summary || summary.totalCalls === 0) continue;
        // Search cache for entries matching this model name (any provider)
        for (const [cacheKey, cached] of _modelTelemetryCache) {
          if (!cacheKey.endsWith(`:${memModel}`)) continue;
          // Only override tool stats if in-memory has more recent/abundant data
          if (!cached.toolCallTotalCalls || summary.totalCalls > cached.toolCallTotalCalls) {
            const successRate = summary.successCount / summary.totalCalls;
            cached.toolSuccessRate = successRate;
            cached.toolCallTotalCalls = summary.totalCalls;
            cached.avgToolScore = successRate * 2 - 1; // Map 0-1 to -1..+1
            cached.toolCallScore = summary.successCount - summary.failureCount;
            inMemorySupplementCount++;
          }
        }
      }
    } catch { /* best-effort — in-memory telemetry is supplementary */ }

    logger.debug('Model telemetry cache refreshed', {
      modelCount: performance.length,
      toolStatsCount: toolStats.length,
      inMemorySupplementCount,
    });
  } catch (error) {
    // Rec #3 fix: was `catch { /* best-effort */ }` — silently dropped the
    // error. Now logs the failure visibly so operators see when telemetry
    // reads fail (SQLite down, tracker unavailable, etc.) and can correlate
    // downstream rotation quality drops with the actual cause.
    logger.error(
      '[ModelRanker] refreshModelTelemetryCache failed — rotation falls back to provider-level estimates',
      { error },
    );
  }
}

// Fire-and-forget: populate cache at module load without blocking the module's
// synchronous initialization path.
void refreshModelTelemetryCache();

// Periodic refresh every 5 minutes so the cache tracks changing telemetry
// (latency shifts, newly recorded failures, fresh tool call stats) without
// requiring each consumer to know about the refresh mechanism.
const TELEMETRY_CACHE_REFRESH_MS = 5 * 60 * 1000;
const _telemetryRefreshInterval = setInterval(
  () => void refreshModelTelemetryCache(),
  TELEMETRY_CACHE_REFRESH_MS,
);

/**
 * Stop the periodic telemetry cache refresh. Useful in tests to prevent the
 * interval from running after test teardown, and in environments where the
 * cache should only be refreshed on demand (e.g. serverless functions).
 *
 * After calling this, the cache can still be refreshed manually by calling
 * `refreshModelTelemetryCache()` directly.
 */
export function stopRefreshingModelTelemetryCache(): void {
  clearInterval(_telemetryRefreshInterval);
}

// Rate limit circuit breaker: track when a model/provider combo gets 429 errors
interface RateLimitState {
  last429Time: number
  consecutive429Count: number
}
const rateLimitedModels = new Map<string, RateLimitState>()
const RATE_LIMIT_COOLDOWN_MS = 60000 // 1 minute cooldown after rate limit
const RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD = 3 // Trip circuit breaker after 3 consecutive 429s

export function recordRateLimitError(provider: string, model: string): void {
  const key = `${provider}:${model}`
  const now = Date.now()
  const existing = rateLimitedModels.get(key)
  
  if (existing) {
    // If last 429 was within 30 seconds, increment consecutive count
    if (now - existing.last429Time < 30000) {
      existing.consecutive429Count++
    } else {
      // Reset if more than 30 seconds since last 429
      existing.consecutive429Count = 1
    }
    existing.last429Time = now
  } else {
    rateLimitedModels.set(key, { last429Time: now, consecutive429Count: 1 })
  }
  
  logger.warn('[RateLimit] Recorded 429 error', {
    provider,
    model,
    consecutive429Count: rateLimitedModels.get(key)?.consecutive429Count,
    circuitBreakerTripped: (rateLimitedModels.get(key)?.consecutive429Count || 0) >= RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD,
  })
}

export function isRateLimited(provider: string, model: string): boolean {
  const key = `${provider}:${model}`
  const state = rateLimitedModels.get(key)
  
  if (!state) return false
  
  const now = Date.now()
  // Check if still in cooldown period
  if (now - state.last429Time > RATE_LIMIT_COOLDOWN_MS) {
    // Cooldown expired, clear the entry
    rateLimitedModels.delete(key)
    return false
  }
  
  // If circuit breaker threshold reached, stay rate limited longer
  if (state.consecutive429Count >= RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD) {
    logger.warn('[RateLimit] Circuit breaker active', { provider, model, consecutive429Count: state.consecutive429Count })
    return true
  }
  
  return true
}

export function clearRateLimitState(provider: string, model: string): void {
  rateLimitedModels.delete(`${provider}:${model}`)
}

// Token limit tracking for 413 errors
interface TokenLimitState {
  maxTokens: number
  lastErrorTime: number
  errorCount: number
}
const modelTokenLimits = new Map<string, TokenLimitState>()

/**
 * Record token limit for a model (from 413 errors)
 */
export function recordModelTokenLimit(provider: string, model: string, tokenLimit: number): void {
  const key = `${provider}:${model}`
  const now = Date.now()
  const existing = modelTokenLimits.get(key)
  
  if (existing) {
    // Update with the most restrictive limit
    existing.maxTokens = Math.min(existing.maxTokens, tokenLimit)
    existing.lastErrorTime = now
    existing.errorCount++
  } else {
    modelTokenLimits.set(key, { maxTokens: tokenLimit, lastErrorTime: now, errorCount: 1 })
  }
  
  logger.warn('[TokenLimit] Recorded token limit for model', {
    provider,
    model,
    tokenLimit,
    errorCount: modelTokenLimits.get(key)?.errorCount,
  })
}

/**
 * Get token limit for a model (returns null if unknown)
 */
export function getModelTokenLimit(provider: string, model: string): number | null {
  const key = `${provider}:${model}`
  const state = modelTokenLimits.get(key)
  return state ? state.maxTokens : null
}

/**
 * Check if a model has insufficient token limit for the request
 */
export function hasInsufficientTokenLimit(provider: string, model: string, estimatedTokens: number): boolean {
  const limit = getModelTokenLimit(provider, model)
  if (!limit) return false
  
  // Add 10% buffer for safety
  const safeLimit = limit * 0.9
  return estimatedTokens > safeLimit
}

/**
 * Record context limit error for model classification
 */
export function recordModelContextLimitError(provider: string, model: string, tokenLimit: number): void {
  recordModelTokenLimit(provider, model, tokenLimit)
  
  // Also record as a failure for ranking purposes
  recordModelAttempt(provider, model, false)
  
  logger.info('[ModelClassification] Model marked as small-context', {
    provider,
    model,
    tokenLimit,
    classification: tokenLimit < 16000 ? 'small-context' : 'medium-context'
  })
}

export interface ModelStats {
  provider: string
  model: string
  avgLatency: number
  failureRate: number
  lastUpdated: number
  totalCalls: number
  successRate: number
  /** Cumulative tool call score: +1 per success, -1 per failure */
  toolCallScore?: number
  /** Tool call success rate (0-1) */
  toolSuccessRate?: number
  /** Average tool score per call (-1 to +1) */
  avgToolScore?: number
  /** Total tool call attempts (distinct from LLM totalCalls) */
  toolCallTotalCalls?: number
  /** Maximum token limit (from 413 errors) */
  maxTokens?: number
  /** Model classification for use case selection */
  classification?: 'small-context' | 'medium-context' | 'large-context' | 'fast' | 'reliable' | 'planner'
}

export interface RankedModel extends ModelStats {
  score: number
  rank: number
  /**
   * True when this pick was synthesised by the graceful-degraded fallback path
   * (no live telemetry, no healthy candidate available). Callers can use this
   * flag to attach a "best-effort" marker in their 200 response so the UI can
   * communicate the degraded state to the user. Optional — undefined means a
   * normal ranker pick.
   */
  degraded?: boolean
}

// Scoring configuration
const FAILURE_WEIGHT = 2.5
const STALENESS_PENALTY = 1.2
const MAX_AGE_MS = 1000 * 60 * 10 // 10 minutes
const LATENCY_WEIGHT = 0.6
const FAILURE_WEIGHT_SCORE = 0.4
const TOOL_WEIGHT = 1.0
const MIN_TOOL_CALLS_FOR_SCORING = 3

/**
 * Calculate composite score for a model
 * Lower score = better (faster + more reliable)
 * Models with negative scores (e.g., -10 for model-not-found) are permanently deprioritized.
 */
export function scoreModel(m: ModelStats): number {
  // Models with negative telemetry scores (model-not-found penalty) get a very high composite score
  // so they're effectively excluded from ranking
  if (m.failureRate < 0 || m.successRate < 0) {
    return Infinity; // Exclude from ranking entirely
  }

  const age = Date.now() - m.lastUpdated
  const staleFactor = age > MAX_AGE_MS ? STALENESS_PENALTY : 1

  // Normalize latency (0-1 scale, assuming max 10s latency)
  const normalizedLatency = Math.min(m.avgLatency / 10000, 1)

  // Base score: lower is better
  let score = (
    (normalizedLatency * LATENCY_WEIGHT) +
    (m.failureRate * FAILURE_WEIGHT)
  ) * staleFactor;

  // Tool call track record: subtract avgToolScore * TOOL_WEIGHT so models
  // with strong tool success are preferred (avgToolScore = +1 → -1.0 bonus,
  // avgToolScore = -1 → +1.0 penalty). Confidence scales with the number of
  // tool call attempts (capped at 10) to avoid over-weighting sparse data.
  if (m.avgToolScore !== undefined && m.toolCallTotalCalls !== undefined &&
      m.toolCallTotalCalls >= MIN_TOOL_CALLS_FOR_SCORING) {
    const toolConfidence = Math.min(m.toolCallTotalCalls / 10, 1);
    score -= m.avgToolScore * TOOL_WEIGHT * toolConfidence;
  }

  return score;
}

/**
 * Rank models by score (lower is better)
 */
export function rankModels(models: ModelStats[]): RankedModel[] {
  return models
    .map(m => ({ ...m, score: scoreModel(m) }))
    .sort((a, b) => a.score - b.score)
    .map((m, index) => ({ ...m, rank: index + 1 }))
}

/**
 * Get fastest model from ranked list
 * 
 * @param models - Model stats to rank
 * @param minLatency - Minimum latency in ms (filters out slow models)
 * @returns Fastest model or null
 */
export function getFastestModel(models: ModelStats[], minLatency?: number): RankedModel | null {
  let filtered = models
  
  // Filter out models with no data
  filtered = filtered.filter(m => m.totalCalls > 0)
  
  // Filter by minimum latency if specified
  if (minLatency) {
    filtered = filtered.filter(m => m.avgLatency <= minLatency)
  }
  
  const ranked = rankModels(filtered)
  return ranked.length > 0 ? ranked[0] : null
}

/**
 * Get best model for a specific use case
 * 
 * @param models - Model stats to rank
 * @param useCase - Use case: speed, reliability, or balanced
 * @param minCalls - Minimum calls required for statistical significance
 * @returns Best model or null
 */
export function getBestModelForUseCase(
  models: ModelStats[],
  useCase: 'speed' | 'reliability' | 'balanced',
  minCalls: number = 3
): RankedModel | null {
  // Filter out models with insufficient data
  let filtered = models.filter(m => m.totalCalls >= minCalls)
  
  if (filtered.length === 0) {
    // Fallback to all models if none meet threshold
    filtered = models
  }
  
  let ranked: RankedModel[]

  switch (useCase) {
    case 'speed':
      // Weight latency more heavily
      ranked = filtered
        .map(m => ({ ...m, score: scoreModel(m) }))
        .sort((a, b) => a.avgLatency - b.avgLatency)
        .map((m, index) => ({ ...m, rank: index + 1 }))
      break

    case 'reliability':
      // Weight failure rate more heavily
      ranked = filtered
        .map(m => ({ ...m, score: m.failureRate }))
        .sort((a, b) => a.score - b.score)
        .map((m, index) => ({ ...m, rank: index + 1 }))
      break
      
    case 'balanced':
    default:
      ranked = rankModels(filtered)
      break
  }
  
  return ranked.length > 0 ? ranked[0] : null
}

/**
 * Get model performance stats from chat request logger
 */
async function getModelStatsFromChatLogger(): Promise<ModelStats[]> {
  try {
    // Use the new getModelPerformance method
    const performance = await chatRequestLogger.getModelPerformance(10)

    // Get tool call stats
    const toolStats = await toolCallTracker.getModelToolStats(10)
    const toolStatsMap = new Map<string, { toolCallScore: number; toolSuccessRate: number; avgToolScore: number; toolCallTotalCalls: number }>()
    for (const ts of toolStats) {
      toolStatsMap.set(`${ts.provider}:${ts.model}`, {
        toolCallScore: ts.toolCallScore,
        toolSuccessRate: ts.toolSuccessRate,
        avgToolScore: ts.avgToolScore,
        toolCallTotalCalls: ts.totalToolCalls,
      })
    }

    return performance.map(p => {
      const key = `${p.provider}:${p.model}`
      const toolData = toolStatsMap.get(key)
      return {
        provider: p.provider,
        model: p.model,
        avgLatency: p.avgLatency,
        failureRate: p.failureRate,
        lastUpdated: p.lastUpdated,
        totalCalls: p.totalCalls,
        successRate: p.successRate,
        toolCallScore: toolData?.toolCallScore,
        toolSuccessRate: toolData?.toolSuccessRate,
        avgToolScore: toolData?.avgToolScore,
        toolCallTotalCalls: toolData?.toolCallTotalCalls,
      }
    })
  } catch (error) {
    logger.error('Failed to get model stats from chat logger', error)
    return []
  }
}

/**
 * Get provider-level stats from resource telemetry
 */
function getProviderStatsFromTelemetry(): ModelStats[] {
  try {
    const scores = resourceTelemetry.getAllScores()
    
    return scores.map(score => ({
      provider: score.provider,
      model: `${score.provider}:auto`, // Provider-level, not model-specific
      avgLatency: Math.round(score.avgLatencyMs),
      failureRate: score.provider === 'unknown' ? 0 : score.failureRate,
      lastUpdated: Date.now(),
      totalCalls: score.totalCalls,
      successRate: 1 - score.failureRate,
    }))
  } catch (error) {
    logger.error('Failed to get provider stats from telemetry', error)
    return []
  }
}

/**
 * Add ALL configured models to the stats pool, giving untested models a chance
 */
function addConfiguredModels(modelMap: Map<string, ModelStats>): void {
  // Safety check: PROVIDERS must exist
  if (!PROVIDERS || typeof PROVIDERS !== 'object') {
    logger.warn('PROVIDERS not available, cannot add configured models')
    return
  }
  
  // Iterate through all providers and their models
  for (const [providerName, providerConfig] of Object.entries(PROVIDERS)) {
    if (!providerConfig?.models || !Array.isArray(providerConfig.models)) continue
    
    for (const modelName of providerConfig.models) {
      const modelId = typeof modelName === 'string' ? modelName : modelName.id;
      const key = `${providerName}:${modelId}`
      
      // Only add if not already in the map (telemetry data takes precedence)
      if (!modelMap.has(key)) {
        // Check if this provider has an API key configured
        const hasApiKey = isProviderConfiguredForTelemetry(providerName)
        
        if (hasApiKey) {
          // Add untested model with neutral stats (gives it a chance)
          modelMap.set(key, {
            provider: providerName,
            model: modelId,
            avgLatency: 2000, // neutral latency estimate
            failureRate: 0, // optimistic default
            lastUpdated: Date.now(),
            totalCalls: 0, // untested
            successRate: 1, // optimistic
          })
        }
      }
    }
  }
}

/**
 * Check if a provider is configured (has API key) for telemetry purposes.
 *
 * Uses a hardcoded map of known provider API key env vars. When a new provider
 * is added to PROVIDERS in llm-providers.ts, its API key env var must also be
 * added here so its models are visible to the rotation/fallback system.
 *
 * Without this, untested models from unlisted providers are invisible to
 * addConfiguredModels() and getModelForRotation(), creating a feedback loop
 * where the only models that get ranked are the ones that've already been used.
 */
function isProviderConfiguredForTelemetry(provider: string): boolean {
  const apiKeyEnvVars: Record<string, string> = {
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'google': 'GOOGLE_API_KEY',
    'mistral': 'MISTRAL_API_KEY',
    'openrouter': 'OPENROUTER_API_KEY',
    'chutes': 'CHUTES_API_KEY',
    'portkey': 'PORTKEY_API_KEY',
    'github': 'GITHUB_MODELS_API_KEY',
    'nvidia': 'NVIDIA_API_KEY',
    'groq': 'GROQ_API_KEY',
    'deepinfra': 'DEEPINFRA_API_KEY',
    'fireworks': 'FIREWORKS_API_KEY',
    'together': 'TOGETHER_API_KEY',
    'zen': 'ZEN_API_KEY',
    'ninerouter': 'NINEROUTER_API_KEY',
    'kiro': 'KIRO_API_KEY',
    'aihubmix': 'AIHUBMIX_API_KEY',
    'cloudflare': 'CLOUDFLARE_API_KEY',
    'cohere': 'COHERE_API_KEY',
    'replicate': 'REPLICATE_API_KEY',
    'antigravity': 'ANTIGRAVITY_API_KEY',
    'ollama': 'OLLAMA_API_KEY',
    'azure': 'AZURE_API_KEY',
    'vertex': 'VERTEX_API_KEY',
    'livekit': 'LIVEKIT_API_KEY',
    'pollinations': 'POLLINATIONS_API_KEY',
    'chatanywhere': 'CHATANYWHERE_API_KEY',
  }
  
  const key = provider.toLowerCase()

  // Special cases where a base URL alone is sufficient (no API key needed)
  if (key === 'ninerouter') {
    return !!process.env['NINEROUTER_API_KEY'] || !!process.env['NINEROUTER_BASE_URL']
  }

  const envVar = apiKeyEnvVars[key]
  return envVar ? !!process.env[envVar] : false
}

/**
 * Record model try attempt for rotation tracking
 */
export function recordModelAttempt(provider: string, model: string, success: boolean): void {
  const key = `${provider}:${model}`
  const now = Date.now()
  
  const existing = triedModels.get(key) || { lastTryTime: 0, successCount: 0, failCount: 0 }
  
  // Reset if outside rotation window
  if (now - existing.lastTryTime > MODEL_ROTATION_WINDOW_MS) {
    existing.successCount = 0
    existing.failCount = 0
  }
  
  existing.lastTryTime = now
  if (success) {
    existing.successCount++
  } else {
    existing.failCount++
  }
  
  triedModels.set(key, existing)
}

/**
 * Get next model for rotation (prefers untested/failed models)
 * FIX: Now shares the same provider iteration logic with addConfiguredModels() to avoid inconsistencies
 *
 * @param excludeProvider - If set, skip models from this provider
 * @param providerFilter - If set, ONLY return models from this provider (takes priority over excludeProvider)
 * @returns The selected provider+model pair, or null if none available
 */
export function getModelForRotation(excludeProvider?: string, providerFilter?: string): { provider: string; model: string } | null {
  const now = Date.now()
  
  // FIX: Use the same iteration logic as addConfiguredModels() to ensure consistency
  // Collect all untested or failed models
  const candidates: Array<{ key: string; provider: string; model: string; priority: number }> = []
  
  // Safety check: PROVIDERS must exist
  if (!PROVIDERS || typeof PROVIDERS !== 'object') {
    logger.warn('PROVIDERS not available, cannot get model for rotation')
    return null
  }
  
  for (const [providerName, providerConfig] of Object.entries(PROVIDERS)) {
    if (!providerConfig?.models || !Array.isArray(providerConfig.models)) continue
    if (providerFilter) {
      if (providerName !== providerFilter) continue
      // When filtering to a specific provider, skip the telemetry check —
      // the caller explicitly requested this provider, so it must be available
    } else {
      if (excludeProvider && providerName === excludeProvider) continue
      if (!isProviderConfiguredForTelemetry(providerName)) continue
    }
    
    for (const modelName of providerConfig.models) {
      const modelId = typeof modelName === 'string' ? modelName : modelName.id;
      const key = `${providerName}:${modelId}`
      
      // FIX: Check rate limit circuit breaker before including this model
      if (isRateLimited(providerName, modelId)) {
        logger.debug('Skipping rate-limited model in rotation', { provider: providerName, model: modelId })
        continue
      }
      
      const attempt = triedModels.get(key)
      
      // Prioritize untested models, then models with failures outside the window
      let priority = 100 // highest priority for untested
      
      if (attempt) {
        if (now - attempt.lastTryTime > MODEL_ROTATION_WINDOW_MS) {
          // Outside rotation window, give it another chance
          priority = 50
        } else {
          // Recently tried, lower priority
          priority = 10 - (attempt.failCount * 5) // More failures = lower priority
        }
      }
      
      candidates.push({ key, provider: providerName, model: modelId, priority })
    }
  }
  
  // When filtering to a specific provider, use model ranking scores (latency,
  // failure rate, recency) to pick the highest-ranked model. Otherwise use the
  // rotation priority system with random selection for cross-provider variety.
  let selected: { key: string; provider: string; model: string; priority: number } | undefined;

  if (providerFilter) {
    // Get provider-level telemetry for latency/failure data
    let providerLatency = 2000; // default neutral estimate
    try {
      const providerScores = resourceTelemetry.getAllScores();
      const telemetry = providerScores.find(s => s.provider === providerFilter);
      if (telemetry) {
        providerLatency = Math.round(telemetry.avgLatencyMs);
      }
    } catch { /* resourceTelemetry unavailable */ }

    // Build ModelStats for each candidate merging data from three sources
    // (priority order): 1. chat-request-logger telemetry cache (most accurate),
    // 2. in-memory rotation attempt tracking, 3. optimistic defaults for
    // untested models. Score with scoreModel() (lower = better).
    const scored = candidates.map(c => {
      const telemetry = _modelTelemetryCache.get(c.key);
      const attempt = triedModels.get(c.key);
      const totalAttempts = (attempt?.successCount || 0) + (attempt?.failCount || 0);

      return {
        ...c,
        score: scoreModel({
          provider: c.provider,
          model: c.model,
          // Per-model latency from chat logger, then provider-level, then 2000ms estimate
          avgLatency: telemetry?.avgLatency ?? providerLatency,
          // Per-model failure rate from chat logger, then rotation tracking, then 0
          failureRate: telemetry?.failureRate ?? (totalAttempts > 0 ? (attempt?.failCount || 0) / totalAttempts : 0),
          // Recency from chat logger, then rotation tracking, then now
          lastUpdated: telemetry?.lastUpdated ?? attempt?.lastTryTime ?? Date.now(),
          // Total calls from chat logger, then rotation tracking, then 0
          totalCalls: telemetry?.totalCalls ?? totalAttempts,
          // Success rate from chat logger, then rotation tracking, then 1
          successRate: telemetry?.successRate ?? (totalAttempts > 0 ? (attempt?.successCount || 0) / totalAttempts : 1),
          // Tool call stats from chat logger telemetry (undefined if unavailable)
          toolCallScore: telemetry?.toolCallScore,
          toolSuccessRate: telemetry?.toolSuccessRate,
          avgToolScore: telemetry?.avgToolScore,
          toolCallTotalCalls: telemetry?.toolCallTotalCalls,
        }),
      };
    });

    // Sort by score ascending (lower = better) — highest-ranked model first
    scored.sort((a, b) => a.score - b.score);
    selected = scored[0];
  } else {
    // Existing rotation behavior: sort by priority, then random within top tier
    candidates.sort((a, b) => b.priority - a.priority);
    const topCandidates = candidates.filter(c => c.priority === candidates[0]?.priority);
    selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
  }
  
  if (selected) {
    logger.debug('Selected model for rotation', {
      provider: selected.provider,
      model: selected.model,
      priority: selected.priority,
    })
  }
  
  return selected ? { provider: selected.provider, model: selected.model } : null
}

/**
 * Get combined model stats from all telemetry sources
 */
export async function getModelStatsFromTelemetry(): Promise<ModelStats[]> {
  const [chatLoggerStats, providerStats] = await Promise.all([
    getModelStatsFromChatLogger(),
    Promise.resolve(getProviderStatsFromTelemetry())
  ])
  
  // Combine and deduplicate - FIXED: Use provider+model key for all entries
  // This ensures we track MULTIPLE models per provider, not just one
  const modelMap = new Map<string, ModelStats>()
  
  // Add provider-level stats with a special suffix to distinguish from model-specific
  providerStats.forEach(stat => {
    const key = `${stat.provider}:${stat.model}`
    modelMap.set(key, stat)
  })
  
  // Add model-specific stats (override provider-level only for SAME model)
  // CRITICAL FIX: Use `${provider}:${model}` as key, not just `provider`
  chatLoggerStats.forEach(stat => {
    const key = `${stat.provider}:${stat.model}`
    modelMap.set(key, stat)
  })

  // Enrich with in-memory tool call telemetry (supplements DB-backed tracker).
  // Keys are model-only (no provider prefix), so search by suffix against
  // the modelMap's provider:model format.
  try {
    const inMemoryTelemetry = getToolCallTelemetrySummary()
    for (const [memModel, summary] of Object.entries(inMemoryTelemetry)) {
      if (!summary || summary.totalCalls === 0) continue;
      for (const [key, existing] of modelMap) {
        if (!key.endsWith(`:${memModel}`)) continue;
        // Only override tool stats if in-memory has more recent data
        if (!existing.toolSuccessRate || summary.totalCalls > (existing.toolCallTotalCalls || 0)) {
          const successRate = summary.successCount / summary.totalCalls
          existing.toolSuccessRate = successRate
          existing.toolCallTotalCalls = summary.totalCalls
          existing.avgToolScore = successRate * 2 - 1 // Map 0-1 to -1..+1
        }
      }
    }
  } catch { /* in-memory telemetry is best-effort */ }

  // CRITICAL FIX: Add ALL configured models to give untested models a chance
  addConfiguredModels(modelMap)

  const allStats = Array.from(modelMap.values())
  
  // CRITICAL: Filter out rate-limited models from the stats
  const activeStats = allStats.filter(stat => !isRateLimited(stat.provider, stat.model))
  
  logger.debug('Model stats retrieved', {
    totalModels: allStats.length,
    fromChatLogger: chatLoggerStats.length,
    fromProviderTelemetry: providerStats.length,
    rateLimitedModels: allStats.length - activeStats.length,
    rateLimitedKeys: Array.from(rateLimitedModels.keys()),
  })
  
  return activeStats
}

/**
 * Get recommended model for spec generation
 * Prioritizes speed + low cost
 */
export async function getSpecGenerationModel(): Promise<RankedModel | null> {
  const stats = await getModelStatsFromTelemetry()

  // Filter to fast models (under 3s average)
  const fastModels = stats.filter(m => m.avgLatency < 3000)

  if (fastModels.length === 0) {
    // Fallback to absolute fastest
    return getFastestModel(stats)
  }

  // Rank by speed within fast models
  return getBestModelForUseCase(fastModels, 'speed')
}

/**
 * Get recommended model for retry after empty response or failed tool calls.
 *
 * Selection strategy:
 * 1. Prefer models from DIFFERENT providers (not just different models) to avoid rate limits
 * 2. Give preference to UNTESTED models (totalCalls === 0) to discover new working options
 * 3. Among tested models, rank by tool performance if available
 * 4. Fall back to latency-based selection
 *
 * This ensures untested models get a chance instead of being stuck with only
 * models that have succeeded in the past.
 */
export async function getRetryModel(options?: {
  /** The model that just failed (empty response, failed tool calls) */
  failedModel?: string
  /** The provider that just failed */
  failedProvider?: string
  /** How far back to look for tool call data (minutes) */
  lookbackMinutes?: number
}): Promise<RankedModel | null> {
  const { failedModel, failedProvider, lookbackMinutes = 30 } = options || {}

  const stats = await getModelStatsFromTelemetry()

  // Priority 1: Untested models (totalCalls === 0) from DIFFERENT providers
  // This gives new models a chance to prove themselves
  const untestedModels = stats.filter(m => 
    m.totalCalls === 0 && m.provider !== failedProvider
  )
  
  if (untestedModels.length > 0) {
    // Use rotation logic to pick an untested model
    const rotationPick = getModelForRotation(failedProvider)
    if (rotationPick) {
      logger.info('Selected retry model (untested, different provider)', {
        selected: `${rotationPick.provider}:${rotationPick.model}`,
        failedProvider,
        failedModel,
        reason: 'untested model rotation',
      })
      return {
        provider: rotationPick.provider,
        model: rotationPick.model,
        avgLatency: 2000,
        failureRate: 0,
        lastUpdated: Date.now(),
        totalCalls: 0,
        successRate: 1,
        score: 0,
        rank: 1,
      }
    }
  }

  // Priority 2: Tested models with tool data, different provider
  const modelsWithToolData = stats.filter(m =>
    m.toolCallScore !== undefined && m.totalCalls > 0 && m.provider !== failedProvider
  )

  const MIN_TOOL_CALLS = 3
  const MIN_TOOL_SUCCESS_RATE = 0.5

  const qualifiedModels = modelsWithToolData.filter(m => {
    const toolCalls = m.toolCallTotalCalls || m.totalCalls
    if (toolCalls < MIN_TOOL_CALLS) return false
    if (m.toolSuccessRate !== undefined && m.toolSuccessRate < MIN_TOOL_SUCCESS_RATE) return false
    return true
  })

  if (qualifiedModels.length > 0) {
    const ranked = qualifiedModels
      .map(m => {
        // Weighted Ranking:
        // Score = (Tool Success * 0.5) - (Latency * 0.3) - (Failure Rate * 0.2)
        const toolScore = m.avgToolScore !== undefined ? m.avgToolScore : 0
        const normalizedLatency = Math.min(m.avgLatency / 10000, 1)
        
        // Final score: Higher is better
        const compositeScore = (toolScore * 0.5) - (normalizedLatency * 0.3) - (m.failureRate * 0.2)
        return { ...m, score: compositeScore }
      })
      .sort((a, b) => b.score - a.score)

    logger.info('Selected retry model (tested, tool-ranked, different provider)', {
      selected: `${ranked[0].provider}:${ranked[0].model}`,
      failedProvider,
      failedModel,
      toolScore: ranked[0].avgToolScore,
    })
    return { ...ranked[0], rank: 1 }
  }

  // Priority 3: Any tested model from different provider
  const testedDifferentProvider = stats.filter(m => 
    m.totalCalls > 0 && m.provider !== failedProvider
  )
  
  if (testedDifferentProvider.length > 0) {
    const result = getBestModelForUseCase(testedDifferentProvider, 'balanced', 1)
    if (result) {
      logger.info('Selected retry model (tested, different provider, latency-based)', {
        selected: `${result.provider}:${result.model}`,
        failedProvider,
      })
      return result
    }
  }

  // Priority 4: Untested model from SAME provider (different model)
  const untestedSameProvider = stats.filter(m => 
    m.totalCalls === 0 && m.provider === failedProvider && m.model !== failedModel
  )
  
  if (untestedSameProvider.length > 0) {
    const pick = untestedSameProvider[Math.floor(Math.random() * untestedSameProvider.length)]
    logger.info('Selected retry model (untested, same provider, different model)', {
      selected: `${pick.provider}:${pick.model}`,
      failedModel,
    })
    return { ...pick, score: 0, rank: 1 }
  }

  // Last resort: Use model rotation even if same provider
  const rotationPick = getModelForRotation()
  if (rotationPick) {
    logger.info('Selected retry model (rotation fallback)', {
      selected: `${rotationPick.provider}:${rotationPick.model}`,
      failedProvider,
    })
    return {
      provider: rotationPick.provider,
      model: rotationPick.model,
      avgLatency: 2000,
      failureRate: 0,
      lastUpdated: Date.now(),
      totalCalls: 0,
      successRate: 1,
      score: 0,
      rank: 1,
    }
  }

  // Final fallback: return ANY untested model to avoid getting stuck
  const anyUntested = stats.filter(m => m.totalCalls === 0 && m.model !== failedModel)
  if (anyUntested.length > 0) {
    const pick = anyUntested[Math.floor(Math.random() * anyUntested.length)]
    logger.warn('Selected retry model (final fallback, any untested)', {
      selected: `${pick.provider}:${pick.model}`,
      failedProvider,
    })
    return { ...pick, score: 0, rank: 1 }
  }

  // Absolute last resort: return the first tested model (different model)
  const anyDifferentModel = stats.filter(m => m.model !== failedModel)
  if (anyDifferentModel.length > 0) {
    const pick = anyDifferentModel[0]
    logger.warn('Selected retry model (absolute last resort)', {
      selected: `${pick.provider}:${pick.model}`,
    })
    return { ...pick, score: 0, rank: 1 }
  }

  logger.error('No alternative models available for retry - all models exhausted', {
    failedProvider,
    failedModel,
    statsCount: stats.length,
  })

  // Graceful degraded fallback: instead of returning null and forcing the route
  // to hard-503 the chat request, return the first configured provider's
  // default model marked with failureRate=1 / successRate=0 / score=Infinity.
  // This gives the route one more 200-attempt with a known-configured
  // provider/model pair. The `degraded: true` flag lets callers distinguish
  // this pick from a healthy ranker pick (e.g. for SSE metadata).
  //
  // Without this, the failure chain `getRetryModel() → null →
  // recordFallbackChainAttempt() → 503` is a dead end whenever every candidate
  // is rate-limited, untested, or its provider's API key is missing — the most
  // common root cause of the `POST /api/chat 503` symptom in multi-replica
  // deployments where in-memory rotation state can diverge.
  const degraded = findDegradedFallback(failedProvider)
  if (degraded) {
    logger.warn('Using degraded fallback model on retry (best-effort, no telemetry backing)', {
      provider: degraded.provider,
      model: degraded.model,
      failedProvider,
      failedModel,
      degraded: true,
    })
    return {
      provider: degraded.provider,
      model: degraded.model,
      avgLatency: 2000,
      failureRate: 1,                       // explicit signal: this is a low-quality pick
      lastUpdated: Date.now(),
      totalCalls: 0,                        // signal: not telemetry-backed
      successRate: 0,
      score: Infinity,                      // rank dead-last among candidates
      rank: Number.MAX_SAFE_INTEGER,
      degraded: true,
    }
  }

  // Truly unrecoverable: no provider in PROVIDERS has its API key set.
  logger.error('No configured providers available for degraded fallback; route will 503', {
    failedProvider,
    failedModel,
  })
  return null
}

/**
 * Graceful degraded-fallback pick: resolves `{ provider, model }` for the
 * degraded-fallback branch of `getRetryModel()`. Resolution order:
 *
 *   1. **Explicit env override**: if both `process.env.DEFAULT_PROVIDER` and
 *      `process.env.DEFAULT_MODEL` are set, validate that DEFAULT_PROVIDER is
 *      in PROVIDERS, that DEFAULT_MODEL is in that provider's models list, and
 *      that the provider passes `isProviderConfiguredForTelemetry` (its API key
 *      env var is set). If all three checks pass, return that pair verbatim.
 *      If any check fails, log a structured warn and fall through to auto
 *      discovery (the env override is "preferred but not authoritative").
 *
 *   2. **Auto discovery**: two-pass scan of PROVIDERS. Pass 1 prefers a
 *      provider other than `excludeProvider`. Pass 2 falls back to the
 *      excluded provider itself so single-provider deployments still resolve
 *      instead of returning null.
 *
 * @param excludeProvider - Optional. If set, the auto-discovery pass 1 skips
 *   this provider; pass 2 ignores the exclude so single-provider setups still
 *   resolve. The explicit env-override path is unaffected by this argument.
 * @returns `{ provider, model }`, or null if no provider has its API key set
 *   AND no env override is usable.
 */
function findDegradedFallback(excludeProvider?: string): { provider: string; model: string } | null {
  if (!PROVIDERS || typeof PROVIDERS !== 'object') return null

  // ---- Pass 0: explicit env override (DEFAULT_PROVIDER + DEFAULT_MODEL) ----
  const envProvider = process.env['DEFAULT_PROVIDER']?.trim()
  const envModel = process.env['DEFAULT_MODEL']?.trim()
  if (envProvider && envModel) {
    const providerConfig = (PROVIDERS as Record<string, any>)[envProvider]
    const modelList: unknown[] | undefined =
      providerConfig && Array.isArray(providerConfig.models) ? providerConfig.models : undefined
    const knownModel = modelList?.some((m: any) =>
      typeof m === 'string' ? m === envModel : m && typeof m === 'object' && m.id === envModel,
    )
    const providerConfigured = isProviderConfiguredForTelemetry(envProvider)
    if (knownModel && providerConfigured) {
      return { provider: envProvider, model: envModel }
    }
    logger.warn('[DegradedFallback] DEFAULT_PROVIDER/DEFAULT_MODEL env override rejected, falling back to auto discovery', {
      envProvider,
      envModel,
      providerConfigured,
      knownModel: !!knownModel,
    })
  }

  // ---- Pass 1 + 2: auto-discovery two-scan ----
  const pickFirst = (applyExclude: boolean): { provider: string; model: string } | null => {
    for (const [pName, pConfig] of Object.entries(PROVIDERS)) {
      if (!pConfig?.models || !Array.isArray(pConfig.models) || pConfig.models.length === 0) continue
      if (applyExclude && excludeProvider && pName === excludeProvider) continue
      if (!isProviderConfiguredForTelemetry(pName)) continue
      const first = pConfig.models[0]
      const modelId = typeof first === 'string' ? first : first.id
      if (!modelId) continue
      return { provider: pName, model: modelId }
    }
    return null
  }

  return pickFirst(true) ?? pickFirst(false)
}

/**
 * Clear old telemetry data
 */
export async function exportTelemetryData(): Promise<{
  timestamp: number
  models: ModelStats[]
  ranked: RankedModel[]
}> {
  const stats = await getModelStatsFromTelemetry()
  const ranked = rankModels(stats)
  
  return {
    timestamp: Date.now(),
    models: stats,
    ranked,
  }
}

/**
 * Clear old telemetry data
 */
export async function clearOldTelemetryData(daysToKeep: number = 7): Promise<void> {
  try {
    const db = (chatRequestLogger as any).db
    if (!db) return
    
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)
    
    const stmt = db.prepare(`
      DELETE FROM chat_request_logs
      WHERE created_at < ?
    `)
    
    const result = stmt.run(cutoffDate.toISOString())
    logger.info(`Cleaned up ${result.changes} old telemetry records`)
  } catch (error) {
    logger.error('Failed to clear old telemetry data', error)
  }
}
