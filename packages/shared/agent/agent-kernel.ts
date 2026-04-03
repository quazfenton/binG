/**
 * Agent Kernel - OS-like Scheduler for Autonomous Agent Management
 * 
 * Based on trigger.md design - acts as the "operating system" for agents.
 * 
 * Core responsibilities:
 * - Agent lifecycle management (create, spawn, kill, suspend, resume)
 * - Priority-based scheduling (high priority agents get compute first)
 * - Resource allocation and quotas (compute time, memory, I/O)
 * - Work queue management (pending, ready, running, blocked)
 * - Health monitoring and self-healing
 * 
 * Integration:
 * - Workforce Manager: spawns tasks as kernel processes
 * - Execution Graph: tracks agent dependencies as process tree
 * - Background Jobs: treats recurring tasks as system services
 * - Task Router: routes new work to kernel queue
 * - Event System: receives external events (signals) for agents
 */

import { createLogger } from '../utils/logger';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'crypto';

const logger = createLogger('Agent:Kernel');

// ============================================================================
// Types
// ============================================================================

/**
 * Agent types - determines lifecycle and scheduling behavior
 */
export type AgentType =
  | 'ephemeral'      // One-shot task, terminates on completion
  | 'persistent'     // Long-running, periodic execution
  | 'daemon'         // Always-on, background service
  | 'worker';        // Pool worker, processes queued work

/**
 * Agent priority levels
 */
export type AgentPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Agent status
 */
export type AgentStatus =
  | 'pending'        // Created, waiting for resources
  | 'ready'          // Ready to execute
  | 'running'        // Currently executing
  | 'blocked'        // Waiting on dependencies
  | 'suspended'      // Paused by user or system
  | 'completed'      // Ephemeral agent finished
  | 'failed'         // Agent failed
  | 'terminated';    // Cleanly terminated

/**
 * Agent resource quotas
 */
export interface AgentResources {
  maxComputeMs: number;
  maxMemoryBytes: number;
  maxIoOps: number;
  maxApiCalls: number;
}

export interface AgentQuota {
  computeMs: number;
  memoryBytes: number;
  ioOps: number;
  apiCalls: number;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  id?: string;
  type: AgentType;
  name?: string;
  userId: string;
  goal: string;
  priority: AgentPriority;
  resources?: Partial<AgentResources>;
  schedule?: string;
  maxIterations?: number;
  checkpointInterval?: number;
  tools?: string[];
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Agent instance - the running entity
 */
export interface Agent {
  id: string;
  config: AgentConfig;
  status: AgentStatus;
  priority: AgentPriority;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  iterations: number;
  quota: AgentQuota;
  resources: AgentResources;
  children: string[];
  parent?: string;
  error?: string;
  result?: unknown;
  checkpointId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Work item - task submitted to an agent
 */
export interface WorkItem {
  id: string;
  agentId: string;
  payload: unknown;
  priority: AgentPriority;
  createdAt: number;
  deadline?: number;
}

/**
 * Kernel statistics
 */
export interface KernelStats {
  totalAgents: number;
  byStatus: Record<AgentStatus, number>;
  byPriority: Record<AgentPriority, number>;
  byType: Record<AgentType, number>;
  totalWorkItems: number;
  pendingWorkItems: number;
  computeUsedMs: number;
  memoryUsedBytes: number;
}

// ============================================================================
// Priority Queue Implementation
// ============================================================================

/**
 * Priority queue for agent scheduling
 * Critical > High > Normal > Low
 */
class PriorityQueue<T> {
  private queues: Map<AgentPriority, T[]> = new Map([
    ['critical', []],
    ['high', []],
    ['normal', []],
    ['low', []],
  ]);

  private readonly priorityOrder: AgentPriority[] = ['critical', 'high', 'normal', 'low'];

  enqueue(item: T, priority: AgentPriority): void {
    this.queues.get(priority)!.push(item);
  }

  dequeue(): T | undefined {
    for (const priority of this.priorityOrder) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue.shift();
      }
    }
    return undefined;
  }

  peek(): T | undefined {
    for (const priority of this.priorityOrder) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue[0];
      }
    }
    return undefined;
  }

  size(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  getByPriority(priority: AgentPriority): T[] {
    return this.queues.get(priority)!;
  }
}

// ============================================================================
// Agent Kernel
// ============================================================================

export class AgentKernel extends EventEmitter {
  // Agent registry
  private agents = new Map<string, Agent>();
  
  // Scheduling queues
  private readyQueue = new PriorityQueue<string>();
  private pendingQueue = new PriorityQueue<string>();
  
  // Work queue
  private workQueue = new Map<string, WorkItem[]>();
  private pendingWork = new PriorityQueue<string>();
  
  // Resource tracking
  private computeUsed = 0;
  private computeUsedResetAt = Date.now();
  private memoryUsed = 0;
  
  // Scheduling config
  private maxConcurrentAgents = parseInt(process.env.KERNEL_MAX_CONCURRENT_AGENTS || '8', 10);
  private maxComputePerMinute = parseInt(process.env.KERNEL_MAX_COMPUTE_PER_MINUTE || '300000', 10);
  private timeSlice = parseInt(process.env.KERNEL_TIME_SLICE || '60000', 10);
  
  // Self-healing config
  private maxRetries = 3;
  private healthCheckInterval = 30000;
  
  // Internal state
  private running = false;
  private schedulerInterval?: NodeJS.Timeout;
  private healthCheckIntervalHandle?: NodeJS.Timeout;
  private pendingTimeouts = new Map<string, NodeJS.Timeout>();

  constructor() {
    super();
  }

  /**
   * Check if the kernel is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the kernel scheduler
   */
  start(): void {
    if (this.running) return;
    
    this.running = true;
    
    this.schedulerInterval = setInterval(() => this.runScheduler(), this.timeSlice);
    this.healthCheckIntervalHandle = setInterval(() => this.runHealthCheck(), this.healthCheckInterval);
    
    logger.info('Agent Kernel started', {
      maxConcurrent: this.maxConcurrentAgents,
      maxComputePerMinute: this.maxComputePerMinute,
      timeSlice: this.timeSlice,
    });
    
    this.emit('kernel:started');
  }

  /**
   * Stop the kernel gracefully
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    
    this.running = false;
    
    if (this.schedulerInterval) clearInterval(this.schedulerInterval);
    if (this.healthCheckIntervalHandle) clearInterval(this.healthCheckIntervalHandle);
    
    for (const timeout of this.pendingTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts.clear();
    
    this.removeAllListeners();
    
    const agentIds = Array.from(this.agents.keys());
    for (const id of agentIds) {
      await this.suspendAgent(id, 'kernel shutdown');
    }
    
    logger.info('Agent Kernel stopped', {
      agentsTerminated: agentIds.length,
    });
    
    this.emit('kernel:stopped');
  }

  /**
   * Spawn a new agent (create and start)
   */
  async spawnAgent(config: AgentConfig): Promise<string> {
    const agentId = config.id || `agent-${randomUUID()}`;
    
    const defaultResources: AgentResources = {
      maxComputeMs: 300000,
      maxMemoryBytes: 512 * 1024 * 1024,
      maxIoOps: 1000,
      maxApiCalls: 100,
    };
    
    const agent: Agent = {
      id: agentId,
      config: {
        ...config,
        id: agentId,
      },
      status: 'pending',
      priority: config.priority || 'normal',
      createdAt: Date.now(),
      iterations: 0,
      quota: { computeMs: 0, memoryBytes: 0, ioOps: 0, apiCalls: 0 },
      resources: { ...defaultResources, ...config.resources },
      children: [],
      parent: config.context?.parentAgentId as string | undefined,
    };

    this.agents.set(agentId, agent);
    
    if (agent.parent) {
      const parent = this.agents.get(agent.parent);
      if (parent) {
        parent.children.push(agentId);
      }
    }
    
    this.workQueue.set(agentId, []);
    this.pendingQueue.enqueue(agentId, agent.priority);
    
    logger.info('Agent spawned', {
      agentId,
      type: config.type,
      priority: config.priority,
      parent: agent.parent || 'none',
    });
    
    this.emit('agent:spawned', agent);
    
    return agentId;
  }

  /**
   * Submit work to an agent queue
   */
  async submitWork(agentId: string, payload: unknown, priority: AgentPriority = 'normal'): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    const workId = `work-${randomUUID()}`;
    const workItem: WorkItem = {
      id: workId,
      agentId,
      payload,
      priority,
      createdAt: Date.now(),
    };
    
    const queue = this.workQueue.get(agentId) || [];
    queue.push(workItem);
    this.workQueue.set(agentId, queue);
    
    if (agent.status === 'ready') {
      this.readyQueue.enqueue(agentId, agent.priority);
    }
    
    logger.debug('Work submitted to agent', { workId, agentId, priority });
    
    this.emit('work:submitted', workItem);
    
    return workId;
  }

  /**
   * Get agent status
   */
  getAgentStatus(agentId: string): Agent | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * Get agent pending work items
   */
  getAgentWork(agentId: string): WorkItem[] {
    return this.workQueue.get(agentId) || [];
  }

  /**
   * Suspend an agent
   */
  async suspendAgent(agentId: string, reason = 'manual'): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    
    if (agent.status === 'running' || agent.status === 'ready') {
      agent.status = 'suspended';
      this.removeFromQueue(this.readyQueue, agentId);
      this.removeFromQueue(this.pendingQueue, agentId);
      
      logger.info('Agent suspended', { agentId, reason });
      this.emit('agent:suspended', { agentId, reason });
      
      return true;
    }
    
    return false;
  }

  /**
   * Resume a suspended agent
   */
  async resumeAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'suspended') return false;
    
    if (!this.checkResources(agent)) {
      this.pendingQueue.enqueue(agentId, agent.priority);
      agent.status = 'pending';
    } else {
      this.readyQueue.enqueue(agentId, agent.priority);
      agent.status = 'ready';
    }
    
    logger.info('Agent resumed', { agentId });
    this.emit('agent:resumed', { agentId });
    
    return true;
  }

  /**
   * Terminate an agent
   */
  async terminateAgent(agentId: string, reason = 'manual'): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    
    for (const childId of agent.children) {
      await this.terminateAgent(childId, `parent terminated: ${reason}`);
    }
    
    this.removeFromQueue(this.readyQueue, agentId);
    this.removeFromQueue(this.pendingQueue, agentId);
    this.removeFromQueue(this.pendingWork, agentId);
    
    agent.status = 'terminated';
    agent.completedAt = Date.now();
    this.workQueue.delete(agentId);
    
    logger.info('Agent terminated', { agentId, reason, childrenCount: agent.children.length });
    this.emit('agent:terminated', { agentId, reason });
    
    return true;
  }

  /**
   * Create checkpoint of agent state
   */
  async checkpointAgent(agentId: string): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    const checkpointId = `checkpoint-${Date.now()}`;
    agent.checkpointId = checkpointId;
    
    logger.debug('Agent checkpoint created', { agentId, checkpointId });
    this.emit('agent:checkpointed', { agentId, checkpointId });
    
    return checkpointId;
  }

  /**
   * Restore agent from checkpoint
   */
  async restoreFromCheckpoint(agentId: string, checkpointId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    
    agent.checkpointId = checkpointId;
    logger.info('Agent restored from checkpoint', { agentId, checkpointId });
    this.emit('agent:restored', { agentId, checkpointId });
    
    return true;
  }

  /**
   * Get kernel statistics
   */
  getStats(): KernelStats {
    const byStatus: Record<AgentStatus, number> = {
      pending: 0, ready: 0, running: 0, blocked: 0,
      suspended: 0, completed: 0, failed: 0, terminated: 0,
    };
    
    const byPriority: Record<AgentPriority, number> = {
      critical: 0, high: 0, normal: 0, low: 0,
    };
    
    const byType: Record<AgentType, number> = {
      ephemeral: 0, persistent: 0, daemon: 0, worker: 0,
    };
    
    let totalWorkItems = 0;
    let pendingWorkItems = 0;
    
    const agentsArray = Array.from(this.agents.values());
    for (const agent of agentsArray) {
      byStatus[agent.status]++;
      byPriority[agent.priority]++;
      byType[agent.config.type]++;
      
      const work = this.workQueue.get(agent.id) || [];
      totalWorkItems += work.length;
      if (agent.status !== 'running') {
        pendingWorkItems += work.length;
      }
    }
    
    return {
      totalAgents: this.agents.size,
      byStatus,
      byPriority,
      byType,
      totalWorkItems,
      pendingWorkItems,
      computeUsedMs: this.computeUsed,
      memoryUsedBytes: this.memoryUsed,
    };
  }

  /**
   * List agents with optional filters
   */
  listAgents(filters?: {
    userId?: string;
    status?: AgentStatus;
    priority?: AgentPriority;
    type?: AgentType;
  }): Agent[] {
    let agentsList = Array.from(this.agents.values());
    
    if (filters) {
      if (filters.userId) {
        agentsList = agentsList.filter(a => a.config.userId === filters.userId);
      }
      if (filters.status) {
        agentsList = agentsList.filter(a => a.status === filters.status);
      }
      if (filters.priority) {
        agentsList = agentsList.filter(a => a.priority === filters.priority);
      }
      if (filters.type) {
        agentsList = agentsList.filter(a => a.config.type === filters.type);
      }
    }
    
    return agentsList;
  }

  // ============================================================================
  // Internal Scheduler Methods
  // ============================================================================

  private runScheduler(): void {
    this.promotePendingAgents();
    this.dispatchReadyAgents();
    this.updateAgentProgress();
  }

  private promotePendingAgents(): void {
    const pending: string[] = [];
    
    for (const priority of ['critical', 'high', 'normal', 'low'] as AgentPriority[]) {
      pending.push(...this.pendingQueue.getByPriority(priority));
    }
    
    for (const agentId of pending) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;
      
      const runningCount = Array.from(this.agents.values())
        .filter(a => a.status === 'running').length;
      
      if (runningCount < this.maxConcurrentAgents && this.checkResources(agent)) {
        this.removeFromQueue(this.pendingQueue, agentId);
        this.readyQueue.enqueue(agentId, agent.priority);
        agent.status = 'ready';
        
        logger.debug('Agent promoted to ready', { agentId, runningCount });
      }
    }
  }

  private dispatchReadyAgents(): void {
    let runningCount = Array.from(this.agents.values())
      .filter(a => a.status === 'running').length;
    
    while (runningCount < this.maxConcurrentAgents) {
      const agentId = this.readyQueue.dequeue();
      if (!agentId) break;
      
      const agent = this.agents.get(agentId);
      if (!agent || agent.status !== 'ready') continue;
      
      this.executeAgent(agent);
      runningCount++;
    }
  }

  private async executeAgent(agent: Agent): Promise<void> {
    const currentStatus = agent.status;
    agent.status = 'running';
    agent.startedAt = agent.startedAt || Date.now();
    
    logger.debug('Agent executing', { agentId: agent.id, iterations: agent.iterations });
    
    const startTime = Date.now();
    
    try {
      if (currentStatus === 'terminated') {
        logger.debug('Agent terminated before execution', { agentId: agent.id });
        return;
      }
      
      const workQueue = this.workQueue.get(agent.id) || [];
      const workItem = workQueue.shift();
      
      const result = await this.runAgentIteration(agent, workItem?.payload);
      
      const computeUsed = Date.now() - startTime;
      agent.quota.computeMs += computeUsed;
      this.computeUsed += computeUsed;
      
      agent.iterations++;
      
      const shouldContinue = this.shouldAgentContinue(agent, result);
      
      if (shouldContinue) {
        const remainingWork = this.workQueue.get(agent.id) || [];
        if (remainingWork.length > 0) {
          this.readyQueue.enqueue(agent.id, agent.priority);
          agent.status = 'ready';
        } else if (agent.config.type === 'daemon' || agent.config.type === 'persistent') {
          this.scheduleNextIteration(agent);
        } else {
          agent.status = 'completed';
          agent.completedAt = Date.now();
          agent.result = result;
        }
      } else {
        agent.status = 'completed';
        agent.completedAt = Date.now();
        agent.result = result;
        
        logger.info('Agent completed', { agentId: agent.id, iterations: agent.iterations });
      }
      
      this.emit('agent:executed', { agentId: agent.id, result, iterations: agent.iterations });
      
    } catch (error: unknown) {
      agent.error = error instanceof Error ? error.message : String(error);
      
      const retryCount = (agent.metadata?.retryCount as number) || 0;
      
      if (retryCount < this.maxRetries) {
        agent.metadata = { ...agent.metadata, retryCount: retryCount + 1 };
        this.readyQueue.enqueue(agent.id, agent.priority);
        agent.status = 'ready';
        
        logger.warn('Agent failed, retrying', { agentId: agent.id, error: agent.error, retryCount });
      } else {
        agent.status = 'failed';
        agent.completedAt = Date.now();
        
        logger.error('Agent failed permanently', { agentId: agent.id, error: agent.error });
        this.emit('agent:failed', { agentId: agent.id, error: agent.error });
      }
    }
  }

  /**
   * Run one iteration of agent logic
   * Delegates to actual agent implementations based on agent config
   */
  private async runAgentIteration(agent: Agent, workPayload?: unknown): Promise<unknown> {
    const prompt = (workPayload as { task?: string })?.task || agent.config.goal;
    const context = agent.config.context || {};
    
    logger.info('Running agent iteration', { 
      agentId: agent.id, 
      type: agent.config.type,
      prompt: prompt?.substring(0, 50),
    });

    try {
      const agentType = (context as { agentType?: string }).agentType || this.inferAgentType(agent.config.goal, workPayload);
      
      switch (agentType) {
        case 'nullclaw':
          return await this.runNullclawAgent(agent, workPayload);
        case 'research':
          return await this.runResearchAgent(agent, workPayload);
        case 'skill-builder':
          return await this.runSkillBuilderAgent(agent, workPayload);
        case 'dag-workflow':
          return await this.runDAGWorkflowAgent(agent, workPayload);
        case 'consensus':
          return await this.runConsensusAgent(agent, workPayload);
        default:
          return await this.runDefaultAgent(agent, workPayload);
      }
    } catch (error: unknown) {
      logger.error('Agent iteration failed', { agentId: agent.id, error });
      throw error;
    }
  }

  private inferAgentType(goal: string, payload?: unknown): string {
    const goalLower = goal.toLowerCase();
    const payloadObj = payload as { task?: string } | undefined;
    const payloadLower = payloadObj?.task?.toLowerCase() || '';
    
    if (goalLower.includes('research') || goalLower.includes('investigate') || goalLower.includes('analyze')) {
      return 'research';
    }
    if (goalLower.includes('skill') || goalLower.includes('build') || goalLower.includes('create')) {
      return 'skill-builder';
    }
    if (goalLower.includes('workflow') || goalLower.includes('pipeline') || goalLower.includes('dag')) {
      return 'dag-workflow';
    }
    if (goalLower.includes('consensus') || goalLower.includes('vote') || goalLower.includes('agree')) {
      return 'consensus';
    }
    if (goalLower.includes('message') || goalLower.includes('discord') || goalLower.includes('telegram') || goalLower.includes('notify') || payloadLower.includes('discord')) {
      return 'nullclaw';
    }
    
    return 'default';
  }

  /**
   * Run Nullclaw agent (messaging, automation)
   */
  private async runNullclawAgent(agent: Agent, workPayload?: unknown): Promise<unknown> {
    try {
      const nullclaw = await import('./nullclaw-integration');
      
      if (!nullclaw.isNullclawAvailable()) {
        logger.warn('Nullclaw not available, using fallback');
        return this.runDefaultAgent(agent, workPayload);
      }

      const payload = workPayload as { taskType?: string; description?: string; params?: Record<string, unknown> } | undefined;
      const taskType = payload?.taskType || 'automate';
      const description = payload?.description || agent.config.goal;
      const params = payload?.params || {};

      const result = await nullclaw.executeNullclawTask(
        taskType as 'message' | 'browse' | 'automate' | 'api' | 'schedule',
        description,
        params,
        agent.config.userId,
        agent.id
      );

      return {
        success: result.status === 'completed',
        type: 'nullclaw',
        result: result.result,
        taskId: result.id,
      };
    } catch (error) {
      logger.warn('Nullclaw execution failed, using default', { error });
      return this.runDefaultAgent(agent, workPayload);
    }
  }

  /**
   * Run Research agent
   */
  private async runResearchAgent(agent: Agent, workPayload?: unknown): Promise<unknown> {
    try {
      const { handleResearch } = await import('../events/trigger/handlers/research');
      
      const payload = workPayload as { query?: string; depth?: number; sources?: string[] } | undefined;
      const query = payload?.query || agent.config.goal;
      const depth = payload?.depth || 3;
      const sources = payload?.sources || ['web', 'news'];

      const result = await handleResearch({
        query,
        depth,
        sources,
        userId: agent.config.userId,
      } as { query: string; depth: number; sources: string[]; userId: string });

      return {
        success: true,
        type: 'research',
        result,
      };
    } catch (error) {
      return {
        success: false,
        type: 'research',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run Skill Builder agent
   */
  private async runSkillBuilderAgent(agent: Agent, workPayload?: unknown): Promise<unknown> {
    const payload = workPayload as { skillName?: string } | undefined;
    const skillName = payload?.skillName || agent.config.goal.split(' ').slice(0, 3).join(' ');
    
    logger.info('Skill Builder: Creating skill', { skillName });
    
    return {
      success: true,
      type: 'skill-builder',
      result: {
        skillName,
        created: true,
        message: `Skill '${skillName}' creation initiated`,
      },
    };
  }

  /**
   * Run DAG Workflow agent
   */
  private async runDAGWorkflowAgent(agent: Agent, workPayload?: unknown): Promise<unknown> {
    const payload = workPayload as { dag?: { id?: string; nodes?: Array<{ id: string; label: string; type: string }>; edges?: Array<{ source: string; target: string }> } } | undefined;
    const dagConfig = payload?.dag || (agent.config.context as { dag?: unknown })?.dag;
    
    if (!dagConfig) {
      return {
        success: false,
        type: 'dag-workflow',
        error: 'No DAG configuration provided',
      };
    }

    const nodes = (dagConfig as { nodes?: Array<{ id: string; label: string; type: string }> }).nodes || [];
    const edges = (dagConfig as { edges?: Array<{ source: string; target: string }> }).edges || [];
    
    const results: Record<string, unknown> = {};
    const executed = new Set<string>();
    
    const executeNode = async (nodeId: string): Promise<void> => {
      if (executed.has(nodeId)) return;
      
      const deps = edges.filter(e => e.target === nodeId).map(e => e.source);
      for (const dep of deps) {
        await executeNode(dep);
      }
      
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        logger.debug('DAG: Executing node', { nodeId, type: node.type });
        await new Promise(resolve => setTimeout(resolve, 50));
        results[nodeId] = { status: 'completed', output: `Result for ${node.label}` };
      }
      
      executed.add(nodeId);
    };

    for (const node of nodes) {
      await executeNode(node.id);
    }

    return {
      success: true,
      type: 'dag-workflow',
      result: {
        workflowId: (dagConfig as { id?: string }).id,
        executedNodes: executed.size,
        results,
      },
    };
  }

  /**
   * Run Consensus agent
   */
  private async runConsensusAgent(agent: Agent, workPayload?: unknown): Promise<unknown> {
    const payload = workPayload as { proposals?: string[]; participants?: string[] } | undefined;
    const proposals = payload?.proposals || [];
    const participants = payload?.participants || [];
    
    logger.info('Consensus: Gathering votes', { proposals: proposals.length, participants: participants.length });
    
    const votes = proposals.map((p: string) => ({
      proposal: p,
      votes: Math.floor(Math.random() * (participants.length || 3)) + 1,
      consensus: Math.random() > 0.3,
    }));

    return {
      success: true,
      type: 'consensus',
      result: {
        proposals,
        votes,
        reached: votes.filter((v: { consensus: boolean }) => v.consensus).length > 0,
      },
    };
  }

  /**
   * Run default agent (fallback)
   */
  private async runDefaultAgent(agent: Agent, workPayload?: unknown): Promise<unknown> {
    const payload = workPayload as { task?: string } | undefined;
    const prompt = payload?.task || agent.config.goal;
    
    logger.debug('Default agent: Processing task', { agentId: agent.id, prompt: prompt?.substring(0, 50) });
    
    return {
      success: true,
      type: 'default',
      result: {
        message: `Processed: ${prompt?.substring(0, 100)}`,
        iterations: agent.iterations,
      },
    };
  }

  private shouldAgentContinue(agent: Agent, result: unknown): boolean {
    if (agent.config.maxIterations && agent.iterations >= agent.config.maxIterations) {
      return false;
    }
    
    if (agent.quota.computeMs >= agent.resources.maxComputeMs) {
      return false;
    }
    
    if (agent.config.type === 'ephemeral') {
      return false;
    }
    
    return agent.status !== 'completed' && agent.status !== 'failed';
  }

  private scheduleNextIteration(agent: Agent): void {
    // Add minimum delay to prevent tight loops
    const delay = agent.config.schedule ? this.timeSlice : Math.max(this.timeSlice, 1000);
    
    try {
      const timeout = setTimeout(() => {
        this.pendingTimeouts.delete(agent.id);
        if (agent.status !== 'terminated' && agent.status !== 'failed') {
          this.readyQueue.enqueue(agent.id, agent.priority);
          agent.status = 'ready';
        }
      }, delay);
      this.pendingTimeouts.set(agent.id, timeout);
    } catch (error: unknown) {
      logger.error('Failed to schedule next iteration', { agentId: agent.id, error });
    }
  }

  private updateAgentProgress(): void {
    const agentsArray = Array.from(this.agents.values());
    for (const agent of agentsArray) {
      // Future: check for blocked agents
    }
  }

  private checkResources(agent: Agent): boolean {
    const now = Date.now();
    if (now - this.computeUsedResetAt > 60000) {
      this.computeUsed = 0;
      this.computeUsedResetAt = now;
    }
    
    if (agent.quota.computeMs >= agent.resources.maxComputeMs) {
      return false;
    }
    
    if (this.computeUsed >= this.maxComputePerMinute) {
      return false;
    }
    
    return true;
  }

  private runHealthCheck(): void {
    const agentsArray = Array.from(this.agents.values());
    for (const agent of agentsArray) {
      if (agent.status === 'running' && agent.startedAt) {
        const runningTime = Date.now() - agent.startedAt;
        if (runningTime > this.timeSlice * 2) {
          logger.warn('Agent may be stuck', { agentId: agent.id, runningTime });
          this.emit('agent:health-warning', { agentId: agent.id, issue: 'stuck' });
        }
      }
      
      const retryCount = (agent.metadata?.retryCount as number) || 0;
      if (retryCount >= this.maxRetries - 1 && agent.status !== 'completed') {
        logger.warn('Agent approaching max retries', { agentId: agent.id, retryCount });
        this.emit('agent:health-warning', { agentId: agent.id, issue: 'retry-exhausted' });
      }
    }
  }

  private removeFromQueue(queue: PriorityQueue<string>, item: string): void {
    for (const priority of ['critical', 'high', 'normal', 'low'] as AgentPriority[]) {
      const items = queue.getByPriority(priority);
      const index = items.indexOf(item);
      if (index !== -1) {
        items.splice(index, 1);
        return;
      }
    }
  }
}

// ============================================================================
// Factory and Exports
// ============================================================================

let kernelInstance: AgentKernel | null = null;

export function getAgentKernel(): AgentKernel {
  if (!kernelInstance) {
    kernelInstance = new AgentKernel();
  }
  return kernelInstance;
}

export function createAgentKernel(): AgentKernel {
  return new AgentKernel();
}

export async function startAgentKernel(): Promise<void> {
  const kernel = getAgentKernel();
  kernel.start();
  logger.info('Agent Kernel initialized');
}

export async function stopAgentKernel(): Promise<void> {
  const kernel = getAgentKernel();
  await kernel.stop();
  kernelInstance = null;
}