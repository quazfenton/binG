/**
 * hybrid-retrieval.ts — Combines AST-based symbol retrieval with smart-context fallback
 *
 * Primary: symbol-level retrieval via indexer (cosine + PageRank + 7-signal ranking)
 * Fallback: existing smart-context (keyword + import graph scoring)
 *
 * This ensures new functionality enhances existing behavior without breaking it.
 * When the vector store has no symbols for a project, smart-context kicks in automatically.
 */

import { search, type SearchOptions, type SearchResult } from "../retrieval/search";
import { buildContext, injectContextIntoPrompt, buildSystemPrompt } from "../context/contextBuilder";
import {
  generateSmartContext,
  type SmartContextOptions,
  type SmartContextResult,
} from "../virtual-filesystem/smart-context";

export interface HybridRetrievalOptions {
  /** User ID for VFS access */
  userId: string;
  /** Project ID for symbol retrieval */
  projectId?: string;
  /** User's prompt/question */
  prompt: string;
  /** Conversation/session ID */
  conversationId?: string;
  /** Explicitly attached files (from @mentions) */
  explicitFiles?: string[];
  /** Files referenced in recent conversation */
  recentSessionFiles?: string[];
  /** Current project root path */
  currentProjectPath?: string;
  /** VFS scope path for session isolation */
  scopePath?: string;
  /** Tab ID for retrieval ranking */
  tabId?: string;
  /** Max total context size in bytes */
  maxTotalSize?: number;
  /** Max tokens for context builder (default: 6000) */
  maxContextTokens?: number;
  /** Output format for smart-context fallback */
  format?: 'markdown' | 'xml' | 'json' | 'plain';
  /** Max lines per file (default: 500) */
  maxLinesPerFile?: number;
  /** Search topK for symbol retrieval (default: 10) */
  topK?: number;
}

export interface HybridRetrievalResult {
  /** The formatted context bundle */
  bundle: string;
  /** Directory tree */
  tree: string;
  /** Which retrieval path was used */
  source: 'symbol-retrieval' | 'smart-context' | 'fallback';
  /** Number of symbols found via AST retrieval */
  symbolCount: number;
  /** Number of files included in context */
  filesIncluded: number;
  /** Estimated token count */
  estimatedTokens: number;
  /** Whether VFS was empty */
  vfsIsEmpty: boolean;
  /** Warnings during generation */
  warnings: string[];
}

/**
 * Hybrid retrieval: tries AST-based symbol retrieval first, falls back to smart-context.
 *
 * Decision logic:
 * 1. If projectId is set AND vector store has symbols → use symbol retrieval
 * 2. If no symbols found OR no projectId → use smart-context
 * 3. If smart-context also fails → return minimal fallback
 */
export async function retrieveHybrid(
  opts: HybridRetrievalOptions
): Promise<HybridRetrievalResult> {
  const warnings: string[] = [];

  // ── Primary: AST-based symbol retrieval ─────────────────────────────────────
  if (opts.projectId) {
    try {
      const searchOpts: SearchOptions = {
        projectId: opts.projectId,
        tabId: opts.tabId,
        topK: opts.topK ?? 10,
      };

      const result = await search(opts.prompt, searchOpts);

      // If we found symbols, use the symbol retrieval path
      if (result.symbols.length > 0) {
        const context = buildContext(result.symbols, {
          maxTokens: opts.maxContextTokens ?? 6000,
          maxPerFile: 3,
          groupByFile: true,
        });

        const bundle = injectContextIntoPrompt(opts.prompt, context);

        return {
          bundle,
          tree: '', // Symbol retrieval doesn't include tree
          source: 'symbol-retrieval',
          symbolCount: result.symbols.length,
          filesIncluded: context.filesIncluded.length,
          estimatedTokens: context.tokenCount,
          vfsIsEmpty: false,
          warnings,
        };
      }
    } catch (err) {
      warnings.push(`Symbol retrieval failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Fallback: Smart-context (keyword + import graph scoring) ────────────────
  try {
    const smartOpts: SmartContextOptions = {
      userId: opts.userId,
      prompt: opts.prompt,
      conversationId: opts.conversationId,
      explicitFiles: opts.explicitFiles,
      recentSessionFiles: opts.recentSessionFiles,
      currentProjectPath: opts.currentProjectPath,
      scopePath: opts.scopePath,
      maxTotalSize: opts.maxTotalSize ?? 500_000,
      format: opts.format ?? 'markdown',
      maxLinesPerFile: opts.maxLinesPerFile ?? 500,
    };

    const smartResult = await generateSmartContext(smartOpts);

    if (!smartResult.vfsIsEmpty && smartResult.bundle.length > 0) {
      return {
        bundle: smartResult.bundle,
        tree: smartResult.tree,
        source: 'smart-context',
        symbolCount: 0,
        filesIncluded: smartResult.filesIncluded,
        estimatedTokens: smartResult.estimatedTokens,
        vfsIsEmpty: false,
        warnings,
      };
    }
  } catch (err) {
    warnings.push(`Smart-context failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Final fallback: minimal context ─────────────────────────────────────────
  return {
    bundle: `--- WORKSPACE ---\nNo relevant files found for: "${opts.prompt}"\n--- END WORKSPACE ---\n`,
    tree: '',
    source: 'fallback',
    symbolCount: 0,
    filesIncluded: 0,
    estimatedTokens: 15,
    vfsIsEmpty: true,
    warnings,
  };
}

/**
 * Build a prompt with hybrid context injection.
 * Returns the complete user prompt ready to send to the LLM.
 */
export async function buildPromptWithContext(
  opts: HybridRetrievalOptions
): Promise<string> {
  const result = await retrieveHybrid(opts);

  if (result.warnings.length > 0) {
    console.debug('[HybridRetrieval] Warnings:', result.warnings);
  }

  // If source is symbol-retrieval or smart-context, the bundle already contains
  // the prompt with <context> injected. Just return it.
  if (result.source !== 'fallback') {
    return result.bundle;
  }

  // For fallback, inject the minimal context manually
  return injectContextIntoPrompt(opts.prompt, {
    text: result.bundle,
    tokenCount: result.estimatedTokens,
    symbolCount: 0,
    filesIncluded: [],
    symbolsIncluded: [],
    truncated: false,
  });
}
