/**
 * Auto-Scaling Configuration
 * 
 * Provides automatic scaling configuration for sandbox resources.
 * Monitors usage and adjusts resources based on demand.
 * 
 * Features:
 * - CPU-based scaling
 * - Memory-based scaling
 * - Request rate scaling
 * - Scheduled scaling
 */

import { EventEmitter } from 'node:events';

/**
 * Scaling policy type
 */
export type ScalingPolicyType = 
  | 'cpu'
  | 'memory'
  | 'request_rate'
  | 'scheduled'
  | 'custom';

/**
 * Scaling action
 */
export type ScalingAction = 'scale_up' | 'scale_down' | 'maintain';

/**
 * Scaling policy configuration
 */
export interface ScalingPolicy {
  /**
   * Policy name
   */
  name: string;
  
  /**
   * Policy type
   */
  type: ScalingPolicyType;
  
  /**
   * Minimum resources
   */
  minResources: {
    cpu?: number;
    memory?: number;
    instances?: number;
  };
  
  /**
   * Maximum resources
   */
  maxResources: {
    cpu?: number;
    memory?: number;
    instances?: number;
  };
  
  /**
   * Target utilization (0-100)
   */
  targetUtilization?: number;
  
  /**
   * Scale up threshold
   */
  scaleUpThreshold?: number;
  
  /**
   * Scale down threshold
   */
  scaleDownThreshold?: number;
  
  /**
   * Cooldown period in seconds
   */
  cooldownSeconds?: number;
  
  /**
   * Schedule (cron expression) for scheduled scaling
   */
  schedule?: string;
  
  /**
   * Scheduled resource values
   */
  scheduledResources?: {
    cpu?: number;
    memory?: number;
    instances?: number;
  };
}

/**
 * Scaling decision
 */
export interface ScalingDecision {
  /**
   * Policy name
   */
  policyName: string;
  
  /**
   * Scaling action
   */
  action: ScalingAction;
  
  /**
   * Reason for decision
   */
  reason: string;
  
  /**
   * Recommended resources
   */
  recommendedResources: {
    cpu?: number;
    memory?: number;
    instances?: number;
  };
  
  /**
   * Confidence score (0-1)
   */
  confidence: number;
  
  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Current resource usage
 */
export interface ResourceUsage {
  /**
   * CPU usage percentage (0-100)
   */
  cpuUsage: number;
  
  /**
   * Memory usage percentage (0-100)
   */
  memoryUsage: number;
  
  /**
   * Request rate (requests per second)
   */
  requestRate: number;
  
  /**
   * Current instances
   */
  instances: number;
  
  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Auto-Scaling Manager
 * 
 * Manages automatic scaling based on policies.
 */
export class AutoScalingManager extends EventEmitter {
  private policies: Map<string, ScalingPolicy> = new Map();
  private lastScalingDecision: Map<string, number> = new Map();
  private currentResources: {
    cpu: number;
    memory: number;
    instances: number;
  } = {
    cpu: 1,
    memory: 1024,
    instances: 1,
  };

  constructor() {
    super();
  }

  /**
   * Add scaling policy
   * 
   * @param policy - Scaling policy
   */
  addPolicy(policy: ScalingPolicy): void {
    this.policies.set(policy.name, policy);
    this.emit('policy-added', policy);
  }

  /**
   * Remove scaling policy
   * 
   * @param name - Policy name
   */
  removePolicy(name: string): void {
    this.policies.delete(name);
    this.emit('policy-removed', name);
  }

  /**
   * Evaluate scaling decision
   * 
   * @param usage - Current resource usage
   * @returns Scaling decision
   */
  evaluateScaling(usage: ResourceUsage): ScalingDecision[] {
    const decisions: ScalingDecision[] = [];
    const now = Date.now();

    for (const [name, policy] of this.policies.entries()) {
      // Check cooldown
      const lastDecision = this.lastScalingDecision.get(name);
      if (lastDecision && (now - lastDecision) < (policy.cooldownSeconds || 300) * 1000) {
        continue;
      }

      const decision = this.evaluatePolicy(policy, usage);
      if (decision) {
        decisions.push(decision);
        this.lastScalingDecision.set(name, now);
      }
    }

    return decisions;
  }

  /**
   * Evaluate single policy
   * 
   * @param policy - Scaling policy
   * @param usage - Current resource usage
   * @returns Scaling decision or null
   */
  private evaluatePolicy(policy: ScalingPolicy, usage: ResourceUsage): ScalingDecision | null {
    switch (policy.type) {
      case 'cpu':
        return this.evaluateCPUPolicy(policy, usage);
      case 'memory':
        return this.evaluateMemoryPolicy(policy, usage);
      case 'request_rate':
        return this.evaluateRequestRatePolicy(policy, usage);
      case 'scheduled':
        return this.evaluateScheduledPolicy(policy);
      default:
        return null;
    }
  }

  /**
   * Evaluate CPU-based policy
   */
  private evaluateCPUPolicy(policy: ScalingPolicy, usage: ResourceUsage): ScalingDecision | null {
    const target = policy.targetUtilization || 70;
    const scaleUp = policy.scaleUpThreshold || target + 10;
    const scaleDown = policy.scaleDownThreshold || target - 20;

    if (usage.cpuUsage >= scaleUp) {
      // Scale up
      const newCpu = Math.min(
        policy.maxResources.cpu || 8,
        this.currentResources.cpu * 1.5
      );

      return {
        policyName: policy.name,
        action: 'scale_up',
        reason: `CPU usage ${usage.cpuUsage.toFixed(1)}% exceeds threshold ${scaleUp}%`,
        recommendedResources: {
          cpu: newCpu,
        },
        confidence: 0.9,
        timestamp: Date.now(),
      };
    } else if (usage.cpuUsage <= scaleDown) {
      // Scale down
      const newCpu = Math.max(
        policy.minResources.cpu || 0.5,
        this.currentResources.cpu * 0.7
      );

      return {
        policyName: policy.name,
        action: 'scale_down',
        reason: `CPU usage ${usage.cpuUsage.toFixed(1)}% below threshold ${scaleDown}%`,
        recommendedResources: {
          cpu: newCpu,
        },
        confidence: 0.8,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Evaluate memory-based policy
   */
  private evaluateMemoryPolicy(policy: ScalingPolicy, usage: ResourceUsage): ScalingDecision | null {
    const target = policy.targetUtilization || 70;
    const scaleUp = policy.scaleUpThreshold || target + 10;
    const scaleDown = policy.scaleDownThreshold || target - 20;

    if (usage.memoryUsage >= scaleUp) {
      // Scale up
      const newMemory = Math.min(
        policy.maxResources.memory || 8192,
        this.currentResources.memory * 1.5
      );

      return {
        policyName: policy.name,
        action: 'scale_up',
        reason: `Memory usage ${usage.memoryUsage.toFixed(1)}% exceeds threshold ${scaleUp}%`,
        recommendedResources: {
          memory: newMemory,
        },
        confidence: 0.9,
        timestamp: Date.now(),
      };
    } else if (usage.memoryUsage <= scaleDown) {
      // Scale down
      const newMemory = Math.max(
        policy.minResources.memory || 512,
        this.currentResources.memory * 0.7
      );

      return {
        policyName: policy.name,
        action: 'scale_down',
        reason: `Memory usage ${usage.memoryUsage.toFixed(1)}% below threshold ${scaleDown}%`,
        recommendedResources: {
          memory: newMemory,
        },
        confidence: 0.8,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Evaluate request rate policy
   */
  private evaluateRequestRatePolicy(policy: ScalingPolicy, usage: ResourceUsage): ScalingDecision | null {
    // Scale based on request rate
    const target = policy.targetUtilization || 100; // requests per second
    const scaleUp = policy.scaleUpThreshold || target * 1.5;
    const scaleDown = policy.scaleDownThreshold || target * 0.5;

    if (usage.requestRate >= scaleUp) {
      // Scale up instances
      const newInstances = Math.min(
        policy.maxResources.instances || 10,
        usage.instances + 2
      );

      return {
        policyName: policy.name,
        action: 'scale_up',
        reason: `Request rate ${usage.requestRate.toFixed(1)}/s exceeds threshold ${scaleUp}/s`,
        recommendedResources: {
          instances: newInstances,
        },
        confidence: 0.85,
        timestamp: Date.now(),
      };
    } else if (usage.requestRate <= scaleDown && usage.instances > 1) {
      // Scale down instances
      const newInstances = Math.max(
        policy.minResources.instances || 1,
        usage.instances - 1
      );

      return {
        policyName: policy.name,
        action: 'scale_down',
        reason: `Request rate ${usage.requestRate.toFixed(1)}/s below threshold ${scaleDown}/s`,
        recommendedResources: {
          instances: newInstances,
        },
        confidence: 0.75,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Evaluate scheduled policy
   */
  private evaluateScheduledPolicy(policy: ScalingPolicy): ScalingDecision | null {
    if (!policy.schedule || !policy.scheduledResources) {
      return null;
    }

    // In production, this would parse cron expression
    // For now, just return the scheduled resources
    return {
      policyName: policy.name,
      action: 'maintain',
      reason: `Scheduled scaling: ${policy.schedule}`,
      recommendedResources: policy.scheduledResources,
      confidence: 1.0,
      timestamp: Date.now(),
    };
  }

  /**
   * Apply scaling decision
   * 
   * @param decision - Scaling decision
   */
  applyScalingDecision(decision: ScalingDecision): void {
    if (decision.recommendedResources.cpu) {
      this.currentResources.cpu = decision.recommendedResources.cpu;
    }
    if (decision.recommendedResources.memory) {
      this.currentResources.memory = decision.recommendedResources.memory;
    }
    if (decision.recommendedResources.instances) {
      this.currentResources.instances = decision.recommendedResources.instances;
    }

    this.emit('scaling-applied', {
      decision,
      newResources: { ...this.currentResources },
    });
  }

  /**
   * Get current resources
   */
  getCurrentResources(): {
    cpu: number;
    memory: number;
    instances: number;
  } {
    return { ...this.currentResources };
  }

  /**
   * Get all policies
   */
  getPolicies(): ScalingPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get scaling history
   */
  getScalingHistory(): Array<{
    policyName: string;
    action: ScalingAction;
    timestamp: number;
  }> {
    const history: Array<{
      policyName: string;
      action: ScalingAction;
      timestamp: number;
    }> = [];

    for (const [name, timestamp] of this.lastScalingDecision.entries()) {
      history.push({
        policyName: name,
        action: 'unknown',
        timestamp,
      });
    }

    return history.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Clear all policies
   */
  clear(): void {
    this.policies.clear();
    this.lastScalingDecision.clear();
    this.emit('cleared');
  }
}

/**
 * Create auto-scaling manager
 * 
 * @returns Auto-scaling manager
 */
export function createAutoScalingManager(): AutoScalingManager {
  return new AutoScalingManager();
}

/**
 * Pre-configured scaling policies
 */
export const ScalingPresets = {
  /**
   * Conservative scaling - slow to scale, fast to scale down
   */
  conservative: (name: string) => ({
    name,
    type: 'cpu' as ScalingPolicyType,
    minResources: { cpu: 0.5, memory: 512 },
    maxResources: { cpu: 4, memory: 4096 },
    targetUtilization: 60,
    scaleUpThreshold: 80,
    scaleDownThreshold: 30,
    cooldownSeconds: 600,
  }),

  /**
   * Aggressive scaling - fast to scale, slow to scale down
   */
  aggressive: (name: string) => ({
    name,
    type: 'cpu' as ScalingPolicyType,
    minResources: { cpu: 1, memory: 1024 },
    maxResources: { cpu: 8, memory: 8192 },
    targetUtilization: 50,
    scaleUpThreshold: 60,
    scaleDownThreshold: 20,
    cooldownSeconds: 180,
  }),

  /**
   * Balanced scaling - moderate scaling behavior
   */
  balanced: (name: string) => ({
    name,
    type: 'cpu' as ScalingPolicyType,
    minResources: { cpu: 0.5, memory: 512 },
    maxResources: { cpu: 6, memory: 6144 },
    targetUtilization: 70,
    scaleUpThreshold: 85,
    scaleDownThreshold: 40,
    cooldownSeconds: 300,
  }),

  /**
   * Memory-optimized scaling
   */
  memoryOptimized: (name: string) => ({
    name,
    type: 'memory' as ScalingPolicyType,
    minResources: { cpu: 1, memory: 2048 },
    maxResources: { cpu: 4, memory: 16384 },
    targetUtilization: 60,
    scaleUpThreshold: 75,
    scaleDownThreshold: 30,
    cooldownSeconds: 300,
  }),

  /**
   * High-availability scaling
   */
  highAvailability: (name: string) => ({
    name,
    type: 'request_rate' as ScalingPolicyType,
    minResources: { instances: 2 },
    maxResources: { instances: 20 },
    targetUtilization: 100,
    scaleUpThreshold: 150,
    scaleDownThreshold: 50,
    cooldownSeconds: 120,
  }),
};
