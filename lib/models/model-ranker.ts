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
    
    return performance.map(p => ({
      provider: p.provider,
      model: p.model,
      avgLatency: p.avgLatency,
      failureRate: p.failureRate,
      lastUpdated: p.lastUpdated,
      totalCalls: p.totalCalls,
      successRate: p.successRate,
    }))
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
 * Export telemetry data for external ranking
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
