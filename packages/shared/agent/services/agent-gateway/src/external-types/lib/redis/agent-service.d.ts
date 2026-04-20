/**
 * Type declarations for @/lib/redis/agent-service
 * Stub for agent-gateway — mirrors the real exports from web/lib/redis/agent-service.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */
declare class RedisAgentService {
  constructor(config?: RedisAgentConfig);
  waitForConnection(timeout?: number): Promise<boolean>;
  pushJob(job: AgentJob): Promise<void>;
  popJob(timeout?: number): Promise<AgentJob | null>;
  getJob(jobId: string): Promise<AgentJob | null>;
  updateJobStatus(jobId: string, status: AgentJob['status'], updates?: Partial<AgentJob>): Promise<void>;
  getQueueLength(): Promise<number>;
  publishEvent(event: AgentEvent): Promise<void>;
  subscribeEvents(callback: (event: AgentEvent) => void, sessionId?: string): Promise<any>;
  getEventHistory(sessionId: string, limit?: number): Promise<AgentEvent[]>;
  upsertSession(session: AgentSession): Promise<void>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  getUserSessions(userId: string): Promise<AgentSession[]>;
  touchSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  registerWorker(workerId: string, metadata?: Record<string, any>): Promise<void>;
  workerHeartbeat(workerId: string, stats?: Record<string, any>): Promise<void>;
  getActiveWorkers(): Promise<Array<{ id: string; metadata?: Record<string, any> }>>;
  healthCheck(): Promise<{ connected: boolean; queueLength: number; activeWorkers: number; latency: number }>;
  disconnect(): Promise<void>;
}

export interface AgentJob {
  id: string;
  sessionId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  context?: string;
  tools?: string[];
  model?: string;
  executionPolicy?: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  workerId?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface AgentEvent {
  type: string;
  sessionId: string;
  jobId?: string;
  data: any;
  timestamp: number;
}

export interface AgentSession {
  id: string;
  userId: string;
  conversationId: string;
  createdAt: number;
  lastActivityAt: number;
  status: 'active' | 'idle' | 'completed';
  currentJobId?: string;
  metadata?: Record<string, any>;
}

export interface RedisAgentConfig {
  redisUrl?: string;
  jobQueue?: string;
  eventChannel?: string;
  eventStream?: string;
  sessionPrefix?: string;
  jobTTL?: number;
  sessionTTL?: number;
}

export function getRedisAgentService(config?: RedisAgentConfig): RedisAgentService;
export const redisAgentService: RedisAgentService;
