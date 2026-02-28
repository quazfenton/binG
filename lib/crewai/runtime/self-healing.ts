/**
 * CrewAI Self-Healing System
 *
 * Advanced retry logic, cross-agent consensus, and error recovery.
 * Integrated with crew execution for automatic recovery.
 *
 * @see https://docs.crewai.com/en/concepts/planning.md
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import type { Crew } from '../crew/crew';
import type { CrewOutput } from '../crew/crew';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  exponentialBackoff: boolean;
  retryableErrors: string[];
  onRetry?: (attempt: number, error: Error) => void;
}

export interface AgentRetryState {
  agentId: string;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  lastError?: string;
  lastAttemptTime: number;
  retryHistory: Array<{
    attempt: number;
    error: string;
    timestamp: number;
    recovered: boolean;
  }>;
  onRetry?: (attempt: number, error: Error) => void;
}

export interface ConsensusVote {
  agentId: string;
  vote: 'approve' | 'reject' | 'abstain';
  reason: string;
  confidence: number;
}

export interface ConsensusResult {
  approved: boolean;
  votes: ConsensusVote[];
  finalReason: string;
  confidence: number;
}

export interface HealingStrategy {
  name: string;
  canHandle: (error: Error, context: unknown) => boolean;
  execute: (error: Error, context: unknown) => Promise<unknown>;
}

export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  exponentialBackoff: true,
  retryableErrors: [
    'timeout',
    'rate_limit',
    'network',
    '502',
    '503',
    '504',
    'ECONNRESET',
    'ETIMEDOUT',
  ],
};

export class RetryBudget {
  private state: AgentRetryState;
  private config: RetryConfig;

  constructor(agentId: string, config: Partial<RetryConfig> = {}) {
    this.config = { ...defaultRetryConfig, ...config };
    this.state = {
      agentId,
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      lastAttemptTime: 0,
      retryHistory: [],
    };
  }

  canRetry(): boolean {
    return this.state.totalAttempts < this.config.maxRetries;
  }

  recordAttempt(error: Error, recovered: boolean = false): void {
    this.state.totalAttempts++;
    this.state.lastAttemptTime = Date.now();
    this.state.lastError = error.message;

    this.state.retryHistory.push({
      attempt: this.state.totalAttempts,
      error: error.message,
      timestamp: Date.now(),
      recovered,
    });

    if (recovered) {
      this.state.successfulAttempts++;
    } else {
      this.state.failedAttempts++;
    }

    if (this.state.onRetry) {
      this.state.onRetry(this.state.totalAttempts, error);
    }
  }

  recordSuccess(): void {
    this.state.successfulAttempts++;
    this.state.totalAttempts++;
    this.state.lastAttemptTime = Date.now();
  }

  calculateDelay(): number {
    if (!this.config.exponentialBackoff) {
      return this.config.initialDelayMs;
    }

    const baseDelay = this.config.initialDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, this.state.failedAttempts - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay;

    return Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
  }

  isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    return this.config.retryableErrors.some(pattern =>
      errorMessage.includes(pattern.toLowerCase())
    );
  }

  getState(): AgentRetryState {
    return { ...this.state };
  }

  reset(): void {
    this.state.totalAttempts = 0;
    this.state.successfulAttempts = 0;
    this.state.failedAttempts = 0;
    this.state.lastError = undefined;
    this.state.retryHistory = [];
  }
}

export class CrossAgentConsensus {
  private votes: Map<string, ConsensusVote> = new Map();
  private requiredAgents: string[] = [];
  private quorumThreshold: number = 0.6;

  constructor(requiredAgents: string[], quorumThreshold: number = 0.6) {
    this.requiredAgents = requiredAgents;
    this.quorumThreshold = quorumThreshold;
  }

  addVote(vote: ConsensusVote): void {
    this.votes.set(vote.agentId, vote);
  }

  hasVoted(agentId: string): boolean {
    return this.votes.has(agentId);
  }

  allVotesReceived(): boolean {
    return this.requiredAgents.every(agentId => this.votes.has(agentId));
  }

  quorumReached(): boolean {
    const totalVotes = this.votes.size;
    const requiredVotes = Math.ceil(this.requiredAgents.length * this.quorumThreshold);
    return totalVotes >= requiredVotes;
  }

  evaluate(): ConsensusResult {
    const votesArray = Array.from(this.votes.values());
    
    const approveVotes = votesArray.filter(v => v.vote === 'approve');
    const rejectVotes = votesArray.filter(v => v.vote === 'reject');
    const abstainVotes = votesArray.filter(v => v.vote === 'abstain');

    const approved = approveVotes.length > rejectVotes.length;
    
    const totalConfidence = votesArray.reduce((sum, v) => sum + v.confidence, 0);
    const avgConfidence = votesArray.length > 0 ? totalConfidence / votesArray.length : 0;

    const finalReason = approved
      ? `Approved by ${approveVotes.length}/${votesArray.length} agents`
      : `Rejected by ${rejectVotes.length}/${votesArray.length} agents`;

    return {
      approved,
      votes: votesArray,
      finalReason,
      confidence: avgConfidence,
    };
  }

  reset(): void {
    this.votes.clear();
  }
}

export class SelfHealingExecutor extends EventEmitter {
  private strategies: HealingStrategy[] = [];
  private retryBudgets: Map<string, RetryBudget> = new Map();

  constructor() {
    super();
    this.registerDefaultStrategies();
  }

  /**
   * Execute a crew with self-healing retry logic
   */
  async executeWithRetry(
    crew: Crew,
    input: string,
    agentId: string,
    config: Partial<RetryConfig> = {}
  ): Promise<CrewOutput> {
    const retryBudget = this.getOrCreateRetryBudget(agentId, config);
    let lastError: Error | null = null;

    while (retryBudget.canRetry()) {
      try {
        this.emit('execution:start', { agentId, attempt: retryBudget.getState().totalAttempts + 1 });
        
        const result = await crew.kickoff(input);
        
        retryBudget.recordSuccess();
        this.emit('execution:success', { agentId, result });
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (!retryBudget.isRetryableError(lastError)) {
          this.emit('execution:error', { agentId, error: lastError, retryable: false });
          throw lastError;
        }

        retryBudget.recordAttempt(lastError);
        this.emit('execution:retry', { 
          agentId, 
          error: lastError, 
          attempt: retryBudget.getState().totalAttempts,
          delay: retryBudget.calculateDelay() 
        });

        if (retryBudget.onRetry) {
          retryBudget.onRetry(retryBudget.getState().totalAttempts, lastError);
        }

        // Try healing strategies
        const healed = await this.tryHealing(lastError, { crew, input, agentId });
        if (healed) {
          this.emit('execution:healed', { agentId, strategy: healed });
        }

        // Wait before retry
        const delay = retryBudget.calculateDelay();
        await this.sleep(delay);
      }
    }

    const finalError = new Error(
      `Max retries (${retryBudget.getState().totalAttempts}) exceeded. Last error: ${lastError?.message}`
    );
    this.emit('execution:failed', { agentId, error: finalError });
    throw finalError;
  }

  /**
   * Register a healing strategy
   */
  registerStrategy(strategy: HealingStrategy): void {
    this.strategies.push(strategy);
    this.emit('strategy:registered', { name: strategy.name });
  }

  /**
   * Try healing strategies for an error
   */
  private async tryHealing(error: Error, context: unknown): Promise<string | null> {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(error, context)) {
        try {
          await strategy.execute(error, context);
          return strategy.name;
        } catch (healingError) {
          this.emit('strategy:failed', { 
            strategy: strategy.name, 
            error: healingError 
          });
        }
      }
    }
    return null;
  }

  /**
   * Get or create a retry budget for an agent
   */
  private getOrCreateRetryBudget(agentId: string, config: Partial<RetryConfig>): RetryBudget {
    let budget = this.retryBudgets.get(agentId);
    
    if (!budget) {
      budget = new RetryBudget(agentId, config);
      this.retryBudgets.set(agentId, budget);
    }
    
    return budget;
  }

  /**
   * Get retry budget for an agent
   */
  getRetryBudget(agentId: string): RetryBudget | undefined {
    return this.retryBudgets.get(agentId);
  }

  /**
   * Reset retry budget for an agent
   */
  resetRetryBudget(agentId: string): void {
    const budget = this.retryBudgets.get(agentId);
    if (budget) {
      budget.reset();
    }
  }

  /**
   * Register default healing strategies
   */
  private registerDefaultStrategies(): void {
    // Rate limit backoff strategy
    this.registerStrategy({
      name: 'rate-limit-backoff',
      canHandle: (error) => error.message.toLowerCase().includes('rate limit'),
      execute: async () => {
        // Additional backoff for rate limits
        await this.sleep(5000);
      },
    });

    // Timeout recovery strategy
    this.registerStrategy({
      name: 'timeout-recovery',
      canHandle: (error) => error.message.toLowerCase().includes('timeout'),
      execute: async () => {
        // Clear any pending state
        this.emit('recovery:timeout');
      },
    });

    // Network error recovery
    this.registerStrategy({
      name: 'network-recovery',
      canHandle: (error) => 
        error.message.toLowerCase().includes('network') ||
        error.message.toLowerCase().includes('econnreset'),
      execute: async () => {
        // Wait for network to stabilize
        await this.sleep(2000);
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Run a crew with self-healing enabled
 */
export async function runCrewWithSelfHealing(
  crew: Crew,
  input: string,
  agentId: string,
  executor?: SelfHealingExecutor,
  config?: Partial<RetryConfig>
): Promise<CrewOutput> {
  const healingExecutor = executor || new SelfHealingExecutor();
  return healingExecutor.executeWithRetry(crew, input, agentId, config);
}
