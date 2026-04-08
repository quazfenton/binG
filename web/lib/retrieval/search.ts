/**
 * search.ts — Full hybrid retrieval pipeline
 *
 * Flow:
 *   embed query → vector candidates → keyword grep → graph expand → rerank → top symbols
 */

import { embed } from "../memory/embeddings";
import {
  getProjectSymbols,
  getEdgesFrom,
  type VectorEntry,
  type EdgeEntry,
} from "../memory/vectorStore";
import {
  cosineSimilarity,
  rankSymbols,
  expandGraph,
  type RankingContext,
  type RankedSymbol,
} from "./similarity";

// ─── Tab Memory ───────────────────────────────────────────────────────────────

export interface TabMemory {
  tabId: string;
  projectId: string;
  openFiles: Set<string>;
  recentSymbols: string[]; // ordered, newest first
  lastQueries: string[];
}

const TAB_MEMORIES = new Map<string, TabMemory>();

export function getTabMemory(tabId: string, projectId: string): TabMemory {
  if (!TAB_MEMORIES.has(tabId)) {
    TAB_MEMORIES.set(tabId, {
      tabId,
      projectId,
      openFiles: new Set(),
      recentSymbols: [],
      lastQueries: [],
    });
  }
  return TAB_MEMORIES.get(tabId)!;
}

export function updateTabMemory(
  tabId: string,
  update: Partial<Pick<TabMemory, "openFiles" | "recentSymbols" | "lastQueries">>
): void {
  const mem = TAB_MEMORIES.get(tabId);
  if (!mem) return;

  if (update.openFiles) mem.openFiles = update.openFiles;
  if (update.recentSymbols) {
    mem.recentSymbols = [
      ...update.recentSymbols,
      ...mem.recentSymbols,
    ].slice(0, 50);
  }
  if (update.lastQueries) {
    mem.lastQueries = [
      ...update.lastQueries,
      ...mem.lastQueries,
    ].slice(0, 20);
  }
}

export function recordSymbolAccess(tabId: string, symbolId: string): void {
  const mem = TAB_MEMORIES.get(tabId);
  if (!mem) return;
  mem.recentSymbols = [symbolId, ...mem.recentSymbols.filter((s) => s !== symbolId)].slice(0, 50);
}

// ─── Grep (keyword) Search ────────────────────────────────────────────────────

export interface GrepResult {
  symbolId: string;
  lineNumber: number;
  matchLine: string;
  contextBefore: string[];
  contextAfter: string[];
}

export function grepSymbols(
  symbols: VectorEntry[],
  query: string,
  contextLines = 2
): Map<string, GrepResult[]> {
  const results = new Map<string, GrepResult[]>();
  const lq = query.toLowerCase();

  for (const symbol of symbols) {
    const lines = symbol.content.split("\n");
    const matches: GrepResult[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lq)) {
        matches.push({
          symbolId: symbol.id,
          lineNumber: symbol.startLine + i,
          matchLine: lines[i],
          contextBefore: lines.slice(Math.max(0, i - contextLines), i),
          contextAfter: lines.slice(i + 1, i + 1 + contextLines),
        });
      }
    }

    if (matches.length > 0) {
      results.set(symbol.id, matches);
    }
  }

  return results;
}

// ─── Main Search Function ─────────────────────────────────────────────────────

export interface SearchOptions {
  projectId: string;
  tabId?: string;
  topK?: number;
  editContext?: RankingContext["editContext"];
  /** Preloaded symbols — pass if you're calling search multiple times */
  cachedSymbols?: VectorEntry[];
}

export interface SearchResult {
  symbols: RankedSymbol[];
  grepMatches: Map<string, GrepResult[]>;
  queryEmbedding: number[];
  totalCandidates: number;
}

export async function search(
  query: string,
  opts: SearchOptions
): Promise<SearchResult> {
  // Input validation
  if (!query || typeof query !== "string") {
    return { symbols: [], grepMatches: new Map(), queryEmbedding: [], totalCandidates: 0 };
  }
  // Safety trim for very long queries
  if (query.length > 5000) {
    query = query.slice(0, 5000);
  }

  const {
    projectId,
    tabId,
    topK = 10,
    editContext,
    cachedSymbols,
  } = opts;

  // 1. Embed the query
  const queryEmbedding = await embed(query);

  // 2. Load all symbols for this project
  const allSymbols = cachedSymbols ?? (await getProjectSymbols(projectId));

  if (allSymbols.length === 0) {
    return {
      symbols: [],
      grepMatches: new Map(),
      queryEmbedding,
      totalCandidates: 0,
    };
  }

  // 3. Semantic shortlist — fast cosine pass to get top 50 candidates
  const withScores = allSymbols
    .map((s) => ({
      ...s,
      semanticScore: cosineSimilarity(queryEmbedding, s.embedding),
    }))
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, 50);

  const topIds = withScores.slice(0, 20).map((s) => s.id);

  // 4. Graph expansion from semantic hits
  const edges: EdgeEntry[] = await getEdgesFrom(projectId, topIds);
  const edgeMap = new Map<string, string[]>();

  for (const edge of edges) {
    if (!edgeMap.has(edge.fromId)) edgeMap.set(edge.fromId, []);
    edgeMap.get(edge.fromId)!.push(edge.toId);
  }

  const graphNeighbors = expandGraph(topIds, edgeMap, 2);

  // 5. Get expanded candidates (semantic + graph neighbors)
  const expandedIds = new Set([...topIds, ...graphNeighbors.keys()]);
  const candidateSymbols = allSymbols.filter((s) => expandedIds.has(s.id));

  // 6. Keyword grep across all symbols
  const grepMatches = grepSymbols(allSymbols, query);

  // Boost grep hits in graphNeighbors
  for (const [symbolId] of grepMatches) {
    if (!graphNeighbors.has(symbolId)) {
      graphNeighbors.set(symbolId, 0.3); // slight graph credit for grep matches
    }
    // Also pull them into candidates if not already
    const s = allSymbols.find((x) => x.id === symbolId);
    if (s && !expandedIds.has(symbolId)) {
      candidateSymbols.push(s);
    }
  }

  // 7. Build ranking context
  const tab = tabId ? getTabMemory(tabId, projectId) : null;

  const ctx: RankingContext = {
    queryEmbedding,
    queryText: query,
    graphNeighbors,
    recentSymbols: new Set(tab?.recentSymbols ?? []),
    openFiles: tab?.openFiles ?? new Set(),
    editContext,
  };

  // 8. Rank candidates
  const ranked = rankSymbols(candidateSymbols, ctx, topK);

  // 9. Update tab memory
  if (tab) {
    updateTabMemory(tab.tabId, { lastQueries: [query] });
    updateTabMemory(tab.tabId, { recentSymbols: ranked.slice(0, 5).map((s) => s.id) });
  }

  return {
    symbols: ranked,
    grepMatches,
    queryEmbedding,
    totalCandidates: candidateSymbols.length,
  };
}
