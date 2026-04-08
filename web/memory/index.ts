/**
 * index.ts — Public API barrel
 *
 * Import everything you need from here:
 *   import { Orchestrator, ProjectIndexer, search, buildContext } from "@/lib";
 */

// ─── Core Orchestrator ────────────────────────────────────────────────────────
export { Orchestrator } from "./agent/orchestrator";
export type { OrchestratorConfig } from "./agent/orchestrator";

// ─── Indexing ─────────────────────────────────────────────────────────────────
export { ProjectIndexer, projectIdFromPath } from "./memory/indexer";

// ─── Memory / Vector Store ────────────────────────────────────────────────────
export {
  upsertSymbol,
  upsertSymbols,
  upsertEdges,
  getProjectSymbols,
  deleteProject,
  listProjects,
  upsertProject,
} from "./memory/vectorStore";
export type { VectorEntry, EdgeEntry, ProjectMeta } from "./memory/vectorStore";

// ─── Embeddings ───────────────────────────────────────────────────────────────
export { embed, embedBatch, buildSymbolEmbedInput, clearEmbedCache } from "./memory/embeddings";

// ─── Chunking ─────────────────────────────────────────────────────────────────
export { chunkText, chunkByLines, chunkBySections } from "./memory/chunk";
export type { Chunk } from "./memory/chunk";

// ─── Retrieval ────────────────────────────────────────────────────────────────
export { search, getTabMemory, updateTabMemory, recordSymbolAccess } from "./retrieval/search";
export type { SearchOptions, SearchResult, TabMemory } from "./retrieval/search";

export {
  cosineSimilarity,
  rankSymbols,
  expandGraph,
  computePageRank,
} from "./retrieval/similarity";
export type { RankedSymbol, RankingContext } from "./retrieval/similarity";

// ─── Symbol Extraction ────────────────────────────────────────────────────────
export {
  extractSymbols,
  detectLanguage,
  initParser,
  buildVectorEntry,
  symbolEmbedInput,
} from "./retrieval/symbolExtractor";
export type { ExtractedSymbol, SymbolKind, Language } from "./retrieval/symbolExtractor";

// ─── Context Building ─────────────────────────────────────────────────────────
export {
  buildContext,
  injectContextIntoPrompt,
  buildSystemPrompt,
  estimateTokens,
} from "./context/contextBuilder";
export type { BuiltContext, ContextBuilderOptions } from "./context/contextBuilder";

// ─── Agent Loop ───────────────────────────────────────────────────────────────
export {
  runAgentLoop,
  runMultiFileAgent,
  defaultValidate,
} from "./agent/agentLoop";
export type { AgentLoopOptions, AgentResult, PatchResult, IterationInfo } from "./agent/agentLoop";

// ─── Platform ─────────────────────────────────────────────────────────────────
export {
  isDesktop,
  readFile,
  writeFile,
  readDirectory,
  watchDirectory,
  grepFiles,
  pickFolder,
} from "./platform/platform";
export type { FileEntry, FileChangeEvent, GrepMatch } from "./platform/platform";

// ─── Plugins ──────────────────────────────────────────────────────────────────
export {
  PluginRegistry,
  createGitPlugin,
  createLintPlugin,
  createTscPlugin,
} from "./agent/plugins";
export type { Plugin, PluginContext } from "./agent/plugins";

// ─── Metrics ──────────────────────────────────────────────────────────────────
export { trace, increment, getCounter, getMetricsSummary, clearMetrics } from "./agent/metrics";
export type { TraceEntry, MetricsSummary } from "./agent/metrics";
