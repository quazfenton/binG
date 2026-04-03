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

const logger = createLogger('Embeddings');

export class APIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private endpoint: string;

  constructor(options?: { endpoint?: string; dimensions?: number }) {
    this.endpoint = options?.endpoint ?? '/api/embed';
    this.dimensions = options?.dimensions ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    return withRetry(
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
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return withRetry(
      async () => {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts }),
        });

        if (!res.ok) {
          throw new Error(`Embedding batch API error: ${res.status}`);
        }

        const data = await res.json();
        return data.embeddings ?? data;
      },
      { maxRetries: 2, baseDelay: 1000, context: 'embedBatch' }
    );
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
