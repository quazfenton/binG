/**
 * CrewAI Memory System
 * 
 * Implements short-term, long-term, and entity memory for agents.
 */

export interface MemoryEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface EntityMemory {
  name: string;
  description: string;
  observations: string[];
  lastUpdated: number;
}

export interface MemoryConfig {
  shortTerm?: boolean;
  longTerm?: boolean;
  entity?: boolean;
  maxShortTermEntries?: number;
  retentionMs?: number;
}

const defaultConfig: Required<MemoryConfig> = {
  shortTerm: true,
  longTerm: false,
  entity: false,
  maxShortTermEntries: 100,
  retentionMs: 24 * 60 * 60 * 1000,
};

export class ShortTermMemory {
  private entries: MemoryEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = defaultConfig.maxShortTermEntries) {
    this.maxEntries = maxEntries;
  }

  add(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): string {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.entries.push({
      ...entry,
      id,
      timestamp: Date.now(),
    });

    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    return id;
  }

  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  getRecent(count: number = 10): MemoryEntry[] {
    return this.entries.slice(-count);
  }

  search(query: string, limit: number = 5): MemoryEntry[] {
    const lower = query.toLowerCase();
    return this.entries
      .filter(e => e.content.toLowerCase().includes(lower))
      .slice(-limit);
  }

  clear(): void {
    this.entries = [];
  }

  count(): number {
    return this.entries.length;
  }
}

export class EntityMemoryStore {
  private entities: Map<string, EntityMemory> = new Map();

  observe(entityName: string, observation: string): void {
    const normalizedName = entityName.toLowerCase();
    const existing = this.entities.get(normalizedName);
    
    if (existing) {
      existing.observations.push(observation);
      existing.lastUpdated = Date.now();
    } else {
      this.entities.set(normalizedName, {
        name: entityName,
        description: observation.slice(0, 200),
        observations: [observation],
        lastUpdated: Date.now(),
      });
    }
  }

  get(entityName: string): EntityMemory | undefined {
    return this.entities.get(entityName.toLowerCase());
  }

  getAll(): EntityMemory[] {
    return Array.from(this.entities.values());
  }

  search(query: string): EntityMemory[] {
    const lower = query.toLowerCase();
    return Array.from(this.entities.values()).filter(
      e => e.name.toLowerCase().includes(lower) || 
           e.description.toLowerCase().includes(lower) ||
           e.observations.some(o => o.toLowerCase().includes(lower))
    );
  }

  clear(): void {
    this.entities.clear();
  }
}

export interface LongTermMemory {
  sessions: Map<string, {
    id: string;
    entries: MemoryEntry[];
    createdAt: number;
    lastAccessed: number;
  }>;
}

export class PersistentMemory {
  private sessions: Map<string, LongTermMemory['sessions']> = new Map();
  private retentionMs: number;

  constructor(retentionMs: number = defaultConfig.retentionMs) {
    this.retentionMs = retentionMs;
  }

  createSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
    }
  }

  addEntry(sessionId: string, entry: Omit<MemoryEntry, 'id' | 'timestamp'>): string {
    let session = this.sessions.get(sessionId);
    if (!session) {
      this.createSession(sessionId);
      session = this.sessions.get(sessionId)!;
    }

    const dayKey = new Date().toISOString().slice(0, 10);
    let dayEntries = session.get(dayKey);

    if (!dayEntries) {
      dayEntries = {
        id: `session_${sessionId}_${dayKey}`,
        entries: [],
        createdAt: Date.now(),
        lastAccessed: Date.now(),
      };
      session.set(dayKey, dayEntries);
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    dayEntries.entries.push({
      ...entry,
      id,
      timestamp: Date.now(),
    });
    dayEntries.lastAccessed = Date.now();

    this.cleanup(sessionId);
    return id;
  }

  getEntries(sessionId: string, days: number = 7): MemoryEntry[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const results: MemoryEntry[] = [];
    const now = Date.now();

    for (let i = 0; i < days; i++) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const dayEntries = session.get(date);
      if (dayEntries) {
        results.push(...dayEntries.entries);
      }
    }

    return results;
  }

  private cleanup(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const cutoff = Date.now() - this.retentionMs;
    for (const [key, value] of session) {
      if (value.lastAccessed < cutoff) {
        session.delete(key);
      }
    }
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export class CrewMemory {
  private shortTerm: ShortTermMemory;
  private entity: EntityMemoryStore;
  private persistent: PersistentMemory;
  private config: Required<MemoryConfig>;
  private sessionId: string;

  constructor(sessionId: string, config: MemoryConfig = {}) {
    this.sessionId = sessionId;
    this.config = { ...defaultConfig, ...config };
    
    this.shortTerm = new ShortTermMemory(this.config.maxShortTermEntries);
    this.entity = new EntityMemoryStore();
    this.persistent = new PersistentMemory(this.config.retentionMs);
    
    if (this.config.longTerm) {
      this.persistent.createSession(sessionId);
    }
  }

  addUserMessage(content: string): void {
    this.shortTerm.add({ role: 'user', content });
    if (this.config.longTerm) {
      this.persistent.addEntry(this.sessionId, { role: 'user', content });
    }
  }

  addAssistantMessage(content: string, metadata?: Record<string, any>): void {
    this.shortTerm.add({ role: 'assistant', content, metadata });
    if (this.config.longTerm) {
      this.persistent.addEntry(this.sessionId, { role: 'assistant', content, metadata });
    }
  }

  observeEntity(name: string, observation: string): void {
    if (this.config.entity) {
      this.entity.observe(name, observation);
    }
  }

  getContext(): string {
    const parts: string[] = [];

    if (this.config.shortTerm) {
      const recent = this.shortTerm.getRecent(10);
      if (recent.length > 0) {
        parts.push('## Recent Conversation');
        for (const entry of recent) {
          parts.push(`${entry.role}: ${entry.content}`);
        }
      }
    }

    if (this.config.entity) {
      const entities = this.entity.getAll();
      if (entities.length > 0) {
        parts.push('## Known Entities');
        for (const entity of entities.slice(0, 5)) {
          parts.push(`- ${entity.name}: ${entity.description}`);
        }
      }
    }

    return parts.join('\n\n');
  }

  getShortTerm(): MemoryEntry[] {
    return this.shortTerm.getAll();
  }

  getLongTerm(days: number = 7): MemoryEntry[] {
    return this.persistent.getEntries(this.sessionId, days);
  }

  search(query: string): MemoryEntry[] {
    return this.shortTerm.search(query);
  }

  clear(): void {
    this.shortTerm.clear();
    this.entity.clear();
  }
}

export function createMemory(sessionId: string, config?: MemoryConfig): CrewMemory {
  return new CrewMemory(sessionId, config);
}
