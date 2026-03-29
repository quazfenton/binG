/**
 * Orchestration Mode Handler
 *
 * Routes agent requests to the appropriate orchestration backend based on
 * the X-Orchestration-Mode header.
 *
 * Supported modes:
 * - task-router (default): lib/agent/task-router.ts
 * - unified-agent: lib/orchestra/unified-agent-service.ts
 * - mastra-workflow: lib/agent/mastra-workflow-integration.ts
 * - crewai: lib/crewai/
 * - v2-executor: lib/agent/v2-executor.ts
 *
 * @example
 * ```typescript
 * // Client-side: Set orchestration mode
 * const headers = getOrchestrationModeHeaders({ mode: 'unified-agent' });
 * fetch('/api/chat', { headers });
 *
 * // Server-side: Route request
 * const mode = getOrchestrationModeFromRequest(req);
 * const result = await executeWithOrchestrationMode(mode, { task, sessionId, ownerId });
 * ```
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { createHash } from 'crypto';

const logger = createLogger('Agent:OrchestrationMode');

/**
 * Hash task content for logging (prevents leaking secrets while allowing correlation)
 */
async function hashTask(content: string): Promise<string> {
  if (!content) return 'empty';
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex').substring(0, 16);
}

export type OrchestrationMode = 
  | 'task-router'
  | 'unified-agent'
  | 'mastra-workflow'
  | 'crewai'
  | 'v2-executor';

export interface OrchestrationRequest {
  task: string;
  sessionId?: string;
  ownerId?: string;
  stream?: boolean;
  mode?: OrchestrationMode;
  [key: string]: any;
}

export interface OrchestrationResult {
  success: boolean;
  response?: string;
  steps?: any[];
  error?: string;
  metadata?: {
    agentType: string;
    [key: string]: any;
  };
}

/**
 * Parse orchestration mode from request headers
 */
export function getOrchestrationModeFromRequest(req: NextRequest): OrchestrationMode {
  const modeHeader = req.headers.get('X-Orchestration-Mode');
  
  if (!modeHeader) {
    return 'task-router'; // Default
  }
  
  const validModes: OrchestrationMode[] = ['task-router', 'unified-agent', 'mastra-workflow', 'crewai', 'v2-executor'];
  const mode = modeHeader.toLowerCase() as OrchestrationMode;
  
  if (!validModes.includes(mode)) {
    logger.warn('Invalid orchestration mode, falling back to task-router', { mode: modeHeader });
    return 'task-router';
  }
  
  return mode;
}

/**
 * Execute task with selected orchestration mode
 *
 * @param mode - Orchestration mode to use
 * @param request - Request parameters
 * @returns Orchestration result with response and metadata
 *
 * @throws Error if mode execution fails (caught and returned as error result)
 */
export async function executeWithOrchestrationMode(
  mode: OrchestrationMode,
  request: OrchestrationRequest
): Promise<OrchestrationResult> {
  const startTime = Date.now();

  // Validate required identifiers - don't collapse to 'default' to maintain isolation
  if (!request.ownerId) {
    throw new Error('ownerId is required for orchestration. Missing user identity breaks isolation.');
  }
  if (!request.sessionId) {
    throw new Error('sessionId is required for orchestration. Missing conversation ID breaks isolation.');
  }

  // Log without raw task content (security: prevent leaking secrets/tokens in logs)
  const taskHash = await hashTask(request.task);
  logger.info('Executing with orchestration mode', {
    mode,
    taskLength: request.task?.length || 0,
    taskHash,
    sessionId: request.sessionId,
    ownerId: request.ownerId,
  });

  try {
    let result: OrchestrationResult;
    
    switch (mode) {
      // ========================================================================
      // TASK ROUTER (Default)
      // ========================================================================
      case 'task-router': {
        const { taskRouter } = await import('@/lib/agent/task-router');

        // ownerId and sessionId already validated at function entry
        const taskResult = await taskRouter.executeTask({
          id: request.sessionId,
          userId: request.ownerId,
          conversationId: request.sessionId,
          task: request.task,
          stream: request.stream,
        });

        result = {
          success: taskResult.success,
          response: taskResult.response,
          steps: taskResult.steps,
          metadata: {
            agentType: 'task-router',
            routingTarget: taskResult.target,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // UNIFIED AGENT SERVICE
      // ========================================================================
      case 'unified-agent': {
        const { processUnifiedAgentRequest } = await import('@/lib/orchestra/unified-agent-service');

        const unifiedResult = await processUnifiedAgentRequest({
          userMessage: request.task,
          sandboxId: request.sessionId,
          systemPrompt: process.env.OPENCODE_SYSTEM_PROMPT,
          maxSteps: parseInt(process.env.AI_SDK_MAX_STEPS || '15', 10),
          mode: 'auto', // Let unified agent auto-select best execution mode
        });

        result = {
          success: unifiedResult.success,
          response: unifiedResult.response,
          steps: unifiedResult.steps,
          error: unifiedResult.error,
          metadata: {
            agentType: 'unified-agent',
            selectedMode: unifiedResult.mode,
            totalSteps: unifiedResult.totalSteps,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // MASTRA WORKFLOW
      // ========================================================================
      case 'mastra-workflow': {
        const { mastraWorkflowIntegration } = await import('@/lib/agent/mastra-workflow-integration');

        const workflowId = 'code-agent'; // Default workflow
        // ownerId already validated at function entry
        const workflowResult = await mastraWorkflowIntegration.executeWorkflow(workflowId, {
          task: request.task,
          ownerId: request.ownerId,
        });

        result = {
          success: workflowResult.success,
          response: workflowResult.result?.response || workflowResult.result?.content || 'Workflow completed',
          steps: workflowResult.steps,
          error: workflowResult.error,
          metadata: {
            agentType: 'mastra-workflow',
            workflowId,
            duration: workflowResult.duration || (Date.now() - startTime),
          },
        };
        break;
      }

      // ========================================================================
      // CREWAI
      // ========================================================================
      case 'crewai': {
        const { runCrewAI } = await import('@/lib/crewai');

        // sessionId already validated at function entry
        const crewResult = await runCrewAI({
          sessionId: request.sessionId,
          userMessage: request.task,
        });

        result = {
          success: crewResult.success,
          response: crewResult.response,
          error: crewResult.error,
          metadata: {
            agentType: 'crewai',
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // V2 EXECUTOR (OpenCode Containerized)
      // ========================================================================
      case 'v2-executor': {
        const { executeV2Task } = await import('@/lib/agent/v2-executor');

        // ownerId and sessionId already validated at function entry
        const v2Result = await executeV2Task({
          userId: request.ownerId,
          conversationId: request.sessionId,
          task: request.task,
          stream: request.stream,
          preferredAgent: 'opencode', // Default to OpenCode for v2
        });

        result = {
          success: v2Result.success ?? true,
          response: v2Result.content || v2Result.response,
          steps: v2Result.data?.steps,
          error: v2Result.data?.error,
          metadata: {
            agentType: 'v2-executor',
            sessionId: v2Result.sessionId,
            duration: Date.now() - startTime,
          },
        };
        break;
      }

      // ========================================================================
      // FALLBACK - Should never reach here due to type safety
      // ========================================================================
      default: {
        const modeNever: never = mode;
        throw new Error(`Unknown orchestration mode: ${modeNever}`);
      }
    }
    
    // Log successful execution with timing
    logger.info('Orchestration mode completed', {
      mode,
      success: result.success,
      duration: Date.now() - startTime,
    });
    
    return result;
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    logger.error('Orchestration mode execution failed', { 
      mode, 
      error: error.message,
      duration,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
      metadata: {
        agentType: mode,
        errorType: error.name || 'Unknown',
        duration,
      },
    };
  }
}
