/**
 * index.ts — Public API barrel
 *
 * Import everything you need from here:
 *   import { Retrieval, ProjectIndexer, search, buildContext } from "@/lib/memory";
 */

// ─── Core Retrieval ────────────────────────────────────────────────────────────
export { Retrieval } from "../agent/orchestrator";
export { Orchestrator } from "../agent/orchestrator"; // backward compat alias
export type { RetrievalConfig, OrchestratorConfig } from "../agent/orchestrator";

// ─── Indexing ─────────────────────────────────────────────────────────────────
export { ProjectIndexer, projectIdFromPath } from "../memory/indexer";

// ─── Memory / Vector Store ────────────────────────────────────────────────────
export {
  upsertSymbol,
  upsertSymbols,
  upsertEdges,
  getProjectSymbols,
  getFileSymbols,
  deleteFileSymbols,
  deleteProject,
  listProjects,
  upsertProject,
} from "../memory/vectorStore";
export type { VectorEntry, EdgeEntry, ProjectMeta } from "../memory/vectorStore";

// ─── Embeddings ───────────────────────────────────────────────────────────────
export { embed, embedBatch, buildSymbolEmbedInput, clearEmbedCache } from "../memory/embeddings";

// ─── Chunking ─────────────────────────────────────────────────────────────────
export { chunkText, chunkByLines, chunkBySections } from "../memory/chunk";
export type { Chunk } from "../memory/chunk";

// ─── Retrieval ────────────────────────────────────────────────────────────────
export { search, getTabMemory, updateTabMemory, recordSymbolAccess } from "../retrieval/search";
export type { SearchOptions, SearchResult, TabMemory } from "../retrieval/search";

export {
  retrieveHybrid,
  buildPromptWithContext,
} from "../retrieval/hybrid-retrieval";
export type { HybridRetrievalOptions, HybridRetrievalResult } from "../retrieval/hybrid-retrieval";

export {
  runContextPipeline,
  buildPipelineSystemMessage,
} from "../retrieval/context-pipeline";
export type { ContextSourceResult, PipelineContextOptions } from "../retrieval/context-pipeline";

export {
  cosineSimilarity,
  rankSymbols,
  expandGraph,
  computePageRank,
} from "../retrieval/similarity";
export type { RankedSymbol, RankingContext } from "../retrieval/similarity";

// ─── Symbol Extraction ────────────────────────────────────────────────────────
export {
  extractSymbols,
  detectLanguage,
  initParser,
  buildVectorEntry,
  symbolEmbedInput,
} from "../retrieval/symbolExtractor";
export type { ExtractedSymbol, SymbolKind, Language } from "../retrieval/symbolExtractor";

// ─── Context Building ─────────────────────────────────────────────────────────
export {
  buildContext,
  injectContextIntoPrompt,
  buildSystemPrompt,
  estimateTokens,
} from "../context/contextBuilder";
export type { BuiltContext, ContextBuilderOptions } from "../context/contextBuilder";

// ─── Agent Loop ───────────────────────────────────────────────────────────────
export {
  runAgentLoop,
  runMultiFileAgent,
  defaultValidate,
} from "../agent/agentLoop";
export type { AgentLoopOptions, AgentResult, PatchResult, IterationInfo } from "../agent/agentLoop";

// ─── Platform ─────────────────────────────────────────────────────────────────
export {
  isDesktop,
  readFile,
  writeFile,
  readDirectory,
  watchDirectory,
  grepFiles,
  pickFolder,
} from "../memory/platform";
export type { FileEntry, FileChangeEvent, GrepMatch } from "../memory/platform";

// ─── Plugins ──────────────────────────────────────────────────────────────────
export {
  PluginRegistry,
  createGitPlugin,
  createLintPlugin,
  createTscPlugin,
} from "../agent/plugins";
export type { Plugin, PluginContext } from "../agent/plugins";

// ─── Metrics ──────────────────────────────────────────────────────────────────
export { trace, increment, getCounter, getMetricsSummary, clearMetrics, setMetricsLogger } from "../agent/metrics";
export type { TraceEntry, MetricsSummary } from "../agent/metrics";

// ─── Validated Agent Loop (with plugin validation + rollback) ─────────────────
export { runValidatedAgentLoop } from "../agent/validated-agent-loop";
export type { ValidatedAgentLoopOptions, ValidatedAgentResult } from "../agent/validated-agent-loop";

// ─── File Watcher → Auto-Reindex ──────────────────────────────────────────────
export { watchAndReindex } from "../memory/file-watcher-reindex";
export type { WatcherReindexOptions, WatcherHandle } from "../memory/file-watcher-reindex";
