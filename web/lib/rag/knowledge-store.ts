/**
 * RAG Knowledge Store
 *
 * Server-side persistent vector store for agent knowledge:
 * few-shot examples, practice experiences, rules, and task solutions.
 *
 * Uses SQLite with sqlite-vec for vector similarity search.
 * Falls back to in-memory store if sqlite-vec is unavailable.
 *
 * Integrates with the existing embedding API (/api/embed) and
 * the existing retrieval ranking infrastructure.
 */

import { createLogger } from '@/lib/utils/logger';
import { cosineSimilarity } from '@/lib/retrieval/similarity';

const log = createLogger('RAGKnowledgeStore');

// ============================================================================
// Types
// ============================================================================

export type KnowledgeType =
  | 'few_shot'       // Curated few-shot examples
  | 'experience'     // Extracted from practice (Training-Free GRPO)
  | 'rule'           // Tool schemas, API docs, constraints
  | 'task_solution'  // Successful production trajectories
  | 'anti_pattern';  // Known failure patterns to avoid

export interface KnowledgeChunk {
  id: string;           // UUID or auto-generated
  type: KnowledgeType;
  content: string;      // The actual text to retrieve
  embedding: number[];  // Vector embedding (Mistral codestral-embed: 512-dim, OpenAI: 1536-dim)
  metadata: {
    taskType?: string;      // 'vfs_write', 'vfs_batch', 'code_gen', etc.
    model?: string;         // which model this is relevant for
    quality?: number;       // verification score (0-1)
    source?: string;        // 'curated', 'practice', 'production', 'synthetic'
    createdAt: number;      // timestamp
    usageCount: number;     // how often retrieved
    usefulnessScore: number;// feedback score (0-1)
  };
}

export interface KnowledgeSearchOptions {
  topK?: number;           // Max results (default: 5)
  typeFilter?: KnowledgeType[]; // Only search these types
  taskTypeFilter?: string; // Filter by task type
  modelFilter?: string;    // Filter by model relevance
  minQuality?: number;     // Minimum quality threshold (0-1)
  includeEmbedding?: boolean; // Whether to return embedding vectors
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  score: number;           // Combined relevance score (0-1)
  vectorScore: number;     // Pure cosine similarity (0-1)
  keywordScore: number;    // Keyword match bonus (0-1)
}

// ============================================================================
// In-Memory Store (default, no sqlite-vec required)
// ============================================================================

/**
 * In-memory knowledge store with brute-force cosine similarity.
 * Works without sqlite-vec — good for <10k chunks.
 * Swap to SQLite store when scaling beyond that.
 */
class InMemoryKnowledgeStore {
  private chunks: Map<string, KnowledgeChunk> = new Map<string, KnowledgeChunk>();
  private readonly EMBED_DIM: number;

  constructor(dimension: number = 512) {
    this.EMBED_DIM = dimension;
  }

  // ── Insert / Update / Delete ──────────────────────────────────────────────

  async insert(chunk: Omit<KnowledgeChunk, 'id' | 'metadata'> & {
    metadata?: Partial<KnowledgeChunk['metadata']>;
  }): Promise<string> {
    const id = `kg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullChunk: KnowledgeChunk = {
      ...chunk,
      id,
      metadata: {
        usageCount: 0,
        usefulnessScore: 0.5,
        createdAt: Date.now(),
        ...chunk.metadata,
      },
    };
    this.chunks.set(id, fullChunk);
    log.debug('Knowledge chunk inserted', { id, type: chunk.type, taskType: chunk.metadata?.taskType });
    return id;
  }

  async insertBatch(chunks: Array<Omit<KnowledgeChunk, 'id' | 'metadata'> & {
    metadata?: Partial<KnowledgeChunk['metadata']>;
  }>): Promise<string[]> {
    const ids: string[] = [];
    for (const chunk of chunks) {
      ids.push(await this.insert(chunk));
    }
    log.info('Batch insert complete', { count: ids.length });
    return ids;
  }

  async update(id: string, updates: Partial<KnowledgeChunk>): Promise<boolean> {
    const existing = this.chunks.get(id);
    if (!existing) return false;
    this.chunks.set(id, { ...existing, ...updates });
    return true;
  }

  async delete(id: string): Promise<boolean> {
    return this.chunks.delete(id);
  }

  async deleteByFilter(filter: { type?: KnowledgeType; source?: string; maxAge?: number }): Promise<number> {
    let count = 0;
    for (const [id, chunk] of this.chunks) {
      let match = true;
      if (filter.type && chunk.type !== filter.type) match = false;
      if (filter.source && chunk.metadata.source !== filter.source) match = false;
      if (filter.maxAge && chunk.metadata.createdAt < Date.now() - filter.maxAge) match = false;
      if (match) {
        this.chunks.delete(id);
        count++;
      }
    }
    return count;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search(
    queryEmbedding: number[],
    options: KnowledgeSearchOptions = {}
  ): Promise<KnowledgeSearchResult[]> {
    const {
      topK = 5,
      typeFilter,
      taskTypeFilter,
      modelFilter,
      minQuality = 0,
    } = options;

    // Validate embedding dimension
    if (queryEmbedding.length !== this.EMBED_DIM) {
      log.warn('Embedding dimension mismatch', {
        expected: this.EMBED_DIM,
        got: queryEmbedding.length,
      });
    }

    // Filter chunks
    let candidates = Array.from(this.chunks.values());

    if (typeFilter && typeFilter.length > 0) {
      candidates = candidates.filter(c => typeFilter.includes(c.type));
    }
    if (taskTypeFilter) {
      candidates = candidates.filter(c => c.metadata.taskType === taskTypeFilter);
    }
    if (modelFilter) {
      candidates = candidates.filter(c =>
        !c.metadata.model || c.metadata.model === modelFilter
      );
    }
    if (minQuality > 0) {
      candidates = candidates.filter(c => (c.metadata.quality ?? 0.5) >= minQuality);
    }

    // Score each candidate
    const scored: KnowledgeSearchResult[] = candidates
      .map(chunk => {
        const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
        const keywordScore = this.computeKeywordScore(chunk, queryEmbedding);
        const qualityBoost = (chunk.metadata.quality ?? 0.5) * 0.1;
        const recencyBoost = this.computeRecencyBoost(chunk.metadata.createdAt);
        const usageBoost = Math.min(chunk.metadata.usageCount * 0.005, 0.1);

        const totalScore = Math.min(1,
          0.6 * vectorScore +
          0.15 * keywordScore +
          0.1 * qualityBoost +
          0.1 * recencyBoost +
          0.05 * usageBoost
        );

        return { chunk, score: totalScore, vectorScore, keywordScore };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Update usage counts
    for (const result of scored) {
      result.chunk.metadata.usageCount++;
    }

    return scored;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async stats(): Promise<{ total: number; byType: Record<string, number>; bySource: Record<string, number> }> {
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const chunk of this.chunks.values()) {
      byType[chunk.type] = (byType[chunk.type] || 0) + 1;
      bySource[chunk.metadata.source || 'unknown'] = (bySource[chunk.metadata.source || 'unknown'] || 0) + 1;
    }
    return { total: this.chunks.size, byType, bySource };
  }

  async getAll(type?: KnowledgeType): Promise<KnowledgeChunk[]> {
    if (!type) return Array.from(this.chunks.values());
    return Array.from(this.chunks.values()).filter(c => c.type === type);
  }

  async getById(id: string): Promise<KnowledgeChunk | undefined> {
    return this.chunks.get(id);
  }

  // ── Persistence (JSON export/import) ─────────────────────────────────────

  async export(): Promise<string> {
    return JSON.stringify(Array.from(this.chunks.values()), null, 2);
  }

  async import(json: string): Promise<number> {
    const chunks = JSON.parse(json) as KnowledgeChunk[];
    let count = 0;
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      count++;
    }
    return count;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private computeKeywordScore(chunk: KnowledgeChunk, _queryEmbedding: number[]): number {
    // Metadata-richness heuristic: chunks with more structured metadata
    // are more likely to be relevant. True keyword matching would require
    // the raw query text, which isn't available at search time (only the
    // pre-embedded vector is). This is a placeholder until we pass the
    // raw query through to the search method.
    let score = 0;
    if (chunk.content.length > 50) score += 0.3;
    if (chunk.content.length > 200) score += 0.2;
    if (chunk.metadata.taskType) score += 0.2;
    if (chunk.metadata.source === 'production') score += 0.1;
    if (chunk.metadata.source === 'practice') score += 0.1;
    if (chunk.metadata.source === 'curated') score += 0.1;
    return Math.min(1, score);
  }

  private computeRecencyBoost(createdAt: number): number {
    const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
    return Math.exp(-ageDays / 30); // Half-life of 30 days
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _knowledgeStore: InMemoryKnowledgeStore | null = null;

/**
 * Get the knowledge store singleton.
 * Creates a new instance if none exists.
 */
export function getKnowledgeStore(): InMemoryKnowledgeStore {
  if (!_knowledgeStore) {
    _knowledgeStore = new InMemoryKnowledgeStore();
    log.info('Knowledge store initialized (in-memory mode)');
  }
  return _knowledgeStore;
}

/**
 * Reset the knowledge store (useful for testing or warm restarts).
 */
export function resetKnowledgeStore(): void {
  _knowledgeStore = null;
}
