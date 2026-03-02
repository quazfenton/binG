/**
 * Blaxel Traffic Splitting Manager
 * 
 * Implements canary deployments and traffic splitting between revisions.
 * Enables safe rollouts with automatic rollback on failure.
 * 
 * @see https://docs.blaxel.ai/Functions/Manage-functions Blaxel Function Management
 */

import { EventEmitter } from 'events';

/**
 * Traffic distribution configuration
 */
export interface TrafficDistribution {
  /**
   * Revision ID
   */
  revisionId: string;
  
  /**
   * Traffic percentage (0-100)
   */
  percentage: number;
  
  /**
   * Whether this is the primary revision
   */
  isPrimary?: boolean;
}

/**
 * Traffic splitting configuration
 */
export interface TrafficSplitConfig {
  /**
   * Function name
   */
  functionName: string;
  
  /**
   * Traffic distributions
   */
  distributions: TrafficDistribution[];
  
  /**
   * Whether to enable automatic rollback
   */
  autoRollback?: boolean;
  
  /**
   * Error threshold for auto rollback (percentage)
   */
  errorThreshold?: number;
  
  /**
   * Health check endpoint
   */
  healthCheckEndpoint?: string;
}

/**
 * Traffic splitting result
 */
export interface TrafficSplitResult {
  /**
   * Whether operation succeeded
   */
  success: boolean;
  
  /**
   * Current traffic distribution
   */
  distribution: TrafficDistribution[];
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Whether rollback was triggered
   */
  rollbackTriggered?: boolean;
}

/**
 * Revision health status
 */
export interface RevisionHealth {
  /**
   * Revision ID
   */
  revisionId: string;
  
  /**
   * Error rate (0-100)
   */
  errorRate: number;
  
  /**
   * Average latency in ms
   */
  avgLatency: number;
  
  /**
   * Requests per minute
   */
  rpm: number;
  
  /**
   * Whether revision is healthy
   */
  isHealthy: boolean;
}

/**
 * Blaxel Traffic Splitting Manager
 * 
 * Manages canary deployments and traffic distribution.
 */
export class BlaxelTrafficManager extends EventEmitter {
  private workspace: string;
  private apiKey: string;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private revisionHealth: Map<string, RevisionHealth> = new Map();
  private readonly DEFAULT_ERROR_THRESHOLD = 10; // 10% error rate

  constructor(workspace: string, apiKey?: string) {
    super();
    this.workspace = workspace;
    this.apiKey = apiKey || process.env.BLAXEL_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('[BlaxelTrafficManager] BLAXEL_API_KEY not set. Traffic splitting will use mock mode.');
    }
    
    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Split traffic between revisions
   * 
   * @param config - Traffic split configuration
   * @returns Traffic split result
   * 
   * @example
   * ```typescript
   * const result = await trafficManager.splitTraffic({
   *   functionName: 'my-function',
   *   distributions: [
   *     { revisionId: 'rev-1', percentage: 90, isPrimary: true },
   *     { revisionId: 'rev-2', percentage: 10 },
   *   ],
   *   autoRollback: true,
   *   errorThreshold: 5,
   * });
   * ```
   */
  async splitTraffic(config: TrafficSplitConfig): Promise<TrafficSplitResult> {
    // Validate distribution percentages
    const totalPercentage = config.distributions.reduce((sum, d) => sum + d.percentage, 0);
    if (totalPercentage !== 100) {
      return {
        success: false,
        distribution: [],
        error: `Traffic percentages must sum to 100, got ${totalPercentage}`,
      };
    }

    try {
      // In production, this would call Blaxel API
      // For now, simulate the API call
      await this.updateTrafficDistribution(config);

      // Store health tracking
      for (const dist of config.distributions) {
        if (!this.revisionHealth.has(dist.revisionId)) {
          this.revisionHealth.set(dist.revisionId, {
            revisionId: dist.revisionId,
            errorRate: 0,
            avgLatency: 0,
            rpm: 0,
            isHealthy: true,
          });
        }
      }

      const result: TrafficSplitResult = {
        success: true,
        distribution: config.distributions,
        rollbackTriggered: false,
      };

      this.emit('traffic-split', result);
      return result;
    } catch (error: any) {
      return {
        success: false,
        distribution: [],
        error: error.message,
      };
    }
  }

  /**
   * Perform canary deployment
   * 
   * @param config - Canary configuration
   * @returns Deployment result
   */
  async canaryDeploy(config: {
    functionName: string;
    newRevisionId: string;
    initialPercentage?: number;
    steps?: number;
    stepIntervalMs?: number;
    autoRollback?: boolean;
  }): Promise<TrafficSplitResult> {
    const {
      functionName,
      newRevisionId,
      initialPercentage = 5,
      steps = 10,
      stepIntervalMs = 60000, // 1 minute
      autoRollback = true,
    } = config;

    // Get current traffic distribution
    const currentDist = await this.getCurrentTrafficDistribution(functionName);
    const primaryRevision = currentDist.find(d => d.isPrimary)?.revisionId;

    if (!primaryRevision) {
      return {
        success: false,
        distribution: [],
        error: 'No primary revision found',
      };
    }

    // Gradually increase traffic to new revision
    for (let step = 1; step <= steps; step++) {
      const newPercentage = Math.min(initialPercentage * step, 100);
      const primaryPercentage = 100 - newPercentage;

      const result = await this.splitTraffic({
        functionName,
        distributions: [
          { revisionId: primaryRevision, percentage: primaryPercentage, isPrimary: true },
          { revisionId: newRevisionId, percentage: newPercentage },
        ],
        autoRollback,
      });

      if (!result.success) {
        return result;
      }

      // Check health before proceeding to next step
      if (autoRollback) {
        const health = await this.getRevisionHealth(newRevisionId);
        if (!health.isHealthy) {
          // Auto rollback
          await this.rollbackToRevision(functionName, primaryRevision);
          return {
            success: false,
            distribution: [
              { revisionId: primaryRevision, percentage: 100, isPrimary: true },
            ],
            error: `Canary failed health check at step ${step}/${steps}`,
            rollbackTriggered: true,
          };
        }
      }

      // Wait before next step
      if (step < steps) {
        await this.sleep(stepIntervalMs);
      }
    }

    // Canary successful - make new revision primary
    return await this.splitTraffic({
      functionName,
      distributions: [
        { revisionId: newRevisionId, percentage: 100, isPrimary: true },
      ],
      autoRollback: false,
    });
  }

  /**
   * Rollback to specific revision
   * 
   * @param functionName - Function name
   * @param revisionId - Revision ID to rollback to
   * @returns Traffic split result
   */
  async rollbackToRevision(functionName: string, revisionId: string): Promise<TrafficSplitResult> {
    const result = await this.splitTraffic({
      functionName,
      distributions: [
        { revisionId, percentage: 100, isPrimary: true },
      ],
      autoRollback: false,
    });

    if (result.success) {
      this.emit('rollback', { functionName, revisionId });
    }

    return result;
  }

  /**
   * Get current traffic distribution
   * 
   * @param functionName - Function name
   * @returns Current distribution
   */
  async getCurrentTrafficDistribution(functionName: string): Promise<TrafficDistribution[]> {
    // In production, this would fetch from Blaxel API
    // For now, return cached distribution
    const health = Array.from(this.revisionHealth.values());
    
    if (health.length === 0) {
      return [];
    }

    // Mock distribution
    return health.map((h, i) => ({
      revisionId: h.revisionId,
      percentage: i === 0 ? 100 : 0,
      isPrimary: i === 0,
    }));
  }

  /**
   * Get revision health status
   * 
   * @param revisionId - Revision ID
   * @returns Revision health
   */
  async getRevisionHealth(revisionId: string): Promise<RevisionHealth> {
    const health = this.revisionHealth.get(revisionId);
    
    if (!health) {
      return {
        revisionId,
        errorRate: 0,
        avgLatency: 0,
        rpm: 0,
        isHealthy: true,
      };
    }

    // Check if revision is healthy
    const errorThreshold = this.DEFAULT_ERROR_THRESHOLD;
    health.isHealthy = health.errorRate < errorThreshold;

    return health;
  }

  /**
   * Update revision health metrics
   * 
   * @param revisionId - Revision ID
   * @param metrics - Health metrics
   */
  updateRevisionHealth(revisionId: string, metrics: Partial<RevisionHealth>): void {
    const existing = this.revisionHealth.get(revisionId) || {
      revisionId,
      errorRate: 0,
      avgLatency: 0,
      rpm: 0,
      isHealthy: true,
    };

    const updated: RevisionHealth = {
      ...existing,
      ...metrics,
    };

    this.revisionHealth.set(revisionId, updated);
    this.emit('health-update', updated);
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Check health every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.checkRevisionHealth();
    }, 30000);
  }

  /**
   * Check revision health
   */
  private async checkRevisionHealth(): Promise<void> {
    // In production, this would fetch metrics from Blaxel API
    // For now, simulate health checks
    for (const [revisionId, health] of this.revisionHealth.entries()) {
      // Simulate metric updates
      const updatedHealth: RevisionHealth = {
        ...health,
        errorRate: Math.random() * 5, // Simulate 0-5% error rate
        avgLatency: 50 + Math.random() * 100, // Simulate 50-150ms latency
        rpm: Math.floor(Math.random() * 1000), // Simulate 0-1000 RPM
      };

      updatedHealth.isHealthy = updatedHealth.errorRate < this.DEFAULT_ERROR_THRESHOLD;

      this.revisionHealth.set(revisionId, updatedHealth);
      this.emit('health-check', updatedHealth);
    }
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Update traffic distribution (internal)
   */
  private async updateTrafficDistribution(config: TrafficSplitConfig): Promise<void> {
    // In production, this would call Blaxel API:
    // PATCH /functions/{functionName}/traffic
    // {
    //   "distributions": config.distributions
    // }
    
    // Simulate API delay
    await this.sleep(100);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all revision health
   */
  getAllRevisionHealth(): RevisionHealth[] {
    return Array.from(this.revisionHealth.values());
  }

  /**
   * Clear revision health data
   */
  clearHealthData(): void {
    this.revisionHealth.clear();
  }

  /**
   * Destroy traffic manager
   */
  destroy(): void {
    this.stopHealthMonitoring();
    this.clearHealthData();
    this.removeAllListeners();
  }
}

/**
 * Create traffic manager
 * 
 * @param workspace - Workspace name
 * @param apiKey - Optional API key
 * @returns Traffic manager
 */
export function createTrafficManager(workspace: string, apiKey?: string): BlaxelTrafficManager {
  return new BlaxelTrafficManager(workspace, apiKey);
}

/**
 * Quick canary deployment helper
 * 
 * @param workspace - Workspace name
 * @param config - Canary configuration
 * @returns Deployment result
 */
export async function quickCanaryDeploy(
  workspace: string,
  config: {
    functionName: string;
    newRevisionId: string;
    initialPercentage?: number;
    steps?: number;
  }
): Promise<TrafficSplitResult> {
  const manager = createTrafficManager(workspace);
  
  try {
    return await manager.canaryDeploy(config);
  } finally {
    manager.destroy();
  }
}

/**
 * Scaling presets for auto-scaling configuration
 */
export const ScalingPresets = {
  /**
   * Conservative scaling - slower response to load changes
   */
  conservative: (name: string) => ({
    name,
    minReplicas: 1,
    maxReplicas: 5,
    scaleUpThreshold: 70,
    scaleDownThreshold: 30,
    cooldownSeconds: 600,
    stabilizationWindowSeconds: 300,
  }),

  /**
   * Aggressive scaling - faster response to load changes
   */
  aggressive: (name: string) => ({
    name,
    minReplicas: 1,
    maxReplicas: 20,
    scaleUpThreshold: 50,
    scaleDownThreshold: 20,
    cooldownSeconds: 180,
    stabilizationWindowSeconds: 60,
  }),

  /**
   * Balanced scaling - moderate response to load changes
   */
  balanced: (name: string) => ({
    name,
    minReplicas: 2,
    maxReplicas: 10,
    scaleUpThreshold: 85,
    scaleDownThreshold: 15,
    cooldownSeconds: 300,
    stabilizationWindowSeconds: 120,
  }),
};
