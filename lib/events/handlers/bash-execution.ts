/**
 * Bash Execution Event Handler
 *
 * Handles bash execution events from the event system.
 * Integrates with existing lib/bash self-healing and VFS persistence.
 *
 * @module events/handlers/bash-execution
 */

import { EventRecord } from '../../store';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:BashExecution');

/**
 * Handler for bash execution events
 * 
 * Delegates to existing lib/bash infrastructure for:
 * - Command execution (executeBashCommand)
 * - Self-healing (executeWithHealing)
 * - VFS persistence
 * - Safety checks
 */
export async function handleBashExecution(event: EventRecord): Promise<any> {
  logger.info('Processing bash execution', { eventId: event.id });

  const { command, agentId, sessionId, workingDir, env, maxRetries = 3, persist = true } = event.payload;

  try {
    // Import existing bash infrastructure
    const { executeBashViaEvent } = await import('@/lib/bash/bash-tool');
    const { createBashExecutionEvent } = await import('@/lib/bash/bash-event-schema');

    // Create typed bash execution event
    const bashEvent = createBashExecutionEvent(command, agentId || sessionId, {
      workingDir,
      env,
      maxRetries,
      persist,
      selfHeal: true,
      timeout: event.payload.timeout || 30000,
    });

    // Execute via existing bash infrastructure
    const result = await executeBashViaEvent(bashEvent);

    return {
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      duration: result.duration,
      outputPath: result.outputPath,
      command: result.command,
      workingDir: result.workingDir,
    };
  } catch (error: any) {
    logger.error('Bash execution failed', { 
      error: error.message,
      command: command?.slice(0, 100),
      sessionId,
    });
    throw error;
  }
}

/**
 * Register bash execution handler
 */
export function registerBashHandler(): void {
  const { registerHandler } = require('../../router');
  const { EventTypes } = require('../../schema');
  
  registerHandler(EventTypes.BASH_EXECUTION, handleBashExecution);
  
  logger.info('Bash execution handler registered');
}
