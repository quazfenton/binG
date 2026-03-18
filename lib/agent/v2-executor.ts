import { agentSessionManager } from '../session/agent/agent-session-manager';
import { getToolManager } from '@/lib/tools';
import { createLogger } from '../utils/logger';
import { normalizeToolInvocation, type ToolInvocation } from '../types/tool-invocation';
import type { ExecutionPolicy } from '../sandbox/types';
import { determineExecutionPolicy } from '../sandbox/types';

const logger = createLogger('Agent:V2Executor');

/**
 * Sanitize message content to remove heredoc command blocks
 * FIX Bug 9: Replace regex with O(n) line-by-line state machine
 * Mirrors backend sanitization in app/api/chat/route.ts
 */
function sanitizeV2ResponseContent(content: string): string {
  if (!content || typeof content !== 'string') return '';
  
  // Use line-by-line state machine instead of regex to prevent ReDoS
  const lines = content.split('\n');
  const output: string[] = [];
  let inHeredoc = false;
  let heredocDepth = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for heredoc start (WRITE/PATCH/APPLY_DIFF followed by <<<)
    if (/^\s*(WRITE|PATCH|APPLY_DIFF)\s+\S+\s*<<<\s*$/.test(line)) {
      inHeredoc = true;
      heredocDepth++;
      continue;
    }
    
    // Check for heredoc end
    if (inHeredoc && trimmed === '>>>') {
      heredocDepth--;
      if (heredocDepth === 0) {
        inHeredoc = false;
      }
      continue;
    }
    
    // Skip lines inside heredoc blocks
    if (!inHeredoc) {
      // Also filter out other command block markers
      if (!trimmed.startsWith('===') && 
          !trimmed.startsWith('```fs-actions') &&
          !trimmed.startsWith('<file_edit') &&
          !trimmed.startsWith('<apply_diff') &&
          !trimmed.startsWith('<fs-actions>')) {
        output.push(line);
      }
    }
  }
  
  // Normalize spacing
  let sanitized = output.join('\n');
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim();
  
  return sanitized;
}

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

/**
 * FIX Bug 10: Shared execution policy builder
 * Ensures consistent policy across all scopes
 */
function buildExecutionPolicy(options: V2ExecuteOptions): ExecutionPolicy {
  const taskWithContext = options.context
    ? `${options.context}\n\nTASK:\n${options.task}`
    : options.task;

  return options.executionPolicy || determineExecutionPolicy({
    task: taskWithContext,
    requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(taskWithContext),
    requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(taskWithContext),
    requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(taskWithContext),
  });
}

export async function executeV2Task(options: V2ExecuteOptions): Promise<any> {
  const taskWithContext = options.context
    ? `${options.context}\n\nTASK:\n${options.task}`
    : options.task;

  // FIX Bug 10: Use shared execution policy builder
  const executionPolicy = buildExecutionPolicy(options);

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

      // FIX Bug 8: Get or create session BEFORE execution and reuse it
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

      // Use session directly (no need to fetch again - prevents undefined)
      return {
        success: result.success ?? true,
        data: result,
        content: sanitizeV2ResponseContent(result.response || result.content || ''),
        sessionId: session.id,  // Use session from before execution
        conversationId: session.conversationId,
        workspacePath: session.workspacePath,
        executionPolicy: session.executionPolicy,
      };
    }
  } catch (error: any) {
    console.error('[V2Executor] Task execution failed:', error.message);
    throw error;
  }

  // Fallback for nullclaw path (session may not exist)
  const session = await agentSessionManager.getOrCreateSession(
    options.userId,
    options.conversationId,
    { enableMCP: true, mode: 'opencode' }
  ).catch(() => null);

  return {
    success: result.success ?? true,
    data: result,
    content: sanitizeV2ResponseContent(result.response || result.content || ''),
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

        // FIX Bug 10: Use shared execution policy builder (consistent with executeV2Task)
        const executionPolicy = buildExecutionPolicy(options);

        // Send init event IMMEDIATELY to start the session - don't wait for anything
        controller.enqueue(encoder.encode(formatEvent('init', {
          agent: 'v2',
          conversationId: options.conversationId,
          executionPolicy,  // Now uses shared builder
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

        // Sanitize the response content to remove heredoc command blocks
        const sanitizedContent = sanitizeV2ResponseContent(result.response || result.content || '');

        controller.enqueue(encoder.encode(formatEvent('done', {
          success: result.success ?? true,
          content: sanitizedContent,
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
