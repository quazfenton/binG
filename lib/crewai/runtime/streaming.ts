/**
 * CrewAI Streaming Enhancements
 *
 * Advanced streaming with agent-level and tool-level streaming support.
 * Integrated with crew event system.
 *
 * @see https://docs.crewai.com/en/enterprise/features/webhook-streaming.md
 */

import { EventEmitter } from 'events';
import type { Crew } from '../crew/crew';
import type { CrewOutput } from '../crew/crew';

export interface StreamChunk {
  type: 'chunk' | 'reasoning' | 'tool_call' | 'tool_output' | 'agent_start' | 'agent_end' | 'task_start' | 'task_end' | 'error' | 'done';
  content: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface AgentStreamData {
  agentId: string;
  agentRole: string;
  input: string;
}

export interface ToolStreamData {
  toolName: string;
  toolInput: Record<string, unknown>;
  status: 'started' | 'completed' | 'error';
  output?: unknown;
  error?: string;
}

export interface CrewStreamingOutput<T = unknown> extends EventEmitter {
  getResult(): Promise<T>;
  getResultSync(): T | undefined;
  getChunks(): StreamChunk[];
  cancel(): void;
}

export class CrewStreamingOutputImpl<T> extends EventEmitter implements CrewStreamingOutput<T> {
  private chunks: StreamChunk[] = [];
  private resultPromise: Promise<T>;
  private resolveResult!: (value: T) => void;
  private rejectResult!: (error: Error) => void;
  private result: T | undefined;
  private cancelled = false;
  private crew?: Crew;

  constructor() {
    super();

    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = (value) => {
        if (!this.cancelled) {
          resolve(value);
        }
      };
      this.rejectResult = (error) => {
        if (!this.cancelled) {
          reject(error);
        }
      };
    });
  }

  /**
   * Attach to a Crew instance and subscribe to events
   */
  attachToCrew(crew: Crew): void {
    this.crew = crew;

    // Subscribe to crew events via the events EventEmitter
    crew.events.on('agent_started', (data: any) => {
      this.emitAgentStart(data.agentId, data.role);
    });

    crew.events.on('agent_ended', (data: any) => {
      this.emitAgentEnd(data.agentId, data.output);
    });

    crew.events.on('task_started', (data: any) => {
      this.emitTaskStart(data.taskId, data.description);
    });

    crew.events.on('task_ended', (data: any) => {
      this.emitTaskEnd(data.taskId, data.output);
    });

    crew.events.on('tool_started', (data: any) => {
      this.emitToolCall(data.toolName, data.toolInput);
    });

    crew.events.on('tool_ended', (data: any) => {
      this.emitToolOutput(data.toolName, data.toolOutput);
    });

    crew.events.on('error', (error: Error) => {
      this.setError(error);
    });
  }

  /**
   * Execute crew with streaming
   */
  async execute(input: string): Promise<CrewStreamingOutputImpl<T>> {
    if (!this.crew) {
      throw new Error('No crew attached to stream');
    }

    this.crew.kickoff({ inputs: { message: input } }).then(
      (result) => {
        this.setResult(result as unknown as T);
      },
      (error) => {
        this.setError(error);
      }
    );

    return this;
  }

  emitChunk(content: string, data?: Record<string, unknown>): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'chunk',
      content,
      data,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('chunk', chunk);
  }

  emitReasoning(reasoning: string): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'reasoning',
      content: reasoning,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('reasoning', chunk);
  }

  emitAgentStart(agentId: string, agentRole: string): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'agent_start',
      content: `Agent ${agentRole} started`,
      data: { agentId, agentRole } as Record<string, unknown>,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('agent_start', chunk);
  }

  emitAgentEnd(agentId: string, output: string): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'agent_end',
      content: output,
      data: { agentId, output } as Record<string, unknown>,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('agent_end', chunk);
  }

  emitTaskStart(taskId: string, description: string): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'task_start',
      content: `Task started: ${description}`,
      data: { taskId, description } as Record<string, unknown>,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('task_start', chunk);
  }

  emitTaskEnd(taskId: string, output: string): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'task_end',
      content: output,
      data: { taskId, output } as Record<string, unknown>,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('task_end', chunk);
  }

  emitToolCall(toolName: string, toolInput: Record<string, unknown>): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'tool_call',
      content: `Calling tool: ${toolName}`,
      data: { toolName, toolInput } as Record<string, unknown>,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('tool_call', chunk);
  }

  emitToolOutput(toolName: string, toolOutput: unknown): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'tool_output',
      content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
      data: { toolName, toolOutput } as Record<string, unknown>,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('tool_output', chunk);
  }

  setError(error: Error): void {
    if (this.cancelled) return;

    const chunk: StreamChunk = {
      type: 'error',
      content: error.message,
      data: { stack: error.stack } as Record<string, unknown>,
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('error', chunk);
    this.rejectResult(error);
  }

  setResult(result: T): void {
    if (this.cancelled) return;

    this.result = result;
    
    const chunk: StreamChunk = {
      type: 'done',
      content: 'Stream complete',
      timestamp: Date.now(),
    };

    this.chunks.push(chunk);
    this.emit('done', chunk);
    this.resolveResult(result);
  }

  async getResult(): Promise<T> {
    return this.resultPromise;
  }

  getResultSync(): T | undefined {
    return this.result;
  }

  getChunks(): StreamChunk[] {
    return [...this.chunks];
  }

  cancel(): void {
    this.cancelled = true;
    this.emit('cancelled');
  }

  /**
   * Convert to async iterable for for-await-of loops
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
    const eventEmitter = new EventEmitter();
    
    this.on('chunk', (chunk) => eventEmitter.emit('data', chunk));
    this.on('reasoning', (chunk) => eventEmitter.emit('data', chunk));
    this.on('tool_call', (chunk) => eventEmitter.emit('data', chunk));
    this.on('tool_output', (chunk) => eventEmitter.emit('data', chunk));
    this.on('agent_start', (chunk) => eventEmitter.emit('data', chunk));
    this.on('agent_end', (chunk) => eventEmitter.emit('data', chunk));
    this.on('error', () => eventEmitter.emit('end'));
    this.on('done', () => eventEmitter.emit('end'));

    const queue: StreamChunk[] = [];
    let ended = false;

    eventEmitter.on('data', (chunk: StreamChunk) => {
      queue.push(chunk);
    });

    eventEmitter.on('end', () => {
      ended = true;
    });

    while (!ended || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
        continue;
      }

      yield queue.shift()!;
    }
  }

  /**
   * Pipe to a writable stream
   */
  pipeTo(writer: WritableStreamDefaultWriter<string>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.on('chunk', async (chunk) => {
        await writer.write(chunk.content);
      });
      
      this.on('done', () => {
        writer.close();
        resolve();
      });
      
      this.on('error', (error) => {
        writer.abort(error);
        reject(error);
      });
    });
  }
}

/**
 * Create streaming output for a crew
 */
export function createCrewStream<T>(crew: Crew): CrewStreamingOutputImpl<T> {
  const stream = new CrewStreamingOutputImpl<T>();
  stream.attachToCrew(crew);
  return stream;
}

/**
 * Run crew with streaming
 */
export async function runCrewWithStreaming<T>(
  crew: Crew,
  input: string
): Promise<CrewStreamingOutputImpl<T>> {
  const stream = createCrewStream<T>(crew);
  await stream.execute(input);
  return stream;
}
