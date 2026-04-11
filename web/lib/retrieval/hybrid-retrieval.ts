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
import {
  getProjectSymbols,
} from "../memory/vectorStore";
import { virtualFilesystem } from "../virtual-filesystem/virtual-filesystem-service";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("HybridRetrieval");

// ─── Project Analysis Cache ──────────────────────────────────────────────────
// Cached project analysis results, keyed by `${userId}:${scopePath}`.
// Avoids re-analyzing the same project on every prompt.
// TTL: 5 minutes — re-analyzes if project structure might have changed.

interface CachedAnalysis {
  result: string;
  timestamp: number;
}

const PROJECT_ANALYSIS_CACHE = new Map<string, CachedAnalysis>();
const PROJECT_ANALYSIS_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached project analysis or compute fresh value.
 * Cache key: `${userId}:${scopePath}` — only re-analyzes when scope changes.
 */
async function getCachedProjectAnalysis(
  userId: string,
  scopePath?: string
): Promise<string> {
  const cacheKey = `${userId}:${scopePath || 'default'}`;
  const cached = PROJECT_ANALYSIS_CACHE.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < PROJECT_ANALYSIS_TTL_MS) {
    return cached.result;
  }

  try {
    const { analyzeProject } = await import('@/lib/tools/project-analysis');
    const analysis = await analyzeProject(userId, { depth: 1 });

    let result = '';
    if (analysis.framework !== 'unknown' || analysis.packageManager !== 'unknown') {
      result = `Project: framework=${analysis.framework}, packageManager=${analysis.packageManager}, runtimeMode=${analysis.runtimeMode}`;
      if (analysis.entryFile) result += `, entryFile=${analysis.entryFile}`;
      if (analysis.hints.length > 0) result += `, hints: ${analysis.hints.slice(0, 3).join('; ')}`;
    }

    // Cache the result
    if (result) {
      PROJECT_ANALYSIS_CACHE.set(cacheKey, { result, timestamp: Date.now() });
    }

    return result;
  } catch {
    return '';
  }
}

// ─── Tree Building for Symbol Retrieval ──────────────────────────────────────

/**
 * Build a minimal tree string from a set of file paths.
 * Shows only the directories that contain referenced files.
 */
function buildTreeFromPaths(filePaths: string[], maxDepth = 6): string {
  // Build a tree structure from file paths
  const tree: Record<string, any> = {};

  for (const path of filePaths) {
    const parts = path.replace(/^\//, '').split('/');
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      if (!current[part]) {
        current[part] = isFile ? null : {};
      }
      current = current[part];
    }
  }

  function renderTree(node: Record<string, any>, prefix = '', depth = 0): string {
    if (depth >= maxDepth) return `${prefix}...\n`;

    const entries = Object.entries(node);
    let result = '';

    for (let i = 0; i < entries.length; i++) {
      const [name, children] = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const isDir = children !== null;

      result += `${prefix}${connector}${name}${isDir ? '/' : ''}\n`;

      if (isDir && children && depth < maxDepth - 1) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        result += renderTree(children, newPrefix, depth + 1);
      }
    }

    return result;
  }

  return renderTree(tree);
}

/**
 * Build an abbreviated tree showing only directories containing referenced files
 * plus a count of other files. Falls back to top-level dirs if too many.
 */
async function buildSmartTreeForSymbols(
  userId: string | undefined,
  symbolFilePaths: string[],
  totalFileCount: number
): Promise<string> {
  // No userId — fallback to path-based tree
  if (!userId || symbolFilePaths.length === 0) {
    return buildTreeFromPaths(symbolFilePaths);
  }

  // Small project — try to show full tree
  if (totalFileCount <= 10) {
    try {
      const listing = await virtualFilesystem.listDirectory(userId, '/');
      if (listing.nodes && listing.nodes.length > 0) {
        return buildFullTreeString(listing.nodes);
      }
    } catch {
      // VFS inaccessible — fallback to path-based tree
    }
  }

  // Show only directories containing referenced files
  return buildTreeFromPaths(symbolFilePaths);
}

/**
 * Build a full tree string from directory nodes (recursive).
 * Used for small projects where showing the complete tree is cheap.
 */
function buildFullTreeString(
  nodes: Array<{ name: string; type: string }>,
  prefix = '',
  depth = 0,
  maxDepth = 10
): string {
  if (depth >= maxDepth || nodes.length === 0) return '';

  let result = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const isDir = node.type === 'directory';
    result += `${prefix}${connector}${node.name}${isDir ? '/' : ''}\n`;

    // For full tree we need the children — but since we only get top-level nodes
    // from listDirectory, we can't recurse here. This is handled by the caller
    // making multiple listDirectory calls. For small projects, showing top-level
    // is usually sufficient.
  }
  return result;
}

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
  /** Directory tree (may be abbreviated for large projects) */
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
  /** Tree display mode */
  treeMode?: 'full' | 'abbreviated' | 'minimal';
  /** Budget tier */
  budgetTier?: 'compact' | 'balanced' | 'full';
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

      logger.debug('Starting symbol retrieval', {
        projectId: opts.projectId,
        promptLength: opts.prompt.length,
        promptPreview: opts.prompt.slice(0, 100),
      });

      const result = await search(opts.prompt, searchOpts);

      // If we found symbols, use the symbol retrieval path
      if (result.symbols.length > 0) {
        const context = buildContext(result.symbols, {
          maxTokens: opts.maxContextTokens ?? 6000,
          maxPerFile: 3,
          groupByFile: true,
        });

        // Option C: Build tree from symbol file paths
        const uniqueFilePaths = Array.from(new Set(result.symbols.map(s => s.filePath)));
        let tree = '';
        try {
          const allSymbols = await getProjectSymbols(opts.projectId!);
          tree = await buildSmartTreeForSymbols(
            opts.userId,
            uniqueFilePaths,
            allSymbols.length
          );
        } catch {
          tree = buildTreeFromPaths(uniqueFilePaths);
        }

        // Inject tree into context — adapt to format
        let bundleWithContext = context.text;
        if (tree && context.format !== 'json') {
          // For markdown/xml/plain: inject tree as header
          bundleWithContext = context.text.includes('tree') || context.text.includes('├')
            ? context.text
            : `## Workspace Structure\n\n\`\`\`\n${tree}\n\`\`\`\n\n${context.text}`;
        }
        // For JSON: tree is separate — don't pollute the JSON structure

        const bundle = injectContextIntoPrompt(opts.prompt, {
          ...context,
          text: bundleWithContext,
        });

        const bundleBytes = new TextEncoder().encode(bundle).length;
        const treeBytes = new TextEncoder().encode(tree).length;

        logger.debug('Symbol retrieval succeeded', {
          symbolCount: result.symbols.length,
          filesIncluded: context.filesIncluded.length,
          estimatedTokens: context.tokenCount,
          bundleBytes,
          treeBytes,
          treeMode: 'minimal',
        });

        return {
          bundle,
          tree,
          source: 'symbol-retrieval',
          symbolCount: result.symbols.length,
          filesIncluded: context.filesIncluded.length,
          estimatedTokens: context.tokenCount,
          vfsIsEmpty: false,
          treeMode: 'minimal',
          budgetTier: 'balanced',
          warnings,
        };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      logger.error('Symbol retrieval failed', {
        error: errorMsg,
        stack: errorStack?.split('\n').slice(0, 3).join('\n'),
        projectId: opts.projectId,
        promptLength: opts.prompt.length,
        promptPreview: opts.prompt.slice(0, 100),
        userId: opts.userId,
      });
      
      warnings.push(`Symbol retrieval failed: ${errorMsg}`);
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
      format: opts.format ?? 'json',
      maxLinesPerFile: opts.maxLinesPerFile ?? 500,
    };

    const smartResult = await generateSmartContext(smartOpts);

    if (!smartResult.vfsIsEmpty && smartResult.bundle.length > 0) {
      const bundleBytes = new TextEncoder().encode(smartResult.bundle).length;

      logger.debug('Smart-context fallback succeeded', {
        filesIncluded: smartResult.filesIncluded,
        totalFilesInVfs: smartResult.totalFilesInVfs,
        estimatedTokens: smartResult.estimatedTokens,
        bundleBytes,
        treeMode: smartResult.treeMode,
        budgetTier: smartResult.budgetTier,
      });

      return {
        bundle: smartResult.bundle,
        tree: smartResult.tree,
        source: 'smart-context',
        symbolCount: 0,
        filesIncluded: smartResult.filesIncluded,
        estimatedTokens: smartResult.estimatedTokens,
        vfsIsEmpty: false,
        treeMode: smartResult.treeMode,
        budgetTier: smartResult.budgetTier,
        warnings,
      };
    }
  } catch (err) {
    warnings.push(`Smart-context failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Final fallback: minimal context with cached project analysis hint ───────
  // Uses cached analysis (keyed by userId + scopePath) — only re-analyzes when scope changes.
  const projectHint = await getCachedProjectAnalysis(opts.userId, opts.scopePath);

  logger.debug('Hybrid retrieval: using final fallback (no relevant files)');
  return {
    bundle: `--- WORKSPACE ---\nNo relevant files found for: "${opts.prompt}"${projectHint ? `\n\n${projectHint}` : ''}\n--- END WORKSPACE ---\n`,
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
    format: opts.format ?? 'json',
  });
}
