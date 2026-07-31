/**
 * DIFF_MISMATCH Recovery Utilities
 *
 * Provides reusable helpers for the self-heal/recovery flow when a
 * SEARCH/REPLACE diff fails because the tracked file content does not
 * match the on-disk state.  Designed to be imported by the streaming
 * layer (vercel-ai-streaming.ts), the tool router (router.ts), and
 * the stateful-agent self-heal path.
 *
 * Three-tier strategy:
 *   1. Prefer `currentFileContent` from the error payload (vfs-mcp-tools.ts
 *      already augments DIFF_MISMATCH errors with this when the file is
 *      readable at execution scope).
 *   2. When (1) is missing, offer a `readFileFn` callback so the caller can
 *      proactively read the file (e.g. via an internal VFS read call) and
 *      embed the actual content into the recovery steer — the LLM receives
 *      the content directly rather than being told to call read_file itself.
 *   3. When neither (1) nor `readFileFn` is available, emit a forceful steer
 *      instructing the LLM to call `read_file` as its **first action**.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Chat:DIFF-MISMATCH-Recovery');

// ─── Types ───────────────────────────────────────────────────────────────

export interface DiffMismatchMeta {
  /** The file path that failed (extracted from errObj.attemptedPath or errObj.path). */
  filePath: string;
  /**
   * The current file content when the tool layer was able to read it.
   * May be truncated (first 1000 chars) for very large files.
   */
  currentFileContent?: string;
  /** The file version the tool layer read, if available. */
  currentFileVersion?: number;
  /** The diff payload the LLM attempted. */
  attemptedDiff?: string;
}

export interface BuildRecoverySteerOptions {
  /** Callback to proactively re-read the file content. When provided and
   *  `currentFileContent` is missing, the helper calls this before falling
   *  back to the LLM-instruction path. */
  readFileFn?: (path: string) => Promise<string | null>;
  /** Maximum content chars to embed in the steer (truncated to avoid bloat). */
  maxContentChars?: number;
}

export interface RecoverySteerResult {
  /** The recovery steer string to inject as `_recoveryHint` or error appendix. */
  steer: string;
  /** Whether proactive read_file was performed by the system (not delegated to LLM). */
  didProactiveRead: boolean;
  /** The content that was read (may be truncated). Undefined when no proactive read occurred. */
  readContent?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_CONTENT_CHARS_DEFAULT = 1000;
const MAX_STEER_LENGTH = 3000; // safety guard — don't emit a steer longer than this

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Build a recovery steer for a DIFF_MISMATCH error.
 *
 * Tries three strategies in order:
 *   1. Use `meta.currentFileContent` directly when present.
 *   2. Call `opts.readFileFn` to proactively read the file.
 *   3. Emit a forceful instruction for the LLM to call `read_file`.
 *
 * The returned `steer` is designed to be assigned to `toolResult._recoveryHint`
 * or appended to the tool error message so the LLM sees actionable guidance
 * on the **very next turn**.
 */
export async function buildDiffMismatchRecoverySteer(
  meta: DiffMismatchMeta,
  opts?: BuildRecoverySteerOptions,
): Promise<RecoverySteerResult> {
  const { filePath, currentFileContent, currentFileVersion, attemptedDiff } = meta;
  const maxChars = opts?.maxContentChars ?? MAX_CONTENT_CHARS_DEFAULT;

  // ── Strategy 1: content already present in error payload ──────────────
  if (currentFileContent && currentFileContent.length > 0) {
    const truncated = currentFileContent.length > maxChars
      ? currentFileContent.slice(0, maxChars) + '\n... [truncated]'
      : currentFileContent;

    const steer = [
      `[DIFF_MISMATCH] The file "${filePath}" was modified since your SEARCH block was generated.`,
      `Below is the ACTUAL current content of the file (v${currentFileVersion ?? '?'}):`,
      '',
      '```',
      truncated,
      '```',
      '',
      `Regenerate your SEARCH/REPLACE block so the SEARCH section EXACTLY matches the content above.`,
      `Do NOT use bash_execute — it will NOT fix this error.`,
    ].join('\n');

    return {
      steer: steer.slice(0, MAX_STEER_LENGTH),
      didProactiveRead: false,
      readContent: truncated,
    };
  }

  // ── Strategy 2: proactively re-read via caller-provided callback ──────
  if (opts?.readFileFn) {
    try {
      const freshContent = await opts.readFileFn(filePath);
      if (freshContent && freshContent.length > 0) {
        const truncated = freshContent.length > maxChars
          ? freshContent.slice(0, maxChars) + '\n... [truncated]'
          : freshContent;

        const steer = [
          `[DIFF_MISMATCH] The file "${filePath}" was modified since your SEARCH block was generated.`,
          `The system performed a proactive read of the current file content:`,
          '',
          '```',
          truncated,
          '```',
          '',
          `Regenerate your SEARCH/REPLACE block so the SEARCH section EXACTLY matches the content above.`,
          `Do NOT use bash_execute — it will NOT fix this error.`,
        ].join('\n');

        logger.info('[DIFF-MISMATCH-RECOVERY] Proactive read_file succeeded', {
          filePath,
          contentLength: freshContent.length,
          truncated: freshContent.length > maxChars,
        });

        return {
          steer: steer.slice(0, MAX_STEER_LENGTH),
          didProactiveRead: true,
          readContent: truncated,
        };
      }
      logger.warn('[DIFF-MISMATCH-RECOVERY] Proactive read_file returned empty content', { filePath });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('[DIFF-MISMATCH-RECOVERY] Proactive read_file failed, falling back to LLM instruction', {
        filePath,
        error: msg,
      });
    }
  }

  // ── Strategy 3: forceful LLM instruction (no content available) ───────
  const steer = [
    `[DIFF_MISMATCH] The file "${filePath}" was modified since your SEARCH block was generated, and the system could not obtain the current content automatically.`,
    '',
    `IMMEDIATE ACTION REQUIRED:`,
    `  1. Call \`read_file\` on: "${filePath}"`,
    `  2. Compare the returned content against your SEARCH block.`,
    `  3. Regenerate the SEARCH/REPLACE block so the SEARCH section EXACTLY matches the actual file content.`,
    '',
    ...(attemptedDiff
      ? [`For reference, the diff you attempted was:`, '```diff', attemptedDiff.slice(0, 500), '```', '']
      : []),
    `CRITICAL: Do NOT call bash_execute — it will NOT fix this error.`,
  ].join('\n');

  return {
    steer: steer.slice(0, MAX_STEER_LENGTH),
    didProactiveRead: false,
  };
}

/**
 * Extract DIFF_MISMATCH metadata from a tool error payload.
 *
 * Returns `null` when the error is not a DIFF_MISMATCH or does not
 * contain a usable file path, allowing callers to safely short-circuit.
 */
export function extractDiffMismatchMeta(
  errObj: Record<string, unknown> | undefined | null,
): DiffMismatchMeta | null {
  if (!errObj) return null;
  if (errObj.code !== 'DIFF_MISMATCH') return null;

  const filePath =
    (typeof errObj.attemptedPath === 'string' && errObj.attemptedPath.length > 0
      ? errObj.attemptedPath
      : undefined) ??
    (typeof errObj.path === 'string' && errObj.path.length > 0
      ? errObj.path
      : undefined);

  if (!filePath) return null; // can't recover without a path

  return {
    filePath,
    currentFileContent:
      typeof errObj.currentFileContent === 'string' && errObj.currentFileContent.length > 0
        ? errObj.currentFileContent
        : undefined,
    currentFileVersion:
      typeof errObj.currentFileVersion === 'number'
        ? errObj.currentFileVersion
        : undefined,
    attemptedDiff:
      typeof errObj.attemptedDiff === 'string' && errObj.attemptedDiff.length > 0
        ? errObj.attemptedDiff
        : undefined,
  };
}

/**
 * Wrap a tool error result that is a DIFF_MISMATCH with the strongest
 * possible recovery steer.  Mutates `toolResult` in place by setting
 * `_recoveryHint` and adding a `_diffMismatchPath` marker so the
 * auto-continue flow can detect this path as needing read-before-diff.
 *
 * This is the primary integration point for vercel-ai-streaming.ts
 * and similar streaming layers.
 */
export function tagToolResultWithDiffMismatchRecovery(
  toolResult: Record<string, unknown>,
  errObj: Record<string, unknown> | undefined | null,
  steer: string,
): void {
  if (!toolResult || !errObj) return;

  // Set the recovery hint so the LLM sees actionable guidance on the next turn.
  // DIFF_MISMATCH-specific hint ALWAYS takes priority over any generic hint
  // set by the preceding error logic (INVALID_ARGS, etc.), because the diff
  // mismatch recovery steer is more targeted and actionable.
  toolResult._recoveryHint = steer;

  // Tag the path so the auto-continue / self-heal flow can detect it.
  const filePath =
    (typeof errObj.attemptedPath === 'string' ? errObj.attemptedPath : undefined) ??
    (typeof errObj.path === 'string' ? errObj.path : undefined);
  if (filePath && !toolResult._diffMismatchPath) {
    toolResult._diffMismatchPath = filePath;
  }

  logger.info('[DIFF-MISMATCH-RECOVERY] Tagged tool result with recovery steer', {
    filePath,
    steerLength: steer.length,
    didProactiveRead: steer.includes('proactive read'),
  });
}

/**
 * Check whether a tool error result is tagged with a DIFF_MISMATCH path.
 * Useful for self-heal flows that want to branch on DIFF_MISMATCH
 * without re-parsing the error object.
 */
export function hasDiffMismatchTag(
  toolResult: Record<string, unknown> | undefined | null,
): string | false {
  if (!toolResult) return false;
  const path = toolResult._diffMismatchPath;
  return typeof path === 'string' && path.length > 0 ? path : false;
}
