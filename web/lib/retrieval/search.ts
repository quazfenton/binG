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
const TAB_MEMORY_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL
const MAX_TAB_MEMORIES = 100; // Maximum number of tab memories

// Export TAB_MEMORIES for cache-exporter integration
export { TAB_MEMORIES };

/**
 * Evict oldest entries if cache exceeds max size.
 * Called automatically when adding new entries.
 */
function evictOldestTabMemories(): number {
  if (TAB_MEMORIES.size < MAX_TAB_MEMORIES) return 0;
  let cleaned = 0;
  // Remove oldest entries until under limit (Map maintains insertion order)
  while (TAB_MEMORIES.size >= MAX_TAB_MEMORIES && TAB_MEMORIES.size > 0) {
    const firstKey = TAB_MEMORIES.keys().next().value;
    if (firstKey) {
      TAB_MEMORIES.delete(firstKey);
      cleaned++;
    }
  }
  return cleaned;
}

/**
 * Cleanup stale tab memories to prevent memory leaks.
 * Called periodically or on memory pressure.
 */
export function cleanupStaleTabMemories(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [tabId, mem] of TAB_MEMORIES.entries()) {
    // Check if tab memory is stale (empty and older than TTL)
    const isStale = !mem.lastQueries.length && !mem.recentSymbols.length;
    if (isStale || TAB_MEMORIES.size > MAX_TAB_MEMORIES) {
      TAB_MEMORIES.delete(tabId);
      cleaned++;
    }
  }
  return cleaned;
}

/**
 * Clear all tab memories (for testing or reset)
 */
export function clearAllTabMemories(): void {
  TAB_MEMORIES.clear();
}

export function getTabMemory(tabId: string, projectId: string): TabMemory {
  // Auto-evict if at capacity
  evictOldestTabMemories();
  
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

// ─── Tab Memory Export/Import for Cache Persistence ─────────────────────────

/**
 * Get all tab memories for export (cache persistence)
 */
export function getAllTabMemories(): TabMemory[] {
  return Array.from(TAB_MEMORIES.values());
}

/**
 * Set a tab memory (for cache restoration)
 */
export function setTabMemory(tabId: string, mem: TabMemory): void {
  // Convert openFiles from array back to Set if needed
  const entry: TabMemory = {
    ...mem,
    openFiles: mem.openFiles instanceof Set ? mem.openFiles : new Set(mem.openFiles),
  };
  TAB_MEMORIES.set(tabId, entry);
}

/**
 * Get tab memory by ID
 */
export function getTabMemoryById(tabId: string): TabMemory | undefined {
  return TAB_MEMORIES.get(tabId);
}

/**
 * Delete a tab memory
 */
export function deleteTabMemory(tabId: string): boolean {
  return TAB_MEMORIES.delete(tabId);
}

/**
 * Clear all tab memories
 */
export function clearAllTabMemories(): void {
  TAB_MEMORIES.clear();
}

/**
 * Get tab memory statistics
 */
export function getTabMemoryStats(): {
  count: number;
  maxSize: number;
  oldestEntry: number | null;
  newestEntry: number | null;
} {
  const entries = Array.from(TAB_MEMORIES.values());
  let oldest: number | null = null;
  let newest: number | null = null;
  
  for (const mem of entries) {
    const time = mem.lastQueries.length > 0 ? Date.now() : null;
    if (time !== null) {
      if (oldest === null || time < oldest) oldest = time;
      if (newest === null || time > newest) newest = time;
    }
  }
  
  return {
    count: TAB_MEMORIES.size,
    maxSize: MAX_TAB_MEMORIES,
    oldestEntry: oldest,
    newestEntry: newest,
  };
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
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(query);
  } catch (embedError: any) {
    console.error('[Search] ❌ Query embedding failed', {
      error: embedError.message,
      queryLength: query.length,
      queryPreview: query.slice(0, 200),
      projectId,
      tabId,
    });
    // Return empty result - caller should handle fallback
    return {
      symbols: [],
      grepMatches: new Map(),
      queryEmbedding: [],
      totalCandidates: 0,
    };
  }

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
