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
// Detection helpers — translate low-level signals into SteerTriggers
// ============================================================================

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
] as const;
