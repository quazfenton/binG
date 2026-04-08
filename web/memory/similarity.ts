/**
 * similarity.ts — Vector math and multi-signal ranking
 *
 * Final ranking formula (production-grade):
 *   score = 0.35*semantic + 0.20*keyword + 0.15*graph
 *         + 0.10*importance + 0.10*editBoost
 *         + 0.05*recency + 0.05*fileBoost
 */

import type { VectorEntry } from "./vectorStore";

// ─── Cosine Similarity ────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Keyword Score ────────────────────────────────────────────────────────────

export function keywordScore(symbol: VectorEntry, query: string): number {
  const q = query.toLowerCase();
  const name = symbol.name.toLowerCase();
  const content = symbol.content.toLowerCase();

  if (name === q) return 1.0;
  if (name.includes(q)) return 0.8;
  if (content.includes(q)) return 0.5;
  return 0;
}

// ─── Ranking Context ──────────────────────────────────────────────────────────

export interface RankingContext {
  queryEmbedding: number[];
  queryText: string;
  /** Set of symbol IDs reachable via graph from top semantic hits */
  graphNeighbors: Map<string, number>; // id → graph score (1=direct, 0.5=2-hop)
  /** Recently accessed symbol IDs in this tab */
  recentSymbols: Set<string>;
  /** Currently open file paths */
  openFiles: Set<string>;
  /** Currently edited file + cursor line (for edit-aware boost) */
  editContext?: {
    filePath: string;
    cursorLine: number;
    changedLines?: [number, number];
  };
}

// ─── Ranked Result ────────────────────────────────────────────────────────────

export interface RankedSymbol extends VectorEntry {
  score: number;
  scoreBreakdown: {
    semantic: number;
    keyword: number;
    graph: number;
    importance: number;
    editBoost: number;
    recency: number;
    fileBoost: number;
  };
}

// ─── Main Ranking Function ────────────────────────────────────────────────────

export function rankSymbols(
  symbols: VectorEntry[],
  ctx: RankingContext,
  topK = 10
): RankedSymbol[] {
  return symbols
    .map((s) => {
      const semantic = cosineSimilarity(ctx.queryEmbedding, s.embedding);
      const keyword = keywordScore(s, ctx.queryText);
      const graph = ctx.graphNeighbors.get(s.id) ?? 0;
      const importance = s.importance ?? 0.5;
      const recency = ctx.recentSymbols.has(s.id) ? 1 : 0;
      const fileBoost = ctx.openFiles.has(s.filePath) ? 1 : 0;
      const editBoost = computeEditBoost(s, ctx.editContext);

      const score =
        0.35 * semantic +
        0.20 * keyword +
        0.15 * graph +
        0.10 * importance +
        0.10 * editBoost +
        0.05 * recency +
        0.05 * fileBoost;

      return {
        ...s,
        score,
        scoreBreakdown: {
          semantic,
          keyword,
          graph,
          importance,
          editBoost,
          recency,
          fileBoost,
        },
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── Edit-Aware Boost ─────────────────────────────────────────────────────────

function computeEditBoost(
  symbol: VectorEntry,
  edit?: RankingContext["editContext"]
): number {
  if (!edit) return 0;

  if (symbol.filePath !== edit.filePath) return 0;

  // Exact overlap with changed lines
  if (edit.changedLines) {
    const [changeStart, changeEnd] = edit.changedLines;
    const overlaps =
      symbol.startLine <= changeEnd && symbol.endLine >= changeStart;
    if (overlaps) return 1.0;
  }

  // Proximity to cursor — inverse distance
  const distance = Math.abs(symbol.startLine - edit.cursorLine);
  const proximity = 1 / (1 + distance * 0.1);

  return proximity * 0.8; // max 0.8 for proximity-only
}

// ─── Graph Expansion ──────────────────────────────────────────────────────────

/**
 * Given a list of seed symbol IDs and an edge map, expand up to `depth` hops.
 * Returns a Map<symbolId, graphScore>.
 */
export function expandGraph(
  seedIds: string[],
  edgeMap: Map<string, string[]>, // fromId → [toId, ...]
  depth = 2
): Map<string, number> {
  const result = new Map<string, number>();
  const visited = new Set<string>();

  let frontier = seedIds;
  let currentScore = 1.0;

  for (let hop = 0; hop < depth; hop++) {
    const nextFrontier: string[] = [];

    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);

      if (!seedIds.includes(id)) {
        result.set(id, currentScore);
      }

      const neighbors = edgeMap.get(id) ?? [];
      nextFrontier.push(...neighbors);
    }

    frontier = nextFrontier;
    currentScore *= 0.5; // decay per hop
  }

  return result;
}

// ─── PageRank ─────────────────────────────────────────────────────────────────

/**
 * Simplified PageRank for symbol importance scoring.
 * Run this after indexing to pre-score symbols.
 * Returns a Map<symbolId, importanceScore>.
 */
export function computePageRank(
  symbolIds: string[],
  edges: Array<{ fromId: string; toId: string }>,
  iterations = 20,
  dampingFactor = 0.85
): Map<string, number> {
  const scores = new Map<string, number>();
  const N = symbolIds.length;

  // Initialize equally
  for (const id of symbolIds) {
    scores.set(id, 1 / N);
  }

  // Build adjacency
  const outDegree = new Map<string, number>();
  const inEdges = new Map<string, string[]>(); // toId → [fromIds]

  for (const { fromId, toId } of edges) {
    outDegree.set(fromId, (outDegree.get(fromId) ?? 0) + 1);
    if (!inEdges.has(toId)) inEdges.set(toId, []);
    inEdges.get(toId)!.push(fromId);
  }

  // Iterate
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();

    for (const id of symbolIds) {
      const incoming = inEdges.get(id) ?? [];
      let sum = 0;

      for (const fromId of incoming) {
        const deg = outDegree.get(fromId) ?? 1;
        sum += (scores.get(fromId) ?? 0) / deg;
      }

      newScores.set(id, (1 - dampingFactor) / N + dampingFactor * sum);
    }

    for (const [id, score] of newScores) {
      scores.set(id, score);
    }
  }

  // Normalize to [0, 1]
  const max = Math.max(...scores.values());
  if (max > 0) {
    for (const [id, score] of scores) {
      scores.set(id, score / max);
    }
  }

  return scores;
}
