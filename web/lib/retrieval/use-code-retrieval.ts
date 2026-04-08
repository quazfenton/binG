/**
 * useCodeRetrieval.ts — Parallel retrieval hook alongside smart-context
 *
 * Provides AST-based, symbol-level code retrieval using the new memory module.
 * Runs parallel to the existing VFS smart-context — no breaking changes.
 *
 * Usage in a React component:
 *   const { search, indexedFiles, isIndexing } = useCodeRetrieval({
 *     projectId: 'my-project',
 *     userId: 'user-123',
 *   });
 *
 *   const results = await search('How does authentication work?');
 */

import { useCallback, useRef, useState, useEffect } from "react";
import {
  Retrieval,
  type RetrievalConfig,
  trace,
} from "../memory";
import type { SearchResult } from "../retrieval/search";
import { retrieveHybrid, type HybridRetrievalOptions, type HybridRetrievalResult } from "./hybrid-retrieval";

export interface UseCodeRetrievalOptions {
  /** Stable project identifier — same ID across sessions for persistence */
  projectId: string;
  /** Human-readable project name (for system prompt) */
  projectName?: string;
  /** LLM provider function — called for Q&A */
  llm?: RetrievalConfig["llm"];
  /** Streaming LLM — called for streaming Q&A */
  streamLLM?: RetrievalConfig["streamLLM"];
  /** Diff applier — required for editFile */
  applyDiff?: RetrievalConfig["applyDiff"];
  /** File writer — called on successful edit */
  writeFile?: RetrievalConfig["writeFile"];
}

export interface UseCodeRetrievalReturn {
  /** The Retrieval instance — direct access for advanced usage */
  retrieval: Retrieval | null;
  /** Whether the Retrieval is being initialized */
  isInitializing: boolean;
  /** Whether indexing is in progress */
  isIndexing: boolean;
  /** Number of files indexed so far */
  indexedFileCount: number;
  /** Index a batch of files */
  indexFiles: (
    files: Array<{ path: string; content: string }>,
    opts?: { onProgress?: (done: number, total: number, file: string) => void }
  ) => Promise<void>;
  /** Search the indexed codebase — returns ranked symbols */
  search: (query: string, opts?: { topK?: number; maxContextTokens?: number }) => Promise<SearchResult>;
  /** Ask a question about the codebase — returns full LLM response */
  ask: (question: string, opts?: { maxContextTokens?: number }) => Promise<string>;
  /** Edit a file with self-correcting agent loop */
  editFile: (opts: {
    path: string;
    content: string;
    task: string;
    maxIterations?: number;
    cursorLine?: number;
    onIteration?: (info: { iteration: number; status: string; error?: string }) => void;
  }) => Promise<{ success: boolean; content: string; iterations: number; error?: string }>;
  /** Switch active tab for retrieval ranking */
  setActiveTab: (tabId: string) => void;
  /** Notify which files are open in current tab */
  setOpenFiles: (filePaths: string[]) => void;
  /** Clear caches (e.g. when switching projects) */
  clearCache: () => void;
  /** Hybrid retrieval: AST symbols → smart-context fallback */
  hybridSearch: (
    query: string,
    userId: string,
    opts?: {
      explicitFiles?: string[];
      scopePath?: string;
      tabId?: string;
      maxContextTokens?: number;
    }
  ) => Promise<HybridRetrievalResult>;
}

/**
 * Hook that creates and manages a Retrieval instance.
 * Runs parallel to existing smart-context — no breaking changes to VFS.
 */
export function useCodeRetrieval(
  opts: UseCodeRetrievalOptions
): UseCodeRetrievalReturn {
  const { projectId, projectName, llm, streamLLM, applyDiff, writeFile } = opts;

  const [retrieval, setRetrieval] = useState<Retrieval | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexedFileCount, setIndexedFileCount] = useState(0);

  // Keep stable refs to avoid re-init on every render
  const llmRef = useRef(llm);
  const streamLLMRef = useRef(streamLLM);
  const applyDiffRef = useRef(applyDiff);
  const writeFileRef = useRef(writeFile);

  // Update refs when options change
  useEffect(() => { llmRef.current = llm; }, [llm]);
  useEffect(() => { streamLLMRef.current = streamLLM; }, [streamLLM]);
  useEffect(() => { applyDiffRef.current = applyDiff; }, [applyDiff]);
  useEffect(() => { writeFileRef.current = writeFile; }, [writeFile]);

  // Keep a ref to avoid stale closures in callbacks
  const retrievalRef = useRef<Retrieval | null>(null);

  // Initialize Retrieval on mount — uses projectId as stable dependency only
  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!llmRef.current) return;

      setIsInitializing(true);
      try {
        const r = new Retrieval({
          projectId,
          projectName,
          llm: llmRef.current,
          streamLLM: streamLLMRef.current,
          applyDiff: applyDiffRef.current,
          writeFile: writeFileRef.current,
        });
        if (mounted) {
          setRetrieval(r);
          retrievalRef.current = r;
        }
      } catch (err) {
        console.error("[useCodeRetrieval] Failed to initialize Retrieval:", err);
      } finally {
        if (mounted) setIsInitializing(false);
      }
    }

    init();
    return () => { mounted = false; };
  }, [projectId]); // Only projectId — stable across renders

  // Index files
  const indexFiles = useCallback(
    async (
      files: Array<{ path: string; content: string }>,
      opts?: { onProgress?: (done: number, total: number, file: string) => void }
    ) => {
      if (!retrievalRef.current) return;

      setIsIndexing(true);
      try {
        const results = await trace("index-files", () =>
          retrievalRef.current!.indexFiles(files, {
            ...opts,
            recomputePageRank: true,
          })
        );
        const indexed = results.filter((r) => !r.skipped).length;
        setIndexedFileCount((prev) => prev + indexed);
      } finally {
        setIsIndexing(false);
      }
    },
    []
  );

  // Search
  const search = useCallback(
    async (
      query: string,
      searchOpts?: { topK?: number; maxContextTokens?: number }
    ): Promise<SearchResult> => {
      if (!retrievalRef.current) {
        return { symbols: [], grepMatches: new Map(), queryEmbedding: [], totalCandidates: 0 };
      }
      return retrievalRef.current.searchSymbols(query, { topK: searchOpts?.topK });
    },
    []
  );

  // Ask a question
  const ask = useCallback(
    async (question: string, opts?: { maxContextTokens?: number }): Promise<string> => {
      if (!retrievalRef.current) return "Retrieval not initialized.";
      return retrievalRef.current.ask(question, { maxContextTokens: opts?.maxContextTokens });
    },
    []
  );

  // Edit a file
  const editFile = useCallback(
    async (editOpts: {
      path: string;
      content: string;
      task: string;
      maxIterations?: number;
      cursorLine?: number;
      onIteration?: (info: { iteration: number; status: string; error?: string }) => void;
    }): Promise<{ success: boolean; content: string; iterations: number; error?: string }> => {
      if (!retrievalRef.current) {
        return { success: false, content: editOpts.content, iterations: 0, error: "Retrieval not initialized" };
      }
      const result = await retrievalRef.current.editFile({
        path: editOpts.path,
        content: editOpts.content,
        task: editOpts.task,
        maxIterations: editOpts.maxIterations,
        cursorLine: editOpts.cursorLine,
        onIteration: editOpts.onIteration,
      });
      return {
        success: result.success,
        content: result.content,
        iterations: result.iterations,
        error: result.error,
      };
    },
    []
  );

  // Tab management
  const setActiveTab = useCallback((tabId: string) => {
    retrievalRef.current?.setActiveTab(tabId);
  }, []);

  const setOpenFiles = useCallback((filePaths: string[]) => {
    retrievalRef.current?.setOpenFiles(filePaths);
  }, []);

  // Clear caches
  const clearCache = useCallback(() => {
    retrievalRef.current?.clearCache();
  }, []);

  // Hybrid retrieval — tries AST-based symbol retrieval, falls back to smart-context
  const hybridSearch = useCallback(
    async (
      query: string,
      userId: string,
      searchOpts?: {
        explicitFiles?: string[];
        scopePath?: string;
        tabId?: string;
        maxContextTokens?: number;
      }
    ): Promise<HybridRetrievalResult> => {
      return retrieveHybrid({
        userId,
        projectId,
        prompt: query,
        explicitFiles: searchOpts?.explicitFiles,
        currentProjectPath: searchOpts?.scopePath,
        scopePath: searchOpts?.scopePath,
        tabId: searchOpts?.tabId ?? retrievalRef.current?.getTabMemory().tabId,
        maxContextTokens: searchOpts?.maxContextTokens,
      });
    },
    [projectId]
  );

  return {
    retrieval,
    isInitializing,
    isIndexing,
    indexedFileCount,
    indexFiles,
    search,
    ask,
    editFile,
    setActiveTab,
    setOpenFiles,
    clearCache,
    hybridSearch,
  };
}
