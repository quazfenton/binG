/**
 * Retrieval Pipeline
 * 
 * Combines vector search with keyword matching and
 * builds structured prompts for LLM injection.
 * 
 * @module vector-memory/retrieval
 */

import type { VectorStore, SearchResult, EmbeddingProvider, VectorFilter } from './types';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Retrieval');

export interface RetrievalOptions {
  topK?: number;
  filter?: VectorFilter;
  keywordBoost?: boolean;
  maxTokens?: number;
}

export interface RetrievalContext {
  results: SearchResult[];
  prompt: string;
  tokenEstimate: number;
}

export class RetrievalPipeline {
  constructor(
    private store: VectorStore,
    private embedder: EmbeddingProvider
  ) {}

  async search(
    query: string,
    options: RetrievalOptions = {}
  ): Promise<SearchResult[]> {
    const topK = options.topK ?? 5;

    const queryEmbedding = await this.embedder.embed(query);
    let results = await this.store.search(queryEmbedding, topK * 2, options.filter);

    if (options.keywordBoost) {
      results = this.applyKeywordBoost(results, query);
    }

    return results.slice(0, topK);
  }

  async buildContext(
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievalContext> {
    const results = await this.search(query, options);
    const maxTokens = options.maxTokens ?? 4000;

    let tokenEstimate = 0;
    const selected: SearchResult[] = [];

    for (const result of results) {
      const cost = this.estimateTokens(result.entry.text);
      if (tokenEstimate + cost > maxTokens) break;
      selected.push(result);
      tokenEstimate += cost;
    }

    const prompt = this.formatContext(selected);

    return { results: selected, prompt, tokenEstimate };
  }

  async buildPrompt(userMessage: string, options: RetrievalOptions = {}): Promise<string> {
    const ctx = await this.buildContext(userMessage, options);

    if (!ctx.prompt) return userMessage;

    return `Context:\n${ctx.prompt}\n\nUser:\n${userMessage}`;
  }

  private applyKeywordBoost(results: SearchResult[], query: string): SearchResult[] {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/).filter((w) => w.length > 2);

    return results
      .map((r) => {
        let boost = 0;
        const lowerText = r.entry.text.toLowerCase();

        if (lowerText.includes(lowerQuery)) boost += 0.2;

        for (const word of words) {
          if (lowerText.includes(word)) boost += 0.05;
        }

        if (r.entry.metadata.symbolName) {
          const name = r.entry.metadata.symbolName.toLowerCase();
          if (name.includes(lowerQuery) || words.some((w) => name.includes(w))) {
            boost += 0.15;
          }
        }

        return { ...r, score: r.score + boost };
      })
      .sort((a, b) => b.score - a.score);
  }

  private formatContext(results: SearchResult[]): string {
    if (results.length === 0) return '';

    return results
      .map((r) => {
        const meta = r.entry.metadata;
        const header = meta.symbolName
          ? `### ${meta.symbolName} (${meta.symbolKind ?? 'unknown'})`
          : `### ${meta.filePath ?? meta.source}`;

        const fileInfo = meta.filePath ? `File: ${meta.filePath}` : '';

        return [header, fileInfo, '', r.entry.text].filter(Boolean).join('\n');
      })
      .join('\n\n---\n\n');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
