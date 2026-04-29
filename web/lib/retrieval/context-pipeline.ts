/**
 * context-pipeline.ts — Ordered context pipeline with automatic fallback
 *
 * Tries context sources in priority order. Each source runs in parallel
 * with a timeout. If a source fails or returns empty, the next source
 * in the chain takes over. Results from successful sources are merged
 * with deduplication.
 *
 * Pipeline order:
 *   1. Hybrid retrieval (AST symbols → smart-context)
 *   2. Workspace session context (context-pack / file listing)
 *   3. Attached files (@mentions)
 *   4. Memory context (mem0)
 *   5. Minimal fallback
 *
 * Each source has a configurable timeout. Failed/timed-out sources
 * are silently skipped — the next source in chain provides context.
 */

import { retrieveHybrid, type HybridRetrievalResult } from "../retrieval/hybrid-retrieval";
import { createLogger } from "@/lib/utils/logger";
import { increment } from "../agent/metrics";
import { mem0Search, buildMem0SystemPrompt, isMem0Configured } from "../powers/mem0-power";

const logger = createLogger("ContextPipeline");

export interface ContextSourceResult {
  /** Which source provided this context */
  source: string;
  /** The context text */
  text: string;
  /** Whether this source succeeded (true = primary result used) */
  succeeded: boolean;
  /** How long this source took in ms */
  durationMs: number;
  /** Error message if failed */
  error?: string;
}

export interface PipelineContextOptions {
  /** User/owner ID */
  userId: string;
  /** Project ID for symbol retrieval */
  projectId?: string;
  /** User prompt */
  prompt: string;
  /** Scope path for session isolation */
  scopePath?: string;
  /** Explicitly attached files */
  explicitFiles?: string[];
  /** Tab ID for ranking */
  tabId?: string;
  /** Max context tokens */
  maxTokens?: number;
  /** Existing workspace session context (from buildWorkspaceSessionContext) */
  workspaceContext?: string;
  /**
   * Pre-computed memory context string. If supplied, the pipeline skips its
   * own mem0 search and uses this as Source 4. Provided for backward compat.
   */
  memoryContext?: string;
  /**
   * Run mem0 search inside the pipeline. When provided (and mem0 is
   * configured), the pipeline will issue a timeout-bounded search in parallel
   * with hybrid retrieval and emit it as Source 4. Ignored if `memoryContext`
   * is also set (precomputed wins).
   */
  memorySearch?: {
    /** User identifier for scoping memories */
    userId: string;
    /** Optional thread/session run_id (used for filtering, but search is user-scoped) */
    sessionId?: string;
    /** Optional agent identifier */
    agentId?: string;
    /** Max results to retrieve (default 5) */
    limit?: number;
    /** Score threshold; results below are dropped (default 0.4) */
    threshold?: number;
    /** Per-call timeout (default: sourceTimeoutMs) */
    timeoutMs?: number;
  };
  /** Timeout per source in ms (default: 3000) */
  sourceTimeoutMs?: number;
}

/**
 * Run the full context pipeline with timeout-bounded sources.
 * Returns merged context + per-source results for telemetry.
 */
export async function runContextPipeline(
  opts: PipelineContextOptions
): Promise<{
  mergedContext: string;
  results: ContextSourceResult[];
  primarySource: string;
  totalDurationMs: number;
}> {
  const start = performance.now();
  const results: ContextSourceResult[] = [];
  const sourceTimeout = opts.sourceTimeoutMs ?? 3_000;

  // ── Async sources (run in parallel) ───────────────────────────────────────
  // Source 1: Hybrid retrieval (AST symbols → smart-context fallback)
  // Source 4 (when not precomputed): Memory search via mem0
  const asyncTasks: Array<Promise<ContextSourceResult>> = [];

  if (opts.projectId && opts.prompt) {
    asyncTasks.push(
      withTimeout(
        "hybrid-retrieval",
        async () => {
          const result = await retrieveHybrid({
            userId: opts.userId,
            projectId: opts.projectId,
            prompt: opts.prompt,
            explicitFiles: opts.explicitFiles,
            scopePath: opts.scopePath,
            tabId: opts.tabId,
            maxContextTokens: opts.maxTokens,
          });
          if (result.source === "fallback" || !result.bundle) {
            throw new Error("Hybrid retrieval returned fallback");
          }
          return result.bundle;
        },
        sourceTimeout,
      ),
    );
  }

  const shouldRunMemorySearch =
    !opts.memoryContext && opts.memorySearch && opts.prompt && isMem0Configured();
  if (shouldRunMemorySearch && opts.memorySearch) {
    const ms = opts.memorySearch;
    asyncTasks.push(
      withTimeout(
        "memory",
        async () => {
          const res = await mem0Search({
            query: opts.prompt,
            userId: ms.userId,
            sessionId: ms.sessionId,
            agentId: ms.agentId,
            limit: ms.limit ?? 5,
            threshold: ms.threshold ?? 0.4,
            timeoutMs: ms.timeoutMs ?? sourceTimeout,
          });
          if (!res.success || !res.results || res.results.length === 0) {
            throw new Error("No relevant memories");
          }
          const formatted = buildMem0SystemPrompt(res.results, {
            threshold: ms.threshold ?? 0.4,
          });
          if (!formatted) {
            throw new Error("All memories below threshold");
          }
          return formatted;
        },
        ms.timeoutMs ?? sourceTimeout,
      ),
    );
  }

  if (asyncTasks.length > 0) {
    const settled = await Promise.all(asyncTasks);
    for (const r of settled) results.push(r);
  }

  // ── Source 2: Workspace session context (context-pack / file listing) ─────
  if (opts.workspaceContext && opts.workspaceContext.length > 0) {
    results.push({
      source: "workspace-session",
      text: opts.workspaceContext,
      succeeded: true,
      durationMs: 0, // already computed, no extra cost
    });
  }

  // ── Source 3: Attached files (@mentions) ──────────────────────────────────
  if (opts.explicitFiles && opts.explicitFiles.length > 0) {
    results.push({
      source: "attached-files",
      text: `Explicitly requested files (${opts.explicitFiles.length}):\n${opts.explicitFiles.map(f => `- ${f}`).join("\n")}`,
      succeeded: true,
      durationMs: 0,
    });
  }

  // ── Source 4 (precomputed legacy): Memory context ─────────────────────────
  if (opts.memoryContext && opts.memoryContext.length > 0) {
    results.push({
      source: "memory",
      text: opts.memoryContext,
      succeeded: true,
      durationMs: 0,
    });
  }

  // ── Source 5: Minimal fallback ────────────────────────────────────────────
  const succeededSources = results.filter(r => r.succeeded);
  if (succeededSources.length === 0) {
    results.push({
      source: "minimal-fallback",
      text: `No additional context available for: "${opts.prompt.slice(0, 100)}"`,
      succeeded: true,
      durationMs: 0,
    });
  }

  // ── Merge results ─────────────────────────────────────────────────────────
  const totalDuration = performance.now() - start;
  const merged = mergeContextResults(results);

  return {
    mergedContext: merged,
    results,
    primarySource: succeededSources.length > 0 ? succeededSources[0].source : "minimal-fallback",
    totalDurationMs: totalDuration,
  };
}

/**
 * Run a source with timeout. Returns a ContextSourceResult.
 */
async function withTimeout(
  source: string,
  fn: () => Promise<string>,
  timeoutMs: number
): Promise<ContextSourceResult> {
  const start = performance.now();
  try {
    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error(`Source "${source}" timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    const text = await Promise.race([fn(), timeoutPromise]);
    const duration = performance.now() - start;
    return { source, text, succeeded: true, durationMs: duration };
  } catch (err) {
    const duration = performance.now() - start;
    increment("context-source-fallback", 1);
    logger.debug(`Context source "${source}" failed:`, { error: err instanceof Error ? err.message : String(err), duration });
    return { source, text: "", succeeded: false, durationMs: duration, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Merge context results, deduplicating by source and avoiding redundant text.
 * Priority: first succeeded source provides primary context, others appended.
 * Limits total output to ~100KB to avoid overwhelming the LLM.
 */
function mergeContextResults(results: ContextSourceResult[]): string {
  const parts: string[] = [];
  const MAX_TOTAL_SIZE = 100_000; // ~25K tokens
  let totalSize = 0;

  for (const result of results) {
    if (!result.succeeded || !result.text) continue;

    // Skip if this text is already contained in a previous result
    // (happens when hybrid retrieval includes smart-context fallback)
    const combinedSoFar = parts.join("\n\n---\n\n");
    if (combinedSoFar.length > 0 && result.text.length < combinedSoFar.length * 0.8) {
      // Short result after long result — likely redundant
      continue;
    }

    // Check if adding this would exceed limit
    const partText = `[${result.source}]\n${result.text}`;
    if (totalSize + partText.length > MAX_TOTAL_SIZE) {
      // Truncate to fit
      const remaining = MAX_TOTAL_SIZE - totalSize;
      if (remaining > 100) {
        parts.push(`${partText.slice(0, remaining)}\n\n... (truncated, token limit reached)`);
      }
      break;
    }

    parts.push(partText);
    totalSize += partText.length;
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Build the final system message by injecting pipeline context.
 * Wraps existing appendFilesystemContextMessages behavior.
 */
export function buildPipelineSystemMessage(
  pipelineResult: { mergedContext: string; primarySource: string; results: ContextSourceResult[] },
  vfsToolPrompt: string = "",
  denialContext: Array<{ reason: string; paths: string[]; timestamp: string }> = [],
): string {
  const sections: string[] = [];

  if (vfsToolPrompt) {
    sections.push(vfsToolPrompt);
  }

  if (pipelineResult.mergedContext) {
    sections.push(
      `Codebase context (source: ${pipelineResult.primarySource}):`,
      pipelineResult.mergedContext,
    );
  }

  if (denialContext.length > 0) {
    sections.push(
      `Recent denied edits (avoid repeating without adjustment):`,
      denialContext.map(entry => `- ${entry.timestamp}: ${entry.reason}; files: ${entry.paths.join(", ")}`).join("\n"),
    );
  }

  return sections.join("\n\n");
}
