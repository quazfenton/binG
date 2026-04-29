/**
 * Advanced Tool Calling & Optimization
 *
 * Provides intelligent tool routing, cost optimization, and automatic provider
 * selection based on task type, success rates, and cost metrics.
 *
 * Features:
 * - Task-type based model routing
 * - Cost tracking and optimization
 * - Success rate monitoring
 * - Automatic provider selection
 * - Performance metrics
 *
 * @example
 * ```typescript
 * import { createOptimizedToolRouter } from './advanced-tool-calling'
 *
 * const router = createOptimizedToolRouter({
 *   providers: ['openai', 'anthropic', 'google'],
 *   optimizeFor: 'cost', // or 'speed', 'quality'
 *   trackMetrics: true,
 * })
 *
 * // Route based on task type
 * const model = router.getModelForTask('code_generation')
 *
 * // Track cost
 * router.recordCost('openai', 0.002, 1000, 500)
 *
 * // Get optimization recommendations
 * const recommendations = router.getOptimizationRecommendations()
 * ```
 */

export type TaskType =
  | 'code_generation'
  | 'code_review'
  | 'debugging'
  | 'documentation'
  | 'chat'
  | 'analysis'
  | 'creative'
  | 'math'
  | 'reasoning'
  | 'translation'
  | 'summarization'

export type OptimizationGoal = 'cost' | 'speed' | 'quality' | 'balanced'

export interface ProviderMetrics {
  name: string
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  averageLatencyMs: number
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  successRate: number
  averageCostPerRequest: number
  lastUsed?: Date
}

export interface TaskRoutingConfig {
  taskType: TaskType
  preferredProviders?: string[]
  maxCost?: number
  maxLatency?: number
  minSuccessRate?: number
}

export interface ModelRecommendation {
  provider: string
  model: string
  reason: string
  estimatedCost: number
  estimatedLatency: number
  confidence: number
}

export interface CostTracking {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  timestamp: Date
  taskType?: TaskType
}

export interface AdvancedToolRouter {
  /**
   * Get optimal model for a task type
   */
  getModelForTask(taskType: TaskType): ModelRecommendation

  /**
   * Get optimal provider based on optimization goal
   */
  getOptimalProvider(goal?: OptimizationGoal): string

  /**
   * Record a tool execution for metrics tracking
   */
  recordExecution(
    provider: string,
    success: boolean,
    latencyMs: number,
    cost?: number,
    inputTokens?: number,
    outputTokens?: number,
    taskType?: TaskType
  ): void

  /**
   * Get metrics for a provider
   */
  getProviderMetrics(provider: string): ProviderMetrics | null

  /**
   * Get all provider metrics
   */
  getAllMetrics(): Map<string, ProviderMetrics>

  /**
   * Record cost for a request
   */
  recordCost(
    provider: string,
    cost: number,
    inputTokens: number,
    outputTokens: number,
    taskType?: TaskType
  ): void

  /**
   * Get cost report
   */
  getCostReport(period?: 'day' | 'week' | 'month'): CostReport

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations(): OptimizationRecommendation[]

  /**
   * Reset metrics for a provider
   */
  resetMetrics(provider: string): void

  /**
   * Clear all metrics
   */
  clearMetrics(): void
}

export interface CostReport {
  period: string
  totalCost: number
  totalRequests: number
  averageCostPerRequest: number
  totalInputTokens: number
  totalOutputTokens: number
  costByProvider: Array<{ provider: string; cost: number; percentage: number }>
  costByTaskType: Array<{ taskType: TaskType; cost: number; percentage: number }>
  recommendations: string[]
}

export interface OptimizationRecommendation {
  type: 'cost_savings' | 'performance' | 'reliability'
  priority: 'high' | 'medium' | 'low'
  description: string
  potentialSavings?: number
  action: string
}

// Model pricing per 1K tokens (approximate, update as needed)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'o1-preview': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },

  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },

  // Google
  'gemini-pro': { input: 0.00025, output: 0.0005 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
}

// Task to model mapping (optimized for quality)
const TASK_MODEL_MAPPING: Record<TaskType, { provider: string; model: string; reason: string }> = {
  code_generation: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', reason: 'Claude excels at code generation with excellent understanding of context' },
  code_review: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', reason: 'Strong code analysis and attention to detail' },
  debugging: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    reason: 'Excellent problem-solving and error analysis',
  },
  documentation: {
    provider: 'google',
    model: 'gemini-1.5-pro',
    reason: 'Good natural language generation for documentation',
  },
  chat: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    reason: 'Natural conversation flow and context retention',
  },
  analysis: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    reason: 'Strong analytical capabilities',
  },
  creative: {
    provider: 'google',
    model: 'gemini-1.5-pro',
    reason: 'Creative and diverse output generation',
  },
  math: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    reason: 'Specialized reasoning model for mathematical tasks',
  },
  reasoning: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    reason: 'Advanced reasoning capabilities',
  },
  translation: {
    provider: 'google',
    model: 'gemini-1.5-pro',
    reason: 'Strong multilingual support',
  },
  summarization: {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    reason: 'Fast and accurate summarization',
  },
}

// Cost-optimized mappings
const COST_OPTIMAL_MAPPING: Record<TaskType, { provider: string; model: string }> = {
  code_generation: { provider: 'mistral', model: 'mistral-small-latest' },
  code_review: { provider: 'mistral', model: 'mistral-small-latest' },
  debugging: { provider: 'mistral', model: 'mistral-small-latest' },
  documentation: { provider: 'google', model: 'gemini-3-flash-preview' },
  chat: { provider: 'mistral', model: 'mistral-small-latest' },
  analysis: { provider: 'mistral', model: 'mistral-small-latest' },
  creative: { provider: 'google', model: 'gemini-3-flash-preview' },
  math: { provider: 'mistral', model: 'mistral-small-latest' },
  reasoning: { provider: 'mistral', model: 'mistral-small-latest' },
  translation: { provider: 'google', model: 'gemini-3-flash-preview' },
  summarization: { provider: 'google', model: 'gemini-3-flash-preview' },
}

// Speed-optimized mappings
const SPEED_OPTIMAL_MAPPING: Record<TaskType, { provider: string; model: string }> = {
  code_generation: { provider: 'mistral', model: 'mistral-small-latest' },
  code_review: { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
  debugging: { provider: 'mistral', model: 'mistral-small-latest' },
  documentation: { provider: 'google', model: 'gemini-3-flash-preview' },
  chat: { provider: 'mistral', model: 'mistral-small-latest' },
  analysis: { provider: 'mistral', model: 'mistral-small-latest' },
  creative: { provider: 'google', model: 'gemini-3-flash-preview' },
  math: { provider: 'mistral', model: 'mistral-small-latest' },
  reasoning: { provider: 'mistral', model: 'mistral-small-latest' },
  translation: { provider: 'google', model: 'gemini-3-flash-preview' },
  summarization: { provider: 'anthropic', model: 'claude-3-haiku-20240307' },
}

class AdvancedToolRouterImpl implements AdvancedToolRouter {
  private metrics: Map<string, ProviderMetrics> = new Map<string, ProviderMetrics>()
  private costHistory: CostTracking[] = []
  private optimizationGoal: OptimizationGoal
  private maxCostHistory: number

  constructor(
    optimizationGoal: OptimizationGoal = 'balanced',
    maxCostHistory: number = 10000
  ) {
    this.optimizationGoal = optimizationGoal
    this.maxCostHistory = maxCostHistory
  }

  getModelForTask(taskType: TaskType): ModelRecommendation {
    let mapping: Record<TaskType, { provider: string; model: string; reason?: string }>

    switch (this.optimizationGoal) {
      case 'cost':
        mapping = COST_OPTIMAL_MAPPING as any
        break
      case 'speed':
        mapping = SPEED_OPTIMAL_MAPPING as any
        break
      case 'quality':
      default:
        mapping = TASK_MODEL_MAPPING as any
        break
    }

    const selected = mapping[taskType] || TASK_MODEL_MAPPING.code_generation
    const pricing = MODEL_PRICING[selected.model] || { input: 0.001, output: 0.003 }

    // Adjust based on actual performance metrics
    const metrics = this.getProviderMetrics(selected.provider)
    let confidence = 0.8

    if (metrics) {
      if (metrics.successRate < 0.9) confidence -= 0.2
      if (metrics.averageLatencyMs > 5000) confidence -= 0.1
      if (metrics.averageCostPerRequest > 0.01) confidence -= 0.1
    }

    return {
      provider: selected.provider,
      model: selected.model,
      reason: selected.reason || 'Default selection',
      estimatedCost: pricing.input + pricing.output,
      estimatedLatency: this.estimateLatency(selected.provider),
      confidence: Math.max(0.5, confidence),
    }
  }

  private estimateLatency(provider: string): number {
    const metrics = this.getProviderMetrics(provider)
    if (metrics && metrics.averageLatencyMs > 0) {
      return metrics.averageLatencyMs
    }

    // Default estimates
    const defaults: Record<string, number> = {
      mistral: 800,
      google: 1000,
      anthropic: 2000,
      openai: 1500,
    }
    return defaults[provider] || 1500
  }

  getOptimalProvider(goal?: OptimizationGoal): string {
    const effectiveGoal = goal || this.optimizationGoal

    const allMetrics = Array.from(this.metrics.values())
    if (allMetrics.length === 0) {
      return 'mistral' // Default
    }

    switch (effectiveGoal) {
      case 'cost':
        return allMetrics
          .filter(m => m.successRate >= 0.9)
          .sort((a, b) => a.averageCostPerRequest - b.averageCostPerRequest)[0]?.name || 'mistral'

      case 'speed':
        return allMetrics
          .filter(m => m.successRate >= 0.9)
          .sort((a, b) => a.averageLatencyMs - b.averageLatencyMs)[0]?.name || 'mistral'

      case 'quality':
        return allMetrics
          .sort((a, b) => b.successRate - a.successRate)[0]?.name || 'mistral'

      case 'balanced':
      default:
        return allMetrics
          .map(m => ({
            name: m.name,
            score: m.successRate * 0.5 + (1 - m.averageCostPerRequest / 0.01) * 0.25 + (1 - m.averageLatencyMs / 5000) * 0.25,
          }))
          .sort((a, b) => b.score - a.score)[0]?.name || 'mistral'
    }
  }

  recordExecution(
    provider: string,
    success: boolean,
    latencyMs: number,
    cost?: number,
    inputTokens?: number,
    outputTokens?: number,
    taskType?: TaskType
  ): void {
    // Initialize metrics if needed
    if (!this.metrics.has(provider)) {
      this.metrics.set(provider, {
        name: provider,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatencyMs: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        successRate: 100,
        averageCostPerRequest: 0,
      })
    }

    const metrics = this.metrics.get(provider)!
    metrics.totalRequests++

    if (success) {
      metrics.successfulRequests++
    } else {
      metrics.failedRequests++
    }

    // Update averages
    metrics.averageLatencyMs =
      (metrics.averageLatencyMs * (metrics.totalRequests - 1) + latencyMs) / metrics.totalRequests

    if (cost !== undefined) {
      metrics.totalCost += cost
      metrics.averageCostPerRequest = metrics.totalCost / metrics.totalRequests
    }

    if (inputTokens !== undefined) {
      metrics.totalInputTokens += inputTokens
    }

    if (outputTokens !== undefined) {
      metrics.totalOutputTokens += outputTokens
    }

    metrics.successRate = (metrics.successfulRequests / metrics.totalRequests) * 100
    metrics.lastUsed = new Date()

    // Record cost history
    if (cost !== undefined) {
      this.recordCost(provider, cost, inputTokens || 0, outputTokens || 0, taskType)
    }
  }

  getProviderMetrics(provider: string): ProviderMetrics | null {
    return this.metrics.get(provider) || null
  }

  getAllMetrics(): Map<string, ProviderMetrics> {
    return new Map(this.metrics)
  }

  recordCost(
    provider: string,
    cost: number,
    inputTokens: number,
    outputTokens: number,
    taskType?: TaskType
  ): void {
    this.costHistory.push({
      provider,
      model: '', // Could be enhanced to track model
      inputTokens,
      outputTokens,
      cost,
      timestamp: new Date(),
      taskType,
    })

    // Prune old entries
    if (this.costHistory.length > this.maxCostHistory) {
      this.costHistory = this.costHistory.slice(-this.maxCostHistory)
    }
  }

  getCostReport(period?: 'day' | 'week' | 'month'): CostReport {
    const now = Date.now()
    const periodMs = {
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    }[period || 'month']

    const periodStart = now - periodMs
    const periodCosts = this.costHistory.filter(c => c.timestamp.getTime() > periodStart)

    const totalCost = periodCosts.reduce((sum, c) => sum + c.cost, 0)
    const totalRequests = periodCosts.length
    const totalInputTokens = periodCosts.reduce((sum, c) => sum + c.inputTokens, 0)
    const totalOutputTokens = periodCosts.reduce((sum, c) => sum + c.outputTokens, 0)

    // Cost by provider
    const costByProviderMap = new Map<string, number>()
    for (const cost of periodCosts) {
      costByProviderMap.set(cost.provider, (costByProviderMap.get(cost.provider) || 0) + cost.cost)
    }

    const costByProvider = Array.from(costByProviderMap.entries()).map(([provider, cost]) => ({
      provider,
      cost,
      percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
    }))

    // Cost by task type
    const costByTaskTypeMap = new Map<TaskType, number>()
    for (const cost of periodCosts) {
      if (cost.taskType) {
        costByTaskTypeMap.set(cost.taskType, (costByTaskTypeMap.get(cost.taskType) || 0) + cost.cost)
      }
    }

    const costByTaskType = Array.from(costByTaskTypeMap.entries()).map(([taskType, cost]) => ({
      taskType,
      cost,
      percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
    }))

    // Generate recommendations
    const recommendations: string[] = []

    if (totalCost > 10) {
      recommendations.push('Consider using cheaper models for non-critical tasks')
    }

    const expensiveProvider = costByProvider.find(p => p.percentage > 50)
    if (expensiveProvider) {
      recommendations.push(`Consider diversifying usage across providers (currently ${expensiveProvider.provider} is ${expensiveProvider.percentage.toFixed(0)}% of costs)`)
    }

    return {
      period: period || 'month',
      totalCost,
      totalRequests,
      averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      totalInputTokens,
      totalOutputTokens,
      costByProvider,
      costByTaskType,
      recommendations,
    }
  }

  getOptimizationRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = []

    // Check for cost savings opportunities
    const allMetrics = Array.from(this.metrics.values())

    for (const metrics of allMetrics) {
      if (metrics.averageCostPerRequest > 0.01 && metrics.totalRequests > 100) {
        recommendations.push({
          type: 'cost_savings',
          priority: 'high',
          description: `${metrics.name} has high average cost ($${metrics.averageCostPerRequest.toFixed(4)}/request)`,
          potentialSavings: metrics.totalCost * 0.3,
          action: 'Consider using gpt-4o-mini or claude-3-haiku for appropriate tasks',
        })
      }

      if (metrics.successRate < 90 && metrics.totalRequests > 50) {
        recommendations.push({
          type: 'reliability',
          priority: 'high',
          description: `${metrics.name} has low success rate (${metrics.successRate.toFixed(1)}%)`,
          action: 'Investigate failure patterns or consider alternative providers',
        })
      }

      if (metrics.averageLatencyMs > 5000 && metrics.totalRequests > 50) {
        recommendations.push({
          type: 'performance',
          priority: 'medium',
          description: `${metrics.name} has high latency (${metrics.averageLatencyMs.toFixed(0)}ms)`,
          action: 'Consider using faster models for time-sensitive tasks',
        })
      }
    }

    // Check for task-specific optimizations
    const taskCosts = new Map<TaskType, { total: number; count: number }>()
    for (const cost of this.costHistory) {
      if (cost.taskType) {
        const existing = taskCosts.get(cost.taskType) || { total: 0, count: 0 }
        existing.total += cost.cost
        existing.count++
        taskCosts.set(cost.taskType, existing)
      }
    }

    for (const [taskType, data] of taskCosts) {
      const avgCost = data.total / data.count
      if (avgCost > 0.005 && data.count > 50) {
        const costOptimal = COST_OPTIMAL_MAPPING[taskType]
        recommendations.push({
          type: 'cost_savings',
          priority: 'medium',
          description: `${taskType} tasks averaging $${avgCost.toFixed(4)}/request`,
          potentialSavings: data.total * 0.5,
          action: `Use ${costOptimal.model} for ${taskType} tasks`,
        })
      }
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })
  }

  resetMetrics(provider: string): void {
    this.metrics.delete(provider)
  }

  clearMetrics(): void {
    this.metrics.clear()
    this.costHistory = []
  }
}

/**
 * Create advanced tool router with optimization
 */
export function createOptimizedToolRouter(options?: {
  optimizationGoal?: OptimizationGoal
  trackMetrics?: boolean
  maxCostHistory?: number
}): AdvancedToolRouter {
  return new AdvancedToolRouterImpl(
    options?.optimizationGoal || 'balanced',
    options?.maxCostHistory || 10000
  )
}

/**
 * Calculate cost for a request
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) {
    // Default pricing if model not found
    return (inputTokens * 0.001 + outputTokens * 0.003) / 1000
  }

  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1000
}

/**
 * Get recommended model for task type
 */
export function getRecommendedModel(
  taskType: TaskType,
  optimizationGoal: OptimizationGoal = 'quality'
): { provider: string; model: string; reason: string } {
  let mapping: Record<TaskType, { provider: string; model: string; reason?: string }>

  switch (optimizationGoal) {
    case 'cost':
      return {
        ...COST_OPTIMAL_MAPPING[taskType],
        reason: 'Cost-optimized selection',
      }
    case 'speed':
      return {
        ...SPEED_OPTIMAL_MAPPING[taskType],
        reason: 'Speed-optimized selection',
      }
    case 'quality':
    default:
      return TASK_MODEL_MAPPING[taskType]
  }
}

/**
 * Compare providers for a task type
 */
export function compareProviders(taskType: TaskType): Array<{
  provider: string
  model: string
  estimatedCost: number
  estimatedLatency: number
  reason: string
}> {
  const quality = TASK_MODEL_MAPPING[taskType]
  const cost = COST_OPTIMAL_MAPPING[taskType]
  const speed = SPEED_OPTIMAL_MAPPING[taskType]

  const results = [
    {
      provider: quality.provider,
      model: quality.model,
      estimatedCost: MODEL_PRICING[quality.model]?.input + MODEL_PRICING[quality.model]?.output || 0.005,
      estimatedLatency: 2000,
      reason: quality.reason,
    },
    {
      provider: cost.provider,
      model: cost.model,
      estimatedCost: MODEL_PRICING[cost.model]?.input + MODEL_PRICING[cost.model]?.output || 0.001,
      estimatedLatency: 1500,
      reason: 'Cost-optimized',
    },
    {
      provider: speed.provider,
      model: speed.model,
      estimatedCost: MODEL_PRICING[speed.model]?.input + MODEL_PRICING[speed.model]?.output || 0.001,
      estimatedLatency: 1000,
      reason: 'Speed-optimized',
    },
  ]

  // Remove duplicates
  const unique = results.filter(
    (r, i, a) => i === a.findIndex(t => t.model === r.model)
  )

  return unique.sort((a, b) => a.estimatedCost - b.estimatedCost)
}
