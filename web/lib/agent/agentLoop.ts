/**
 * agentLoop.ts — Self-correcting agent loop
 *
 * Flow:
 *   task → retrieve context → LLM generates diff → apply diff
 *         → validate → ✅ done OR ❌ feed error back → retry
 *
 * This is what makes Cursor feel "self-healing" rather than brittle.
 */

import { search } from "../retrieval/search";
import { buildContext, injectContextIntoPrompt, buildSystemPrompt } from "../context/contextBuilder";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  task: string;
  filePath: string;
  originalContent: string;
  projectId: string;
  tabId?: string;
  maxIterations?: number;
  /** LLM call timeout in ms. Prevents indefinite hangs. Default: 60s */
  llmTimeoutMs?: number;
  /** Call the LLM — returns the generated diff as a string */
  llm: (prompt: string, systemPrompt: string) => Promise<string>;
  /** Apply a diff to content. Returns patched content or null if patch failed. */
  applyDiff: (original: string, diff: string) => Promise<PatchResult>;
  /** Validate code — returns null on success, error string on failure */
  validate: (code: string, filePath: string) => Promise<string | null>;
  /** Write the final file. Called only on success. */
  writeFile?: (path: string, content: string) => Promise<void>;
  onIteration?: (info: IterationInfo) => void;
}

export interface PatchResult {
  content: string | null;
  strategy: "unified" | "fuzzy" | "full-replace" | "failed";
  confidence: number;
}

export interface IterationInfo {
  iteration: number;
  status: "applying" | "validating" | "retrying" | "success" | "failed";
  error?: string;
  strategy?: string;
}

export interface AgentResult {
  success: boolean;
  content: string;
  iterations: number;
  finalStrategy?: string;
  error?: string;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildAgentPrompt(opts: {
  task: string;
  filePath: string;
  currentContent: string;
  context: string;
  lastError: string;
  iteration: number;
  lastStrategy?: string;
}): string {
  const { task, filePath, currentContent, context, lastError, iteration, lastStrategy } = opts;

  const retryBlock =
    lastError.length > 0
      ? `## Previous attempt failed (iteration ${iteration})
${lastError}
${lastStrategy ? `\nThe last diff used strategy: "${lastStrategy}". Try a different approach.` : ""}

Fix the diff based on this feedback.`
      : "";

  return `## Task
${task}

## File
${filePath}

## Current content
\`\`\`
${currentContent}
\`\`\`

${context.length > 0 ? `## Relevant codebase context\n${context}` : ""}

${retryBlock}

## Instructions
Return ONLY a unified diff (--- / +++ / @@ format).
Do not include any explanation or markdown fences outside the diff.
If the change is large, prefer replacing the entire function or section.`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Default multi-level validator.
 * Override with your own for TypeScript compiler, ESLint, tests, etc.
 */
export async function defaultValidate(
  code: string,
  _filePath: string
): Promise<string | null> {
  if (code.trim().length === 0) {
    return "Result is empty";
  }

  // Basic sanity checks
  const openBraces = (code.match(/\{/g) ?? []).length;
  const closeBraces = (code.match(/\}/g) ?? []).length;

  if (Math.abs(openBraces - closeBraces) > 3) {
    return `Brace mismatch: ${openBraces} open, ${closeBraces} close — likely a patch error`;
  }

  // Check for common patch artifacts
  if (code.includes("<<<<<<") || code.includes(">>>>>>")) {
    return "Merge conflict markers found in output";
  }

  return null; // valid
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentResult> {
  const {
    task,
    filePath,
    originalContent,
    projectId,
    tabId,
    maxIterations = 5,
    llmTimeoutMs = 60_000, // 60s default
    llm,
    applyDiff,
    validate,
    writeFile,
    onIteration,
  } = opts;

  let currentContent = originalContent;
  let lastError = "";
  let lastStrategy: string | undefined;

  // Pre-retrieve context once (we reuse it across iterations)
  const searchResult = await search(task, {
    projectId,
    tabId,
    topK: 8,
  });

  const contextObj = buildContext(searchResult.symbols, { maxTokens: 4000, maxPerFile: 2 });
  const contextText = contextObj.text;
  const systemPrompt = buildSystemPrompt();

  for (let i = 0; i < maxIterations; i++) {
    onIteration?.({ iteration: i + 1, status: "applying" });

    // 1. Build prompt
    const userPrompt = buildAgentPrompt({
      task,
      filePath,
      currentContent,
      context: contextText,
      lastError,
      iteration: i,
      lastStrategy,
    });

    // 2. Call LLM with timeout
    let diff: string;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`LLM call timed out after ${llmTimeoutMs}ms`)), llmTimeoutMs)
      );
      diff = await Promise.race([llm(userPrompt, systemPrompt), timeoutPromise]);
    } catch (err) {
      lastError = `LLM call failed: ${String(err)}`;
      onIteration?.({ iteration: i + 1, status: "retrying", error: lastError });
      continue;
    }

    // 3. Apply diff
    const patchResult = await applyDiff(currentContent, diff);
    lastStrategy = patchResult.strategy;

    if (!patchResult.content || patchResult.strategy === "failed") {
      lastError = `Diff failed to apply (strategy: ${patchResult.strategy}).
Reason: patch context lines didn't match.
Try: output the complete function/block instead of a minimal diff.`;

      onIteration?.({ iteration: i + 1, status: "retrying", error: lastError, strategy: patchResult.strategy });
      continue;
    }

    // 4. Validate
    onIteration?.({ iteration: i + 1, status: "validating" });

    const validationError = await validate(patchResult.content, filePath);

    if (!validationError) {
      // ✅ Success
      onIteration?.({ iteration: i + 1, status: "success", strategy: patchResult.strategy });

      if (writeFile) {
        await writeFile(filePath, patchResult.content);
      }

      return {
        success: true,
        content: patchResult.content,
        iterations: i + 1,
        finalStrategy: patchResult.strategy,
      };
    }

    // ❌ Validation failed — keep partial progress and retry
    lastError = validationError;
    currentContent = patchResult.content; // don't discard progress

    onIteration?.({
      iteration: i + 1,
      status: "retrying",
      error: validationError,
      strategy: patchResult.strategy,
    });
  }

  return {
    success: false,
    content: currentContent,
    iterations: maxIterations,
    error: lastError || "Max iterations reached",
  };
}

// ─── Multi-file Agent ─────────────────────────────────────────────────────────

export interface MultiFileTask {
  description: string;
  files: Array<{ path: string; content: string }>;
}

export interface MultiFileResult {
  results: Array<{ path: string } & AgentResult>;
  allSucceeded: boolean;
}

/**
 * Run agent loop across multiple files sequentially.
 * Each file gets its own loop — later files benefit from earlier edits in context.
 */
export async function runMultiFileAgent(
  task: MultiFileTask,
  opts: Omit<AgentLoopOptions, "task" | "filePath" | "originalContent">
): Promise<MultiFileResult> {
  const results: Array<{ path: string } & AgentResult> = [];

  for (const file of task.files) {
    const result = await runAgentLoop({
      ...opts,
      task: `${task.description}\n\nFocus on file: ${file.path}`,
      filePath: file.path,
      originalContent: file.content,
    });

    results.push({ path: file.path, ...result });
  }

  return {
    results,
    allSucceeded: results.every((r) => r.success),
  };
}
