/**
 * CrewAI Role-Based Agent
 *
 * StatefulAgent wrapper with CrewAI-inspired configuration.
 * Supports YAML config loading and input interpolation.
 */

import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { EventEmitter } from 'events';
import { StatefulAgent, type StatefulAgentOptions } from '@/lib/stateful-agent/agents/stateful-agent';

export interface RoleAgentConfig {
  role: string;
  goal: string;
  backstory: string;
  llm?: string;
  tools?: string[];
  function_calling_llm?: string;
  max_iter?: number;
  max_rpm?: number;
  max_execution_time?: number;
  max_retry_limit?: number;
  verbose?: boolean;
  allow_delegation?: boolean;
  cache?: boolean;
  allow_code_execution?: boolean;
  code_execution_mode?: 'safe' | 'unsafe';
  respect_context_window?: boolean;
  reasoning?: boolean;
  max_reasoning_attempts?: number;
  inject_date?: boolean;
  date_format?: string;
  multimodal?: boolean;
  memory?: boolean;
  system_template?: string;
  prompt_template?: string;
  response_template?: string;
  use_system_prompt?: boolean;
  embedder?: {
    provider?: string;
    model?: string;
    api_key?: string;
  };
  step_callback?: (payload: RoleAgentStepEvent) => void | Promise<void>;
}

export interface RoleAgentStepEvent {
  type: 'start' | 'complete' | 'error';
  role: string;
  input: string;
  executionTimeMs: number;
  success?: boolean;
  error?: string;
}

export interface RoleAgentOutput {
  raw: string;
  role: string;
  usage_metrics: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  };
  execution_time: number;
  success: boolean;
  error?: string;
}

function assertValidRoleConfig(config: any, source: string): asserts config is RoleAgentConfig {
  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid agent config in ${source}: expected object`);
  }
  if (!config.role || !config.goal || !config.backstory) {
    throw new Error(
      `Invalid agent config in ${source}: missing required fields (role, goal, backstory)`,
    );
  }
}

function interpolateTemplate(
  text: string,
  inputs: Record<string, string | number | boolean> = {},
): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = inputs[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

function formatDate(format: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const replacements: Record<string, string> = {
    '%Y': String(date.getFullYear()),
    '%y': String(date.getFullYear()).slice(-2),
    '%m': pad(date.getMonth() + 1),
    '%d': pad(date.getDate()),
    '%B': months[date.getMonth()],
    '%b': shortMonths[date.getMonth()],
    '%H': pad(date.getHours()),
    '%M': pad(date.getMinutes()),
    '%S': pad(date.getSeconds()),
    '%A': date.toLocaleDateString('en-US', { weekday: 'long' }),
    '%a': date.toLocaleDateString('en-US', { weekday: 'short' }),
  };
  
  let result = format;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(key, 'g'), value);
  }
  return result;
}

function injectCurrentDate(
  text: string,
  config: RoleAgentConfig,
  now = new Date(),
): string {
  if (!config.inject_date) return text;
  const format = config.date_format || '%Y-%m-%d';
  const dateString = formatDate(format, now);
  return `${text}\n\nCurrent date: ${dateString}`;
}

export class RoleAgent extends StatefulAgent {
  public readonly role: string;
  public readonly goal: string;
  public readonly backstory: string;
  public readonly events: EventEmitter;
  private mutableConfig: RoleAgentConfig;
  private systemPrompt: string;

  constructor(
    sessionId: string,
    config: RoleAgentConfig,
    options: Omit<StatefulAgentOptions, 'sessionId'> = {},
  ) {
    assertValidRoleConfig(config, 'RoleAgent.constructor');
    super({
      sessionId,
      ...options,
      maxSelfHealAttempts: config.max_reasoning_attempts || config.max_retry_limit || 3,
      enforcePlanActVerify: config.reasoning || false,
    });

    this.role = config.role;
    this.goal = config.goal;
    this.backstory = config.backstory;
    this.mutableConfig = { ...config };
    this.events = new EventEmitter();
    this.systemPrompt = this.buildSystemPrompt();

    if (this.mutableConfig.use_system_prompt !== false) {
      // System prompt is stored and will be used during agent execution
      // The parent StatefulAgent uses its own prompt structure
    }
  }

  /**
   * Set system prompt for the agent
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Get current system prompt
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  get config(): RoleAgentConfig {
    return { ...this.mutableConfig };
  }

  private buildSystemPrompt(): string {
    const base = `You are a ${this.role}.

## Your Goal
${this.goal}

## Your Background
${this.backstory}

## Constraints
- ${this.mutableConfig.allow_code_execution ? 'Code execution is allowed in sandbox context.' : 'Do not execute code directly.'}
- ${this.mutableConfig.allow_delegation ? 'Delegation is allowed when another specialist is better suited.' : 'Do not delegate unless explicitly instructed.'}
- ${this.mutableConfig.respect_context_window === false ? 'Do not summarize context automatically; fail if context exceeds limits.' : 'Respect context limits and summarize where needed.'}
- ${this.mutableConfig.reasoning ? 'Think and plan before acting.' : 'Act directly when appropriate.'}`;

    const withDate = injectCurrentDate(base, this.mutableConfig);
    if (this.mutableConfig.system_template) {
      return interpolateTemplate(this.mutableConfig.system_template, {
        role: this.role,
        goal: this.goal,
        backstory: this.backstory,
      }) + `\n\n${withDate}`;
    }
    return withDate;
  }

  static async loadFromYAML(
    yamlPath: string,
    agentName: string,
    sessionId: string,
    inputs: Record<string, string | number | boolean> = {},
    options: Omit<StatefulAgentOptions, 'sessionId'> = {},
  ): Promise<RoleAgent> {
    const yamlContent = await fs.readFile(yamlPath, 'utf-8');
    const parsed = yaml.load(yamlContent) as Record<string, RoleAgentConfig>;
    const config = parsed?.[agentName];
    if (!config) {
      throw new Error(`Agent "${agentName}" not found in ${yamlPath}`);
    }
    assertValidRoleConfig(config, `${yamlPath}:${agentName}`);
    const interpolated: RoleAgentConfig = {
      ...config,
      role: interpolateTemplate(config.role, inputs),
      goal: interpolateTemplate(config.goal, inputs),
      backstory: interpolateTemplate(config.backstory, inputs),
    };
    return new RoleAgent(sessionId, interpolated, options);
  }

  static async loadAllFromYAML(
    yamlPath: string,
    sessionId: string,
    inputs: Record<string, string | number | boolean> = {},
    options: Omit<StatefulAgentOptions, 'sessionId'> = {},
  ): Promise<Map<string, RoleAgent>> {
    const yamlContent = await fs.readFile(yamlPath, 'utf-8');
    const parsed = yaml.load(yamlContent) as Record<string, RoleAgentConfig>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid YAML structure in ${yamlPath}`);
    }

    const agents = new Map<string, RoleAgent>();
    for (const [name, config] of Object.entries(parsed)) {
      assertValidRoleConfig(config, `${yamlPath}:${name}`);
      const interpolated: RoleAgentConfig = {
        ...config,
        role: interpolateTemplate(config.role, inputs),
        goal: interpolateTemplate(config.goal, inputs),
        backstory: interpolateTemplate(config.backstory, inputs),
      };
      agents.set(name, new RoleAgent(`${sessionId}-${name}`, interpolated, options));
    }
    return agents;
  }

  async kickoff(input: string): Promise<RoleAgentOutput> {
    const startTime = Date.now();
    const finalInput = injectCurrentDate(input, this.mutableConfig);

    this.events.emit('kickoff:start', { input: finalInput, role: this.role });
    if (this.mutableConfig.step_callback) {
      await this.mutableConfig.step_callback({
        type: 'start',
        role: this.role,
        input: finalInput,
        executionTimeMs: 0,
      });
    }

    try {
      const result = await this.run(finalInput);
      const output: RoleAgentOutput = {
        raw: result.response,
        role: this.role,
        usage_metrics: {
          total_tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
        },
        execution_time: Date.now() - startTime,
        success: result.success,
        error: result.success ? undefined : result.response,
      };

      this.events.emit('kickoff:complete', output);
      if (this.mutableConfig.step_callback) {
        await this.mutableConfig.step_callback({
          type: 'complete',
          role: this.role,
          input: finalInput,
          executionTimeMs: output.execution_time,
          success: output.success,
        });
      }
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const output: RoleAgentOutput = {
        raw: message,
        role: this.role,
        usage_metrics: {
          total_tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
        },
        execution_time: Date.now() - startTime,
        success: false,
        error: message,
      };

      this.events.emit('kickoff:error', output);
      if (this.mutableConfig.step_callback) {
        await this.mutableConfig.step_callback({
          type: 'error',
          role: this.role,
          input: finalInput,
          executionTimeMs: output.execution_time,
          success: false,
          error: message,
        });
      }
      return output;
    }
  }

  async kickoffAsync(input: string): Promise<RoleAgentOutput> {
    return this.kickoff(input);
  }

  enableMemory(): void {
    this.mutableConfig.memory = true;
  }

  disableMemory(): void {
    this.mutableConfig.memory = false;
  }

  setEmbedder(provider: string, model?: string, apiKey?: string): void {
    this.mutableConfig.embedder = {
      provider,
      model,
      api_key: apiKey,
    };
  }
}
