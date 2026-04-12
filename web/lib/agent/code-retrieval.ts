/**
 * code-retrieval.ts — Code retrieval, indexing, and Q&A engine
 *
 * The single entry point for all AI coding operations.
 * Handles: indexing, search, context building, agent loops, command routing.
 *
 * Usage:
 *   const retrieval = new Retrieval({ projectId, llm });
 *   await retrieval.indexFiles(files);
 *   const answer = await retrieval.ask("how does auth work?");
 *   const result = await retrieval.editFile({ path, task });
 */

import { ProjectIndexer, projectIdFromPath } from "../memory/indexer";
import { search, getTabMemory, type SearchOptions } from "../retrieval/search";
import {
  buildContext,
  injectContextIntoPrompt,
  buildSystemPrompt,
  type ContextBuilderOptions,
} from "../context/contextBuilder";
import {
  runAgentLoop,
  defaultValidate,
  type AgentLoopOptions,
  type AgentResult,
  type PatchResult,
} from "../agent/agentLoop";
import { clearEmbedCache } from "../memory/embeddings";
import type { RankedSymbol } from "../retrieval/similarity";

// ─── Config ───────────────────────────────────────────────────────────────────

export interface RetrievalConfig {
  projectId: string;
  projectName?: string;
  /** Call your LLM. Returns full response text. */
  llm: (userPrompt: string, systemPrompt: string) => Promise<string>;
  /** Stream LLM response. Yields chunks. */
  streamLLM?: (userPrompt: string, systemPrompt: string) => AsyncIterable<string>;
  /** Apply a diff to a string. Must be provided for editFile to work. */
  applyDiff?: (original: string, diff: string) => Promise<PatchResult>;
  /** Write file to disk/storage. */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** Custom validator. Defaults to brace/marker checks. */
  validate?: AgentLoopOptions["validate"];
}

// ─── Main Retrieval ───────────────────────────────────────────────────────────

export class Retrieval {
  private config: RetrievalConfig;
  private indexer: ProjectIndexer;
  private activeTabId: string = "default";
  private cachedSymbols: RankedSymbol[] | null = null;

  constructor(config: RetrievalConfig) {
    this.config = config;
    this.indexer = new ProjectIndexer(config.projectId);
  }

  // ── Project Setup ────────────────────────────────────────────────────────

  /** Initialize a project from a path — generates a stable project ID */
  static async fromPath(
    path: string,
    config: Omit<RetrievalConfig, "projectId">
  ): Promise<Retrieval> {
    const projectId = await projectIdFromPath(path);
    return new Retrieval({ ...config, projectId });
  }

  // ── Indexing ─────────────────────────────────────────────────────────────

  /** Index a batch of files (skips unchanged) */
  async indexFiles(
    files: Array<{ path: string; content: string }>,
    opts?: {
      onProgress?: (done: number, total: number, file: string) => void;
      recomputePageRank?: boolean;
    }
  ) {
    this.cachedSymbols = null; // invalidate cache

    const results = await this.indexer.indexFiles(files, opts?.onProgress);

    if (opts?.recomputePageRank !== false) {
      await this.indexer.recomputePageRank();
    }

    return results;
  }

  /** Index a single file */
  async indexFile(path: string, content: string) {
    this.cachedSymbols = null;
    return this.indexer.indexFile(path, content);
  }

  // ── Search & Context ─────────────────────────────────────────────────────

  /** Search the codebase and return ranked symbols */
  async searchSymbols(
    query: string,
    opts?: Partial<SearchOptions>
  ) {
    return search(query, {
      projectId: this.config.projectId,
      tabId: this.activeTabId,
      ...opts,
    });
  }

  /** Build a context string from a query (for manual prompt construction) */
  async buildQueryContext(
    query: string,
    contextOpts?: ContextBuilderOptions
  ) {
    const result = await this.searchSymbols(query);
    return buildContext(result.symbols, contextOpts);
  }

  // ── Q&A ──────────────────────────────────────────────────────────────────

  /** Ask a question about the codebase. Returns full text response. */
  async ask(
    question: string,
    opts?: { maxContextTokens?: number }
  ): Promise<string> {
    const result = await this.searchSymbols(question);
    const context = buildContext(result.symbols, {
      maxTokens: opts?.maxContextTokens ?? 6000,
    });

    const userPrompt = injectContextIntoPrompt(question, context);
    const systemPrompt = buildSystemPrompt(this.config.projectName);

    return this.config.llm(userPrompt, systemPrompt);
  }

  /** Stream an answer about the codebase. */
  async *stream(
    question: string,
    opts?: { maxContextTokens?: number }
  ): AsyncIterable<string> {
    if (!this.config.streamLLM) {
      throw new Error("streamLLM is not configured");
    }

    const result = await this.searchSymbols(question);
    const context = buildContext(result.symbols, {
      maxTokens: opts?.maxContextTokens ?? 6000,
    });

    const userPrompt = injectContextIntoPrompt(question, context);
    const systemPrompt = buildSystemPrompt(this.config.projectName);

    yield* this.config.streamLLM(userPrompt, systemPrompt);
  }

  // ── File Editing (Agent Loop) ─────────────────────────────────────────────

  /** Edit a file using the self-correcting agent loop */
  async editFile(opts: {
    path: string;
    content: string;
    task: string;
    maxIterations?: number;
    cursorLine?: number;
    onIteration?: AgentLoopOptions["onIteration"];
  }): Promise<AgentResult> {
    if (!this.config.applyDiff) {
      throw new Error("applyDiff is not configured — required for editFile");
    }

    return runAgentLoop({
      task: opts.task,
      filePath: opts.path,
      originalContent: opts.content,
      projectId: this.config.projectId,
      tabId: this.activeTabId,
      maxIterations: opts.maxIterations ?? 5,
      llm: this.config.llm,
      applyDiff: this.config.applyDiff,
      validate: this.config.validate ?? defaultValidate,
      writeFile: this.config.writeFile,
      onIteration: opts.onIteration,
      editContext: opts.cursorLine
        ? { filePath: opts.path, cursorLine: opts.cursorLine }
        : undefined,
    } as AgentLoopOptions & { editContext?: any });
  }

  // ── Tab Management ───────────────────────────────────────────────────────

  /** Switch active tab — affects retrieval ranking */
  setActiveTab(tabId: string) {
    this.activeTabId = tabId;
  }

  /** Get the tab memory for the active tab */
  getTabMemory() {
    return getTabMemory(this.activeTabId, this.config.projectId);
  }

  /** Notify Retrieval which files are open in current tab */
  setOpenFiles(filePaths: string[]) {
    const mem = this.getTabMemory();
    mem.openFiles = new Set(filePaths);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /** Clear embedding cache (e.g. when switching projects) */
  clearCache() {
    clearEmbedCache();
    this.cachedSymbols = null;
  }
}

/** @deprecated Use RetrievalConfig instead */
export type OrchestratorConfig = RetrievalConfig;

// ─── Backward compatibility alias ─────────────────────────────────────────────

/** @deprecated Use Retrieval instead */
export const Orchestrator = Retrieval;
