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

  async add(entry: VectorEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
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

      const score = cosineSimilarity(query, entry.embedding);
      candidates.push({ entry, score });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async remove(id: string): Promise<boolean> {
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
