/**
 * LangGraph Graph Nodes
 *
 * Graph nodes that reuse existing StatefulAgent logic.
 * Each node represents a phase in the agent workflow.
 *
 * @see {@link ../../stateful-agent/agents/stateful-agent.ts} StatefulAgent
 */

import type { AgentStateType } from '../state';
import { StatefulAgent } from '@/lib/stateful-agent/agents/stateful-agent';
import type { SandboxHandle } from '@/lib/sandbox/providers';

/**
 * Enhanced error interface for better self-healing
 */
interface EnhancedError {
  message: string;
  step: string;
  timestamp: string;
  operation?: string;
  parameters?: any;
  stack?: string;
  recoverable: boolean;
  suggestions?: string[];
}

/**
 * Helper function to create enhanced error from Error object
 */
function createEnhancedError(
  error: any,
  step: string,
  operation?: string,
  parameters?: any
): EnhancedError {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // Determine if error is recoverable
  const recoverable = !message.includes('fatal') &&
                      !message.includes('unrecoverable') &&
                      !message.includes('permission denied');

  // Generate suggestions based on error type
  const suggestions: string[] = [];
  if (message.includes('not found') || message.includes('404')) {
    suggestions.push('Check if the file/resource exists before accessing');
    suggestions.push('Use list_files to discover available resources');
  } else if (message.includes('permission') || message.includes('unauthorized')) {
    suggestions.push('Check authentication/authorization settings');
    suggestions.push('Ensure proper credentials are configured');
  } else if (message.includes('timeout')) {
    suggestions.push('Consider breaking the operation into smaller chunks');
    suggestions.push('Check network connectivity');
  } else if (message.includes('syntax') || message.includes('parse')) {
    suggestions.push('Review the code syntax before execution');
    suggestions.push('Use syntax_check tool before running code');
  }

  return {
    message,
    step,
    timestamp: new Date().toISOString(),
    operation,
    parameters,
    stack,
    recoverable,
    suggestions,
  };
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
    sandboxHandle: state.sandboxHandle,
    enforcePlanActVerify: false, // Planner just plans
  });

  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return { next: 'end' };
  }

  try {
    const plan = await agent.runPlanningPhase(lastMessage.content);

    return {
      currentPlan: plan,
      next: 'executor',
    };
  } catch (error) {
    return {
      errors: [...state.errors, createEnhancedError(
        error,
        'planning',
        'runPlanningPhase',
        { message: lastMessage.content }
      )],
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
    sandboxHandle: state.sandboxHandle,
    enforcePlanActVerify: true,
  });

  try {
    const result = await agent.runEditingPhase(state.currentPlan);

    return {
      vfs: result.vfs || state.vfs,
      // @ts-ignore - transactionLog may have legacy format from StatefulAgent
      transactionLog: result.transactionLog || state.transactionLog,
      next: 'verifier',
    };
  } catch (error) {
    return {
      errors: [...state.errors, createEnhancedError(
        error,
        'execution',
        'runEditingPhase',
        { plan: state.currentPlan }
      )],
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
    sandboxHandle: state.sandboxHandle,
    enforcePlanActVerify: false, // Verifier just reviews
  });

  try {
    const verified = await agent.runVerificationPhase();

    // @ts-ignore - verified may have errors property from StatefulAgent
    if (verified && 'errors' in verified && verified.errors && verified.errors.length > 0) {
      return {
        errors: [...state.errors, ...verified.errors.map((e: any) => ({
          ...e,
          step: 'verification',
          timestamp: new Date().toISOString(),
          recoverable: true, // Verification errors are usually fixable
          suggestions: ['Review the code for syntax errors', 'Use apply_diff to fix the issues'],
        }))],
        next: 'self-healing',
      };
    }

    return {
      next: 'end',
    };
  } catch (error) {
    return {
      errors: [...state.errors, createEnhancedError(
        error,
        'verification',
        'runVerificationPhase',
        { vfs: state.vfs }
      )],
      next: 'self-healing',
    };
  }
}

/**
 * Self-Healing Node
 *
 * Attempts to fix errors.
 * Reuses existing StatefulAgent self-healing phase.
 */
export async function selfHealingNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const sessionId = state.sessionId;
  const agent = new StatefulAgent({
    sessionId,
    sandboxHandle: state.sandboxHandle,
    maxSelfHealAttempts: 3,
  });

  // Check if max retries exceeded
  if (state.retryCount >= 3) {
    return {
      errors: [...state.errors, {
        message: 'Max self-healing attempts exceeded',
        step: 'self-healing',
        timestamp: new Date().toISOString(),
        recoverable: false,
        suggestions: ['Try a completely different approach', 'Break the task into smaller steps'],
      }],
      next: 'end',
    };
  }

  try {
    const healed = await agent.runSelfHealingPhase(state.errors);

    if (healed.errors && healed.errors.length > 0) {
      return {
        vfs: healed.vfs || state.vfs,
        // @ts-ignore - transactionLog may have legacy format from StatefulAgent
        transactionLog: healed.transactionLog || state.transactionLog,
        retryCount: state.retryCount + 1,
        errors: healed.errors.map((e: any) => ({
          ...e,
          step: 'self-healing',
          timestamp: new Date().toISOString(),
        })),
        next: 'self-healing', // Retry
      };
    }

    return {
      vfs: healed.vfs || state.vfs,
      // @ts-ignore - transactionLog may have legacy format from StatefulAgent
      transactionLog: healed.transactionLog || state.transactionLog,
      retryCount: state.retryCount + 1,
      next: 'verifier', // Re-verify after healing
    };
  } catch (error) {
    return {
      errors: [...state.errors, createEnhancedError(
        error,
        'self-healing',
        'runSelfHealingPhase',
        { errors: state.errors }
      )],
      retryCount: state.retryCount + 1,
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
