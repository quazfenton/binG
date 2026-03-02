/**
 * CrewAI Crew Orchestration
 *
 * Supports sequential/hierarchical execution and an experimental consensual mode.
 */

import { EventEmitter } from 'events';
import type { RoleAgent } from '../agents/role-agent';
import type { Task, TaskOutput } from '../tasks/task';

export type ProcessType = 'sequential' | 'hierarchical' | 'consensual';

export interface CrewConfig {
  agents: RoleAgent[];
  tasks: Task[];
  process?: ProcessType;
  verbose?: boolean;
  memory?: boolean;
  cache?: boolean;
  max_rpm?: number;
  share_crew?: boolean;
  planning?: boolean;
  planning_llm?: string;
  step_callback?: (output: any) => void | Promise<void>;
  task_callback?: (task: Task, output: TaskOutput) => void | Promise<void>;
  before_kickoff?: (inputs?: Record<string, string | number | boolean>) => Promise<Record<string, string | number | boolean> | void> | Record<string, string | number | boolean> | void;
  after_kickoff?: (output: CrewOutput) => Promise<CrewOutput | void> | CrewOutput | void;
  process_llm?: string;
  manager_llm?: string;
  manager_agent?: RoleAgent;
  function_calling_llm?: string;
  embedder?: {
    provider?: string;
    model?: string;
    api_key?: string;
  };
  output_log_file?: string;
  tracing?: boolean;
  stream?: boolean;
  event_listeners?: Array<(event: { name: string; data: unknown }) => void | Promise<void>>;
  prompt_file?: string;
  knowledge_sources?: CrewKnowledgeSource[];
  config?: Record<string, any>;
}

export interface CrewKnowledgeSource {
  type: 'pdf' | 'website' | 'directory' | 'text';
  source: string;
  description?: string;
}

export interface CrewOutput {
  raw: string;
  pydantic?: any;
  json_dict?: Record<string, any>;
  tasks_output: TaskOutput[];
  token_usage: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  };
  metadata?: {
    process: ProcessType;
    durationMs: number;
  };
}

export interface StreamChunk {
  type: 'task_start' | 'task_complete' | 'agent_action' | 'log' | 'metric' | 'final';
  content: string;
  data?: any;
}

export interface KickoffOptions {
  inputs?: Record<string, string | number | boolean>;
}

export class Crew {
  public readonly agents: RoleAgent[];
  public readonly tasks: Task[];
  public readonly process: ProcessType;
  public readonly verbose: boolean;
  public readonly memory: boolean;
  public readonly cache: boolean;
  public readonly max_rpm?: number;
  public readonly share_crew: boolean;
  public readonly planning: boolean;
  public readonly step_callback?: (output: any) => void | Promise<void>;
  public readonly task_callback?: (task: Task, output: TaskOutput) => void | Promise<void>;
  public readonly before_kickoff?: CrewConfig['before_kickoff'];
  public readonly after_kickoff?: CrewConfig['after_kickoff'];
  public readonly process_llm?: string;
  public readonly manager_llm?: string;
  public manager_agent?: RoleAgent;
  public readonly function_calling_llm?: string;
  public readonly embedder?: { provider?: string; model?: string; api_key?: string };
  public readonly output_log_file?: string;
  public tracing: boolean;
  public readonly stream?: boolean;
  public readonly event_listeners: Array<(event: { name: string; data: unknown }) => void | Promise<void>>;
  public readonly events: EventEmitter;
  public readonly planning_llm?: string;
  public readonly prompt_file?: string;
  public readonly knowledge_sources?: CrewKnowledgeSource[];
  public readonly config?: Record<string, any>;

  private output?: CrewOutput;

  constructor(config: CrewConfig) {
    this.agents = config.agents;
    this.tasks = config.tasks;
    this.process = config.process || 'sequential';
    this.verbose = config.verbose || false;
    this.memory = config.memory || false;
    this.cache = config.cache ?? true;
    this.max_rpm = config.max_rpm;
    this.share_crew = config.share_crew || false;
    this.planning = config.planning || false;
    this.planning_llm = config.planning_llm;
    this.step_callback = config.step_callback;
    this.task_callback = config.task_callback;
    this.before_kickoff = config.before_kickoff;
    this.after_kickoff = config.after_kickoff;
    this.process_llm = config.process_llm;
    this.manager_llm = config.manager_llm;
    this.manager_agent = config.manager_agent;
    this.function_calling_llm = config.function_calling_llm;
    this.embedder = config.embedder;
    this.output_log_file = config.output_log_file;
    this.prompt_file = config.prompt_file;
    this.knowledge_sources = config.knowledge_sources;
    this.config = config.config;
    this.tracing = config.tracing ?? false;
    this.stream = config.stream;
    this.event_listeners = config.event_listeners || [];
    this.events = new EventEmitter();

    this.validateConfiguration();
    this.configureAgents();
    void this.initializeLogFile();
  }

  private validateConfiguration(): void {
    if (this.tasks.length === 0) {
      throw new Error('Crew must include at least one task');
    }
    if (this.agents.length === 0) {
      throw new Error('Crew must include at least one agent');
    }
    if (this.process === 'hierarchical' && !this.manager_agent && !this.manager_llm) {
      throw new Error(
        'Hierarchical process requires either manager_agent or manager_llm',
      );
    }
  }

  private configureAgents(): void {
    if (this.memory) {
      this.agents.forEach((agent) => agent.enableMemory());
    }
    if (this.embedder) {
      this.agents.forEach((agent) =>
        agent.setEmbedder(this.embedder?.provider || 'openai', this.embedder?.model, this.embedder?.api_key),
      );
    }
  }

  private async initializeLogFile(): Promise<void> {
    if (!this.output_log_file) return;
    const fs = await import('fs/promises');
    const path = await import('path');
    await fs.mkdir(path.dirname(this.output_log_file), { recursive: true });
    await fs.writeFile(this.output_log_file, '', 'utf-8');
  }

  private async logToFile(message: string): Promise<void> {
    if (!this.output_log_file) return;
    const fs = await import('fs/promises');
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      message,
    });
    await fs.appendFile(this.output_log_file, `${entry}\n`, 'utf-8');
  }

  private async emitEvent(name: string, data: unknown): Promise<void> {
    this.events.emit(name, data);
    for (const listener of this.event_listeners) {
      try {
        await listener({ name, data });
      } catch (error) {
        this.log(
          `Event listener failed for ${name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'error',
        );
      }
    }
  }

  private log(message: string, type: 'header' | 'success' | 'error' | 'info' = 'info'): void {
    if (!this.verbose) return;
    const prefix = {
      header: '[Crew]',
      success: '[Crew:OK]',
      error: '[Crew:ERR]',
      info: '[Crew:INFO]',
    }[type];
    console.log(`${prefix} ${message}`);
    void this.logToFile(message);
  }

  async kickoff(options: KickoffOptions = {}): Promise<CrewOutput> {
    const startedAt = Date.now();
    let inputs = options.inputs;
    if (this.before_kickoff) {
      const maybeInputs = await this.before_kickoff(inputs);
      if (maybeInputs) inputs = maybeInputs;
    }

    const tasksOutput: TaskOutput[] = [];
    await this.emitEvent('crew:start', { inputs, process: this.process, timestamp: startedAt });
    this.log(`Starting crew execution (${this.process})`, 'header');

    if (this.process === 'sequential') {
      await this.executeSequential(inputs, tasksOutput);
    } else if (this.process === 'hierarchical') {
      await this.executeHierarchical(inputs, tasksOutput);
    } else {
      await this.executeConsensual(inputs, tasksOutput);
    }

    const output: CrewOutput = {
      raw: tasksOutput.map((item) => item.raw).join('\n\n'),
      tasks_output: tasksOutput,
      token_usage: {
        total_tokens: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
      },
      metadata: {
        process: this.process,
        durationMs: Date.now() - startedAt,
      },
    };

    const maybeFinal = this.after_kickoff ? await this.after_kickoff(output) : undefined;
    this.output = maybeFinal || output;
    await this.emitEvent('crew:complete', this.output);
    this.log(`Crew execution completed in ${this.output.metadata?.durationMs || 0}ms`, 'success');
    void this.logToFile(`completed:${this.output.metadata?.durationMs || 0}`);

    return this.output;
  }

  async *kickoffStream(options: KickoffOptions = {}): AsyncGenerator<StreamChunk> {
    const startedAt = Date.now();
    let inputs = options.inputs;
    if (this.before_kickoff) {
      const maybeInputs = await this.before_kickoff(inputs);
      if (maybeInputs) inputs = maybeInputs;
    }

    const tasksOutput: TaskOutput[] = [];
    yield { type: 'log', content: `Starting crew execution (${this.process})` };

    if (this.process === 'sequential') {
      for await (const chunk of this.executeSequentialStream(inputs, tasksOutput)) yield chunk;
    } else if (this.process === 'hierarchical') {
      for await (const chunk of this.executeHierarchicalStream(inputs, tasksOutput)) yield chunk;
    } else {
      for await (const chunk of this.executeConsensualStream(inputs, tasksOutput)) yield chunk;
    }

    const output: CrewOutput = {
      raw: tasksOutput.map((item) => item.raw).join('\n\n'),
      tasks_output: tasksOutput,
      token_usage: {
        total_tokens: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
      },
      metadata: {
        process: this.process,
        durationMs: Date.now() - startedAt,
      },
    };
    this.output = this.after_kickoff ? (await this.after_kickoff(output)) || output : output;
    yield {
      type: 'metric',
      content: 'Crew execution metrics',
      data: this.output.metadata,
    };
    yield { type: 'final', content: this.output.raw, data: this.output };
  }

  async kickoffAsync(options: KickoffOptions = {}): Promise<CrewOutput> {
    return this.kickoff(options);
  }

  async kickoffForEach(
    inputs: Array<Record<string, string | number | boolean>>,
  ): Promise<CrewOutput[]> {
    const results: CrewOutput[] = [];
    for (const input of inputs) {
      results.push(await this.kickoff({ inputs: input }));
    }
    return results;
  }

  async kickoffForEachAsync(
    inputs: Array<Record<string, string | number | boolean>>,
  ): Promise<CrewOutput[]> {
    return Promise.all(inputs.map((input) => this.kickoffAsync({ inputs: input })));
  }

  async akickoff(options: KickoffOptions = {}): Promise<CrewOutput> {
    const startedAt = Date.now();
    let inputs = options.inputs;
    if (this.before_kickoff) {
      const maybeInputs = await this.before_kickoff(inputs);
      if (maybeInputs) inputs = maybeInputs;
    }

    const tasksOutput: TaskOutput[] = [];
    await this.emitEvent('crew:start', { inputs, process: this.process, timestamp: startedAt });
    this.log(`Starting async crew execution (${this.process})`, 'header');

    if (this.process === 'sequential') {
      await this.executeSequentialAsync(inputs, tasksOutput);
    } else if (this.process === 'hierarchical') {
      await this.executeHierarchicalAsync(inputs, tasksOutput);
    } else {
      await this.executeConsensualAsync(inputs, tasksOutput);
    }

    const output: CrewOutput = {
      raw: tasksOutput.map((item) => item.raw).join('\n\n'),
      tasks_output: tasksOutput,
      token_usage: {
        total_tokens: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
      },
      metadata: {
        process: this.process,
        durationMs: Date.now() - startedAt,
      },
    };

    const maybeFinal = this.after_kickoff ? await this.after_kickoff(output) : undefined;
    this.output = maybeFinal || output;
    await this.emitEvent('crew:complete', this.output);
    this.log(`Async crew execution completed in ${this.output.metadata?.durationMs || 0}ms`, 'success');

    return this.output;
  }

  async akickoffForEach(
    inputsArray: Array<Record<string, string | number | boolean>>,
  ): Promise<CrewOutput[]> {
    return Promise.all(
      inputsArray.map(async (inputs) => {
        const crew = new Crew({
          agents: this.agents,
          tasks: this.tasks,
          process: this.process,
          verbose: this.verbose,
          memory: this.memory,
          cache: this.cache,
          max_rpm: this.max_rpm,
          share_crew: this.share_crew,
          planning: this.planning,
          planning_llm: this.planning_llm,
          step_callback: this.step_callback,
          task_callback: this.task_callback,
          before_kickoff: this.before_kickoff,
          after_kickoff: this.after_kickoff,
          process_llm: this.process_llm,
          manager_llm: this.manager_llm,
          manager_agent: this.manager_agent,
          function_calling_llm: this.function_calling_llm,
          embedder: this.embedder,
          output_log_file: this.output_log_file,
          tracing: this.tracing,
          stream: this.stream,
          event_listeners: this.event_listeners,
          prompt_file: this.prompt_file,
          knowledge_sources: this.knowledge_sources,
          config: this.config,
        });
        return crew.akickoff({ inputs });
      })
    );
  }

  getOutput(): CrewOutput | undefined {
    return this.output;
  }

  private async executeSequential(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): Promise<void> {
    for (const task of this.tasks) {
      const startedAt = Date.now();
      const output = await task.execute({ inputs });
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
    }
  }

  private async *executeSequentialStream(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): AsyncGenerator<StreamChunk> {
    for (const task of this.tasks) {
      const startedAt = Date.now();
      yield { type: 'task_start', content: task.description, data: { agent: task.agent.role } };
      const output = await task.execute({ inputs });
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
      yield {
        type: 'task_complete',
        content: `Task completed by ${output.agent}`,
        data: { output: output.raw, durationMs: Date.now() - startedAt },
      };
    }
  }

  private async executeHierarchical(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): Promise<void> {
    const manager = this.getManagerAgent();
    const plan = await manager.kickoff(
      `Create a concise execution plan for these tasks:\n${this.tasks.map((t) => `- ${t.description}`).join('\n')}`,
    );
    this.log(`Manager plan: ${plan.raw}`);

    for (const task of this.tasks) {
      const startedAt = Date.now();
      const output = await task.execute({ inputs });
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
    }
  }

  private async *executeHierarchicalStream(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): AsyncGenerator<StreamChunk> {
    const manager = this.getManagerAgent();
    yield { type: 'agent_action', content: `Manager ${manager.role} is planning` };
    const plan = await manager.kickoff(
      `Create a concise execution plan for these tasks:\n${this.tasks.map((t) => `- ${t.description}`).join('\n')}`,
    );
    yield { type: 'log', content: 'Manager plan created', data: { plan: plan.raw } };

    for (const task of this.tasks) {
      const startedAt = Date.now();
      yield { type: 'task_start', content: task.description, data: { agent: task.agent.role } };
      const output = await task.execute({ inputs });
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
      yield {
        type: 'task_complete',
        content: `Task completed by ${output.agent}`,
        data: { output: output.raw, durationMs: Date.now() - startedAt },
      };
    }
  }

  private async executeConsensual(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): Promise<void> {
    // Experimental mode: each agent contributes then task agent synthesizes.
    for (const task of this.tasks) {
      const startedAt = Date.now();
      const contributions: string[] = [];
      for (const agent of this.agents) {
        const contribution = await agent.kickoff(
          `Provide your contribution for:\n${task.description}\n\nInputs:\n${JSON.stringify(inputs || {}, null, 2)}`,
        );
        contributions.push(`${agent.role}:\n${contribution.raw}`);
      }
      const final = await task.agent.kickoff(
        `Synthesize these contributions:\n\n${contributions.join('\n\n---\n\n')}`,
      );
      const output: TaskOutput = {
        description: task.description,
        summary: final.raw.slice(0, 160),
        raw: final.raw,
        agent: task.agent.role,
        output_format: 'RAW',
      };
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
    }
  }

  private async *executeConsensualStream(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): AsyncGenerator<StreamChunk> {
    for (const task of this.tasks) {
      const startedAt = Date.now();
      yield { type: 'task_start', content: task.description };
      const contributions: string[] = [];
      for (const agent of this.agents) {
        yield { type: 'agent_action', content: `${agent.role} is contributing` };
        const contribution = await agent.kickoff(
          `Provide your contribution for:\n${task.description}\n\nInputs:\n${JSON.stringify(inputs || {}, null, 2)}`,
        );
        contributions.push(`${agent.role}:\n${contribution.raw}`);
      }
      const final = await task.agent.kickoff(
        `Synthesize these contributions:\n\n${contributions.join('\n\n---\n\n')}`,
      );
      const output: TaskOutput = {
        description: task.description,
        summary: final.raw.slice(0, 160),
        raw: final.raw,
        agent: task.agent.role,
        output_format: 'RAW',
      };
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
      yield {
        type: 'task_complete',
        content: `Task completed by ${task.agent.role}`,
        data: { durationMs: Date.now() - startedAt },
      };
    }
  }

  private async executeSequentialAsync(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): Promise<void> {
    for (const task of this.tasks) {
      const startedAt = Date.now();
      const output = await task.execute({ inputs });
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
    }
  }

  private async executeHierarchicalAsync(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): Promise<void> {
    const manager = this.getManagerAgent();
    const plan = await manager.kickoff(
      `Create a concise execution plan for these tasks:\n${this.tasks.map((t) => `- ${t.description}`).join('\n')}`,
    );
    this.log(`Manager plan: ${plan.raw}`);

    for (const task of this.tasks) {
      const startedAt = Date.now();
      const output = await task.execute({ inputs });
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
    }
  }

  private async executeConsensualAsync(
    inputs: Record<string, string | number | boolean> | undefined,
    outputs: TaskOutput[],
  ): Promise<void> {
    for (const task of this.tasks) {
      const startedAt = Date.now();
      const contributions: string[] = [];
      const results = await Promise.all(
        this.agents.map(async (agent) => {
          const contribution = await agent.kickoff(
            `Provide your contribution for:\n${task.description}\n\nInputs:\n${JSON.stringify(inputs || {}, null, 2)}`,
          );
          return `${agent.role}:\n${contribution.raw}`;
        })
      );
      contributions.push(...results);
      
      const final = await task.agent.kickoff(
        `Synthesize these contributions:\n\n${contributions.join('\n\n---\n\n')}`,
      );
      const output: TaskOutput = {
        description: task.description,
        summary: final.raw.slice(0, 160),
        raw: final.raw,
        agent: task.agent.role,
        output_format: 'RAW',
      };
      outputs.push(output);
      await this.afterTask(task, output, startedAt);
    }
  }

  private async afterTask(task: Task, output: TaskOutput, startedAt: number): Promise<void> {
    if (this.task_callback) {
      await this.task_callback(task, output);
    }
    if (this.step_callback) {
      await this.step_callback(output);
    }
    const durationMs = Date.now() - startedAt;
    await this.emitEvent('task:complete', {
      task: task.description,
      agent: output.agent,
      durationMs,
      timestamp: Date.now(),
    });
    void this.logToFile(`task:${task.description}:${durationMs}`);
  }

  enableTracing(): void {
    this.tracing = true;
  }

  disableTracing(): void {
    this.tracing = false;
  }

  setManagerAgent(manager: RoleAgent): void {
    this.manager_agent = manager;
  }

  private getManagerAgent(): RoleAgent {
    if (this.manager_agent) {
      return this.manager_agent;
    }

    if (this.manager_llm) {
      // Look for an existing agent that might fit the role
      const managerCandidate = this.agents.find(
        (agent) => agent.role.toLowerCase().includes('manager') || agent.role.toLowerCase().includes('lead'),
      );
      if (managerCandidate) {
        return managerCandidate;
      }

      // If no manager agent exists but manager_llm is specified, create an internal one
      const sessionId = `manager-${Date.now()}`;
      const { RoleAgent } = require('../agents/role-agent');
      
      this.manager_agent = new RoleAgent(sessionId, {
        role: 'Crew Manager',
        goal: 'Coordinate the crew to complete all tasks efficiently',
        backstory: 'You are an experienced project manager specialized in AI coordination.',
        llm: this.manager_llm,
        allow_delegation: true,
      });

      this.log(`Created dynamic manager agent using LLM: ${this.manager_llm}`);
      return this.manager_agent!;
    }

    if (this.process === 'hierarchical') {
      throw new Error(
        'Hierarchical process requires a manager agent instance or manager_llm to be configured.',
      );
    }

    // Default to the first agent for sequential/consensual if no manager specified
    return this.agents[0];
  }
}
