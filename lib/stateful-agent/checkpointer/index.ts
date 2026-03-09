export interface CheckpointerConfig {
  redisUrl?: string;
  prefix?: string;
  ttl?: number;
}

export interface Checkpointer {
  get(threadId: string, checkpointId: string): Promise<any | null>;
  put(threadId: string, checkpointId: string, state: any, metadata?: Record<string, any>): Promise<void>;
  listCheckpoints(threadId: string, limit?: number): Promise<string[]>;
  getLatestCheckpointId(threadId: string): Promise<string | null>;
  deleteThread(threadId: string): Promise<void>;
}

export class RedisCheckpointer implements Checkpointer {
  private redis: any;
  private prefix: string;
  private ttl: number;

  constructor(config?: CheckpointerConfig) {
    try {
      const Redis = require('ioredis');
      this.redis = new Redis(config?.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379');
    } catch {
      console.warn('[Checkpointer] Redis not available, using memory fallback');
      this.redis = null;
    }
    this.prefix = config?.prefix || 'agent:checkpoint:';
    this.ttl = config?.ttl || 86400;
  }

  private getKey(threadId: string, checkpointId: string): string {
    return `${this.prefix}${threadId}:${checkpointId}`;
  }

  async get(threadId: string, checkpointId: string): Promise<any | null> {
    if (!this.redis) return null;
    const key = this.getKey(threadId, checkpointId);
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
  }

  async put(threadId: string, checkpointId: string, state: any, metadata?: Record<string, any>): Promise<void> {
    if (!this.redis) return;
    const key = this.getKey(threadId, checkpointId);
    const data = JSON.stringify({ state, metadata: { ...metadata, created_at: new Date().toISOString() } });
    await this.redis.setex(key, this.ttl, data);
  }

  async listCheckpoints(threadId: string, limit = 10): Promise<string[]> {
    if (!this.redis) return [];
    const pattern = `${this.prefix}${threadId}:*`;
    const keys = await this.redis.keys(pattern);
    return keys.slice(-limit).map((k: string) => k.replace(`${this.prefix}${threadId}:`, ''));
  }

  async getLatestCheckpointId(threadId: string): Promise<string | null> {
    if (!this.redis) return null;
    const checkpoints = await this.listCheckpoints(threadId, 1000);
    return checkpoints[checkpoints.length - 1] || null;
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.redis) return;
    const pattern = `${this.prefix}${threadId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

export class MemoryCheckpointer implements Checkpointer {
  private store: Map<string, { state: any; metadata?: Record<string, any> }> = new Map();
  private ttl: number;

  constructor(config?: { ttl?: number }) {
    this.ttl = config?.ttl || 3600;
  }

  private getKey(threadId: string, checkpointId: string): string {
    return `${threadId}:${checkpointId}`;
  }

  async get(threadId: string, checkpointId: string): Promise<any | null> {
    const key = this.getKey(threadId, checkpointId);
    const entry = this.store.get(key);
    return entry?.state || null;
  }

  async put(threadId: string, checkpointId: string, state: any, metadata?: Record<string, any>): Promise<void> {
    const key = this.getKey(threadId, checkpointId);
    this.store.set(key, { state, metadata });
    if (this.ttl > 0) {
      setTimeout(() => this.store.delete(key), this.ttl * 1000);
    }
  }

  async listCheckpoints(threadId: string, limit = 10): Promise<string[]> {
    const prefix = `${threadId}:`;
    return Array.from(this.store.keys())
      .filter(k => k.startsWith(prefix))
      .slice(-limit)
      .map(k => k.replace(prefix, ''));
  }

  async getLatestCheckpointId(threadId: string): Promise<string | null> {
    const checkpoints = await this.listCheckpoints(threadId, 1000);
    return checkpoints[checkpoints.length - 1] || null;
  }

  async deleteThread(threadId: string): Promise<void> {
    const prefix = `${threadId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}

export function createCheckpointer(config?: CheckpointerConfig): Checkpointer {
  const useRedis = !!process.env.REDIS_URL || !!config?.redisUrl;
  
  if (useRedis) {
    return new RedisCheckpointer(config);
  }
  
  return new MemoryCheckpointer({ ttl: config?.ttl });
}
