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
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('Model:Ranker')

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
 */
export function scoreModel(m: ModelStats): number {
  const age = Date.now() - m.lastUpdated
  const staleFactor = age > MAX_AGE_MS ? STALENESS_PENALTY : 1
  
  // Normalize latency (0-1 scale, assuming max 10s latency)
  const normalizedLatency = Math.min(m.avgLatency / 10000, 1)
  
  // Calculate composite score
  const score = (
    normalizedLatency * LATENCY_WEIGHT +
    m.failureRate * FAILURE_WEIGHT_SCORE
  ) * staleFactor
  
  return score
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
 * Get combined model stats from all telemetry sources
 */
export async function getModelStatsFromTelemetry(): Promise<ModelStats[]> {
  const [chatLoggerStats, providerStats] = await Promise.all([
    getModelStatsFromChatLogger(),
    Promise.resolve(getProviderStatsFromTelemetry())
  ])
  
  // Combine and deduplicate
  const modelMap = new Map<string, ModelStats>()
  
  // Add provider-level stats first
  providerStats.forEach(stat => {
    modelMap.set(stat.provider, stat)
  })
  
  // Add model-specific stats (override provider-level if available)
  chatLoggerStats.forEach(stat => {
    const key = `${stat.provider}:${stat.model}`
    modelMap.set(key, stat)
  })
  
  const allStats = Array.from(modelMap.values())
  
  logger.debug('Model stats retrieved', {
    totalModels: allStats.length,
    fromChatLogger: chatLoggerStats.length,
    fromProviderTelemetry: providerStats.length,
  })
  
  return allStats
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
 * Selection strategy (gated, not linear):
 * 1. Must have at least MIN_TOOL_CALLS data points for statistical significance
 * 2. Must be above MIN_TOOL_SUCCESS_RATE threshold (filters out broken models)
 * 3. Among qualified models, rank by avgToolScore (weighted) + latency fallback
 * 4. Prefer models different from the failed one (avoids repeating same failure)
 * 5. If no model has tool data, fall back to latency-based selection
 *
 * This prevents:
 * - Choosing a model with 1 successful read_file but 10 failed writes
 * - Always choosing the same expensive/rate-limited model
 * - Switching to a model that's known to be broken at tool calling
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

  // Filter to models with tool call data
  const modelsWithToolData = stats.filter(m =>
    m.toolCallScore !== undefined && m.totalCalls > 0
  )

  const MIN_TOOL_CALLS = 3 // Minimum tool calls for statistical significance
  const MIN_TOOL_SUCCESS_RATE = 0.5 // Must succeed at least 50% of tool calls

  // Gate 1: Filter to models with sufficient tool call data
  const qualifiedModels = modelsWithToolData.filter(m => {
    // Must have minimum tool calls — use toolCallTotalCalls if available, else derive from toolCallScore
    const toolCalls = m.toolCallTotalCalls || m.totalCalls
    if (toolCalls < MIN_TOOL_CALLS) return false

    // Must have acceptable tool success rate
    if (m.toolSuccessRate !== undefined && m.toolSuccessRate < MIN_TOOL_SUCCESS_RATE) return false

    return true
  })

  // Gate 2: If we have qualified models, rank by tool performance
  if (qualifiedModels.length > 0) {
    // Rank by avgToolScore (primary) then latency (secondary)
    const ranked = qualifiedModels
      .map(m => {
        // Composite score: 70% tool performance, 30% latency
        const toolScore = m.avgToolScore !== undefined ? m.avgToolScore : 0
        const normalizedLatency = Math.min(m.avgLatency / 10000, 1)
        const compositeScore = (toolScore * 0.7) - (normalizedLatency * 0.3)
        return { ...m, score: compositeScore }
      })
      .sort((a, b) => b.score - a.score)

    // Gate 3: Prefer models different from the failed one
    const nonFailedModels = ranked.filter(m =>
      m.model !== failedModel || m.provider !== failedProvider
    )

    // If there are non-failed qualified models, use the best one
    if (nonFailedModels.length > 0) {
      logger.info('Selected retry model (different from failed model)', {
        selected: `${nonFailedModels[0].provider}:${nonFailedModels[0].model}`,
        failed: `${failedProvider}:${failedModel}`,
        avgToolScore: nonFailedModels[0].avgToolScore,
        totalCalls: nonFailedModels[0].totalCalls,
      })
      return { ...nonFailedModels[0], rank: 1 }
    }

    // If the failed model is the only qualified one, still use it (it might have been a fluke)
    logger.info('Selected retry model (only qualified option is failed model)', {
      selected: `${ranked[0].provider}:${ranked[0].model}`,
      avgToolScore: ranked[0].avgToolScore,
    })
    return { ...ranked[0], rank: 1 }
  }

  // Gate 4: No tool data — fall back to latency-based selection
  logger.info('No tool call data available, falling back to latency-based selection')
  return getBestModelForUseCase(stats, 'balanced', 1)
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
