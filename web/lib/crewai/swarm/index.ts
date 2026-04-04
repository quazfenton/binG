/**
 * CrewAI Multi-Crew Swarms
 *
 * Distributed parallel crew execution with swarm orchestration.
 * Integrated with actual CrewAI crew execution.
 *
 * @see https://docs.crewai.com/en/concepts/collaboration.md
 */

import { EventEmitter } from 'node:events';
import { modelRouter } from '../runtime/model-router';
import type { Crew } from '../crew/crew';
import type { CrewOutput, CrewConfig } from '../crew/crew';
import type { TaskConfig } from '../tasks/task';

export interface Shard {
  id: string;
  name: string;
  scope: string[];
  input: Record<string, any>;
  description: string;
}

export interface ShardResult {
  shardId: string;
  success: boolean;
  output?: CrewOutput;
  error?: string;
  durationMs: number;
}

export interface AggregatorResult {
  success: boolean;
  combinedOutput: string;
  shardResults: ShardResult[];
  totalDurationMs: number;
}

export interface SwarmConfig {
  maxParallel?: number;
  timeoutPerShard?: number;
  continueOnShardFailure?: boolean;
  aggregateStrategy?: 'concatenate' | 'consensus' | 'vote' | 'llm';
}

export interface SwarmEvent {
  type: 'shard_start' | 'shard_complete' | 'shard_error' | 'aggregate_start' | 'aggregate_complete' | 'error';
  shardId?: string;
  data?: unknown;
  timestamp: number;
}

export class ShardPlanner extends EventEmitter {
  async plan(input: string, numShards: number = 3): Promise<Shard[]> {
    this.emit('plan:start', { input, numShards });

    try {
      const response = await modelRouter.call('reasoning', [
        {
          role: 'system',
          content: `You are a workload sharding specialist. Your goal is to split a complex task into ${numShards} independent, parallelizable sub-tasks (shards).
Each shard must have:
- a unique ID
- a descriptive name
- a specific scope of work
- the necessary context/input to work independently.

Return ONLY a JSON array of shards:
[{ "id": "shard_1", "name": "...", "scope": ["..."], "input": { ... }, "description": "..." }]`
        },
        {
          role: 'user',
          content: `Task to shard: ${input}`
        }
      ]);

      const shards = JSON.parse(response.content.replace(/^```json\n?|\n?```$/g, '')) as Shard[];
      this.emit('plan:created', { shards });
      return shards;
    } catch (error) {
      console.error('LLM Shard Planning failed, falling back to basic distribution:', error);
      return this.planBasic(input, numShards);
    }
  }

  private planBasic(input: string, numShards: number = 3): Shard[] {
    return Array.from({ length: numShards }, (_, i) => ({
      id: `shard_${i}_${Date.now()}`,
      name: `Shard ${i + 1}`,
      scope: [],
      description: `Part ${i + 1} of the task`,
      input: { 
        originalInput: input, 
        shardIndex: i,
        totalShards: numShards,
      },
    }));
  }

  async planWithLLM(input: string, numShards: number = 3): Promise<Shard[]> {
    return this.plan(input, numShards);
  }
}

export class AggregatorCrew {
  private strategy: SwarmConfig['aggregateStrategy'];

  constructor(strategy: SwarmConfig['aggregateStrategy'] = 'concatenate') {
    this.strategy = strategy;
  }

  /**
   * Aggregate shard results
   */
  async aggregate(shardResults: ShardResult[]): Promise<AggregatorResult> {
    const startTime = Date.now();
    const successfulResults = shardResults.filter(r => r.success);
    
    let combinedOutput: string;

    if (successfulResults.length === 0) {
      return {
        success: false,
        combinedOutput: 'No successful shards to aggregate.',
        shardResults,
        totalDurationMs: Date.now() - startTime,
      };
    }

    switch (this.strategy) {
      case 'llm':
      case 'consensus':
        combinedOutput = await this.llmAggregation(successfulResults);
        break;

      case 'vote':
        combinedOutput = await this.voteAggregation(successfulResults);
        break;

      case 'concatenate':
      default:
        combinedOutput = this.concatenateResults(successfulResults);
    }

    return {
      success: true,
      combinedOutput,
      shardResults,
      totalDurationMs: Date.now() - startTime,
    };
  }

  private concatenateResults(results: ShardResult[]): string {
    return results
      .map(r => `### Shard: ${r.shardId} (${r.durationMs}ms)\n${r.output?.raw || r.output?.toString() || ''}`)
      .join('\n\n---\n\n');
  }

  private async llmAggregation(results: ShardResult[]): Promise<string> {
    const outputs = results.map(r => `Shard ${r.shardId}:\n${r.output?.raw || ''}`).join('\n\n');
    
    try {
      const response = await modelRouter.call('reasoning', [
        {
          role: 'system',
          content: 'You are a master synthesizer. Your goal is to combine results from multiple parallel agent shards into a single, cohesive, and comprehensive final report. Remove redundancies and ensure logical flow.'
        },
        {
          role: 'user',
          content: `Individual shard results to aggregate:\n\n${outputs}`
        }
      ]);
      return response.content;
    } catch (error) {
      console.error('LLM Aggregation failed, falling back to concatenation:', error);
      return this.concatenateResults(results);
    }
  }

  private async consensusAggregation(results: ShardResult[]): Promise<string> {
    return this.llmAggregation(results);
  }

  private async voteAggregation(results: ShardResult[]): Promise<string> {
    const outputs = results.map(r => r.output?.raw || '').filter(Boolean);
    
    if (outputs.length === 1) return outputs[0];

    try {
      const response = await modelRouter.call('fast', [
        {
          role: 'system',
          content: 'You are a judge. Compare the following outputs and select the best, most comprehensive one. Return ONLY the content of the best output.'
        },
        {
          role: 'user',
          content: outputs.map((o, i) => `Output ${i+1}:\n${o}`).join('\n\n---\n\n')
        }
      ]);
      return response.content;
    } catch (error) {
      return outputs.reduce((a, b) => (b.length > a.length ? b : a));
    }
  }
}


export class MultiCrewSwarm extends EventEmitter {
  private config: SwarmConfig;
  private planner: ShardPlanner;
  private aggregator: AggregatorCrew;
  private shardCrews: Map<string, Crew> = new Map();

  constructor(config: SwarmConfig = {}) {
    super();
    this.config = {
      maxParallel: config.maxParallel || 3,
      timeoutPerShard: config.timeoutPerShard || 60000,
      continueOnShardFailure: config.continueOnShardFailure ?? true,
      aggregateStrategy: config.aggregateStrategy || 'concatenate',
    };

    this.planner = new ShardPlanner();
    this.aggregator = new AggregatorCrew(this.config.aggregateStrategy);

    this.planner.on('plan:created', (data) => {
      this.emit('swarm:event', {
        type: 'shard_start',
        data: { shards: data.shards.length },
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Register a crew for shard execution
   */
  registerShardCrew(shardId: string, crew: Crew): void {
    this.shardCrews.set(shardId, crew);
    this.emit('swarm:crew:registered', { shardId });
  }

  /**
   * Execute swarm with parallel shard processing
   */
  async execute(input: string): Promise<AggregatorResult> {
    this.emit('swarm:event', {
      type: 'aggregate_start',
      data: { input },
      timestamp: Date.now(),
    });

    // Plan shards
    const shards = await this.planner.plan(input, this.config.maxParallel);
    
    // Execute shards in parallel
    const shardResults = await this.executeShards(shards);
    
    // Aggregate results
    const result = await this.aggregator.aggregate(shardResults);
    
    this.emit('swarm:event', {
      type: 'aggregate_complete',
      data: { success: result.success, shards: shardResults.length },
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Execute shards in parallel
   */
  private async executeShards(shards: Shard[]): Promise<ShardResult[]> {
    const results: ShardResult[] = [];
    
    // Execute with concurrency limit
    const semaphore = new Semaphore(this.config.maxParallel || 3);
    
    const promises = shards.map(async (shard) => {
      await semaphore.acquire();
      
      try {
        const result = await this.executeShard(shard);
        results.push(result);
        return result;
      } finally {
        semaphore.release();
      }
    });

    await Promise.allSettled(promises);
    
    return results;
  }

  /**
   * Execute a single shard
   */
  private async executeShard(shard: Shard): Promise<ShardResult> {
    const startTime = Date.now();
    
    this.emit('swarm:event', {
      type: 'shard_start',
      shardId: shard.id,
      data: { name: shard.name },
      timestamp: Date.now(),
    });

    try {
      // Get or create crew for this shard
      const crew = this.getShardCrew(shard);
      
      // Execute with timeout
      const output = await Promise.race([
        crew.kickoff(shard.input),
        this.timeout(this.config.timeoutPerShard || 60000),
      ]);

      const result: ShardResult = {
        shardId: shard.id,
        success: true,
        output,
        durationMs: Date.now() - startTime,
      };

      this.emit('swarm:event', {
        type: 'shard_complete',
        shardId: shard.id,
        data: { success: true },
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      const result: ShardResult = {
        shardId: shard.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };

      this.emit('swarm:event', {
        type: 'shard_error',
        shardId: shard.id,
        data: { error: result.error },
        timestamp: Date.now(),
      });

      if (!this.config.continueOnShardFailure) {
        throw error;
      }

      return result;
    }
  }

  /**
   * Get crew for a shard
   */
  private getShardCrew(shard: Shard): Crew {
    // Check for registered crew
    const registeredCrew = this.shardCrews.get(shard.id);
    if (registeredCrew) {
      return registeredCrew;
    }

    // Create default crew for shard
    throw new Error(`No crew registered for shard: ${shard.id}`);
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
  }
}

export class HierarchicalSwarm extends EventEmitter {
  private metaCrew?: Crew;
  private subSwarms: Map<string, MultiCrewSwarm> = new Map();

  /**
   * Register a sub-swarm
   */
  registerSubSwarm(id: string, swarm: MultiCrewSwarm): void {
    this.subSwarms.set(id, swarm);
    
    swarm.on('swarm:event', (event) => {
      this.emit('hierarchical:event', {
        swarmId: id,
        ...event,
      });
    });
  }

  /**
   * Execute hierarchical swarm
   */
  async execute(input: string): Promise<AggregatorResult[]> {
    const results: AggregatorResult[] = [];

    // Execute sub-swarms in parallel
    const promises = Array.from(this.subSwarms.entries()).map(
      async ([id, swarm]) => {
        const result = await swarm.execute(input);
        return { id, result };
      }
    );

    const settled = await Promise.allSettled(promises);
    
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value.result);
      }
    }

    return results;
  }
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    
    if (this.queue.length > 0 && this.permits > 0) {
      this.permits--;
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }
  }
}

/**
 * Create and execute a swarm
 */
export async function createAndExecuteSwarm(
  input: string,
  config: SwarmConfig = {}
): Promise<AggregatorResult> {
  const swarm = new MultiCrewSwarm(config);
  return swarm.execute(input);
}
