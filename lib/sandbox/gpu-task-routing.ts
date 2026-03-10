/**
 * Phase 3: GPU Task Routing
 * 
 * Intelligent routing of GPU-accelerated tasks:
 * - ML model training
 * - Inference workloads
 * - Data processing with GPU
 * - Video/image processing
 * 
 * Provider support detection:
 * - Providers with GPU instances
 * - Fallback to CPU when GPU unavailable
 * - Cost optimization (GPU vs CPU pricing)
 * 
 * @example
 * ```typescript
 * import { gpuTaskRouting } from '@/lib/sandbox/phase3-integration';
 * 
 * // Check GPU availability
 * const available = await gpuTaskRouting.checkGPUAvailability('daytona');
 * 
 * // Route ML training task
 * const { provider, sandbox } = await gpuTaskRouting.routeMLTask({
 *   model: 'transformer',
 *   datasetSize: '1GB',
 *   trainingTime: '2h',
 * });
 * 
 * // Run GPU-accelerated training
 * const result = await sandbox.executeCommand('python train.py --gpu');
 * ```
 */

import { getSandboxProvider, type SandboxProviderType } from './providers';
import { createLogger } from '../utils/logger';

const logger = createLogger('Phase3:GPUTaskRouting');

/**
 * GPU task type
 */
export type GPUTaskType =
  | 'ml-training'
  | 'ml-inference'
  | 'data-processing'
  | 'video-processing'
  | 'image-processing'
  | 'scientific-computing'
  | 'rendering';

/**
 * GPU requirements
 */
export interface GPURequirements {
  /** Task type */
  taskType: GPUTaskType;
  
  /** Required VRAM (GB) */
  requiredVRAM?: number;
  
  /** Preferred GPU type */
  gpuType?: 'nvidia' | 'amd' | 'any';
  
  /** Max budget (USD/hour) */
  maxBudget?: number;
  
  /** Training/inference duration */
  duration?: 'short' | 'medium' | 'long';
  
  /** Dataset size */
  datasetSize?: 'small' | 'medium' | 'large';
}

/**
 * GPU availability info
 */
export interface GPUAvailability {
  available: boolean;
  provider: SandboxProviderType;
  gpuType?: string;
  vramGB?: number;
  costPerHour?: number;
  estimatedWaitTime?: number;
}

/**
 * GPU Task Routing
 */
export class GPUTaskRouting {
  /**
   * GPU-capable providers (as of 2024)
   */
  private readonly gpuProviders: Array<{
    type: SandboxProviderType;
    gpuTypes: string[];
    vramGB: number;
    costPerHour: number;
  }> = [
    // Note: Update as providers add GPU support
    { type: 'daytona', gpuTypes: ['nvidia-t4', 'nvidia-v100'], vramGB: 16, costPerHour: 0.50 },
    { type: 'e2b', gpuTypes: ['nvidia-t4'], vramGB: 16, costPerHour: 0.45 },
  ];
  
  /**
   * Check GPU availability for provider
   */
  async checkGPUAvailability(providerType: SandboxProviderType): Promise<GPUAvailability> {
    try {
      const providerInfo = this.gpuProviders.find(p => p.type === providerType);
      
      if (!providerInfo) {
        return {
          available: false,
          provider: providerType,
        };
      }
      
      // Check quota
      const { quotaManager } = await import('../services/quota-manager');
      const quotaCheck = quotaManager.checkQuota(providerType);
      
      if (!quotaCheck.allowed) {
        return {
          available: false,
          provider: providerType,
        };
      }
      
      return {
        available: true,
        provider: providerType,
        gpuType: providerInfo.gpuTypes[0],
        vramGB: providerInfo.vramGB,
        costPerHour: providerInfo.costPerHour,
      };
    } catch (error: any) {
      logger.error('GPU availability check failed:', error);
      return {
        available: false,
        provider: providerType,
      };
    }
  }
  
  /**
   * Get all GPU-capable providers
   */
  getGPUProviders(): Array<{
    type: SandboxProviderType;
    gpuTypes: string[];
    vramGB: number;
    costPerHour: number;
  }> {
    return [...this.gpuProviders];
  }
  
  /**
   * Route ML task to optimal GPU provider
   */
  async routeMLTask(requirements: GPURequirements): Promise<{
    provider: SandboxProviderType;
    sandbox?: any;
    error?: string;
  }> {
    // Find suitable GPU providers
    const suitableProviders = this.gpuProviders.filter(p => {
      // Check VRAM requirements
      if (requirements.requiredVRAM && p.vramGB < requirements.requiredVRAM) {
        return false;
      }
      
      // Check GPU type preference
      if (requirements.gpuType && requirements.gpuType !== 'any') {
        const hasType = p.gpuTypes.some(t => t.toLowerCase().includes(requirements.gpuType!));
        if (!hasType) return false;
      }
      
      // Check budget
      if (requirements.maxBudget && p.costPerHour > requirements.maxBudget) {
        return false;
      }
      
      return true;
    });
    
    if (suitableProviders.length === 0) {
      // Fallback to CPU
      logger.warn('No GPU providers match requirements, falling back to CPU');
      return {
        provider: 'daytona', // Default CPU provider
        error: 'GPU not available, using CPU',
      };
    }
    
    // Select cheapest suitable provider
    const selected = suitableProviders.sort((a, b) => a.costPerHour - b.costPerHour)[0];
    
    // Check availability
    const availability = await this.checkGPUAvailability(selected.type);
    
    if (!availability.available) {
      // Try next provider
      const nextBest = suitableProviders[1];
      if (nextBest) {
        return { provider: nextBest.type };
      }
      
      return {
        provider: 'daytona',
        error: 'GPU unavailable, using CPU',
      };
    }
    
    // Create sandbox
    try {
      const provider = await getSandboxProvider(selected.type);
      const sandbox = await provider.createSandbox({
        language: 'python',
        envVars: {
          CUDA_VISIBLE_DEVICES: '0',
          TF_FORCE_GPU_ALLOW_GROWTH: 'true',
        },
      });
      
      logger.info(`Created GPU sandbox on ${selected.type} (${availability.gpuType})`);
      
      return { provider: selected.type, sandbox };
    } catch (error: any) {
      logger.error('Failed to create GPU sandbox:', error);
      return {
        provider: 'daytona',
        error: 'Failed to create GPU sandbox',
      };
    }
  }
  
  /**
   * Get cost estimate for GPU task
   */
  getCostEstimate(
    taskType: GPUTaskType,
    durationHours: number,
    providerType?: SandboxProviderType
  ): { estimatedCost: number; currency: string; provider?: SandboxProviderType } {
    const provider = providerType 
      ? this.gpuProviders.find(p => p.type === providerType)
      : this.gpuProviders[0];
    
    if (!provider) {
      return {
        estimatedCost: 0,
        currency: 'USD',
      };
    }
    
    // Task-specific multipliers
    const multipliers: Record<GPUTaskType, number> = {
      'ml-training': 1.5,
      'ml-inference': 1.0,
      'data-processing': 1.2,
      'video-processing': 2.0,
      'image-processing': 1.3,
      'scientific-computing': 1.4,
      'rendering': 1.8,
    };
    
    const multiplier = multipliers[taskType] || 1.0;
    const estimatedCost = provider.costPerHour * durationHours * multiplier;
    
    return {
      estimatedCost,
      currency: 'USD',
      provider: provider.type,
    };
  }
  
  /**
   * Check if task should use GPU
   */
  shouldUseGPU(requirements: GPURequirements): boolean {
    // ML training always benefits from GPU
    if (requirements.taskType === 'ml-training') {
      return true;
    }
    
    // Large dataset processing
    if (requirements.datasetSize === 'large') {
      return true;
    }
    
    // Long duration tasks
    if (requirements.duration === 'long') {
      return true;
    }
    
    // High VRAM requirements
    if (requirements.requiredVRAM && requirements.requiredVRAM > 8) {
      return true;
    }
    
    return false;
  }
}

/**
 * Singleton instance
 */
export const gpuTaskRouting = new GPUTaskRouting();

/**
 * Convenience functions
 */
export const checkGPUAvailability = (providerType: SandboxProviderType) =>
  gpuTaskRouting.checkGPUAvailability(providerType);

export const getGPUProviders = () =>
  gpuTaskRouting.getGPUProviders();

export const routeMLTask = (requirements: GPURequirements) =>
  gpuTaskRouting.routeMLTask(requirements);

export const getCostEstimate = (taskType: GPUTaskType, durationHours: number, providerType?: SandboxProviderType) =>
  gpuTaskRouting.getCostEstimate(taskType, durationHours, providerType);

export const shouldUseGPU = (requirements: GPURequirements) =>
  gpuTaskRouting.shouldUseGPU(requirements);
