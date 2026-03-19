/**
 * Phase 2: Provider Router
 *
 * Intelligently selects optimal sandbox provider based on:
 * - Task type (code-interpreter, agent, fullstack, batch, computer-use)
 * - Resource requirements (CPU, memory, GPU)
 * - Persistence needs
 * - Quota availability
 * - Latency/cost optimization
 * - Execution policy (local-safe, sandbox-required, sandbox-heavy, etc.)
 *
 * Auto-prioritizes provider-specific services:
 * - E2B: AMP/Codex agents, desktop environments
 * - Daytona: Computer Use, LSP services, object storage
 * - CodeSandbox: Batch execution, task management, previews
 * - Sprites: Checkpoints, persistent services, auto-suspend
 *
 * @see lib/sandbox/providers/ - Provider implementations
 * @see lib/services/quota-manager.ts - Quota tracking
 * @see lib/sandbox/types.ts - Execution policies
 *
 * @example
 * ```typescript
 * import { providerRouter } from '@/lib/sandbox/phase2-integration';
 *
 * // Auto-select provider for task
 * const provider = await providerRouter.selectOptimalProvider({
 *   type: 'agent',
 *   requiresPersistence: true,
 *   expectedDuration: 'long',
 * });
 * // Returns: 'e2b' (best for agents with AMP/Codex)
 *
 * // Select provider by execution policy
 * const provider = await providerRouter.selectByExecutionPolicy('sandbox-heavy');
 * // Returns: 'daytona' (best for heavy workloads)
 * ```
 */

import { quotaManager } from '../management/quota-manager';
import type { SandboxProviderType } from './providers';
import type { ExecutionPolicy } from './types';
import { getExecutionPolicyConfig, getPreferredProviders } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('Phase2:ProviderRouter');

/**
 * Dynamic latency tracking for provider selection
 * Tracks real-time response times for each provider
 */
interface LatencyMetrics {
  provider: SandboxProviderType;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  sampleCount: number;
  lastUpdated: number;
  recentLatencies: number[]; // Rolling window of last 100 requests
}

class LatencyTracker {
  private metrics = new Map<SandboxProviderType, LatencyMetrics>();
  private readonly MAX_SAMPLES = 100;
  private readonly STALE_THRESHOLD_MS = 300000; // 5 minutes

  constructor() {
    // Initialize metrics for all providers
    const providers: SandboxProviderType[] = [
      'daytona', 'e2b', 'sprites', 'codesandbox', 'microsandbox',
      'blaxel', 'opensandbox', 'mistral', 'vercel-sandbox'
    ];
    
    for (const provider of providers) {
      this.metrics.set(provider, {
        provider,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        sampleCount: 0,
        lastUpdated: Date.now(),
        recentLatencies: [],
      });
    }
  }

  /**
   * Record latency for a provider
   */
  record(provider: SandboxProviderType, latencyMs: number): void {
    const metric = this.metrics.get(provider);
    if (!metric) return;

    // Add to rolling window
    metric.recentLatencies.push(latencyMs);
    if (metric.recentLatencies.length > this.MAX_SAMPLES) {
      metric.recentLatencies.shift();
    }

    // Update statistics
    metric.sampleCount++;
    metric.lastUpdated = Date.now();
    metric.avgLatencyMs = this.calculateAverage(metric.recentLatencies);
    metric.p95LatencyMs = this.calculatePercentile(metric.recentLatencies, 95);
    metric.p99LatencyMs = this.calculatePercentile(metric.recentLatencies, 99);
  }

  /**
   * Get current latency metrics for provider
   */
  getMetrics(provider: SandboxProviderType): LatencyMetrics | null {
    return this.metrics.get(provider) || null;
  }

  /**
   * Get all providers sorted by latency (fastest first)
   */
  getProvidersByLatency(): SandboxProviderType[] {
    return Array.from(this.metrics.values())
      .filter(m => m.sampleCount > 0 && Date.now() - m.lastUpdated < this.STALE_THRESHOLD_MS)
      .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)
      .map(m => m.provider);
  }

  /**
   * Check if provider latency is acceptable
   */
  isLatencyAcceptable(provider: SandboxProviderType, thresholdMs: number = 5000): boolean {
    const metric = this.metrics.get(provider);
    if (!metric || metric.sampleCount === 0) return true; // No data, assume OK
    
    return metric.avgLatencyMs < thresholdMs;
  }

  /**
   * Get latency tier based on current metrics
   */
  getLatencyTier(provider: SandboxProviderType): 'low' | 'medium' | 'high' {
    const metric = this.metrics.get(provider);
    if (!metric || metric.sampleCount === 0) return 'medium'; // Default if no data

    if (metric.avgLatencyMs < 1000) return 'low';      // < 1s
    if (metric.avgLatencyMs < 5000) return 'medium';   // 1-5s
    return 'high';                                      // > 5s
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

// Singleton instance
export const latencyTracker = new LatencyTracker();

/**
 * Task type for provider selection
 */
export type TaskType =
  | 'code-interpreter'    // Python/Node.js execution
  | 'agent'               // Autonomous AI agent (AMP, Codex, etc.)
  | 'fullstack-app'       // Full-stack application with backend
  | 'frontend-app'        // Frontend-only (React, Vue, etc.)
  | 'batch-job'           // Parallel/batch execution
  | 'computer-use'        // Desktop automation, screenshots
  | 'lsp-intelligence'    // Code intelligence (completion, hover, etc.)
  | 'persistent-service'  // Long-running service with state
  | 'ci-cd'               // CI/CD pipeline, testing
  | 'ml-training'         // ML model training (GPU optional)
  | 'general';            // Default/general purpose

/**
 * Expected task duration
 */
export type TaskDuration = 'short' | 'medium' | 'long' | 'persistent';

/**
 * Provider service capability
 */
export type ProviderService =
  | 'pty'                 // Interactive terminal
  | 'preview'             // Live preview URLs
  | 'snapshot'            // Checkpoint/snapshot support
  | 'batch'               // Batch/parallel execution
  | 'agent'               // AI agent offloading (AMP, Codex)
  | 'computer-use'        // Desktop screenshots/recording
  | 'lsp'                 // Language server protocol
  | 'object-storage'      // Large file persistence
  | 'persistent-fs'       // Persistent filesystem
  | 'auto-suspend'        // Auto-suspend/resume with state
  | 'services'            // Auto-restart services
  | 'desktop';            // Desktop environment

/**
 * Task context for provider selection
 */
export interface TaskContext {
  /** Task type */
  type: TaskType;
  
  /** Expected duration */
  duration?: TaskDuration;
  
  /** Requires persistence (filesystem survives between sessions) */
  requiresPersistence?: boolean;
  
  /** Requires backend (Node.js, Python, database, etc.) */
  requiresBackend?: boolean;
  
  /** Requires GPU */
  requiresGPU?: boolean;
  
  /** Estimated file count */
  fileCount?: number;
  
  /** Required services */
  needsServices?: ProviderService[];
  
  /** Preferred region (if provider supports multiple) */
  preferredRegion?: string;
  
  /** Cost sensitivity (low, medium, high) */
  costSensitivity?: 'low' | 'medium' | 'high';
  
  /** Performance priority (latency, throughput, balanced) */
  performancePriority?: 'latency' | 'throughput' | 'balanced';
}

/**
 * Provider selection result
 */
export interface ProviderSelectionResult {
  /** Selected provider type */
  provider: SandboxProviderType;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Matched services */
  matchedServices: ProviderService[];
  
  /** Missing services (if any) */
  missingServices: ProviderService[];
  
  /** Alternative providers */
  alternatives: SandboxProviderType[];
  
  /** Selection reason */
  reason: string;
  
  /** Quota status */
  quotaRemaining?: number;
}

/**
 * Provider capability profile
 */
export interface ProviderProfile {
  type: SandboxProviderType;
  services: ProviderService[];
  bestFor: TaskType[];
  costTier: 'low' | 'medium' | 'high';
  latencyTier: 'low' | 'medium' | 'high';
  persistenceSupport: boolean;
  gpuSupport: boolean;
}

/**
 * Provider capability profiles
 */
const PROVIDER_PROFILES: ProviderProfile[] = [
  {
    type: 'e2b',
    services: ['pty', 'preview', 'agent', 'desktop'],
    bestFor: ['code-interpreter', 'agent', 'ml-training'],
    costTier: 'medium',
    latencyTier: 'low',
    persistenceSupport: false,
    gpuSupport: false,
  },
  {
    type: 'daytona',
    services: ['pty', 'preview', 'computer-use', 'lsp', 'object-storage'],
    bestFor: ['fullstack-app', 'computer-use', 'lsp-intelligence', 'general'],
    costTier: 'medium',
    latencyTier: 'low',
    persistenceSupport: false,
    gpuSupport: false,
  },
  {
    type: 'sprites',
    services: ['pty', 'preview', 'snapshot', 'persistent-fs', 'auto-suspend', 'services'],
    bestFor: ['persistent-service', 'fullstack-app', 'general'],
    costTier: 'low',
    latencyTier: 'medium',
    persistenceSupport: true,
    gpuSupport: false,
  },
  {
    type: 'codesandbox',
    services: ['pty', 'preview', 'snapshot', 'batch', 'services'],
    bestFor: ['frontend-app', 'fullstack-app', 'batch-job', 'ci-cd'],
    costTier: 'medium',
    latencyTier: 'low',
    persistenceSupport: true,
    gpuSupport: false,
  },
  {
    type: 'webcontainer',
    services: ['pty', 'preview'],
    bestFor: ['frontend-app', 'code-interpreter'],
    costTier: 'low',
    latencyTier: 'low',
    persistenceSupport: false,
    gpuSupport: false,
  },
  {
    type: 'blaxel',
    services: ['batch', 'agent'],
    bestFor: ['batch-job', 'agent', 'ci-cd'],
    costTier: 'low',
    latencyTier: 'medium',
    persistenceSupport: false,
    gpuSupport: false,
  },
  {
    type: 'microsandbox',
    services: ['pty'],
    bestFor: ['code-interpreter', 'general'],
    costTier: 'low',
    latencyTier: 'low',
    persistenceSupport: false,
    gpuSupport: false,
  },
  {
    type: 'opensandbox',
    services: ['pty', 'preview'],
    bestFor: ['code-interpreter', 'general'],
    costTier: 'low',
    latencyTier: 'medium',
    persistenceSupport: false,
    gpuSupport: false,
  },
  {
    type: 'mistral',
    services: ['pty', 'preview'],
    bestFor: ['code-interpreter', 'general'],
    costTier: 'medium',
    latencyTier: 'medium',
    persistenceSupport: false,
    gpuSupport: false,
  },
  {
    type: 'opensandbox-nullclaw' as SandboxProviderType,
    services: ['pty', 'preview', 'agent'],
    bestFor: ['agent', 'persistent-service', 'general'],
    costTier: 'low',
    latencyTier: 'medium',
    persistenceSupport: false,
    gpuSupport: false,
  },
];

/**
 * Provider Router
 */
export class ProviderRouter {
  /**
   * Select optimal provider for task
   */
  async selectOptimalProvider(context: TaskContext): Promise<SandboxProviderType> {
    const result = await this.evaluateProviders(context);
    
    logger.info(`Selected ${result.provider} for ${context.type} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
    logger.debug(`Reason: ${result.reason}`);
    
    return result.provider;
  }
  
  /**
   * Select provider with service capabilities
   */
  async selectWithServices(context: TaskContext & { needsServices: ProviderService[] }): Promise<ProviderSelectionResult> {
    return this.evaluateProviders(context);
  }
  
  /**
   * Get provider recommendations
   */
  async getRecommendations(context: TaskContext): Promise<{
    primary: SandboxProviderType;
    alternatives: Array<{ provider: SandboxProviderType; reason: string }>;
  }> {
    const result = await this.evaluateProviders(context);
    
    const alternatives = result.alternatives.map(provider => {
      const profile = PROVIDER_PROFILES.find(p => p.type === provider);
      return {
        provider,
        reason: profile ? `Best for: ${profile.bestFor.join(', ')}` : 'Fallback option',
      };
    });
    
    return {
      primary: result.provider,
      alternatives,
    };
  }
  
  /**
   * Check if provider supports required services
   */
  checkServiceSupport(
    provider: SandboxProviderType,
    requiredServices: ProviderService[]
  ): { supported: ProviderService[]; unsupported: ProviderService[] } {
    const profile = PROVIDER_PROFILES.find(p => p.type === provider);
    
    if (!profile) {
      return { supported: [], unsupported: requiredServices };
    }
    
    const supported = requiredServices.filter(s => profile.services.includes(s));
    const unsupported = requiredServices.filter(s => !profile.services.includes(s));
    
    return { supported, unsupported };
  }
  
  /**
   * Get all providers supporting a service
   */
  getProvidersForService(service: ProviderService): SandboxProviderType[] {
    return PROVIDER_PROFILES
      .filter(p => p.services.includes(service))
      .map(p => p.type);
  }
  
  /**
   * Get provider profile
   */
  getProviderProfile(provider: SandboxProviderType): ProviderProfile | undefined {
    return PROVIDER_PROFILES.find(p => p.type === provider);
  }

  /**
   * Select provider by execution policy
   *
   * Maps execution policies to optimal providers:
   * - local-safe: No provider (local execution)
   * - sandbox-required: daytona (fast, reliable)
   * - sandbox-preferred: daytona → e2b
   * - sandbox-heavy: daytona (full resources)
   * - persistent-sandbox: sprites (auto-suspend, checkpoints)
   * - desktop-required: daytona (computer use support)
   */
  async selectByExecutionPolicy(policy: ExecutionPolicy): Promise<{
    provider: SandboxProviderType | 'local';
    confidence: number;
    reason: string;
  }> {
    const policyConfig = getExecutionPolicyConfig(policy);
    const preferredProviders = getPreferredProviders(policy);

    // Local-safe policy - no sandbox needed
    if (policy === 'local-safe') {
      return {
        provider: 'local',
        confidence: 1,
        reason: 'Local execution - no cloud sandbox required',
      };
    }

    // Try preferred providers in order
    for (const providerType of preferredProviders) {
      try {
        const { getSandboxProvider } = await import('./providers');
        await getSandboxProvider(providerType as SandboxProviderType);

        const profile = this.getProviderProfile(providerType as SandboxProviderType);
        return {
          provider: providerType as SandboxProviderType,
          confidence: 0.9,
          reason: `Selected by execution policy ${policy}: ${profile?.bestFor.join(', ') || 'Optimal for policy'}`,
        };
      } catch (error: any) {
        logger.warn(`Provider ${providerType} unavailable for policy ${policy}: ${error.message}`);
        continue;
      }
    }

    // Fallback: try any available provider
    if (policyConfig.allowLocalFallback) {
      return {
        provider: 'local',
        confidence: 0.5,
        reason: `No cloud providers available for policy ${policy}, falling back to local execution`,
      };
    }

    throw new Error(`No available providers for execution policy ${policy}`);
  }

  /**
   * Evaluate all providers and return best match
   */
  private async evaluateProviders(context: TaskContext): Promise<ProviderSelectionResult> {
    const scores: Array<{ provider: SandboxProviderType; score: number; reasons: string[] }> = [];
    
    for (const profile of PROVIDER_PROFILES) {
      let score = 0;
      const reasons: string[] = [];
      
      // Task type match (40 points)
      if (profile.bestFor.includes(context.type)) {
        score += 40;
        reasons.push(`Optimized for ${context.type}`);
      } else if (profile.bestFor.includes('general')) {
        score += 20;
        reasons.push('General purpose provider');
      }
      
      // Service match (30 points)
      if (context.needsServices && context.needsServices.length > 0) {
        const matchedServices = context.needsServices.filter(s => profile.services.includes(s));
        const matchRatio = matchedServices.length / context.needsServices.length;
        score += Math.round(30 * matchRatio);
        
        if (matchRatio === 1) {
          reasons.push('All required services supported');
        } else if (matchRatio > 0.5) {
          reasons.push(`${matchedServices.length}/${context.needsServices.length} services supported`);
        }
      }
      
      // Persistence requirement (10 points)
      if (context.requiresPersistence) {
        if (profile.persistenceSupport) {
          score += 10;
          reasons.push('Supports persistence');
        }
      } else {
        score += 10; // Not required, full points
      }
      
      // GPU requirement (10 points)
      if (context.requiresGPU) {
        if (profile.gpuSupport) {
          score += 10;
          reasons.push('GPU support available');
        } else {
          score -= 10; // Penalty for no GPU
          reasons.push('No GPU support');
        }
      }
      
      // Backend requirement (5 points)
      if (context.requiresBackend) {
        if (profile.bestFor.includes('fullstack-app') || profile.bestFor.includes('code-interpreter')) {
          score += 5;
          reasons.push('Backend-capable');
        }
      }
      
      // File count consideration (5 points)
      if (context.fileCount && context.fileCount > 100) {
        if (profile.services.includes('snapshot') || profile.services.includes('persistent-fs')) {
          score += 5;
          reasons.push('Handles large projects well');
        }
      }
      
      // Cost sensitivity adjustment
      if (context.costSensitivity === 'high') {
        if (profile.costTier === 'low') {
          score += 5;
        } else if (profile.costTier === 'high') {
          score -= 5;
        }
      }

      // Performance priority adjustment - Use DYNAMIC latency
      if (context.performancePriority === 'latency') {
        // Use real-time latency tier instead of static profile
        const dynamicLatencyTier = latencyTracker.getLatencyTier(profile.type);
        if (dynamicLatencyTier === 'low') {
          score += 8; // Increased weight for dynamic data
          reasons.push(`Excellent real-time latency (${latencyTracker.getMetrics(profile.type)?.avgLatencyMs.toFixed(0)}ms)`);
        } else if (dynamicLatencyTier === 'medium') {
          score += 3;
        } else if (dynamicLatencyTier === 'high') {
          score -= 8;
          reasons.push(`High real-time latency (${latencyTracker.getMetrics(profile.type)?.avgLatencyMs.toFixed(0)}ms)`);
        }
      }

      // Dynamic latency bonus/penalty (always applied, not just for latency priority)
      const currentLatencyTier = latencyTracker.getLatencyTier(profile.type);
      if (currentLatencyTier === 'low' && latencyTracker.isLatencyAcceptable(profile.type, 1000)) {
        score += 3; // Bonus for consistently fast providers
      } else if (currentLatencyTier === 'high' && !latencyTracker.isLatencyAcceptable(profile.type, 10000)) {
        score -= 5; // Penalty for very slow providers
        reasons.push('Provider experiencing high latency');
      }

      // Quota check (soft penalty, doesn't disqualify)
      const quotaCheck = quotaManager.checkQuota(profile.type);
      if (!quotaCheck.allowed) {
        score -= 20;
        reasons.push('Quota exceeded (will fallback)');
      } else if (quotaCheck.remaining < 100) {
        score -= 10;
        reasons.push('Low quota remaining');
      }
      
      scores.push({ provider: profile.type, score, reasons });
    }
    
    // Sort by score
    scores.sort((a, b) => b.score - a.score);
    
    // Get top provider
    const top = scores[0];
    const alternatives = scores.slice(1, 4).map(s => s.provider);
    
    // Calculate confidence
    const maxPossibleScore = 100;
    const confidence = Math.min(1, top.score / maxPossibleScore);
    
    // Get matched/missing services
    const matchedServices: ProviderService[] = [];
    const missingServices: ProviderService[] = [];
    
    if (context.needsServices) {
      const profile = PROVIDER_PROFILES.find(p => p.type === top.provider);
      if (profile) {
        for (const service of context.needsServices) {
          if (profile.services.includes(service)) {
            matchedServices.push(service);
          } else {
            missingServices.push(service);
          }
        }
      }
    }
    
    // Get quota remaining
    const quotaCheck = quotaManager.checkQuota(top.provider);
    
    return {
      provider: top.provider,
      confidence,
      matchedServices,
      missingServices,
      alternatives,
      reason: top.reasons.join('; '),
      quotaRemaining: quotaCheck.remaining,
    };
  }
}

/**
 * Singleton instance
 */
export const providerRouter = new ProviderRouter();

/**
 * Convenience function: Select optimal provider
 */
export async function selectOptimalProvider(context: TaskContext): Promise<SandboxProviderType> {
  return providerRouter.selectOptimalProvider(context);
}

/**
 * Convenience function: Select provider with services
 */
export async function selectProviderWithServices(
  context: TaskContext & { needsServices: ProviderService[] }
): Promise<ProviderSelectionResult> {
  return providerRouter.selectWithServices(context);
}

/**
 * Convenience function: Get provider recommendations
 */
export async function getProviderRecommendations(context: TaskContext): Promise<{
  primary: SandboxProviderType;
  alternatives: Array<{ provider: SandboxProviderType; reason: string }>;
}> {
  return providerRouter.getRecommendations(context);
}

/**
 * Convenience function: Check service support
 */
export function checkServiceSupport(
  provider: SandboxProviderType,
  requiredServices: ProviderService[]
): { supported: ProviderService[]; unsupported: ProviderService[] } {
  return providerRouter.checkServiceSupport(provider, requiredServices);
}

/**
 * Convenience function: Get providers for service
 */
export function getProvidersForService(service: ProviderService): SandboxProviderType[] {
  return providerRouter.getProvidersForService(service);
}

/**
 * Convenience function: Select provider by execution policy
 */
export async function selectProviderByExecutionPolicy(
  policy: ExecutionPolicy
): Promise<{
  provider: SandboxProviderType | 'local';
  confidence: number;
  reason: string;
}> {
  return providerRouter.selectByExecutionPolicy(policy);
}
