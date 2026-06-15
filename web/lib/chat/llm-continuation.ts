/**
 * LLM Continuation Helper
 *
 * PURPOSE: Centralize the logic for detecting when an LLM response has
 * "stopped prematurely" and building a continuation prompt that the route
 * layer can use to issue a follow-up turn.
 *
 * BACKGROUND: The user reported that the LLM often stops at step 1
 * (generating a basic HTML or plan) and never continues the chat flow
 * even when tool calls (e.g., read_file) have a clear purpose that
 * requires follow-up action. The root cause is that the route layer
 * does NOT actively trigger a re-prompt when:
 *   1. `roleSelection.continue === true` (from first-response routing)
 *   2. A tool was called with empty `args: {}`
 *   3. Only 1 tool step was used and the LLM's response was a tool
 *      result that needs follow-up (e.g., read_file output)
 *
 * This module provides the detection + prompt-building logic as a pure
 * function so the route layer can call it without coupling to the
 * underlying auto-continue / first-response-routing / successive-tracker
 * modules. The route layer is responsible for actually issuing the
 * follow-up LLM call (this module is read-only).
 *
 * USAGE:
 *   const decision = shouldAutoContinue({
 *     routing: result.metadata?.routing,
 *     steps: result.steps,
 *     responseText: streamingContentBuffer,
 *     maxContinuations: 3,
 *   });
 *   if (decision.continue) {
 *     // Issue a follow-up LLM call with decision.continuationPrompt
 *   }
 *
 * SAFETY: This module is PURE — it does not call any LLM, does not
 * mutate state, and does not throw. The route layer is the single
 * integration point that decides whether to act on the recommendation.
 */

export interface ContinuationDecision {
  /** Whether the route should issue a follow-up LLM call. */
  continue: boolean;
  /**
   * The reason for the continuation. Surfaced in logs and metadata
   * so operators can understand WHY the chat is being continued.
   */
  reason:
    | 'role_selection_continue_true'
    | 'empty_tool_args_detected'
    | 'single_step_read_pattern'
    | 'no_continuation_needed'
    | 'max_continuations_reached';
  /**
   * The prompt to send to the LLM for the continuation turn. Only
   * populated when `continue === true`. The route layer should prepend
   * this to the next user message (or send as a separate user turn)
   * depending on its streaming architecture.
   */
  continuationPrompt: string;
  /**
   * The number of continuations that have already happened in this
   * turn. Used by the route layer to enforce a hard cap.
   */
  continuationsSoFar: number;
}

/**
 * Detect empty arguments in a tool call step. A tool call with `args: {}`
 * is a known failure mode that causes the stream to silently stop. The
 * LLM needs a steer to provide the required arguments.
 *
 * IMPORTANT: Only triggers when `args` is PRESENT-but-EMPTY (i.e. the
 * LLM explicitly emitted `{}`). We do NOT trigger on `args: undefined`
 * because many tools have all-optional args (e.g. `list_directory`,
 * `grep`, `web_search`) where `undefined` is a valid call.
 */
function hasEmptyToolArgs(steps: ReadonlyArray<{ args?: Record<string, unknown> }>): boolean {
  return steps.some((s) => {
    if (!s.args || typeof s.args !== 'object') return false;
    return Object.keys(s.args).length === 0;
  });
}

/**
 * Detect the "single-step read" pattern: the LLM made exactly 1 tool call
 * and it was a read-only tool (read_file, list_directory, search_files,
 * web_search, web_fetch). After a read, the LLM should normally continue
 * with an action (write, edit, etc.). If it stopped, the chat is
 * "incomplete" and the route should auto-continue.
 */
/**
 * Read-only tool canonical names. Matched EXACTLY (name === hint) or
 * with the canonical `file.<action>` prefix. We do NOT use substring
 * matching or `endsWith` because a tool named `file.batch_write.file.read`
 * would falsely match as read-only.
 */
const READ_ONLY_TOOL_HINTS = [
  'read_file',
  'list_directory',
  'list_dir',
  'ls',
  'search_files',
  'grep',
  'glob',
  'find',
  'search_code',
  'grep_code',
  'web_search',
  'web_fetch',
] as const;

const READ_ONLY_FILE_PREFIX_TOOLS = [
  'file.read',
  'file.list',
] as const;

function isReadOnlyStep(step: { toolName?: string }): boolean {
  const name = (step.toolName || '').toLowerCase();
  if (READ_ONLY_TOOL_HINTS.includes(name as (typeof READ_ONLY_TOOL_HINTS)[number])) {
    return true;
  }
  if (READ_ONLY_FILE_PREFIX_TOOLS.includes(name as (typeof READ_ONLY_FILE_PREFIX_TOOLS)[number])) {
    return true;
  }
  return false;
}

function isSingleReadOnlyStep(steps: ReadonlyArray<{ toolName?: string }>): boolean {
  return steps.length === 1 && isReadOnlyStep(steps[0]);
}

/**
 * Determine whether the LLM response should trigger an auto-continuation
 * turn, and build the continuation prompt if so.
 *
 * @param input - The context for the decision
 * @param input.routing - The `result.metadata.routing` object from the
 *   first-response routing metadata (may be undefined)
 * @param input.steps - The `result.steps` array of tool calls made by
 *   the LLM (may be empty)
 * @param input.responseText - The full text response from the LLM
 * @param input.continuationsSoFar - How many continuations have already
 *   happened in this turn (route layer tracks this)
 * @param input.maxContinuations - Hard cap on continuations per turn
 *   (default 3, configurable via env LLM_MAX_CONTINUATIONS_PER_TURN)
 * @returns A `ContinuationDecision` describing whether to continue and
 *   what prompt to use
 */
export function shouldAutoContinue(input: {
  routing?: {
    continue?: boolean;
    stepReprompt?: string;
    primaryRole?: string;
    estimatedSteps?: number;
  };
  steps?: ReadonlyArray<{ toolName?: string; args?: Record<string, unknown> }>;
  responseText?: string;
  continuationsSoFar: number;
  maxContinuations?: number;
}): ContinuationDecision {
  const maxContinuations = input.maxContinuations ?? 3;
  const continuationsSoFar = input.continuationsSoFar;

  // Hard cap: never continue more than maxContinuations times per turn
  if (continuationsSoFar >= maxContinuations) {
    return {
      continue: false,
      reason: 'max_continuations_reached',
      continuationPrompt: '',
      continuationsSoFar,
    };
  }

  const steps = input.steps ?? [];
  const routing = input.routing;

  // 1. roleSelection.continue === true → continue with the plan's next step
  if (routing?.continue === true) {
    const basePrompt = routing.stepReprompt
      ? routing.stepReprompt
      : 'Continue with the next step of the plan. Pick up from where you left off and complete the remaining work.';
    return {
      continue: true,
      reason: 'role_selection_continue_true',
      continuationPrompt: basePrompt,
      continuationsSoFar: continuationsSoFar + 1,
    };
  }

  // 2. Empty tool args detected → inject a feedback steer
  if (hasEmptyToolArgs(steps)) {
    return {
      continue: true,
      reason: 'empty_tool_args_detected',
      continuationPrompt:
        '[AUTO-CONTINUE] The previous tool call had no arguments (args was empty or missing). ' +
        'Please provide the required arguments for the tool and retry. ' +
        'If you no longer need to call that tool, proceed with the next step of the plan.',
      continuationsSoFar: continuationsSoFar + 1,
    };
  }

  // 3. Single-step read pattern → the LLM read something but didn't act
  //    on it. Auto-continue with a steer to take the next action.
  if (isSingleReadOnlyStep(steps)) {
    return {
      continue: true,
      reason: 'single_step_read_pattern',
      continuationPrompt:
        '[AUTO-CONTINUE] You read a file in the previous turn but did not take a follow-up action. ' +
        'Based on the file content, proceed with the next step of the task ' +
        '(e.g., write the file, edit it, or run the next command).',
      continuationsSoFar: continuationsSoFar + 1,
    };
  }

  return {
    continue: false,
    reason: 'no_continuation_needed',
    continuationPrompt: '',
    continuationsSoFar,
  };
}
