/**
 * Multi-Agent Orchestration System
 *
 * Coordinates multiple AI agents to work together on complex tasks.
 * Supports:
 * - Hierarchical agent teams (Manager → Workers)
 * - Peer-to-peer collaboration
 * - Task decomposition and distribution
 * - Consensus-based decision making
 * - Conflict resolution
 * - Progress tracking
 *
 * @example
 * ```typescript
 * import { createAgentTeam } from '@/lib/spawn/orchestration';
 *
 * const team = await createAgentTeam({
 *   name: 'Refactoring Team',
 *   agents: [
 *     { role: 'architect', type: 'claude-code', model: 'claude-opus' },
 *     { role: 'developer', type: 'claude-code', model: 'claude-sonnet' },
 *     { role: 'reviewer', type: 'amp', model: 'amp-coder' },
 *   ],
 *   workspaceDir: '/workspace/my-project',
 * });
 *
 * const result = await team.execute({
 *   task: 'Refactor the authentication module',
 *   strategy: 'hierarchical', // or 'collaborative' or 'consensus'
 * });
 *
 * console.log(result.output);
 * console.log('Agent contributions:', result.contributions);
 * ```
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../../utils/logger';
import type { PooledAgent as PoolAgent } from '../agent-pool';
import { getAgentPool, type AgentPoolConfig, type PoolAgentType } from '../agent-pool';
import { generateText } from 'ai';
import { getVercelModel } from '@/lib/chat/vercel-ai-streaming';

const logger = createLogger('Agents:Orchestration');

// ============================================================================
// Vercel AI SDK Helper
// ============================================================================

/**
 * Run an LLM call using Vercel AI SDK generateText.
 * Replaces the old (agent as any).prompt() pattern.
 */
async function runAgentLLM(options: {
  provider: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ response: string; filesModified?: Array<{ path: string; action: string }> }> {
  let vercelModel: any;
  try {
    vercelModel = getVercelModel(options.provider, options.model);
  } catch (modelError: any) {
    logger.warn('Failed to create Vercel model, using fallback', {
      provider: options.provider,
      model: options.model,
      error: modelError.message,
    });
    // Use OpenAI as universal fallback
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({});
    vercelModel = openai('gpt-4o-mini');
  }

  const result = await generateText({
    model: vercelModel,
    messages: options.messages,
    maxOutputTokens: options.maxTokens || 8192,
    temperature: options.temperature ?? 0.7,
  });

  return {
    response: result.text || '',
    usage: result.usage,
  } as any;
}

// ============================================================================
// Types
// ============================================================================

export type AgentRole = 
  | 'architect'      // High-level design and planning
  | 'developer'      // Implementation and coding
  | 'reviewer'       // Code review and quality assurance
  | 'tester'         // Test generation and validation
  | 'documenter'     // Documentation writing
  | 'optimizer'      // Performance optimization
  | 'security'       // Security analysis
  | 'manager';       // Team coordination

export type CollaborationStrategy = 
  | 'hierarchical'   // Manager delegates to workers
  | 'collaborative' // All agents contribute equally
  | 'consensus'     // Agents vote on decisions
  | 'relay'         // Agents work in sequence (assembly line)
  | 'competitive';  // Multiple agents solve, best solution wins

export type TaskStatus = 
  | 'pending'
  | 'in_progress'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentTeamConfig {
  /** Team name */
  name: string;
  /** Agent configurations */
  agents: Array<{
    role: AgentRole;
    type: PoolAgentType;
    model?: string;
    apiKey?: string;
    /**
     * Remote address of an already-running agent server.
     * When set, pooled agents for this role connect directly to
     * the remote endpoint instead of spawning locally.
     */
    remoteAddress?: string;
    weight?: number; // For consensus voting (default: 1)
  }>;
  /** Workspace directory */
  workspaceDir: string;
  /** Collaboration strategy */
  strategy?: CollaborationStrategy;
  /** Maximum iterations for consensus/competitive */
  maxIterations?: number;
  /** Timeout for entire task (ms) */
  timeout?: number;
  /** Enable detailed logging */
  verbose?: boolean;
}

export interface TeamTask {
  /** Task description */
  task: string;
  /** Additional context */
  context?: string[];
  /** Expected output format */
  outputFormat?: string;
  /** Constraints */
  constraints?: string[];
  /** Success criteria */
  successCriteria?: string[];
}

export interface AgentContribution {
  /** Agent role */
  role: AgentRole;
  /** Agent type */
  type: PoolAgentType;
  /** Contribution text */
  content: string;
  /** When contribution was made */
  timestamp: number;
  /** Quality score (0-1) */
  qualityScore?: number;
  /** Files modified */
  filesModified?: Array<{ path: string; action: string }>;
}

export interface TeamExecutionResult {
  /** Final output */
  output: string;
  /** All agent contributions */
  contributions: AgentContribution[];
  /** Execution time (ms) */
  duration: number;
  /** Number of iterations */
  iterations: number;
  /** Task status */
  status: TaskStatus;
  /** Consensus score (for consensus strategy) */
  consensusScore?: number;
  /** Error message if failed */
  error?: string;
}

export interface TeamProgress {
  /** Current iteration */
  iteration: number;
  /** Current agent role */
  currentAgent: AgentRole;
  /** Progress percentage (0-100) */
  progress: number;
  /** Status message */
  message: string;
  /** Partial results */
  partialResults?: string;
}

// ============================================================================
// Agent Team
// ============================================================================

export class AgentTeam extends EventEmitter {
  private config: Required<AgentTeamConfig>;
  private pools: Map<PoolAgentType, any> = new Map<PoolAgentType, any>();
  private activeAgents: Map<AgentRole, PoolAgent> = new Map<AgentRole, PoolAgent>();
  private progress: TeamProgress = {
    iteration: 0,
    currentAgent: 'manager',
    progress: 0,
    message: 'Initializing',
  };
  private destroyed: boolean = false;

  constructor(config: AgentTeamConfig) {
    super();
    this.config = {
      strategy: 'hierarchical',
      maxIterations: 5,
      timeout: 600000, // 10 minutes
      verbose: false,
      ...config,
    };

    logger.info(`Creating agent team: ${config.name}`, {
      strategy: this.config.strategy,
      agentCount: config.agents.length,
    });
  }

  /**
   * Run an LLM call — tries agent pool prompt first, falls back to Vercel AI SDK.
   * This provides a smooth migration path from agent pools to direct Vercel AI SDK calls.
   */
  private async runLLM(options: {
    agent: any;
    role: string;
    message: string;
    timeout?: number;
  }): Promise<{ response: string; filesModified?: Array<{ path: string; action: string }> }> {
    const agentConfig = this.config.agents.find(a => a.role === options.role);
    const provider = agentConfig?.type || 'openai';
    const model = agentConfig?.model || process.env.DEFAULT_MODEL || 'gpt-4o';

    if (!agentConfig) {
      logger.warn(`No agent config found for role '${options.role}', using defaults`, {
        provider,
        model,
      });
    }

    // Try agent pool prompt first (if available)
    if (options.agent && typeof options.agent.prompt === 'function') {
      try {
        return await options.agent.prompt({
          message: options.message,
          timeout: options.timeout,
        });
      } catch (error: any) {
        logger.warn(`Agent pool prompt failed for ${options.role}, falling back to Vercel AI SDK`, {
          error: error.message,
        });
      }
    }

    // Fallback to Vercel AI SDK
    try {
      return await runAgentLLM({
        provider,
        model,
        messages: [{ role: 'user', content: options.message }],
        maxTokens: options.timeout ? Math.floor(options.timeout / 100) : 8192,
      });
    } catch (vercelError: any) {
      logger.error(`Vercel AI SDK fallback failed for ${options.role}`, {
        error: vercelError.message,
      });
      // Return a graceful fallback response
      return {
        response: `[${options.role} could not process the request — LLM service unavailable]`,
      };
    }
  }

  /**
   * Initialize agent pools
   */
  async initialize(): Promise<void> {
    logger.info(`Initializing ${this.config.name} team`);

    // Group agents by type for pool sharing
    const agentsByType = new Map<PoolAgentType, AgentRole[]>();
    
    for (const agent of this.config.agents) {
      const roles = agentsByType.get(agent.type) || [];
      roles.push(agent.role);
      agentsByType.set(agent.type, roles);
    }

    // Create pools for each agent type
    for (const [type, roles] of Array.from(agentsByType.entries())) {
      const pool = getAgentPool(type, {
        minSize: roles.length,
        maxSize: roles.length + 2,
        idleTimeout: 300000,
        agentConfig: {
          workspaceDir: this.config.workspaceDir,
          apiKey: this.config.agents.find(a => a.type === type)?.apiKey,
          model: this.config.agents.find(a => a.type === type)?.model,
          remoteAddress: this.config.agents.find(a => a.type === type)?.remoteAddress,
        },
      });

      this.pools.set(type, pool);
      logger.debug(`Created pool for ${type}: ${roles.join(', ')}`);
    }

    // Acquire agents for each role
    for (const agentConfig of this.config.agents) {
      const pool = this.pools.get(agentConfig.type);
      if (!pool) {
        throw new Error(`Pool not found for type: ${agentConfig.type}`);
      }

      const agent = await pool.acquire();
      this.activeAgents.set(agentConfig.role, agent);

      logger.debug(`Acquired ${agentConfig.type} agent for role: ${agentConfig.role}`);
    }

    this.emit('team:ready', { name: this.config.name });
    logger.info(`Team ${this.config.name} ready`);
  }

  /**
   * Execute a task with the team
   */
  async execute(task: TeamTask): Promise<TeamExecutionResult> {
    if (this.destroyed) {
      throw new Error('Team has been destroyed');
    }

    const startTime = Date.now();
    const contributions: AgentContribution[] = [];
    let iterations = 0;
    let finalOutput = '';

    logger.info(`Executing task with ${this.config.name}: ${task.task.substring(0, 100)}...`);

    try {
      switch (this.config.strategy) {
        case 'hierarchical':
          finalOutput = await this.executeHierarchical(task, contributions, startTime);
          break;
        case 'collaborative':
          finalOutput = await this.executeCollaborative(task, contributions, startTime);
          break;
        case 'consensus':
          finalOutput = await this.executeConsensus(task, contributions, startTime);
          break;
        case 'relay':
          finalOutput = await this.executeRelay(task, contributions, startTime);
          break;
        case 'competitive':
          finalOutput = await this.executeCompetitive(task, contributions, startTime);
          break;
      }

      iterations = this.progress.iteration;

      return {
        output: finalOutput,
        contributions,
        duration: Date.now() - startTime,
        iterations,
        status: 'completed',
      };
    } catch (error: any) {
      logger.error(`Team execution failed: ${error.message}`);
      
      return {
        output: '',
        contributions,
        duration: Date.now() - startTime,
        iterations,
        status: 'failed',
        error: error.message,
      };
    }
  }

  /**
   * Hierarchical strategy: Manager delegates to workers
   */
  private async executeHierarchical(
    task: TeamTask,
    contributions: AgentContribution[],
    startTime: number
  ): Promise<string> {
    const manager = this.activeAgents.get('manager') || this.activeAgents.get('architect');
    if (!manager) {
      throw new Error('No manager or architect agent available');
    }

    // Manager creates plan
    this.updateProgress('manager', 10, 'Creating execution plan');

    const planResult = await this.runLLM({
      agent: manager,
      role: 'manager',
      message: `Create a detailed execution plan for this task:

Task: ${task.task}
${task.context ? 'Context:\n' + task.context.join('\n') : ''}
${task.constraints ? 'Constraints:\n' + task.constraints.join('\n') : ''}

Provide a step-by-step plan with clear assignments for each team member role.`,
      timeout: this.config.timeout / 2,
    });

    contributions.push({
      role: 'manager',
      type: 'claude-code',
      content: planResult.response,
      timestamp: Date.now(),
      filesModified: planResult.filesModified,
    });

    this.emit('task:plan', { plan: planResult.response });

    // Execute plan steps with appropriate agents
    const workers = Array.from(this.activeAgents.entries())
      .filter(([role]) => role !== 'manager' && role !== 'architect');

    let step = 0;
    for (const [role, agent] of workers) {
      step++;
      const progress = 10 + Math.floor((step / workers.length) * 80);
      this.updateProgress(role as AgentRole, progress, `Executing step ${step}/${workers.length}`);

      const result = await this.runLLM({
        agent,
        role,
        message: `Execute your assigned part of the plan:

Overall Task: ${task.task}
Plan: ${planResult.response}
Your Role: ${role}

Provide your implementation and any files you modify.`,
        timeout: this.config.timeout / workers.length,
      });

      contributions.push({
        role: role as AgentRole,
        type: 'claude-code',
        content: result.response,
        timestamp: Date.now(),
        qualityScore: this.calculateQualityScore(result),
        filesModified: result.filesModified,
      });

      this.emit('task:step', { role, result: result.response });
    }

    // Reviewer validates
    const reviewer = this.activeAgents.get('reviewer');
    if (reviewer) {
      this.updateProgress('reviewer', 95, 'Reviewing results');

      const reviewResult = await this.runLLM({
        agent: reviewer,
        role: 'reviewer',
        message: `Review the team's work:

Task: ${task.task}
Contributions: ${contributions.map(c => c.content.substring(0, 500)).join('\n---\n')}

Provide feedback and final approval or request changes.`,
        timeout: 60000,
      });

      contributions.push({
        role: 'reviewer',
        type: 'amp',
        content: reviewResult.response,
        timestamp: Date.now(),
      });
    }

    this.updateProgress('manager', 100, 'Task completed');
    return contributions.map(c => c.content).join('\n\n');
  }

  /**
   * Collaborative strategy: All agents contribute equally
   */
  private async executeCollaborative(
    task: TeamTask,
    contributions: AgentContribution[],
    startTime: number
  ): Promise<string> {
    const agents = Array.from(this.activeAgents.entries());
    const results: string[] = [];

    // All agents work in parallel
    this.updateProgress('all', 0, 'Starting collaborative work');

    const promises = agents.map(async ([role, agent], index) => {
      const progress = Math.floor((index / agents.length) * 100);
      this.updateProgress(role as AgentRole, progress, `${role} contributing`);

      const result = await this.runLLM({
        agent,
        role,
        message: `Contribute to this task:

Task: ${task.task}
${task.context ? 'Context:\n' + task.context.join('\n') : ''}
Your Role: ${role}

Provide your unique contribution based on your expertise.`,
        timeout: this.config.timeout / 2,
      });

      results.push(result.response);

      contributions.push({
        role: role as AgentRole,
        type: 'claude-code',
        content: result.response,
        timestamp: Date.now(),
        qualityScore: this.calculateQualityScore(result),
        filesModified: result.filesModified,
      });

      this.emit('agent:contribute', { role, result: result.response });
    });

    await Promise.all(promises);

    // Synthesize final result
    const synthesizer = agents[0]?.[1];
    if (synthesizer) {
      this.updateProgress('manager', 90, 'Synthesizing contributions');
      
      const synthesis = await this.runLLM({
        agent: synthesizer,
        role: 'manager',
        message: `Synthesize these contributions into a cohesive final result:
        
Task: ${task.task}

Contributions:
${results.map((r, i) => `--- Contribution ${i + 1} ---\n${r}`).join('\n')}

Create a unified final output that incorporates the best elements from all contributions.`,
        timeout: 60000,
      });

      this.updateProgress('manager', 100, 'Synthesis complete');
      return synthesis.response;
    }

    return results.join('\n\n');
  }

  /**
   * Consensus strategy: Agents vote on decisions
   */
  private async executeConsensus(
    task: TeamTask,
    contributions: AgentContribution[],
    startTime: number
  ): Promise<string> {
    const agents = Array.from(this.activeAgents.entries());
    let iteration = 0;
    let consensusReached = false;
    let finalOutput = '';
    const solutions: Array<{ role: string; solution: string; weight: number }> = [];

    while (!consensusReached && iteration < this.config.maxIterations) {
      iteration++;
      this.progress.iteration = iteration;
      this.updateProgress('all', iteration * 20, `Iteration ${iteration}/${this.config.maxIterations}`);

      // Each agent provides solution
      solutions.splice(0, solutions.length); // Clear array for new iteration

      for (const [role, agent] of agents) {
        const result = await this.runLLM({
          agent,
          role,
          message: `Provide your solution for:

Task: ${task.task}
${iteration > 1 ? 'Previous solutions:\n' + solutions.map(s => s.solution.substring(0, 300)).join('\n') : ''}

Provide your best solution.`,
          timeout: this.config.timeout / this.config.maxIterations / agents.length,
        });

        solutions.push({
          role,
          solution: result.response,
          weight: this.config.agents.find(a => a.role === role)?.weight || 1,
        });

        contributions.push({
          role: role as AgentRole,
          type: 'claude-code',
          content: result.response,
          timestamp: Date.now(),
          filesModified: result.filesModified,
        });
      }

      // Vote on best solution
      const votingResult = await this.voteOnSolutions(solutions, task);
      
      if (votingResult.consensusScore > 0.7) {
        consensusReached = true;
        finalOutput = votingResult.bestSolution;
        
        contributions.push({
          role: 'manager',
          type: 'claude-code',
          content: `Consensus reached with score ${votingResult.consensusScore}`,
          timestamp: Date.now(),
        });
      }
    }

    this.updateProgress('manager', 100, consensusReached ? 'Consensus reached' : 'Max iterations reached');
    return finalOutput || solutions[solutions.length - 1]?.solution || '';
  }

  /**
   * Relay strategy: Sequential assembly line
   */
  private async executeRelay(
    task: TeamTask,
    contributions: AgentContribution[],
    startTime: number
  ): Promise<string> {
    const agents = Array.from(this.activeAgents.entries());
    let currentInput = task.task;
    let finalOutput = '';

    for (let i = 0; i < agents.length; i++) {
      const [role, agent] = agents[i];
      const progress = Math.floor(((i + 1) / agents.length) * 100);
      this.updateProgress(role as AgentRole, progress, `${role} processing`);

      const result = await this.runLLM({
        agent,
        role,
        message: `Process this input:

Input: ${currentInput}
Your Role: ${role}

Enhance, improve, or transform the input based on your expertise.`,
        timeout: this.config.timeout / agents.length,
      });

      currentInput = result.response;
      finalOutput = result.response;

      contributions.push({
        role: role as AgentRole,
        type: 'claude-code',
        content: result.response,
        timestamp: Date.now(),
        filesModified: result.filesModified,
      });

      this.emit('relay:step', { role, input: currentInput });
    }

    this.updateProgress('manager', 100, 'Relay complete');
    return finalOutput;
  }

  /**
   * Competitive strategy: Multiple solutions, pick best
   */
  private async executeCompetitive(
    task: TeamTask,
    contributions: AgentContribution[],
    startTime: number
  ): Promise<string> {
    const agents = Array.from(this.activeAgents.entries());
    const solutions: Array<{ role: string; solution: string; score: number }> = [];

    this.updateProgress('all', 0, 'Starting competition');

    // All agents create solutions
    for (const [role, agent] of agents) {
      this.updateProgress(role as AgentRole, 30, `${role} creating solution`);

      const result = await this.runLLM({
        agent,
        role,
        message: `Create the best possible solution for:

Task: ${task.task}
${task.successCriteria ? 'Success Criteria:\n' + task.successCriteria.join('\n') : ''}

Create a comprehensive, high-quality solution.`,
        timeout: this.config.timeout / 2,
      });

      solutions.push({
        role,
        solution: result.response,
        score: 0,
      });

      contributions.push({
        role: role as AgentRole,
        type: 'claude-code',
        content: result.response,
        timestamp: Date.now(),
        filesModified: result.filesModified,
      });
    }

    // Judge solutions
    this.updateProgress('reviewer', 70, 'Judging solutions');

    const judge = this.activeAgents.get('reviewer') || this.activeAgents.get('manager');
    let judgingResponse = '';

    if (judge) {
      const judging = await this.runLLM({
        agent: judge,
        role: 'reviewer',
        message: `Judge these solutions:

Task: ${task.task}
${task.successCriteria ? 'Success Criteria:\n' + task.successCriteria.join('\n') : ''}

Solutions:
${solutions.map((s, i) => `--- Solution ${i + 1} (${s.role}) ---\n${s.solution.substring(0, 500)}`).join('\n')}

Score each solution from 0-100 and explain which is best.`,
        timeout: 60000,
      });

      judgingResponse = judging.response;
      contributions.push({
        role: 'reviewer',
        type: 'amp',
        content: judging.response,
        timestamp: Date.now(),
      });
    }

    this.updateProgress('manager', 100, 'Competition complete');

    // Parse judge's scores to find best solution
    // Judge response should contain scores like "Solution 1: 85/100" or "Solution 2: 92/100"
    let bestIndex = 0;
    let bestScore = 0;

    // Multiple patterns to match different score formats
    const scorePatterns = [
      /Solution\s*(\d+)\s*[:\-]?\s*(\d+)\s*\/?\s*100/gi,  // "Solution 1: 85/100"
      /Solution\s*(\d+)\s*[:\-]?\s*(\d+)\s*points/gi,      // "Solution 1: 85 points"
      /Solution\s*(\d+)\s*[:\-]?\s*(\d+\.?\d*)\s*\/\s*\d+/gi, // "Solution 1: 85/100"
    ];

    for (const pattern of scorePatterns) {
      let match;
      while ((match = pattern.exec(judgingResponse)) !== null) {
        const solutionIndex = parseInt(match[1]) - 1;
        const score = parseFloat(match[2]);

        if (solutionIndex >= 0 && solutionIndex < solutions.length && score > bestScore) {
          bestScore = score;
          bestIndex = solutionIndex;
        }
      }

      // If we found scores, stop trying other patterns
      if (bestScore > 0) break;
    }

    // If no scores found in judging, fall back to first solution
    if (bestScore === 0 && solutions.length > 0) {
      logger.warn('No scores found in judging response, using first solution. Judge response:', judgingResponse.substring(0, 200));
    }

    contributions.push({
      role: 'manager',
      type: 'claude-code',
      content: `Best solution: #${bestIndex + 1} (score: ${bestScore}/100)`,
      timestamp: Date.now(),
    });

    return solutions[bestIndex]?.solution || '';
  }

  /**
   * Vote on solutions for consensus strategy
   */
  private async voteOnSolutions(
    solutions: Array<{ role: string; solution: string; weight: number }>,
    task: TeamTask
  ): Promise<{ bestSolution: string; consensusScore: number }> {
    const agents = Array.from(this.activeAgents.entries());
    const votes: Map<number, number> = new Map();

    // Each agent votes
    for (const [role, agent] of agents) {
      const voting = await this.runLLM({
        agent,
        role,
        message: `Vote on the best solution:

Task: ${task.task}

Solutions:
${solutions.map((s, i) => `Solution ${i + 1} (${s.role}):\n${s.solution.substring(0, 300)}`).join('\n')}

Respond with only the number of the best solution (1-${solutions.length}).`,
        timeout: 30000,
      });

      const voteMatch = voting.response.match(/(\d+)/);
      if (voteMatch) {
        const voteIndex = parseInt(voteMatch[1]) - 1;
        const weight = solutions[voteIndex]?.weight || 1;
        votes.set(voteIndex, (votes.get(voteIndex) || 0) + weight);
      }
    }

    // Find winner
    let bestIndex = 0;
    let maxVotes = 0;
    let totalVotes = 0;

    for (const [index, voteCount] of Array.from(votes.entries())) {
      totalVotes += voteCount;
      if (voteCount > maxVotes) {
        maxVotes = voteCount;
        bestIndex = index;
      }
    }

    const consensusScore = totalVotes > 0 ? maxVotes / totalVotes : 0;

    return {
      bestSolution: solutions[bestIndex]?.solution || '',
      consensusScore,
    };
  }

  /**
   * Calculate quality score for a result
   */
  private calculateQualityScore(result: { usage?: any; filesModified?: any[]; toolCalls?: any[] }): number {
    let score = 0.5; // Base score

    // Token efficiency
    if (result.usage) {
      const efficiency = result.usage.completionTokens / (result.usage.totalTokens || 1);
      score += efficiency * 0.2;
    }

    // File modifications (indicates concrete work)
    if (result.filesModified && result.filesModified.length > 0) {
      score += 0.2;
    }

    // Tool usage (indicates active work)
    if (result.toolCalls && result.toolCalls.length > 0) {
      score += 0.1;
    }

    return Math.min(1.0, score);
  }

  /**
   * Update progress and emit event
   */
  private updateProgress(agent: AgentRole | 'all', progress: number, message: string): void {
    this.progress = {
      iteration: this.progress.iteration,
      currentAgent: agent === 'all' ? this.progress.currentAgent : agent,
      progress,
      message,
    };

    this.emit('task:progress', { ...this.progress });
    
    if (this.config.verbose) {
      logger.debug(`[${this.config.name}] ${message} (${progress}%)`);
    }
  }

  /**
   * Get current progress
   */
  getProgress(): TeamProgress {
    return { ...this.progress };
  }

  /**
   * Destroy team and release agents
   */
  async destroy(): Promise<void> {
    logger.info(`Destroying team: ${this.config.name}`);

    this.destroyed = true;

    // Release all agents back to their ORIGINAL pools
    // IMPORTANT: Must release to correct pool type to prevent leaks
    const releasePromises: Promise<void>[] = [];

    for (const [role, agent] of Array.from(this.activeAgents.entries())) {
      // Get the agent's type to find correct pool
      const agentType = (agent as any).type || 'claude-code';
      const pool = this.pools.get(agentType);
      
      if (pool) {
        releasePromises.push(pool.release(agent));
      } else {
        logger.warn(`[AgentTeam] No pool found for agent type: ${agentType}, skipping release`);
      }
    }

    await Promise.all(releasePromises);
    this.activeAgents.clear();

    this.emit('team:destroy', { name: this.config.name });
    logger.info(`Team ${this.config.name} destroyed`);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createAgentTeam(config: AgentTeamConfig): Promise<AgentTeam> {
  const team = new AgentTeam(config);
  await team.initialize();
  return team;
}

export default AgentTeam;
