import { agentSessionManager } from '../session/agent/agent-session-manager';
import { getToolManager } from '@/lib/tools';
import { createLogger } from '../utils/logger';
import { normalizeToolInvocation, type ToolInvocation } from '../types/tool-invocation';
import type { ExecutionPolicy } from '../sandbox/types';
import { determineExecutionPolicy } from '../sandbox/types';

const logger = createLogger('Agent:V2Executor');

export interface V2ExecuteOptions {
  userId: string;
  conversationId: string;
  task: string;
  context?: string;
  stream?: boolean;
  preferredAgent?: 'opencode' | 'nullclaw' | 'cli';
  /**
   * Execution policy for sandbox selection
   * Auto-detected from task if not specified
   */
  executionPolicy?: ExecutionPolicy;
  cliCommand?: {
    command: string;
    args?: string[];
  };
}

export async function executeV2Task(options: V2ExecuteOptions): Promise<any> {
  const taskWithContext = options.context
    ? `${options.context}\n\nTASK:\n${options.task}`
    : options.task;

  // Auto-detect execution policy if not specified
  const executionPolicy = options.executionPolicy || determineExecutionPolicy({
    task: taskWithContext,
    requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(taskWithContext),
    requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(taskWithContext),
    requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(taskWithContext),
  });

  let result: any;
  try {
    if (options.preferredAgent === 'nullclaw') {
      const { taskRouter } = await import('./task-router');
      result = await taskRouter.executeTask({
        id: `task-${Date.now()}`,
        userId: options.userId,
        conversationId: options.conversationId,
        task: taskWithContext,
        stream: false,
        preferredAgent: 'nullclaw',
      });
    } else {
      // Use ToolIntegrationManager for tool execution with OpenCode
      const toolManager = getToolManager();
      
      // Get or create session first
      const session = await agentSessionManager.getOrCreateSession(
        options.userId,
        options.conversationId,
        { enableMCP: true, mode: 'opencode', executionPolicy }
      );
      
      // Execute via OpenCode with tool integration
      const { runOpenCodeDirect } = await import('./opencode-direct');
      result = await runOpenCodeDirect({
        userId: options.userId,
        conversationId: options.conversationId,
        task: taskWithContext,
        executionPolicy,
        toolManager,  // Pass tool manager for integrated tool execution
      });
    }
  } catch (error: any) {
    console.error('[V2Executor] Task execution failed:', error.message);
    throw error;
  }

  const session = agentSessionManager.getSession(options.userId, options.conversationId);

  return {
    success: result.success ?? true,
    data: result,
    sessionId: session?.id,
    conversationId: session?.conversationId,
    workspacePath: session?.workspacePath,
    executionPolicy: session?.executionPolicy,
  };
}

export function executeV2TaskStreaming(options: V2ExecuteOptions): ReadableStream {
  const encoder = new TextEncoder();

  const formatEvent = (type: string, data: any) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  return new ReadableStream({
    async start(controller) {
      try {
        const taskWithContext = options.context
          ? `${options.context}\n\nTASK:\n${options.task}`
          : options.task;

        // Auto-detect execution policy if not specified
        const executionPolicy = options.executionPolicy || determineExecutionPolicy({
          task: taskWithContext,
          requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(taskWithContext),
          requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(taskWithContext),
          requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(taskWithContext),
        });

        // Send init event IMMEDIATELY to start the session - don't wait for anything
        controller.enqueue(encoder.encode(formatEvent('init', {
          agent: 'v2',
          conversationId: options.conversationId,
          executionPolicy,
          timestamp: Date.now(),
        })));

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

        // Skip taskRouter - go directly to OpenCode unless explicitly using Nullclaw
        // This allows immediate response instead of waiting for routing
        let result: any;
        let toolInvocations: ToolInvocation[] = [];

        if (options.preferredAgent === 'nullclaw') {
          // Only use Nullclaw when explicitly requested
          const { taskRouter } = await import('./task-router');
          result = await taskRouter.executeTask({
            id: `task-${Date.now()}`,
            userId: options.userId,
            conversationId: options.conversationId,
            task: taskWithContext,
            stream: false,
            preferredAgent: 'nullclaw',
          });
        } else {
          // Directly use OpenCode - it's already capable of handling prompts and file operations
          // Just translate outputs to our VFS system
          const { runOpenCodeDirect } = await import('./opencode-direct');

          result = await runOpenCodeDirect({
            userId: options.userId,
            conversationId: options.conversationId,
            task: taskWithContext,
            executionPolicy,
            onChunk: (chunk) => {
              controller.enqueue(encoder.encode(formatEvent('token', { content: chunk, timestamp: Date.now() })));
            },
            onTool: (toolName, args, toolResult) => {
              const toolCallId = `${toolName}-${Date.now()}`;
              const invocation = normalizeToolInvocation({
                toolCallId,
                toolName,
                state: 'result',
                args,
                result: toolResult,
                timestamp: Date.now(),
                sourceSystem: 'v2-executor',
                sourceAgent: 'v2',
              });
              toolInvocations.push(invocation);
              emitStep(`Tool ${toolName}`, toolResult?.success === false ? 'failed' : 'completed', {
                toolName,
                toolCallId,
                result: toolResult,
              });
              controller.enqueue(encoder.encode(formatEvent('tool_invocation', invocation)));
            },
          });
        }

        const session = agentSessionManager.getSession(options.userId, options.conversationId);

        // Get git-style diffs for client sync
        // Note: Currently returns all changes for user - could scope to conversationId in future
        let changedFiles: Array<{ path: string; diff: string; changeType: string }> = [];
        try {
          const { diffTracker } = await import('../virtual-filesystem/filesystem-diffs');
          changedFiles = diffTracker.getChangedFilesForSync(options.userId, 50);
        } catch (diffError) {
          logger.warn('Failed to get diffs for sync:', diffError);
        }
        
        // Send diffs to client
        if (changedFiles.length > 0) {
          controller.enqueue(encoder.encode(formatEvent('diffs', {
            requestId: `v2-${session?.id || 'unknown'}`,
            count: changedFiles.length,
            files: changedFiles.map(f => ({
              path: f.path,
              diff: f.diff,
              changeType: f.changeType,
            })),
          })));
        }

        if (result.fileChanges && result.fileChanges.length > 0) {
          controller.enqueue(encoder.encode(formatEvent('filesystem', {
            requestId: `v2-${session?.id || 'unknown'}`,
            status: 'auto_applied',
            applied: result.fileChanges.map((fc: any) => ({
              path: fc.path,
              operation: fc.operation || fc.action || 'write',
            })),
            errors: [],
            requestedFiles: [],
            scopePath: `project/sessions/${options.conversationId}`,
          })));
        }

        controller.enqueue(encoder.encode(formatEvent('done', {
          success: result.success ?? true,
          content: result.response || result.content || '',
          messageMetadata: {
            agent: result.agent || 'opencode',
            sessionId: session?.id,
            conversationId: session?.conversationId,
            toolInvocations,
            processingSteps,
          },
          data: result,
        })));
      } catch (error: any) {
        logger.error('Streaming execution failed', error);
        
        controller.enqueue(encoder.encode(formatEvent('error', {
          message: error.message || 'Execution failed',
          fallbackToV1: true,
          errorCode: 'EXECUTION_FAILED',
        })));
      } finally {
        controller.close();
      }
    },
  });
}
