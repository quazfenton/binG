/**
 * Mistral Quota Manager
 * 
 * Tracks and manages API usage and quotas.
 * Additive module that provides usage monitoring and enforcement.
 * 
 * Features:
 * - Usage tracking
 * - Monthly quota enforcement
 * - Usage statistics
 * - Quota reset management
 */

export interface UsageRecord {
  timestamp: number
  sandboxId: string
  conversationId?: string
  executionCount: number
  tokenUsage?: {
    prompt: number
    completion: number
    total: number
  }
}

export interface QuotaUsage {
  currentUsage: number
  quota: number
  remaining: number
  resetDate: Date
  percentageUsed: number
}

export interface QuotaConfig {
  /** Monthly quota limit */
  monthlyQuota: number
  /** Enable quota tracking */
  enabled: boolean
  /** Warning threshold (percentage) */
  warningThreshold: number
  /** Critical threshold (percentage) */
  criticalThreshold: number
}

const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  monthlyQuota: 1000,
  enabled: true,
  warningThreshold: 80,
  criticalThreshold: 95,
}

export class MistralQuotaManager {
  private usageRecords: Map<string, UsageRecord> = new Map()
  private config: QuotaConfig
  private quotaResetDate: Date

  constructor(config?: Partial<QuotaConfig>) {
    this.config = { ...DEFAULT_QUOTA_CONFIG, ...config }
    this.quotaResetDate = this.getNextMonthStart()
  }

  /**
   * Record session start
   */
  async recordSessionStart(sandboxId: string): Promise<{
    allowed: boolean
    reason?: string
    usage?: QuotaUsage
  }> {
    if (!this.config.enabled) {
      return { allowed: true }
    }

    // Check quota
    const usage = await this.getCurrentMonthUsage()
    
    if (usage.currentUsage >= usage.quota) {
      return {
        allowed: false,
        reason: 'Monthly quota exceeded',
        usage,
      }
    }

    // Check thresholds
    if (usage.percentageUsed >= this.config.criticalThreshold) {
      console.warn(
        `[MistralQuotaManager] Critical quota usage: ${usage.percentageUsed.toFixed(1)}%`
      )
    } else if (usage.percentageUsed >= this.config.warningThreshold) {
      console.warn(
        `[MistralQuotaManager] Warning: ${usage.percentageUsed.toFixed(1)}% of monthly quota used`
      )
    }

    return {
      allowed: true,
      usage,
    }
  }

  /**
   * Record code execution
   */
  async recordExecution(
    sandboxId: string,
    conversationId?: string,
    tokenUsage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
    }
  ): Promise<void> {
    const record = this.usageRecords.get(sandboxId) || {
      timestamp: Date.now(),
      sandboxId,
      executionCount: 0,
    }

    record.executionCount++
    record.timestamp = Date.now()
    record.conversationId = conversationId

    if (tokenUsage) {
      record.tokenUsage = {
        prompt: tokenUsage.prompt_tokens || 0,
        completion: tokenUsage.completion_tokens || 0,
        total: tokenUsage.total_tokens || 0,
      }
    }

    this.usageRecords.set(sandboxId, record)
  }

  /**
   * Record session end
   */
  async recordSessionEnd(sandboxId: string): Promise<void> {
    this.usageRecords.delete(sandboxId)
  }

  /**
   * Get current month usage
   */
  async getCurrentMonthUsage(): Promise<QuotaUsage> {
    const now = Date.now()
    let totalExecutions = 0
    let totalTokens = 0

    // Sum all executions this month
    for (const record of this.usageRecords.values()) {
      if (record.timestamp >= this.quotaResetDate.getTime()) {
        totalExecutions += record.executionCount
        if (record.tokenUsage) {
          totalTokens += record.tokenUsage.total
        }
      }
    }

    const remaining = Math.max(0, this.config.monthlyQuota - totalExecutions)
    const percentageUsed = (totalExecutions / this.config.monthlyQuota) * 100

    return {
      currentUsage: totalExecutions,
      quota: this.config.monthlyQuota,
      remaining,
      resetDate: this.quotaResetDate,
      percentageUsed,
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(): Promise<{
    currentUsage: QuotaUsage
    totalExecutions: number
    totalTokens: number
    activeSessions: number
    averageExecutionsPerDay: number
  }> {
    const currentUsage = await this.getCurrentMonthUsage()
    
    let totalTokens = 0
    for (const record of this.usageRecords.values()) {
      if (record.tokenUsage) {
        totalTokens += record.tokenUsage.total
      }
    }

    // Calculate average per day
    const daysInMonth = new Date(
      this.quotaResetDate.getFullYear(),
      this.quotaResetDate.getMonth(),
      0
    ).getDate()
    const averagePerDay = currentUsage.currentUsage / daysInMonth

    return {
      currentUsage,
      totalExecutions: currentUsage.currentUsage,
      totalTokens,
      activeSessions: this.usageRecords.size,
      averageExecutionsPerDay: averagePerDay,
    }
  }

  /**
   * Check if quota is exceeded
   */
  async isQuotaExceeded(): Promise<boolean> {
    const usage = await this.getCurrentMonthUsage()
    return usage.currentUsage >= usage.quota
  }

  /**
   * Get remaining quota
   */
  async getRemainingQuota(): Promise<number> {
    const usage = await this.getCurrentMonthUsage()
    return usage.remaining
  }

  /**
   * Get quota percentage used
   */
  async getPercentageUsed(): Promise<number> {
    const usage = await this.getCurrentMonthUsage()
    return usage.percentageUsed
  }

  /**
   * Reset usage (for testing/admin)
   */
  resetUsage(): void {
    this.usageRecords.clear()
    this.quotaResetDate = this.getNextMonthStart()
  }

  /**
   * Update quota configuration
   */
  updateConfig(config: Partial<QuotaConfig>): void {
    this.config = { ...this.config, ...config }
    
    if (config.monthlyQuota !== undefined) {
      this.config.monthlyQuota = config.monthlyQuota
    }
  }

  /**
   * Get next month start date
   */
  private getNextMonthStart(): Date {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 1)
  }
}

/**
 * Usage reporter for external monitoring
 */
export class UsageReporter {
  private quotaManager: MistralQuotaManager
  private reportInterval: number
  private reportCallback?: (usage: QuotaUsage) => void

  constructor(
    quotaManager: MistralQuotaManager,
    options?: {
      reportIntervalMs?: number
      onReport?: (usage: QuotaUsage) => void
    }
  ) {
    this.quotaManager = quotaManager
    this.reportInterval = options?.reportIntervalMs || 3600000 // 1 hour
    this.reportCallback = options?.onReport
  }

  /**
   * Start periodic reporting
   */
  startReporting(): void {
    setInterval(async () => {
      const usage = await this.quotaManager.getCurrentMonthUsage()
      this.reportCallback?.(usage)
    }, this.reportInterval)
  }

  /**
   * Send usage to external service
   */
  async sendToExternalService(
    service: 'webhook' | 'custom',
    config: {
      url?: string
      headers?: Record<string, string>
      customHandler?: (usage: QuotaUsage) => Promise<void>
    }
  ): Promise<void> {
    const usage = await this.quotaManager.getCurrentMonthUsage()

    if (service === 'webhook' && config.url) {
      await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          usage,
        }),
      })
    } else if (service === 'custom' && config.customHandler) {
      await config.customHandler(usage)
    }
  }
}
