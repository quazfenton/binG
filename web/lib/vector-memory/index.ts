/**
 * Vector Memory Module
 * 
 * Persistent vector memory for semantic search and retrieval.
 * Provides chunking, embedding, storage, and retrieval pipeline.
 * 
 * @module vector-memory
 */

export * from './types';
export { chunkText, chunkByLines } from './chunking';
export { cosineSimilarity, dotProduct } from './similarity';
export { InMemoryVectorStore, createVectorStore } from './store';
export {
  APIEmbeddingProvider,
  HashEmbeddingProvider,
  getEmbeddingProvider,
  setEmbeddingProvider,
} from './embeddings';
export { RetrievalPipeline } from './retrieval';
export { withRetry, isRetryableError } from './retry';
export type { RetryOptions } from './retry';
export { createPipeline, runTaskGraph } from './pipeline';
export type { PipelineStep, TaskNode } from './pipeline';
export {
  indexFileContent,
  handleFileEvent,
  wireWatcherToIndex,
  clearHashCache,
} from './file-indexing';
