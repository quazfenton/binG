/**
 * Phase 8: Runtime Broker — Cost/Latency/Capacity-Aware Scheduling
 *
 * Replaces simple execution policies with a dynamic scheduler that evaluates
 * all available providers against cost, latency, capacity, health, quota,
 * and workspace affinity to select the optimal execution target.
 *
 * Design principles:
 * - Cost-aware: Estimates per-provider cost based on CPU, memory, GPU, duration
 * - Latency-aware: Uses real-time latency from LatencyTracker
 * - Capacity-aware: Checks quota limits, health scores, and resource telemetry
 * - Affinity-aware: Prefers providers already bound to a workspace (cache warmth)
 *
 * Architecture:
 *   User command → ExecutionRouter.classifyCommand()
 *     → RuntimeBroker.selectProvider() → best provider
 *     → SandboxOrchestrator.getSandbox() → execution
 *
 * @see lib/sandbox/provider-router.ts — ProviderRouter (task-type scoring)
 * @see lib/sandbox/sandbox-orchestrator.ts — Session lifecycle & affinity
 * @see lib/terminal/execution-router.ts — Command classification
 * @see lib/management/quota-manager.ts — Quota tracking
 * @see lib/management/resource-telemetry.ts — Real-time capacity
 * @see lib/sandbox/provider-health.ts — Health scoring
 */

import { createLogger } from '../utils/logger';
import type { SandboxProviderType } from './providers';
import { latencyTracker } from './provider-router';
import { providerHealthTracker } from './provider-health';
import { resourceTelemetry } from '../management/resource-telemetry';

// Lazy imports for singletons that may have circular dependencies
let _quotaManagerLoaded = false;
let _quotaManager: any = null;
async function getQuotaManager() {
  if (!_quotaManagerLoaded) {
    try {
      const mod = await import('../management/quota-manager');
      _quotaManager = mod.quotaManager;
    } catch {
      _quotaManager = null;
    }
    _quotaManagerLoaded = true;
  }
  return _quotaManager;
}

let _sandboxOrchestratorLoaded = false;
let _sandboxOrchestrator: any = null;
async function getSandboxOrchestrator() {
  if (!_sandboxOrchestratorLoaded) {
    try {
      const mod = await import('./sandbox-orchestrator');
      _sandboxOrchestrator = mod.sandboxOrchestrator;
    } catch {
      _sandboxOrchestrator = null;
    }
    _sandboxOrchestratorLoaded = true;
  }
  return _sandboxOrchestrator;
}

const logger = createLogger('RuntimeBroker');

// ============================================================================
// Cost Model
// ============================================================================

/**
 * Per-provider cost model.
 * Costs are estimated in USD based on publicly available pricing.
 * Updated as provider pricing changes.
 */
export interface ProviderCostModel {
  provider: SandboxProviderType | 'local';
  /** Cost per CPU-minute */
  cpuCostPerMinute: number;
  /** Cost per GB-memory-minute */
  memoryCostPerGBMinute: number;
  /** Cost per GPU-minute (0 if no GPU) */
  gpuCostPerMinute: number;
  /** Base cost per call (fixed overhead) */
  baseCostPerCall: number;
  /** Free tier credits (monthly, 0 if none) */
  freeTierCredits: number;
}

/**
 * Provider cost models based on publicly available pricing (2024-2025).
 * Costs are approximate — actual pricing depends on provider tiers and regions.
 */
export const PROVIDER_COST_MODELS: Record<string, ProviderCostModel> = {
  'daytona': {
    provider: 'daytona',
    cpuCostPerMinute: 0.0017,       // ~$0.10/hr
    memoryCostPerGBMinute: 0.00033,  // ~$0.02/hr per GB
    gpuCostPerMinute: 0.0083,        // ~$0.50/hr GPU
    baseCostPerCall: 0.0001,
    freeTierCredits: 10,
  },
  'e2b': {
    provider: 'e2b',
    cpuCostPerMinute: 0.0025,        // ~$0.15/hr
    memoryCostPerGBMinute: 0.0005,   // ~$0.03/hr per GB
    gpuCostPerMinute: 0.0075,        // ~$0.45/hr GPU
    baseCostPerCall: 0.0001,
    freeTierCredits: 25,
  },
  'codesandbox': {
    provider: 'codesandbox',
    cpuCostPerMinute: 0.002,         // ~$0.12/hr
    memoryCostPerGBMinute: 0.00042,  // ~$0.025/hr per GB
    gpuCostPerMinute: 0,
    baseCostPerCall: 0.0001,
    freeTierCredits: 15,
  },
  'sprites': {
    provider: 'sprites',
    cpuCostPerMinute: 0.00083,       // ~$0.05/hr (cheapest cloud provider)
    memoryCostPerGBMinute: 0.00017,  // ~$0.01/hr per GB
    gpuCostPerMinute: 0,
    baseCostPerCall: 0.00005,
    freeTierCredits: 5,
  },
  'modal-com': {
    provider: 'modal-com',
    cpuCostPerMinute: 0.0033,        // ~$0.20/hr
    memoryCostPerGBMinute: 0.00067,  // ~$0.04/hr per GB
    gpuCostPerMinute: 0.0167,        // ~$1.00/hr GPU (H100 etc.)
    baseCostPerCall: 0.0002,
    freeTierCredits: 30,
  },
  'blaxel': {
    provider: 'blaxel',
    cpuCostPerMinute: 0.001,         // ~$0.06/hr
    memoryCostPerGBMinute: 0.0002,   // ~$0.012/hr per GB
    gpuCostPerMinute: 0,
    baseCostPerCall: 0.00005,
    freeTierCredits: 10,
  },
  'runloop': {
    provider: 'runloop',
    cpuCostPerMinute: 0.0017,        // ~$0.10/hr
    memoryCostPerGBMinute: 0.00033,  // ~$0.02/hr per GB
    gpuCostPerMinute: 0,
    baseCostPerCall: 0.0001,
    freeTierCredits: 10,
  },
  'zeroboot': {
    provider: 'zeroboot',
    cpuCostPerMinute: 0.0013,        // ~$0.08/hr
    memoryCostPerGBMinute: 0.00025,  // ~$0.015/hr per GB
    gpuCostPerMinute: 0,
    baseCostPerCall: 0.00008,
    freeTierCredits: 5,
  },
  'microsandbox': {
    provider: 'microsandbox',
    cpuCostPerMinute: 0,
    memoryCostPerGBMinute: 0,
    gpuCostPerMinute: 0,
    baseCostPerCall: 0,
    freeTierCredits: Infinity,
  },
  'opensandbox': {
    provider: 'opensandbox',
    cpuCostPerMinute: 0,
    memoryCostPerGBMinute: 0,
    gpuCostPerMinute: 0,
    baseCostPerCall: 0,
    freeTierCredits: Infinity,
  },
  'webcontainer': {
    provider: 'webcontainer',
    cpuCostPerMinute: 0,
    memoryCostPerGBMinute: 0,
    gpuCostPerMinute: 0,
    baseCostPerCall: 0,
    freeTierCredits: Infinity,
  },
  'local': {
    provider: 'local',
    cpuCostPerMinute: 0,
    memoryCostPerGBMinute: 0,
    gpuCostPerMinute: 0,
    baseCostPerCall: 0,
    freeTierCredits: Infinity,
  },
};

// ============================================================================
// Request / Response Types
// ============================================================================

/**
 * Runtime Broker request — standardized input for provider selection.
 */
export interface RuntimeBrokerRequest {
  /** Is this an interactive user command? */
  interactive: boolean;
  /** CPU cores needed */
  cpu: number;
  /** Memory GB needed */
  memory: number;
  /** Whether GPU is required */
  gpu: boolean;
  /** Expected duration in seconds */
  expectedDuration: number;
  /** Optional: command category for specialized routing */
  commandCategory?: string;
  /** Optional: workspace ID for affinity lookup */
  workspaceId?: string;
  /** Cost sensitivity (low = prefer performance, high = prefer cheap) */
  costSensitivity?: 'low' | 'medium' | 'high';
  /** Performance priority */
  performancePriority?: 'latency' | 'throughput' | 'balanced';
  /** Optional: list of candidate providers to evaluate (defaults to all) */
  candidateProviders?: SandboxProviderType[];
}

/**
 * Runtime Broker decision — optimal provider selection.
 */
export interface RuntimeBrokerDecision {
  /** Selected provider */
  provider: SandboxProviderType | 'local';
  /** Confidence score (0-1) */
  confidence: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Currency */
  currency: string;
  /** Primary reasons for selection */
  reasons: string[];
  /** Alternative providers with scores */
  alternatives: Array<{
    provider: SandboxProviderType | 'local';
    score: number;
    estimatedCost: number;
    reason: string;
  }>;
  /** Breakdown of scoring components for transparency */
  scoringBreakdown?: {
    costScore: number;
    latencyScore: number;
    capacityScore: number;
    affinityScore: number;
    serviceScore: number;
  };
}

/**
 * Cost estimate for a specific provider.
 */
export interface RuntimeCostEstimate {
  provider: SandboxProviderType | 'local';
  estimatedCost: number;
  currency: string;
  breakdown: string;
  cpuCost: number;
  memoryCost: number;
  gpuCost: number;
  baseCost: number;
  durationMinutes: number;
}

/**
 * Aggregate statistics for all providers.
 */
export interface RuntimeBrokerStats {
  provider: SandboxProviderType | 'local';
  costModel: ProviderCostModel;
  latency: { avgMs: number; p95Ms: number; tier: 'low' | 'medium' | 'high' };
  health: { score: number; failureRate: number; shouldDeprioritize: boolean };
  capacity: { quotaRemaining: number; activeRequests: number; queueDepth: number };
}

// ============================================================================
// Scoring Configuration
// ============================================================================

export interface RuntimeBrokerConfig {
  /** Weight for cost in provider selection (default: 0.25) */
  costWeight: number;
  /** Weight for latency in provider selection (default: 0.25) */
  latencyWeight: number;
  /** Weight for capacity/health in provider selection (default: 0.20) */
  capacityWeight: number;
  /** Weight for affinity in provider selection (default: 0.15) */
  affinityWeight: number;
  /** Weight for service match in provider selection (default: 0.15) */
  serviceWeight: number;
  /** Maximum acceptable cost for a provider (USD, default: no limit) */
  maxCostPerExecution: number;
  /** Maximum acceptable latency for high-performance requests (ms, default: 3000) */
  maxLatencyForLowLatency: number;
  /** Affinity bonus score (default: 0.2, added to provider with active affinity) */
  affinityBonus: number;
}

const DEFAULT_CONFIG: RuntimeBrokerConfig = {
  costWeight: 0.25,
  latencyWeight: 0.25,
  capacityWeight: 0.20,
  affinityWeight: 0.15,
  serviceWeight: 0.15,
  maxCostPerExecution: Infinity,
  maxLatencyForLowLatency: 3000,
  affinityBonus: 0.2,
};

// ============================================================================
// Runtime Broker
// ============================================================================

/**
 * Runtime Broker — cost/latency/capacity-aware execution scheduler.
 *
 * Replaces static execution policies and hardcoded provider selection
 * with a dynamic scheduler that picks the optimal provider based on
 * real-time cost, latency, capacity, health, quota, and affinity data.
 */
export class RuntimeBroker {
  private config: RuntimeBrokerConfig;
  private initialized = false;

  constructor(config?: Partial<RuntimeBrokerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the broker (no-op for now — providers are lazily resolved).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    logger.info('Runtime Broker initialized (Phase 8)');
    this.initialized = true;
  }

  // ========================================================================
  // Core Selection
  // ========================================================================

  /**
   * Select the optimal provider for an execution request.
   *
   * Evaluates all available providers against cost, latency, capacity,
   * health, quota, and workspace affinity to choose the best one.
   */
  async selectProvider(request: RuntimeBrokerRequest): Promise<RuntimeBrokerDecision> {
    // Determine candidate providers
    const candidates = request.candidateProviders ||
      this.getDefaultCandidates(request);

    if (candidates.length === 0) {
      return this.localOnlyDecision('No sandbox providers available');
    }

    // Score each candidate
    const scored = await this.scoreProviders(candidates, request);

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const alternatives = scored.slice(1, 4).map(s => ({
      provider: s.provider,
      score: s.score,
      estimatedCost: s.estimatedCost,
      reason: s.reasons.join('; '),
    }));

    logger.info('Runtime Broker selected provider', {
      provider: best.provider,
      score: best.score.toFixed(3),
      estimatedCost: best.estimatedCost.toFixed(4),
      reasons: best.reasons.slice(0, 3),
    });

    return {
      provider: best.provider,
      confidence: Math.min(1, best.score),
      estimatedCost: best.estimatedCost,
      currency: 'USD',
      reasons: best.reasons,
      alternatives,
      scoringBreakdown: best.breakdown,
    };
  }

  /**
   * Get cost estimate for running a request on a specific provider.
   */
  getCostEstimate(request: RuntimeBrokerRequest, provider: SandboxProviderType | 'local'): RuntimeCostEstimate {
    const costModel = PROVIDER_COST_MODELS[provider] || PROVIDER_COST_MODELS['local'];
    const durationMinutes = Math.max(0.1, request.expectedDuration / 60);

    const cpuCost = costModel.cpuCostPerMinute * request.cpu * durationMinutes;
    const memoryCost = costModel.memoryCostPerGBMinute * request.memory * durationMinutes;
    const gpuCost = request.gpu ? costModel.gpuCostPerMinute * durationMinutes : 0;
    const baseCost = costModel.baseCostPerCall;
    const total = cpuCost + memoryCost + gpuCost + baseCost;

    const parts: string[] = [];
    if (cpuCost > 0) parts.push(`CPU: $${cpuCost.toFixed(4)}`);
    if (memoryCost > 0) parts.push(`Memory: $${memoryCost.toFixed(4)}`);
    if (gpuCost > 0) parts.push(`GPU: $${gpuCost.toFixed(4)}`);
    if (baseCost > 0) parts.push(`Base: $${baseCost.toFixed(4)}`);

    return {
      provider,
      estimatedCost: Math.round(total * 10000) / 10000,
      currency: 'USD',
      breakdown: parts.join(', '),
      cpuCost: Math.round(cpuCost * 10000) / 10000,
      memoryCost: Math.round(memoryCost * 10000) / 10000,
      gpuCost: Math.round(gpuCost * 10000) / 10000,
      baseCost: Math.round(baseCost * 10000) / 10000,
      durationMinutes: Math.round(durationMinutes * 100) / 100,
    };
  }

  /**
   * Get aggregate statistics for all providers (for observability).
   */
  async getAllProviderStats(): Promise<RuntimeBrokerStats[]> {
    const providers: (SandboxProviderType | 'local')[] = [
      ...Object.keys(PROVIDER_COST_MODELS) as (SandboxProviderType | 'local')[],
    ];

    const stats: RuntimeBrokerStats[] = [];

    for (const provider of providers) {
      const costModel = PROVIDER_COST_MODELS[provider] || PROVIDER_COST_MODELS['local'];

      // Latency: skip 'local' since latencyTracker only tracks SandboxProviderType
      let latencyMetrics = null;
      if (provider !== 'local') {
        latencyMetrics = latencyTracker.getMetrics(provider as SandboxProviderType);
      }
      const healthScore = providerHealthTracker.getHealthScore(provider);
      const telemetry = resourceTelemetry.getProviderTelemetry(provider);

      let quotaRemaining = Infinity;
      const qm = await getQuotaManager();
      if (qm && provider !== 'local') {
        quotaRemaining = qm.getRemainingCalls(provider);
      }

      stats.push({
        provider,
        costModel,
        latency: {
          avgMs: latencyMetrics?.avgLatencyMs || 0,
          p95Ms: latencyMetrics?.p95LatencyMs || 0,
          tier: latencyTracker.getLatencyTier(provider as SandboxProviderType),
        },
        health: {
          score: healthScore.score,
          failureRate: healthScore.failureRate,
          shouldDeprioritize: healthScore.shouldDeprioritize,
        },
        capacity: {
          quotaRemaining,
          activeRequests: telemetry.activeRequests,
          queueDepth: telemetry.queueDepth,
        },
      });
    }

    return stats.sort((a, b) => {
      // Sort by health score descending
      const healthScore = b.health.score - a.health.score;
      if (healthScore !== 0) return healthScore;
      // Then by latency ascending
      return a.latency.avgMs - b.latency.avgMs;
    });
  }

  // ========================================================================
  // Provider Scoring
  // ========================================================================

  private async scoreProviders(
    candidates: (SandboxProviderType | 'local')[],
    request: RuntimeBrokerRequest,
  ): Promise<Array<{
    provider: SandboxProviderType | 'local';
    score: number;
    estimatedCost: number;
    reasons: string[];
    breakdown: { costScore: number; latencyScore: number; capacityScore: number; affinityScore: number; serviceScore: number };
  }>> {
    // Check workspace affinity (cache warmth bonus)
    const affinityProvider = await this.getAffinityProvider(request.workspaceId);

    const results: Array<{
      provider: SandboxProviderType | 'local';
      score: number;
      estimatedCost: number;
      reasons: string[];
      breakdown: { costScore: number; latencyScore: number; capacityScore: number; affinityScore: number; serviceScore: number };
    }> = [];

    for (const provider of candidates) {
      const reasons: string[] = [];

      // 1. Cost score (0-1, higher = cheaper)
      const costEstimate = this.getCostEstimate(request, provider);
      const costScore = this.computeCostScore(costEstimate.estimatedCost, request.costSensitivity);
      if (costEstimate.estimatedCost === 0) {
        reasons.push('Free execution');
      } else {
        reasons.push(`Cost: $${costEstimate.estimatedCost.toFixed(4)}`);
      }

      // 2. Latency score (0-1, higher = faster)
      const latencyScore = this.computeLatencyScore(provider, request.performancePriority);
      const latencyMetrics = latencyTracker.getMetrics(provider as SandboxProviderType);
      if (latencyMetrics && latencyMetrics.avgLatencyMs > 0) {
        reasons.push(`Latency: ${latencyMetrics.avgLatencyMs.toFixed(0)}ms avg`);
      }

      // 3. Capacity/health score (0-1, higher = healthier)
      const capacityScore = await this.computeCapacityScore(provider);
      const health = providerHealthTracker.getHealthScore(provider);
      if (health.shouldDeprioritize) {
        reasons.push(`Health degraded: ${health.deprioritizeReason}`);
      } else if (health.score < 0.8) {
        reasons.push(`Health: ${(health.score * 100).toFixed(0)}%`);
      }

      // 4. Affinity score (0-1, higher = better affinity)
      const affinityScore = affinityProvider === provider ? 1.0 : 0;
      if (affinityScore > 0) {
        reasons.push('Workspace affinity active (cache warm)');
      }

      // 5. Service match score (0-1, higher = better match for command category)
      const serviceScore = this.computeServiceScore(provider, request);

      // Weighted composite score
      const score =
        costScore * this.config.costWeight +
        latencyScore * this.config.latencyWeight +
        capacityScore * this.config.capacityWeight +
        affinityScore * this.config.affinityWeight +
        serviceScore * this.config.serviceWeight;

      // Apply cost ceiling penalty
      let finalScore = score;
      if (request.costSensitivity === 'high' && costEstimate.estimatedCost > 0.01) {
        finalScore *= 0.8;
        reasons.push('Cost-sensitive — penalized');
      }

      results.push({
        provider,
        score: Math.round(finalScore * 1000) / 1000,
        estimatedCost: costEstimate.estimatedCost,
        reasons,
        breakdown: {
          costScore: Math.round(costScore * 1000) / 1000,
          latencyScore: Math.round(latencyScore * 1000) / 1000,
          capacityScore: Math.round(capacityScore * 1000) / 1000,
          affinityScore: Math.round(affinityScore * 1000) / 1000,
          serviceScore: Math.round(serviceScore * 1000) / 1000,
        },
      });
    }

    return results;
  }

  // ========================================================================
  // Scoring Sub-Methods
  // ========================================================================

  /**
   * Compute cost score. Higher = cheaper.
   * Uses logarithmic scaling so small cost differences matter.
   */
  private computeCostScore(estimatedCost: number, costSensitivity?: 'low' | 'medium' | 'high'): number {
    if (estimatedCost === 0) return 1.0;

    // Free tier providers always get max score
    if (estimatedCost <= 0.0001) return 1.0;

    // Logarithmic scaling: $0.001 → 0.95, $0.01 → 0.80, $0.10 → 0.60, $1.00 → 0.30
    const logScore = Math.max(0, 1 - Math.log10(estimatedCost * 100 + 1) / 2);

    // Cost sensitivity adjusts the curve
    if (costSensitivity === 'high') return logScore;             // Pure logarithmic
    if (costSensitivity === 'low') return 0.5 + logScore * 0.5; // Compressed — cost matters less
    return logScore * 0.8 + 0.2;                                // Default
  }

  /**
   * Compute latency score. Higher = faster.
   * `priority` alters the score curve:
   * - 'latency': steep drop-off (prefer fast providers aggressively)
   * - 'throughput': gentler drop-off (prioritize capacity over speed)
   * - 'balanced': default curve
   */
  private computeLatencyScore(
    provider: SandboxProviderType | 'local',
    priority?: 'latency' | 'throughput' | 'balanced',
  ): number {
    // Local is always instant
    if (provider === 'local') return 1.0;

    const metrics = latencyTracker.getMetrics(provider as SandboxProviderType);
    if (!metrics || metrics.sampleCount === 0) return 0.5; // Unknown — neutral

    const avgMs = metrics.avgLatencyMs;

    // Base score based on latency tiers
    let baseScore: number;
    if (avgMs < 500) baseScore = 1.0;
    else if (avgMs < 1000) baseScore = 0.9;
    else if (avgMs < 3000) baseScore = 0.7;
    else if (avgMs < 5000) baseScore = 0.4;
    else if (avgMs < 10000) baseScore = 0.2;
    else baseScore = 0.05;

    // Priority adjustment
    if (priority === 'latency') {
      // Steep drop-off — slower providers penalized more
      return baseScore * baseScore; // Square for extra penalty on slow
    }
    if (priority === 'throughput') {
      // Gentler curve — capacity matters more than raw speed
      return 0.3 + baseScore * 0.7;
    }
    return baseScore;
  }

  /**
   * Compute capacity/health score. Higher = more available.
   */
  private async computeCapacityScore(provider: SandboxProviderType | 'local'): Promise<number> {
    // Local is always available
    if (provider === 'local') return 1.0;

    let score = 1.0;

    // Check quota
    const qm = await getQuotaManager();
    if (qm) {
      const quotaCheck = qm.checkQuota(provider);
      if (!quotaCheck.allowed) {
        score *= 0.05; // Nearly disabled
      } else if (quotaCheck.remaining < 100) {
        score *= 0.5;  // Running low
      }
    }

    // Check health
    const health = providerHealthTracker.getHealthScore(provider);
    if (health.shouldDeprioritize) {
      score *= 0.1;
    } else {
      score *= health.score;
    }

    // Check resource telemetry
    const telemetry = resourceTelemetry.getProviderTelemetry(provider);
    if (telemetry.queueDepth > 10) {
      score *= 0.5;
    }
    if (telemetry.activeRequests > 20) {
      score *= 0.5;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Compute service match score. Higher = better fit for command category.
   */
  private computeServiceScore(
    provider: SandboxProviderType | 'local',
    request: RuntimeBrokerRequest,
  ): number {
    if (!request.commandCategory) return 0.5; // No category = neutral

    // Map command categories to preferred provider characteristics
    const category = request.commandCategory;

    // GPU-required tasks
    if (request.gpu) {
      const gpuProviders = ['modal-com', 'daytona', 'e2b'];
      if (gpuProviders.includes(provider)) return 1.0;
      return 0.1;
    }

    // Package install — prefer persistent or fast-start providers
    if (category === 'package-install') {
      if (['daytona', 'e2b', 'codesandbox'].includes(provider)) return 1.0;
      if (['sprites'].includes(provider)) return 0.8;
      return 0.4;
    }

    // Build/compile — prefer full-stack providers
    if (['package-build', 'build-compile'].includes(category)) {
      if (['daytona', 'codesandbox'].includes(provider)) return 1.0;
      if (['e2b', 'modal-com'].includes(provider)) return 0.7;
      return 0.3;
    }

    // Script execution — prefer general code execution
    if (category === 'script-execution') {
      if (['e2b', 'daytona', 'modal-com'].includes(provider)) return 1.0;
      if (['microsandbox', 'opensandbox'].includes(provider)) return 0.7;
      return 0.3;
    }

    // Daemon/service — prefer persistent providers
    if (category === 'daemon-service') {
      if (['sprites', 'codesandbox'].includes(provider)) return 1.0;
      if (['daytona'].includes(provider)) return 0.6;
      return 0.2;
    }

    // Interactive — prefer low-latency
    if (request.interactive) {
      if (['e2b', 'daytona'].includes(provider)) return 1.0;
      if (['webcontainer', 'microsandbox'].includes(provider)) return 0.6;
      return 0.3;
    }

    return 0.5; // Neutral for unmatched categories
  }

  // ========================================================================
  // Affinity Lookup
  // ========================================================================

  /**
   * Check if a workspace has affinity to a specific provider.
   */
  private async getAffinityProvider(workspaceId?: string): Promise<string | null> {
    if (!workspaceId) return null;

    try {
      const orch = await getSandboxOrchestrator();
      if (orch) {
        const affinity = orch.getAffinity(workspaceId);
        if (affinity) {
          logger.debug('Workspace affinity found', {
            workspaceId,
            provider: affinity.provider,
            commandCount: affinity.commandCount,
          });
          return affinity.provider;
        }
      }
    } catch {
      // Orchestrator may not be available
    }

    return null;
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  /**
   * Get default candidate providers based on request requirements.
   */
  private getDefaultCandidates(request: RuntimeBrokerRequest): (SandboxProviderType | 'local')[] {
    const candidates: (SandboxProviderType | 'local')[] = [];

    // Always include local as a fallback
    candidates.push('local');

    // Add cloud providers
    const cloudProviders: SandboxProviderType[] = [
      'daytona', 'e2b', 'codesandbox', 'sprites', 'modal-com',
      'blaxel', 'runloop', 'microsandbox', 'opensandbox', 'webcontainer',
    ];

    for (const p of cloudProviders) {
      // GPU requests: only include GPU-capable providers
      if (request.gpu && !['modal-com', 'daytona', 'e2b'].includes(p)) continue;

      // Interactive: prefer low-latency providers
      // (all included, but scoring handles the preference)

      candidates.push(p);
    }

    return candidates;
  }

  /**
   * Return a decision selecting local execution.
   */
  private localOnlyDecision(reason: string): RuntimeBrokerDecision {
    return {
      provider: 'local',
      confidence: 0.5,
      estimatedCost: 0,
      currency: 'USD',
      reasons: [reason, 'Falling back to local execution'],
      alternatives: [],
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _runtimeBroker: RuntimeBroker | null = null;

/**
 * Get or create the Runtime Broker singleton.
 */
export function getRuntimeBroker(config?: Partial<RuntimeBrokerConfig>): RuntimeBroker {
  if (!_runtimeBroker) {
    _runtimeBroker = new RuntimeBroker(config);
  }
  return _runtimeBroker;
}

/**
 * Reset the singleton (for testing).
 */
export function resetRuntimeBroker(): void {
  _runtimeBroker = null;
}
