/**
 * LangGraph Graph Nodes
 *
 * Graph nodes that reuse existing StatefulAgent logic.
 * Each node represents a phase in the agent workflow.
 *
 * @see {@link ../../stateful-agent/agents/stateful-agent.ts} StatefulAgent
 */

import type { AgentStateType, LangGraphError } from '../state';
import { StatefulAgent } from '@/lib/orchestra/stateful-agent/agents';
import { classifyError, globalErrorTracker, ErrorType } from '@/lib/orchestra/stateful-agent/agents/self-healing';

// ============================================================================
// ERROR CONTEXT HELPERS
// ============================================================================

/**
 * Create a typed LangGraphError with self-healing metadata.
 * Uses classifyError() to determine recoverability and generate suggestions.
 */
function createLangGraphError(
  error: unknown,
  step: string,
  operation?: string,
  parameters?: Record<string, unknown>
): LangGraphError {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const errorType = classifyError(error);

  // Track error for pattern analysis
  const errorObj = error instanceof Error ? error : new Error(String(error));
  globalErrorTracker.record(errorObj, { step, operation, toolName: operation, parameters });

  // Determine recoverability and suggestions from the error type
  const recoverable = errorType !== ErrorType.FATAL;
  const suggestions: string[] = [];

  if (errorType === ErrorType.TRANSIENT) {
    suggestions.push('This is a transient error — retrying may resolve it');
    suggestions.push('Check network connectivity if this persists');
  } else if (errorType === ErrorType.VALIDATION) {
    suggestions.push('Check that all required parameters are provided');
    suggestions.push('Verify parameter types match expected schemas');
  } else if (errorType === ErrorType.LOGIC) {
    suggestions.push('The error suggests a logical issue with the approach');
    suggestions.push('Consider using a different tool or method');
    suggestions.push('Break the task into smaller steps');
  } else if (errorType === ErrorType.FATAL) {
    suggestions.push('This error cannot be recovered from automatically');
    suggestions.push('Manual intervention may be required');
  }

  return {
    message,
    step,
    timestamp: new Date().toISOString(),
    operation,
    parameters,
    stack: process.env.NODE_ENV === 'development' ? stack : undefined,
    recoverable,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Extract a clean conversationId from composite sessionId.
 * Used by all nodes to avoid code duplication.
 */
function extractConversationId(sessionId: string): string {
  if (sessionId.includes('$') || sessionId.includes(':')) {
    const separator = sessionId.includes('$') ? '$' : ':';
    return sessionId.slice(sessionId.lastIndexOf(separator) + 1);
  }
  return sessionId;
}

/**
 * Planner Node
 *
 * Creates a detailed plan from user input.
 * Reuses existing StatefulAgent planning phase.
 */
export async function plannerNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const sessionId = state.sessionId;
  const agent = new StatefulAgent({
    sessionId,
    conversationId: extractConversationId(sessionId),
    sandboxHandle: state.sandboxHandle as any,
    enforcePlanActVerify: false, // Planner just plans
  });

  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return { next: 'end', status: 'error' as const };
  }

  try {
    const plan = await agent.runPlanningPhase(lastMessage.content);

    return {
      currentPlan: plan,
      status: 'planning' as const,
      next: 'executor',
    };
  } catch (error) {
    return {
      errors: [...state.errors, createLangGraphError(
        error,
        'planning',
        'runPlanningPhase',
        { message: lastMessage.content }
      )],
      status: 'error' as const,
      next: 'end',
    };
  }
}

/**
 * Executor Node
 *
 * Executes the plan using existing tools.
 * Reuses existing StatefulAgent editing phase.
 */
export async function executorNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const sessionId = state.sessionId;
  const agent = new StatefulAgent({
    sessionId,
    conversationId: extractConversationId(sessionId),
    sandboxHandle: state.sandboxHandle as any,
    enforcePlanActVerify: true,
  });

  try {
    const result = await agent.runEditingPhase(state.currentPlan as any);

    return {
      vfs: result.vfs || state.vfs,
      // @ts-expect-error - transactionLog type mismatch: StatefulAgent uses number timestamp, LangGraph uses string
      transactionLog: result.transactionLog || state.transactionLog,
      status: 'editing' as const,
      next: 'verifier',
    };
  } catch (error) {
    return {
      errors: [...state.errors, createLangGraphError(
        error,
        'execution',
        'runEditingPhase',
        { plan: state.currentPlan as any }
      )],
      status: 'error' as const,
      next: 'self-healing',
    };
  }
}

/**
 * Verifier Node
 *
 * Verifies the execution result.
 * Reuses existing StatefulAgent verification phase.
 */
export async function verifierNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const sessionId = state.sessionId;
  const agent = new StatefulAgent({
    sessionId,
    conversationId: extractConversationId(sessionId),
    sandboxHandle: state.sandboxHandle as any,
    enforcePlanActVerify: false, // Verifier just reviews
  });

  try {
    const verified = await agent.runVerificationPhase() as any;

    if (verified && Array.isArray(verified.errors) && verified.errors.length > 0) {
      const verificationErrors: LangGraphError[] = verified.errors.map((e: any) => ({
        message: e.message || 'Verification failed',
        step: 'verification',
        path: e.path,
        timestamp: new Date().toISOString(),
        operation: 'runVerificationPhase',
        recoverable: true, // Verification errors are usually fixable
        suggestions: ['Review the code for syntax errors', 'Use apply_diff to fix the issues'],
      }));
      return {
        errors: [...state.errors, ...verificationErrors],
        status: 'verifying' as const,
        next: 'self-healing',
      };
    }

    return {
      status: 'verifying' as const,
      next: 'end',
    };
  } catch (error) {
    return {
      errors: [...state.errors, createLangGraphError(
        error,
        'verification',
        'runVerificationPhase',
      )],
      status: 'error' as const,
      next: 'self-healing',
    };
  }
}

/**
 * Self-Healing Node
 *
 * Attempts to fix errors using the self-healing system.
 * Leverages classifyError() and globalErrorTracker for intelligent recovery.
 */
export async function selfHealingNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const MAX_RETRIES = 3;
  const sessionId = state.sessionId;
  const agent = new StatefulAgent({
    sessionId,
    conversationId: extractConversationId(sessionId),
    sandboxHandle: state.sandboxHandle as any,
    maxSelfHealAttempts: MAX_RETRIES,
  });

  // Check if max retries exceeded
  if (state.retryCount >= MAX_RETRIES) {
    return {
      errors: [...state.errors, {
        message: 'Max self-healing attempts exceeded',
        step: 'self-healing',
        timestamp: new Date().toISOString(),
        recoverable: false,
        suggestions: ['Try a completely different approach', 'Break the task into smaller steps'],
      }],
      status: 'error' as const,
      next: 'end',
    };
  }

  // Check for recurring errors via global tracker
  const lastError = state.errors[state.errors.length - 1];
  if (lastError) {
    const recurring = globalErrorTracker.isRecurringError(
      new Error(lastError.message),
      lastError.step
    );
    if (recurring) {
      console.warn('[LangGraph:SelfHealing] Recurring error detected, adjusting strategy');
    }
  }

  try {
    const healed = await agent.runSelfHealingPhase(state.errors as any) as any;

    const newRetryCount = state.retryCount + 1;

    // If healing still has errors, check if we can continue retrying
    if (healed.errors && healed.errors.length > 0) {
      const healingErrors: LangGraphError[] = healed.errors.map((e: any) => ({
        message: e.message || 'Healing attempt failed',
        step: 'self-healing',
        timestamp: new Date().toISOString(),
        operation: 'runSelfHealingPhase',
        recoverable: newRetryCount < MAX_RETRIES,
        suggestions: newRetryCount >= MAX_RETRIES
          ? ['Max retries reached — try a different approach']
          : ['Retrying with corrected approach'],
      }));
      return {
        vfs: healed.vfs || state.vfs,
        transactionLog: healed.transactionLog || state.transactionLog,
        retryCount: newRetryCount,
        errors: healingErrors,
        status: 'error' as const,
        next: newRetryCount < MAX_RETRIES ? 'self-healing' : 'end',
      };
    }

    // Healing succeeded — re-verify
    return {
      vfs: healed.vfs || state.vfs,
      transactionLog: healed.transactionLog || state.transactionLog,
      retryCount: newRetryCount,
      status: 'verifying' as const,
      next: 'verifier',
    };
  } catch (error) {
    return {
      errors: [...state.errors, createLangGraphError(
        error,
        'self-healing',
        'runSelfHealingPhase',
        { errorCount: state.errors.length }
      )],
      retryCount: state.retryCount + 1,
      status: 'error' as const,
      next: 'end',
    };
  }
}

/**
 * Conditional edge function for verifier
 */
export function verifierRouter(state: AgentStateType): string {
  return state.next || 'end';
}

/**
 * Conditional edge function for self-healing
 */
export function selfHealingRouter(state: AgentStateType): string {
  return state.next || 'end';
}

