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
 *   const decision = shouldAutoContinue({...});
 *
 *   if (decision.continue && decision.continuationPrompt) {
 *     // Issue a follow-up LLM call with the prompt
 *   }
 *
 * SAFETY: This module is PURE — it does not call any LLM, does not
 * mutate state, and does not throw.
 *
 * TYPE CONTRACT (Stage 0/1 single-source-of-truth, cascade Q2 + Q3):
 *   The canonical struct is `ContinueDecisionBase` → `ContinueDecision`
 *   (new surface) and `ContinuationDecision` (legacy surface) are
 *   aliases for the same base. The reason enum is `ContinuationReason`.
 *   Older `ContinuationDecision`-consumers (route.ts continuous-flow,
 *   auto-continue-helper detectors) read the same struct via either
 *   name. `decision.continuationPrompt` and `decision.continuationsSoFar`
 *   are still populated by `shouldAutoContinue` as extras (TS structural
 *   subtyping tolerates them on object literals typed against the base).
 */

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
 *
 * Style split in CATEGORY_MAP (do NOT harmonize without re-reading this):
 *   - READ family: gerund-style ("a file read", "a web URL read") so the
 *     prompt template "You called X in the previous turn…" reads as
 *     "[you] performed a file read" (action), not as "[you] called THE
 *     file" (object). The bare-object form caused ambiguity in prompts.
 *   - OTHER families: noun-phrase ("a directory listing", "a web search",
 *     "a code search") — already reads as English in the prompt template
 *     without needing the gerund pivot.
 *
 * Exported as `humanizeToolName` (was `_humanizeToolName`) and tagged
 * SEMI-PUBLIC so tests can assert on the producer contract directly
 * instead of pinning the continuation-prompt regex to brittle literal
 * wording. Do NOT treat this as the module's stable consumer API — if
 * internal callers need to humanize a tool name outside of test
 * contexts, the export may be re-privatized behind a thin wrapper.
 */
export function humanizeToolName(raw: string): string {
  const canonical = _canonicalToolName(raw);
  if (!canonical) return 'an info-gathering tool';
  const CATEGORY_MAP: Record<string, string> = {
    // READ family — gerund-style (see JSDoc for the rationale)
    read_file: 'a file read',
    read_url: 'a web URL read',
    // filesystem listings
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
    'file.read': 'a file read',
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
 * Circuit-breaker detector for the chat-loop bug.
 *
 * Pattern (visible in dev-server log when a tool error propagates into the
 * next continuation, e.g. a VFS `enableBatchMode` TypeError):
 *   1. Tool call fails internally (result.success === false || result.error set)
 *   2. LLM receives the failure in tool-result context
 *   3. LLM's next text response is just plan-language ("I'll now ...", "first ..."
 *      "then ...", "let me ...") instead of concrete next-action tool calls
 *   4. AutoContinue.plan_steps_remaining re-fires because
 *      steps.length < planStepsCount is still satisfied
 *   5. The cycle repeats until MAX_CONTINUATIONS (default 3) silently caps it
 *   6. User sees duplicated message bubbles and 60s+ POST /api/chat waits
 *
 * Refuse to re-invoke when ALL three conditions match so the LLM is forced
 * to either (a) actually execute a tool successfully or (b) surface the
 * failure to the user instead of looping on a fresh `I'll now` prompt.
 *
 * Guards prevent false positives:
 *   - `hasFailure && !hasSuccess` — any positive tool result alongside the
 *     failure means the LLM is making progress (e.g. one read worked, one
 *     write failed). Don't fight genuine forward motion.
 *   - responseText length 30..1000 — too short = no plan words yet (every
 *     legitimate continuation prompt is longer); too long = real content
 *     (not a plan-only response).
 *   - Plan-pattern regex tuned to match the LLM vocabulary in the bug log
 *     (Phase 6 telemetry tagging): "I'll now", "let me", "next I'll", "first,"
 *     "then I", "after that", "finally".
 */
  // Failure detection (defending future refactors):
  //   - r.success === true                        → success (ignores any
  //     `error` field that may carry incidental metadata on a successful
  //     run, e.g. partial warnings that don't represent failure)
  //   - r.success === false                       → definitive failure
  //   - r.success === undefined + meaningful error → failure (treat the
  //     error field as the failure marker when the success flag wasn't set)
  //   - r.success === undefined + null/empty error → no signal. Critically:
  //   express-style `{ success: undefined, error: null }` and
  //   `{ success: undefined, error: '' }` do NOT trip the breaker.
  // Do NOT switch to `r.error !== undefined` or `!!r.error` — the previous
  // implementation's `!== undefined` check mis-classified `error: null`
  // and `error: ''` as failures. The check below is intentionally
  // conservative against false positives so express-style success markers
  // remain compatible with the circuit-breaker semantics.
  function _detectFailurePlanLoop(
  steps: ReadonlyArray<{ result?: { success?: boolean; error?: unknown } }> | undefined,
  responseText: string | undefined,
): boolean {
  if (!steps || steps.length === 0) return false;
  let hasFailure = false;
  let hasSuccess = false;
  for (const s of steps) {
    const r = s?.result;
    if (!r) continue;
    if (r.success === true) {
      hasSuccess = true;
      continue;
    }
    if (r.success === false) {
      hasFailure = true;
      continue;
    }
    // success === undefined: fall back to the error field, ignoring
    // express-style null/empty-string sentinel values.
    const err = r.error;
    const errorIsMeaningful =
      err !== undefined && err !== null && err !== '';
    if (errorIsMeaningful) {
      hasFailure = true;
    }
  }
  if (!hasFailure || hasSuccess) return false;
  if (!responseText) return false;
  const len = responseText.length;
  if (len < 30 || len > 1000) return false;
  // Plan-language regex matched against the Phase 6 telemetry fingerprint
  // of the chat-loop bug (see top-of-file comment for the full bug
  // pattern). Keep this list narrow: the helper fires by intent on
  // *planning-shape* responses, not on every conversational sentence
  // containing a modal verb. Adding broad variants like `\bi should\b`
  // would make legitimate follow-ups (e.g. "I should also note this API
  // is deprecated") trigger the breaker and reject valid continuations.
  return /\b(i'll now\b|\blet me\b|\bnext i('ll| will)\b|\bi will (start|begin|proceed|continue)\b|\bnow i('ll| will)\b|\bthen i\b|\bfirst,?\s+(let me|i('ll| will)|we|next)\b|\bafter that\b|\bfinally\b)/i.test(
    responseText,
  );
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
// `ContinueDecisionBase` is the canonical struct consumed by route.ts'
// do-while(false) band gate; both `ContinueDecision` (new surface) and
// `ContinuationDecision` (legacy surface) derive from this base so the
// two names remain runtime-equivalent at the type level.
// `clearedCount` + `finalIteration` are now OPTIONAL: per-call
// construction sites that build `{ continue, reason }` shapes should not
// be forced to supply numbers; Q5 caller-leak risk is mitigated by
// consumers reading optional fields with `?? 0` defaults rather than
// asserting presence.
// `ContinuationReason` is the union of EVERY literal `shouldAutoContinue`
// actually emits, so the typed-discriminator contract works end-to-end:
// route.ts SSE payload schema + runV1ApiWithTools.test.ts's
// `decision.reason === 'single_step_read_pattern'` discriminator check
// both compile against the typed enum, not against `string`.
export type ContinuationReason =
  | 'role_selection_continue_true'
  | 'empty_tool_args_detected'
  | 'single_step_read_pattern'
  | 'plan_steps_remaining'
  | 'single_write_then_stop'
  // 'failure_plan_loop' is a dedicated reason emitted by the chat-loop
  // circuit-breaker (see _detectFailurePlanLoop below). Distinct from
  // 'no_continuation_needed' so SSE/log lines expose which branch closed
  // the loop — operators grep on this token to detect a chat stuck in
  // tool-failure → plan-only-text → re-invoke cycles (the VFS
  // enableBatchMode TypeError was the originating bug). Strictly additive:
  // existing switch statements with `default` cases are unaffected;
  // exhaustive switch statements without default need a new arm.
  // 'failure_plan_loop' is a dedicated reason emitted by the chat-loop
  // circuit-breaker (see _detectFailurePlanLoop below).
  | 'failure_plan_loop'
  // 'llm_continue_token_detected' fires when the LLM explicitly ends its
  // response with the [CONTINUE_REQUESTED] token (see system-prompts.ts:3684
  // for the LLM-facing instruction). Unlike the heuristic triggers below,
  // this is an EXPLICIT signal from the model — it means the LLM knows it
  // has more work to do and is asking for another turn. Placed highest in
  // priority after hard cap so it fires before heuristic detectors.
  | 'llm_continue_token_detected'
  | 'no_continuation_needed'
  | 'max_continuations_reached'
  | 'max_iterations'
  | 'user_stop'
  | 'agent_stop'
  | 'resolved';

export interface ContinueDecisionBase {
  continue: boolean;
  reason?: ContinuationReason;
  // Q5 strict: clearedCount + finalIteration are now REQUIRED metrics on the
  // typed decision base so route.ts's Stage 3 do-while(false) band gate can
  // rely on the metric fields without undefined-leak. Consumers that build
  // ad-hoc decisions must supply both. shouldAutoContinue + decideAutoContinue
  // (in auto-continue-helper.ts) now populate them at every return site.
  //
  // Q5-fields-audit (post-Bug #5): continuationPrompt + continuationsSoFar
  // are populated at every return site in shouldAutoContinue and
  // decideAutoContinue (see auto-continue-helper.ts), and consumers in
  // unified-agent-service.ts (L4665, L4698, L4715) read both fields directly.
  // Without them on the interface, the type contract is unsound and the
  // downstream `?? defaults` are required. Add them as REQUIRED so that
  // callers building ad-hoc decisions must supply them.
  //
  // SEMANTIC ANCHORS:
  // - continuationPrompt: the optional prompt overlay that may be appended
  //   to the next-iteration input. Empty string '' when no overlay applies.
  // - continuationsSoFar: monotonically-increasing count of continuation
  //   rounds dispatched by the gate so far (input counter, NOT inclusive of
  //   this decision). Match the input shape of shouldAutoContinue so the
  //   return value can be threaded straight back in next iteration.
  //
  // SEMANTIC ANCHORS (Q5 strict — added after the reviewer's naming-clarity flag):
  // - clearedCount: per-return-path semantics:
  //     * `continue: false` paths (max_continuations_reached, no_continuation_needed,
  //       role_selection_continue_true false-branch equivalents): equals input
  //       `continuationsSoFar` (PRE-decision snapshot — the counter at the moment
  //       the decision fired; "this many were in-flight").
  //     * `continue: true` paths (role_selection_continue_true, empty_tool_args_detected,
  //       single_step_read_pattern, plan_steps_remaining, single_write_then_stop,
  //       env-default-on with shouldContinue:true): equals `continuationsSoFar + 1`
  //       (POST-increment — this decision IS the Nth continuation being dispatched).
  //     * `decideAutoContinue continue: true`: equals `incrementContinuationCount(requestId)`
  //       return value (POST-increment; decides through the helper's own counter).
  //     * `decideAutoContinue continue: false`: equals input counter (PRE-decision snapshot).
  //     NOT "how many were cleared/terminated by the gate" — clear/clearance semantics
  //     require a separate tally that the helper does not maintain. Skip the
  //     consumer-side `?? 0` default; the value is always populated.
  // - finalIteration:
  //     The env-hard continuation cap in effect at the decision site. For
  //     shouldAutoContinue path: the local `maxContinuations` input (default 3,
  //     env LLM_MAX_CONTINUATIONS_PER_TURN). For decideAutoContinue path: the
  //     module-level MAX_CONTINUATIONS (= 3 default). These two are equivalent
  //     because decideAutoContinue calls shouldAutoContinue with
  //     `maxContinuations: MAX_CONTINUATIONS`. NOT a 0-indexed iteration slot
  //     count — to get that reading, subtract 1 at the consumer. Name is stable
  //     for cascade-marker continuity; downstream readers should anchor on this
  //     JSDoc instead of treating "finalIteration" as the last 0-indexed
  //     iteration number.
  continuationPrompt: string;
  continuationsSoFar: number;
  clearedCount: number;
  finalIteration: number;
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
    planSteps?: Array<{ action?: string }>;
  };
  steps?: ReadonlyArray<{ toolName?: string; args?: Record<string, unknown>; result?: { success?: boolean; error?: unknown } }>;
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
      clearedCount: continuationsSoFar,
      finalIteration: maxContinuations,
    };
  }

  const steps = input.steps ?? [];
  const routing = input.routing;
  const planStepsCount = routing?.planSteps?.length ?? routing?.estimatedSteps ?? 0;

  // Order matters: heuristic triggers that work off `steps` ONLY (Triggers 2
  // and 3) must fire BEFORE the routing==null catch-all. Previously this
  // catch-all ran first and shadowed them — any test (or real call) without
  // a `routing` object would short-circuit to `resolveDefaultContinue()` and
  // emit `plan_steps_remaining` instead of the more targeted
  // `empty_tool_args_detected` / `single_step_read_pattern` reason.
  // The catch-all is now a last-resort fallback positioned after Triggers 1-3
  // and before the routing-aware plan_steps_remaining + single_write rules.
  //
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
      clearedCount: continuationsSoFar + 1,
      finalIteration: maxContinuations,
    };
  }

  // 1b. LLM continue token detected → the model explicitly ended its
  //     response with [CONTINUE_REQUESTED] (see system-prompts.ts:3684).
  //     This is an EXPLICIT signal from the LLM — it knows it needs more
  //     turns. Place before heuristic triggers so the model's own request
  //     is honored over pattern-matching heuristics.
  if (input.responseText && /\[CONTINUE_REQUESTED\]\s*$/.test(input.responseText.trimEnd())) {
    return {
      continue: true,
      reason: 'llm_continue_token_detected',
      continuationPrompt:
        '[AUTO-CONTINUE] You requested continuation in your previous response. ' +
        'Continue from where you left off and complete the remaining work.',
      continuationsSoFar: continuationsSoFar + 1,
      clearedCount: continuationsSoFar + 1,
      finalIteration: maxContinuations,
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
      clearedCount: continuationsSoFar + 1,
      finalIteration: maxContinuations,
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
    // to the lowercased snake_case form. `humanizeToolName` is the
    // producer (see its doc for the gerund-style rationale).
    const toolName = humanizeToolName(rawToolName);
    return {
      continue: true,
      reason: 'single_step_read_pattern',
      continuationPrompt:
        `[AUTO-CONTINUE] You called ${toolName} in the previous turn but did not take a follow-up action. ` +
        'Based on the information you gathered, proceed with the next step of the task ' +
        '(e.g., write or edit the file, run a command, or summarize your findings).',
      continuationsSoFar: continuationsSoFar + 1,
      clearedCount: continuationsSoFar + 1,
      finalIteration: maxContinuations,
    };
  }

  // Env-default-on catch-all: when no routing metadata is provided AND none
  // of the steps-only heuristic triggers fired, defer to resolveDefaultContinue
  // (env-aware). This is now the LAST gate, not the first — Triggers 2 and 3
  // have priority because their steers are more specific than a generic
  // "Continue with the plan." RT-001 sibling: see first-response-routing.ts.
  //
  // When there are no tool steps and no routing, the LLM produced plain text
  // without any plan or tool work. There is nothing to continue from — the
  // response is a standalone answer (e.g. "yo" → "Hey there! How can I help?").
  // Only continue when the model actually executed steps (tool calls or reads)
  // that warrant a follow-up turn.
  if (routing == null) {
    if (steps.length === 0) {
      return {
        continue: false,
        reason: 'no_continuation_needed',
        continuationPrompt: '',
        continuationsSoFar,
        clearedCount: continuationsSoFar,
        finalIteration: maxContinuations,
      };
    }
    const shouldContinue = resolveDefaultContinue();
    return {
      continue: shouldContinue,
      reason: shouldContinue ? 'plan_steps_remaining' : 'no_continuation_needed',
      continuationPrompt: shouldContinue ? 'Continue with the plan.' : '',
      continuationsSoFar,
      clearedCount: continuationsSoFar,
      finalIteration: maxContinuations,
    };
  }

  // 4. Plan steps remaining (Bug #11): routing outlined multiple steps
  //    but the model only completed 1 tool call. Auto-continue so the
  //    model finishes the remaining steps.
  //
  // 4a. Circuit-breaker (chat-loop fix). When tool calls in THIS turn failed
  //     and the LLM's text response is plan-language describing "next steps"
  //     rather than actual tool calls or concrete actions, refuse to continue.
  //
  //     continuationsSoFar >= 1 GUARDS the legitimate first-step-completion
  //     case — the unified-agent-service.test.ts fixture for
  //     plan_steps_remaining uses continuationsSoFar: 0 with response "Step 1
  //     done." (no plan words), so on the very first continuation nothing
  //     fires and plan_steps_remaining behaves as designed. The guard
  //     intentionally lives AT THIS CALL SITE, not inside
  //     _detectFailurePlanLoop, because the helper is a pure predicate and
  //     should not embed policy about turn iteration — that decision belongs
  //     to the caller that already knows the counter.
  //
  //     Reason is `failure_plan_loop` (not `no_continuation_needed`) so
  //     SSE/log lines distinguish a breaker-encoded stop from a legitimate
  //     "LLM response is structurally complete, no further work needed"
  //     decision. Operators can grep for this token to spot repeated
  //     tool-failure → plan-only-text cycles.
  if (planStepsCount >= 2 && steps.length >= 1 && steps.length < planStepsCount) {
    if (continuationsSoFar >= 1 && _detectFailurePlanLoop(steps, input.responseText)) {
      return {
        continue: false,
        reason: 'failure_plan_loop',
        continuationPrompt: '',
        continuationsSoFar,
        clearedCount: continuationsSoFar,
        finalIteration: maxContinuations,
      };
    }
    return {
      continue: true,
      reason: 'plan_steps_remaining',
      continuationPrompt:
        `[AUTO-CONTINUE] You completed step ${steps.length} of ${planStepsCount}. Continue with the remaining steps of the plan. ` +
        'Pick up from where you left off and complete the remaining work.',
      continuationsSoFar: continuationsSoFar + 1,
      clearedCount: continuationsSoFar + 1,
      finalIteration: maxContinuations,
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
      clearedCount: continuationsSoFar + 1,
      finalIteration: maxContinuations,
    };
  }

  return {
    continue: false,
    reason: 'no_continuation_needed',
    continuationPrompt: '',
    continuationsSoFar,
    clearedCount: continuationsSoFar,
    finalIteration: maxContinuations,
  };
}
