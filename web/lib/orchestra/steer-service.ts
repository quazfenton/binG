/**
 * Generalized [STEER] service.
 *
 * Produces a reprompt string for the LLM when one of the well-known failure
 * modes observed in run.log fires. Each trigger is mapped to a tight, targeted
 * prompt — long enough to be actionable, short enough to fit a single message
 * turn without bloating the system prompt.
 *
 * Failure categories (mapped to the run.log audit, closing issues #1, #21, #22, #31):
 *   - empty_completion        — LLM returned no text (often a misfire on
 *                               streaming/empty-result combinations)
 *   - missing_tool_call       — Tools were available but the LLM did not
 *                               call any (FC-GATE Phase 1 fail / repeated
 *                               finishReason: "stop" with no tools)
 *   - invalid_path            — Path validation rejected an edit (text-mode
 *                               fallback emitted `=`, `{name}"`, etc.)
 *   - hunk_mismatch           — Unified-diff line-count mismatch (often
 *                               caused by stale reads after concurrent edits)
 *   - enoent_eacces           — bash_execute failed with ENOENT/EACCES
 *                               (missing interpreter, bad cwd, bad perms)
 *   - idle_timeout            — Vercel AI SDK streaming stalled past the
 *                               60s idle threshold mid-text
 *   - tool_result_false       — A tool call returned success:false with a
 *                               recoverable error
 *   - dropped_text_mode_edit  — Phase-2 text-mode parser dropped one or
 *                               more edits; the user must be told WHICH
 *                               edit was dropped so they can re-issue it
 *
 * Design notes:
 *   - This module is intentionally pure (no I/O, no DB, no logger writes).
 *     Callers wire the returned prompt into their own reprompt mechanism.
 *   - Each prompt is prefixed with `[STEER]` so log/grep tooling can find it.
 *   - Budgets: max 8 numbered text-mode edits, max 3 invalid paths per
 *     prompt — keep the steer under ~1200 chars so it doesn't bloat the
 *     next turn's system prompt.
 *
 * @module steer-service
 */

import { createLogger } from '@/lib/utils/logger';
// Pass-5 #62 (audit) — second half: inject the canonical VFS session-scope
// path into the system prompt so the LLM never has to guess the scope. The
// helper is wired into the autoInjectContext block in unified-agent-service.ts
// at request start. extractSessionIdFromOwnerId is the canonical owner-id →
// session-id parser (handles the anon:USERID vs anon:USERID$001 split — see
// bing/web/lib/virtual-filesystem/id-normalization.ts Bug #26 hot-fix for
// the full rationale).
import { extractSessionIdFromOwnerId } from '@/lib/virtual-filesystem/id-normalization';

const logger = createLogger('SteerService');

// ============================================================================
// Trigger types
// ============================================================================

/**
 * All failure categories the [STEER] service can reprompt for.
 *
 * Each variant carries a `detail` object that names the specific instance
 * (e.g. edit number, file path, idleMs) so the prompt is precise and
 * actionable rather than a generic "something went wrong".
 */
export type SteerTrigger =
  | {
      kind: 'empty_completion';
      detail: {
        provider?: string;
        model?: string;
        finishReason?: string;
      };
    }
  | {
      kind: 'missing_tool_call';
      detail: {
        availableTools: number;
        provider?: string;
        model?: string;
        finishReason?: string;
      };
    }
  | {
      kind: 'invalid_path';
      detail: {
        path: string;
        tool: string;
        reason: string;
      };
    }
  | {
      kind: 'hunk_mismatch';
      detail: {
        file: string;
        line: number;
        expectedAdded: number;
        expectedRemoved: number;
        actualAdded: number;
        actualRemoved: number;
      };
    }
  | {
      kind: 'enoent_eacces';
      detail: {
        command: string;
        code: string;
        tool: string;
      };
    }
  | {
      kind: 'idle_timeout';
      detail: {
        provider: string;
        model: string;
        idleMs: number;
        tokensReceived?: number;
        toolCallsDone?: number;
      };
    }
  | {
      kind: 'tool_result_false';
      detail: {
        tool: string;
        error: string;
        argsPreview?: string;
      };
    }
  | {
      kind: 'dropped_text_mode_edit';
      detail: {
        editNumber: number;
        total: number;
        path?: string;
        reason: string;
      };
    }
  | {
      kind: 'consecutive_tool_cap';
      detail: {
        consecutive: number;
        consecutiveThreshold: number;
        total: number;
        totalThreshold: number;
        provider?: string;
        model?: string;
      };
    }
  | {
      // Bug F: emitted by wireCapabilityNotFoundSteer when getCapability() returns null.
      kind: 'capability_not_found';
      detail: {
        capabilityId: string;
        availableCapabilities?: string[];
        tool: string;
      };
    }
  | {
      // Bug #37: emitted by wireToolNameAliasRewriteSteer when the router silently
      // rewrote an LLM-invented tool name (e.g. list_directory → file.list).
      kind: 'tool_name_alias_rewrite';
      detail: {
        alias: string;
        canonical: string;
        tool?: string;
      };
    }
  | {
      // Bug #41: emitted by wireLoopAbortSteer when the 3-consecutive-tool-failures
      // loop-guard kills the agent. Categorizes the abort so the LLM knows
      // whether to switch tools (binary_missing) or fix its tool-name (tool_failing).
      kind: 'loop_abort';
      detail: {
        abortReason: 'binary_missing' | 'tool_failing' | 'mixed' | 'unknown';
        consecutive: number;
        failedTools: Array<{ name: string; error: string }>;
        suggestion: string;
      };
    }
  | {
      // Bug #40: emitted by wireOrchestrationFallbackSteer when the orchestrator
      // (PlanActVerify / StatefulAgent) degrades to v1-api text-mode fallback.
      // The LLM on the next turn sees this hint and knows the previous turn
      // was a degraded response, so it can adapt (e.g., not re-try the same
      // complex multi-step plan that just exhausted the orchestrator budget).
      kind: 'orchestration_fallback';
      detail: {
        fromMode: string;
        toMode: string;
        fallbackReason: string;
        /** True when the orchestrator hit its budget cap (most common case). */
        budgetExhausted: boolean;
        suggestion: string;
      };
    };

export type SteerTriggerKind = SteerTrigger['kind'];

// ============================================================================
// Prompt construction
// ============================================================================

/**
 * Build a reprompt for the given trigger.
 *
 * Always returns a non-empty string prefixed with `[STEER]` so log/grep
 * tooling can find the prompt. The body is short (under ~1200 chars for
 * all current triggers) so it does not blow the system-prompt budget.
 */
export function buildSteerPrompt(trigger: SteerTrigger): string {
  const body = renderBody(trigger);
  const prompt = `[STEER] ${body}`;

  // Telemetry: log a structured [STEER] line so the run.log audit can verify
  // the service is firing when expected. Single-line JSON keeps grep-ability
  // while still emitting the trigger detail for postmortems.
  try {
    logger.info(`[STEER] fired`, {
      kind: trigger.kind,
      detail: trigger.detail,
      promptLength: prompt.length,
    });
  } catch {
    // best effort — never throw from the steer service
  }

  return prompt;
}

function renderBody(trigger: SteerTrigger): string {
  switch (trigger.kind) {
    case 'empty_completion': {
      const { provider, model, finishReason } = trigger.detail;
      const src = provider && model ? ` from ${provider}/${model}` : '';
      const reason = finishReason ? ` (finishReason="${finishReason}")` : '';
      return `Your previous response was empty${src}${reason}. The UI is showing a blank message. ` +
        `Continue from where you left off. If a tool call was intended, invoke it now. ` +
        `If you have already completed the task, return a one-line confirmation.`;
    }

    case 'missing_tool_call': {
      const { availableTools, provider, model, finishReason } = trigger.detail;
      const src = provider && model ? ` from ${provider}/${model}` : '';
      const reason = finishReason ? ` (finishReason="${finishReason}")` : '';
      return `Your previous response did not call any of the ${availableTools} available tools${src}${reason}. ` +
        `Plain text is not enough for this task — pick the most appropriate tool and invoke it. ` +
        `If you have already completed the task via a tool call, do not duplicate the work; just confirm.`;
    }

    case 'invalid_path': {
      const { path, tool, reason } = trigger.detail;
      return `The ${tool} tool rejected the path "${truncate(path, 80)}" as invalid (${reason}). ` +
        `Paths must be relative to the workspace and look like "src/app.ts", "package.json", ` +
        `or "src/components/Button.tsx". HTML/markup, template literals, and unterminated ` +
        `strings are NOT valid paths. Re-issue the ${tool} call with a corrected path.`;
    }

    case 'hunk_mismatch': {
      const { file, line, expectedAdded, expectedRemoved, actualAdded, actualRemoved } =
        trigger.detail;
      return `A unified-diff hunk against "${truncate(file, 80)}" at line ${line} could not be applied ` +
        `(expected +${expectedAdded}/-${expectedRemoved} lines, file has +${actualAdded}/-${actualRemoved}). ` +
        `The file likely changed after you read it (concurrent edit, race, or stale read). ` +
        `Re-read the file and re-issue the patch against the current content.`;
    }

    case 'enoent_eacces': {
      const { command, code, tool } = trigger.detail;
      return `The ${tool} tool failed with code ${code} (ENOENT/EACCES) running "${truncate(command, 120)}". ` +
        `Common causes: (a) the binary is not installed (try a different interpreter ` +
        `e.g. python vs python3, or check $PATH), (b) the cwd does not exist, ` +
        `(c) the file/directory has restricted permissions. Verify the target exists, ` +
        `then re-issue the command with the corrected path or interpreter.`;
    }

    case 'idle_timeout': {
      const { provider, model, idleMs, tokensReceived, toolCallsDone } = trigger.detail;
      const progress =
        tokensReceived !== undefined || toolCallsDone !== undefined
          ? ` (received ${tokensReceived ?? 0} tokens, completed ${toolCallsDone ?? 0} tool calls)`
          : '';
      return `Streaming from ${provider}/${model} stalled for ${idleMs}ms with no activity${progress}. ` +
        `The connection was cut mid-sentence. If you were composing a response, complete it now. ` +
        `If you were about to call a tool, invoke it. If the response was already complete, ` +
        `re-state the conclusion in one sentence.`;
    }

    case 'tool_result_false': {
      const { tool, error, argsPreview } = trigger.detail;
      const args = argsPreview ? ` (args: ${truncate(argsPreview, 100)})` : '';
      return `The ${tool} tool returned success:false with error: ${truncate(error, 200)}${args}. ` +
        `Review the error, adjust the inputs, and retry. If the tool is fundamentally ` +
        `unsuited for this task, switch to a different tool or break the task into smaller steps.`;
    }

    case 'dropped_text_mode_edit': {
      const { editNumber, total, path, reason } = trigger.detail;
      const file = path ? ` for "${truncate(path, 80)}"` : '';
      return `Edit ${editNumber} of ${total} extracted from your text-mode response was dropped${file} ` +
        `(${reason}). Re-issue ONLY edit ${editNumber} with the corrected syntax — do not ` +
        `duplicate edits 1..${editNumber - 1}, which were already applied. ` +
        `Numbered format: "Edit ${editNumber}/${total}:" prefix on every edit.`;
    }

    case 'consecutive_tool_cap': {
      const { consecutive, consecutiveThreshold, total, totalThreshold, provider, model } = trigger.detail;
      const src = provider && model ? ` from ${provider}/${model}` : '';
      return `Tool-call budget reached${src}: ${consecutive} consecutive tool calls (cap ${consecutiveThreshold}) ` +
        `and ${total} total this turn (cap ${totalThreshold}). Continuing in text-mode — ` +
        `summarize what you have so far in plain prose and stop emitting tool calls for this turn. ` +
        `If you need more tool calls to finish, say so explicitly so the orchestrator can ` +
        `start a follow-up turn with a fresh budget.`;
    }

    case 'capability_not_found': {
      const { capabilityId, availableCapabilities, tool } = trigger.detail;
      const known = (availableCapabilities || ['write_file', 'apply_diff', 'read_file', 'read_files', 'list_files', 'search_files', 'grep_code', 'batch_write', 'delete_file']).slice(0, 9);
      return `Tool \`${tool}\` requested unknown capability \`${capabilityId}\`. ` +
        `Available capabilities include: ${known.map(c => `\`${c}\``).join(', ')}. ` +
        `Use one of the canonical tool names above (note the underscore, not camelCase).`;
    }

    case 'tool_name_alias_rewrite': {
      const { alias, canonical, tool } = trigger.detail;
      const src = tool ? ` (in ${tool})` : '';
      return `Tool name \`${alias}\`${src} was auto-rewritten to canonical \`${canonical}\`. ` +
        `On your next turn, use the canonical name \`${canonical}\` directly so the rewrite step is skipped.`;
    }

    case 'loop_abort': {
      const { abortReason, consecutive, failedTools, suggestion } = trigger.detail;
      const toolList = failedTools.length > 0
        ? failedTools.map(t => `${t.name} (${truncate(t.error, 60)})`).join(', ')
        : 'no tool details';
      return `Loop-guard killed the agent after ${consecutive} consecutive tool failures ` +
        `(abortReason=\`${abortReason}\`). Failed tools: ${toolList}. ${suggestion}`;
    }

    case 'orchestration_fallback': {
      const { fromMode, toMode, fallbackReason, budgetExhausted, suggestion } = trigger.detail;
      const reasonLabel = budgetExhausted ? 'budget exhausted' : 'orchestrator degraded';
      return `Your previous turn ran in \`${fromMode}\` mode but degraded to \`${toMode}\` (${reasonLabel}: ${truncate(fallbackReason, 200)}). ` +
        `The previous response is DEGRADED — do NOT continue the multi-step plan that failed. ` +
        `${suggestion}`;
    }
  }
}

// ============================================================================
// Multi-trigger helper
// ============================================================================

/**
 * Build a single prompt from several triggers, joining their bodies with
 * blank lines. Useful when a single turn triggers multiple failure modes
 * (e.g. missing tool call + idle timeout, or invalid path + dropped edit).
 *
 * Caps the body at MAX_TRIGGERS_PER_PROMPT triggers so the steer doesn't
 * grow without bound. Excess triggers are summarized in a trailing line.
 */
export function buildCombinedSteerPrompt(
  triggers: SteerTrigger[],
  options: { maxTriggers?: number } = {},
): string {
  if (triggers.length === 0) return '';

  const max = options.maxTriggers ?? MAX_TRIGGERS_PER_PROMPT;
  const included = triggers.slice(0, max);
  const remaining = triggers.length - included.length;

  const bodies = included.map((t) => renderBody(t));
  let body = bodies.join('\n\n');
  if (remaining > 0) {
    body +=
      `\n\n(+${remaining} more issue${remaining === 1 ? '' : 's'} suppressed to stay within the steer budget.)`;
  }
  return `[STEER] ${body}`;
}

const MAX_TRIGGERS_PER_PROMPT = 5;

// ============================================================================
// Bug #67 (Pass-5 audit) — typed error for qd/lite (and similar) pre-validation
// rejections. Thrown by processUnifiedAgentRequest when the LLM emits a bare
// model name like "lite" or "qd/lite" that the ninerouter registry does not
// know about. The chat route's catch distinguishes this from generic Errors
// via instanceof and returns HTTP 400 with `availableModels` so the client
// (or the LLM on the next turn) can self-correct. The class is plain
// (extends Error) and carries the canonical `availableModels` list + a
// stable `errorCode` for client-side detection.
// ============================================================================
export class InvalidModelError extends Error {
  readonly errorCode: 'invalid_model_name' = 'invalid_model_name';
  readonly model: string;
  readonly provider: string;
  readonly availableModels: ReadonlyArray<string>;

  constructor(input: {
    model: string;
    provider: string;
    availableModels: ReadonlyArray<string>;
  }) {
    super(
      `Invalid model name "${input.model}" for provider "${input.provider}". ` +
      `Did you mean one of: ${input.availableModels.join(', ')}? ` +
      `Bare names like "lite" are not supported; use the full registry ID.`,
    );
    this.name = 'InvalidModelError';
    this.model = input.model;
    this.provider = input.provider;
    this.availableModels = input.availableModels;
  }
}

// ============================================================================
// Pass-5 #62: buildSessionScopeSteerPrompt — emit a one-liner [STEER] that
// tells the LLM the canonical VFS session-scope path for the current ownerId.
// The "first half" of #62 (Pass-5 Round 2) was the structured-rejection log
// in normalizePath; this is the "second half" — proactively tell the LLM the
// scope so it doesn't have to guess. Closes #62 fully.
//
// Returns null when the ownerId has no extractable session id (e.g. plain
// `anon:USERID` with no `$sessionId` suffix) so the inject is silent for
// non-session owners — they fall back to the default 'workspace/sessions/000'
// scope that the VFS already uses for anon without a $ delimiter.
// ============================================================================
export function buildSessionScopeSteerPrompt(input: {
  ownerId: string;
  /** Optional: pass a known scopePath (e.g. from the request) for a richer hint. */
  scopePath?: string;
}): string | null {
  const { ownerId, scopePath } = input;
  if (!ownerId) return null;
  const sessionId = extractSessionIdFromOwnerId(ownerId);
  if (!sessionId) {
    // Plain anon / non-session owner — no session encoded, the VFS will
    // fall back to the default 'workspace/sessions/000' scope. Skip the
    // inject so we don't confuse the LLM with a non-applicable scope.
    return null;
  }
  const canonicalScope = `workspace/sessions/${sessionId}`;
  const observed = scopePath && scopePath.startsWith(canonicalScope)
    ? ` (observed scopePath: '${scopePath}')`
    : '';
  return (
    `[STEER] Your canonical VFS session scope is '${canonicalScope}/'${observed}. ` +
    `All file paths you emit (write_file / read_file / apply_diff / batch_write / search_files / list_files) ` +
    `must be RELATIVE to this scope. ` +
    `Do NOT include the '${canonicalScope}/' prefix in your path arguments — the router prepends it. ` +
    `Example: 'src/app.tsx' → resolved to '${canonicalScope}/src/app.tsx'; 'package.json' → '${canonicalScope}/package.json'. ` +
    `If a path is rejected with 'Path traversal beyond workspace root', use a SHORTER path that stays under the scope ` +
    `(no leading slash, no parent traversal, no absolute paths, no template literals).`
  );
}



/**
 * Build a SteerTrigger from a streaming finish reason and tool-call count.
 * Used by the chat route / vercel-ai-streaming layer when an LLM turn ends
 * with no tool calls despite tools being available.
 */
export function steerFromFinishReason(input: {
  finishReason?: string;
  availableTools: number;
  provider?: string;
  model?: string;
  responseText: string;
  toolCallsDone: number;
}): SteerTrigger | null {
  const { finishReason, availableTools, responseText, toolCallsDone, provider, model } = input;

  if (responseText.trim().length === 0) {
    return {
      kind: 'empty_completion',
      detail: { provider, model, finishReason },
    };
  }
  if (availableTools > 0 && toolCallsDone === 0) {
    return {
      kind: 'missing_tool_call',
      detail: { availableTools, provider, model, finishReason },
    };
  }
  return null;
}

/**
 * Build a SteerTrigger from a Vercel AI SDK idle-timeout error.
 * The error message format from vercel-ai-streaming.ts is:
 *   "Vercel AI SDK streaming failed: [TIMEOUT] No activity for 60000ms (idle timeout)"
 */
export function steerFromIdleTimeout(input: {
  provider: string;
  model: string;
  idleMs: number;
  tokensReceived?: number;
  toolCallsDone?: number;
}): SteerTrigger {
  return {
    kind: 'idle_timeout',
    detail: input,
  };
}

/**
 * Build a SteerTrigger from a tool result with success:false.
 * Truncates the error so the prompt stays under budget.
 */
export function steerFromToolResultFalse(input: {
  tool: string;
  error: string;
  argsPreview?: string;
}): SteerTrigger {
  return {
    kind: 'tool_result_false',
    detail: input,
  };
}

/**
 * Build a SteerTrigger from a path validation rejection.
 */
export function steerFromInvalidPath(input: {
  path: string;
  tool: string;
  reason: string;
}): SteerTrigger {
  return {
    kind: 'invalid_path',
    detail: input,
  };
}

/**
 * Build a SteerTrigger from a unified-diff hunk mismatch (applyUnifiedDiffToContent
 * or applyDiffMatchPatch failure).
 */
export function steerFromHunkMismatch(input: {
  file: string;
  line: number;
  expectedAdded: number;
  expectedRemoved: number;
  actualAdded: number;
  actualRemoved: number;
}): SteerTrigger {
  return {
    kind: 'hunk_mismatch',
    detail: input,
  };
}

/**
 * Build a SteerTrigger from an ENOENT / EACCES bash failure.
 * Detected by code starting with "E" + 3 chars (POSIX errno names).
 */
export function steerFromBashError(input: {
  command: string;
  code: string;
  tool: string;
}): SteerTrigger | null {
  // Only treat as ENOENT/EACCES-family for these specific codes.
  const KNOWN = new Set(['ENOENT', 'EACCES', 'EAGAIN', 'EBUSY', 'EISDIR', 'ENOTDIR', 'EPERM']);
  if (!KNOWN.has(input.code)) return null;
  return {
    kind: 'enoent_eacces',
    detail: input,
  };
}

/**
 * Build a SteerTrigger from a consecutive/total tool-call-cap event.
 * Closes #21 (7-consecutive / 10-total cap silently truncates) by giving
 * the LLM an explicit text-mode fallback instead of an abrupt cutoff.
 */
export function steerFromConsecutiveToolCap(input: {
  consecutive: number;
  consecutiveThreshold: number;
  total: number;
  totalThreshold: number;
  provider?: string;
  model?: string;
}): SteerTrigger {
  return {
    kind: 'consecutive_tool_cap',
    detail: input,
  };
}

// ============================================================================
// Numbered text-mode edit scheme
// ============================================================================

/**
 * A single file edit with a stable number. The number is used by the steer
 * service to refer to a specific edit ("Edit 3 of 7 was dropped…") so the
 * LLM can re-issue just that edit without re-doing the rest.
 */
export interface NumberedFileEdit {
  number: number;
  path: string;
  content: string;
  action: 'write' | 'edit' | 'append' | 'create_dir' | 'delete';
  /** Whether this edit applied successfully. False = dropped, see reason. */
  applied: boolean;
  /** If !applied, why it was dropped (path validation, empty content, etc.). */
  dropReason?: string;
}

/**
 * Wrap a raw extractor with numbering + a per-edit success/failure report.
 *
 * @param edits   — The list of edits extracted from the LLM response, in order.
 * @param apply   — A function that applies edit N and returns `{ applied, dropReason? }`.
 *
 * @returns The same list with `number` and `applied`/`dropReason` populated.
 *
 * Example:
 *   const edits = await extractCompactFileEdits(response);
 *   const numbered = applyNumberedEdits(edits, async (e) => {
 *     try {
 *       await vfs.writeFile(ownerId, e.path, e.content);
 *       return { applied: true };
 *     } catch (err: any) {
 *       return { applied: false, dropReason: err.message };
 *     }
 *   });
 *   for (const dropped of numbered.filter(e => !e.applied)) {
 *     const steer = buildSteerPrompt({
 *       kind: 'dropped_text_mode_edit',
 *       detail: { editNumber: dropped.number, total: numbered.length, path: dropped.path, reason: dropped.dropReason ?? 'unknown' },
 *     });
 *     // inject steer into the next prompt
 *   }
 */
export async function applyNumberedEdits<E extends { path: string; content: string; action?: string }>(
  edits: E[],
  apply: (edit: E, index: number) => Promise<{ applied: boolean; dropReason?: string }>,
): Promise<NumberedFileEdit[]> {
  const out: NumberedFileEdit[] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    let result: { applied: boolean; dropReason?: string };
    try {
      result = await apply(e, i);
    } catch (err: any) {
      result = { applied: false, dropReason: err?.message || 'unknown error' };
    }
    out.push({
      number: i + 1,
      path: e.path,
      content: e.content,
      action: (e.action as NumberedFileEdit['action']) ?? 'write',
      applied: result.applied,
      dropReason: result.dropReason,
    });
  }
  return out;
}

/**
 * Build a `steer` prompt for a batch of dropped edits. Joins all dropped
 * edits into a single prompt so the LLM can re-issue them in one go.
 *
 * @returns null if no edits were dropped (caller can skip the steer).
 */
export function steerFromDroppedEdits(
  numbered: NumberedFileEdit[],
): string | null {
  const dropped = numbered.filter((e) => !e.applied);
  if (dropped.length === 0) return null;
  const triggers: SteerTrigger[] = dropped.map((e) => ({
    kind: 'dropped_text_mode_edit',
    detail: {
      editNumber: e.number,
      total: numbered.length,
      path: e.path,
      reason: e.dropReason ?? 'unknown',
    },
  }));
  return buildCombinedSteerPrompt(triggers);
}

/**
 * Build a prompt prefix that asks the LLM to label its text-mode edits with
 * "Edit N/M:" so the parser can correlate. Use this in the system prompt
 * (or a follow-up steer) when text-mode fallbacks are expected.
 */
export function buildNumberedEditPromptPrefix(): string {
  return [
    '[STEER] When emitting text-mode file edits (fenced code blocks or `<file_edit>` tags),',
    'prefix each edit with "Edit N/M:" where N is its 1-based index and M is the total count.',
    'Example: "Edit 1/3: <file_edit>... Edit 2/3: ... Edit 3/3: ...". This lets the parser',
    'report per-edit failures so you can re-issue just the failed edit instead of the whole batch.',
  ].join(' ');
}

// ============================================================================
// Utilities
// ============================================================================

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ============================================================================
// Lightweight self-test (used by the unit test suite — see __tests__/steer-service.test.ts)
// ============================================================================

/**
 * Internal: list all known trigger kinds. Exposed for the test suite so it
 * can iterate over them when building matrix tests.
 */
export const ALL_STEER_TRIGGER_KINDS: readonly SteerTriggerKind[] = [
  'empty_completion',
  'missing_tool_call',
  'invalid_path',
  'hunk_mismatch',
  'enoent_eacces',
  'idle_timeout',
  'tool_result_false',
  'dropped_text_mode_edit',
  'consecutive_tool_cap',
  'capability_not_found',
  'tool_name_alias_rewrite',
  'loop_abort',
  'orchestration_fallback',
] as const;

// ============================================================================
// SteerMetrics — counters that surface in run.log so the audit can verify
// every [STEER] kind is firing when expected.
// ============================================================================

export interface SteerMetricsSnapshot {
  total: number;
  byKind: Record<SteerTriggerKind, number>;
  lastFiredAtMs: number | null;
  lastFiredKind: SteerTriggerKind | null;
}

export class SteerMetrics {
  private readonly counts = new Map<SteerTriggerKind, number>();
  private totalFired = 0;
  private lastFiredAtMs: number | null = null;
  private lastFiredKind: SteerTriggerKind | null = null;

  /** Record a single steer firing. O(1). */
  recordFire(kind: SteerTriggerKind): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    this.totalFired += 1;
    this.lastFiredAtMs = Date.now();
    this.lastFiredKind = kind;
  }

  /** Read the total number of steers fired since process start. */
  total(): number {
    return this.totalFired;
  }

  /** Read the count for a specific kind. */
  countOf(kind: SteerTriggerKind): number {
    return this.counts.get(kind) ?? 0;
  }

  /** O(N) snapshot. Cheap enough to log periodically (every Nth turn, etc). */
  snapshot(): SteerMetricsSnapshot {
    const byKind = Object.fromEntries(
      ALL_STEER_TRIGGER_KINDS.map((k) => [k, this.counts.get(k) ?? 0]),
    ) as Record<SteerTriggerKind, number>;
    return {
      total: this.totalFired,
      byKind,
      lastFiredAtMs: this.lastFiredAtMs,
      lastFiredKind: this.lastFiredKind,
    };
  }

  /** Reset all counters — used by tests and for periodic "since-reset" snapshots. */
  reset(): void {
    this.counts.clear();
    this.totalFired = 0;
    this.lastFiredAtMs = null;
    this.lastFiredKind = null;
  }
}

/** Process-singleton steer metrics. Use this from any wiring point. */
export const steerMetrics = new SteerMetrics();

// ============================================================================
// Wiring helpers — one-call wrappers that build a steer, record the fire
// in metrics, and return the prompt. Use these at the call sites so the
// wiring is identical everywhere and every fire is counted.
// ============================================================================

/**
 * Build a steer from a streaming finish reason + tool-call count.
 * Returns null if no steer is needed (tools were called, or text is non-empty).
 *
 * Side effect: records the fire in `steerMetrics` (no-op when null).
 */
export function wireFinishReasonSteer(input: {
  finishReason?: string;
  availableTools: number;
  provider?: string;
  model?: string;
  responseText: string;
  toolCallsDone: number;
}): string | null {
  const trigger = steerFromFinishReason(input);
  if (!trigger) return null;
  steerMetrics.recordFire(trigger.kind);
  return buildSteerPrompt(trigger);
}

/**
 * Build a steer when the consecutive/total tool-call cap is hit.
 * Closes #21: gives the LLM an explicit text-mode fallback instead of an
 * abrupt cutoff, and records the fire in `steerMetrics`.
 */
export function wireConsecutiveToolCapSteer(input: {
  consecutive: number;
  consecutiveThreshold: number;
  total: number;
  totalThreshold: number;
  provider?: string;
  model?: string;
}): string | null {
  if (input.consecutive < input.consecutiveThreshold && input.total < input.totalThreshold) {
    return null;
  }
  const trigger = steerFromConsecutiveToolCap(input);
  steerMetrics.recordFire(trigger.kind);
  return buildSteerPrompt(trigger);
}

/**
 * Build a steer from a tool result with success:false. Closes #22
 * (success:false with no reason). Records the fire in `steerMetrics`.
 */
export function wireToolResultFalseSteer(input: {
  tool: string;
  error: string;
  argsPreview?: string;
}): string {
  const trigger = steerFromToolResultFalse(input);
  steerMetrics.recordFire(trigger.kind);
  return buildSteerPrompt(trigger);
}

// ===========================================================================
// Bug I: wireInvalidPathSteer — injected when isValidFilePath() rejects a
// progressive file edit path from the LLM (e.g. "=", "{name}\"", HTML).
// ===========================================================================
/**
 * // ===========================================================================
// safeSteer — generic try/catch wrapper for steer invocations. A steer
// helper failure (logger error, metrics throw, etc.) must never break the
// caller's main flow, so callers wrap the invocation in safeSteer() and get
// back either the prompt string or `null`.
// ===========================================================================
/**
 * Wrap a steer-invoking callback in a try/catch and normalize its return
 * value to `T | null`. A steer helper failure (logger throw, metrics
 * failure, downstream bug) must never break the caller's main flow — this
 * helper is the single place that enforces that contract.
 *
 * Usage:
 *   const hint = safeSteer(() => wireInvalidPathSteer({ ... }));
 *   if (hint) logger.warn('[STEER] ...', { hint });
 */
export function safeSteer<T>(fn: () => T | null | undefined): T | null {
  try {
    const result = fn();
    return (result ?? null) as T | null;
  } catch {
    return null;
  }
}

// ===========================================================================
// Bug I: wireInvalidPathSteer — injected when isValidFilePath() rejects a
// progressive file edit path from the LLM (e.g. "=", "{name}\"", HTML).
// ===========================================================================
/**
 * Returns a short one-liner steer prompt when the LLM emits a syntactically
 * invalid file path. Closes bug I: "Invalid progressive file edit paths from
 * LLM (e.g. '=', '{name}"', HTML)". The steer tells the model to use a real
 * relative path like "src/app.tsx" instead of code/CSS fragments.
 */
export function wireInvalidPathSteer(input: {
  path: string;
  reason: string;
  tool: string;
}): string {
  const safePreview = (input.path || '').slice(0, 40).replace(/[`*_]/g, '');
  const prompt = [
    `[STEER] Tool \`${input.tool}\` rejected path \`${safePreview}\`: ${input.reason}.`,
    `Use a real relative path like \`src/app.tsx\` (no leading slash, no URL, no query string, no code/CSS values, no HTML, no \`{}\` template syntax).`,
  ].join(' ');
  steerMetrics.recordFire('invalid_path');
  return prompt;
}

// ===========================================================================
// Bug F: wireCapabilityNotFoundSteer — injected when getCapability() returns
// null/undefined for a tool name the LLM requested (e.g. apply_diff,
// bash_execute, read_files). Closes bug F: "capability not found for
// apply_diff/bash_execute/read_files" — log + count these to detect chronic
// capability degradation, and tell the model the canonical name.
// ===========================================================================
/**
 * Returns a short steer prompt when the LLM requests a capability that the
 * router cannot resolve. Closes bug F by surfacing a corrective hint with the
 * canonical tool names and a counter for observability.
 */
export function wireCapabilityNotFoundSteer(input: {
  capabilityId: string;
  availableCapabilities?: string[];
  tool: string;
}): string {
  const known = (input.availableCapabilities || ['write_file', 'apply_diff', 'read_file', 'read_files', 'list_files', 'search_files', 'grep_code', 'batch_write', 'delete_file']).slice(0, 9);
  const prompt = [
    `[STEER] Tool \`${input.tool}\` requested unknown capability \`${input.capabilityId}\`.`,
    `Available capabilities include: ${known.map(c => `\`${c}\``).join(', ')}.`,
    `Use one of the canonical tool names above (note the underscore, not camelCase).`,
  ].join(' ');
  steerMetrics.recordFire('capability_not_found');
  return prompt;
}

// ===========================================================================
// Bug #37: wireToolNameAliasRewriteSteer — injected when the router auto-
// rewrites an LLM-invented tool name (e.g. "list_directory", "bash_execute",
// "read_file" vs "read_files") to the canonical capability ID. The model is
// told what the rewrite was so it can stop emitting the misname on retry.
// ===========================================================================
/**
 * Build a short steer prompt when the router silently rewrote an LLM-invented
 * tool name to the canonical capability. Closes bug #37 (LLM-invented tool
 * misnames must auto-rewrite AND surface a corrective hint) by giving the
 * model a one-liner it can grep for: "[STEER] Tool name 'X' was rewritten to
 * 'Y'. Use 'Y' on retry to skip the rewrite."
 */
export function wireToolNameAliasRewriteSteer(input: {
  /** What the LLM called. e.g. 'list_directory', 'bash_execute', 'read_file'. */
  alias: string;
  /** What the router rewrote it to. e.g. 'file.list', 'bash.execute', 'file.read'. */
  canonical: string;
  /** Optional routing context (e.g. capability router, MCP gateway, etc). */
  tool?: string;
}): string {
  const src = input.tool ? ` (in ${input.tool})` : '';
  const prompt = `[STEER] Tool name \`${input.alias}\`${src} was auto-rewritten to canonical \`${input.canonical}\`. ` +
    `On your next turn, use the canonical name \`${input.canonical}\` directly so the rewrite step is skipped.`;
  // Bug #37: dedicated metric bucket (NOT 'capability_not_found') so the
  // not-found counter only tracks genuine unknown-capability events, and
  // rewrite firings stay observable as a separate signal.
  steerMetrics.recordFire('tool_name_alias_rewrite');
  return prompt;
}

// ===========================================================================
// Bug D: make incompleteConfidence threshold configurable via env var
// ===========================================================================
function getIncompleteConfidenceThreshold(): number {
  const raw = process.env.INCOMPLETE_RESPONSE_CONFIDENCE_THRESHOLD;
  if (!raw) return 0.4;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.4;
  return parsed;
}

/**
 * Re-export the threshold getter so tests can override it.
 * Closes bug D: "incomplete-response branch with confidence 0.4" — surface a
 * clearer message and make the threshold configurable via env.
 */
export const incompleteConfidenceThreshold = {
  get: getIncompleteConfidenceThreshold,
};

// ============================================================================
// Bug #41: categorizeAbortReason + wireLoopAbortSteer
//
// When the 3-consecutive-tool-failures loop-guard kills the agent, we need
// to (a) categorize the abort so the LLM knows what went wrong, (b) emit
// a [STEER] that tells it what to do next, and (c) surface the abort
// reason to the UI as a final SSE event so it can show a banner.
//
// categorizeAbortReason() inspects the last N failed tool calls and picks
// the dominant failure mode:
//   - binary_missing    — all N failures are ENOENT for the same binary
//   - tool_failing   — all N failures are capability_not_found / alias_rewrite
//   - timeout           — all N failures are idle_timeout / TIMEOUT-TTFT
//   - unknown           — anything else (mixed, or unclassifiable)
//
// wireLoopAbortSteer() builds the [STEER] prompt + a structured abort
// payload (for the SSE event) in one call. The suggestion is tailored
// to the abort reason so the LLM gets a specific, actionable next step.
// ============================================================================

/**
 * Categorize the abort reason for a 3-consecutive-tool-failures kill.
 * Inspects the recent failure history and picks the dominant failure mode.
 *
 * @param recentFailures — The last N tool-call failures, each with name + error.
 * @returns The dominant abort reason. `unknown` if mixed or unclassifiable.
 */
export function categorizeAbortReason(
  recentFailures: ReadonlyArray<{ name: string; error: string }>,
): 'binary_missing' | 'tool_failing' | 'mixed' | 'unknown' {
  if (recentFailures.length === 0) return 'unknown';

  let enoentCount = 0;
  let notFoundCount = 0;
  let timeoutCount = 0;

  for (const f of recentFailures) {
    const err = (f.error || '').toLowerCase();
    if (/enoent/.test(err) || /not found/.test(err) && /spawn/.test(err)) {
      enoentCount += 1;
    } else if (/capability not found|unknown capability|no such tool|tool not registered/.test(err)) {
      notFoundCount += 1;
    } else if (/timeout|timed out|stall/.test(err) || /TIMEOUT-TTFT/.test(f.error)) {
      timeoutCount += 1;
    }
  }

  const total = recentFailures.length;
  // Bug #84 (Pass-6 audit) — derive abortReason from the failure pattern:
  //   - binary_missing: dominant pattern is ENOENT for the same binary
  //     (all 3+ failures are the same spawn error)
  //   - tool_failing:   dominant pattern is the same tool failing repeatedly
  //     (not ENOENT — the tool exists but its results are broken)
  //   - mixed:         failures span 2+ distinct categories (e.g. one ENOENT
  //     + one timeout + one not_found) — the loop-guard fired on heterogeneous
  //     failures, not a single root cause
  //   - unknown:       can't categorise (empty recentFailures or all
  //     failures are unrecognised shapes)
  if (enoentCount >= total / 2 && enoentCount === total) return 'binary_missing';
  if (notFoundCount >= total / 2 && notFoundCount === total) return 'binary_missing';
  if (enoentCount + notFoundCount + timeoutCount >= total / 2) return 'tool_failing';
  // Mixed: at least 2 distinct categories contributed, but no single
  // category dominates. e.g. 1 ENOENT + 1 timeout + 1 not_found.
  if (Number(enoentCount > 0) + Number(notFoundCount > 0) + Number(timeoutCount > 0) >= 2) {
    return 'mixed';
  }
  return 'unknown';
}

/**
 * Get the recovery suggestion for a given abort reason. The suggestion is
 * a short, actionable sentence the LLM can use to self-correct on the next
 * turn (e.g. "switch to write_file" for binary_missing).
 */
function abortReasonSuggestion(abortReason: 'binary_missing' | 'tool_failing' | 'mixed' | 'unknown'): string {
  switch (abortReason) {
    case 'binary_missing':
      return 'Switch to `write_file` / `read_file` / `apply_diff` for file operations — the binary you were calling is not installed. See the "Available Binaries" list in your system prompt.';
    case 'tool_failing':
      // Bug #84 (Pass-6 audit) — the same tool is failing repeatedly but
      // not with ENOENT (so the binary exists). The LLM should switch to
      // a different tool for the same task rather than retrying the same
      // failing call. write_file/apply_diff are safe fallbacks for any
      // file operation; for non-file tools, break the task into pieces.
      return 'The same tool failed 3+ times (not a missing binary). Switch to a different tool: use `write_file` / `apply_diff` for file operations, or break the task into smaller pieces for non-file tools. Do NOT retry the same failing call.';
    case 'mixed':
      // Bug #84 (Pass-6 audit) — failures span 2+ distinct categories
      // (e.g. one ENOENT + one timeout + one not_found). No single root
      // cause; the LLM should step back and try a fundamentally different
      // approach rather than retrying any of the failed tools.
      return 'Failures span multiple tools and error types (mixed pattern). Step back and try a fundamentally different approach. Use `write_file` or `apply_diff` for file operations as a safe fallback, or break the request into smaller, single-tool steps.';
    case 'unknown':
      // Bug #85 (Pass-6 audit): the original "review the errors" suggestion
      // was a no-op for the LLM — it had no actionable next step. With the
      // same fallback as timeout, the LLM has a concrete tool to try
      // regardless of what the underlying cause of the 3-failure cascade
      // was. This eliminates the manual reprompt the user had to send
      // whenever the loop-guard fired with abortReason: 'unknown'.
      return 'Use `write_file` or `apply_diff` for file operations as a safe fallback. Review the recent tool-call errors above and try a different approach — do NOT retry the same failing calls. The same pattern of failures triggered the loop-guard.';
  }
}

/**
 * Build a [STEER] prompt for a 3-consecutive-tool-failures kill. Categorizes
 * the abort reason, generates a recovery suggestion, and returns both the
 * steer prompt AND a structured abort payload for the SSE event.
 *
 * @returns `{ steer, abort }` where `steer` is the [STEER] prompt and
 *          `abort` is the structured payload for the final SSE event.
 */
export function wireLoopAbortSteer(input: {
  consecutive: number;
  recentFailures: ReadonlyArray<{ name: string; error: string }>;
}): { steer: string; abort: { abortReason: 'binary_missing' | 'tool_failing' | 'mixed' | 'unknown'; consecutive: number; failedTools: Array<{ name: string; error: string }>; suggestion: string; promptLength: number } } | null {
  const { consecutive, recentFailures } = input;
  if (consecutive < 1) return null;

  const abortReason = categorizeAbortReason(recentFailures);
  const suggestion = abortReasonSuggestion(abortReason);
  const failedTools = recentFailures.map(f => ({ name: f.name, error: f.error }));

  const trigger: SteerTrigger = {
    kind: 'loop_abort',
    detail: { abortReason, consecutive, failedTools: [...failedTools], suggestion },
  };

  const steer = buildSteerPrompt(trigger);
  // Bug #41: record the fire in the dedicated loop_abort bucket. The other
  // wire* helpers all call recordFire after buildSteerPrompt; loop_abort must
  // too so the steer metrics surface counts the kill in run.log audits.
  steerMetrics.recordFire('loop_abort');
  const abort = {
    abortReason,
    consecutive,
    failedTools,
    suggestion,
    promptLength: steer.length,
  };
  return { steer, abort };
}

/**
 * Build a steer from an ENOENT/EACCES bash error. Returns null for
 * non-environmental error codes. Records the fire in `steerMetrics`
 * when a trigger fires.
 */
export function wireBashErrorSteer(input: {
  command: string;
  code: string;
  tool: string;
}): string | null {
  const trigger = steerFromBashError(input);
  if (!trigger) return null;
  steerMetrics.recordFire(trigger.kind);
  return buildSteerPrompt(trigger);
}

/**
 * Bug #40: build a [STEER] orchestration_fallback prompt when the
 * orchestrator degrades to v1-api text-mode fallback. Emitted on the
 * NEXT turn so the LLM knows the previous response was degraded and
 * can adapt (e.g., not re-try the same plan that just exhausted the
 * orchestrator budget).
 *
 * The suggestion is tailored to the fallback reason:
 *   - budgetExhausted: simplify the plan, fewer tool calls
 *   - orchestrator crash / empty: re-state the request concisely
 *
 * @returns the [STEER] prompt string, or null on invalid input.
 */
export function wireOrchestrationFallbackSteer(input: {
  fromMode: string;
  toMode: string;
  fallbackReason: string;
  budgetExhausted: boolean;
}): string | null {
  if (!input.fromMode || !input.toMode) return null;
  const suggestion = input.budgetExhausted
    ? 'Simplify your plan and use fewer tool calls per turn, or batch independent steps into a single turn. The orchestrator can only run a limited number of plan steps before the budget is exhausted.'
    : 'Re-state your request concisely with explicit tool names. The previous orchestrator run did not produce a usable response; a fresh, focused request works better than retrying the same complex plan.';
  const trigger: SteerTrigger = {
    kind: 'orchestration_fallback',
    detail: {
      fromMode: input.fromMode,
      toMode: input.toMode,
      fallbackReason: input.fallbackReason || 'unknown',
      budgetExhausted: input.budgetExhausted,
      suggestion,
    },
  };
  steerMetrics.recordFire('orchestration_fallback');
  return buildSteerPrompt(trigger);
}

// ============================================================================
// Bug #31: wireFileEditRejectionSteer — injected when the text-mode parser
// (extractFileEdits) drops one or more edits because of path validation,
// empty content, dedup collision, or extraction failure. The LLM previously
// had no way to know WHICH edits were dropped; it would move on as if every
// edit succeeded. This helper builds a single steer listing every dropped
// edit with its editNumber, path, and reason so the LLM can re-issue ONLY
// the failed edits on the next turn.
// ============================================================================

/**
 * Build a single combined steer prompt from a parser rejection report. Use
 * this at the dispatcher / chat route level so the LLM learns about
 * per-edit failures instead of seeing a silent drop.
 *
 * @returns null if no edits were rejected (caller can skip the steer).
 *          A `[STEER]` prefixed prompt otherwise.
 */
export function wireFileEditRejectionSteer(input: {
  /** Rejections from `extractFileEditsWithStatus(content).rejections`. */
  rejections: ReadonlyArray<{
    editNumber: number;
    path?: string;
    reason: string;
    stage: string;
  }>;
  /** Total edits the LLM attempted (`edits.length + rejections.length`). */
  total: number;
  /** Optional: max rejections to surface. Defaults to 5 to fit the steer budget. */
  maxRejections?: number;
}): string | null {
  if (!input.rejections || input.rejections.length === 0) return null;

  const max = input.maxRejections ?? 5;
  const included = input.rejections.slice(0, max);
  const remaining = input.rejections.length - included.length;

  // Group by stage for a tighter, more actionable prompt.
  const byStage = new Map<string, typeof included>();
  for (const r of included) {
    const list = byStage.get(r.stage) ?? [];
    list.push(r);
    byStage.set(r.stage, list);
  }

  const lines: string[] = [];
  lines.push(
    `${input.rejections.length} of ${input.total} text-mode edits were dropped by the parser. ` +
    `Re-issue ONLY the dropped edits below on your next turn — do not duplicate edits that already landed.`,
  );

  for (const [stage, list] of byStage.entries()) {
    const stageLabel = stage.replace(/_/g, ' ');
    const refs = list
      .map((r) => {
        const pathPart = r.path ? ` for "${truncate(r.path, 60)}"` : '';
        return `#${r.editNumber}${pathPart} (${r.reason})`;
      })
      .join('; ');
    lines.push(`- ${stageLabel} (${list.length}): ${refs}`);
  }

  if (remaining > 0) {
    lines.push(
      `(+${remaining} more dropped edit${remaining === 1 ? '' : 's'} suppressed to stay within the steer budget.)`,
    );
  }

  // General self-correction guidance so the model can fix the root cause
  // for the next batch, not just the immediate re-issues.
  lines.push(
    `Common fixes: paths must look like "src/app.ts" (no CSS values, no template literals, no HTML); ` +
    `fenced blocks need non-empty content; ` +
    `do not re-emit the same path twice - combine into one edit.`,
  );

  const prompt = `[STEER] ${lines.join(' ')}`;
  steerMetrics.recordFire('dropped_text_mode_edit');
  return prompt;
}
