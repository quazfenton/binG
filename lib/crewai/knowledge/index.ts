/**
 * CrewAI Knowledge Sources
 * 
 * RAG-based knowledge integration for agents.
 * Supports PDF, website, directory, and text sources.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface KnowledgeSourceConfig {
  type: 'pdf' | 'website' | 'directory' | 'text';
  source: string;
  description?: string;
}

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    chunkIndex: number;
    page?: number;
  };
}

export interface SearchResult {
  content: string;
  score: number;
  metadata: Record<string, any>;
}

export interface EmbedderConfig {
  provider: 'openai' | 'local' | 'custom';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

class OpenAIEmbedder implements EmbeddingProvider {
  private apiKey: string;
  private model: string;

  constructor(config: EmbedderConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config.model || 'text-embedding-3-small';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const { OpenAI } = require('openai');
    const client = new OpenAI({ apiKey: this.apiKey });
    
    const response = await client.embeddings.create({
      model: this.model,
      input: texts,
    });

    return response.data.map((d: any) => d.embedding);
  }
}

class LocalEmbedder implements EmbeddingProvider {
  private baseUrl: string;

  constructor(config: EmbedderConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    
    for (const text of texts) {
      try {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
        });
        const data = await response.json();
        results.push(data.embedding);
      } catch {
        results.push(new Array(768).fill(0));
      }
    }
    
    return results;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magA * magB);
}

export class KnowledgeSource {
  public readonly type: string;
  public readonly source: string;
  public readonly description?: string;
  
  private chunks: DocumentChunk[] = [];
  private embeddings: number[][] = [];
  private embedder: EmbeddingProvider | null = null;
  private initialized = false;

  constructor(config: KnowledgeSourceConfig) {
    this.type = config.type;
    this.source = config.source;
    this.description = config.description;
  }

  async initialize(embedderConfig?: EmbedderConfig): Promise<void> {
    if (this.initialized) return;

    switch (this.type) {
      case 'text':
        await this.loadText();
        break;
      case 'directory':
        await this.loadDirectory();
        break;
      case 'pdf':
        await this.loadPdf();
        break;
      case 'website':
        await this.loadWebsite();
        break;
    }

    if (embedderConfig && this.chunks.length > 0) {
      await this.buildEmbeddings(embedderConfig);
    }

    this.initialized = true;
  }

  private async loadText(): Promise<void> {
    try {
      const content = await fs.readFile(this.source, 'utf-8');
      this.chunks = this.chunkText(content, 0);
    } catch (error) {
      console.error(`Failed to load text from ${this.source}:`, error);
    }
  }

  private async loadDirectory(): Promise<void> {
    try {
      const entries = await fs.readdir(this.source, { recursive: true });
      const textFiles = entries.filter(e => 
        typeof e === 'string' && /\.(txt|md|json|ts|js)$/i.test(e)
      );

      for (let i = 0; i < textFiles.length; i++) {
        const filePath = path.join(this.source, textFiles[i]);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const fileChunks = this.chunkText(content, i);
          this.chunks.push(...fileChunks);
        } catch {
          // Skip files that can't be read
        }
      }
    } catch (error) {
      console.error(`Failed to load directory ${this.source}:`, error);
    }
  }

  private async loadPdf(): Promise<void> {
    console.warn('PDF loading requires pdf-parse. Using text fallback.');
    await this.loadText();
  }

  private async loadWebsite(): Promise<void> {
    try {
      const response = await fetch(this.source);
      const html = await response.text();
      const text = this.stripHtml(html);
      this.chunks = this.chunkText(text, 0);
    } catch (error) {
      console.error(`Failed to load website ${this.source}:`, error);
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private chunkText(text: string, baseIndex: number): DocumentChunk[] {
    const chunkSize = 1000;
    const overlap = 100;
    const chunks: DocumentChunk[] = [];
    
    let start = 0;
    let index = baseIndex;
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const content = text.slice(start, end).trim();
      
      if (content.length > 50) {
        chunks.push({
          id: `chunk_${index}`,
          content,
          metadata: {
            source: this.source,
            chunkIndex: index,
          },
        });
        index++;
      }
      
      start = end - overlap;
      if (start >= text.length) break;
    }
    
    return chunks;
  }

  private async buildEmbeddings(config: EmbedderConfig): Promise<void> {
    if (config.provider === 'openai') {
      this.embedder = new OpenAIEmbedder(config);
    } else if (config.provider === 'local') {
      this.embedder = new LocalEmbedder(config);
    }

    if (this.embedder && this.chunks.length > 0) {
      const texts = this.chunks.map(c => c.content);
      this.embeddings = await this.embedder.embed(texts);
    }
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    if (!this.embedder || this.embeddings.length === 0) {
      return this.keywordSearch(query, limit);
    }

    const queryEmbedding = await this.embedder.embed([query]);
    const queryVec = queryEmbedding[0];

    const scored = this.chunks.map((chunk, i) => ({
      chunk,
      score: cosineSimilarity(queryVec, this.embeddings[i]),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ chunk, score }) => ({
      content: chunk.content,
      score,
      metadata: chunk.metadata,
    }));
  }

  private keywordSearch(query: string, limit: number): SearchResult[] {
    const keywords = query.toLowerCase().split(/\s+/);
    
    const scored = this.chunks.map(chunk => {
      const content = chunk.content.toLowerCase();
      const score = keywords.filter(k => content.includes(k)).length;
      return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ chunk, score }) => ({
      content: chunk.content,
      score: score / keywords.length,
      metadata: chunk.metadata,
    }));
  }

  getChunks(): DocumentChunk[] {
    return [...this.chunks];
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export class KnowledgeBase {
  private sources: Map<string, KnowledgeSource> = new Map();
  private embedderConfig?: EmbedderConfig;

  constructor(embedderConfig?: EmbedderConfig) {
    this.embedderConfig = embedderConfig;
  }

  async addSource(config: KnowledgeSourceConfig): Promise<void> {
    const source = new KnowledgeSource(config);
    await source.initialize(this.embedderConfig);
    this.sources.set(config.source, source);
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const source of this.sources.values()) {
      const sourceResults = await source.search(query, limit);
      results.push(...sourceResults.map(r => ({
        ...r,
        metadata: { ...r.metadata, sourceName: source.description || source.source },
      })));
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  getSources(): string[] {
    return Array.from(this.sources.keys());
  }

  removeSource(sourcePath: string): boolean {
    return this.sources.delete(sourcePath);
  }

  clear(): void {
    this.sources.clear();
  }
}

export function createKnowledgeBase(embedderConfig?: EmbedderConfig): KnowledgeBase {
  return new KnowledgeBase(embedderConfig);
}
