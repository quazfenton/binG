/**
 * Multi-Agent Collaboration System
 * 
 * Enables multiple AI agents to work together on complex tasks.
 * Supports role-based agents, task delegation, and result aggregation.
 * 
 * Features:
 * - Role-based agent specialization
 * - Task delegation and handoff
 * - Result aggregation and consensus
 * - Inter-agent communication
 */

import { EventEmitter } from 'events';

/**
 * Agent role types
 */
export type AgentRole = 
  | 'planner'
  | 'researcher'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'executor'
  | 'coordinator';

/**
 * Agent state
 */
export interface AgentState {
  /**
   * Agent ID
   */
  id: string;
  
  /**
   * Agent role
   */
  role: AgentRole;
  
  /**
   * Current task
   */
  currentTask?: string;
  
  /**
   * Agent status
   */
  status: 'idle' | 'working' | 'waiting' | 'completed';
  
  /**
   * Last activity timestamp
   */
  lastActivity: number;
}

/**
 * Task definition
 */
export interface Task {
  /**
   * Task ID
   */
  id: string;
  
  /**
   * Task description
   */
  description: string;
  
  /**
   * Assigned agent ID
   */
  assignedTo?: string;
  
  /**
   * Task status
   */
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  
  /**
   * Task result
   */
  result?: any;
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Dependencies (task IDs that must complete first)
   */
  dependencies?: string[];
  
  /**
   * Task priority (1-10)
   */
  priority: number;
}

/**
 * Message between agents
 */
export interface AgentMessage {
  /**
   * Message ID
   */
  id: string;
  
  /**
   * Sender agent ID
   */
  from: string;
  
  /**
   * Recipient agent ID (or 'all' for broadcast)
   */
  to: string;
  
  /**
   * Message type
   */
  type: 'request' | 'response' | 'notification' | 'handoff';
  
  /**
   * Message content
   */
  content: any;
  
  /**
   * Timestamp
   */
  timestamp: number;
}

/**
 * Collaboration result
 */
export interface CollaborationResult {
  /**
   * Whether collaboration succeeded
   */
  success: boolean;
  
  /**
   * Aggregated results from all agents
   */
  results: Record<string, any>;
  
  /**
   * Task completion status
   */
  taskStatus: Record<string, Task>;
  
  /**
   * Total execution time in ms
   */
  duration: number;
  
  /**
   * Error message if failed
   */
  error?: string;
}

/**
 * Multi-Agent Collaboration Manager
 * 
 * Coordinates multiple agents working together.
 */
export class MultiAgentCollaboration extends EventEmitter {
  private agents: Map<string, AgentState> = new Map();
  private tasks: Map<string, Task> = new Map();
  private messages: AgentMessage[] = [];
  private readonly MAX_MESSAGES = 1000;

  constructor() {
    super();
  }

  /**
   * Register agent
   * 
   * @param id - Agent ID
   * @param role - Agent role
   * @returns Agent state
   */
  registerAgent(id: string, role: AgentRole): AgentState {
    const agent: AgentState = {
      id,
      role,
      status: 'idle',
      lastActivity: Date.now(),
    };

    this.agents.set(id, agent);
    this.emit('agent-registered', agent);

    return agent;
  }

  /**
   * Unregister agent
   * 
   * @param id - Agent ID
   */
  unregisterAgent(id: string): void {
    this.agents.delete(id);
    this.emit('agent-unregistered', id);
  }

  /**
   * Create task
   * 
   * @param description - Task description
   * @param options - Task options
   * @returns Task
   */
  createTask(
    description: string,
    options?: {
      assignedTo?: string;
      priority?: number;
      dependencies?: string[];
    }
  ): Task {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      description,
      status: 'pending',
      priority: options?.priority || 5,
      dependencies: options?.dependencies,
      assignedTo: options?.assignedTo,
    };

    this.tasks.set(task.id, task);
    this.emit('task-created', task);

    return task;
  }

  /**
   * Assign task to agent
   * 
   * @param taskId - Task ID
   * @param agentId - Agent ID
   * @returns Whether assignment succeeded
   */
  assignTask(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task || !agent) {
      return false;
    }

    // Check dependencies
    if (task.dependencies) {
      for (const depId of task.dependencies) {
        const depTask = this.tasks.get(depId);
        if (depTask && depTask.status !== 'completed') {
          return false;
        }
      }
    }

    task.assignedTo = agentId;
    task.status = 'in-progress';
    agent.status = 'working';
    agent.currentTask = task.description;
    agent.lastActivity = Date.now();

    this.emit('task-assigned', { task, agent });

    return true;
  }

  /**
   * Complete task
   * 
   * @param taskId - Task ID
   * @param result - Task result
   * @returns Whether completion succeeded
   */
  completeTask(taskId: string, result: any): boolean {
    const task = this.tasks.get(taskId);

    if (!task) {
      return false;
    }

    task.status = 'completed';
    task.result = result;

    // Update agent status
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.lastActivity = Date.now();
      }
    }

    this.emit('task-completed', task);

    return true;
  }

  /**
   * Fail task
   * 
   * @param taskId - Task ID
   * @param error - Error message
   * @returns Whether failure was recorded
   */
  failTask(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);

    if (!task) {
      return false;
    }

    task.status = 'failed';
    task.error = error;

    // Update agent status
    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = undefined;
        agent.lastActivity = Date.now();
      }
    }

    this.emit('task-failed', task);

    return true;
  }

  /**
   * Send message between agents
   * 
   * @param from - Sender agent ID
   * @param to - Recipient agent ID
   * @param type - Message type
   * @param content - Message content
   * @returns Message
   */
  sendMessage(
    from: string,
    to: string,
    type: AgentMessage['type'],
    content: any
  ): AgentMessage {
    const message: AgentMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      type,
      content,
      timestamp: Date.now(),
    };

    this.messages.push(message);

    // Enforce max messages
    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages = this.messages.slice(-this.MAX_MESSAGES);
    }

    this.emit('message-sent', message);

    return message;
  }

  /**
   * Get messages for agent
   * 
   * @param agentId - Agent ID
   * @returns Array of messages
   */
  getMessagesForAgent(agentId: string): AgentMessage[] {
    return this.messages.filter(
      m => m.to === agentId || m.to === 'all'
    );
  }

  /**
   * Handoff task to another agent
   * 
   * @param fromAgentId - Current agent ID
   * @param toAgentId - Target agent ID
   * @param taskId - Task ID
   * @param context - Handoff context
   * @returns Whether handoff succeeded
   */
  handoffTask(
    fromAgentId: string,
    toAgentId: string,
    taskId: string,
    context?: any
  ): boolean {
    const task = this.tasks.get(taskId);
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);

    if (!task || !fromAgent || !toAgent) {
      return false;
    }

    // Send handoff message
    this.sendMessage(fromAgentId, toAgentId, 'handoff', {
      taskId,
      taskDescription: task.description,
      context,
    });

    // Reassign task
    task.assignedTo = toAgentId;
    
    // Update agent statuses
    fromAgent.status = 'idle';
    fromAgent.currentTask = undefined;
    
    toAgent.status = 'working';
    toAgent.currentTask = task.description;

    this.emit('task-handoff', { from: fromAgent, to: toAgent, task });

    return true;
  }

  /**
   * Execute collaborative task
   * 
   * @param description - Main task description
   * @param agentRoles - Agent roles to involve
   * @returns Collaboration result
   */
  async executeCollaborative(
    description: string,
    agentRoles: AgentRole[]
  ): Promise<CollaborationResult> {
    const startTime = Date.now();
    const results: Record<string, any> = {};
    const taskStatus: Record<string, Task> = {};

    // Create subtasks for each role
    const tasks: Task[] = [];
    for (const role of agentRoles) {
      const task = this.createTask(
        `${role}: ${description}`,
        { priority: 5 }
      );
      tasks.push(task);
      taskStatus[task.id] = task;
    }

    // Find or create agents for each role
    for (let i = 0; i < agentRoles.length; i++) {
      const role = agentRoles[i];
      const task = tasks[i];

      // Find agent with matching role
      let agentId: string | undefined;
      for (const [id, agent] of this.agents.entries()) {
        if (agent.role === role && agent.status === 'idle') {
          agentId = id;
          break;
        }
      }

      // If no agent found, create temporary one
      if (!agentId) {
        agentId = `temp_${role}_${Date.now()}`;
        this.registerAgent(agentId, role);
      }

      // Assign task
      this.assignTask(task.id, agentId);

      // Simulate task execution (in production, this would call actual agents)
      await this.simulateAgentExecution(agentId, task);
    }

    // Aggregate results
    for (const task of tasks) {
      results[task.id] = task.result;
      taskStatus[task.id] = task;
    }

    const allCompleted = Object.values(taskStatus).every(
      t => t.status === 'completed'
    );

    return {
      success: allCompleted,
      results,
      taskStatus,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Get agent by ID
   * 
   * @param id - Agent ID
   * @returns Agent state or null
   */
  getAgent(id: string): AgentState | null {
    return this.agents.get(id) || null;
  }

  /**
   * Get task by ID
   * 
   * @param id - Task ID
   * @returns Task or null
   */
  getTask(id: string): Task | null {
    return this.tasks.get(id) || null;
  }

  /**
   * Get all agents
   * 
   * @returns Array of agent states
   */
  getAllAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all tasks
   * 
   * @returns Array of tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get pending tasks
   * 
   * @returns Array of pending tasks
   */
  getPendingTasks(): Task[] {
    return this.getAllTasks().filter(t => t.status === 'pending');
  }

  /**
   * Get available agents
   * 
   * @returns Array of idle agents
   */
  getAvailableAgents(): AgentState[] {
    return this.getAllAgents().filter(a => a.status === 'idle');
  }

  /**
   * Get collaboration statistics
   */
  getStats(): {
    totalAgents: number;
    activeAgents: number;
    totalTasks: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalMessages: number;
  } {
    const agents = this.getAllAgents();
    const tasks = this.getAllTasks();

    return {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status === 'working').length,
      totalTasks: tasks.length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length,
      totalMessages: this.messages.length,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.agents.clear();
    this.tasks.clear();
    this.messages = [];
    this.emit('cleared');
  }

  /**
   * Simulate agent execution (for testing)
   */
  private async simulateAgentExecution(agentId: string, task: Task): Promise<void> {
    // Simulate work
    await this.sleep(100 + Math.random() * 200);

    // Complete task with mock result
    this.completeTask(task.id, {
      agentId,
      completedAt: Date.now(),
      output: `Task "${task.description}" completed by ${agentId}`,
    });
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create multi-agent collaboration manager
 * 
 * @returns Collaboration manager
 */
export function createMultiAgentCollaboration(): MultiAgentCollaboration {
  return new MultiAgentCollaboration();
}

/**
 * Quick collaborative execution helper
 * 
 * @param agentRoles - Agent roles to involve
 * @param taskDescription - Task description
 * @returns Collaboration result
 */
export async function quickCollaborativeExecute(
  agentRoles: AgentRole[],
  taskDescription: string
): Promise<CollaborationResult> {
  const collaboration = createMultiAgentCollaboration();

  // Register agents for each role
  for (const role of agentRoles) {
    collaboration.registerAgent(`${role}_agent`, role);
  }

  try {
    return await collaboration.executeCollaborative(taskDescription, agentRoles);
  } finally {
    collaboration.clear();
  }
}
