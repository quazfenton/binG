/**
 * Vector Memory Types
 * 
 * Shared types for the vector memory subsystem.
 * @module vector-memory/types
 */

export interface VectorEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: VectorMetadata;
}

export interface VectorMetadata {
  source: string;
  filePath?: string;
  language?: string;
  symbolName?: string;
  symbolKind?: string;
  projectId?: string;
  hash?: string;
  indexedAt: number;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export interface VectorStore {
  add(entry: VectorEntry): Promise<void>;
  addBatch(entries: VectorEntry[]): Promise<void>;
  search(query: number[], k: number, filter?: VectorFilter): Promise<SearchResult[]>;
  remove(id: string): Promise<boolean>;
  removeByFilter(filter: VectorFilter): Promise<number>;
  count(filter?: VectorFilter): Promise<number>;
  clear(): Promise<void>;
}

export interface VectorFilter {
  projectId?: string;
  filePath?: string;
  source?: string;
}

export type ChunkOptions = {
  size?: number;
  overlap?: number;
};
