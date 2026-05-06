/**
 * Centralized Agent Logger
 * 
 * Provides structured logging for all agent orchestration components.
 * Ensures consistent log format and metadata across modes.
 */

import { createLogger as createBaseLogger } from '@/lib/utils/logger';

const AGENT_LOG_PREFIX = 'Agent';

/**
 * Create a logger instance for agent orchestration
 * @param context - Optional context (e.g., 'UnifiedAgent', 'ModeSelection', 'Fallback')
 */
export function createAgentLogger(context?: string): ReturnType<typeof createBaseLogger> {
  const name = context ? `${AGENT_LOG_PREFIX}:${context}` : AGENT_LOG_PREFIX;
  return createBaseLogger(name);
}

/**
 * Pre-configured loggers for common agent components
 */
export const agentLoggers = {
  unified: createAgentLogger('UnifiedAgent'),
  modeSelection: createAgentLogger('ModeSelection'),
  fallback: createAgentLogger('Fallback'),
  startup: createAgentLogger('Startup'),
  v1Api: createAgentLogger('V1API'),
  v2Native: createAgentLogger('V2Native'),
  stateful: createAgentLogger('StatefulAgent'),
  progressive: createAgentLogger('ProgressiveBuild'),
  mastra: createAgentLogger('MastraWorkflow'),
  dualProcess: createAgentLogger('DualProcess'),
  cognitive: createAgentLogger('CognitiveResonance'),
  adversarial: createAgentLogger('AdversarialVerify'),
  distributed: createAgentLogger('DistributedCognition'),
};

/**
 * Log helpers for common agent patterns
 */
export const agentLog = {
  /**
   * Log mode entry
   */
  modeEntry: (mode: string, details?: Record<string, unknown>) => {
    agentLoggers.unified.info(`→ ${mode} mode`, details);
  },

  /**
   * Log mode completion
   */
  modeComplete: (mode: string, duration: number, success: boolean) => {
    agentLoggers.unified.info(`← ${mode} mode complete`, { 
      duration, 
      success 
    });
  },

  /**
   * Log fallback attempt
   */
  fallback: (fromMode: string, toMode: string, reason?: string) => {
    agentLoggers.fallback.info(`Falling back: ${fromMode} → ${toMode}`, { reason });
  },

  /**
   * Log error with context
   */
  error: (context: string, error: Error | string, details?: Record<string, unknown>) => {
    const message = error instanceof Error ? error.message : error;
    agentLoggers.unified.error(`Error in ${context}: ${message}`, { 
      ...details, 
      error: error instanceof Error ? error.stack : undefined 
    });
  },

  /**
   * Log startup capability check
   */
  startupCheck: (capability: string, available: boolean, details?: Record<string, unknown>) => {
    agentLoggers.startup.info(`Startup check: ${capability}`, { 
      available, 
      ...details 
    });
  },

  /**
   * Log mode selection decision
   */
  modeSelected: (mode: string, reason?: string) => {
    agentLoggers.modeSelection.info(`Mode selected: ${mode}`, { reason });
  },

  /**
   * Log auto-rotation decision
   */
  autoRotate: (selected: string, alternatives: string[], criteria: Record<string, unknown>) => {
    agentLoggers.modeSelection.info(`Auto-rotation: ${selected}`, { 
      alternatives, 
      criteria 
    });
  },
};
