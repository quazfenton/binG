/**
 * Progressive Build Engine
 *
 * A multi-iteration, file-aware, self-stopping project build loop.
 *
 * The LLM is called repeatedly with:
 *   1. Original user prompt (the north-star)
 *   2. Current project tree
 *   3. Context from last iteration (diffs, full files, or tree-only via contextMode)
 *   4. Optional: gap analysis from a self-review pass
 *
 * The loop stops when:
 *   - The LLM emits a completion indicator (e.g., [BUILD_COMPLETE])
 *   - maxIterations is reached
 *   - timeBudgetMS expires
 *   - An abort signal is triggered
 *
 * Integrations:
 *   - smart-context.ts: contextMode ('diff' | 'read' | 'tree')
 *   - mem0: persistent conversation history across iterations
 *   - ReflectionEngine: optional self-review pass (LLM-based, so opt-in)
 *   - VFS MCP tools: file writes go through existing tool pipeline
 *   - SSE events: real-time progress for frontend
 *
 * Usage:
 * ```ts
 * const result = await runProgressiveBuild({
 *   userId: 'user-123',
 *   userPrompt: 'Build a REST API with auth, CRUD, and tests',
 *   llmCall: myStreamFunction,
 *   config: { maxIterations: 15, contextMode: 'diff', enableReflection: true },
 *   emit: (event, data) => sseEncode(res, event, data),
 *   abortSignal: controller.signal,
 * });
 * ```
 */

import { createLogger } from '@/lib/utils/logger';
import {
  generateSmartContext,
  generateUnifiedDiffs,
  captureFullSnapshot,
} from '@/lib/virtual-filesystem/smart-context';

const logger = createLogger('ProgressiveBuild');

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContextMode = 'diff' | 'read' | 'tree';

export interface ProgressiveBuildConfig {
  /** Hard cap on iterations (safety net). Default: 15 */
  maxIterations?: number;
  /** Global timeout in ms. Default: 300,000 (5 min) */
  timeBudgetMS?: number;
  /** Context strategy. Default: 'diff' */
  contextMode?: ContextMode;
  /** Exact token/string the LLM must emit to signal completion */
  completionIndicator?: string;
  /** Max tokens for context bundle (prevents overflow). Default: 12,000 */
  maxContextTokens?: number;
  /** After each iteration, run a reflection pass to identify gaps.
   *  This is a SEPARATE LLM call — opt-in to control costs. Default: false */
  enableReflection?: boolean;
  /** If an iteration produces zero new file writes, stop early. Default: true */
  stopOnEmptyIteration?: boolean;
  /** After N consecutive rounds with no new files, force-complete. Default: 3 */
  maxEmptyRounds?: number;
  /** Include mem0 memories in system prompt. Default: true */
  useMemories?: boolean;
  /** Verbose logging to console. Default: false */
  verbose?: boolean;
}

export interface BuildIterationResult {
  iteration: number;
  response: string;
  filesWritten: string[];
  contextMode: ContextMode;
  reflectionSummary?: string;
  gapsIdentified?: string[];
  durationMs: number;
  completed: boolean;
}

export interface ProgressiveBuildResult {
  completed: boolean;
  completionReason: 'indicator' | 'max_iterations' | 'timeout' | 'aborted' | 'empty_iterations';
  iterations: number;
  totalDurationMs: number;
  allIterations: BuildIterationResult[];
  finalResponse: string;
  /** Full project tree at completion */
  projectTree: string;
  warnings: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<ProgressiveBuildConfig> = {
  maxIterations: 15,
  timeBudgetMS: 300_000,
  contextMode: 'diff',
  completionIndicator: '[BUILD_COMPLETE]',
  maxContextTokens: 12_000,
  enableReflection: false,
  stopOnEmptyIteration: true,
  maxEmptyRounds: 3,
  useMemories: true,
  verbose: false,
};

// Completion indicator patterns (checked at end of response)
const BUILD_COMPLETE_PATTERNS = [
  /\[BUILD_COMPLETE\]/i,
  /\[PROJECT_COMPLETE\]/i,
  /{"build_status"\s*:\s*"complete"/i,
  /All requirements satisfied/i,
  /Everything has been implemented/i,
  /The project is now complete/i,
];

// ─── Completion Detection ─────────────────────────────────────────────────────

/**
 * Check if the LLM response contains a completion indicator.
 * Checks the last 500 chars specifically (LLMs put the marker at the end).
 */
export function detectBuildComplete(response: string, customIndicator?: string): { complete: boolean; reason?: string } {
  const last500 = response.slice(-500);

  // Custom indicator
  if (customIndicator && last500.includes(customIndicator)) {
    return { complete: true, reason: `Custom indicator "${customIndicator}" detected` };
  }

  // Built-in patterns
  for (const pattern of BUILD_COMPLETE_PATTERNS) {
    if (pattern.test(last500)) {
      return { complete: true, reason: `Pattern "${pattern.source}" matched` };
    }
  }

  return { complete: false };
}

// ─── Prompt Construction ──────────────────────────────────────────────────────

/**
 * Build the system prompt for the progressive build loop.
 * This is emitted once at the start and persists across all iterations.
 */
function buildBuildSystemPrompt(userPrompt: string, completionIndicator: string): string {
  return `You are an expert software engineer building a complete software project iteratively.

## ORIGINAL REQUEST
${userPrompt}

## HOW THIS LOOP WORKS
- You are called in **successive iterations**. Each call, you receive the current project state and must implement the NEXT logical piece.
- Each response should create or modify files with **real, working code**.
- Do NOT repeat or rewrite files from previous iterations unless you are specifically improving them.
- Build incrementally but meaningfully — each iteration should advance the project significantly.

## WHAT YOU RECEIVE EACH ITERATION
1. The current **project file tree** (always included)
2. Either:
   - A **diff of changes** from the last iteration (what was added/modified/deleted)
   - **Full file contents** of key files to review
   - **Tree only** — you infer what to build next from the structure
3. An optional **gap analysis** from a review of the previous iteration

## YOUR JOB
1. Review the current project tree and recent changes.
2. Identify what the user originally asked for that is NOT YET implemented.
3. Write ONLY the files/edits needed for the NEXT logical piece.
4. Use the write_file, batch_write, and apply_diff tools to make changes.
5. Do NOT abbreviate, truncate, or use placeholders like "// rest of code".

## COMPLETION SIGNAL — CRITICAL
When you believe the original request is **100% complete** — every feature, file, test, and piece of documentation requested — you MUST end your response with exactly:

${completionIndicator}

Do NOT emit ${completionIndicator} until the project is genuinely fully complete.
Do NOT emit it at the end of every response — only the final one.
If there is still work to do, do NOT emit it — just continue building.`;
}

/**
 * Build the per-iteration user message with project state.
 */
function buildIterationUserMessage(params: {
  iteration: number;
  projectTree: string;
  contextBundle: string;
  contextMode: ContextMode;
  gapAnalysis?: string;
  memories?: string;
}): string {
  const { iteration, projectTree, contextBundle, contextMode, gapAnalysis, memories } = params;

  const parts: string[] = [
    `## Iteration ${iteration}`,
    '',
    '### Current Project Tree',
    '```',
    projectTree || '(empty — project root exists but no files yet)',
    '```',
  ];

  if (memories) {
    parts.push('', '### Relevant Memories from Prior Conversations', memories);
  }

  if (contextMode === 'diff') {
    parts.push('', '### Changes from Last Iteration', contextBundle);
  } else if (contextMode === 'read') {
    parts.push('', '### Files to Review Before Continuing', contextBundle);
  }

  if (gapAnalysis) {
    parts.push('', '## Gap Analysis (from review of last iteration)', gapAnalysis);
  }

  parts.push('', '---');
  parts.push('Continue building. Implement the next logical step. Write real, complete code.');

  return parts.join('\n');
}

// ─── Reflection (Optional, Separate LLM Call) ────────────────────────────────

export interface ReflectionResult {
  summary: string;
  gapsIdentified: string[];
  score: number; // 0-100
}

/**
 * Default reflection function — runs a separate LLM call to review
 * the last iteration's output and identify gaps.
 *
 * Callers can override this via `config.reflectionFn` to use
 * the existing ReflectionEngine, a cheaper model, or skip entirely.
 */
export async function defaultReflectionFn(
  llmCall: (messages: Array<{ role: string; content: string }>) => Promise<string>,
  userPrompt: string,
  projectTree: string,
  lastResponse: string,
): Promise<ReflectionResult> {
  try {
    const reflectionMessages = [
      {
        role: 'system',
        content: `You are a code reviewer analyzing the output of a software build iteration.
Your job is to identify what is still MISSING from the project compared to the original request.
Be concise. List specific gaps. Give a completeness score (0-100).`,
      },
      {
        role: 'user',
        content: `## Original Request
${userPrompt}

## Current Project Tree
${projectTree}

## Last Iteration Output (excerpt)
${lastResponse.slice(-2000)}

Identify:
1. What requirements from the original request are NOT yet implemented?
2. What files/features should be built next?
3. A completeness score (0-100).

Format your response as:
GAPS:
- [gap 1]
- [gap 2]
- ...

SCORE: <0-100>`,
      },
    ];

    const reflectionResponse = await llmCall(reflectionMessages);

    // Parse gaps from response
    const gapsMatch = reflectionResponse.match(/GAPS?:\s*\n([\s\S]*?)(?:SCORE|---|$)/i);
    const gaps: string[] = [];
    if (gapsMatch) {
      const gapLines = gapsMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
      for (const line of gapLines) {
        const gap = line.replace(/^[-*]\s*/, '').trim();
        if (gap) gaps.push(gap);
      }
    }

    // Parse score
    const scoreMatch = reflectionResponse.match(/SCORE:\s*(\d+)/i);
    const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 50;

    return {
      summary: reflectionResponse.slice(0, 500),
      gapsIdentified: gaps.length > 0 ? gaps : ['Unable to identify specific gaps — review manually'],
      score,
    };
  } catch (err: any) {
    logger.warn('Reflection failed', { error: err.message });
    return {
      summary: `Reflection failed: ${err.message}`,
      gapsIdentified: [],
      score: 50,
    };
  }
}

// ─── Mem0 Integration ────────────────────────────────────────────────────────

async function fetchMemories(userId: string, sessionId?: string): Promise<string | null> {
  try {
    const { isMem0Configured, mem0Search } = await import('@/lib/powers/mem0-power');
    if (!isMem0Configured()) return null;

    const result = await mem0Search({ query: 'project build requirements preferences', userId, limit: 5 }, { userId });
    if (!result.success || !result.results || result.results.length === 0) return null;

    return result.results
      .map((r: any) => `- ${r.memory || r.text || ''}`)
      .join('\n');
  } catch {
    return null;
  }
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

export interface ProgressiveBuildOptions {
  /** User ID for VFS and mem0 access */
  userId: string;
  /** Session ID for mem0 scoping */
  sessionId?: string;
  /** The user's original project prompt */
  userPrompt: string;
  /**
   * LLM call function. Receives an array of {role, content} messages.
   * Returns the full response string.
   * This is the caller's existing LLM function — OpenAI, Anthropic, etc.
   */
  llmCall: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  /** Optional: emit SSE events for frontend progress */
  emit?: (event: string, data: unknown) => void;
  /** Optional: abort signal for user cancellation */
  abortSignal?: AbortSignal;
  /** Optional: override the reflection function. Set to false to disable entirely. */
  reflectionFn?: ((
    llmCall: (messages: Array<{ role: string; content: string }>) => Promise<string>,
    userPrompt: string,
    projectTree: string,
    lastResponse: string,
  ) => Promise<ReflectionResult>) | false;
  /** Optional: function to get project tree string (defaults to smart-context's tree builder) */
  getProjectTree?: () => Promise<string>;
  /** Loop config — merges with defaults */
  config?: ProgressiveBuildConfig;
}

export async function runProgressiveBuild(options: ProgressiveBuildOptions): Promise<ProgressiveBuildResult> {
  const { userId, sessionId, userPrompt, llmCall, emit, abortSignal } = options;
  const config: Required<ProgressiveBuildConfig> = { ...DEFAULT_CONFIG, ...options.config };
  const warnings: string[] = [];

  const log = (...args: unknown[]) => config.verbose && console.log('[ProgressiveBuild]', ...args);

  const startTime = Date.now();
  const allIterations: BuildIterationResult[] = [];
  let lastResponse: string | null = null;
  let lastSnapshotBefore = new Map<string, string>();
  let lastSnapshotAfter = new Map<string, string>();
  let consecutiveEmptyRounds = 0;
  let completed = false;
  let completionReason: ProgressiveBuildResult['completionReason'] = 'max_iterations';

  // Emit start event
  emit?.('progressive_build', {
    stage: 'started',
    userPrompt,
    config: {
      maxIterations: config.maxIterations,
      contextMode: config.contextMode,
      enableReflection: config.enableReflection,
      completionIndicator: config.completionIndicator,
    },
    timestamp: Date.now(),
  });

  // Build the persistent system prompt
  const systemPrompt = buildBuildSystemPrompt(userPrompt, config.completionIndicator);
  const conversationHistory: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Fetch mem0 memories for initial context
  let memories: string | null = null;
  if (config.useMemories) {
    memories = await fetchMemories(userId, sessionId);
    if (memories) {
      log(`Loaded ${memories.split('\n').length} memories from mem0`);
    }
  }

  // Take initial snapshot for diff mode
  if (config.contextMode === 'diff') {
    lastSnapshotBefore = await captureFullSnapshot(userId);
    log(`Initial snapshot: ${lastSnapshotBefore.size} files`);
  }

  // ─── Main Iteration Loop ───────────────────────────────────────────────────

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    const iterationStart = Date.now();

    // Check abort signal
    if (abortSignal?.aborted) {
      completionReason = 'aborted';
      log('Aborted by user');
      break;
    }

    // Check time budget
    if (Date.now() - startTime > config.timeBudgetMS) {
      completionReason = 'timeout';
      log('Time budget exceeded');
      break;
    }

    log(`\n${'─'.repeat(50)}`);
    log(`Iteration ${iteration}/${config.maxIterations} [contextMode: ${config.contextMode}]`);

    // Get project tree (use custom getter or fall back to smart-context)
    let projectTree: string;
    if (options.getProjectTree) {
      projectTree = await options.getProjectTree();
    } else {
      // Lightweight tree via smart-context (no file contents)
      try {
        const ctx = await generateSmartContext({
          userId,
          prompt: userPrompt,
          contextMode: 'tree',
          format: 'plain',
          maxTotalSize: 10_000, // Minimal — tree only
        });
        projectTree = ctx.tree || '(empty)';
      } catch (err: any) {
        projectTree = '(unable to generate tree)';
        warnings.push(`Tree generation failed: ${err.message}`);
      }
    }

    // Build context bundle based on contextMode
    let contextBundle = '';

    if (config.contextMode === 'diff') {
      // Capture current state, generate diffs against last state
      const currentSnapshot = await captureFullSnapshot(userId);
      const diffs = generateUnifiedDiffs(lastSnapshotAfter.size > 0 ? lastSnapshotAfter : lastSnapshotBefore, currentSnapshot, 15, 100);

      if (diffs.length === 0) {
        contextBundle = '(no file changes since last iteration)';
      } else {
        contextBundle = diffs.map(d =>
          `### ${d.status === 'created' ? 'CREATED' : d.status === 'deleted' ? 'DELETED' : 'MODIFIED'}: ${d.path}\n\n\`\`\`diff\n${d.diff}\n\`\`\``
        ).join('\n\n');
        log(`Diff bundle: ${diffs.length} files, ${contextBundle.length} chars`);
      }

      // Update snapshots: before ← after, after ← current
      // Copy the maps so they don't share references
      lastSnapshotBefore = new Map(lastSnapshotAfter);
      lastSnapshotAfter = currentSnapshot;
    } else if (config.contextMode === 'read') {
      // Full file contents for the top-ranked files
      try {
        const ctx = await generateSmartContext({
          userId,
          prompt: userPrompt,
          contextMode: 'read',
          format: 'plain',
          maxTotalSize: config.maxContextTokens * 4, // Rough byte estimate
          maxLinesPerFile: 200,
        });
        contextBundle = ctx.bundle;
        log(`Read bundle: ${ctx.filesIncluded} files, ${contextBundle.length} chars`);
      } catch (err: any) {
        contextBundle = '(unable to read files)';
        warnings.push(`Context read failed: ${err.message}`);
      }
    }
    // 'tree' mode: contextBundle stays empty — tree is already included

    // Optional: run reflection on last iteration
    let gapAnalysis: string | undefined;
    let gapsIdentified: string[] = [];
    if (config.enableReflection && lastResponse && options.reflectionFn !== false) {
      const reflectFn = options.reflectionFn || defaultReflectionFn;
      log('Running reflection pass...');
      const reflection = await reflectFn(llmCall, userPrompt, projectTree, lastResponse);

      gapAnalysis = reflection.summary;
      gapsIdentified = reflection.gapsIdentified;

      if (reflection.score >= 90) {
        log(`Reflection: project looks ${reflection.score}% complete`);
      } else {
        log(`Reflection: ${reflection.gapsIdentified.length} gaps identified (score: ${reflection.score}%)`);
      }
    }

    // Build the user message for this iteration
    const userMessage = buildIterationUserMessage({
      iteration,
      projectTree,
      contextBundle,
      contextMode: config.contextMode,
      gapAnalysis,
      memories: memories || undefined,
    });

    conversationHistory.push({ role: 'user', content: userMessage });

    // Emit iteration start event
    emit?.('progressive_build', {
      stage: 'iteration_start',
      iteration,
      maxIterations: config.maxIterations,
      contextMode: config.contextMode,
      projectTree,
      gapsIdentified,
      reflectionSummary: gapAnalysis,
      timestamp: Date.now(),
    });

    log(`Calling LLM (conversation history: ${conversationHistory.length} messages)...`);

    // Call the LLM
    let response: string;
    try {
      response = await llmCall(conversationHistory);
    } catch (err: any) {
      log(`LLM call failed: ${err.message}`);
      warnings.push(`LLM call failed at iteration ${iteration}: ${err.message}`);

      // Emit error event but continue to next iteration
      emit?.('progressive_build', {
        stage: 'iteration_error',
        iteration,
        error: err.message,
        timestamp: Date.now(),
      });

      // Don't add failed message to history
      continue;
    }

    lastResponse = response;
    conversationHistory.push({ role: 'assistant', content: response });

    const durationMs = Date.now() - iterationStart;
    log(`Response received (${response.length} chars, ${durationMs}ms)`);

    // Count files written this iteration (rough heuristic from response content)
    const filesWritten = extractFilesFromResponse(response);
    const hasNewFiles = filesWritten.length > 0;

    if (!hasNewFiles) {
      consecutiveEmptyRounds++;
      log(`No new files detected (empty round ${consecutiveEmptyRounds}/${config.maxEmptyRounds})`);
    } else {
      consecutiveEmptyRounds = 0;
    }

    // Store iteration result
    const iterResult: BuildIterationResult = {
      iteration,
      response: response.slice(0, 1000), // Store excerpt
      filesWritten,
      contextMode: config.contextMode,
      reflectionSummary: gapAnalysis,
      gapsIdentified,
      durationMs,
      completed: false,
    };
    allIterations.push(iterResult);

    // Emit iteration complete event
    emit?.('progressive_build', {
      stage: 'iteration_complete',
      iteration,
      maxIterations: config.maxIterations,
      filesCreatedThisRound: filesWritten,
      durationMs,
      gapsIdentified,
      timestamp: Date.now(),
    });

    // Check for completion indicator
    const completionCheck = detectBuildComplete(response, config.completionIndicator);
    if (completionCheck.complete) {
      iterResult.completed = true;
      completed = true;
      completionReason = 'indicator';
      log(`✅ Completion detected: ${completionCheck.reason}`);
      emit?.('progressive_build', {
        stage: 'complete',
        iteration,
        completionReason: completionCheck.reason,
        totalIterations: allIterations.length,
        projectTree,
        timestamp: Date.now(),
      });
      break;
    }

    // Check for too many empty rounds
    if (config.stopOnEmptyIteration && consecutiveEmptyRounds >= config.maxEmptyRounds) {
      completionReason = 'empty_iterations';
      log(`⚠ Stopping: ${consecutiveEmptyRounds} consecutive rounds with no new files`);
      warnings.push(`Stopped after ${consecutiveEmptyRounds} rounds with no new file creation`);
      break;
    }

    log(`Continuing to iteration ${iteration + 1}...`);
  }

  // Final project tree
  let finalTree = '';
  try {
    if (options.getProjectTree) {
      finalTree = await options.getProjectTree();
    } else {
      const ctx = await generateSmartContext({
        userId,
        prompt: userPrompt,
        contextMode: 'tree',
        format: 'plain',
        maxTotalSize: 10_000,
      });
      finalTree = ctx.tree || '(empty)';
    }
  } catch {
    finalTree = '(unable to generate final tree)';
  }

  if (!completed) {
    log(`⚠ Max iterations (${config.maxIterations}) reached without completion indicator.`);
    emit?.('progressive_build', {
      stage: 'max_iterations_reached',
      iterations: allIterations.length,
      maxIterations: config.maxIterations,
      completed: false,
      timestamp: Date.now(),
    });
  }

  const totalDurationMs = Date.now() - startTime;

  return {
    completed,
    completionReason,
    iterations: allIterations.length,
    totalDurationMs,
    allIterations,
    finalResponse: lastResponse ?? '',
    projectTree: finalTree,
    warnings,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Heuristically extract file paths that were created/written from an LLM response.
 * Looks for patterns like ```file: path, write_file("path", ...), or "path" in tool calls.
 */
function extractFilesFromResponse(response: string): string[] {
  const files = new Set<string>();

  // ```file: path/to/file.ext
  for (const match of response.matchAll(/```file:\s*([^\n`]+)/gi)) {
    const p = match[1]?.trim();
    if (p && isValidPath(p)) files.add(p);
  }

  // write_file("path/to/file", ...)
  for (const match of response.matchAll(/write_file\s*\(\s*["']([^"']+)["']/gi)) {
    const p = match[1];
    if (p && isValidPath(p)) files.add(p);
  }

  // batch_write([{ path: "src/..." }, ...])
  for (const match of response.matchAll(/batch_write\s*\(\s*\[([\s\S]*?)\]\s*\)/gi)) {
    const body = match[1];
    for (const pathMatch of body.matchAll(/"path"\s*:\s*"([^"]+)"/gi)) {
      const p = pathMatch[1];
      if (p && isValidPath(p)) files.add(p);
    }
  }

  // "path": "src/..." in JSON tool calls — be specific: must have at least one slash or extension
  for (const match of response.matchAll(/"path"\s*:\s*"([^"]+)"/gi)) {
    const p = match[1];
    // Require either a directory separator or a file extension to avoid matching generic "path" keys
    if (p && (p.includes('/') || p.includes('.')) && isValidPath(p)) files.add(p);
  }

  return Array.from(files);
}

/**
 * Basic path validation — reject obvious non-paths.
 */
function isValidPath(p: string): boolean {
  if (!p || p.length < 2) return false;
  if (p.includes(' ') && !p.includes('/')) return false;
  if (p.startsWith('{') || p.startsWith('[')) return false;
  if (p === 'path' || p === 'file' || p === 'filename') return false;
  // Reject URLs, CSS values, and other non-path patterns
  if (/^https?:\/\//i.test(p)) return false;
  if (/^#[a-f0-9]{3,8}$/i.test(p)) return false;
  return true;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

/**
 * Pre-configured build presets for common project sizes.
 */
export const BuildPresets = {
  /** Large codebases — minimal token usage, tree + diffs only */
  large: {
    contextMode: 'diff' as ContextMode,
    maxIterations: 20,
    maxContextTokens: 8_000,
    enableReflection: true,
  },
  /** Small/medium projects — full file reading for max accuracy */
  thorough: {
    contextMode: 'read' as ContextMode,
    maxIterations: 12,
    maxContextTokens: 16_000,
    enableReflection: true,
  },
  /** Ultra-light — just the tree, LLM infers what to build */
  fast: {
    contextMode: 'tree' as ContextMode,
    maxIterations: 10,
    maxContextTokens: 4_000,
    enableReflection: false,
  },
  /** Balanced — diffs with occasional reflection */
  balanced: {
    contextMode: 'diff' as ContextMode,
    maxIterations: 15,
    maxContextTokens: 12_000,
    enableReflection: false,
  },
} as const;
