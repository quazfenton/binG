/**
 * Agent V2 Executor — Streaming and non-streaming task execution.
 *
 * Executes tasks via OpenCode (default), Nullclaw, or CLI agents.
 * Sanitizes LLM response content to remove heredoc/command blocks
 * that would otherwise leak internal instruction formatting.
 */

import { agentSessionManager } from '@/lib/session/agent/agent-session-manager';
import { getToolManager } from '@/lib/tools';
import { createLogger } from '@/lib/utils/logger';
import { normalizeToolInvocation, type ToolInvocation } from '@/lib/types/tool-invocation';
import type { ExecutionPolicy } from '@/lib/sandbox/types';
import { determineExecutionPolicy } from '@/lib/sandbox/types';
import { normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import type { PromptParameters } from './prompt-parameters';

const logger = createLogger('Agent:V2Executor');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HEREDOC_LINES = 5000;

// ---------------------------------------------------------------------------
// Response Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize message content to remove heredoc command blocks.
 *
 * FIX (Bug 9): The original regex `[\s\S]*?` inside a construct that
 * also has a multi-step prefix is vulnerable to catastrophic backtracking
 * on inputs that contain `<<<` without a matching `>>>`. Fixed by using
 * possessive-style workarounds (split approach) and a bounded character
 * class for the heredoc body.
 */
export function sanitizeV2ResponseContent(content: string): string {
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
  /** Optional prompt parameters for response style modification */
  promptParams?: PromptParameters;
}

/**
 * Normalized result shape returned by all execution paths.
 */
export interface V2ExecutionResult {
  success: boolean;
  data?: unknown;
  content: string;
  rawContent: string;
  sessionId?: string;
  conversationId?: string;
  workspacePath?: string;
  executionPolicy?: ExecutionPolicy;
  fallbackToV1?: boolean;
  error?: string;
  errorCode?: string;
}

/**
 * Execute V2 task (non-streaming)
 *
 * Routes to the appropriate agent backend based on preferredAgent option.
 * All paths return a consistent V2ExecutionResult shape.
 */
export async function executeV2Task(options: V2ExecuteOptions): Promise<V2ExecutionResult> {
  const taskWithContext = options.context
    ? `${options.context}\n\nTASK:\n${options.task}`
    : options.task;

  const executionPolicy = buildExecutionPolicy(taskWithContext, options.executionPolicy);

  // Map preferred agent to session mode; default to 'opencode' for unknown values
  const sessionMode = mapPreferredAgentToSessionMode(options.preferredAgent);

  try {
    // --- Nullclaw path -------------------------------------------------------
    if (options.preferredAgent === 'nullclaw') {
      const { taskRouter } = await import('./task-router');
      const result = await taskRouter.executeTask({
        id: `task-${Date.now()}`,
        userId: options.userId,
        conversationId: options.conversationId,
        task: taskWithContext,
        stream: false,
        preferredAgent: 'nullclaw',
      });

      const session = agentSessionManager.getSession(options.userId, options.conversationId);
      const rawContent = result?.response ?? result?.content ?? '';
      return buildResult(result, rawContent, session);
    }

    // --- Advanced path (not yet fully implemented) ---------------------------
    if (options.preferredAgent === 'advanced') {
      logger.warn('[V2Executor] preferredAgent "advanced" is not yet implemented, using opencode path');
      // Fall through to opencode path below
    }

    // --- OpenCode / CLI path (default) ---------------------------------------
    const toolManager = getToolManager();

    // Await session creation to ensure it is in the manager's cache before
    // runOpenCodeDirect executes. This prevents race conditions where the
    // downstream code looks up a session that hasn't been created yet.
    const session = await agentSessionManager.getOrCreateSession(
      options.userId,
      options.conversationId,
      { enableMCP: true, mode: sessionMode, executionPolicy },
    );

    const { runOpenCodeDirect } = await import('./opencode-direct');
    const result = await runOpenCodeDirect({
      userId: options.userId,
      conversationId: options.conversationId,
      task: taskWithContext,
      executionPolicy,
      toolManager,
      promptParams: options.promptParams,
    });

    const rawContent = result.response ?? (result as any).content ?? '';
    return buildResult(result, rawContent, session);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[V2Executor] Task execution failed:', message);
    return {
      success: false,
      content: '',
      rawContent: '',
      error: message,
      errorCode: 'EXECUTION_FAILED',
    };
  }
}

/**
 * Map the preferred agent string to a valid session mode.
 * Returns 'opencode' as the default for any unrecognized value.
 */
function mapPreferredAgentToSessionMode(
  preferredAgent: V2ExecuteOptions['preferredAgent'],
): 'opencode' | 'nullclaw' | 'cli' {
  switch (preferredAgent) {
    case 'nullclaw':
      return 'nullclaw';
    case 'cli':
      return 'cli';
    case 'opencode':
    case 'advanced': // advanced falls back to opencode
    case undefined:
    default:
      return 'opencode';
  }
}

/**
 * Build a normalized V2ExecutionResult from raw execution output.
 */
function buildResult(
  result: unknown,
  rawContent: string,
  session: ReturnType<typeof agentSessionManager.getSession>,
): V2ExecutionResult {
  const sanitizedContent = sanitizeV2ResponseContent(rawContent);
  const record = result as Record<string, unknown> | undefined;

  return {
    success: (record?.success as boolean) ?? true,
    data: record,
    content: sanitizedContent,
    rawContent,
    sessionId: session?.id,
    conversationId: session?.conversationId,
    workspacePath: session?.workspacePath,
    executionPolicy: session?.executionPolicy,
  };
}

/**
 * Execute V2 task with SSE streaming.
 *
 * Returns a ReadableStream that emits typed events (init, step, token,
 * tool_invocation, diffs, filesystem, done, error). Properly handles
 * client disconnect via the cancel callback.
 */
export function executeV2TaskStreaming(options: V2ExecuteOptions): ReadableStream {
  const encoder = new TextEncoder();
  // Track whether the stream has been cancelled by the client
  let cancelled = false;

  const formatEvent = (type: string, data: unknown) =>
    `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  const safeEnqueue = (controller: ReadableStreamDefaultController<Uint8Array>, data: Uint8Array) => {
    if (!cancelled) {
      try {
        controller.enqueue(data);
      } catch {
        // Controller may already be closed — ignore
      }
    }
  };

  return new ReadableStream({
    async start(controller) {
      // Resource cleanup trackers
      const cleanupFns: Array<() => void> = [];
      let pingInterval: ReturnType<typeof setInterval> | null = null;

      try {
        const taskWithContext = options.context
          ? `${options.context}\n\nTASK:\n${options.task}`
          : options.task;

        const executionPolicy = buildExecutionPolicy(taskWithContext, options.executionPolicy);

        safeEnqueue(controller, encoder.encode(formatEvent('init', {
          agent: 'v2',
          conversationId: options.conversationId,
          executionPolicy,
          timestamp: Date.now(),
        })));

        // --- Keep-alive ping for long-running streams ------------------------
        pingInterval = setInterval(() => {
          safeEnqueue(controller, encoder.encode(formatEvent('ping', { timestamp: Date.now() })));
        }, 30_000);
        cleanupFns.push(() => { if (pingInterval) clearInterval(pingInterval); });

        const processingSteps: Array<{
          step: string;
          status: 'started' | 'completed' | 'failed';
          timestamp: number;
          stepIndex: number;
          toolName?: string;
          toolCallId?: string;
          result?: unknown;
          detail?: string;
        }> = [];

        const emitStep = (
          step: string,
          status: 'started' | 'completed' | 'failed',
          detail?: Partial<typeof processingSteps[number]>,
        ) => {
          const payload = { step, status, timestamp: Date.now(), stepIndex: processingSteps.length, ...detail };
          processingSteps.push(payload);
          safeEnqueue(controller, encoder.encode(formatEvent('step', payload)));
        };

        let result: unknown;
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
          const sessionMode = mapPreferredAgentToSessionMode(options.preferredAgent);
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
            promptParams: options.promptParams,
            onChunk: (chunk) => {
              safeEnqueue(controller, encoder.encode(formatEvent('token', { content: chunk, timestamp: Date.now() })));
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
              safeEnqueue(controller, encoder.encode(formatEvent('tool_invocation', invocation)));
            },
          });
        }

        if (cancelled) return;

        const session = agentSessionManager.getSession(options.userId, options.conversationId);

        // --- Emit file diffs if available ------------------------------------
        let changedFiles: Array<{ path: string; diff: string; changeType: string }> = [];
        try {
          const { diffTracker } = await import('@/lib/virtual-filesystem/filesystem-diffs');
          changedFiles = diffTracker.getChangedFilesForSync(options.userId, 50);
        } catch (diffError) {
          logger.warn('Failed to get diffs for sync:', diffError);
        }

        if (changedFiles.length > 0) {
          safeEnqueue(controller, encoder.encode(formatEvent('diffs', {
            requestId: `v2-${session?.id || 'unknown'}`,
            count: changedFiles.length,
            files: changedFiles.map(f => ({ path: f.path, diff: f.diff, changeType: f.changeType })),
          })));
        }

        // --- Emit filesystem changes from result -----------------------------
        const resultRecord = result as Record<string, unknown> | undefined;
        if (resultRecord?.fileChanges && (resultRecord.fileChanges as any[]).length > 0) {
          safeEnqueue(controller, encoder.encode(formatEvent('filesystem', {
            requestId: `v2-${session?.id || 'unknown'}`,
            status: 'auto_applied',
            applied: (resultRecord.fileChanges as any[]).map((fc: any) => ({
              path: fc.path,
              operation: fc.operation ?? fc.action ?? 'write',
            })),
            errors: [],
            requestedFiles: [],
            scopePath: `project/sessions/${normalizeSessionId(options.conversationId) || options.conversationId}`,
          })));
        }

        // --- Final done event ------------------------------------------------
        const rawContent = (resultRecord?.response ?? resultRecord?.content ?? '') as string;
        const sanitizedContent = sanitizeV2ResponseContent(rawContent);

        safeEnqueue(controller, encoder.encode(formatEvent('done', {
          success: resultRecord?.success ?? true,
          content: sanitizedContent,
          rawContent,
          messageMetadata: {
            agent: (resultRecord?.agent as string) || 'opencode',
            sessionId: session?.id,
            conversationId: session?.conversationId,
            toolInvocations,
            processingSteps,
          },
          data: resultRecord,
        })));
      } catch (error: unknown) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Execution failed';
          logger.error('Streaming execution failed', error);
          safeEnqueue(controller, encoder.encode(formatEvent('error', {
            message,
            fallbackToV1: true,
            errorCode: 'EXECUTION_FAILED',
          })));
        }
      } finally {
        // Cleanup all registered resources
        for (const cleanup of cleanupFns) cleanup();
        controller.close();
      }
    },

    // FIX (Bug 2): Handle client disconnect / stream cancellation
    cancel() {
      cancelled = true;
      logger.info('[V2Executor] Stream cancelled by client');
    },
  });
}
