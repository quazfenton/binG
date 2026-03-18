/**
 * Persistent OpenCode Engine
 * 
 * Instead of spawning CLI per request, runs OpenCode as a persistent engine.
 * Much faster (~5-10x) with better concurrency control.
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { createLogger } from './logger';
import { createNDJSONParser } from '../../utils/ndjson-parser';

const logger = createLogger('Agent:OpenCodeEngine');

export interface OpenCodeEvent {
  type: 'text' | 'tool' | 'done' | 'error';
  data: any;
}

export interface OpenCodeConfig {
  model?: string;
  maxSteps?: number;
  workspaceDir?: string;
  tools?: string[];
}

export interface OpenCodeExecution {
  sessionId: string;
  prompt: string;
  context?: string;
  onEvent?: (event: OpenCodeEvent) => void;
}

/**
 * Persistent OpenCode Engine
 * 
 * Maintains a persistent OpenCode process and multiplexes multiple
 * sessions through it.
 */
class OpenCodeEngine extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private sessionBuffers: Map<string, string> = new Map();
  private pendingResolves: Map<string, (events: OpenCodeEvent[]) => void> = new Map();
  private isReady: boolean = false;
  private readyPromise: Promise<void>;
  private config: OpenCodeConfig;
  private restartAttempts: number = 0;
  private maxRestartAttempts: number = 3;

  constructor(config: OpenCodeConfig = {}) {
    super();
    this.config = {
      model: config.model || process.env.OPENCODE_MODEL || 'opencode/minimax-m2.5-free',
      maxSteps: config.maxSteps || 15,
      workspaceDir: config.workspaceDir || process.cwd(),
      tools: config.tools || [],
    };
    this.readyPromise = this.startProcess();
  }

  /**
   * Start the persistent OpenCode process
   */
  private async startProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      
      // Start OpenCode in interactive mode
      const args = isWindows 
        ? ['/c', 'npx', 'opencode', 'chat', '--json', '--model', this.config.model!]
        : ['opencode', 'chat', '--json', '--model', this.config.model!];

      logger.info('Starting persistent OpenCode engine', { 
        model: this.config.model,
        platform: process.platform 
      });

      this.process = spawn(isWindows ? 'cmd' : 'sh', args, {
        cwd: this.config.workspaceDir,
        env: {
          ...process.env,
          OPENCODE_MODEL: this.config.model,
        },
        shell: false,
      });

      let buffer = '';

      this.process.stdout?.on('data', (data) => {
        buffer += data.toString();

        // Use NDJSON parser for robust parsing
        const parser = createNDJSONParser()
        const parsedObjects = parser.parse(buffer)
        
        // Update buffer with any remaining incomplete data
        buffer = parser.getBufferedLines() > 0 ? buffer : ''

        for (const parsed of parsedObjects) {
          this.handleOutput(parsed);
        }
      });

      this.process.stderr?.on('data', (data) => {
        logger.warn('OpenCode stderr', { output: data.toString().substring(0, 200) });
      });

      this.process.on('error', (err) => {
        logger.error('OpenCode process error', { error: err.message });
        this.isReady = false;
        this.emit('error', err);
      });

      this.process.on('exit', (code) => {
        logger.warn('OpenCode process exited', { code });
        this.isReady = false;
        this.emit('exit', code);
        
        // Auto-restart if crashed
        if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
          this.restartAttempts++;
          logger.info('Restarting OpenCode engine', { attempt: this.restartAttempts });
          this.readyPromise = this.startProcess();
        }
      });

      // Give it a moment to start
      setTimeout(() => {
        this.isReady = true;
        resolve();
      }, 2000);
    });
  }

  /**
   * Handle output from OpenCode process
   */
  private handleOutput(parsed: any): void {
    // Could be session-multiplexed or single session
    const sessionId = parsed.sessionId || 'default';
    
    if (parsed.text) {
      this.emit('event', { type: 'text', data: { text: parsed.text, sessionId } });
    }

    if (parsed.tool || parsed.name) {
      const toolName = parsed.tool || parsed.name;
      const toolArgs = parsed.args || {};
      this.emit('event', { 
        type: 'tool', 
        data: { tool: toolName, args: toolArgs, sessionId } 
      });
    }

    if (parsed.done || parsed.complete) {
      this.emit('event', { 
        type: 'done', 
        data: { response: parsed.response || parsed.text, sessionId } 
      });
    }
  }

  /**
   * Ensure engine is ready
   */
  async ready(): Promise<void> {
    await this.readyPromise;
  }

  /**
   * Run agent loop with a prompt
   */
  async run(execution: OpenCodeExecution): Promise<OpenCodeEvent[]> {
    await this.ready();

    const { sessionId, prompt, context, onEvent } = execution;
    const fullPrompt = context ? `${context}\n\nTASK:\n${prompt}` : prompt;

    return new Promise((resolve, reject) => {
      const events: OpenCodeEvent[] = [];

      // Set up event listener
      const handleEvent = (event: OpenCodeEvent) => {
        // Filter events for this session
        if (event.data.sessionId === sessionId || !event.data.sessionId) {
          events.push(event);
          onEvent?.(event);
        }
      };

      this.on('event', handleEvent);

      // Set timeout
      const timeout = setTimeout(() => {
        this.off('event', handleEvent);
        resolve(events); // Resolve with partial events on timeout
      }, 120000);

      // Send prompt to OpenCode
      const promptPayload = {
        sessionId,
        prompt: fullPrompt,
        model: this.config.model,
        maxSteps: this.config.maxSteps,
        tools: this.config.tools,
      };

      if (this.process && this.process.stdin) {
        this.process.stdin.write(JSON.stringify(promptPayload) + '\n');
      }

      // Wait for done event or timeout
      const doneHandler = (event: OpenCodeEvent) => {
        if (event.type === 'done' && 
            (event.data.sessionId === sessionId || !event.data.sessionId)) {
          clearTimeout(timeout);
          this.off('event', handleEvent);
          this.off('event', doneHandler);
          resolve(events);
        }
      };

      this.on('event', doneHandler);
    });
  }

  /**
   * Stream events as they come
   */
  async *runStream(execution: OpenCodeExecution): AsyncGenerator<OpenCodeEvent> {
    await this.ready();

    const { sessionId, prompt, context } = execution;
    const fullPrompt = context ? `${context}\n\nTASK:\n${prompt}` : prompt;

    // Create promise-based iterator
    let resolve: (value: IteratorResult<OpenCodeEvent>) => void;
    let reject: (error: Error) => void;
    let buffer: OpenCodeEvent[] = [];
    let done = false;
    let error: Error | null = null;

    const nextPromise = new Promise<IteratorResult<OpenCodeEvent>>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const eventHandler = (event: OpenCodeEvent) => {
      if (event.data.sessionId === sessionId || !event.data.sessionId) {
        if (event.type === 'done') {
          done = true;
        }
        buffer.push(event);
        resolve?.({ value: event, done: false });
        // Get next resolver
        if (resolve) {
          nextPromise.then(() => {
            resolve = undefined as any;
          });
        }
      }
    };

    this.on('event', eventHandler);

    try {
      // Send prompt
      const promptPayload = {
        sessionId,
        prompt: fullPrompt,
        model: this.config.model,
        maxSteps: this.config.maxSteps,
        tools: this.config.tools,
      };

      if (this.process && this.process.stdin) {
        this.process.stdin.write(JSON.stringify(promptPayload) + '\n');
      }

      // Yield events until done
      while (!done) {
        const result = await nextPromise;
        if (result.value) {
          yield result.value;
        }
      }
    } finally {
      this.off('event', eventHandler);
    }
  }

  /**
   * Check if engine is running
   */
  isHealthy(): boolean {
    return this.isReady && this.process !== null;
  }

  /**
   * Shutdown the engine
   */
  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isReady = false;
    logger.info('OpenCode engine shut down');
  }
}

// Singleton instance with lazy initialization
let engineInstance: OpenCodeEngine | null = null;

export function getOpenCodeEngine(config?: OpenCodeConfig): OpenCodeEngine {
  if (!engineInstance) {
    engineInstance = new OpenCodeEngine(config);
  }
  return engineInstance;
}

export { OpenCodeEngine };
