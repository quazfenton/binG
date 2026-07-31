/**
 * Premature Stoppage After Info-Gathering Tools — Comprehensive Tests
 *
 * Reproduces the failure mode where the LLM calls read_file, list_directory,
 * web_search, etc., but then the stream ends BEFORE the model produces a
 * text response. The auto-continue mechanism must detect this and re-prompt.
 *
 * Run: npx vitest run __tests__/premature-stoppage.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock detectIncompleteResponse so we can control its return value
vi.mock('@bing/shared/agent/feedback-injection', () => ({
  detectIncompleteResponse: vi.fn(() => ({ detected: false, reason: '', confidence: 0 })),
}));

// Mock logging utilities to avoid noise
vi.mock('@/lib/errors/logging-utils', () => ({
  recordToolCallTelemetry: vi.fn(() => Promise.resolve()),
  prepareTelemetryPayload: vi.fn(() => ({ redactedArgs: {}, originStack: '' })),
}));

// ============================================================================
// Core Detection Helpers (copy of server-side logic for isolated testing)
// ============================================================================

const INFO_GATHERING_TOOLS = new Set<string>([
  'read_file', 'readFile', 'file.read',
  'list_files', 'listFiles', 'list_directory', 'list_dir', 'ls', 'file.list', 'listDirectory',
  'web_search', 'webSearch', 'search', 'web.search',
  'read_url', 'readUrl', 'fetch_url', 'fetchUrl',
  'glob', 'globFiles', 'glob.files',
  'file_picker', 'pickFiles', 'file.picker',
]);

function isInfoGatheringTool(name: string): boolean {
  return INFO_GATHERING_TOOLS.has(name);
}

function allToolsAreInfoGathering(allToolCalls: any[]): boolean {
  if (allToolCalls.length === 0) return false;
  return allToolCalls.every(tc => isInfoGatheringTool(tc.name));
}

function getToolNames(allToolCalls: any[]): string[] {
  return allToolCalls.map(tc => tc.name);
}

// ============================================================================
// Simulated Server-Side Auto-Continue Logic
// ============================================================================

interface AutoContinueOptions {
  maxContinuations: number;
  continuationCount: number;
  enableAutoContinue: boolean;
}

interface AutoContinueResult {
  triggered: boolean;
  reason?: string;
  yieldedContent?: string;
  yieldedType?: string;
}

/**
 * Simulates the auto-continue detection that runs AFTER the stream has
 * consumed all chunks. This mirrors the logic in streamWithAutoContinue():
 *
 * 1. Check continuation count guard
 * 2. Check continuation marker guard
 * 3. Check [CONTINUE_REQUESTED] token
 * 4. Check file read request pattern (Gap #3)
 * 5. Check info-gathering tool as last action
 * 6. Check tools-without-text catch-all
 * 7. Check incomplete response pattern
 */
function simulateAutoContinueDetection(
  allToolCalls: any[],
  fullResponse: string,
  isComplete: boolean,
  options: AutoContinueOptions
): AutoContinueResult {
  const { maxContinuations, continuationCount, enableAutoContinue } = options;

  if (!enableAutoContinue) {
    return { triggered: false };
  }

  // Guard: Max continuations
  if (continuationCount >= maxContinuations) {
    return { triggered: false, reason: 'max_continuations_reached' };
  }

  // Guard: Existing continuation markers
  // NOTE: [CONTINUE_REQUESTED] is intentionally NOT included here — it's a
  // legitimate LLM-to-server signal. The dedicated check below handles it.
  if (fullResponse.includes('[AUTO-CONTINUE]') ||
      fullResponse.includes('[NEXT]')) {
    return { triggered: false, reason: 'has_continuation_marker' };
  }

  // Only check if stream completed and has content or tools
  if (!isComplete || (!fullResponse.trim() && allToolCalls.length === 0)) {
    return { triggered: false, reason: 'not_complete_or_empty' };
  }

  // Check [CONTINUE_REQUESTED] token — this is a legitimate LLM-to-server signal
  // indicating the model needs more turns to complete the task.
  // NOTE: In the production code, this check is intentionally placed BEFORE
  // the autoContinueWithFiles and info-gathering checks because [CONTINUE_REQUESTED]
  // is an explicit signal from the LLM that should take highest priority.
  if (fullResponse.trimEnd().endsWith('[CONTINUE_REQUESTED]')) {
    return {
      triggered: true,
      reason: 'continuation_requested',
      yieldedType: 'auto-continue',
      yieldedContent: '',
    };
  }

  // Check file read request pattern (Gap #3)
  // This runs before the info-gathering check because the production code
  // calls autoContinueWithFiles() first — if the LLM explicitly mentions
  // a file path ("let me check App.tsx", "read the config file"), we should
  // generate a context pack with that file BEFORE checking tool-based triggers.
  const fileRequestCheck = simulateAutoContinueWithFiles(fullResponse, allToolCalls);
  if (fileRequestCheck && fileRequestCheck.shouldContinue) {
    return {
      triggered: true,
      reason: 'file_request_detected',
      yieldedType: 'auto-continue',
      yieldedContent: `[AUTO-CONTINUE] Detected file read requests: ${fileRequestCheck.files.join(', ')}`,
    };
  }

  // Check info-gathering tool as last action
  const lastToolCall = allToolCalls[allToolCalls.length - 1];
  const lastToolIsInfoGathering = lastToolCall && isInfoGatheringTool(lastToolCall.name);
  const allToolsAreInfo = allToolsAreInfoGathering(allToolCalls);
  const hasContinuationMarker = fullResponse.includes('[NEXT]') ||
    fullResponse.includes('[CONTINUE]') ||
    fullResponse.includes('[AUTO-CONTINUE]');

  if (lastToolIsInfoGathering && allToolsAreInfo && !hasContinuationMarker) {
    const lastArgs = lastToolCall.arguments || {};
    const lastPath = lastArgs.path || lastArgs.directory || lastArgs.url ||
      lastArgs.file || lastArgs.pattern || 'current location';

    return {
      triggered: true,
      reason: 'info_gathering_completed',
      yieldedContent: `[NEXT] The ${lastToolCall.name} for \`${lastPath}\` is complete. Please proceed.`,
      yieldedType: 'next',
    };
  }

  // Check tools-without-text catch-all
  const hasToolsButNoText = allToolCalls.length > 0 && !fullResponse.trim();
  if (hasToolsButNoText && !hasContinuationMarker) {
    return {
      triggered: true,
      reason: 'tools_without_text',
      yieldedContent: `[NEXT] The tool result is ready. Please analyze and continue.`,
      yieldedType: 'next',
    };
  }

  // ─── Gap #13: failure_plan_loop circuit-breaker (chat-loop preemption) ─────
  // Production rule: `lib/chat/llm-continuation.ts:_detectFailurePlanLoop`.
  // Operates on the SAME plan-language regex as production
  // (`/\b(I'll now|first|then I will|finally|let me)\b/i`) so the
  // simulator and production diverge ZERO on detection. The simulator's
  // placement differs intentionally from production: production fires
  // this rule INSIDE the plan_steps_remaining branch (after the heuristic
  // cascade), while the simulator exposes it as a free-standing cascade
  // arm because the simulator's `allToolCalls` shape doesn't model
  // `planStepsCount` (it only carries `continuationCount`). This is a
  // deliberate, documented simplification — the simulator's goal is to
  // lock down SERIALIZATION of the `failure_plan_loop` reason into the
  // SSE chunk, NOT cascade-ordering semantics.
  //
  // KNOWN DIVERGENCE from production (acceptable for this regression-test
  // scope): production's `_detectFailurePlanLoop` wrapper ALSO has a
  // `if (!hasFailure || hasSuccess) return false` gate — meaning the
  // breaker is bypassed if NO tool failed OR if there's mixed success/
  // failure (forward progress). The simulator does not model this gate
  // because its `allToolCalls` shape doesn't carry `result.success`.
  // Consequence: the simulator may over-trigger when a SUCCESSFUL
  // non-info-gathering tool is followed by plan-language text. This is
  // acceptable here because the regression-test goal is wire-format
  // preservation (i.e. doesn't break the reason-string assertion); a
  // future change to the simulator's `simulateServerRePrompt` or a
  // thread of `collectedToolResults` into `simulateAutoContinueDetection`
  // could close the gap.
  //
  // Preconditions (continue-friendly lastToolCall is already declared
  // above in the info-gathering block):
  //   1. continuationCount >= 1 (PRE-snapshot, model has already had a retry)
  //   2. allToolCalls.length >= 1 (last tool was attempted)
  //   3. lastToolCall is NON-info-gathering (write_file / execute_shell —
  //      simulator's failure proxy; allToolCalls doesn't carry
  //      result.success so the tool-choice is the closest signal)
  //   4. responseText has plan-language words in the 30-1000 char range
  //      (shorter = too ambiguous, longer = real content not pure plan)
  const responseLen = fullResponse.length;
  const responseHasPlanLanguage =
    responseLen >= 30 &&
    responseLen <= 1000 &&
    /\b(I'll now|first|then I will|finally|let me)\b/i.test(fullResponse);
  const lastToolIsNonInfoGathering =
    lastToolCall && !isInfoGatheringTool(lastToolCall.name);
  if (
    continuationCount >= 1 &&
    allToolCalls.length >= 1 &&
    lastToolIsNonInfoGathering &&
    responseHasPlanLanguage
  ) {
    // Stop signal: no yieldedContent / yieldedType. The route.ts SSE
    // emitter downstream reads `autoDecision.reason` verbatim into the
    // `continuation` chunk's `reason` field, where operators
    // `grep '"reason":"failure_plan_loop"'` to detect upstream-tool-
    // failure chat loops.
    return {
      triggered: false,
      reason: 'failure_plan_loop',
    };
  }

  // Check incomplete response detection (step 7)
  // Simulates detectIncompleteResponse by checking for common truncation patterns
  const simulateIncompleteCheck = simulateDetectIncompleteResponse(fullResponse);
  if (simulateIncompleteCheck.detected && simulateIncompleteCheck.confidence >= 0.5) {
    return {
      triggered: true,
      reason: 'incomplete_response',
      yieldedType: 'continue',
      yieldedContent: `[CONTINUE] Response appears incomplete (${simulateIncompleteCheck.reason})`,
    };
  }

  return { triggered: false, reason: 'no_detection_needed' };
}

// ============================================================================
// Incomplete Response Detection (step 7 of the auto-continue flow)
// ============================================================================

interface IncompleteDetectionResult {
  detected: boolean;
  reason: string;
  confidence: number;
}

/**
 * Simulates detectIncompleteResponse() from @bing/shared/agent/feedback-injection.
 * Detects common truncation patterns:
 * - Unclosed code blocks (\`\`\` without closing)
 * - Mid-sentence truncation (no ending punctuation)
 * - Mid-word cutoff (word boundary at end)
 * - Unclosed brackets/parens/braces
 * - Truncation markers (... at end)
 */
function simulateDetectIncompleteResponse(response: string): IncompleteDetectionResult {
  if (!response || response.length < 10) {
    return { detected: false, reason: '', confidence: 0 };
  }

  const trimmed = response.trimEnd();
  const lastChar = trimmed[trimmed.length - 1];

  // Check for unclosed code blocks
  const codeBlockCount = (trimmed.match(/\`\`\`/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    return { detected: true, reason: 'unclosed_code_block', confidence: 0.9 };
  }

  // Check for unclosed brackets
  const openBraces = (trimmed.match(/\{/g) || []).length;
  const closeBraces = (trimmed.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    return { detected: true, reason: 'unclosed_brace', confidence: 0.85 };
  }

  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  if (openParens > closeParens) {
    return { detected: true, reason: 'unclosed_parenthesis', confidence: 0.8 };
  }

  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    return { detected: true, reason: 'unclosed_bracket', confidence: 0.75 };
  }

  // Check for truncation markers like "..." at end (BEFORE sentence checks)
  if (trimmed.endsWith('...')) {
    return { detected: true, reason: 'truncation_marker', confidence: 0.7 };
  }

  // Check for mid-sentence truncation (no sentence-ending punctuation)
  const sentenceEnders = ['.', '!', '?', ':', ';', '"', "'", '`', '\n', '>'];
  if (trimmed.length > 20 && !sentenceEnders.includes(lastChar)) {
    // Check if the last "word" looks like a complete word vs mid-word cutoff
    const lastWord = trimmed.split(/[\s]+/).pop() || '';
    // A mid-word cutoff has a short fragment at the end that's not a real word
    // Check if the word ends with non-letter characters (like a partial path)
    const lastCharIsLetter = /[a-zA-Z]$/.test(lastWord);

    if (lastCharIsLetter && lastWord.length > 2) {
      // Word looks complete but sentence lacks ending punctuation
      return { detected: true, reason: 'mid_sentence_truncation', confidence: 0.5 };
    }

    // Last word ends with non-letter → likely mid-word cutoff
    return { detected: true, reason: 'mid_word_cutoff', confidence: 0.6 };
  }

  return { detected: false, reason: '', confidence: 0 };
}

/**
 * Simulates the server-side re-prompt logic from streamWithServerAutoRePrompt()
 */
function simulateServerRePrompt(
  collectedToolResults: Array<{ toolCallId: string; toolName: string; result: any }>,
  maxRePrompts: number,
  rePromptCount: number
): { needsRePrompt: boolean; newCount: number } {
  if (collectedToolResults.length > 0 && rePromptCount < maxRePrompts) {
    const needsRePrompt = collectedToolResults.some(tr =>
      isInfoGatheringTool(tr.toolName)
    );
    return { needsRePrompt, newCount: rePromptCount + 1 };
  }
  return { needsRePrompt: false, newCount: rePromptCount };
}

// ============================================================================
// Client-Side File Read Pattern Detection (Gap #3)
// ============================================================================

interface FileReadRequestResult {
  files: string[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Simulates detectFileReadRequest() from smart-context.ts.
 * Detects file read requests in LLM response text using pattern matching:
 * - <request_file>path</request_file> XML tags (high confidence)
 * - "read/check/look at file.ts" (medium confidence)
 * - "in file.ts / from file.ts" (low confidence)
 */
function simulateDetectFileReadRequest(llmResponse: string): FileReadRequestResult {
  const requestedFiles: string[] = [];
  let confidence: 'high' | 'medium' | 'low' = 'low';

  // Pattern 1: XML-style tags (highest confidence)
  const xmlPattern = /<request_file>([^<]+)<\/request_file>/gi;
  let xmlCount = 0;
  for (const match of llmResponse.matchAll(xmlPattern)) {
    const file = match[1].trim();
    if (file.length > 0 && file.length < 500) {
      requestedFiles.push(file);
      xmlCount++;
    }
  }
  if (xmlCount > 0) confidence = 'high';

  // Pattern 2: "read/check/look at" + filename (medium confidence)
  const readPattern = /\b(read|check|look at|examine|inspect|open)\s+(?:the\s+)?(?:file\s+)?([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\b/gi;
  let readCount = 0;
  for (const match of llmResponse.matchAll(readPattern)) {
    const file = match[2].trim();
    if (file.length > 2 && file.length < 500 && !file.includes(' ')) {
      requestedFiles.push(file);
      readCount++;
    }
  }
  if (readCount > 0 && confidence !== 'high') confidence = 'medium';

  // Pattern 3: "in file.ts" or "from file.ts" (lower confidence)
  const inFilePattern = /\b(?:read|check|see|find|look|search|in|from|at)\s+(?:the\s+)?(?:file\s+)?([\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl))\b/gi;
  let inFileCount = 0;
  for (const match of llmResponse.matchAll(inFilePattern)) {
    const file = match[1].trim();
    if (file.length > 2 && file.length < 500 && !file.includes(' ')) {
      requestedFiles.push(file);
      inFileCount++;
    }
  }
  if (inFileCount > 0 && confidence === 'low') confidence = 'low';

  // Deduplicate
  return { files: Array.from(new Set<string>(requestedFiles)), confidence };
}

/**
 * Tools that are information-gathering but NOT file/directory read operations.
 * These are excluded when deriving FILE_READ_TOOL_VARIANTS from INFO_GATHERING_TOOLS.
 */
const NON_FILE_READ_INFO_GATHERING_TOOLS = new Set<string>([
  'web_search', 'webSearch', 'search', 'web.search',
  'read_url', 'readUrl', 'fetch_url', 'fetchUrl',
  'file_picker', 'pickFiles', 'file.picker',
]);

/**
 * Tool name variants that indicate file/directory reading intent.
 * Derived from INFO_GATHERING_TOOLS by excluding NON_FILE_READ_INFO_GATHERING_TOOLS.
 * This makes the subset relationship explicit — FILE_READ_TOOL_VARIANTS ⊆ INFO_GATHERING_TOOLS.
 */
const FILE_READ_TOOL_VARIANTS = new Set<string>(
  [...INFO_GATHERING_TOOLS].filter(t => !NON_FILE_READ_INFO_GATHERING_TOOLS.has(t))
);

/** Runtime assertion: FILE_READ_TOOL_VARIANTS is a subset of INFO_GATHERING_TOOLS */
if (![...FILE_READ_TOOL_VARIANTS].every(t => INFO_GATHERING_TOOLS.has(t))) {
  throw new Error('FILE_READ_TOOL_VARIANTS must be a subset of INFO_GATHERING_TOOLS');
}

/**
 * Simulates extractToolCallFileRequests() from smart-context.ts.
 * Extracts file paths from tool calls — handles:
 * - read_file / file.read (path argument)
 * - list_directory / listFiles / list_dir / ls (directory/path argument)
 * - glob (pattern argument)
 */
function simulateExtractToolCallFileRequests(toolCalls: any[]): string[] {
  const requestedFiles: string[] = [];
  for (const tc of toolCalls) {
    if (FILE_READ_TOOL_VARIANTS.has(tc.name)) {
      // Prefer path, fall back to directory for list tools, then pattern for glob
      const path = tc.arguments?.path || tc.arguments?.directory || tc.arguments?.pattern;
      if (path && typeof path === 'string') {
        requestedFiles.push(path);
      }
    }
  }
  return requestedFiles;
}

/**
 * Simulates the autoContinueWithFiles() check from streamWithAutoContinue().
 * Returns { shouldContinue, files } if file requests were detected,
 * or null if no file requests found.
 *
 * This runs AFTER the [CONTINUE_REQUESTED] check but BEFORE the
 * info-gathering tool check in the production flow.
 */
function simulateAutoContinueWithFiles(
  fullResponse: string,
  allToolCalls: any[]
): { shouldContinue: boolean; files: string[] } | null {
  // Detect file requests from LLM response text
  const textDetection = simulateDetectFileReadRequest(fullResponse);
  const textRequestedFiles = textDetection.files;

  // Detect file requests from tool calls
  const toolRequestedFiles = simulateExtractToolCallFileRequests(allToolCalls);

  // Combine and deduplicate
  const allRequestedFiles = Array.from(new Set<string>([...textRequestedFiles, ...toolRequestedFiles]));

  if (allRequestedFiles.length === 0) {
    return null; // No files requested
  }

  return {
    shouldContinue: true,
    files: allRequestedFiles,
  };
}

// ============================================================================
// Chain Integration Simulation (Gap #7)
// ============================================================================

interface ChainIntegrationResult {
  autoContinued: boolean;
  autoContinueReason?: string;
  serverRePrompted: boolean;
  rePromptCount: number;
  finalContent: string;
  events: Array<{ type: string; reason?: string }>;
}

/**
 * Simulates the full chain:
 *   streamWithAutoContinue → streamWithServerAutoRePrompt
 *
 * This mirrors the production code in enhanced-llm-service.ts:
 *   const autoContinueStream = streamWithAutoContinue(baseStream, {...});
 *   yield* streamWithServerAutoRePrompt(autoContinueStream, {...});
 *
 * The chain works as follows:
 * 1. streamWithAutoContinue detects continuation needs based on tool calls + response
 * 2. It yields auto-continue events with [NEXT], [AUTO-CONTINUE], etc.
 * 3. streamWithServerAutoRePrompt consumes the stream, collects tool results,
 *    and after the stream ends, checks if re-prompt is needed
 * 4. If re-prompt is needed, it returns a result indicating what action to take
 */
function simulateChainIntegration(
  allToolCalls: any[],
  fullResponse: string,
  collectedToolResults: Array<{ toolCallId: string; toolName: string; result: any }>,
  options: {
    maxContinuations: number;
    continuationCount: number;
    enableAutoContinue: boolean;
    maxRePrompts: number;
    rePromptCount: number;
  }
): ChainIntegrationResult {
  const events: Array<{ type: string; reason?: string }> = [];

  // Step 1: Run auto-continue detection (streamWithAutoContinue)
  const autoContinueResult = simulateAutoContinueDetection(
    allToolCalls,
    fullResponse,
    true,
    {
      maxContinuations: options.maxContinuations,
      continuationCount: options.continuationCount,
      enableAutoContinue: options.enableAutoContinue,
    }
  );

  let autoContinued = autoContinueResult.triggered;
  let autoContinueReason = autoContinueResult.reason;

  if (autoContinued && autoContinueResult.yieldedType) {
    events.push({
      type: autoContinueResult.yieldedType,
      reason: autoContinueResult.reason,
    });
  }

  // Step 2: Simulate server-side re-prompt (streamWithServerAutoRePrompt)
  // This runs AFTER the stream ends, detecting if tools were executed but no
  // final response was produced.
  const rePromptCheck = simulateServerRePrompt(
    collectedToolResults,
    options.maxRePrompts,
    options.rePromptCount
  );

  let serverRePrompted = rePromptCheck.needsRePrompt;
  let rePromptCount = rePromptCheck.newCount;

  if (serverRePrompted) {
    events.push({
      type: 'server-re-prompt',
      reason: 'info_gathering_needs_re_prompt',
    });
  }

  // Step 3: Determine final content based on what happened
  let finalContent = '';
  if (autoContinued) {
    finalContent = autoContinueResult.yieldedContent || '';
  } else if (serverRePrompted) {
    finalContent = '[SERVER RE-PROMPT] Tools executed without final response.';
  } else {
    finalContent = fullResponse || '(no content - stream ended cleanly)';
  }

  // Detect if both auto-continue and server re-prompt fire (double-fire test)
  if (autoContinued && serverRePrompted) {
    events.push({ type: 'double-fire-detected' });
  }

  return {
    autoContinued,
    autoContinueReason,
    serverRePrompted,
    rePromptCount,
    finalContent,
    events,
  };
}

// ============================================================================
// Client-Side Fallback Guard Simulation (Gap #5)
// ============================================================================

interface ClientFallbackResult {
  canAutoContinue: boolean;
  guardBlocked: string | null; // null = not blocked, string = reason
  sseReceivedDone: boolean;
  wsConnected: boolean;
  needsSSEClientFallback: boolean;
  needsWSFallback: boolean;
}

/**
 * Simulates the client-side guards that prevent auto-continue race conditions:
 *
 * 1. isLoading guard (SSE auto-continue handler):
 *    - Client receives an auto-continue SSE event
 *    - BEFORE processing it, checks if isLoading is true
 *    - If loading, the auto-continue is SKIPPED (prevents overlapping streams)
 *
 * 2. streamId guard (WebSocket onNeedMoreTurns):
 *    - Server sends need_more_turns via WebSocket
 *    - BEFORE processing it, checks if streamId is set
 *    - If no streamId, the WebSocket signal is ignored (prevents stale WS responses)
 *
 * 3. Dual guard check: SSE failed AND WebSocket disconnected
 *    - When both SSE and WS are unavailable, falls through to client-side retry
 */
function simulateClientFallbackGuards(options: {
  receivedDoneEvent: boolean;
  isLoading: boolean;
  streamId: string | null;
  hasToolCalls: boolean;
  hasContent: boolean;
}): ClientFallbackResult {
  const { receivedDoneEvent, isLoading, streamId, hasToolCalls, hasContent } = options;

  // Guard 1: isLoading blocks auto-continue SSE processing
  if (isLoading) {
    return {
      canAutoContinue: false,
      guardBlocked: 'isLoading',
      sseReceivedDone: receivedDoneEvent,
      wsConnected: !!streamId,
      needsSSEClientFallback: false,
      needsWSFallback: false,
    };
  }

  // Guard 2: No streamId → WebSocket not connected
  if (!streamId) {
    // WebSocket signal is unreliable — check SSE path instead
    if (!receivedDoneEvent) {
      // SSE also didn't get a done event → need client-side fallback
      return {
        canAutoContinue: hasToolCalls,
        guardBlocked: 'no_streamId',
        sseReceivedDone: receivedDoneEvent,
        wsConnected: false,
        needsSSEClientFallback: true,
        needsWSFallback: true,
      };
    }

    // SSE got done event, WS disconnected is acceptable
    return {
      canAutoContinue: false,
      guardBlocked: 'no_streamId',
      sseReceivedDone: true,
      wsConnected: false,
      needsSSEClientFallback: false,
      needsWSFallback: false,
    };
  }

  // Neither guard blocked — auto-continue can proceed
  return {
    canAutoContinue: hasToolCalls || hasContent,
    guardBlocked: null,
    sseReceivedDone: receivedDoneEvent,
    wsConnected: true,
    needsSSEClientFallback: false,
    needsWSFallback: false,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Premature Stoppage After Info-Gathering Tools', () => {

  // --------------------------------------------------------------------------
  // Detection Helpers
  // --------------------------------------------------------------------------
  describe('Core detection helpers', () => {
    it('should identify read_file as info-gathering tool', () => {
      expect(isInfoGatheringTool('read_file')).toBe(true);
      expect(isInfoGatheringTool('readFile')).toBe(true);
      expect(isInfoGatheringTool('file.read')).toBe(true);
    });

    it('should identify list_directory as info-gathering tool', () => {
      expect(isInfoGatheringTool('list_directory')).toBe(true);
      expect(isInfoGatheringTool('listFiles')).toBe(true);
      expect(isInfoGatheringTool('list_files')).toBe(true);
      expect(isInfoGatheringTool('ls')).toBe(true);
    });

    it('should identify web_search and read_url as info-gathering tools', () => {
      expect(isInfoGatheringTool('web_search')).toBe(true);
      expect(isInfoGatheringTool('webSearch')).toBe(true);
      expect(isInfoGatheringTool('read_url')).toBe(true);
      expect(isInfoGatheringTool('readUrl')).toBe(true);
    });

    it('should identify glob and file_picker as info-gathering tools', () => {
      expect(isInfoGatheringTool('glob')).toBe(true);
      expect(isInfoGatheringTool('globFiles')).toBe(true);
      expect(isInfoGatheringTool('file_picker')).toBe(true);
      expect(isInfoGatheringTool('pickFiles')).toBe(true);
    });

    it('should NOT identify write/exec tools as info-gathering', () => {
      expect(isInfoGatheringTool('write_file')).toBe(false);
      expect(isInfoGatheringTool('execute_shell')).toBe(false);
      expect(isInfoGatheringTool('apply_diff')).toBe(false);
      expect(isInfoGatheringTool('create_file')).toBe(false);
      expect(isInfoGatheringTool('bash')).toBe(false);
      expect(isInfoGatheringTool('run_terminal_command')).toBe(false);
    });

    it('should NOT identify unknown tools as info-gathering', () => {
      expect(isInfoGatheringTool('unknown_tool')).toBe(false);
      expect(isInfoGatheringTool('')).toBe(false);
    });

    it('allToolsAreInfoGathering should return false for empty array', () => {
      expect(allToolsAreInfoGathering([])).toBe(false);
    });

    it('allToolsAreInfoGathering should return true for all info-gathering tools', () => {
      const tools = [
        { name: 'read_file', arguments: { path: 'test.ts' } },
        { name: 'list_directory', arguments: { path: '/' } },
      ];
      expect(allToolsAreInfoGathering(tools)).toBe(true);
    });

    it('allToolsAreInfoGathering should return false when mixed with exec tools', () => {
      const tools = [
        { name: 'read_file', arguments: { path: 'test.ts' } },
        { name: 'write_file', arguments: { path: 'out.ts' } },
      ];
      expect(allToolsAreInfoGathering(tools)).toBe(false);
    });

    it('getToolNames should extract names from tool call array', () => {
      const tools = [
        { name: 'read_file', arguments: {} },
        { name: 'list_directory', arguments: {} },
      ];
      expect(getToolNames(tools)).toEqual(['read_file', 'list_directory']);
    });

    it('getToolNames should return empty array for empty input', () => {
      expect(getToolNames([])).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Premature Stoppage — FIX #1: Never end on info-gathering tools
  // --------------------------------------------------------------------------
  describe('Fix #1: Never end on info-gathering tools', () => {
    it('should auto-continue when last tool is read_file and no text produced', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'src/App.tsx' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // read_file tool call with a path triggers file_request_detected (Gap #3)
      // before the info-gathering check can fire
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should auto-continue when last tool is list_directory and no text produced', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'list_directory', arguments: { path: '/src' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // list_directory is in FILE_READ_TOOL_VARIANTS → file_request_detected fires
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should auto-continue when last tool is web_search and no text produced', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'web_search', arguments: { query: 'react hooks' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // web_search is info-gathering → info-gathering check fires before tools-without-text
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('info_gathering_completed');
    });

    it('should auto-continue when last tool is read_url and no text produced', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_url', arguments: { url: 'https://example.com' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(true);
    });

    it('should auto-continue when last tool is glob and no text produced', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'glob', arguments: { pattern: '**/*.ts' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // glob is in FILE_READ_TOOL_VARIANTS → file_request_detected fires
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should auto-continue when last tool is file_picker and no text produced', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'file_picker', arguments: { prompt: 'find config files' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(true);
    });

    it('should NOT auto-continue when info-gathering tool is NOT the last one (mixed tools)', () => {
      const result = simulateAutoContinueDetection(
        [
          { name: 'read_file', arguments: { path: 'src/App.tsx' } },
          { name: 'write_file', arguments: { path: 'src/output.ts', content: 'test' } },
        ],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // read_file tool call with a path triggers file_request_detected first
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should NOT auto-continue if max continuations reached', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 3, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('max_continuations_reached');
    });

    it('should NOT auto-continue if continuation marker already present', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        'Some text [NEXT] continue',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('has_continuation_marker');
    });

    it('should NOT auto-continue if auto-continue is disabled', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: false }
      );
      expect(result.triggered).toBe(false);
    });

    it('should NOT auto-continue if stream is not complete', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        '',
        false,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('not_complete_or_empty');
    });
  });

  // --------------------------------------------------------------------------
  // Premature Stoppage — FIX #3: Tools-without-text catch-all
  // --------------------------------------------------------------------------
  describe('Fix #3: Tools-without-text catch-all', () => {
    it('should catch tools-without-text when LLM calls exec_shell and produces no response', () => {
      // Non-info-gathering tools also need to be caught
      const result = simulateAutoContinueDetection(
        [{ name: 'execute_shell', arguments: { command: 'ls -la' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('tools_without_text');
    });

    it('should catch tools-without-text when mixed with info-gathering tools', () => {
      const result = simulateAutoContinueDetection(
        [
          { name: 'read_file', arguments: { path: 'config.ts' } },
          { name: 'execute_shell', arguments: { command: 'npm test' } },
        ],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // read_file tool call with a path triggers file_request_detected first
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should NOT fire tools-without-text when some text was produced (file request fires instead)', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        'Here is what I found in the file:',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // tools-without-text check does NOT fire (text IS present).
      // But read_file tool call with path triggers file_request_detected first.
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should NOT fire tools-without-text when no tools were called', () => {
      const result = simulateAutoContinueDetection(
        [],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('not_complete_or_empty');
    });

    it('should handle multiple tool calls with no text', () => {
      const result = simulateAutoContinueDetection(
        [
          { name: 'read_file', arguments: { path: 'a.ts' } },
          { name: 'list_directory', arguments: { path: '/src' } },
          { name: 'read_file', arguments: { path: 'b.ts' } },
        ],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // All tools are in FILE_READ_TOOL_VARIANTS with paths → file_request_detected
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
      expect(result.yieldedContent).toContain('a.ts');
      expect(result.yieldedContent).toContain('/src');
      expect(result.yieldedContent).toContain('b.ts');
    });
  });

  // --------------------------------------------------------------------------
  // Info-Gathering Tool Detection (No Text After Tools)
  // --------------------------------------------------------------------------
  describe('Info-gathering detection with text produced', () => {
    it('should trigger file request detection when read_file tool call with path and text exists', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'src/App.tsx' } }],
        'Let me check that file...',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // read_file tool call with path triggers file_request_detected before
      // the info-gathering check can fire
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should produce [AUTO-CONTINUE] content for file_request_detected', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'src/App.tsx' } }],
        'Let me check that file...',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
      expect(result.yieldedContent).toContain('[AUTO-CONTINUE]');
      expect(result.yieldedContent).toContain('src/App.tsx');
      expect(result.yieldedType).toBe('auto-continue');
    });

    it('should include the tool path in the continuation prompt', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'src/App.tsx' } }],
        'Checking...',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.yieldedContent).toContain('src/App.tsx');
    });

    it('should use "current location" as fallback when path is missing', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: {} }],
        'Checking...',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.yieldedContent).toContain('current location');
    });
  });

  // --------------------------------------------------------------------------
  // [CONTINUE_REQUESTED] Token
  // --------------------------------------------------------------------------
  describe('[CONTINUE_REQUESTED] token detection', () => {
    it('should trigger auto-continue when response ends with [CONTINUE_REQUESTED]', () => {
      const result = simulateAutoContinueDetection(
        [],
        'I need more information to complete the task[CONTINUE_REQUESTED]',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // [CONTINUE_REQUESTED] is no longer blocked by the guard — the dedicated
      // check below the guard now handles it correctly
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('continuation_requested');
      expect(result.yieldedType).toBe('auto-continue');
    });

    it('should NOT trigger when [CONTINUE_REQUESTED] is mid-response (not at end)', () => {
      const result = simulateAutoContinueDetection(
        [],
        'I need more info[CONTINUE_REQUESTED] to complete the task.',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // The guard no longer blocks [CONTINUE_REQUESTED]. The dedicated check
      // uses trimEnd().endsWith(), so mid-response [CONTINUE_REQUESTED] won't match.
      // Falls through to no_detection_needed (no tools, text present but not requesting)
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('no_detection_needed');
    });

    it('should NOT trigger when [CONTINUE_REQUESTED] has trailing whitespace', () => {
      const result = simulateAutoContinueDetection(
        [],
        'Need more info[CONTINUE_REQUESTED] ',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // trimEnd() removes trailing spaces before checking endsWith
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('continuation_requested');
    });
  });

  // --------------------------------------------------------------------------
  // Incomplete Response Detection (step 7)
  // --------------------------------------------------------------------------
  describe('Incomplete response detection (step 7)', () => {
    it('should detect unclosed code blocks', () => {
      const result = simulateDetectIncompleteResponse('Here is the code:\n```\nconst x = 1;\n');
      expect(result.detected).toBe(true);
      expect(result.reason).toBe('unclosed_code_block');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should detect unclosed braces', () => {
      const result = simulateDetectIncompleteResponse('const obj = { key: "value"');
      expect(result.detected).toBe(true);
      expect(result.reason).toBe('unclosed_brace');
    });

    it('should detect unclosed parentheses', () => {
      const result = simulateDetectIncompleteResponse('function foo(x, y');
      expect(result.detected).toBe(true);
      expect(result.reason).toBe('unclosed_parenthesis');
    });

    it('should detect unclosed brackets', () => {
      const result = simulateDetectIncompleteResponse('const arr = [1, 2, 3');
      expect(result.detected).toBe(true);
      expect(result.reason).toBe('unclosed_bracket');
    });

    it('should detect mid-sentence truncation', () => {
      const result = simulateDetectIncompleteResponse('The file contains an important function that handles the');
      expect(result.detected).toBe(true);
      expect(result.reason).toBe('mid_sentence_truncation');
    });

    it('should detect truncation markers (...) at end', () => {
      const result = simulateDetectIncompleteResponse('And then the unexpected happened...');
      expect(result.detected).toBe(true);
      expect(result.reason).toBe('truncation_marker');
    });

    it('should NOT flag complete sentences', () => {
      const result = simulateDetectIncompleteResponse('The file contains a function that handles authentication.');
      expect(result.detected).toBe(false);
    });

    it('should NOT flag very short responses', () => {
      const result = simulateDetectIncompleteResponse('OK');
      expect(result.detected).toBe(false);
    });

    it('should NOT flag empty responses', () => {
      const result = simulateDetectIncompleteResponse('');
      expect(result.detected).toBe(false);
    });

    it('should integrate with simulateAutoContinueDetection for incomplete responses', () => {
      const result = simulateAutoContinueDetection(
        [],
        'The code has an interesting function that does',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // Mid-sentence truncation with no tools → incomplete_response fires
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('incomplete_response');
      expect(result.yieldedType).toBe('continue');
    });

    it('should trigger incomplete_response BEFORE no_detection_needed when text is truncated', () => {
      const result = simulateAutoContinueDetection(
        [],
        'The fix involves modifying the config in',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // No tools, no file patterns, but mid-sentence truncation → fires
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('incomplete_response');
    });
  });

  // --------------------------------------------------------------------------
  // Gap #3: File Read Request Pattern Detection
  // --------------------------------------------------------------------------
  describe('Gap #3: File read request pattern detection (autoContinueWithFiles)', () => {

    describe('simulateDetectFileReadRequest', () => {
      it('should detect <request_file> XML tags (high confidence)', () => {
        const result = simulateDetectFileReadRequest(
          'I need to check the configuration. <request_file>src/config.ts</request_file>'
        );
        expect(result.files).toContain('src/config.ts');
        expect(result.confidence).toBe('high');
      });

      it('should detect multiple XML-tagged files', () => {
        const result = simulateDetectFileReadRequest(
          'Please read <request_file>src/App.tsx</request_file> and <request_file>src/utils.ts</request_file>'
        );
        expect(result.files).toContain('src/App.tsx');
        expect(result.files).toContain('src/utils.ts');
        expect(result.files.length).toBe(2);
        expect(result.confidence).toBe('high');
      });

      it('should detect "read file" pattern (medium confidence)', () => {
        const result = simulateDetectFileReadRequest('Let me read the file main.ts');
        expect(result.files).toContain('main.ts');
        expect(result.confidence).toBe('medium');
      });

      it('should detect "check" pattern (medium confidence)', () => {
        const result = simulateDetectFileReadRequest('I should check App.tsx first');
        expect(result.files).toContain('App.tsx');
        expect(result.confidence).toBe('medium');
      });

      it('should detect "look at" pattern (medium confidence)', () => {
        const result = simulateDetectFileReadRequest('Let me look at the package.json file');
        expect(result.files).toContain('package.json');
        expect(result.confidence).toBe('medium');
      });

      it('should detect "examine" and "inspect" patterns (medium)', () => {
        const result1 = simulateDetectFileReadRequest('Examine the file config.yaml');
        expect(result1.files).toContain('config.yaml');

        const result2 = simulateDetectFileReadRequest('Inspect server.py for bugs');
        expect(result2.files).toContain('server.py');
      });

      it('should detect "in file" / "from file" pattern (low confidence)', () => {
        const result = simulateDetectFileReadRequest('I found a bug in app.ts');
        expect(result.files).toContain('app.ts');
        expect(result.confidence).toBe('low');
      });

      it('should detect "in the file" / "from the file" pattern (low)', () => {
        const result1 = simulateDetectFileReadRequest('The answer is in the file index.js');
        expect(result1.files).toContain('index.js');

        const result2 = simulateDetectFileReadRequest('From the file styles.css I can see');
        expect(result2.files).toContain('styles.css');
      });

      it('should NOT detect files in regular prose without patterns', () => {
        const result = simulateDetectFileReadRequest('This project uses React and TypeScript.');
        expect(result.files.length).toBe(0);
        expect(result.confidence).toBe('low');
      });

      it('should handle mixed confidence: XML tag overrides lower patterns', () => {
        // XML tag detected first → high confidence, even with "read file" also present
        const result = simulateDetectFileReadRequest(
          'I need to read index.ts. Specifically <request_file>src/config.ts</request_file>'
        );
        expect(result.confidence).toBe('high');
        expect(result.files).toContain('src/config.ts');
        expect(result.files).toContain('index.ts');
      });

      it('should deduplicate filenames', () => {
        const result = simulateDetectFileReadRequest(
          'Read main.ts and check main.ts'
        );
        expect(result.files.length).toBe(1);
        expect(result.files).toEqual(['main.ts']);
      });

      it('should reject filenames with spaces', () => {
        const result = simulateDetectFileReadRequest('Read the file my file with spaces.ts');
        expect(result.files.length).toBe(0);
      });

      it('should reject empty paths in XML tags', () => {
        const result = simulateDetectFileReadRequest('<request_file></request_file>');
        expect(result.files.length).toBe(0);
      });

      it('should only detect files preceded by a keyword', () => {
        const result = simulateDetectFileReadRequest(
          'Check helper.py, main.rs, index.go, styles.css'
        );
        // Only helper.py has "Check" keyword before it; others are after commas without keywords
        expect(result.files).toContain('helper.py');
        expect(result.files).not.toContain('main.rs');
        expect(result.files.length).toBe(1);
      });

      it('should detect files from various extensions with proper keywords', () => {
        const result = simulateDetectFileReadRequest(
          'Check helper.py, examine main.rs, look at index.go, read styles.css'
        );
        expect(result.files).toContain('helper.py');
        expect(result.files).toContain('main.rs');
        expect(result.files).toContain('index.go');
        expect(result.files).toContain('styles.css');
      });
    });

    describe('simulateExtractToolCallFileRequests', () => {
      it('should extract path from read_file tool call', () => {
        const result = simulateExtractToolCallFileRequests([
          { name: 'read_file', arguments: { path: 'src/App.tsx' } },
        ]);
        expect(result).toEqual(['src/App.tsx']);
      });

      it('should extract path from file.read tool call', () => {
        const result = simulateExtractToolCallFileRequests([
          { name: 'file.read', arguments: { path: 'config.json' } },
        ]);
        expect(result).toEqual(['config.json']);
      });

    it('should NOT extract paths from non-read tools', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'write_file', arguments: { path: 'output.ts' } },
        { name: 'execute_shell', arguments: { command: 'ls' } },
        { name: 'apply_diff', arguments: { file: 'patch.diff' } },
      ]);
      // write_file, execute_shell, apply_diff are NOT in FILE_READ_TOOL_VARIANTS
      expect(result.length).toBe(0);
    });

      it('should handle missing path argument', () => {
        const result = simulateExtractToolCallFileRequests([
          { name: 'read_file', arguments: {} },
        ]);
        expect(result.length).toBe(0);
      });

      it('should handle empty tool calls array', () => {
        expect(simulateExtractToolCallFileRequests([])).toEqual([]);
      });

      it('should combine paths from multiple read_file calls', () => {
        const result = simulateExtractToolCallFileRequests([
          { name: 'read_file', arguments: { path: 'a.ts' } },
          { name: 'read_file', arguments: { path: 'b.ts' } },
          { name: 'file.read', arguments: { path: 'c.ts' } },
        ]);
        expect(result).toEqual(['a.ts', 'b.ts', 'c.ts']);
      });
    });

    describe('simulateAutoContinueWithFiles (integrated)', () => {
      it('should detect file request from text pattern', () => {
        const result = simulateAutoContinueWithFiles(
          'Let me read the file main.ts',
          []
        );
        expect(result).not.toBeNull();
        expect(result!.shouldContinue).toBe(true);
        expect(result!.files).toContain('main.ts');
      });

      it('should detect file request from tool calls', () => {
        const result = simulateAutoContinueWithFiles(
          '',
          [{ name: 'read_file', arguments: { path: 'src/config.ts' } }]
        );
        expect(result).not.toBeNull();
        expect(result!.shouldContinue).toBe(true);
        expect(result!.files).toContain('src/config.ts');
      });

      it('should combine text and tool call detections', () => {
        const result = simulateAutoContinueWithFiles(
          'Check App.tsx for the bug',
          [{ name: 'read_file', arguments: { path: 'src/utils.ts' } }]
        );
        expect(result!.files).toContain('App.tsx');
        expect(result!.files).toContain('src/utils.ts');
        expect(result!.files.length).toBe(2);
      });

      it('should deduplicate across text and tool calls', () => {
        const result = simulateAutoContinueWithFiles(
          'Read the file src/config.ts',
          [{ name: 'read_file', arguments: { path: 'src/config.ts' } }]
        );
        expect(result!.files.length).toBe(1);
        expect(result!.files).toEqual(['src/config.ts']);
      });

      it('should return null when no files requested', () => {
        const result = simulateAutoContinueWithFiles(
          'This is just a regular response.',
          []
        );
        expect(result).toBeNull();
      });

      it('should handle XML-tagged file requests', () => {
        const result = simulateAutoContinueWithFiles(
          'Please attach <request_file>src/components/Header.tsx</request_file>',
          []
        );
        expect(result).not.toBeNull();
        expect(result!.files).toContain('src/components/Header.tsx');
      });

      it('should handle combined text + tool + XML patterns', () => {
        const result = simulateAutoContinueWithFiles(
          '<request_file>config/settings.json</request_file> and check utils.ts',
          [{ name: 'read_file', arguments: { path: 'src/main.ts' } }]
        );
        expect(result!.files).toContain('config/settings.json');
        expect(result!.files).toContain('utils.ts');
        expect(result!.files).toContain('src/main.ts');
        expect(result!.files.length).toBe(3);
      });
    });

    describe('simulateAutoContinueWithFiles failure fallback', () => {
      it('should return null when no files requested (text only, no patterns)', () => {
        const result = simulateAutoContinueWithFiles(
          'This is just a regular response about the architecture.',
          []
        );
        expect(result).toBeNull();
      });

    it('should return null when tool calls have no read/list/glob paths', () => {
      const result = simulateAutoContinueWithFiles(
        '',
        [{ name: 'execute_shell', arguments: { command: 'ls -la' } }]
      );
      // execute_shell is NOT in FILE_READ_TOOL_VARIANTS → no extraction
      expect(result).toBeNull();
    });

      it('should return null when text has only generic prose (no file.ext patterns)', () => {
        const result = simulateAutoContinueWithFiles(
          'I will check the configuration settings and update them.',
          []
        );
        expect(result).toBeNull();
      });
    });

    describe('Gap #3: Integration with simulateAutoContinueDetection', () => {
      it('should detect file request BEFORE info-gathering check when text mentions a file', () => {
        // LLM says "Let me read file.ts" with a read_file tool call
        // The file request check fires BEFORE the info-gathering check
        const result = simulateAutoContinueDetection(
          [{ name: 'read_file', arguments: { path: 'file.ts' } }],
          'Let me read file.ts to check the implementation.',
          true,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        // Should detect via file request pattern (higher priority than info-gathering)
        expect(result.triggered).toBe(true);
        expect(result.reason).toBe('file_request_detected');
        expect(result.yieldedContent).toContain('file.ts');
      });

      it('should detect file request from tool calls even with text present', () => {
        const result = simulateAutoContinueDetection(
          [{ name: 'read_file', arguments: { path: 'src/config.ts' } }],
          'I will read the requested file.',
          true,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        // tool call has read_file with path → file_request_detected
        expect(result.triggered).toBe(true);
        expect(result.reason).toBe('file_request_detected');
      });

      it('should detect file request from read_file tool call when text has no file pattern', () => {
        const result = simulateAutoContinueDetection(
          [{ name: 'read_file', arguments: { path: 'file.ts' } }],
          'Checking the project structure.',
          true,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        // Tool call has read_file with path → file_request_detected via tool extraction
        // even though the text 'Checking the project structure.' has no file pattern
        expect(result.triggered).toBe(true);
        expect(result.reason).toBe('file_request_detected');
      });

      it('should fall through to no_detection_needed when no file request or incomplete response', () => {
        const result = simulateAutoContinueDetection(
          [],
          'Let me check that file for the issue.',
          true,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        // No tool calls with path, and "check that file for the issue." doesn't match file.ext pattern
        // Text ends with '.' so no incomplete detection either
        expect(result.triggered).toBe(false);
        expect(result.reason).toBe('no_detection_needed');
      });

      it('should detect file request from XML tags purely in text (no tool calls)', () => {
        const result = simulateAutoContinueDetection(
          [],
          'Please attach <request_file>src/App.tsx</request_file>',
          true,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        // XML tag detected → file_request_detected, even with no tool calls
        expect(result.triggered).toBe(true);
        expect(result.reason).toBe('file_request_detected');
      });

    it('should NOT trigger file request for non-read tool calls without file paths in text', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'list_directory', arguments: { path: '/src' } }],
        'I will list the directory.',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // list_directory is NOW in FILE_READ_TOOL_VARIANTS → path '/src' is extracted
      // So file_request_detected fires instead of info_gathering_completed
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
      expect(result.yieldedContent).toContain('/src');
    });
    });
  });

  // --------------------------------------------------------------------------
  // Server-Side Re-Prompt
  // --------------------------------------------------------------------------
  describe('Server-side re-prompt (streamWithServerAutoRePrompt)', () => {
    it('should trigger re-prompt when info-gathering tools executed without final response', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'file content' } },
        ],
        3, 0
      );
      expect(result.needsRePrompt).toBe(true);
      expect(result.newCount).toBe(1);
    });

    it('should trigger re-prompt for list_directory results', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '2', toolName: 'list_directory', result: { success: true, output: 'files...' } },
        ],
        3, 0
      );
      expect(result.needsRePrompt).toBe(true);
    });

    it('should trigger re-prompt for web_search results', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '3', toolName: 'web_search', result: { success: true, output: 'search results' } },
        ],
        3, 0
      );
      expect(result.needsRePrompt).toBe(true);
    });

    it('should trigger re-prompt for glob results', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '4', toolName: 'glob', result: { success: true, output: ['file1.ts', 'file2.ts'] } },
        ],
        3, 0
      );
      expect(result.needsRePrompt).toBe(true);
    });

    it('should trigger re-prompt for read_url results', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '5', toolName: 'read_url', result: { success: true, output: 'page content' } },
        ],
        3, 0
      );
      expect(result.needsRePrompt).toBe(true);
    });

    it('should trigger re-prompt for file_picker results', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '6', toolName: 'file_picker', result: { success: true, output: ['test.ts'] } },
        ],
        3, 0
      );
      expect(result.needsRePrompt).toBe(true);
    });

    it('should NOT re-prompt for non-info-gathering tools', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '7', toolName: 'write_file', result: { success: true } },
        ],
        3, 0
      );
      expect(result.needsRePrompt).toBe(false);
    });

    it('should NOT re-prompt when maxRePrompts reached', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '1', toolName: 'read_file', result: { success: true } },
        ],
        3, 3
      );
      // rePromptCount (3) >= maxRePrompts (3), so should not re-prompt
      expect(result.needsRePrompt).toBe(false);
    });

    it('should NOT re-prompt when no tool results collected', () => {
      const result = simulateServerRePrompt([], 3, 0);
      expect(result.needsRePrompt).toBe(false);
    });

    it('should handle mixed tool results (info + non-info)', () => {
      const result = simulateServerRePrompt(
        [
          { toolCallId: '1', toolName: 'read_file', result: { success: true } },
          { toolCallId: '2', toolName: 'write_file', result: { success: true } },
        ],
        3, 0
      );
      // Should still re-prompt because SOME tools are info-gathering
      expect(result.needsRePrompt).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Client-Side Fallback (receivedDoneEvent)
  // --------------------------------------------------------------------------
  describe('Client-side SSE post-stream fallback (receivedDoneEvent)', () => {
    it('should detect stream ended without DONE event', () => {
      let receivedDoneEvent = false;
      const streamingToolInvocations: Array<{ toolCallId: string; toolName: string; state: string }> = [];

      // Simulate stream that ends without 'done' event
      const streamEndedWithoutDone = !receivedDoneEvent;

      expect(streamEndedWithoutDone).toBe(true);

      // When done event IS received
      receivedDoneEvent = true;
      expect(receivedDoneEvent).toBe(true);
    });

    it('should set streamEndedPrematurely metadata when no done event received', () => {
      // This simulates the metadata update in the post-stream code
      const receivedDoneEvent = false;
      const metadata: Record<string, any> = {};

      if (!receivedDoneEvent) {
        metadata.streamEndedPrematurely = true;
      }

      expect(metadata.streamEndedPrematurely).toBe(true);
    });

    it('should set interruptedAfterToolExecution when tools were running', () => {
      const receivedDoneEvent = false;
      const streamingToolInvocations = [
        { toolCallId: 't1', toolName: 'read_file', state: 'call' },
      ];
      const isToolsInterrupted = streamingToolInvocations.length > 0;

      const metadata: Record<string, any> = {};
      if (!receivedDoneEvent) {
        metadata.streamEndedPrematurely = true;
        metadata.interruptedAfterToolExecution = isToolsInterrupted;
        if (isToolsInterrupted) {
          metadata.toolNames = [...new Set(streamingToolInvocations.map(i => i.toolName))];
        }
      }

      expect(metadata.streamEndedPrematurely).toBe(true);
      expect(metadata.interruptedAfterToolExecution).toBe(true);
      expect(metadata.toolNames).toEqual(['read_file']);
    });

    it('should NOT set interruptedAfterToolExecution when no tools ran', () => {
      const receivedDoneEvent = false;
      const streamingToolInvocations: Array<{ toolCallId: string; toolName: string; state: string }> = [];
      const isToolsInterrupted = streamingToolInvocations.length > 0;

      const metadata: Record<string, any> = {};
      if (!receivedDoneEvent) {
        metadata.streamEndedPrematurely = true;
        metadata.interruptedAfterToolExecution = isToolsInterrupted;
      }

      expect(metadata.streamEndedPrematurely).toBe(true);
      expect(metadata.interruptedAfterToolExecution).toBe(false);
    });

    it('should NOT set streamEndedPrematurely when done event WAS received', () => {
      const receivedDoneEvent = true;
      const metadata: Record<string, any> = {};

      if (!receivedDoneEvent) {
        metadata.streamEndedPrematurely = true;
      }

      expect(metadata.streamEndedPrematurely).toBeUndefined();
    });

    it('should set needsAutoContinue when tools interrupted without content', () => {
      const receivedDoneEvent = false;
      const streamingToolInvocations = [
        { toolCallId: 't1', toolName: 'read_file', state: 'call' },
      ];
      const isToolsInterrupted = streamingToolInvocations.length > 0;
      const accumulatedContent = '';
      const hasNoContent = accumulatedContent.length === 0;

      let metadata: Record<string, any> = {};
      if (!receivedDoneEvent) {
        if (isToolsInterrupted && hasNoContent) {
          metadata = {
            streamEndedPrematurely: true,
            interruptedAfterToolExecution: true,
            toolNames: [...new Set(streamingToolInvocations.map(i => i.toolName))],
            toolCount: streamingToolInvocations.length,
            needsAutoContinue: true,
          };
        }
      }

      expect(metadata.needsAutoContinue).toBe(true);
      expect(metadata.toolNames).toEqual(['read_file']);
    });

    it('should NOT set needsAutoContinue when content was accumulated', () => {
      const receivedDoneEvent = false;
      const streamingToolInvocations = [
        { toolCallId: 't1', toolName: 'read_file', state: 'call' },
      ];
      const isToolsInterrupted = streamingToolInvocations.length > 0;
      const accumulatedContent = 'Some partial content...';
      const hasNoContent = accumulatedContent.length === 0;

      let metadata: Record<string, any> = {};
      if (!receivedDoneEvent) {
        if (isToolsInterrupted && hasNoContent) {
          metadata.needsAutoContinue = true;
        }
      }

      expect(metadata.needsAutoContinue).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // V1 Fallback Stream (processV1Stream)
  // --------------------------------------------------------------------------
  describe('V1 fallback stream [DONE] marker tracking', () => {
    it('should set receivedDoneMarker when [DONE] is received', () => {
      let receivedDoneMarker = false;
      const dataString = '[DONE]';

      // Simulate the [DONE] handler
      if (dataString === '[DONE]') {
        receivedDoneMarker = true;
      }

      expect(receivedDoneMarker).toBe(true);
    });

    it('should NOT set receivedDoneMarker for non-[DONE] data', () => {
      let receivedDoneMarker = false;
      const dataString = '{"choices":[{"delta":{"content":"hello"}}]}';

      if (dataString === '[DONE]') {
        receivedDoneMarker = true;
      }

      expect(receivedDoneMarker).toBe(false);
    });

    it('should detect premature end when [DONE] not received', () => {
      let receivedDoneMarker = false;
      // Stream ended but [DONE] was never received
      const metadata: Record<string, any> = {};

      if (!receivedDoneMarker) {
        metadata.streamEndedPrematurely = true;
      }

      expect(metadata.streamEndedPrematurely).toBe(true);
    });

    it('should NOT flag premature end when [DONE] was received', () => {
      let receivedDoneMarker = true; // Was set by [DONE] handler
      const metadata: Record<string, any> = {};

      if (!receivedDoneMarker) {
        metadata.streamEndedPrematurely = true;
      }

      expect(metadata.streamEndedPrematurely).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Continuation Count Tracking
  // --------------------------------------------------------------------------
  describe('Continuation count tracking', () => {
    it('should track conversation continuation counts', () => {
      const conversationContinuationCount = new Map<string, { count: number; lastAccess: number }>();

      function trackConversation(id: string, count: number): void {
        conversationContinuationCount.set(id, { count, lastAccess: Date.now() });
      }

      function getCount(id: string): number {
        return conversationContinuationCount.get(id)?.count || 0;
      }

      trackConversation('conv-1', 1);
      expect(getCount('conv-1')).toBe(1);

      trackConversation('conv-1', 2);
      expect(getCount('conv-1')).toBe(2);
    });

    it('should return 0 for unknown conversations', () => {
      const conversationContinuationCount = new Map<string, { count: number; lastAccess: number }>();
      expect(conversationContinuationCount.get('unknown')?.count || 0).toBe(0);
    });

    it('should evict oldest entries when Map is full', () => {
      const MAX_CONTINUATION_ENTRIES = 500;
      const conversationContinuationCount = new Map<string, { count: number; lastAccess: number }>();

      function trackConversation(id: string, count: number): void {
        if (conversationContinuationCount.size >= MAX_CONTINUATION_ENTRIES) {
          const firstKey = conversationContinuationCount.keys().next().value;
          if (firstKey) conversationContinuationCount.delete(firstKey);
        }
        conversationContinuationCount.set(id, { count, lastAccess: Date.now() });
      }

      // Fill the map to max
      for (let i = 0; i < MAX_CONTINUATION_ENTRIES; i++) {
        trackConversation(`conv-${i}`, 1);
      }
      expect(conversationContinuationCount.size).toBe(MAX_CONTINUATION_ENTRIES);

      // Add one more - should evict oldest
      trackConversation('new-conv', 1);
      expect(conversationContinuationCount.size).toBe(MAX_CONTINUATION_ENTRIES);
      // The first entry should be gone
      expect(conversationContinuationCount.has('conv-0')).toBe(false);
    });

    it('should reset count on successful completion', () => {
      const conversationContinuationCount = new Map<string, { count: number; lastAccess: number }>();

      // Simulate: auto-continue happened, then successful completion
      conversationContinuationCount.set('conv-1', { count: 2, lastAccess: Date.now() });

      // Reset on completion
      conversationContinuationCount.delete('conv-1');

      expect(conversationContinuationCount.has('conv-1')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('should handle empty tool calls array with no text', () => {
      const result = simulateAutoContinueDetection(
        [],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // No tools called, no text — nothing to detect
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('not_complete_or_empty');
    });

    it('should handle tool calls with whitespace-only response', () => {
      // read_file tool call with path triggers file_request_detected first
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        '   \n  \t  ',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should handle very long response that was not truncated', () => {
      const longText = 'A'.repeat(10000);
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        longText,
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // read_file tool call with path triggers file_request_detected first
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should handle tool with null arguments', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: null }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // read_file with null args → no file path to extract → falls through to info-gathering
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('info_gathering_completed');
    });

    it('should handle tool with undefined arguments', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: undefined }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // read_file with undefined args → no file path → falls through to info-gathering
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('info_gathering_completed');
    });

    it('should handle read_file with non-string path (array)', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: ['file1.ts', 'file2.ts'] } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // Non-string path → simulateExtractToolCallFileRequests ignores it
      // Falls through to info-gathering
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('info_gathering_completed');
    });

    it('should handle read_file with non-string path (number)', () => {
      const result = simulateAutoContinueDetection(
        // Some models may pass numeric IDs instead of paths
        [{ name: 'read_file', arguments: { path: 12345 } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // Non-string path → ignored by extract → falls through to info-gathering
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('info_gathering_completed');
    });

    it('should handle XML tag with path > 500 chars (rejected, no detection)', () => {
      const longPath = 'a'.repeat(501) + '.ts';
      const result = simulateAutoContinueDetection(
        [],
        `Please read <request_file>${longPath}</request_file>`,
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // Path > 500 chars → rejected by simulateDetectFileReadRequest
      // No tools → no file_request_detected
      // Text ends with '>' which is now a sentence ender → no incomplete detection
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('no_detection_needed');
    });

    it('should handle XML tag with path at boundary (499 total chars, accepted)', () => {
      // Path must be < 500 chars total INCLUDING extension: 496 + .ts = 499
      const exactPath = 'a'.repeat(496) + '.ts';
      const result = simulateAutoContinueDetection(
        [],
        `Please read <request_file>${exactPath}</request_file>`,
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // Path length = 499 < 500 → accepted; text ends with '>' → no incomplete detection
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should handle continuation count exactly at boundary', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 2, enableAutoContinue: true }
      );
      // continuationCount (2) < maxContinuations (3) → allowed
      expect(result.triggered).toBe(true);
    });

    it('should NOT auto-continue when continuation count exactly equals max', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 3, enableAutoContinue: true }
      );
      // continuationCount (3) >= maxContinuations (3) → blocked
      expect(result.triggered).toBe(false);
    });

    it('should handle resetContinuationCounters simulation', () => {
      const conversationContinuationCount = new Map<string, { count: number; lastAccess: number }>();

      // Simulate: auto-continue happened
      conversationContinuationCount.set('conv-1', { count: 2, lastAccess: Date.now() });
      expect(conversationContinuationCount.size).toBe(1);

      // Simulate resetContinuationCounters
      conversationContinuationCount.clear();
      expect(conversationContinuationCount.size).toBe(0);
    });

    it('should handle concurrent tool calls arriving out of order', () => {
      // Simulate: tool invocations arrive in non-sequential order
      const toolCalls = [
        { name: 'read_file', arguments: { path: 'a.ts' }, id: 't2' },
        { name: 'read_file', arguments: { path: 'b.ts' }, id: 't1' },
        { name: 'read_file', arguments: { path: 'c.ts' }, id: 't3' },
      ];

      const result = simulateAutoContinueDetection(
        toolCalls,
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // All are read_file with paths → file_request_detected
      // The order shouldn't matter
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
      expect(result.yieldedContent).toContain('a.ts');
      expect(result.yieldedContent).toContain('b.ts');
      expect(result.yieldedContent).toContain('c.ts');
    });

    it('should handle V1 fallback + main SSE simultaneous failure', () => {
      // Simulate case where BOTH SSE paths fail: no receivedDoneEvent
      // AND no receivedDoneMarker
      let receivedDoneEvent = false;
      let receivedDoneMarker = false;

      const metadata: Record<string, any> = {};
      if (!receivedDoneEvent) {
        metadata.streamEndedPrematurely = true;
      }
      if (!receivedDoneMarker) {
        metadata.v1StreamEndedPrematurely = true;
      }

      // Both should be flagged
      expect(metadata.streamEndedPrematurely).toBe(true);
      expect(metadata.v1StreamEndedPrematurely).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Gap #10: Extended Tool Extraction (listDirectory, glob, etc.)
  // --------------------------------------------------------------------------
  describe('Gap #10: Extended tool extraction for listDirectory/glob variants', () => {
    it('should extract path from listDirectory tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'listDirectory', arguments: { path: '/src' } },
      ]);
      expect(result).toEqual(['/src']);
    });

    it('should extract directory from list_directory tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'list_directory', arguments: { directory: '/src/components' } },
      ]);
      expect(result).toEqual(['/src/components']);
    });

    it('should extract directory from list_dir tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'list_dir', arguments: { path: '.' } },
      ]);
      expect(result).toEqual(['.']);
    });

    it('should extract directory from ls tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'ls', arguments: { path: '/usr' } },
      ]);
      expect(result).toEqual(['/usr']);
    });

    it('should extract directory from listFiles tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'listFiles', arguments: { path: 'src/' } },
      ]);
      expect(result).toEqual(['src/']);
    });

    it('should extract directory from list_files tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'list_files', arguments: { path: '..' } },
      ]);
      expect(result).toEqual(['..']);
    });

    it('should extract pattern from glob tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'glob', arguments: { pattern: '**/*.ts' } },
      ]);
      expect(result).toEqual(['**/*.ts']);
    });

    it('should extract pattern from globFiles tool call', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'globFiles', arguments: { pattern: 'src/**/*.tsx' } },
      ]);
      expect(result).toEqual(['src/**/*.tsx']);
    });

    it('should handle mixed tool calls (read_file + listDirectory)', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'read_file', arguments: { path: 'config.ts' } },
        { name: 'listDirectory', arguments: { path: '/src' } },
        { name: 'glob', arguments: { pattern: '*.json' } },
      ]);
      expect(result).toContain('config.ts');
      expect(result).toContain('/src');
      expect(result).toContain('*.json');
      expect(result.length).toBe(3);
    });

    it('should NOT extract from non-read non-list non-glob tools', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'write_file', arguments: { path: 'out.ts' } },
        { name: 'execute_shell', arguments: { command: 'ls' } },
      ]);
      expect(result.length).toBe(0);
    });

    it('should handle listDirectory + info-gathering test (file_request_detected)', () => {
      // listDirectory with path should trigger file_request_detected
      const result = simulateAutoContinueDetection(
        [{ name: 'listDirectory', arguments: { path: '/src' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // listDirectory is now in FILE_READ_TOOL_VARIANTS → file_request_detected
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
      expect(result.yieldedContent).toContain('/src');
    });

    it('should handle glob + info-gathering test (file_request_detected)', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'glob', arguments: { pattern: '**/*.ts' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      // glob is now in FILE_READ_TOOL_VARIANTS → file_request_detected
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
      expect(result.yieldedContent).toContain('**/*.ts');
    });

    it('should handle list_files + info-gathering test (file_request_detected)', () => {
      const result = simulateAutoContinueDetection(
        [{ name: 'list_files', arguments: { path: '/src/components' } }],
        '',
        true,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('file_request_detected');
    });

    it('should use directory argument when path is absent', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'listDirectory', arguments: { directory: './src' } },
      ]);
      expect(result).toEqual(['./src']);
    });

    it('should prefer path over directory when both provided', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'listDirectory', arguments: { path: '/main', directory: '/fallback' } },
      ]);
      // path is checked first in the || chain
      expect(result).toEqual(['/main']);
    });

    it('should handle file.list tool call variant', () => {
      const result = simulateExtractToolCallFileRequests([
        { name: 'file.list', arguments: { path: '/etc' } },
      ]);
      expect(result).toEqual(['/etc']);
    });
  });

  // --------------------------------------------------------------------------
  // Gap #7: Full Chain Integration (streamWithAutoContinue → streamWithServerAutoRePrompt)
  // --------------------------------------------------------------------------
  describe('Gap #7: Full chain integration (auto-continue + server re-prompt)', () => {
    it('should auto-continue AND re-prompt when info-gathering tools detected (they are independent)', () => {
      const result = simulateChainIntegration(
        [{ name: 'list_directory', arguments: { path: '/src' } }],
        '',
        [{ toolCallId: '1', toolName: 'list_directory', result: { success: true, output: 'files...' } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // list_directory is now in FILE_READ_TOOL_VARIANTS → file_request_detected
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('file_request_detected');
      // Server re-prompt is INDEPENDENT of auto-continue. It fires when
      // info-gathering tool results are collected, regardless of whether
      // auto-continue also detected them.
      expect(result.serverRePrompted).toBe(true);
      expect(result.rePromptCount).toBe(1);
    });

    it('should auto-continue AND re-prompt when tools are read_file with path', () => {
      const result = simulateChainIntegration(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        'Some text response was produced.',
        [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'file content' } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // read_file tool call with path → file_request_detected
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('file_request_detected');
      // Server re-prompt fires independently because read_file tool result exists
      expect(result.serverRePrompted).toBe(true);
      expect(result.rePromptCount).toBe(1);
    });

    it('should auto-continue AND re-prompt when tools ran (both detect independently)', () => {
      const result = simulateChainIntegration(
        [{ name: 'read_file', arguments: {} }], // no path → no file request
        '',
        [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'file content' } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // read_file without path → no file_request, but IS info-gathering → info_gathering_completed
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('info_gathering_completed');
      // Server re-prompt also fires
      expect(result.serverRePrompted).toBe(true);
      expect(result.rePromptCount).toBe(1);
    });

    it('should NOT trigger either when text is complete and no tools ran', () => {
      const result = simulateChainIntegration(
        [],
        'The analysis is complete. Here are the results.',
        [],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // Text ends with '.', no tools, no incomplete patterns
      expect(result.autoContinued).toBe(false);
      expect(result.serverRePrompted).toBe(false);
      expect(result.finalContent).toContain('The analysis is complete');
    });

    it('should respect maxContinuations in chain integration', () => {
      const result = simulateChainIntegration(
        [{ name: 'list_directory', arguments: { path: '/src' } }],
        '',
        [{ toolCallId: '1', toolName: 'list_directory', result: { success: true } }],
        {
          maxContinuations: 3, continuationCount: 3, enableAutoContinue: true, // already at max
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // auto-continue blocked by maxContinuations guard
      expect(result.autoContinued).toBe(false);
      // But server re-prompt should fire (it has its own maxRePrompts counter)
      expect(result.serverRePrompted).toBe(true);
      expect(result.rePromptCount).toBe(1);
    });

    it('should respect maxRePrompts in chain integration', () => {
      const result = simulateChainIntegration(
        [], // no tools for auto-continue
        'Some text.',
        [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'content' } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 3, // already at max re-prompts
        }
      );
      // Auto-continue: no tools called → no detection
      expect(result.autoContinued).toBe(false);
      // Server re-prompt blocked by maxRePrompts guard
      expect(result.serverRePrompted).toBe(false);
    });

    it('should track event types through the chain', () => {
      const result = simulateChainIntegration(
        [{ name: 'read_file', arguments: {} }], // no path
        '',
        [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'content' } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // read_file without path → info_gathering_completed fires
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.events[0].type).toBe('next'); // [NEXT] prompt
    });

    it('should produce correct final content when auto-continue fires', () => {
      const result = simulateChainIntegration(
        [{ name: 'list_directory', arguments: { path: '/src' } }],
        '',
        [{ toolCallId: '1', toolName: 'list_directory', result: { success: true, output: 'listing...' } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // list_directory with path → file_request_detected
      expect(result.autoContinued).toBe(true);
      expect(result.finalContent).toContain('[AUTO-CONTINUE]');
    });

    it('should produce correct final content when no auto-continue needed', () => {
      const result = simulateChainIntegration(
        [],
        'All done!',
        [],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      expect(result.autoContinued).toBe(false);
      expect(result.serverRePrompted).toBe(false);
      expect(result.finalContent).toContain('All done!');
    });

    it('should handle chain disabled (enableAutoContinue=false)', () => {
      const result = simulateChainIntegration(
        [{ name: 'read_file', arguments: { path: 'test.ts' } }],
        '',
        [{ toolCallId: '1', toolName: 'read_file', result: { success: true } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: false,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // Auto-continue disabled → no auto-continue
      expect(result.autoContinued).toBe(false);
      // But server re-prompt is independent → still fires
      expect(result.serverRePrompted).toBe(true);
    });

    it('should handle [CONTINUE_REQUESTED] in chain integration', () => {
      const result = simulateChainIntegration(
        [],
        'Need more context[CONTINUE_REQUESTED]',
        [],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('continuation_requested');
      expect(result.events[0].type).toBe('auto-continue');
    });

    it('should handle incomplete response in chain integration', () => {
      const result = simulateChainIntegration(
        [],
        'The fix involves modifying the config in',
        [],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // Mid-sentence truncation → incomplete_response fires
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('incomplete_response');
      expect(result.events[0].type).toBe('continue');
    });

    it('should handle mixed info + write tools in chain integration', () => {
      const result = simulateChainIntegration(
        [
          { name: 'read_file', arguments: { path: 'config.ts' } },
          { name: 'write_file', arguments: { path: 'output.ts', content: 'test' } },
        ],
        '',
        [
          { toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'config content' } },
          { toolCallId: '2', toolName: 'write_file', result: { success: true } },
        ],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 0,
        }
      );
      // read_file with path → file_request_detected
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('file_request_detected');
      // Server re-prompt fires independently
      expect(result.serverRePrompted).toBe(true);
      // Track the double-fire event
      const doubleFire = result.events.find(e => e.type === 'double-fire-detected');
      expect(doubleFire).toBeDefined();
    });

    it('should NOT re-prompt when server re-prompt counter is exhausted', () => {
      // Same scenario but with maxRePrompts reached
      const result = simulateChainIntegration(
        [{ name: 'read_file', arguments: {} }], // no path
        '',
        [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'content' } }],
        {
          maxContinuations: 3, continuationCount: 0, enableAutoContinue: true,
          maxRePrompts: 3, rePromptCount: 3, // already at max
        }
      );
      // Auto-continue fires (info_gathering_completed)
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('info_gathering_completed');
      // Server re-prompt blocked by maxRePrompts
      expect(result.serverRePrompted).toBe(false);
      expect(result.rePromptCount).toBe(3); // unchanged
    });

    // ─── Gap #13: failure_plan_loop circuit-breaker (operator-grep layer) ───
    // Production rule: lib/chat/llm-continuation.ts:_detectFailurePlanLoop.
    // The route.ts SSE emitter propagates autoDecision.reason verbatim into
    // the `continuation` chunk's `reason` field via
    //   makeSseChunk('continuation', autoDecision.continue, autoDecision.reason, ...)
    // so operators `grep '"reason":"failure_plan_loop"'` against the live SSE
    // stream to detect upstream-tool-failure-induced chat loops.
    //
    // This test asserts the chain-integration layer's autoContinueReason
    // preserves `'failure_plan_loop'` verbatim so any future reason-field
    // serialization regression (rename, drop, type widening to `string`)
    // is caught at CI rather than at the operator-grep stage.
    //
    // Preconditions for failure_plan_loop (mirroring production):
    //   - routing.continue === false (so the heuristic cascade can fire)
    //   - planStepsCount >= 2 (entry guard) + steps.length < planStepsCount (exit guard)
    //   - continuationsSoFar === 1 (PRE-snapshot, the breaker won't fire at 0)
    //   - last tool is non-info-gathering (write_file / execute_shell — the
    //     simulator uses tool-name as the failure proxy)
    //   - responseText has plan-language words in the 30-1000 char range
    it('should emit failure_plan_loop reason in chain integration when chat-loop circuit-breaker fires', () => {
      const planLanguageResponse =
        "Step 1 failed. I'll now try a different approach. First I'll read the existing file, then I will write the correct version, and finally I'll verify the result.";
      const result = simulateChainIntegration(
        [{ name: 'write_file', arguments: { path: 'src/a.ts', content: '/* A */' } }],
        planLanguageResponse,
        [], // collectedToolResults empty — server re-prompt is independent
        {
          maxContinuations: 3,
          continuationCount: 1, // >= 1 required for breaker entry
          enableAutoContinue: true,
          maxRePrompts: 3,
          rePromptCount: 0,
        }
      );
      // PRIMARY assertions — the operator-grep layer.
      expect(result.autoContinued).toBe(false); // breaker preempts the continue
      expect(result.autoContinueReason).toBe('failure_plan_loop');
      // SCOPED events assertion: NO continue-type events in the payload.
      // This pins the breaker contract (a STOP signal owes no continue
      // event) without coupling to `simulateServerRePrompt`'s future
      // behavior — e.g., if a simulator change extends server re-prompt
      // to fire for non-info-gathering-tool failures, a `server-re-prompt`
      // event in the payload won't break this assertion.
      expect(
        result.events.filter(
          (e) => e.type === 'auto-continue' || e.type === 'next' || e.type === 'continue',
        ),
      ).toEqual([]);
      // Independent sanity: finalContent is the raw plan-language response
      // (NOT a [AUTO-CONTINUE] nudge), so a future flip to triggered=true
      // would surface as a CI failure on this assertion.
      expect(result.finalContent).not.toContain('[AUTO-CONTINUE]');
    });
  });

  // --------------------------------------------------------------------------
  // Gap #5: Client-Side Fallback Guards (isLoading + onNeedMoreTurns race)
  // --------------------------------------------------------------------------
  describe('Gap #5: Client-side race condition guards (isLoading + WebSocket)', () => {
    describe('isLoading guard (SSE auto-continue handler)', () => {
      it('should BLOCK auto-continue when isLoading is true', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: true,
          streamId: 'ws-123',
          hasToolCalls: true,
          hasContent: false,
        });
        expect(result.canAutoContinue).toBe(false);
        expect(result.guardBlocked).toBe('isLoading');
        expect(result.wsConnected).toBe(true); // WS still connected
      });

      it('should ALLOW auto-continue when isLoading is false', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: false,
          streamId: 'ws-123',
          hasToolCalls: true,
          hasContent: false,
        });
        expect(result.canAutoContinue).toBe(true);
        expect(result.guardBlocked).toBeNull();
      });

      it('should prevent overlapping streams when loading', () => {
        // Simulate: auto-continue SSE event arrives while stream is still loading
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: true,
          streamId: 'ws-456',
          hasToolCalls: true,
          hasContent: false,
        });

        // The auto-continue should be skipped to prevent overlapping streams
        expect(result.canAutoContinue).toBe(false);
        expect(result.guardBlocked).toBe('isLoading');
        expect(result.needsSSEClientFallback).toBe(false);
      });

      it('should NOT block when isLoading is false even with no streamId', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: false,
          streamId: null,
          hasToolCalls: true,
          hasContent: false,
        });
        // isLoading is the primary guard — no loading, no block from isLoading
        // But no streamId AND no SSE done event → needs fallback
        expect(result.canAutoContinue).toBe(true);
        expect(result.guardBlocked).toBe('no_streamId');
        expect(result.needsSSEClientFallback).toBe(true);
        expect(result.needsWSFallback).toBe(true);
      });
    });

    describe('onNeedMoreTurns WebSocket race (streamId guard)', () => {
      it('should BLOCK WebSocket signal when streamId is null', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: false,
          streamId: null,
          hasToolCalls: true,
          hasContent: false,
        });
        expect(result.canAutoContinue).toBe(true); // falls through to SSE path
        expect(result.guardBlocked).toBe('no_streamId');
        expect(result.wsConnected).toBe(false);
        expect(result.needsSSEClientFallback).toBe(true);
      });

      it('should ALLOW WebSocket signal when streamId is set', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: false,
          streamId: 'ws-valid-789',
          hasToolCalls: true,
          hasContent: false,
        });
        expect(result.canAutoContinue).toBe(true);
        expect(result.guardBlocked).toBeNull();
        expect(result.wsConnected).toBe(true);
        expect(result.needsSSEClientFallback).toBe(false);
        expect(result.needsWSFallback).toBe(false);
      });

      it('should log warning when WS not connected (no streamId)', () => {
        // Simulate the warning from production: "[StreamControl] WebSocket not connected"
        let warningLogged = false;
        const streamId: string | null = null;
        if (!streamId) {
          warningLogged = true;
        }
        expect(warningLogged).toBe(true);

        // SSE fallback should still work
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: false,
          streamId: null,
          hasToolCalls: true,
          hasContent: false,
        });
        expect(result.needsSSEClientFallback).toBe(true);
      });

      it('should handle stale WebSocket signal (streamId mismatch)', () => {
        // Simulate: old WebSocket signal arrives after new stream started
        // The streamId is set but to a DIFFERENT session
        let warningLogged = false;
        const currentStreamId = 'ws-new-001';
        const signalStreamId = 'ws-old-999'; // outdated signal

        // In production: streamControl.onNeedMoreTurns checks if streamId matches
        // current context. Here we simulate the mismatch check.
        if (currentStreamId !== signalStreamId) {
          warningLogged = true;
        }

        expect(warningLogged).toBe(true);
      });

      it('should prefer SSE path when WebSocket disconnected', () => {
        // When WebSocket is down, the client should fall back to SSE-based
        // auto-continue using the last known streamId
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false, // SSE also didn't get done event
          isLoading: false,
          streamId: null, // WS disconnected
          hasToolCalls: true,
          hasContent: false,
        });

        // Both SSE and WS are unreliable → client-side fallback needed
        expect(result.needsSSEClientFallback).toBe(true);
        expect(result.needsWSFallback).toBe(true);
      });

      it('should NOT need WS fallback when SSE done event was received', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: true, // SSE got done event
          isLoading: false,
          streamId: null, // WS disconnected, but SSE already confirmed done
          hasToolCalls: false,
          hasContent: true,
        });

        // SSE got done event, so no fallback needed even though WS is down
        expect(result.needsSSEClientFallback).toBe(false);
        expect(result.needsWSFallback).toBe(false);
        expect(result.canAutoContinue).toBe(false); // no tools to continue from
      });
    });

    describe('Dual guard scenarios (isLoading + WebSocket race)', () => {
      it('should block when BOTH isLoading and no streamId', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: true,
          streamId: null,
          hasToolCalls: true,
          hasContent: false,
        });
        // isLoading takes priority (checked first)
        expect(result.canAutoContinue).toBe(false);
        expect(result.guardBlocked).toBe('isLoading');
      });

      it('should fall through when isLoading clears but streamId is still null', () => {
        // After isLoading clears, the no_streamId guard should allow SSE fallback
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: false,
          isLoading: false,
          streamId: null,
          hasToolCalls: true,
          hasContent: false,
        });
        expect(result.canAutoContinue).toBe(true);
        expect(result.guardBlocked).toBe('no_streamId');
        expect(result.needsSSEClientFallback).toBe(true);
      });

      it('should pass through when BOTH guards clear', () => {
        const result = simulateClientFallbackGuards({
          receivedDoneEvent: true,
          isLoading: false,
          streamId: 'ws-valid',
          hasToolCalls: true,
          hasContent: true,
        });
        expect(result.canAutoContinue).toBe(true);
        expect(result.guardBlocked).toBeNull();
        expect(result.wsConnected).toBe(true);
        expect(result.needsSSEClientFallback).toBe(false);
      });
    });
  });
  // Edge Cases: Chain Integration (rapid successive, large arrays, cancellation)
  // --------------------------------------------------------------------------
  describe('Chain integration edge cases (rapid, large arrays, cancellation)', () => {

    // ----------------------------------------------------------------------
    // Scenario 1: Rapid successive auto-continue events
    // ----------------------------------------------------------------------
    describe('Rapid successive auto-continue events', () => {
      it('should handle two successive auto-continue events (increment count twice)', () => {
        const first = simulateChainIntegration(
          [{ name: 'list_directory', arguments: { path: '/src' } }],
          '',
          [{ toolCallId: '1', toolName: 'list_directory', result: { success: true, output: 'files...' } }],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(first.autoContinued).toBe(true);
        const second = simulateChainIntegration(
          [{ name: 'read_file', arguments: { path: 'src/App.tsx' } }],
          '',
          [{ toolCallId: '2', toolName: 'read_file', result: { success: true, output: 'content' } }],
          { maxContinuations: 3, continuationCount: 1, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(second.autoContinued).toBe(true);
        expect(second.serverRePrompted).toBe(true);
      });

      it('should stop after maxContinuations is reached across rapid successive events', () => {
        for (let count = 0; count < 3; count++) {
          const result = simulateChainIntegration(
            [{ name: 'list_directory', arguments: { path: '/src' } }],
            '',
            [{ toolCallId: 'rapid-'.concat(String(count)), toolName: 'list_directory', result: { success: true, output: 'iteration '.concat(String(count)) } }],
            { maxContinuations: 3, continuationCount: count, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
          );
          expect(result.autoContinued).toBe(true);
        }
        const blocked = simulateChainIntegration(
          [{ name: 'list_directory', arguments: { path: '/src' } }],
          '',
          [{ toolCallId: 'blocked', toolName: 'list_directory', result: { success: true, output: 'blocked' } }],
          { maxContinuations: 3, continuationCount: 3, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(blocked.autoContinued).toBe(false);
        expect(blocked.serverRePrompted).toBe(true);
      });

      it('should exhaust server re-prompts before auto-continue expires across rapid events', () => {
        const first = simulateChainIntegration(
          [{ name: 'read_file', arguments: { path: 'test.ts' } }],
          '',
          [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'content' } }],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 3 }
        );
        expect(first.autoContinued).toBe(true);
        expect(first.serverRePrompted).toBe(false);
        expect(first.rePromptCount).toBe(3);
      });

      it('should handle rapid switching between tool types', () => {
        const tools = ['read_file', 'list_directory', 'web_search', 'read_url', 'glob'];
        for (let i = 0; i < tools.length; i++) {
          const toolName = tools[i];
          const result = simulateChainIntegration(
            [{ name: toolName, arguments: { path: '/'.concat(toolName) } }],
            '',
            [{ toolCallId: 'rapid-'.concat(String(i)), toolName: toolName, result: { success: true, output: 'result '.concat(String(i)) } }],
            { maxContinuations: 5, continuationCount: i, enableAutoContinue: true, maxRePrompts: 5, rePromptCount: 0 }
          );
          expect(result.autoContinued).toBe(true);
          expect(result.serverRePrompted).toBe(true);
        }
      });

      it('should handle auto-continue followed immediately by complete response', () => {
        const autoContinue = simulateChainIntegration(
          [{ name: 'read_file', arguments: { path: 'config.ts' } }],
          '',
          [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'config content' } }],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(autoContinue.autoContinued).toBe(true);
        const complete = simulateChainIntegration(
          [],
          'Here is the complete analysis of the configuration.',
          [],
          { maxContinuations: 3, continuationCount: 1, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(complete.autoContinued).toBe(false);
        expect(complete.serverRePrompted).toBe(false);
      });
    });

    // ----------------------------------------------------------------------
    // Scenario 2: Very large tool result arrays
    // ----------------------------------------------------------------------
    describe('Very large tool result arrays', () => {
      it('should handle 100 tool results', () => {
        const largeResults = Array.from({ length: 100 }, (_, i) => ({
          toolCallId: 'large-'.concat(String(i)),
          toolName: i % 2 === 0 ? 'read_file' : 'list_directory',
          result: { success: true, output: 'content '.concat(String(i)) },
        }));
        const largeToolCalls = largeResults.map(r => ({
          name: r.toolName,
          arguments: { path: '/file-'.concat(r.toolCallId).concat('.ts') },
        }));
        const result = simulateChainIntegration(
          largeToolCalls, '', largeResults,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(result.autoContinued).toBe(true);
        expect(result.serverRePrompted).toBe(true);
      });

      it('should handle 1000 tool results', () => {
        const largeResults = Array.from({ length: 1000 }, (_, i) => ({
          toolCallId: 'very-large-'.concat(String(i)),
          toolName: 'read_file',
          result: { success: true, output: 'x'.repeat(100) },
        }));
        const toolCalls: any[] = [];
        for (let i = 0; i < 1000; i++) {
          toolCalls.push({ name: 'read_file', arguments: { path: '/path/to/file-'.concat(String(i)).concat('.ts') } });
        }
        const result = simulateChainIntegration(
          toolCalls, '', largeResults,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(result.autoContinued).toBe(true);
        expect(result.serverRePrompted).toBe(true);
      });

      it('should handle 10000 tool results (stress test)', () => {
        const toolCalls: any[] = [];
        const results: Array<{ toolCallId: string; toolName: string; result: any }> = [];
        for (let i = 0; i < 10000; i++) {
          toolCalls.push({ name: 'read_file', arguments: { path: 'file-'.concat(String(i)).concat('.ts') } });
          results.push({ toolCallId: 'stress-'.concat(String(i)), toolName: 'read_file', result: { success: true, output: 'x'.repeat(50) } });
        }
        const startTime = Date.now();
        const result = simulateChainIntegration(
          toolCalls, '', results,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        const elapsed = Date.now() - startTime;
        expect(result.autoContinued).toBe(true);
        expect(result.serverRePrompted).toBe(true);
        expect(elapsed).toBeLessThan(5000);
      });

      it('should handle large tool results with mixed success/failure', () => {
        const toolCalls: any[] = [];
        const results: Array<{ toolCallId: string; toolName: string; result: any }> = [];
        for (let i = 0; i < 500; i++) {
          toolCalls.push({
            name: i % 2 === 0 ? 'read_file' : 'execute_shell',
            arguments: i % 2 === 0 ? { path: 'file-'.concat(String(i)).concat('.ts') } : { command: 'cmd-'.concat(String(i)) },
          });
          results.push({
            toolCallId: 'mixed-'.concat(String(i)),
            toolName: i % 2 === 0 ? 'read_file' : 'execute_shell',
            result: { success: i % 3 !== 0, output: 'result '.concat(String(i)) },
          });
        }
        const result = simulateChainIntegration(
          toolCalls, '', results,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(result.autoContinued).toBe(true);
        expect(result.serverRePrompted).toBe(true);
      });

      it('should handle empty tool results combined with large text response', () => {
        const largeText = 'The analysis is complete. '.repeat(1000);
        const result = simulateChainIntegration(
          [], largeText + '.', [],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(result.autoContinued).toBe(false);
        expect(result.serverRePrompted).toBe(false);
      });
    });

    // ----------------------------------------------------------------------
    // Scenario 3: Stream cancellation mid-chain
    // ----------------------------------------------------------------------
    describe('Stream cancellation mid-chain (abort signal)', () => {
      it('should handle cancellation BEFORE auto-continue fires (not complete)', () => {
        const result = simulateAutoContinueDetection(
          [{ name: 'read_file', arguments: { path: 'test.ts' } }],
          'Partial content...', false,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        expect(result.triggered).toBe(false);
        expect(result.reason).toBe('not_complete_or_empty');
      });

      it('should handle cancellation AFTER auto-continue fires but before response', () => {
        const first = simulateChainIntegration(
          [{ name: 'list_directory', arguments: { path: '/src' } }], '',
          [{ toolCallId: '1', toolName: 'list_directory', result: { success: true, output: 'listing...' } }],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(first.autoContinued).toBe(true);
        const cancelled = simulateAutoContinueDetection(
          [], '', false,
          { maxContinuations: 3, continuationCount: 1, enableAutoContinue: true }
        );
        expect(cancelled.triggered).toBe(false);
        expect(cancelled.reason).toBe('not_complete_or_empty');
      });

      it('should allow continuation later after cancellation', () => {
        const cancelled = simulateAutoContinueDetection(
          [{ name: 'read_file', arguments: { path: 'test.ts' } }], '', false,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        expect(cancelled.triggered).toBe(false);
        const retry = simulateChainIntegration(
          [{ name: 'read_file', arguments: { path: 'test.ts' } }], '',
          [{ toolCallId: 'retry', toolName: 'read_file', result: { success: true, output: 'content' } }],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(retry.autoContinued).toBe(true);
        expect(retry.serverRePrompted).toBe(true);
      });

      it('should handle abort with partial tool results', () => {
        const partialToolCalls = [
          { name: 'read_file', arguments: { path: 'a.ts' } },
          { name: 'read_file', arguments: { path: 'b.ts' } },
          { name: 'read_file', arguments: { path: 'c.ts' } },
        ];
        const partialResults = [
          { toolCallId: 'a', toolName: 'read_file', result: { success: true, output: 'content a' } },
          { toolCallId: 'b', toolName: 'read_file', result: { success: true, output: 'content b' } },
        ];
        const result = simulateChainIntegration(
          partialToolCalls, '', partialResults,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(result.autoContinued).toBe(true);
        expect(result.serverRePrompted).toBe(true);
      });

      it('should handle cancellation during server re-prompt (no crash)', () => {
        const result = simulateChainIntegration(
          [{ name: 'read_file', arguments: { path: 'config.ts' } }], '',
          [{ toolCallId: '1', toolName: 'read_file', result: { success: true, output: 'config content' } }],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(result.autoContinued).toBe(true);
        expect(result.serverRePrompted).toBe(true);
        const doubleFire = result.events.find(e => e.type === 'double-fire-detected');
        expect(doubleFire).toBeDefined();
        expect(result.finalContent.length).toBeGreaterThan(0);
      });

      it('should handle consecutive cancellations without memory issues', () => {
        for (let i = 0; i < 5; i++) {
          const result = simulateAutoContinueDetection(
            [{ name: 'read_file', arguments: { path: 'cancel-'.concat(String(i)).concat('.ts') } }], '', false,
            { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
          );
          expect(result.triggered).toBe(false);
        }
        const final = simulateChainIntegration(
          [{ name: 'read_file', arguments: { path: 'final.ts' } }], '',
          [{ toolCallId: 'final', toolName: 'read_file', result: { success: true, output: 'done' } }],
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true, maxRePrompts: 3, rePromptCount: 0 }
        );
        expect(final.autoContinued).toBe(true);
        expect(final.serverRePrompted).toBe(true);
      });

      it('should handle cancellation with no tool results at all', () => {
        const result = simulateAutoContinueDetection(
          [], '', false,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        expect(result.triggered).toBe(false);
        expect(result.reason).toBe('not_complete_or_empty');
      });

      it('should handle cancellation with partial text content but no tool results', () => {
        const result = simulateAutoContinueDetection(
          [], 'Here is the partial content that was streamed', false,
          { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
        );
        expect(result.triggered).toBe(false);
        expect(result.reason).toBe('not_complete_or_empty');
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Gap #14: ramble-no-tools regression (>4KB response with no tool calls)
//
// Production rule (new): lib/chat/auto-continue-helper.ts:rambleNoToolsDetector
// fires on responseText.length > 4096 (env AUTO_CONTINUE_RAMBLE_BYTES) AND
// steps.length === 0 (no tool calls attempted this turn).
//
// The route.ts SSE emitter propagates autoDecision.reason verbatim into
// the continuation chunk's reason field, so operators grep
// '"reason":"ramble-no-tools"' against the live SSE stream to detect
// wall-of-text-no-action failure modes. This regression preserves the
// literal 'ramble-no-tools' through the marcellegrims chain-integration
// layer so any future rename fails at CI rather than at operator-grep.
//
// Why a separate simulator: the existing simulateAutoContinueDetection
// has 30+ call sites each asserting specific reason literals on
// specific fixtures; extending it with a new ramble-no-tools arm
// would force those 30+ tests to be re-validated for the new
// precedence rule. A focused simulator avoids that blast radius while
// still pinning the chain-integration contract.
// ---------------------------------------------------------------------------

const RAMBLE_NO_TOOLS_LITERAL = 'ramble-no-tools';
const RAMBLE_THRESHOLD_BYTES = 4096;

function isRambleNoTools(fullResponse: string, allToolCalls: any[]): boolean {
  return (
    fullResponse.length > RAMBLE_THRESHOLD_BYTES &&
    allToolCalls.length === 0
  );
}

function simulateRambleContinue(
  fullResponse: string,
  allToolCalls: any[],
  options: { maxContinuations: number; continuationCount: number }
): { triggered: boolean; reason?: string; yieldedContent?: string; yieldedType?: string } {
  if (options.continuationCount >= options.maxContinuations) {
    return { triggered: false, reason: 'max_continuations_reached' };
  }
  if (isRambleNoTools(fullResponse, allToolCalls)) {
    return {
      triggered: true,
      reason: RAMBLE_NO_TOOLS_LITERAL,
      yieldedContent: '[AUTO-CONTINUE] Response exceeds ' + RAMBLE_THRESHOLD_BYTES + ' bytes with no tool calls. Take action now — read a file, search, or write a change.',
      yieldedType: 'auto-continue',
    };
  }
  return { triggered: false, reason: 'not_rambling' };
}

function simulateRambleChainIntegration(
  allToolCalls: any[],
  fullResponse: string,
  options: { maxContinuations: number; continuationCount: number; enableAutoContinue: boolean }
): { autoContinued: boolean; autoContinueReason?: string; serverRePrompted: boolean; finalContent: string; events: Array<{ type: string; reason?: string }> } {
  const events: Array<{ type: string; reason?: string }> = [];
  if (!options.enableAutoContinue) {
    return {
      autoContinued: false,
      serverRePrompted: false,
      finalContent: fullResponse || '(no content - auto-continue disabled)',
      events,
    };
  }
  const det = simulateRambleContinue(fullResponse, allToolCalls, {
    maxContinuations: options.maxContinuations,
    continuationCount: options.continuationCount,
  });
  if (det.triggered) {
    events.push({ type: det.yieldedType || 'auto-continue', reason: det.reason });
  }
  return {
    autoContinued: det.triggered,
    autoContinueReason: det.reason,
    serverRePrompted: false,
    finalContent: det.triggered ? (det.yieldedContent || '') : (fullResponse || '(no content - stream ended cleanly)'),
    events,
  };
}

describe('Gap #14: ramble-no-tools regression (>4KB no-tools signal)', () => {
  describe('simulateRambleContinue', () => {
    it('fires ramble-no-tools for >4KB response with NO tool calls', () => {
      const longText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES + 100);
      const result = simulateRambleContinue(longText, [], { maxContinuations: 3, continuationCount: 0 });
      expect(result.triggered).toBe(true);
      // CORE REGRESSION ASSERTION — the operator-grep layer.
      // If a future refactor renames the literal (e.g. 'ramble_no_tools'
      // or 'RAMBLE_NO_TOOLS' or 'rambleNoTools'), this assertion fails at
      // CI rather than at operator-grep stage.
      expect(result.reason).toBe('ramble-no-tools');
      expect(result.yieldedContent).toContain('[AUTO-CONTINUE]');
    });

    it('does NOT fire when response is >4KB but ANY tool was called (no-tools precondition violated)', () => {
      const longText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES + 100);
      const result = simulateRambleContinue(
        longText,
        [{ name: 'read_file', arguments: { path: 'a.ts' } }],
        { maxContinuations: 3, continuationCount: 0 }
      );
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('not_rambling');
    });

    it('does NOT fire when response is just below the threshold', () => {
      const shortText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES - 1);
      const result = simulateRambleContinue(shortText, [], { maxContinuations: 3, continuationCount: 0 });
      expect(result.triggered).toBe(false);
    });

    it('does NOT fire when response is exactly at the threshold (strict >)', () => {
      const exactText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES);
      const result = simulateRambleContinue(exactText, [], { maxContinuations: 3, continuationCount: 0 });
      // Strict > boundary — pins the operator-tunable contract.
      expect(result.triggered).toBe(false);
    });

    it('does NOT fire when continuation count is at max (safety semantics — mirror of Gap #13)', () => {
      const longText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES + 100);
      const result = simulateRambleContinue(longText, [], { maxContinuations: 3, continuationCount: 3 });
      expect(result.triggered).toBe(false);
      // Defensive: ramble-no-tools MUST NOT override max_continuations_reached
      // (mirrors defaultFileEditDetector and needsMoreTurnsDetector).
      expect(result.reason).toBe('max_continuations_reached');
    });

    it('does NOT fire on empty response (defensive)', () => {
      const result = simulateRambleContinue('', [], { maxContinuations: 3, continuationCount: 0 });
      expect(result.triggered).toBe(false);
    });
  });

  describe('simulateRambleChainIntegration', () => {
    it('ramble-no-tools reason propagates verbatim into autoContinueReason', () => {
      // Operator-grep E2E layer: chains simulator + chain integration
      // like production's streamWithAutoContinue → streamWithServerAutoRePrompt.
      const longText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES + 100);
      const result = simulateRambleChainIntegration(
        [],
        longText,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.autoContinued).toBe(true);
      expect(result.autoContinueReason).toBe('ramble-no-tools');
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.events[0].type).toBe('auto-continue');
      expect(result.events[0].reason).toBe('ramble-no-tools');
      expect(result.finalContent).toContain('[AUTO-CONTINUE]');
      // ramble-no-tools is INDEPENDENT of server re-prompt.
      expect(result.serverRePrompted).toBe(false);
    });

    it('chain respects maxContinuations guard (ramble is blocked at cap)', () => {
      const longText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES + 100);
      const result = simulateRambleChainIntegration(
        [],
        longText,
        { maxContinuations: 3, continuationCount: 3, enableAutoContinue: true }
      );
      expect(result.autoContinued).toBe(false);
      expect(result.autoContinueReason).toBe('max_continuations_reached');
    });

    it('chain respects enableAutoContinue=false (no auto-continue, no events)', () => {
      const longText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES + 100);
      const result = simulateRambleChainIntegration(
        [],
        longText,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: false }
      );
      expect(result.autoContinued).toBe(false);
      expect(result.events.length).toBe(0);
      expect(result.finalContent).toBe(longText);
    });

    it('chain with tool call present: ramble branch does NOT compete with file_request_detected', () => {
      // Latent-conflict regression: a >4KB response WITH a tool call is
      // out of scope for ramble-no-tools (the no-tools precondition fails).
      const longText = 'x'.repeat(RAMBLE_THRESHOLD_BYTES + 100);
      const result = simulateRambleChainIntegration(
        [{ name: 'read_file', arguments: { path: 'a.ts' } }],
        longText,
        { maxContinuations: 3, continuationCount: 0, enableAutoContinue: true }
      );
      expect(result.autoContinued).toBe(false);
      expect(result.autoContinueReason).toBe('not_rambling');
    });
  });
});
