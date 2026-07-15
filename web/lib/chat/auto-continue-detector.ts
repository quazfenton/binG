/**
 * Auto-Continue Detector — Shared Module
 *
 * Centralized multi-factor detection that determines whether an LLM execution
 * result needs more turns to complete the task.  Extracted from
 * unified-agent-service.ts so EVERY execution path (V1 API, V2, enhanced-llm-service,
 * response-router, orchestration modes) can reuse the same detector.
 *
 * Factor groups (each produces one or more named signals):
 *
 * 1. TOOL-CALL PATTERNS
 *    - read-then-stall:     last tool is read-only, no writes at all
 *    - deep-research-loop:  3+ consecutive read/search tools, no writes
 *    - failure-cascade:     2+ failed tools in a row
 *    - write-verify-loop:   write_file → read_file on same path (verifying own work)
 *
 * 2. EXPLICIT CONTINUATION SIGNALS
 *    - announced-next-step: response ends with "I'll now", "Let me", "Next I'll"...
 *    - incomplete-thought:  response looks truncated (leveraged detectIncompleteResponse)
 *    - step-enumeration:    "Step 1:", "First," patterns in short responses
 *    - planned-multi-step:  2+ plan words (first/then/next), no writes
 *
 * 3. PARTIAL EDIT DETECTION
 *    - read-many-write-none: 2+ read/search tools, zero writes
 *    - single-write-silent:  1 write with <80 char response
 *    - diff-no-explanation:  edit_file/str_replace without meaningful text
 *    - edits-mismatch:       fileEdits populated but response is thin
 *
 * 4. RESPONSE QUALITY
 *    - empty-after-tools:   <100 char response after 2+ tool calls
 *    - unclosed-code-block: response has unclosed markdown ``` fence
 *    - mid-sentence-cutoff: response truncated mid-sentence (no terminal punct)
 */

import { detectIncompleteResponse } from '@bing/shared/agent/feedback-injection';
import { READ_ONLY_TOOL_NAMES, WRITE_TOOL_NAMES, isReadOnlyTool, isWriteTool } from '@bing/shared/agent/tool-classification';

// ── Tool name classification sets ────────────────────────────────────────

/** Tools that modify the filesystem or execute commands (count as "writes") */
/** Tools that only gather information (count as "reads") */

// ── Types ─────────────────────────────────────────────────────────────────

/** Minimal result shape needed for auto-continue detection.
 *  Callers with richer result types (e.g. UnifiedAgentResult) satisfy this
 *  implicitly — just pass the whole object. */
export interface DetectableResult {
  success: boolean;
  response: string;
  steps?: Array<{
    toolName: string;
    args: Record<string, any>;
    result: { success?: boolean; error?: string; output?: string; [key: string]: any };
  }>;
  fileEdits?: Array<{
    path: string;
    content?: string;
    diff?: string;
    action?: string;
  }>;
}

/** Result from detectNeedsMoreTurns — rich diagnostic explaining WHY the
 *  orchestrator should auto-continue, and with what confidence. */
export interface TurnDetectionResult {
  needsMoreTurns: boolean;
  /** Which detection signals fired (human-readable) */
  signals: string[];
  /** Aggregate confidence across all fired signals */
  confidence: 'low' | 'medium' | 'high';
  /** Pre-built contextual reprompt for the next turn */
  suggestedReprompt?: string;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Multi-factor detection: does the result indicate the LLM needs more turns?
 *
 * @param result - The execution result to analyze.  Any object matching
 *   DetectableResult works — pass UnifiedAgentResult, MastraResult, etc.
 * @returns Rich detection result with signals, confidence, and a suggested reprompt.
 */
export function detectNeedsMoreTurns(result: DetectableResult): TurnDetectionResult {
  const signals: string[] = [];
  let confidence: 'low' | 'medium' | 'high' = 'low';

  // Guard: nothing to analyse
  const steps = result.steps || [];
  if (steps.length === 0) {
    return { needsMoreTurns: false, signals: [], confidence: 'low' };
  }

  // Pre-compute commonly-used values
  const response = (result.response || '').trim();
  const responseLen = response.length;
  const lastStep = steps[steps.length - 1];
  const lastToolName = lastStep?.toolName || '';
  const hadWrite = steps.some(s => WRITE_TOOL_NAMES.has(s.toolName));
  const readCount = steps.filter(s => READ_ONLY_TOOL_NAMES.has(s.toolName)).length;
  const writeCount = steps.filter(s => WRITE_TOOL_NAMES.has(s.toolName)).length;
  const consecutiveFailures = _countConsecutiveFailures(steps);
  const fileEdits = result.fileEdits || [];

  // ═══════════════════════════════════════════════════════════════
  // FACTOR 1: TOOL-CALL PATTERNS
  // ═══════════════════════════════════════════════════════════════

  // Signal: read-then-stall — last tool is read-only and no writes at all
  if (READ_ONLY_TOOL_NAMES.has(lastToolName) && !hadWrite) {
    signals.push('read-then-stall');
    confidence = 'high';
  }

  // Signal: read-loop — same read tool with same path in consecutive steps.
  // Catches the model re-reading the same file/directory instead of taking action.
  if (steps.length >= 2) {
    const secondLast = steps[steps.length - 2];
    const bothRead = READ_ONLY_TOOL_NAMES.has(lastToolName) && READ_ONLY_TOOL_NAMES.has(secondLast?.toolName || '');
    if (bothRead) {
      const lastPath = lastStep?.args?.path || lastStep?.args?.filePath;
      const prevPath = secondLast?.args?.path || secondLast?.args?.filePath;
      if (lastPath && prevPath && lastPath === prevPath) {
        signals.push('read-loop');
        confidence = 'high';
      }
    }
  }

  // Signal: deep-research-loop — 3+ consecutive reads/searches with no writes
  const trailingReadCount = _countTrailingConsecutive(
    steps, s => READ_ONLY_TOOL_NAMES.has(s.toolName)
  );
  if (trailingReadCount >= 3 && !hadWrite) {
    signals.push('deep-research-loop');
    if (confidence !== 'high') confidence = 'high';
  }

  // Signal: failure-cascade — 2+ tool failures in a row
  if (consecutiveFailures >= 2) {
    signals.push('failure-cascade');
    if (confidence === 'low') confidence = 'medium';
  }

  // Signal: write-verify-loop — wrote a file then immediately re-read it
  if (steps.length >= 2 && WRITE_TOOL_NAMES.has(steps[steps.length - 2]?.toolName || '') && READ_ONLY_TOOL_NAMES.has(lastToolName)) {
    const writtenPath = steps[steps.length - 2]?.args?.path || steps[steps.length - 2]?.args?.filePath;
    const readPath = lastStep?.args?.path || lastStep?.args?.filePath;
    if (writtenPath && readPath && writtenPath === readPath) {
      signals.push('write-verify-loop');
      if (confidence === 'low') confidence = 'medium';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FACTOR 2: EXPLICIT CONTINUATION SIGNALS
  // ═══════════════════════════════════════════════════════════════

  if (responseLen > 0) {
    const lowered = response.toLowerCase();

    // Signal: announced-next-step — LLM explicitly said it will do something next
    const nextStepPatterns = [
      /\bi'll now\b/,          /\blet me\b/,
      /\bfirst,? let me\b/,    /\bnow i('ll| will)\b/,
      /\bi('ll| will) (start|begin|proceed|continue)\b/,
      /\bnext,? i('ll| will)\b/,
      /\bhere('s| is) (what|how) i('ll| will)\b/,
      /\bto (do|accomplish|complete|finish) (this|that)\b.*\bi('ll| will)\b/,
      /\bi need to\b/,
      /\bi should (also|now|next)\b/,
    ];
    if (responseLen < 500 && nextStepPatterns.some(p => p.test(lowered))) {
      signals.push('announced-next-step');
      if (confidence === 'low') confidence = 'medium';
    }

    // Signal: incomplete-thought — leverage shared detectIncompleteResponse
    const incomplete = detectIncompleteResponse(response);
    if (incomplete.detected && incomplete.confidence > 0.5) {
      signals.push('incomplete-thought');
      if (confidence === 'low') confidence = 'medium';
    }

    // Signal: step-enumeration — "Step 1:", "First," on the LAST line
    const lastLine = response.split('\n').pop() || '';
    const stepEnumPatterns = [
      /\bstep \d[:\)][\s]*$/i,
      /\bfirst[,:]\s*$/i,
      /\bsecond[,:]\s*$/i,
      /^\d+\.\s*$/,
    ];
    if (responseLen < 300 && lastLine.length > 0 && stepEnumPatterns.some(p => p.test(lastLine))) {
      signals.push('step-enumeration');
      if (confidence === 'low') confidence = 'medium';
    }

    // Signal: planned-multi-step — response describes a plan without executing it
    const planWords = /\b(first|then|after that|finally|next)\b/i;
    const planWordCount = (lowered.match(planWords) || []).length;
    if (planWordCount >= 2 && responseLen < 500 && !hadWrite) {
      signals.push('planned-multi-step');
      if (confidence === 'low') confidence = 'medium';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FACTOR 3: PARTIAL EDIT DETECTION
  // ═══════════════════════════════════════════════════════════════

  // Signal: read-many-write-none — gathered intel but produced nothing
  if (readCount >= 2 && writeCount === 0) {
    signals.push('read-many-write-none');
    if (confidence === 'low') confidence = 'high';
  }

  // Signal: single-write-silent — wrote 1 file with almost no explanation
  if (writeCount === 1 && responseLen < 80 && readCount <= 1) {
    signals.push('single-write-silent');
    if (confidence === 'low') confidence = 'medium';
  }

  // Signal: diff-no-explanation — used edit_file/str_replace with short response
  const patchTools = ['edit_file', 'str_replace', 'replace_in_file', 'apply_diff', 'applydiff'];
  const usedPatchTool = steps.some(s => patchTools.includes(s.toolName));
  if (usedPatchTool && responseLen < 100) {
    signals.push('diff-no-explanation');
    if (confidence === 'low') confidence = 'medium';
  }

  // Signal: edits-mismatch — fileEdits populated but response is thin
  if (fileEdits.length > 0 && responseLen < 100) {
    signals.push('edits-mismatch');
    if (confidence === 'low') confidence = 'medium';
  }

  // ═══════════════════════════════════════════════════════════════
  // FACTOR 4: RESPONSE QUALITY
  // ═══════════════════════════════════════════════════════════════

  // Signal: empty-after-tools — multiple tools ran but response is tiny
  if (responseLen < 100 && steps.length >= 2) {
    signals.push('empty-after-tools');
    if (confidence === 'low') confidence = 'medium';
  }

  // Signal: unclosed-code-block — response ends with unclosed ``` fence
  const fenceOpen = (response.match(/```/g) || []).length;
  if (fenceOpen % 2 !== 0 && responseLen > 20) {
    // Only trigger if it's at/near the end (truncation, not mid-response)
    const lastFenceIdx = response.lastIndexOf('```');
    if (lastFenceIdx > responseLen - 200) {
      signals.push('unclosed-code-block');
      if (confidence === 'low') confidence = 'high';
    }
  }

  // Signal: mid-sentence-cutoff — truncated without terminal punctuation
  const terminalPunct = /[.!?"')\u201d\u2019]\s*$/;
  const endsWithPunct = terminalPunct.test(response);
  if (!endsWithPunct && responseLen > 30 && responseLen < 1000 && !response.endsWith('```')) {
    // Only fire if the last line doesn't look like a code line
    const lastLine = response.split('\n').pop() || '';
    const looksLikeCode = /^[\s{}\[\]();><=|&^%$#@!*,.\-+/\\]+$/.test(lastLine.trim());
    if (!looksLikeCode) {
      signals.push('mid-sentence-cutoff');
      if (confidence === 'low') confidence = 'medium';
    }
  }

  // ── Assemble result ───────────────────────────────────────────

  // Cross-ref: the ramble-no-tools heuristic (responseLen > 4096 AND no
  // tool calls) is NOT folded into Factor 4 here because a single source
  // of truth between `_enrichResultData`'s pre-compute and this
  // 4-factor pipeline would create dead code (no consumer reads
  // `result.incompleteSignals` to surface that signal). Callers who want
  // the ramble-no-tools signal opt in via the dedicated
  // `rambleNoToolsDetector` exported from `auto-continue-helper.ts`:
  //
  //   decideAutoContinue({
  //     ...,
  //     advancedDetectorFn: rambleNoToolsDetector,
  //   })
  //
  // Mirrors the existing 'unclosed-code-block' / 'empty-after-tools'
  // single-source-of-truth discipline: each Factor 4 signal has exactly
  // one definition site.

  const needsMoreTurns = signals.length > 0;

  // Build contextual reprompt when detection fires.
  let suggestedReprompt: string | undefined;
  if (needsMoreTurns) {
    const failedStepNames = steps
      .filter(s => s.result?.success === false || !!s.result?.error)
      .map(s => s.toolName);
    suggestedReprompt = buildDetectedReprompt(signals, failedStepNames, readCount, lastStep);
  }

  return { needsMoreTurns, signals, confidence, suggestedReprompt };
}

/**
 * Backward-compatible wrapper — delegates to detectNeedsMoreTurns.
 * Returns true when the result indicates the LLM should continue.
 */
export function shouldAutoContinue(result: DetectableResult): boolean {
  return detectNeedsMoreTurns(result).needsMoreTurns;
}

/**
 * Build a contextual stepReprompt from the detection signals.
 * Priority-ordered: most actionable signal first.
 */
export function buildDetectedReprompt(
  signals: string[],
  failedStepNames: string[],
  stepCount: number,
  lastStep: { toolName: string; args: Record<string, any>; result: any } | undefined,
): string {
  if (signals.includes('failure-cascade')) {
    const failedNames = failedStepNames.join(', ');
    return `Several tools failed (${failedNames}). Try a DIFFERENT approach — use alternative tools or change your strategy. Do NOT retry the same failing calls.`;
  }

  if (signals.includes('read-loop')) {
    const path = lastStep?.args?.path || 'a resource';
    return `You ALREADY read ${path} in a previous step and got its contents. DO NOT read it again. Take immediate action: write or edit files, run commands, or provide your analysis based on what you already know. Re-reading the same files wastes time and makes no progress.`;
  }

  if (signals.includes('deep-research-loop')) {
    return `You've gathered information through ${stepCount} read/search operations. STOP reading — take action NOW. Make the necessary file changes, create files, or provide your final analysis. Do NOT call any read/search tool again.`;
  }

  if (signals.includes('read-then-stall') || signals.includes('read-many-write-none')) {
    const lastReadPath = lastStep?.args?.path || 'a resource';
    return `You just read ${lastReadPath} and now must take action. DO NOT call any read/list/search tool again — you have enough information. Make the necessary file changes, create files, run commands, or provide your analysis. Stopping after a read without acting is not acceptable.`;
  }

  if (signals.includes('unclosed-code-block')) {
    return `Your response was cut off mid-code-block. Complete the code block and finish your explanation.`;
  }

  if (signals.includes('mid-sentence-cutoff')) {
    return `Your previous response was truncated mid-sentence. Continue from where you left off.`;
  }

  if (signals.includes('write-verify-loop')) {
    const path = lastStep?.args?.path || 'the file';
    return `You read ${path} to verify your work. If verification passed, summarize and move on. If not, fix any remaining issues.`;
  }

  if (signals.includes('announced-next-step') || signals.includes('planned-multi-step')) {
    return `You outlined next steps. Now execute them — make the necessary changes without re-describing the plan.`;
  }

  if (signals.includes('diff-no-explanation') || signals.includes('single-write-silent')) {
    return `You made file edits. Explain what you changed, why you changed it, and whether the task is complete.`;
  }

  // Generic fallback
  return `Continue from where you left off. Complete the task by making file changes or providing your final response.`;
}

/**
 * Build a stepReprompt for auto-continuation (manual fallback only).
 * Prefer detection.suggestedReprompt first — this is the manual construction
 * for callers that bypass detectNeedsMoreTurns.
 */
export function buildAutoContinueReprompt(result: DetectableResult): string {
  const steps = result.steps || [];
  const lastStep = steps[steps.length - 1];

  if (lastStep && READ_ONLY_TOOL_NAMES.has(lastStep.toolName)) {
    return `You just read ${lastStep.args?.path || 'a file'}. Now take action based on what you learned — make the necessary changes, create files, or provide your analysis. Do NOT re-read the same file.`;
  }

  const hadFailures = steps.some(s => s.result?.success === false);
  if (hadFailures) {
    const failedNames = steps
      .filter(s => s.result?.success === false)
      .map(s => s.toolName)
      .join(', ');
    return `Some tools failed (${failedNames}). Try an alternative approach to accomplish the task.`;
  }

  return `Continue from where you left off. Complete the task by making file changes or providing your final response.`;
}

// ── Helper functions ──────────────────────────────────────────────────────

/** Count consecutive failed tool invocations from the end of the steps array. */
export function countConsecutiveFailures(
  steps: Array<{ toolName: string; result: any }>,
): number {
  let count = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const r = steps[i]?.result;
    if (r?.success === false || !!r?.error) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/** Count consecutive trailing steps that match a predicate. */
export function countTrailingConsecutive(
  steps: Array<{ toolName: string; result: any }>,
  predicate: (s: { toolName: string; result: any }) => boolean,
): number {
  let count = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (predicate(steps[i])) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/** Create a stable fingerprint of tool+args for stuck detection. */
export function fingerprintSteps(
  steps: Array<{ toolName: string; args: Record<string, any>; result: any }>,
): string {
  return steps.map(s => `${s.toolName}:${JSON.stringify(s.args || {}).slice(0, 80)}`).join('|');
}

/** Count how many times the given fingerprint appears consecutively from the end. */
export function countIdenticalFingerprints(
  fingerprints: string[],
  target: string,
): number {
  let count = 0;
  for (let i = fingerprints.length - 1; i >= 0; i--) {
    if (fingerprints[i] === target) count++;
    else break;
  }
  return count;
}

// ── Legacy aliases (underscore-prefixed names kept for codebase compat) ──

/** @deprecated Use countConsecutiveFailures instead */
export const _countConsecutiveFailures = countConsecutiveFailures;
/** @deprecated Use countTrailingConsecutive instead */
export const _countTrailingConsecutive = countTrailingConsecutive;
/** @deprecated Use fingerprintSteps instead */
export const _fingerprintSteps = fingerprintSteps;
/** @deprecated Use countIdenticalFingerprints instead */
export const _countIdenticalFingerprints = countIdenticalFingerprints;
/** @deprecated Use buildDetectedReprompt instead */
export const _buildDetectedReprompt = buildDetectedReprompt;
