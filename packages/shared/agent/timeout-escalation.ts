/**
 * Timeout Escalation Strategy
 *
 * Staged timeout approach for agent task execution:
 *   Stage 1: Warn (soft timeout)
 *   Stage 2: Migrate sandbox (medium timeout)
 *   Stage 3: Terminate (hard timeout)
 *
 * Prevents resource waste by taking progressively aggressive actions
 * instead of a single hard cutoff.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Agent:TimeoutEscalation');

export type EscalationAction = 'continue' | 'warn' | 'migrate' | 'terminate';

export interface EscalationStage {
  /** Timeout threshold in milliseconds */
  timeoutMs: number;
  /** Action to take when this stage is reached */
  action: EscalationAction;
  /** Optional callback when stage triggers */
  onTrigger?: (context: EscalationContext) => void | Promise<void>;
}

export interface EscalationConfig {
  /** Ordered stages (must be in ascending timeoutMs order) */
  stages: EscalationStage[];
  /** Check interval in milliseconds (default: 1000) */
  checkIntervalMs: number;
}

export interface EscalationContext {
  /** Task/operation identifier */
  taskId: string;
  /** Time elapsed since start in ms */
  elapsedMs: number;
  /** Current escalation stage index */
  stageIndex: number;
  /** Current action being taken */
  action: EscalationAction;
  /** Total stages configured */
  totalStages: number;
}

export interface EscalationResult<T> {
  /** Whether the operation completed successfully */
  success: boolean;
  /** The operation result (if successful) */
  result?: T;
  /** Final escalation action taken */
  finalAction: EscalationAction;
  /** Total elapsed time in ms */
  elapsedMs: number;
  /** Number of escalation stages triggered */
  stagesTriggered: number;
  /** Error message (if terminated) */
  error?: string;
}

const DEFAULT_STAGES: EscalationStage[] = [
  { timeoutMs: 10_000, action: 'warn' },
  { timeoutMs: 30_000, action: 'migrate' },
  { timeoutMs: 60_000, action: 'terminate' },
];

const DEFAULT_CONFIG: EscalationConfig = {
  stages: DEFAULT_STAGES,
  checkIntervalMs: 1000,
};

/**
 * Timeout Escalation Engine
 *
 * Wraps async operations with staged timeout handling.
 */
export class TimeoutEscalation {
  private config: EscalationConfig;

  constructor(config?: Partial<EscalationConfig>) {
    const stages = config?.stages || DEFAULT_STAGES;
    // Sort stages by timeout ascending
    const sorted = [...stages].sort((a, b) => a.timeoutMs - b.timeoutMs);

    this.config = {
      stages: sorted,
      checkIntervalMs: config?.checkIntervalMs ?? DEFAULT_CONFIG.checkIntervalMs,
    };
  }

  /**
   * Execute an async operation with staged timeout escalation.
   *
   * The operation runs freely. A background timer monitors elapsed time
   * and fires escalation callbacks at each stage threshold. If the final
   * stage is 'terminate', the returned promise rejects with a timeout error.
   */
  async executeWithEscalation<T>(
    taskId: string,
    operation: (signal: AbortSignal) => Promise<T>,
    onEscalation?: (ctx: EscalationContext) => void | Promise<void>,
  ): Promise<EscalationResult<T>> {
    const startTime = Date.now();
    const abortController = new AbortController();
    let stagesTriggered = 0;
    let currentAction: EscalationAction = 'continue';
    const triggeredStages = new Set<number>();

    logger.info('Starting escalation-wrapped execution', {
      taskId,
      stages: this.config.stages.length,
      finalTimeoutMs: this.config.stages[this.config.stages.length - 1]?.timeoutMs,
    });

    // Background escalation monitor
    const monitorPromise = new Promise<never>((_, reject) => {
      const interval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        for (let i = 0; i < this.config.stages.length; i++) {
          const stage = this.config.stages[i];
          if (elapsed >= stage.timeoutMs && !triggeredStages.has(i)) {
            triggeredStages.add(i);
            stagesTriggered++;
            currentAction = stage.action;

            const ctx: EscalationContext = {
              taskId,
              elapsedMs: elapsed,
              stageIndex: i,
              action: stage.action,
              totalStages: this.config.stages.length,
            };

            logger.warn('Escalation stage triggered', {
              taskId,
              stage: i + 1,
              action: stage.action,
              elapsedMs: elapsed,
              thresholdMs: stage.timeoutMs,
            });

            // Fire stage-specific callback
            try {
              await stage.onTrigger?.(ctx);
            } catch (err) {
              logger.error('Escalation stage callback failed', {
                taskId,
                stage: i,
                error: err instanceof Error ? err.message : String(err),
              });
            }

            // Fire general escalation callback
            try {
              await onEscalation?.(ctx);
            } catch (err) {
              logger.error('Escalation callback failed', {
                taskId,
                stage: i,
                error: err instanceof Error ? err.message : String(err),
              });
            }

            // If terminate, abort and reject
            if (stage.action === 'terminate') {
              clearInterval(interval);
              abortController.abort();
              reject(new Error(
                `Task ${taskId} terminated after ${elapsed}ms (stage ${i + 1}/${this.config.stages.length})`
              ));
              return;
            }
          }
        }
      }, this.config.checkIntervalMs);

      // Cleanup on abort (operation completed before timeout)
      abortController.signal.addEventListener('abort', () => {
        clearInterval(interval);
      }, { once: true });
    });

    try {
      // Race operation against escalation monitor
      const result = await Promise.race([
        operation(abortController.signal),
        monitorPromise,
      ]);

      // Operation completed — stop the monitor
      abortController.abort();

      const elapsed = Date.now() - startTime;
      logger.info('Operation completed within escalation window', {
        taskId,
        elapsedMs: elapsed,
        stagesTriggered,
      });

      return {
        success: true,
        result,
        finalAction: currentAction,
        elapsedMs: elapsed,
        stagesTriggered,
      };
    } catch (error: any) {
      abortController.abort();

      const elapsed = Date.now() - startTime;
      logger.error('Operation failed or terminated', {
        taskId,
        elapsedMs: elapsed,
        stagesTriggered,
        finalAction: currentAction,
        error: error.message,
      });

      return {
        success: false,
        finalAction: currentAction,
        elapsedMs: elapsed,
        stagesTriggered,
        error: error.message,
      };
    }
  }

  /**
   * Get the configured stages (for inspection/testing).
   */
  getStages(): readonly EscalationStage[] {
    return this.config.stages;
  }
}

/**
 * Pre-configured escalation profiles
 */
export const ESCALATION_PROFILES = {
  /** Quick tasks: 5s warn, 15s migrate, 30s terminate */
  quick: new TimeoutEscalation({
    stages: [
      { timeoutMs: 5_000, action: 'warn' },
      { timeoutMs: 15_000, action: 'migrate' },
      { timeoutMs: 30_000, action: 'terminate' },
    ],
  }),

  /** Standard tasks: 10s warn, 30s migrate, 60s terminate */
  standard: new TimeoutEscalation({
    stages: [
      { timeoutMs: 10_000, action: 'warn' },
      { timeoutMs: 30_000, action: 'migrate' },
      { timeoutMs: 60_000, action: 'terminate' },
    ],
  }),

  /** Thorough tasks: 30s warn, 120s migrate, 300s terminate */
  thorough: new TimeoutEscalation({
    stages: [
      { timeoutMs: 30_000, action: 'warn' },
      { timeoutMs: 120_000, action: 'migrate' },
      { timeoutMs: 300_000, action: 'terminate' },
    ],
  }),

  /** Long-running builds: 60s warn, 300s migrate, 600s terminate */
  build: new TimeoutEscalation({
    stages: [
      { timeoutMs: 60_000, action: 'warn' },
      { timeoutMs: 300_000, action: 'migrate' },
      { timeoutMs: 600_000, action: 'terminate' },
    ],
  }),
} as const;

/**
 * Create a timeout escalation with custom stages
 */
export function createTimeoutEscalation(config?: Partial<EscalationConfig>): TimeoutEscalation {
  return new TimeoutEscalation(config);
}