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
import { toolCallTracker } from '@/lib/chat/tool-call-tracker'
import { getToolCallTelemetrySummary } from '@/lib/chat/tool-call-telemetry'
import { createLogger } from '@/lib/utils/logger'
import { PROVIDERS } from '@/lib/chat/llm-providers'

const logger = createLogger('Model:Ranker')

// Track which models have been tried for rotation
const triedModels = new Map<string, { lastTryTime: number; successCount: number; failCount: number }>()
const MODEL_ROTATION_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

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
}

// Scoring configuration
const FAILURE_WEIGHT = 2.5
const STALENESS_PENALTY = 1.2
const MAX_AGE_MS = 1000 * 60 * 10 // 10 minutes
const LATENCY_WEIGHT = 0.6
const FAILURE_WEIGHT_SCORE = 0.4

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

  // Calculate composite score
  // We want to maximize success and minimize latency, 
  // with failures acting as a massive penalty.
  const score = (
    (normalizedLatency * LATENCY_WEIGHT) +
    (m.failureRate * FAILURE_WEIGHT)
  ) * staleFactor;

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
 * Check if a provider is configured (has API key) for telemetry purposes
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
  }
  
  const envVar = apiKeyEnvVars[provider.toLowerCase()]
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
 */
export function getModelForRotation(excludeProvider?: string): { provider: string; model: string } | null {
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
    if (excludeProvider && providerName === excludeProvider) continue
    if (!isProviderConfiguredForTelemetry(providerName)) continue
    
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
  
  // Sort by priority (highest first) then shuffle within same priority for variety
  candidates.sort((a, b) => b.priority - a.priority)
  
  // Take a random model from the top candidates to add variety
  const topCandidates = candidates.filter(c => c.priority === candidates[0]?.priority)
  const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)]
  
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

  // Enrich with in-memory tool call telemetry (supplements DB-backed tracker)
  try {
    const inMemoryTelemetry = getToolCallTelemetrySummary()
    for (const [key, summary] of Object.entries(inMemoryTelemetry)) {
      const existing = modelMap.get(key)
      if (existing && summary.totalCalls > 0) {
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

  logger.error('No alternative models available for retry - all models exhausted')
  return null
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
