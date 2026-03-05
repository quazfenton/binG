/**
 * CrewAI Task System
 *
 * Task definitions with context handling, guardrails, and structured outputs.
 */

import { z } from 'zod';
import type { RoleAgent } from '../agents/role-agent';

export interface FileInput {
  [key: string]: {
    type: 'image' | 'pdf' | 'audio' | 'video' | 'text';
    source: string;
  };
}

export type TaskGuardrail =
  | ((raw: string) => { ok: boolean; transformed?: string; error?: string } | Promise<{ ok: boolean; transformed?: string; error?: string }>)
  | string;

export interface TaskConfig {
  description: string;
  expected_output?: string;
  agent: RoleAgent;
  context?: Task[];
  async_execution?: boolean;
  output_file?: string;
  output_json?: z.ZodSchema | Record<string, any> | boolean;
  output_pydantic?: z.ZodSchema | Record<string, any> | boolean;
  create_directory?: boolean;
  human_input?: boolean;
  max_iter?: number;
  tools?: string[];
  input_files?: FileInput;
  guardrail?: TaskGuardrail;
  guardrails?: TaskGuardrail[] | TaskGuardrail;
  guardrail_max_retries?: number;
  callback?: (output: TaskOutput) => void | Promise<void>;
}

export interface TaskExecutionOptions {
  inputs?: Record<string, string | number | boolean>;
  input_files?: FileInput;
  humanInputResolver?: (task: Task) => Promise<string> | string;
}

export interface TaskOutput {
  description: string;
  summary?: string;
  raw: string;
  pydantic?: any;
  json_dict?: Record<string, any>;
  agent: string;
  output_format: 'RAW' | 'JSON' | 'PYDANTIC';
  files?: FileInput;
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

function toGuardrails(config: TaskConfig): TaskGuardrail[] {
  if (Array.isArray(config.guardrails)) return config.guardrails;
  if (config.guardrails) return [config.guardrails];
  if (config.guardrail) return [config.guardrail];
  return [];
}

export class Task {
  public readonly description: string;
  public readonly expected_output?: string;
  public readonly agent: RoleAgent;
  public readonly context?: Task[];
  public readonly async_execution?: boolean;
  public readonly output_file?: string;
  public readonly output_json?: z.ZodSchema | Record<string, any> | boolean;
  public readonly output_pydantic?: z.ZodSchema | Record<string, any> | boolean;
  public readonly create_directory: boolean;
  public readonly human_input?: boolean;
  public readonly max_iter?: number;
  public readonly tools?: string[];
  public input_files?: FileInput;
  public callback?: (output: TaskOutput) => void | Promise<void>;
  public readonly guardrails: TaskGuardrail[];
  public readonly guardrail_max_retries: number;

  private output?: TaskOutput;

  constructor(config: TaskConfig) {
    this.description = config.description;
    this.expected_output = config.expected_output;
    this.agent = config.agent;
    this.context = config.context;
    this.async_execution = config.async_execution;
    this.output_file = config.output_file;
    this.output_json = config.output_json;
    this.output_pydantic = config.output_pydantic;
    this.create_directory = config.create_directory !== false;
    this.human_input = config.human_input;
    this.max_iter = config.max_iter;
    this.tools = config.tools;
    this.input_files = config.input_files;
    this.callback = config.callback;
    this.guardrails = toGuardrails(config);
    this.guardrail_max_retries = config.guardrail_max_retries ?? 3;
  }

  async execute(options: TaskExecutionOptions = {}): Promise<TaskOutput> {
    const context = this.buildContext();
    const selectedFiles = this.input_files || options.input_files;
    const prompt = await this.buildPrompt({
      context,
      inputs: options.inputs,
      files: selectedFiles,
      humanInputResolver: options.humanInputResolver,
    });

    let raw = (await this.agent.kickoff(prompt)).raw;
    raw = await this.applyGuardrails(raw);

    const output = this.buildOutput(raw, selectedFiles);
    this.output = output;

    if (this.output_file) {
      await this.saveToFile(this.output_file, output.raw);
    }
    if (this.callback) {
      await this.callback(output);
    }

    return output;
  }

  getOutput(): TaskOutput | undefined {
    return this.output;
  }

  setInputFiles(files: FileInput): void {
    this.input_files = files;
  }

  setCallback(callback: (output: TaskOutput) => void | Promise<void>): void {
    this.callback = callback;
  }

  private buildContext(): string {
    if (!this.context?.length) return '';
    return this.context
      .map((task) => task.getOutput()?.raw)
      .filter((value): value is string => !!value)
      .join('\n\n---\n\n');
  }

  private async buildPrompt(params: {
    context: string;
    inputs?: Record<string, string | number | boolean>;
    files?: FileInput;
    humanInputResolver?: TaskExecutionOptions['humanInputResolver'];
  }): Promise<string> {
    const renderedDescription = params.inputs
      ? interpolateTemplate(this.description, params.inputs)
      : this.description;
    const chunks: string[] = [renderedDescription];

    if (params.context) {
      chunks.push(`## Context from Previous Tasks\n${params.context}`);
    }
    if (params.inputs && Object.keys(params.inputs).length > 0) {
      chunks.push(`## Inputs\n${JSON.stringify(params.inputs, null, 2)}`);
    }
    if (this.expected_output) {
      const renderedExpected = params.inputs
        ? interpolateTemplate(this.expected_output, params.inputs)
        : this.expected_output;
      chunks.push(`## Expected Output\n${renderedExpected}`);
    }
    if (params.files && Object.keys(params.files).length > 0) {
      chunks.push(`## Input Files\n${JSON.stringify(params.files, null, 2)}`);
    }
    if (this.human_input && params.humanInputResolver) {
      const humanNote = await params.humanInputResolver(this);
      if (humanNote && String(humanNote).trim()) {
        chunks.push(`## Human Input\n${String(humanNote).trim()}`);
      }
    }

    return chunks.join('\n\n');
  }

  private async applyGuardrails(initialRaw: string): Promise<string> {
    if (this.guardrails.length === 0) return initialRaw;

    let raw = initialRaw;
    let retries = 0;
    while (retries <= this.guardrail_max_retries) {
      let failed = false;

      for (const guardrail of this.guardrails) {
        if (typeof guardrail === 'string') {
          // LLM-guardrail style descriptor placeholder: keep deterministic now.
          // Can later route through dedicated validator agent.
          if (!raw.toLowerCase().includes(guardrail.toLowerCase())) {
            failed = true;
            break;
          }
          continue;
        }

        const result = await guardrail(raw);
        if (!result.ok) {
          failed = true;
          break;
        }
        if (typeof result.transformed === 'string') {
          raw = result.transformed;
        }
      }

      if (!failed) return raw;
      retries += 1;
      if (retries > this.guardrail_max_retries) {
        throw new Error('Task guardrail validation failed after max retries');
      }
      raw = (
        await this.agent.kickoff(
          `${this.description}\n\nGuardrail validation failed. Retry with corrected output.`,
        )
      ).raw;
    }

    return raw;
  }

  private buildOutput(raw: string, files?: FileInput): TaskOutput {
    const summary = raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;

    const jsonCandidate = this.tryParseJSON(raw);
    let json_dict: Record<string, any> | undefined;
    let pydantic: any;
    let output_format: TaskOutput['output_format'] = 'RAW';

    if (this.output_json && jsonCandidate && typeof jsonCandidate === 'object') {
      if (this.output_json instanceof z.ZodType) {
        const parsed = this.output_json.safeParse(jsonCandidate);
        if (parsed.success) {
          json_dict = parsed.data as Record<string, any>;
          output_format = 'JSON';
        }
      } else {
        json_dict = jsonCandidate as Record<string, any>;
        output_format = 'JSON';
      }
    }

    if (this.output_pydantic && jsonCandidate && typeof jsonCandidate === 'object') {
      if (this.output_pydantic instanceof z.ZodType) {
        const parsed = this.output_pydantic.safeParse(jsonCandidate);
        if (parsed.success) {
          pydantic = parsed.data;
          output_format = 'PYDANTIC';
        }
      } else {
        pydantic = jsonCandidate;
        output_format = 'PYDANTIC';
      }
    }

    return {
      description: this.description,
      summary,
      raw,
      pydantic,
      json_dict,
      agent: this.agent.role,
      output_format,
      files,
    };
  }

  private tryParseJSON(raw: string): unknown | undefined {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      const jsonMatch = trimmed.match(/^\{[^{}]*\}/) || trimmed.match(/^\[[\s\S]*\]/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch { return undefined; }
      }
    }
    try {
      return JSON.parse(trimmed);
    } catch {}
    
    const markdownMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (markdownMatch) {
      try { return JSON.parse(markdownMatch[1].trim()); } catch {}
    }
    
    const jsMatch = trimmed.match(/`(?:json)?\s*(\{[\s\S]*?\})\s*`/);
    if (jsMatch) {
      try { return JSON.parse(jsMatch[1]); } catch {}
    }
    
    const jsonBlockMatch = trimmed.match(/\{\s*"[\w]+":\s*[\s\S]*?"[\w]+"\s*\}/);
    if (jsonBlockMatch) {
      try { return JSON.parse(jsonBlockMatch[0]); } catch {}
    }
    
    return undefined;
  }

  private async saveToFile(filePath: string, content: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    if (this.create_directory) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    }
    await fs.writeFile(filePath, content, 'utf-8');
  }
}
