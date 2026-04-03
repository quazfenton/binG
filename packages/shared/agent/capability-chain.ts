/**
 * Capability Chain System
 *
 * Enables chaining of multiple capabilities into cohesive workflows.
 * Supports:
 * - Sequential chaining (A → B → C)
 * - Parallel chaining (A + B → C)
 * - Conditional chaining (if A then B else C)
 * - Retry chains (A with retry on failure)
 * - Fallback chains (A or fallback to B)
 * - Integration with capabilities.ts definitions
 * - Productive script execution
 *
 * @example
 * ```typescript
 * // Sequential chain: Read → Edit → Verify
 * const chain = createCapabilityChain([
 *   { capability: 'file.read', config: { path: 'src/index.ts' } },
 *   { capability: 'file.write', config: { path: 'src/index.ts', content: '...' } },
 *   { capability: 'sandbox.shell', config: { command: 'npm test' } },
 * ]);
 *
 * const result = await chain.execute();
 * ```
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('CapabilityChain');

export type ChainStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ChainStep {
  id: string;
  capability: string;
  config: Record<string, any>;
  status: ChainStepStatus;
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
}

export interface ChainExecutionResult {
  success: boolean;
  steps: ChainStep[];
  results: Map<string, any>;
  errors: Array<{ step: string; error: string }>;
  duration: number;
}

export interface ChainConfig {
  /** Chain name for logging */
  name?: string;
  /** Enable parallel execution where possible */
  enableParallel?: boolean;
  /** Stop on first failure (default: false - continue with remaining steps) */
  stopOnFailure?: boolean;
  /** Global timeout in milliseconds */
  timeout?: number;
  /** Context to pass between steps */
  context?: Record<string, any>;
}

/**
 * Capability Chain Builder
 */
export class CapabilityChain {
  private steps: ChainStep[] = [];
  private config: ChainConfig;
  private executionOrder: string[][] = []; // Groups of step IDs that can run in parallel

  constructor(config: ChainConfig = {}) {
    this.config = {
      name: 'Unnamed Chain',
      enableParallel: false,
      stopOnFailure: false,
      timeout: 300000, // 5 minutes
      context: {},
      ...config,
    };
  }

  /**
   * Add a step to the chain
   */
  addStep(capability: string, config: Record<string, any>, options?: {
    id?: string;
    maxRetries?: number;
    dependsOn?: string[];
  }): CapabilityChain {
    const id = options?.id || `step-${this.steps.length + 1}`;
    
    this.steps.push({
      id,
      capability,
      config,
      status: 'pending',
      retryCount: 0,
      maxRetries: options?.maxRetries || 0,
    });

    // Add to execution order
    if (options?.dependsOn && options.dependsOn.length > 0) {
      // This step depends on previous steps
      this.executionOrder.push([id]);
    } else if (this.config.enableParallel && this.steps.length > 1) {
      // Can run in parallel with previous step
      const lastGroup = this.executionOrder[this.executionOrder.length - 1];
      if (lastGroup) {
        lastGroup.push(id);
      } else {
        this.executionOrder.push([id]);
      }
    } else {
      // Sequential execution
      this.executionOrder.push([id]);
    }

    return this;
  }

  /**
   * Add conditional step
   */
  addConditionalStep(
    condition: (context: Record<string, any>) => boolean,
    capability: string,
    config: Record<string, any>,
    options?: { id?: string }
  ): CapabilityChain {
    const id = options?.id || `conditional-${this.steps.length + 1}`;
    
    this.steps.push({
      id,
      capability,
      config,
      status: 'pending',
      retryCount: 0,
      maxRetries: 0,
    });

    // Store condition in config for execution
    this.steps[this.steps.length - 1].config._condition = condition;
    this.executionOrder.push([id]);

    return this;
  }

  /**
   * Execute the chain
   */
  async execute(executor: CapabilityExecutor): Promise<ChainExecutionResult> {
    const startTime = Date.now();
    const results = new Map<string, any>();
    const errors: Array<{ step: string; error: string }> = [];

    log.info('Starting capability chain execution', {
      name: this.config.name,
      stepCount: this.steps.length,
      enableParallel: this.config.enableParallel,
    });

    try {
      // Execute steps in order
      for (const stepGroup of this.executionOrder) {
        if (this.config.enableParallel) {
          // Execute group in parallel
          await Promise.all(
            stepGroup.map(stepId => this.executeStep(stepId, executor, results, errors))
          );
        } else {
          // Execute sequentially
          for (const stepId of stepGroup) {
            await this.executeStep(stepId, executor, results, errors);
            
            // Check if we should stop on failure
            if (this.config.stopOnFailure && errors.length > 0) {
              log.warn('Stopping chain due to failure', {
                name: this.config.name,
                failedStep: stepId,
              });
              break;
            }
          }
        }

        // Check timeout
        if (this.config.timeout && (Date.now() - startTime) > this.config.timeout) {
          throw new Error(`Chain execution timeout (${this.config.timeout}ms)`);
        }
      }

      const duration = Date.now() - startTime;
      const success = errors.length === 0;

      log.info('Capability chain execution completed', {
        name: this.config.name,
        success,
        duration: `${Math.round(duration / 1000)}s`,
        stepsCompleted: this.steps.filter(s => s.status === 'completed').length,
        stepsFailed: this.steps.filter(s => s.status === 'failed').length,
        errors: errors.length,
      });

      return {
        success,
        steps: this.steps,
        results,
        errors,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      log.error('Capability chain execution failed', {
        name: this.config.name,
        error: error.message,
        duration: `${Math.round(duration / 1000)}s`,
      });

      return {
        success: false,
        steps: this.steps,
        results,
        errors: [...errors, { step: 'chain', error: error.message }],
        duration,
      };
    }
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStep(
    stepId: string,
    executor: CapabilityExecutor,
    results: Map<string, any>,
    errors: Array<{ step: string; error: string }>
  ): Promise<void> {
    const step = this.steps.find(s => s.id === stepId);
    if (!step) return;

    // Check condition if present
    if (step.config._condition) {
      const context = { ...this.config.context, ...Object.fromEntries(results) };
      const shouldExecute = step.config._condition(context);
      
      if (!shouldExecute) {
        step.status = 'skipped';
        log.debug('Step skipped due to condition', { step: stepId });
        return;
      }
      
      // Remove condition from config before execution
      delete step.config._condition;
    }

    // Execute with retries
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      step.status = 'running';
      step.startedAt = Date.now();

      try {
        log.debug('Executing step', {
          step: stepId,
          capability: step.capability,
          attempt: attempt + 1,
          maxRetries: step.maxRetries,
        });

        const result = await executor.execute(step.capability, step.config, {
          stepId,
          chainName: this.config.name,
          previousResults: Object.fromEntries(results),
        });

        step.status = 'completed';
        step.completedAt = Date.now();
        step.result = result;
        results.set(stepId, result);

        log.debug('Step completed', {
          step: stepId,
          capability: step.capability,
          duration: `${step.completedAt - step.startedAt}ms`,
        });

        return;
      } catch (error: any) {
        lastError = error;
        log.warn('Step failed', {
          step: stepId,
          capability: step.capability,
          attempt: attempt + 1,
          error: error.message,
        });

        if (attempt < step.maxRetries) {
          // Wait before retry (exponential backoff)
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    step.status = 'failed';
    step.completedAt = Date.now();
    step.error = lastError?.message || 'Unknown error';
    errors.push({ step: stepId, error: step.error });

    log.error('Step failed after all retries', {
      step: stepId,
      capability: step.capability,
      retries: step.maxRetries,
      error: step.error,
    });
  }

  /**
   * Get chain statistics
   */
  getStats() {
    return {
      totalSteps: this.steps.length,
      completed: this.steps.filter(s => s.status === 'completed').length,
      failed: this.steps.filter(s => s.status === 'failed').length,
      pending: this.steps.filter(s => s.status === 'pending').length,
      skipped: this.steps.filter(s => s.status === 'skipped').length,
    };
  }
}

/**
 * Capability executor interface
 */
export interface CapabilityExecutor {
  execute(
    capability: string,
    config: Record<string, any>,
    context: {
      stepId: string;
      chainName: string;
      previousResults: Record<string, any>;
    }
  ): Promise<any>;
}

/**
 * Create a capability chain
 */
export function createCapabilityChain(config?: ChainConfig): CapabilityChain {
  return new CapabilityChain(config);
}

/**
 * Quick chain builder for simple sequential chains
 */
export function chain(
  steps: Array<{ capability: string; config: Record<string, any> }>,
  config?: ChainConfig
): CapabilityChain {
  const chain = new CapabilityChain(config);
  
  for (const step of steps) {
    chain.addStep(step.capability, step.config);
  }
  
  return chain;
}
