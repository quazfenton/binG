/**
 * In-Memory Vector Store
 * 
 * Web-compatible vector store using in-memory Map with optional
 * JSON persistence via the platform storage adapter.
 * 
 * Designed as a drop-in for the VectorStore interface so desktop
 * can swap in a SQLite/HNSW backend behind the same contract.
 * 
 * @module vector-memory/store
 */

import { cosineSimilarity } from './similarity';
import type { VectorEntry, VectorStore, VectorFilter, SearchResult } from './types';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('VectorStore');

export class InMemoryVectorStore implements VectorStore {
  private entries = new Map<string, VectorEntry>();
  // CRIT fix: Add max entries with LRU eviction to prevent unbounded memory growth.
  // Each entry is ~12KB (1536-dim embedding + text). 10K entries = ~120MB.
  // Default 5000 entries ≈ 60MB cap. Configurable via VECTOR_STORE_MAX_ENTRIES env.
  private readonly maxEntries: number;
  private entryOrder: string[] = []; // Track insertion order for LRU eviction

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? parseInt(process.env.VECTOR_STORE_MAX_ENTRIES || '5000', 10) || 5000;
  }

  async add(entry: VectorEntry): Promise<void> {
    // CRIT fix: Evict oldest entries if at capacity
    this.evictIfNeeded();
    this.entries.set(entry.id, entry);
    // Track insertion order
    const idx = this.entryOrder.indexOf(entry.id);
    if (idx !== -1) this.entryOrder.splice(idx, 1);
    this.entryOrder.push(entry.id);
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.evictIfNeeded();
      this.entries.set(entry.id, entry);
      const idx = this.entryOrder.indexOf(entry.id);
      if (idx !== -1) this.entryOrder.splice(idx, 1);
      this.entryOrder.push(entry.id);
    }
  }

  async search(
    query: number[],
    k: number,
    filter?: VectorFilter
  ): Promise<SearchResult[]> {
    const candidates: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (filter && !this.matchesFilter(entry, filter)) continue;

      // LOW fix: Skip entries with dimension mismatch — cosineSimilarity returns 0
      // but we want to skip them entirely to avoid polluting results with zero-scores
      if (query.length !== entry.embedding.length) {
        logger.warn('Skipping entry with mismatched embedding dimensions', {
          entryId: entry.id,
          queryDim: query.length,
          entryDim: entry.embedding.length,
        });
        continue;
      }

      const score = cosineSimilarity(query, entry.embedding);
      candidates.push({ entry, score });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.entryOrder.indexOf(id);
    if (idx !== -1) this.entryOrder.splice(idx, 1);
    return this.entries.delete(id);
  }

  async removeByFilter(filter: VectorFilter): Promise<number> {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (this.matchesFilter(entry, filter)) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async count(filter?: VectorFilter): Promise<number> {
    if (!filter) return this.entries.size;

    let count = 0;
    for (const entry of this.entries.values()) {
      if (this.matchesFilter(entry, filter)) count++;
    }
    return count;
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.entryOrder = [];
  }

  /**
   * CRIT fix: Evict oldest entries when at capacity (LRU policy)
   */
  private evictIfNeeded(): void {
    while (this.entries.size >= this.maxEntries && this.entryOrder.length > 0) {
      const oldestId = this.entryOrder.shift()!;
      this.entries.delete(oldestId);
      logger.debug('Evicted vector entry (LRU)', { entryId: oldestId, remaining: this.entries.size });
    }
  }

  private matchesFilter(entry: VectorEntry, filter: VectorFilter): boolean {
    if (filter.projectId && entry.metadata.projectId !== filter.projectId) return false;
    if (filter.filePath && entry.metadata.filePath !== filter.filePath) return false;
    if (filter.source && entry.metadata.source !== filter.source) return false;
    return true;
  }
}

export function createVectorStore(): VectorStore {
  return new InMemoryVectorStore();
}
