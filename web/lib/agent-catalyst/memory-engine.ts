/**
 * Memory Engine — Persistent Accumulated Experience
 * 
 * Manages the agent's memory system: episodic (experiences), semantic (knowledge),
 * procedural (skills), and reflective (metacognition). Memories decay over time,
 * consolidate through rehearsal, and are retrieved by relevance and emotional valence.
 * 
 * @module agent-catalyst/memory-engine
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:Memory');

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'reflective' | 'injective';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
  emotionalValence: number;     // -1 to +1
  significance: number;          // 0 to 1
  tags: string[];
  relatedIds: string[];          // Links to other memories
  consolidationLevel: number;    // 0-1: how well integrated into identity
  source: string;                // Where this memory came from
}

export interface MemoryQuery {
  type?: MemoryType;
  tag?: string;
  minSignificance?: number;
  minValence?: number;
  maxAge?: number;              // ms
  limit?: number;
}

export interface MemoryConfig {
  maxMemories?: number;
  decayRate?: number;           // Per day
  consolidationThreshold?: number;
  retrievalTopK?: number;
}

const DEFAULT_CONFIG: Required<MemoryConfig> = {
  maxMemories: 5000,
  decayRate: 0.02,              // 2% significance decay per day
  consolidationThreshold: 0.7,
  retrievalTopK: 10,
};

export class MemoryEngine {
  private memories: Map<string, MemoryEntry> = new Map();
  private config: Required<MemoryConfig>;
  private _onChange: ((memory: MemoryEntry) => void) | null = null;

  constructor(config: MemoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onChange(callback: (memory: MemoryEntry) => void): void {
    this._onChange = callback;
  }

  /**
   * Store a new memory
   */
  store(entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'lastAccessed' | 'accessCount' | 'consolidationLevel'>): MemoryEntry {
    const memory: MemoryEntry = {
      ...entry,
      id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
      consolidationLevel: entry.significance > 0.8 ? 0.3 : 0,
    };

    this.memories.set(memory.id, memory);
    
    // Enforce capacity limit
    if (this.memories.size > this.config.maxMemories) {
      this.pruneLowestSignificance();
    }

    if (this._onChange) this._onChange(memory);
    logger.debug('Memory stored', { id: memory.id, type: memory.type, significance: memory.significance });
    return memory;
  }

  /**
   * Retrieve memories by query
   */
  retrieve(query: MemoryQuery = {}): MemoryEntry[] {
    let candidates = Array.from(this.memories.values());

    if (query.type) {
      candidates = candidates.filter(m => m.type === query.type);
    }
    if (query.tag) {
      candidates = candidates.filter(m => m.tags.includes(query.tag!));
    }
    if (query.minSignificance !== undefined) {
      candidates = candidates.filter(m => m.significance >= query.minSignificance!);
    }
    if (query.maxAge !== undefined) {
      const cutoff = Date.now() - query.maxAge;
      candidates = candidates.filter(m => m.timestamp >= cutoff);
    }

    // Score by recency, significance, and access frequency
    const scored = candidates.map(m => ({
      memory: m,
      score: this.computeRelevanceScore(m),
    }));

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, query.limit ?? this.config.retrievalTopK).map(s => s.memory);

    // Update access tracking
    results.forEach(m => {
      m.lastAccessed = Date.now();
      m.accessCount++;
    });

    return results;
  }

  /**
   * Retrieve related memories by ID
   */
  getRelated(memoryId: string, limit = 5): MemoryEntry[] {
    const source = this.memories.get(memoryId);
    if (!source) return [];

    // Update access
    source.lastAccessed = Date.now();
    source.accessCount++;

    const related = source.relatedIds
      .map(id => this.memories.get(id))
      .filter((m): m is MemoryEntry => m !== undefined);

    return related.slice(0, limit);
  }

  /**
   * Consolidate memories — strengthen frequently accessed ones
   */
  consolidate(): void {
    for (const memory of this.memories.values()) {
      // Apply decay based on age
      const daysSinceCreation = (Date.now() - memory.timestamp) / (1000 * 60 * 60 * 24);
      const decay = daysSinceCreation * this.config.decayRate;
      
      // Boost by access frequency
      const accessBoost = Math.log10(memory.accessCount + 1) * 0.1;
      
      // Net significance
      memory.significance = Math.max(0, Math.min(1, memory.significance - decay + accessBoost));
      
      // Consolidation threshold check
      if (memory.significance > this.config.consolidationThreshold && memory.accessCount > 5) {
        memory.consolidationLevel = Math.min(1, memory.consolidationLevel + 0.05);
      }

      // Prune if significance dropped too low and not accessed recently
      const daysSinceAccess = (Date.now() - memory.lastAccessed) / (1000 * 60 * 60 * 24);
      if (memory.significance < 0.05 && daysSinceAccess > 7 && memory.consolidationLevel < 0.3) {
        this.memories.delete(memory.id);
      }
    }

    logger.debug('Memory consolidation complete', { remaining: this.memories.size });
  }

  /**
   * Link two memories together
   */
  link(memoryId1: string, memoryId2: string): void {
    const m1 = this.memories.get(memoryId1);
    const m2 = this.memories.get(memoryId2);
    if (!m1 || !m2) return;

    if (!m1.relatedIds.includes(memoryId2)) m1.relatedIds.push(memoryId2);
    if (!m2.relatedIds.includes(memoryId1)) m2.relatedIds.push(memoryId1);
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    total: number;
    byType: Record<MemoryType, number>;
    avgSignificance: number;
    avgConsolidation: number;
    oldestMemory: number;
  } {
    const memories = Array.from(this.memories.values());
    const byType = {} as Record<MemoryType, number>;
    for (const m of memories) {
      byType[m.type] = (byType[m.type] || 0) + 1;
    }

    return {
      total: memories.length,
      byType,
      avgSignificance: memories.length > 0 ? memories.reduce((sum, m) => sum + m.significance, 0) / memories.length : 0,
      avgConsolidation: memories.length > 0 ? memories.reduce((sum, m) => sum + m.consolidationLevel, 0) / memories.length : 0,
      oldestMemory: memories.length > 0 ? Math.min(...memories.map(m => m.timestamp)) : 0,
    };
  }

  /**
   * Serialize for persistence
   */
  toJSON(): string {
    return JSON.stringify(Array.from(this.memories.values()), null, 2);
  }

  /**
   * Load from serialized state
   */
  fromJSON(json: string): void {
    const entries = JSON.parse(json) as MemoryEntry[];
    this.memories.clear();
    for (const entry of entries) {
      this.memories.set(entry.id, entry);
    }
    logger.info('Memory engine loaded', { count: entries.length });
  }

  private computeRelevanceScore(memory: MemoryEntry): number {
    const recencyWeight = 0.3;
    const significanceWeight = 0.4;
    const accessWeight = 0.2;
    const valenceWeight = 0.1;

    const recency = Math.exp(-(Date.now() - memory.timestamp) / (1000 * 60 * 60 * 24 * 30));
    const accessFreq = Math.log10(memory.accessCount + 1);
    const emotionalRelevance = Math.abs(memory.emotionalValence);

    return (
      recency * recencyWeight +
      memory.significance * significanceWeight +
      accessFreq * accessWeight +
      emotionalRelevance * valenceWeight
    );
  }

  private pruneLowestSignificance(): void {
    const sorted = Array.from(this.memories.values())
      .filter(m => m.consolidationLevel < 0.3)
      .sort((a, b) => a.significance - b.significance);
    
    const toPrune = sorted.slice(0, Math.max(10, Math.floor(this.config.maxMemories * 0.02)));
    for (const m of toPrune) {
      this.memories.delete(m.id);
    }
  }
}
