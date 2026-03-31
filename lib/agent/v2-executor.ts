import { agentSessionManager } from '../session/agent/agent-session-manager';
import { getToolManager } from '@/lib/tools';
import { createLogger } from '../utils/logger';
import { normalizeToolInvocation, type ToolInvocation } from '../types/tool-invocation';
import type { ExecutionPolicy } from '../sandbox/types';
import { determineExecutionPolicy } from '../sandbox/types';
import { normalizeSessionId } from '../virtual-filesystem/scope-utils';

const logger = createLogger('Agent:V2Executor');

/**
 * Sanitize message content to remove heredoc command blocks.
 *
 * FIX (Bug 9): The original regex `[\s\S]*?` inside a construct that
 * also has a multi-step prefix is vulnerable to catastrophic backtracking
 * on inputs that contain `<<<` without a matching `>>>`. Fixed by using
 * possessive-style workarounds (split approach) and a bounded character
 * class for the heredoc body.
 */
function sanitizeV2ResponseContent(content: string): string {
  if (!content || typeof content !== 'string') return '';
  let sanitized = content;

  // Remove explicit command envelopes — these are safe because the sentinel
  // strings are unique enough that there's no backtracking risk.
  sanitized = sanitized.replace(/===\s*COMMANDS_START\s*===([\s\S]*?)===\s*COMMANDS_END\s*===/gi, '');
  
  // Remove bash heredoc blocks (NEW - preferred syntax)
  sanitized = removeBashHeredocBlocks(sanitized);
  
  // Remove old fs-actions blocks (deprecated)
  sanitized = sanitized.replace(/```fs-actions\s*[\s\S]*?```/gi, '');
  sanitized = sanitized.replace(/<file_edit\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_edit>/gi, '');
  sanitized = sanitized.replace(/<fs-actions>[\s\S]*?<\/fs-actions>/gi, '');
  sanitized = sanitized.replace(/<apply_diff\s+path=["'][^"']+["']\s*>[\s\S]*?<\/apply_diff>/gi, '');

  // FIX (Bug 9): Replace the catastrophic-backtracking heredoc regexes with
  // a line-by-line state-machine approach. This is O(n) and handles
  // unmatched delimiters without hanging.
  sanitized = removeHeredocBlocks(sanitized);

  // Normalize spacing
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim();

  return sanitized;
}

/**
 * Remove bash heredoc blocks (cat > file << 'EOF' ... EOF) in a single O(n) pass.
 */
function removeBashHeredocBlocks(content: string): string {
  const lines = content.split('\n');
  const output: string[] = [];
  let insideHeredoc = false;
  let heredocDelimiter: string | null = null;
  let heredocLineCount = 0;
  const MAX_HEREDOC_LINES = 5000;

  for (const line of lines) {
    if (!insideHeredoc) {
      const trimmed = line.trim();
      const heredocMatch = trimmed.match(/^cat\s*(?:>>?)\s*[^\s<>&|]+\s*<<\s*['"]?(\w+)['"]?\s*$/i);
      
      if (heredocMatch) {
        insideHeredoc = true;
        heredocDelimiter = heredocMatch[1];
        heredocLineCount = 0;
        continue;
      }
      
      output.push(line);
    } else {
      heredocLineCount++;
      if (heredocLineCount > MAX_HEREDOC_LINES) {
        insideHeredoc = false;
        heredocDelimiter = null;
        output.push(line);
        continue;
      }
      const trimmed = line.trim();
      if (heredocDelimiter && trimmed === heredocDelimiter) {
        insideHeredoc = false;
        heredocDelimiter = null;
      }
    }
  }

  if (insideHeredoc && output.length > 0) {
    output.push('');
  }

  return output.join('\n');
}

/**
 * Remove WRITE/PATCH/APPLY_DIFF/DELETE heredoc blocks in a single O(n) pass.
 * Avoids regex backtracking on unmatched delimiters.
 */
function removeHeredocBlocks(content: string): string {
  const lines = content.split('\n');
  const output: string[] = [];
  let insideHeredoc = false;
  let heredocLineCount = 0;
  const MAX_HEREDOC_LINES = 5000;

  for (const line of lines) {
    if (!insideHeredoc) {
      const trimmed = line.trim();
      if (/^(WRITE|PATCH|APPLY_DIFF)\s+\S+.*<<</.test(trimmed) ||
          /^(WRITE|PATCH|APPLY_DIFF)\s+\S+/.test(trimmed)) {
        if (trimmed.endsWith('<<<') || /<<<\s*$/.test(trimmed)) {
          insideHeredoc = true;
          heredocLineCount = 0;
        }
        continue;
      }
      if (/^DELETE\s+\S+/.test(trimmed)) {
        continue;
      }
      if (/^\s*<<<\s*$/.test(line)) {
        insideHeredoc = true;
        heredocLineCount = 0;
        continue;
      }
      output.push(line);
    } else {
      heredocLineCount++;
      if (heredocLineCount > MAX_HEREDOC_LINES) {
        insideHeredoc = false;
        output.push(line);
        continue;
      }
      if (/^\s*>>>\s*$/.test(line)) {
        insideHeredoc = false;
      }
    }
  }

  if (insideHeredoc && output.length > 0) {
    output.push('');
  }

  return output.join('\n');
}

function buildExecutionPolicy(task: string, explicit?: ExecutionPolicy): ExecutionPolicy {
  return explicit || determineExecutionPolicy({
    task,
    requiresBash:      /bash|shell|command|execute|run\s+\w+/i.test(task),
    requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(task),
    requiresBackend:   /server|api|database|backend|express|fastapi|flask|django/i.test(task),
  });
}

export interface V2ExecuteOptions {
  userId: string;
  conversationId: string;
  task: string;
  context?: string;
  stream?: boolean;
  preferredAgent?: 'opencode' | 'nullclaw' | 'cli' | 'advanced';
  executionPolicy?: ExecutionPolicy;
  cliCommand?: { command: string; args?: string[] };
}

/**
 * Execute V2 task (non-streaming)
 */
export async function executeV2Task(options: V2ExecuteOptions): Promise<any> {
  const taskWithContext = options.context
    ? `${options.context}\n\nTASK:\n${options.task}`
    : options.task;

  const executionPolicy = buildExecutionPolicy(taskWithContext, options.executionPolicy);

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
      const toolManager = getToolManager();

      // FIX (Bug 8): await session creation here so it is guaranteed to be
      // in the manager's cache before runOpenCodeDirect executes.
      // Use the active agent when creating the session; hardcoding 'opencode'
      // here can attach nullclaw executions to a session with the wrong mode.
      const session = await agentSessionManager.getOrCreateSession(
        options.userId,
        options.conversationId,
        { enableMCP: true, mode: options.preferredAgent || 'opencode', executionPolicy },
      );

      const { runOpenCodeDirect } = await import('./opencode-direct');
      result = await runOpenCodeDirect({
        userId: options.userId,
        conversationId: options.conversationId,
        task: taskWithContext,
        executionPolicy,
        toolManager,
      });

      // FIX (Bug 8): use the session we already have rather than a second
      // non-async lookup that may miss an as-yet-uncached session.
      const rawContent = result.response || result.content || '';
      const sanitizedContent = sanitizeV2ResponseContent(rawContent);

      return {
        success: result.success ?? true,
        data: result,
        content: sanitizedContent,
        rawContent,
        sessionId: session.id,
        conversationId: session.conversationId,
        workspacePath: session.workspacePath,
        executionPolicy: session.executionPolicy,
      };
    }
  } catch (error: any) {
    logger.error('[V2Executor] Task execution failed:', error.message);
    throw error;
  }

  // Nullclaw path: session may not exist
  const session = agentSessionManager.getSession(options.userId, options.conversationId);
  const rawContent = result.response || result.content || '';
  const sanitizedContent = sanitizeV2ResponseContent(rawContent);

  return {
    success: result.success ?? true,
    data: result,
    content: sanitizedContent,
    rawContent,
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

        // FIX (Bug 10): compute executionPolicy once and reuse everywhere
        // so the init event and the actual execution always agree.
        const executionPolicy = buildExecutionPolicy(taskWithContext, options.executionPolicy);

        controller.enqueue(encoder.encode(formatEvent('init', {
          agent: 'v2',
          conversationId: options.conversationId,
          executionPolicy, // consistent with what will actually run
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

        const emitStep = (
          step: string,
          status: 'started' | 'completed' | 'failed',
          detail?: Partial<typeof processingSteps[number]>,
        ) => {
          const payload = { step, status, timestamp: Date.now(), stepIndex: processingSteps.length, ...detail };
          processingSteps.push(payload);
          controller.enqueue(encoder.encode(formatEvent('step', payload)));
        };

        let result: any;
        let toolInvocations: ToolInvocation[] = [];

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
          // FIX (Bug 8): ensure session exists before runOpenCodeDirect
          // Use consistent session mode based on preferredAgent
          const sessionMode: 'opencode' | 'nullclaw' | 'cli' = options.preferredAgent === 'cli' ? 'cli' : 'opencode';
          await agentSessionManager.getOrCreateSession(
            options.userId,
            options.conversationId,
            { enableMCP: true, mode: sessionMode, executionPolicy },
          );

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
                toolCallId, toolName,
                state: 'result',
                args,
                result: toolResult,
                timestamp: Date.now(),
                sourceSystem: 'v2-executor',
                sourceAgent: 'v2',
              });
              toolInvocations.push(invocation);
              emitStep(`Tool ${toolName}`, toolResult?.success === false ? 'failed' : 'completed', {
                toolName, toolCallId, result: toolResult,
              });
              controller.enqueue(encoder.encode(formatEvent('tool_invocation', invocation)));
            },
          });
        }

        // FIX (Bug 8): use getSession (sync) after we know it was created above
        const session = agentSessionManager.getSession(options.userId, options.conversationId);

        let changedFiles: Array<{ path: string; diff: string; changeType: string }> = [];
        try {
          const { diffTracker } = await import('../virtual-filesystem/filesystem-diffs');
          changedFiles = diffTracker.getChangedFilesForSync(options.userId, 50);
        } catch (diffError) {
          logger.warn('Failed to get diffs for sync:', diffError);
        }

        if (changedFiles.length > 0) {
          controller.enqueue(encoder.encode(formatEvent('diffs', {
            requestId: `v2-${session?.id || 'unknown'}`,
            count: changedFiles.length,
            files: changedFiles.map(f => ({ path: f.path, diff: f.diff, changeType: f.changeType })),
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
            scopePath: `project/sessions/${normalizeSessionId(options.conversationId) || options.conversationId}`,
          })));
        }

        const rawContent = result.response || result.content || '';
        const sanitizedContent = sanitizeV2ResponseContent(rawContent);

        controller.enqueue(encoder.encode(formatEvent('done', {
          success: result.success ?? true,
          content: sanitizedContent,
          rawContent,
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
