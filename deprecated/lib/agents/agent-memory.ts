/**
 * Agent Memory & Context System
 * 
 * Provides persistent memory for AI agents with context management.
 * Supports short-term working memory and long-term vector memory.
 * 
 * Features:
 * - Working memory (context window)
 * - Long-term memory (vector storage)
 * - Memory summarization
 * - Context retrieval
 */

import { EventEmitter } from 'node:events';

/**
 * Memory item
 */
export interface MemoryItem {
  /**
   * Memory ID
   */
  id: string;
  
  /**
   * Memory content
   */
  content: string;
  
  /**
   * Memory type
   */
  type: 'fact' | 'event' | 'instruction' | 'observation' | 'conversation';
  
  /**
   * Importance score (0-1)
   */
  importance: number;
  
  /**
   * Embedding vector (for similarity search)
   */
  embedding?: number[];
  
  /**
   * Timestamp
   */
  timestamp: number;
  
  /**
   * Expiration timestamp (0 = never expires)
   */
  expiresAt: number;
  
  /**
   * Tags for categorization
   */
  tags?: string[];
  
  /**
   * Related memory IDs
   */
  relatedIds?: string[];
}

/**
 * Context window configuration
 */
export interface ContextConfig {
  /**
   * Maximum tokens in context
   */
  maxTokens: number;
  
  /**
   * Whether to include summaries
   */
  includeSummaries: boolean;
  
  /**
   * Summary compression ratio (0-1)
   */
  summaryCompression: number;
}

/**
 * Memory retrieval result
 */
export interface MemoryRetrievalResult {
  /**
   * Retrieved memories
   */
  memories: MemoryItem[];
  
  /**
   * Total context tokens
   */
  totalTokens: number;
  
  /**
   * Whether context was truncated
   */
  truncated: boolean;
}

/**
 * Agent Memory Manager
 * 
 * Manages agent memory and context.
 */
export class AgentMemoryManager extends EventEmitter {
  private memories: Map<string, MemoryItem> = new Map();
  private config: ContextConfig;
  private readonly DEFAULT_CONFIG: ContextConfig = {
    maxTokens: 4000,
    includeSummaries: true,
    summaryCompression: 0.3,
  };

  constructor(config?: Partial<ContextConfig>) {
    super();
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    
    // Auto-cleanup expired memories
    setInterval(() => {
      this.cleanupExpiredMemories();
    }, 60000); // Every minute
  }

  /**
   * Add memory
   * 
   * @param content - Memory content
   * @param options - Memory options
   * @returns Memory item
   */
  addMemory(
    content: string,
    options?: {
      type?: MemoryItem['type'];
      importance?: number;
      tags?: string[];
      expiresInSeconds?: number;
    }
  ): MemoryItem {
    const memory: MemoryItem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      type: options?.type || 'observation',
      importance: options?.importance || 0.5,
      timestamp: Date.now(),
      expiresAt: options?.expiresInSeconds
        ? Date.now() + options.expiresInSeconds * 1000
        : 0,
      tags: options?.tags,
    };

    this.memories.set(memory.id, memory);
    this.emit('memory-added', memory);

    return memory;
  }

  /**
   * Add fact memory
   * 
   * @param content - Fact content
   * @param importance - Importance score
   * @returns Memory item
   */
  addFact(content: string, importance: number = 0.7): MemoryItem {
    return this.addMemory(content, { type: 'fact', importance });
  }

  /**
   * Add event memory
   * 
   * @param content - Event content
   * @param importance - Importance score
   * @returns Memory item
   */
  addEvent(content: string, importance: number = 0.5): MemoryItem {
    return this.addMemory(content, { type: 'event', importance });
  }

  /**
   * Add instruction memory
   * 
   * @param content - Instruction content
   * @returns Memory item
   */
  addInstruction(content: string): MemoryItem {
    return this.addMemory(content, { type: 'instruction', importance: 0.9 });
  }

  /**
   * Get memory by ID
   * 
   * @param id - Memory ID
   * @returns Memory item or null
   */
  getMemory(id: string): MemoryItem | null {
    return this.memories.get(id) || null;
  }

  /**
   * Delete memory
   * 
   * @param id - Memory ID
   * @returns Whether deletion succeeded
   */
  deleteMemory(id: string): boolean {
    const existed = this.memories.delete(id);
    if (existed) {
      this.emit('memory-deleted', id);
    }
    return existed;
  }

  /**
   * Search memories by text
   * 
   * @param query - Search query
   * @param limit - Max results
   * @returns Array of matching memories
   */
  searchMemories(query: string, limit: number = 10): MemoryItem[] {
    const queryLower = query.toLowerCase();
    
    return Array.from(this.memories.values())
      .filter(m => 
        m.content.toLowerCase().includes(queryLower) ||
        m.tags?.some(tag => tag.toLowerCase().includes(queryLower))
      )
      .sort((a, b) => {
        // Sort by importance and recency
        const scoreA = a.importance * 0.7 + (1 / (Date.now() - a.timestamp + 1)) * 0.3;
        const scoreB = b.importance * 0.7 + (1 / (Date.now() - b.timestamp + 1)) * 0.3;
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /**
   * Get memories by type
   * 
   * @param type - Memory type
   * @param limit - Max results
   * @returns Array of memories
   */
  getMemoriesByType(type: MemoryItem['type'], limit: number = 20): MemoryItem[] {
    return Array.from(this.memories.values())
      .filter(m => m.type === type)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get memories by tags
   * 
   * @param tags - Tags to match
   * @param matchAll - Whether all tags must match
   * @returns Array of memories
   */
  getMemoriesByTags(tags: string[], matchAll: boolean = false): MemoryItem[] {
    return Array.from(this.memories.values())
      .filter(m => {
        if (!m.tags) return false;
        if (matchAll) {
          return tags.every(tag => m.tags?.includes(tag));
        }
        return tags.some(tag => m.tags?.includes(tag));
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Build context for agent
   * 
   * @param query - Context query
   * @param config - Context configuration
   * @returns Context retrieval result
   */
  async buildContext(
    query: string,
    config?: Partial<ContextConfig>
  ): Promise<MemoryRetrievalResult> {
    const effectiveConfig = { ...this.config, ...config };
    const memories: MemoryItem[] = [];
    let totalTokens = 0;
    let truncated = false;

    // Search for relevant memories
    const relevantMemories = this.searchMemories(query, 50);

    for (const memory of relevantMemories) {
      const tokenCount = this.estimateTokens(memory.content);
      
      if (totalTokens + tokenCount > effectiveConfig.maxTokens) {
        truncated = true;
        break;
      }

      memories.push(memory);
      totalTokens += tokenCount;
    }

    // Add summaries if enabled
    if (effectiveConfig.includeSummaries && memories.length > 10) {
      const summary = await this.summarizeMemories(memories.slice(0, 10));
      const summaryTokens = this.estimateTokens(summary);
      
      if (totalTokens + summaryTokens <= effectiveConfig.maxTokens) {
        memories.unshift({
          id: 'summary',
          content: summary,
          type: 'observation',
          importance: 1,
          timestamp: Date.now(),
          expiresAt: 0,
        });
        totalTokens += summaryTokens;
      }
    }

    return {
      memories,
      totalTokens,
      truncated,
    };
  }

  /**
   * Summarize memories
   * 
   * @param memories - Memories to summarize
   * @returns Summary text
   */
  async summarizeMemories(memories: MemoryItem[]): Promise<string> {
    if (memories.length === 0) {
      return '';
    }

    // Group by type
    const byType = new Map<MemoryItem['type'], MemoryItem[]>();
    for (const memory of memories) {
      const group = byType.get(memory.type) || [];
      group.push(memory);
      byType.set(memory.type, group);
    }

    // Create summary
    const parts: string[] = [];
    
    for (const [type, items] of byType.entries()) {
      const count = items.length;
      const recentItems = items.slice(0, 5);
      const summary = `${count} ${type}(s): ${recentItems.map(i => i.content.slice(0, 50)).join('; ')}...`;
      parts.push(summary);
    }

    return parts.join('\n');
  }

  /**
   * Get recent memories
   * 
   * @param limit - Max results
   * @returns Array of memories
   */
  getRecentMemories(limit: number = 20): MemoryItem[] {
    return Array.from(this.memories.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get important memories
   * 
   * @param minImportance - Minimum importance score
   * @param limit - Max results
   * @returns Array of memories
   */
  getImportantMemories(minImportance: number = 0.7, limit: number = 20): MemoryItem[] {
    return Array.from(this.memories.values())
      .filter(m => m.importance >= minImportance)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  /**
   * Update memory
   * 
   * @param id - Memory ID
   * @param updates - Memory updates
   * @returns Updated memory or null
   */
  updateMemory(id: string, updates: Partial<MemoryItem>): MemoryItem | null {
    const memory = this.memories.get(id);
    
    if (!memory) {
      return null;
    }

    const updated = { ...memory, ...updates };
    this.memories.set(id, updated);
    this.emit('memory-updated', updated);

    return updated;
  }

  /**
   * Link memories
   * 
   * @param id1 - First memory ID
   * @param id2 - Second memory ID
   * @returns Whether linking succeeded
   */
  linkMemories(id1: string, id2: string): boolean {
    const mem1 = this.memories.get(id1);
    const mem2 = this.memories.get(id2);

    if (!mem1 || !mem2) {
      return false;
    }

    if (!mem1.relatedIds) mem1.relatedIds = [];
    if (!mem2.relatedIds) mem2.relatedIds = [];

    if (!mem1.relatedIds.includes(id2)) mem1.relatedIds.push(id2);
    if (!mem2.relatedIds.includes(id1)) mem2.relatedIds.push(id1);

    this.emit('memories-linked', { id1, id2 });

    return true;
  }

  /**
   * Get related memories
   * 
   * @param id - Memory ID
   * @returns Array of related memories
   */
  getRelatedMemories(id: string): MemoryItem[] {
    const memory = this.memories.get(id);
    
    if (!memory || !memory.relatedIds) {
      return [];
    }

    return memory.relatedIds
      .map(rid => this.memories.get(rid))
      .filter((m): m is MemoryItem => !!m);
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    totalMemories: number;
    byType: Record<string, number>;
    averageImportance: number;
    expiredCount: number;
  } {
    const memories = Array.from(this.memories.values());
    const now = Date.now();

    const byType: Record<string, number> = {};
    let totalImportance = 0;
    let expiredCount = 0;

    for (const memory of memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
      totalImportance += memory.importance;
      
      if (memory.expiresAt > 0 && memory.expiresAt < now) {
        expiredCount++;
      }
    }

    return {
      totalMemories: memories.length,
      byType,
      averageImportance: memories.length > 0 ? totalImportance / memories.length : 0,
      expiredCount,
    };
  }

  /**
   * Clear all memories
   */
  clear(): void {
    this.memories.clear();
    this.emit('cleared');
  }

  /**
   * Export memories
   * 
   * @returns Array of memories
   */
  exportMemories(): MemoryItem[] {
    return Array.from(this.memories.values());
  }

  /**
   * Import memories
   * 
   * @param memories - Memories to import
   */
  importMemories(memories: MemoryItem[]): void {
    for (const memory of memories) {
      this.memories.set(memory.id, memory);
    }
    this.emit('imported', memories.length);
  }

  /**
   * Cleanup expired memories
   */
  private cleanupExpiredMemories(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, memory] of this.memories.entries()) {
      if (memory.expiresAt > 0 && memory.expiresAt < now) {
        this.memories.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.emit('cleanup', cleaned);
    }
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}

/**
 * Create agent memory manager
 * 
 * @param config - Context configuration
 * @returns Memory manager
 */
export function createAgentMemoryManager(config?: Partial<ContextConfig>): AgentMemoryManager {
  return new AgentMemoryManager(config);
}

/**
 * Quick memory helper
 * 
 * @param content - Memory content
 * @param type - Memory type
 * @returns Memory manager with memory added
 */
export function quickAddMemory(
  content: string,
  type: MemoryItem['type'] = 'observation'
): { manager: AgentMemoryManager; memory: MemoryItem } {
  const manager = createAgentMemoryManager();
  const memory = manager.addMemory(content, { type });
  return { manager, memory };
}
