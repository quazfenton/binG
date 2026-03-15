import { agentSessionManager } from './agent-session-manager';
import { agentFSBridge } from './agent-fs-bridge';
import { taskRouter } from './task-router';
import { createLogger } from '../utils/logger';
import { normalizeToolInvocation, type ToolInvocation } from '@/lib/types/tool-invocation';

const logger = createLogger('Agent:V2Executor');

export interface V2ExecuteOptions {
  userId: string;
  conversationId: string;
  task: string;
  context?: string;
  stream?: boolean;
  preferredAgent?: 'opencode' | 'nullclaw' | 'cli';
  cliCommand?: {
    command: string;
    args?: string[];
  };
}

export async function executeV2Task(options: V2ExecuteOptions): Promise<any> {
  const taskWithContext = options.context
    ? `${options.context}\n\nTASK:\n${options.task}`
    : options.task;

  // Don't create session/sandbox here - task-router will create it only if needed
  // This avoids creating unnecessary cloud sandboxes when using local OpenCode engine

  // Get session (created by task-router if needed)
  let session = agentSessionManager.getSession(options.userId, options.conversationId);
  if (session) {
    agentSessionManager.setSessionState(options.userId, options.conversationId, 'busy');
  }
  
  let result: any;
  try {
    result = await taskRouter.executeTask({
      id: `task-${Date.now()}`,
      userId: options.userId,
      conversationId: options.conversationId,
      task: taskWithContext,
      stream: false,
      preferredAgent: options.preferredAgent,
      cliCommand: options.cliCommand,
    });
  } catch (error: any) {
    // Propagate error so chat route can fallback to v1
    console.error('[V2Executor] Task execution failed:', error.message);
    throw error;
  } finally {
    // Update session state if it exists (created by task-router)
    session = agentSessionManager.getSession(options.userId, options.conversationId);
    if (session) {
      agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
      agentSessionManager.updateActivity(options.userId, options.conversationId);
    }
  }

  // Only sync back from sandbox if the agent actually used it
  // (task-router creates session only when needed, e.g., OpencodeV2Provider or CLI agent)
  if (result.agent === 'opencode' || result.agent === 'cli') {
    try {
      await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
    } catch (syncError) {
      // Ignore sync errors - sandbox may not have been created
      console.warn('[V2Executor] Sync from sandbox failed (sandbox may not exist):', syncError);
    }
  }

  // Get session info if it was created (task-router creates it when needed)
  session = agentSessionManager.getSession(options.userId, options.conversationId);
  
  return {
    success: result.success ?? true,
    data: result,
    sessionId: session?.id,
    conversationId: session?.conversationId,
    workspacePath: session?.workspacePath,
  };
}

export function executeV2TaskStreaming(options: V2ExecuteOptions): ReadableStream {
  const encoder = new TextEncoder();

  const formatEvent = (type: string, data: any) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const resolveScopePath = (conversationId: string): string => {
    const trimmed = (conversationId || '').replace(/^\/+/, '').trim();
    if (!trimmed) return 'project';
    if (trimmed.startsWith('project/')) return trimmed;
    return `project/sessions/${trimmed}`.replace(/\/{2,}/g, '/');
  };

  return new ReadableStream({
    async start(controller) {
      try {
        const taskWithContext = options.context
          ? `${options.context}\n\nTASK:\n${options.task}`
          : options.task;

        const processingSteps: Array<{
          step: string;
          status: 'started' | 'completed' | 'failed';
          timestamp: number;
          stepIndex: number;
          toolName?: string;
          toolCallId?: string;
          result?: any;
          detail?: string;
        }> = [];

        const emitStep = (step: string, status: 'started' | 'completed' | 'failed', detail?: Partial<typeof processingSteps[number]>) => {
          const payload = {
            step,
            status,
            timestamp: Date.now(),
            stepIndex: processingSteps.length,
            ...detail,
          };
          processingSteps.push(payload);
            controller.enqueue(encoder.encode(formatEvent('step', payload)));
        };

        // Don't create session/sandbox here - task-router will create it only if needed
        // Session will be created by task-router during executeTask

        emitStep('Initialize V2 session', 'completed', {
          detail: 'starting task execution',
        });

        let accumulatedContent = '';
        let toolInvocations: ToolInvocation[] = [];

        emitStep('Execute task', 'started');
        const resultPromise = taskRouter.executeTask({
          id: `task-${Date.now()}`,
          userId: options.userId,
          conversationId: options.conversationId,
          task: taskWithContext,
          stream: true,
          preferredAgent: options.preferredAgent,
          cliCommand: options.cliCommand,
          onStreamChunk: (chunk) => {
            accumulatedContent += chunk;
            controller.enqueue(encoder.encode(formatEvent('token', { content: chunk, timestamp: Date.now() })));
          },
          onToolExecution: (toolName, args, result) => {
            const toolCallId = `${toolName}-${Date.now()}`;
            const invocation = normalizeToolInvocation({
              toolCallId,
              toolName,
              state: 'result',
              args,
              result,
              timestamp: Date.now(),
              sourceSystem: 'v2-executor',
              sourceAgent: 'v2',
            });
            toolInvocations.push(invocation);
            emitStep(`Tool ${toolName}`, result?.success === false ? 'failed' : 'completed', {
              toolName,
              toolCallId,
              result,
            });
            controller.enqueue(encoder.encode(formatEvent('tool_invocation', invocation)));
          },
        });

        // Send init event to signal V2 mode start (session will be created by task-router)
        controller.enqueue(encoder.encode(formatEvent('init', {
          agent: 'v2',
          conversationId: options.conversationId,
          timestamp: Date.now(),
        })));

        let result: any;
        try {
          result = await resultPromise;
        } catch (taskError: any) {
          // Task execution failed - emit error event and trigger fallback to v1
          console.error('[V2Executor] Task execution failed:', taskError.message);
          controller.enqueue(encoder.encode(formatEvent('error', {
            error: taskError.message,
            fallback: true,
          })));
          controller.close();
          
          // Throw to trigger fallback in chat route
          throw taskError;
        }
        
        emitStep('Execute task', 'completed');

        // Get session after task execution (created by task-router if needed)
        const session = agentSessionManager.getSession(options.userId, options.conversationId);

        if (result.agent === 'opencode' || result.agent === 'cli') {
          emitStep('Sync workspace from sandbox', 'started');
          await agentFSBridge.syncFromSandbox(options.userId, options.conversationId);
          emitStep('Sync workspace from sandbox', 'completed');
        }

        agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
        agentSessionManager.updateActivity(options.userId, options.conversationId);

        // Build enhanced message metadata with code artifacts
        const finalContent = accumulatedContent || result.response || '';
        const messageMetadata: any = {
          agent: result.agent,
          sessionId: session.id,
          conversationId: session.conversationId,
          v2SessionId: session.v2SessionId,
          toolInvocations: toolInvocations,
          processingSteps: processingSteps,
        };

        // Extract code artifacts from result with full content
        if (result.fileChanges && result.fileChanges.length > 0) {
          messageMetadata.codeArtifacts = result.fileChanges.map((fc: any) => {
            const rawAction = fc.operation || fc.action;
            const operation: 'write' | 'patch' | 'delete' | 'read' =
              rawAction === 'delete'
                ? 'delete'
                : rawAction === 'modify' || rawAction === 'patch'
                  ? 'patch'
                  : rawAction === 'read'
                    ? 'read'
                    : 'write';
            return {
              path: fc.path,
              operation,
              language: fc.language || 'typescript',
              content: fc.content || '',
              previousContent: fc.previousContent || fc.oldContent || undefined,
              newVersion: fc.newVersion,
              previousVersion: fc.previousVersion,
            };
          });
        }

        // Include reasoning if available
        if (result.reasoning) {
          messageMetadata.reasoning = result.reasoning;
        }

        if (result.fileChanges && result.fileChanges.length > 0) {
          controller.enqueue(encoder.encode(formatEvent('filesystem', {
            requestId: `v2-${session.id}`,
            status: 'auto_applied',
            applied: result.fileChanges.map((fc: any) => ({
              path: fc.path,
              operation: fc.operation || fc.action || 'write',
            })),
            errors: [],
            requestedFiles: [],
            scopePath: resolveScopePath(options.conversationId),
          })));
        }

        controller.enqueue(encoder.encode(formatEvent('done', {
          success: result.success ?? true,
          content: finalContent,
          messageMetadata,
          data: result,
        })));
      } catch (error: any) {
        logger.error('Streaming execution failed', error);
        try {
          agentSessionManager.setSessionState(options.userId, options.conversationId, 'ready');
          agentSessionManager.updateActivity(options.userId, options.conversationId);
        } catch { /* ignore cleanup errors */ }
        
        // Check if this is a session creation failure that should trigger fallback
        const isSessionError = error.message?.includes('Session creation failed') || 
                               error.message?.includes('Failed to create session') ||
                               error.message?.includes('sandbox');
        
        controller.enqueue(encoder.encode(formatEvent('error', {
          message: error.message || 'Execution failed',
          fallbackToV1: isSessionError, // Signal to client that fallback should happen
          errorCode: isSessionError ? 'SESSION_FAILED' : 'EXECUTION_FAILED',
        })));
      } finally {
        controller.close();
      }
    },
  });
}
