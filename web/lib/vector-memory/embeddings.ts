/**
 * Embedding Providers
 * 
 * Abstraction over embedding generation with retry support.
 * Web version calls /api/embed; desktop can swap to local model.
 * 
 * @module vector-memory/embeddings
 */

import type { EmbeddingProvider } from './types';
import { createLogger } from '@/lib/utils/logger';
import { withRetry } from '@/lib/vector-memory/retry';
import { contentHash, embeddingCache } from '@/lib/cache';

const logger = createLogger('Embeddings');

export class APIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private endpoint: string;

  constructor(options?: { endpoint?: string; dimensions?: number }) {
    this.endpoint = options?.endpoint ?? '/api/embed';
    this.dimensions = options?.dimensions ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      // Return zero vector for empty input to avoid API errors
      return new Array(this.dimensions).fill(0);
    }

    // Check embedding cache by content hash — avoids re-embedding unchanged content
    const hash = contentHash(text);
    const cached = embeddingCache.get<number[]>(hash);
    if (cached) return cached;

    const embedding = await withRetry(
      async () => {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          throw new Error(`Embedding API error: ${res.status}`);
        }

        const data = await res.json();
        return data.embedding ?? data;
      },
      { maxRetries: 3, baseDelay: 500, context: 'embed' }
    );

    // Cache the embedding by content hash
    embeddingCache.set(hash, embedding, 60 * 60 * 1000); // 1 hour TTL
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Check cache for each text, only embed uncached ones
    const hashes = texts.map(contentHash);
    const results: number[][] = new Array(texts.length);
    const uncached: { index: number; text: string; hash: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = embeddingCache.get<number[]>(hashes[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncached.push({ index: i, text: texts[i], hash: hashes[i] });
      }
    }

    if (uncached.length > 0) {
      const uncachedTexts = uncached.map((u) => u.text);
      const embeddings = await withRetry(
        async () => {
          const res = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: uncachedTexts }),
          });

          if (!res.ok) {
            throw new Error(`Embedding batch API error: ${res.status}`);
          }

          const data = await res.json();
          return data.embeddings ?? data;
        },
        { maxRetries: 2, baseDelay: 1000, context: 'embedBatch' }
      );

      // Validate returned array length matches request
      if (!Array.isArray(embeddings) || embeddings.length !== uncachedTexts.length) {
        throw new Error(
          `Embedding batch returned ${embeddings?.length ?? 'non-array'} results for ${uncachedTexts.length} texts`
        );
      }

      // Cache and fill results
      for (let i = 0; i < uncached.length; i++) {
        results[uncached[i].index] = embeddings[i];
        embeddingCache.set(uncached[i].hash, embeddings[i], 60 * 60 * 1000); // 1 hour TTL
      }
    }

    return results;
  }
}

/**
 * Placeholder embedding provider for local/offline use.
 * Generates deterministic hash-based vectors (not semantic).
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashVector(t));
  }

  private hashVector(text: string): number[] {
    const vec = new Array(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % this.dimensions] += text.charCodeAt(i);
    }
    const max = Math.max(...vec.map(Math.abs), 1);
    return vec.map((v) => v / max);
  }
}

let defaultProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!defaultProvider) {
    defaultProvider = new HashEmbeddingProvider();
  }
  return defaultProvider;
}

export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  defaultProvider = provider;
}
