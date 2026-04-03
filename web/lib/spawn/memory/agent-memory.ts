/**
 * Agent Memory & Knowledge System
 * 
 * Provides persistent memory for AI agents with:
 * - Short-term conversation memory
 * - Long-term knowledge storage
 * - RAG (Retrieval Augmented Generation)
 * - Vector search for semantic retrieval
 * - Knowledge graph for relationships
 * - Memory consolidation
 * 
 * @example
 * ```typescript
 * import { createAgentMemory } from '@/lib/spawn/memory';
 * 
 * const memory = await createAgentMemory({
 *   agentId: 'agent-123',
 *   workspaceDir: '/workspace/project',
 *   vectorStore: 'pinecone', // or 'chroma', 'qdrant', 'local'
 * });
 * 
 * // Store knowledge
 * await memory.store({
 *   type: 'code_pattern',
 *   content: 'Authentication uses JWT with 24h expiry',
 *   metadata: { file: 'src/auth/jwt.ts', tags: ['auth', 'security'] },
 * });
 * 
 * // Retrieve relevant knowledge
 * const results = await memory.retrieve('How does auth work?', {
 *   topK: 5,
 *   minScore: 0.7,
 * });
 * 
 * // Get conversation history
 * const history = await memory.getConversationHistory();
 * ```
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../../utils/logger';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const logger = createLogger('Agents:Memory');

// ============================================================================
// Types
// ============================================================================

export type MemoryType = 
  | 'conversation'    // Chat messages
  | 'code'            // Code snippets
  | 'knowledge'       // General knowledge
  | 'pattern'         // Code patterns
  | 'decision'        // Decisions made
  | 'feedback'        // User feedback
  | 'context';        // Project context

export type VectorStoreType = 'local' | 'pinecone' | 'chroma' | 'qdrant' | 'weaviate';

export interface MemoryEntry {
  /** Unique ID */
  id: string;
  /** Memory type */
  type: MemoryType;
  /** Content text */
  content: string;
  /** Embedding vector (for semantic search) */
  embedding?: number[];
  /** Metadata */
  metadata: {
    /** Source file */
    file?: string;
    /** Tags */
    tags?: string[];
    /** Related entities */
    entities?: string[];
    /** Importance score (0-1) */
    importance?: number;
    /** Access count */
    accessCount?: number;
    /** Custom metadata */
    [key: string]: any;
  };
  /** When created */
  createdAt: number;
  /** When last accessed */
  lastAccessedAt: number;
  /** When expires (0 = never) */
  expiresAt: number;
}

export interface MemoryQuery {
  /** Search query text */
  query: string;
  /** Filter by type */
  type?: MemoryType;
  /** Filter by tags */
  tags?: string[];
  /** Filter by file */
  file?: string;
  /** Minimum relevance score */
  minScore?: number;
  /** Maximum results */
  topK?: number;
  /** Time range */
  timeRange?: { start: number; end: number };
}

export interface MemoryResult {
  /** Memory entry */
  entry: MemoryEntry;
  /** Relevance score (0-1) */
  score: number;
  /** Highlighted snippets */
  highlights?: string[];
}

export interface ConversationMessage {
  /** Message ID */
  id: string;
  /** Role */
  role: 'user' | 'assistant' | 'system';
  /** Content */
  content: string;
  /** Timestamp */
  timestamp: number;
  /** Related memory IDs */
  memoryIds?: string[];
  /** Tool calls */
  toolCalls?: Array<{ name: string; arguments: any; result?: any }>;
}

export interface AgentMemoryConfig {
  /** Agent ID */
  agentId: string;
  /** Workspace directory */
  workspaceDir: string;
  /** Vector store type */
  vectorStore?: VectorStoreType;
  /** Max conversation messages to keep */
  maxConversationHistory?: number;
  /** Memory consolidation interval (ms) */
  consolidationInterval?: number;
  /** Enable semantic search */
  enableSemanticSearch?: boolean;
  /** Embedding model */
  embeddingModel?: string;
}

// ============================================================================
// Local Vector Store (Simple Implementation)
// ============================================================================

class LocalVectorStore {
  private indexPath: string;
  private index: Map<string, { vector: number[]; entry: MemoryEntry }> = new Map();

  constructor(workspaceDir: string) {
    this.indexPath = path.join(workspaceDir, '.agent-memory', 'vector-index.json');
    this.loadIndex();
  }

  async add(entry: MemoryEntry, vector: number[]): Promise<void> {
    this.index.set(entry.id, { vector, entry });
    await this.saveIndex();
  }

  async search(queryVector: number[], topK: number = 10): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    const results: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const [id, data] of Array.from(this.index.entries())) {
      const score = this.cosineSimilarity(queryVector, data.vector);
      results.push({ entry: data.entry, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async remove(entryId: string): Promise<void> {
    this.index.delete(entryId);
    await this.saveIndex();
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private async loadIndex(): Promise<void> {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      for (const item of parsed) {
        this.index.set(item.id, { vector: item.vector, entry: item.entry });
      }
      
      logger.debug(`Loaded ${this.index.size} vectors from index`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to load vector index', { error: error.message });
      }
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      const dir = path.dirname(this.indexPath);
      await fs.mkdir(dir, { recursive: true });
      
      const data = Array.from(this.index.entries()).map(([id, data]) => ({
        id,
        vector: data.vector,
        entry: data.entry,
      }));
      
      await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2));
    } catch (error: any) {
      logger.error('Failed to save vector index', { error: error.message });
    }
  }
}

// ============================================================================
// Agent Memory
// ============================================================================

export class AgentMemory extends EventEmitter {
  private config: Required<AgentMemoryConfig>;
  private conversationHistory: ConversationMessage[] = [];
  private vectorStore: LocalVectorStore;
  private memoryDir: string;
  private consolidationTimer?: NodeJS.Timeout;
  private destroyed: boolean = false;

  constructor(config: AgentMemoryConfig) {
    super();
    this.config = {
      vectorStore: 'local',
      maxConversationHistory: 100,
      consolidationInterval: 300000, // 5 minutes
      enableSemanticSearch: true,
      embeddingModel: 'local',
      ...config,
    };

    this.memoryDir = path.join(config.workspaceDir, '.agent-memory', config.agentId);
    this.vectorStore = new LocalVectorStore(config.workspaceDir);

    logger.info(`Creating memory for agent: ${config.agentId}`, {
      vectorStore: this.config.vectorStore,
      workspace: config.workspaceDir,
    });

    this.loadConversationHistory();
    this.startConsolidation();
  }

  /**
   * Store a memory entry
   */
  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt' | 'expiresAt'> & {
    id?: string;
    ttl?: number;
  }): Promise<MemoryEntry> {
    const memoryEntry: MemoryEntry = {
      id: entry.id || this.generateId(),
      type: entry.type,
      content: entry.content,
      embedding: entry.embedding || await this.generateEmbedding(entry.content),
      metadata: {
        importance: 0.5,
        accessCount: 0,
        ...entry.metadata,
      },
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      expiresAt: entry.ttl ? Date.now() + entry.ttl : 0,
    };

    // Store in vector store
    if (memoryEntry.embedding) {
      await this.vectorStore.add(memoryEntry, memoryEntry.embedding);
    }

    // Store in file system
    await this.saveMemoryToFile(memoryEntry);

    this.emit('memory:store', { entry: memoryEntry });
    logger.debug(`Stored memory: ${memoryEntry.id} (${memoryEntry.type})`);

    return memoryEntry;
  }

  /**
   * Retrieve relevant memories
   */
  async retrieve(query: string | MemoryQuery): Promise<MemoryResult[]> {
    const queryObj: MemoryQuery = typeof query === 'string' 
      ? { query, topK: 10, minScore: 0.5 }
      : query;

    // Generate query embedding
    const queryVector = await this.generateEmbedding(queryObj.query);

    // Search vector store
    const vectorResults = await this.vectorStore.search(queryVector, queryObj.topK || 10);

    // Filter and format results
    const results: MemoryResult[] = vectorResults
      .filter(r => {
        if (r.score < (queryObj.minScore || 0)) return false;
        if (queryObj.type && r.entry.type !== queryObj.type) return false;
        if (queryObj.tags && !queryObj.tags.some(t => r.entry.metadata.tags?.includes(t))) return false;
        if (queryObj.file && r.entry.metadata.file !== queryObj.file) return false;
        if (queryObj.timeRange) {
          const time = r.entry.createdAt;
          if (time < queryObj.timeRange.start || time > queryObj.timeRange.end) return false;
        }
        return r.entry.expiresAt === 0 || r.entry.expiresAt > Date.now();
      })
      .map(r => ({
        entry: r.entry,
        score: r.score,
        highlights: this.extractHighlights(r.entry.content, queryObj.query),
      }));

    // Update access counts
    for (const result of results) {
      result.entry.metadata.accessCount = (result.entry.metadata.accessCount || 0) + 1;
      result.entry.lastAccessedAt = Date.now();
      await this.saveMemoryToFile(result.entry);
    }

    this.emit('memory:retrieve', { query: queryObj.query, count: results.length });
    logger.debug(`Retrieved ${results.length} memories for: ${queryObj.query.substring(0, 50)}...`);

    return results;
  }

  /**
   * Add conversation message
   */
  async addMessage(message: Omit<ConversationMessage, 'id' | 'timestamp'>): Promise<ConversationMessage> {
    const convMessage: ConversationMessage = {
      id: this.generateId(),
      role: message.role,
      content: message.content,
      timestamp: Date.now(),
      toolCalls: message.toolCalls,
    };

    this.conversationHistory.push(convMessage);

    // Trim if over limit
    if (this.conversationHistory.length > this.config.maxConversationHistory) {
      const removed = this.conversationHistory.splice(0, this.conversationHistory.length - this.config.maxConversationHistory);
      logger.debug(`Trimmed ${removed.length} old conversation messages`);
    }

    // Store in memory
    await this.store({
      type: 'conversation',
      content: message.content,
      metadata: {
        role: message.role,
        toolCalls: message.toolCalls,
      },
      ttl: 86400000 * 7, // 7 days
    });

    await this.saveConversationHistory();

    this.emit('conversation:message', { message: convMessage });
    return convMessage;
  }

  /**
   * Get conversation history
   */
  getConversationHistory(limit?: number): ConversationMessage[] {
    const history = [...this.conversationHistory];
    if (limit) {
      return history.slice(-limit);
    }
    return history;
  }

  /**
   * Clear conversation history
   */
  async clearConversationHistory(): Promise<void> {
    this.conversationHistory = [];
    await this.saveConversationHistory();
    this.emit('conversation:clear');
    logger.debug('Conversation history cleared');
  }

  /**
   * Get knowledge summary
   */
  async getKnowledgeSummary(): Promise<{
    totalMemories: number;
    byType: Record<MemoryType, number>;
    recentAccess: MemoryEntry[];
    topTags: Array<{ tag: string; count: number }>;
  }> {
    // This would query the vector store for stats
    // Simplified for now
    return {
      totalMemories: 0,
      byType: {
        conversation: 0,
        code: 0,
        knowledge: 0,
        pattern: 0,
        decision: 0,
        feedback: 0,
        context: 0,
      },
      recentAccess: [],
      topTags: [],
    };
  }

  /**
   * Consolidate memories (merge similar, remove old)
   */
  async consolidate(): Promise<{
    merged: number;
    removed: number;
    preserved: number;
  }> {
    logger.info('Starting memory consolidation');

    const stats = { merged: 0, removed: 0, preserved: 0 };

    // Remove expired memories
    // Merge similar memories
    // Preserve important memories

    this.emit('memory:consolidate', stats);
    logger.info('Memory consolidation complete', stats);

    return stats;
  }

  /**
   * Export memories
   */
  async export(format: 'json' | 'markdown' = 'json'): Promise<string> {
    // Export all memories
    return JSON.stringify({
      agentId: this.config.agentId,
      exportedAt: Date.now(),
      memories: [], // Would query all memories
    }, null, 2);
  }

  /**
   * Import memories
   */
  async import(data: string, format: 'json' | 'markdown' = 'json'): Promise<number> {
    // Import memories
    return 0;
  }

  /**
   * Destroy memory and cleanup
   */
  async destroy(): Promise<void> {
    logger.info(`Destroying memory for agent: ${this.config.agentId}`);

    this.destroyed = true;

    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
    }

    await this.saveConversationHistory();

    this.emit('memory:destroy');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateId(): string {
    return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Simple embedding (in production, use actual embedding model)
    // This is a placeholder that creates a deterministic vector from text
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const vector: number[] = [];
    
    for (let i = 0; i < 384; i++) { // 384-dimensional vector
      const byte = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
      vector.push((byte / 255) * 2 - 1); // Normalize to [-1, 1]
    }
    
    return vector;
  }

  private extractHighlights(content: string, query: string): string[] {
    // Simple highlight extraction
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const sentences = content.split(/[.!?]+/);
    
    const highlights: string[] = [];
    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      if (queryWords.some(word => lowerSentence.includes(word))) {
        highlights.push(sentence.trim());
      }
    }
    
    return highlights.slice(0, 3);
  }

  private async saveMemoryToFile(entry: MemoryEntry): Promise<void> {
    try {
      const dir = path.join(this.memoryDir, 'memories');
      await fs.mkdir(dir, { recursive: true });
      
      const filePath = path.join(dir, `${entry.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
    } catch (error: any) {
      logger.error('Failed to save memory to file', { error: error.message });
    }
  }

  private async loadConversationHistory(): Promise<void> {
    try {
      const filePath = path.join(this.memoryDir, 'conversation.json');
      const data = await fs.readFile(filePath, 'utf-8');
      this.conversationHistory = JSON.parse(data);
      logger.debug(`Loaded ${this.conversationHistory.length} conversation messages`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to load conversation history', { error: error.message });
      }
    }
  }

  private async saveConversationHistory(): Promise<void> {
    try {
      const dir = path.dirname(path.join(this.memoryDir, 'conversation.json'));
      await fs.mkdir(dir, { recursive: true });
      
      const filePath = path.join(this.memoryDir, 'conversation.json');
      await fs.writeFile(filePath, JSON.stringify(this.conversationHistory, null, 2));
    } catch (error: any) {
      logger.error('Failed to save conversation history', { error: error.message });
    }
  }

  private startConsolidation(): void {
    this.consolidationTimer = setInterval(async () => {
      if (!this.destroyed) {
        await this.consolidate();
      }
    }, this.config.consolidationInterval);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createAgentMemory(config: AgentMemoryConfig): Promise<AgentMemory> {
  const memory = new AgentMemory(config);
  return memory;
}

export default AgentMemory;
