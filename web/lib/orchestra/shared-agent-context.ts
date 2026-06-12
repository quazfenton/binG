/**
 * Shared Agent Context Utilities
 *
 * Centralizes workspace-snapshot building, structured error formatting,
 * no-progress loop detection, and tool-arg normalization so that ALL
 * execution paths (V1 API, V2 Native, StatefulAgent, Mastra agent-loop,
 * Desktop mode) share the same self-healing behaviour.
 *
 * Import and use these from any agent loop or execution path.
 */

import { createLogger } from '@/lib/utils/logger';
import { normalizeToolArgs, tolerantJsonParse } from '@/lib/mcp/vfs-mcp-tools';
import { stripScopePrefixForDisplay } from '@/lib/virtual-filesystem/path-normalizer';
// Bug #41: categorize + emit a [STEER] loop_abort when the 3-consecutive-tool-
// failures kill fires. The steer tells the LLM what to do next (e.g. switch to
// write_file for binary_missing aborts) and the helper returns a structured
// abort payload for the final SSE event so the UI can show a banner.
import { safeSteer, wireLoopAbortSteer } from '@/lib/orchestra/steer-service';

export { normalizeToolArgs, tolerantJsonParse };

const log = createLogger('SharedAgentContext');

// ============================================================================
// Workspace Snapshot
// ============================================================================

/**
 * Build a lightweight workspace snapshot (file tree up to 80 paths).
 * Inject this into system prompts so the model doesn't hallucinate paths.
 */
export async function buildWorkspaceSnapshot(userId: string): Promise<string> {
  try {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
    const workspace = await virtualFilesystem.exportWorkspace(userId);
    const paths = workspace.files
      .map((f: any) => stripScopePrefixForDisplay(f.path as string))
      .sort();

    if (paths.length === 0) return '(empty workspace — no files yet)';

    const shown = paths.slice(0, 80);
    const lines = shown.map((p: string) => `  ${p}`);
    if (paths.length > 80) {
      lines.push(`  ... and ${paths.length - 80} more files`);
    }
    return lines.join('\n');
  } catch {
    return '(workspace listing unavailable)';
  }
}

// ============================================================================
// Structured Tool Error Formatting
// ============================================================================

export interface StructuredToolError {
  code: string;
  message: string;
  retryable: boolean;
  attemptedPath?: string;
  parentPath?: string;
  suggestedPaths?: string[];
  suggestedNextAction?: string;
  expectedFields?: string[];
  /** Schema snippet showing expected field types, e.g. '{ path: <required>, content: <required> }' */
  expectedSchema?: string;
}

/**
 * Format a tool error into a structured object the LLM can reason about.
 * Call this instead of returning raw `error.message` strings.
 */
export function formatToolError(
  toolName: string,
  error: Error | string,
  args?: Record<string, any>,
): StructuredToolError {
  const msg = typeof error === 'string' ? error : error.message || 'Unknown error';
  const lower = msg.toLowerCase();

  // Path not found
  if (/not found|enoent|does not exist/i.test(lower)) {
    const path = args?.path || '';
    const parentPath = path.includes('/')
      ? path.substring(0, path.lastIndexOf('/')) || '/'
      : '/';
    return {
      code: 'PATH_NOT_FOUND',
      message: `"${path}" does not exist.`,
      retryable: true,
      attemptedPath: path,
      parentPath,
      suggestedNextAction: `Call list_directory("${parentPath}") to see what exists.`,
    };
  }

  // Permission denied
  if (/permission denied|forbidden|not authorized/i.test(lower)) {
    return {
      code: 'PERMISSION_DENIED',
      message: msg,
      retryable: false,
    };
  }

  // Generic catchall
  return {
    code: 'TOOL_ERROR',
    message: msg,
    retryable: true,
    suggestedNextAction: `Check the error message and try a different approach.`,
  };
}

/**
 * Validate required tool arguments. Returns a StructuredToolError if missing, null if OK.
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, any>,
  requiredFields: string[],
): StructuredToolError | null {
  const missing = requiredFields.filter(f => args[f] === undefined || args[f] === null || args[f] === '');
  if (missing.length === 0) return null;

  return {
    code: 'INVALID_ARGS',
    message: `Missing required arguments for ${toolName}: ${missing.join(', ')}`,
    retryable: true,
    expectedFields: requiredFields,
    expectedSchema: `{ ${requiredFields.map(f => f + ': <required>').join(', ')} }`,
    suggestedNextAction: `Call ${toolName} again with all required fields: ${requiredFields.join(', ')}`,
  };
}

// ============================================================================
// No-Progress Loop Detection
// ============================================================================

export interface LoopDetectorState {
  consecutiveFailures: number;
  lastSuccessfulStep: number;
  totalSteps: number;
  failedToolKeys: Map<string, number>;
  /**
   * Bug #41: parallel map of `${toolName}:${JSON.stringify(args)}` → real error
   * message. The detector's `failedToolKeys` is dedup-counted, not error-stored,
   * so we keep a separate map to feed real ENOENT/capability/timeout strings
   * into the [STEER] loop_abort payload. Without this the steer would only see
   * a placeholder `"repeated failure"` string and could not categorize the
   * abort reason correctly (Bug #41 reviewer finding).
   */
  failedToolErrors: Map<string, string>;
}

export function createLoopDetectorState(): LoopDetectorState {
  return {
    consecutiveFailures: 0,
    lastSuccessfulStep: 0,
    totalSteps: 0,
    failedToolKeys: new Map(),
    failedToolErrors: new Map(),
  };
}

/**
 * Result of recording a tool execution. Includes the abort message (if any)
 * AND a structured abort payload (Bug #41) so the caller can emit a final
 * SSE `loop_abort` event for the UI banner. The autoRecoverTo field tells
 * the caller which tool to use for binary_missing aborts (e.g. write_file).
 *
 * Note: `message` is the PLAIN-TEXT abort message for backward-compat with
 * existing callers. The `[STEER]`-prefixed prompt is in `abort.steer`. This
 * keeps the old string contract (no `[STEER]` prefix leak into UI strings)
 * while still giving callers the structured steer for re-prompting.
 */
/**
 * Bug #41: structured abort payload shape. Re-exported alongside
 * `LoopDetectorResult` so call sites can type their return values without
 * reaching into the full interface.
 */
export type LoopAbortPayload = NonNullable<LoopDetectorResult['abort']>;

export interface LoopDetectorResult {
  /** Plain-text abort message for backward-compatibility with existing callers. */
  message: string | null;
  /** Bug #41: structured abort payload for the final SSE `loop_abort` event. */
  abort?: {
    abortReason: 'binary_missing' | 'wrong_tool_name' | 'timeout' | 'unknown';
    consecutive: number;
    failedTools: Array<{ name: string; error: string }>;
    suggestion: string;
    autoRecoverTo?: string;
    /** The [STEER] prompt the LLM should receive as a follow-up. */
    steer?: string;
  };
}

/**
 * Bug #41: extract the real error string from a tool result's `error` field.
 * Tool results arrive in many shapes (string | { message } | { code, message }
 * | arbitrary object). The [STEER] loop_abort categorizer needs the raw string
 * to detect ENOENT / capability-not-found / timeout patterns. Returns
 * undefined when no usable string can be derived.
 *
 * Exported so both call sites (mastra/agent-loop.ts and
 * unified-agent-service.ts) use the same extraction logic.
 */
export function extractToolError(e: unknown): string | undefined {
  if (typeof e === 'string') return e;
  if (!e || typeof e !== 'object') return undefined;
  const obj = e as { message?: unknown; code?: unknown };
  if (typeof obj.message === 'string') return obj.message;
  try {
    return JSON.stringify(e);
  } catch {
    return undefined;
  }
}

/**
 * Bug #41: type guard for the structured LoopDetectorResult. Lets call sites
 * narrow `recordStepAndCheckLoop` return without an inline `'abort' in loopMsg`
 * check, and TypeScript verifies the `.abort` field is defined inside the
 * branch.
 */
export function isLoopDetectorResult(x: unknown): x is LoopDetectorResult {
  return (
    typeof x === 'object' &&
    x !== null &&
    'message' in (x as Record<string, unknown>) &&
    typeof (x as { abort?: unknown }).abort === 'object' &&
    (x as { abort?: unknown }).abort !== null
  );
}

/**
 * Bug #41: map an abortReason to a tool the LLM can auto-recover to.
 * `binary_missing` is the dominant case (the LLM is trying to call a binary
 * that doesn't exist); switching to `write_file` is the safest recovery.
 */
function autoRecoverToolFor(abortReason: 'binary_missing' | 'wrong_tool_name' | 'timeout' | 'unknown'): string | undefined {
  switch (abortReason) {
    case 'binary_missing':
      return 'write_file';
    case 'wrong_tool_name':
      // No single "replacement" tool — the LLM must pick the right canonical
      // name from the system prompt. Return undefined so the UI does not
      // pre-fill a misleading tool.
      return undefined;
    case 'timeout':
    case 'unknown':
      return undefined;
  }
}

/**
 * Bug #41: when the 3-consecutive-tool-failures kill fires, build a [STEER]
 * prompt and a structured abort payload in one call. The caller wires the
 * steer into the next LLM turn and emits the abort payload as a final SSE
 * `loop_abort` event so the UI can show a banner.
 *
 * `message` is the plain-text abort reason (preserves the old string contract
 * — no `[STEER]` prefix leaks into UI strings). `abort.steer` is the
 * `[STEER]`-prefixed reprompt for the LLM.
 */
function buildLoopAbortResult(
  state: LoopDetectorState,
): { message: string; abort: NonNullable<LoopDetectorResult['abort']> } {
  // Collect the last few failed tool calls (dedup by tool name) so the steer
  // is grounded in REAL failures (with their real error strings), not just a
  // count + placeholder. The failedToolErrors parallel map is keyed the same
  // way as failedToolKeys; we look up by full key and split on the FIRST `:`
  // (which separates the tool name from JSON.stringify(args)). Args can
  // contain `:` in JSON but the leading tool name is the part that the
  // categorizeAbortReason classifier keys on, so this split is safe.
  const failedTools: Array<{ name: string; error: string }> = [];
  for (const [key] of state.failedToolKeys) {
    const sep = key.indexOf(':');
    const name = sep >= 0 ? key.slice(0, sep) : key;
    const realError = state.failedToolErrors.get(key);
    failedTools.push({ name, error: realError || 'repeated failure' });
    if (failedTools.length >= 3) break;
  }
  // If we have no failed tool keys (shouldn't happen on the 3-consecutive
  // path but guard anyway), fall back to a single placeholder so the steer
  // body still parses.
  if (failedTools.length === 0) {
    failedTools.push({ name: 'unknown', error: 'consecutive tool failures' });
  }

  const wire = safeSteer(() =>
    wireLoopAbortSteer({ consecutive: state.consecutiveFailures, recentFailures: failedTools }),
  );

  // safeSteer never throws; wireLoopAbortSteer returns null only when
  // consecutive < 1, which can't happen here (we just checked >= 3).
  const baseSuggestion = 'Review the recent tool-call errors and try a different approach.';
  if (!wire) {
    const message = `Agent stopped: ${state.consecutiveFailures} consecutive tool failures with no success. The task may need a different approach.`;
    return {
      message,
      abort: {
        abortReason: 'unknown',
        consecutive: state.consecutiveFailures,
        failedTools,
        suggestion: baseSuggestion,
      },
    };
  }

  const autoRecoverTo = autoRecoverToolFor(wire.abort.abortReason);
  // Plain-text message for the UI (Bug #41 reviewer finding: keep the
  // `[STEER]` prefix out of the user-visible string).
  const message = `Agent stopped after ${state.consecutiveFailures} consecutive tool failures (${wire.abort.abortReason}). ${wire.abort.suggestion}`;
  return {
    message,
    abort: {
      abortReason: wire.abort.abortReason,
      consecutive: wire.abort.consecutive,
      failedTools: wire.abort.failedTools,
      suggestion: wire.abort.suggestion,
      ...(autoRecoverTo ? { autoRecoverTo } : {}),
      steer: wire.steer,
    },
  };
}

/**
 * Record a tool execution result and check for loop conditions.
 *
 * Returns `null` if OK, a `string` for backward-compat with old callers, or a
 * `LoopDetectorResult` (Bug #41) when the structured abort payload is needed
 * for the final SSE `loop_abort` event. Existing callers that treat the
 * return as a string still work because `LoopDetectorResult.message` is the
 * same plain-text message they would have received.
 *
 * @param error — Optional real error message from the failed tool. When
 *   provided on a failure, it's stored in `state.failedToolErrors` so the
 *   Bug #41 loop_abort steer can categorize the abort reason correctly
 *   (binary_missing vs wrong_tool_name vs timeout). Default is undefined —
 *   the detector falls back to a placeholder string and the steer gets
 *   `abortReason: 'unknown'`.
 */
export function recordStepAndCheckLoop(
  state: LoopDetectorState,
  toolName: string,
  args: Record<string, any>,
  success: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  error?: string,
): string | LoopDetectorResult | null {
  state.totalSteps++;

  if (success) {
    state.consecutiveFailures = 0;
    state.lastSuccessfulStep = state.totalSteps;
  } else {
    state.consecutiveFailures++;

    // Track identical failed calls
    const toolKey = `${toolName}:${JSON.stringify(args)}`;
    const count = (state.failedToolKeys.get(toolKey) || 0) + 1;
    state.failedToolKeys.set(toolKey, count);
    // Bug #41: remember the real error so the [STEER] loop_abort payload
    // can categorize the abort reason. The first-seen error is the most
    // useful (later errors are usually the same root cause re-surfacing).
    if (error && !state.failedToolErrors.has(toolKey)) {
      state.failedToolErrors.set(toolKey, error);
    }

    // Exact-repeat detection
    if (count >= 2) {
      return `Agent stopped: "${toolName}" failed ${count} times with the same arguments. Do NOT retry — try a different approach or path.`;
    }
  }

  // No-progress: 3 consecutive failures — Bug #41: emit a categorized [STEER]
  // loop_abort and surface the abort reason to the UI as a final SSE event.
  if (state.consecutiveFailures >= 3) {
    const result = buildLoopAbortResult(state);
    log.warn('[LOOP-ABORT] 3-consecutive-tool-failures kill fired', {
      consecutive: state.consecutiveFailures,
      abortReason: result.abort.abortReason,
      autoRecoverTo: result.abort.autoRecoverTo,
      failedTools: result.abort.failedTools.map(t => t.name),
    });
    return result;
  }
  // Note: `error` is consumed in the failure branch above (stored in
  // failedToolErrors). On the success branch it is intentionally unused;
  // the function is a stateful side-effect API and the param documents
  // the intent (callers should pass real error strings when available).

  // No-progress: 6+ steps with zero successes
  if (state.totalSteps > 6 && state.lastSuccessfulStep === 0) {
    return `Agent stopped: ${state.totalSteps} tool calls with no successful result. Try a simpler approach.`;
  }

  return null;
}

// ============================================================================
// Shared System Prompt Builder
// ============================================================================

export interface AgentPromptContext {
  workspacePath: string;
  workspaceSnapshot: string;
  currentFile?: string;
  lastAction?: string;
  toolDescriptions: string;
  extraInstructions?: string;
}

/**
 * Build a system prompt with workspace context and self-healing instructions.
 * Use this from any execution path for consistency.
 */
export function buildAgentSystemPrompt(ctx: AgentPromptContext): string {
  const currentFileNote = ctx.currentFile ? `\nCurrently focused file: ${ctx.currentFile}` : '';
  const lastActionNote = ctx.lastAction ? `\nLast action: ${ctx.lastAction}` : '';
  const extra = ctx.extraInstructions ? `\n${ctx.extraInstructions}\n` : '';

  return `You are an AI coding assistant with workspace tools.

## Workspace
Root: ${ctx.workspacePath}${currentFileNote}${lastActionNote}

### Existing Files
${ctx.workspaceSnapshot}

## Available Tools
${ctx.toolDescriptions}
${extra}
## Rules
1. ALWAYS use function calls for tools — never output JSON or text like "[Tool: write_file]".
2. Use ONLY paths from the file listing above, or new paths you are creating. Do NOT guess paths.
3. Before editing an unfamiliar file, read it first with read_file.
4. write_file and batch_write automatically create parent directories.
5. Prefer minimal, surgical edits. Read → understand → write the smallest correct change.
6. If a tool fails, read the error carefully. Do NOT retry the exact same call — try a different approach.
7. After 2 failures on the same path, call list_directory on the parent to discover what actually exists.

## Error Recovery
- PATH_NOT_FOUND → check suggestedPaths in the error, or call list_directory on the parent
- INVALID_ARGS → check the error's expectedFields list and retry with correct field names
- Do NOT repeat failing calls. Each retry must change something.

When the task is complete, respond naturally with your final answer.
`;
}
