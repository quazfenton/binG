import { READ_ONLY_TOOL_NAMES, CAPABILITY_PREFIX_TOOLS, normalizeToolName, isReadOnlyTool, isWriteTool } from '@bing/shared/agent/tool-classification';
import { resolveDefaultContinue } from '@bing/shared/agent/first-response-routing';
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
    | 'plan_steps_remaining'
    | 'single_write_then_stop'
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

const WRITE_TOOL_HINTS = [
  'write_file',
  'batch_write',
  'create_file',
  'writeTo',
  'write_files',
] as const;

const WRITE_FILE_PREFIX_TOOLS = [
  'file.write',
  'file.batch_write',
  'file.create',
] as const;

function isWriteToolStep(step: { toolName?: string }): boolean {
  const name = (step.toolName || '').toLowerCase();
  if (WRITE_TOOL_HINTS.includes(name as (typeof WRITE_TOOL_HINTS)[number])) return true;
  if (WRITE_FILE_PREFIX_TOOLS.includes(name as (typeof WRITE_FILE_PREFIX_TOOLS)[number])) return true;
  return false;
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
 * Read-only / information-gathering tool names. The collated list matches:
 *   - snake_case canonical:  `read_file`, `list_files`, `web_search`
 *   - camelCase variants:    `readFile`, `listFiles`, `webSearch`
 *   - capability-style dots: `file.read`, `repo.search`, `web.search`
 *
 * The hint-matching logic uses three independent paths:
 *   1. `canonical === hint`    — direct snake_case literal match
 *   2. `canonical === prefix`  — direct capability-style dotted match
 *   3. `compressed === _compressUnderscores(...)` — camelCase alias match
 *
 * Why not substring matching? `file.batch_write.file.read` would falsely
 * match as read-only — we want exact-name normalization, not traversal.
 *
 * Note: `list_files` is the family name used in `agent-bins/agent-filesystem`
 * and `__tests__/premature-stoppage`, distinct from `list_directory` /
 * `list_dir` alias forms. All three are kept because providers emit
 * different variants.
 */


/**
 * Capability-style dotted names: `domain.action`. Matched via the
 * `canonical === prefix` direct-compare path (the dotted form is
 * preserved after canonicalization — we do NOT replace `.` with `_`).
 */


/**
 * Canonicalize a raw tool name for hint matching:
 *   - lowercase
 *   - whitespace stripped
 *
 * We intentionally do NOT replace `.` with `_` here: `CAPABILITY_PREFIX_TOOLS`
 * keeps its dotted form (e.g. `'file.read'`) and matches the canonicalized name
 * directly. If we collapsed `.` to `_`, the PREFIX list would only match via the
 * compressed check, which is less obvious.
 *
 * Empty input returns '' so callers can short-circuit.
 */
function _canonicalToolName(name: string): string {
  return (name || '').toLowerCase().trim();
}

/**
 * Drop underscores so camelCase variants (`listFiles`, `webSearch`)
 * compare against compressed hint forms (`listfiles`, `websearch`)
 * without enumerating every alias by hand.
 *
 * Example matches:
 *   `readFile`   → `readfile`   ↔  `read_file` → `readfile`  ✓
 *   `webSearch`  → `websearch`  ↔  `web_search`→ `websearch` ✓
 *   `listFiles`  → `listfiles`  ↔  `list_files`→ `listfiles` ✓
 *   `fileRead`   → `fileread`   ↔  `file.read` → `fileread`  ✓
 */
function _compressUnderscores(name: string): string {
  return name.replace(/_/g, '');
}

function isReadOnlyStep(step: { toolName?: string }): boolean {
  const canonical = _canonicalToolName(step.toolName || '');
  if (!canonical) return false;
  const compressed = _compressUnderscores(canonical);
  for (const hint of READ_ONLY_TOOL_NAMES) {
    if (canonical === hint) return true;
    if (compressed && compressed === _compressUnderscores(hint)) return true;
  }
  for (const prefix of CAPABILITY_PREFIX_TOOLS) {
    if (canonical === prefix) return true;
    if (compressed && compressed === _compressUnderscores(prefix)) return true;
  }
  return false;
}

/**
 * Map a raw tool name to a human-friendly description for use in the
 * continuation prompt. Categories cover the entries in
 * READ_ONLY_TOOL_NAMES / CAPABILITY_PREFIX_TOOLS — anything not
 * in the map falls back to the canonicalized form. Why a map rather
 * than blanket text? The LLM-side prompt quality is better with named
 * categories ("a web search" reads as English; "a web_search" does not).
 */
function _humanizeToolName(raw: string): string {
  const canonical = _canonicalToolName(raw);
  if (!canonical) return 'an info-gathering tool';
  const CATEGORY_MAP: Record<string, string> = {
    // filesystem reads
    read_file: 'a file',
    read_url: 'a web URL',
    list_files: 'a directory listing',
    list_directory: 'a directory listing',
    list_dir: 'a directory listing',
    ls: 'a directory listing',
    // search family
    search_files: 'a file search',
    grep: 'a code search',
    glob: 'a file pattern match',
    find: 'a filesystem find',
    search_code: 'a code search',
    grep_code: 'a code search',
    // web/network
    web_search: 'a web search',
    web_fetch: 'a web fetch',
    // capability-style
    'file.read': 'a file',
    'file.list': 'a directory listing',
    'file.search': 'a file search',
    'repo.search': 'a repository search',
    'web.search': 'a web search',
    'web.fetch': 'a web fetch',
  };
  return CATEGORY_MAP[canonical] || `a ${canonical.replace(/_/g, ' ')} tool`;
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

// === Stage 0/1 single-source-of-truth (cascade Q2 helper, option-C) ===
// ContinueDecisionBase is the canonical struct consumed by route.ts'
// do-while(false) band gate; both `ContinueDecision` (new surface) and
// `ContinuationDecision` (legacy surface) derive from this base so the
// two names remain runtime-equivalent at the type level.

export type ContinuationReason =
  | 'plan_steps_remaining'
  | 'single_step_read_pattern'
  | 'max_iterations'
  | 'user_stop'
  | 'agent_stop'
  | 'resolved';

export interface ContinueDecisionBase {
  continue: boolean;
  reason?: ContinuationReason;
  clearedCount?: number;
  finalIteration?: number;
}

// option-C: both names derive from the same base type so callers can
// import either name and get identical runtime + compile-time semantics.
export type ContinueDecision = ContinueDecisionBase;
export type ContinuationDecision = ContinueDecisionBase;


export function shouldAutoContinue(input: {
  routing?: {
    continue?: boolean;
    stepReprompt?: string;
    primaryRole?: string;
    estimatedSteps?: number;
    planSteps?: PlanStep[];
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
  const planStepsCount = routing?.planSteps?.length ?? routing?.estimatedSteps ?? 0;

  // Env-default-on guard: when no routing metadata is provided, defer to
  // resolveDefaultContinue (env-default-aware). Makes the env-default-on
  // contract load-bearing instead of heuristic-only via the trigger chain.
  // RT-001 sibling: see also first-response-routing.ts:255 producer
  // ternary and :373 consumer gate.
  if (routing == null) {
    const shouldContinue = resolveDefaultContinue();
    return {
      continue: shouldContinue,
      reason: shouldContinue ? 'plan_steps_remaining' : 'no_continuation_needed',
      continuationPrompt: shouldContinue ? 'Continue with the plan.' : '',
      continuationsSoFar,
    };
  }

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

  // 3. Single-step read pattern → the LLM gathered information (file read,
  //    directory listing, web search, grep/glob/find, etc.) but didn't act
  //    on it. Auto-continue with a steer to take the next action. The
  //    prompt wording is generic now that the detector covers more than
  //    just `read_file` — see READ_ONLY_TOOL_NAMES for the full set.
  if (isSingleReadOnlyStep(steps)) {
    const rawToolName = steps[0]?.toolName || '';
    // Sanitize the raw provider name so camelCase / dotted variants
    // (`listFiles`, `file.read`) don't leak into the model's context.
    // Use a small category map for the most common shapes and fall back
    // to the lowercased snake_case form.
    const toolName = _humanizeToolName(rawToolName);
    return {
      continue: true,
      reason: 'single_step_read_pattern',
      continuationPrompt:
        `[AUTO-CONTINUE] You called ${toolName} in the previous turn but did not take a follow-up action. ` +
        'Based on the information you gathered, proceed with the next step of the task ' +
        '(e.g., write or edit the file, run a command, or summarize your findings).',
      continuationsSoFar: continuationsSoFar + 1,
    };
  }

  // 4. Plan steps remaining (Bug #11): routing outlined multiple steps
  //    but the model only completed 1 tool call. Auto-continue so the
  //    model finishes the remaining steps.
  if (planStepsCount >= 2 && steps.length >= 1 && steps.length < planStepsCount) {
    return {
      continue: true,
      reason: 'plan_steps_remaining',
      continuationPrompt:
        `[AUTO-CONTINUE] You completed step ${steps.length} of ${planStepsCount}. Continue with the remaining steps of the plan. ` +
        'Pick up from where you left off and complete the remaining work.',
      continuationsSoFar: continuationsSoFar + 1,
    };
  }

  // 5. Single write then stop (Bug #11 variant): one batch_write/write_file
  //    was used, but the task likely needs more files. If there were exactly
  //    1 write-tool step and the response ended with finishReason=stop (no
  //    more tool calls), the model "wrote 3 files and died."
  const writeSteps = steps.filter(isWriteToolStep);
  if (writeSteps.length === 1 && steps.length <= 2 && planStepsCount <= 1) {
    return {
      continue: true,
      reason: 'single_write_then_stop',
      continuationPrompt:
        '[AUTO-CONTINUE] You wrote files but the original task may need more. ' +
        'Review what you created and check if additional files (e.g., package.json, README, ' +
        'tests, configuration) or further edits are needed to make the project complete and runnable.',
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
