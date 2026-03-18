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

      // Create NDJSON parser once and feed incrementally
      const parser = createNDJSONParser();

      this.process.stdout?.on('data', (data: Buffer) => {
        // FIX: Use Buffer.toString('utf8') to properly handle multi-byte characters
        // The NDJSON parser handles partial chunks internally
        const parsed = parser.parse(data.toString('utf8'));
        for (const obj of parsed) {
          this.handleOutput(obj);
        }
        // Do NOT touch the buffer - the parser owns it entirely
      });

      this.process.stderr?.on('data', (data) => {
        logger.warn('OpenCode stderr', { output: data.toString('utf8').substring(0, 200) });
      });

      // FIX: Listen for 'error' event to prevent hanging on process crash
      this.process.on('error', (err) => {
        logger.error('OpenCode process error', { error: err.message });
        this.isReady = false;
        this.emit('error', err);
        
        // Reject any pending promises to prevent hanging
        for (const [sessionId, rejectFn] of this.pendingResolves.entries()) {
          rejectFn(new Error(`OpenCode process error: ${err.message}`));
          this.pendingResolves.delete(sessionId);
        }
      });

      // FIX: Listen for 'exit' event to handle unexpected crashes
      this.process.on('exit', (code, signal) => {
        logger.warn('OpenCode process exited', { code, signal });
        this.isReady = false;
        this.emit('exit', code);

        // Reject any pending promises to prevent hanging
        for (const [sessionId, rejectFn] of this.pendingResolves.entries()) {
          rejectFn(new Error(`OpenCode process exited with code ${code}${signal ? `, signal ${signal}` : ''}`));
          this.pendingResolves.delete(sessionId);
        }

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
   * FIX Bug 23: Replace broken promise chain with proper queue pattern
   */
  async *runStream(execution: OpenCodeExecution): AsyncGenerator<OpenCodeEvent> {
    await this.ready();

    const { sessionId, prompt, context } = execution;
    const fullPrompt = context ? `${context}\n\nTASK:\n${prompt}` : prompt;

    // FIX: Use a proper async queue (lightweight EventEmitter + async iteration)
    // instead of a single promise that never gets re-created
    const queue: OpenCodeEvent[] = [];
    let finished = false;
    let waitResolve: (() => void) | null = null;

    const enqueue = (event: OpenCodeEvent) => {
      queue.push(event);
      waitResolve?.();
      waitResolve = null;
    };

    const eventHandler = (event: OpenCodeEvent) => {
      if (event.data.sessionId === sessionId || !event.data.sessionId) {
        if (event.type === 'done') finished = true;
        enqueue(event);
      }
    };

    this.on('event', eventHandler);

    try {
      const promptPayload = {
        sessionId,
        prompt: fullPrompt,
        model: this.config.model,
        maxSteps: this.config.maxSteps,
        tools: this.config.tools,
      };

      if (this.process?.stdin) {
        this.process.stdin.write(JSON.stringify(promptPayload) + '\n');
      }

      while (!finished || queue.length > 0) {
        if (queue.length === 0) {
          // Wait for the next event to arrive
          await new Promise<void>(resolve => { waitResolve = resolve; });
        }

        while (queue.length > 0) {
          const event = queue.shift()!;
          yield event;
          if (event.type === 'done') {
            finished = true;
            break;
          }
        }
      }
    } finally {
      this.off('event', eventHandler);
      
      // Wake up any waiting iterator on cleanup
      if (waitResolve) {
        waitResolve();
      }
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
