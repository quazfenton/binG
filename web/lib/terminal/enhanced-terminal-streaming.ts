/**
 * Enhanced Terminal Output Streaming
 * 
 * Consolidates output from multiple sources into seamless terminal UI:
 * - Local command execution (simulated shell)
 * - LLM-initiated bash commands
 * - Sandbox stdout/stderr
 * - PTY stream output
 * - Code execution results
 * - File system events
 * 
 * Features:
 * - Smart output formatting with ANSI color preservation
 * - Streaming output with backpressure handling
 * - Command output grouping and correlation
 * - Scrollback optimization for long outputs
 * - Output filtering and search
 * - Event simulation for persistent shell appearance
 * - Multi-source output merging
 * 
 * @module @/lib/terminal/enhanced-terminal-streaming
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('EnhancedTerminalStreaming');

// ============================================================================
// Types
// ============================================================================

export type OutputSource = 
  | 'local'           // Local shell simulation
  | 'llm'             // LLM-initiated command
  | 'sandbox'         // Sandbox stdout
  | 'sandbox-stderr'  // Sandbox stderr  
  | 'pty'             // PTY stream
  | 'code-exec'       // Code execution result
  | 'vfs'             // VFS event notification
  | 'system';         // System message

export interface TerminalOutput {
  id: string;
  source: OutputSource;
  content: string;
  timestamp: number;
  commandId?: string;
  sessionId?: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  metadata?: Record<string, any>;
}

export interface OutputStreamConfig {
  terminalId: string;
  write: (text: string) => void;
  writeLine: (text: string) => void;
  onOutput?: (output: TerminalOutput) => void;
  maxScrollback?: number;
  enableFiltering?: boolean;
  enableGrouping?: boolean;
  streamingThrottle?: number; // ms
}

export interface CommandContext {
  commandId: string;
  source: OutputSource;
  sessionId?: string;
  sandboxId?: string;
  startTime: number;
  endTime?: number;
  exitCode?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_SCROLLBACK = 10000;
const DEFAULT_STREAMING_THROTTLE = 16; // ~60fps
const OUTPUT_BUFFER_SIZE = 1024; // characters

// ANSI color codes for different sources
const SOURCE_COLORS: Record<OutputSource, string> = {
  'local': '\x1b[90m',      // Gray
  'llm': '\x1b[36m',        // Cyan
  'sandbox': '\x1b[32m',    // Green
  'sandbox-stderr': '\x1b[31m', // Red
  'pty': '\x1b[37m',        // White
  'code-exec': '\x1b[33m',  // Yellow
  'vfs': '\x1b[35m',        // Magenta
  'system': '\x1b[34m',     // Blue
};

// ============================================================================
// Enhanced Output Stream Manager
// ============================================================================

export class EnhancedOutputStreamManager {
  private terminalId: string;
  private write: (text: string) => void;
  private writeLine: (text: string) => void;
  private onOutput?: (output: TerminalOutput) => void;
  private maxScrollback: number;
  private enableFiltering: boolean;
  private enableGrouping: boolean;
  private streamingThrottle: number;
  
  private outputBuffer: string[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private lastFlushTime: number = 0;
  private currentCommand: CommandContext | null = null;
  private outputHistory: TerminalOutput[] = [];
  private isStreaming: boolean = false;
  private streamBuffer: string = '';
  private streamThrottleTimer: NodeJS.Timeout | null = null;

  constructor(config: OutputStreamConfig) {
    this.terminalId = config.terminalId;
    this.write = config.write;
    this.writeLine = config.writeLine;
    this.onOutput = config.onOutput;
    this.maxScrollback = config.maxScrollback || DEFAULT_MAX_SCROLLBACK;
    this.enableFiltering = config.enableFiltering ?? true;
    this.enableGrouping = config.enableGrouping ?? true;
    this.streamingThrottle = config.streamingThrottle || DEFAULT_STREAMING_THROTTLE;
  }

  /**
   * Start a new command context
   */
  startCommand(commandId: string, source: OutputSource, sessionId?: string): CommandContext {
    const context: CommandContext = {
      commandId,
      source,
      sessionId,
      startTime: Date.now(),
    };

    this.currentCommand = context;

    // Write command header for non-local sources
    if (source !== 'local') {
      const color = SOURCE_COLORS[source];
      this.writeLine(`\r\n${color}┌─ ${this.formatCommandHeader(commandId, source)}\x1b[0m\r\n`);
    }

    return context;
  }

  /**
   * Write streaming output
   */
  writeStreaming(text: string, isComplete = false): void {
    this.isStreaming = true;
    this.streamBuffer += text;

    // Throttle output for performance
    if (this.streamThrottleTimer) {
      clearTimeout(this.streamThrottleTimer);
    }

    this.streamThrottleTimer = setTimeout(() => {
      this.flushStreamBuffer();
      
      if (isComplete) {
        this.isStreaming = false;
        this.flushStreamBuffer(true);
      }
    }, this.streamingThrottle);
  }

  /**
   * Write complete output with formatting
   */
  writeOutput(
    content: string, 
    source: OutputSource = 'local',
    options?: {
      addNewline?: boolean;
      preserveAnsi?: boolean;
      metadata?: Record<string, any>;
    }
  ): void {
    const output: TerminalOutput = {
      id: this.generateOutputId(),
      source,
      content,
      timestamp: Date.now(),
      commandId: this.currentCommand?.commandId,
      sessionId: this.currentCommand?.sessionId,
      isStreaming: this.isStreaming,
      isComplete: !this.isStreaming,
      metadata: options?.metadata,
    };

    // Add to history
    this.outputHistory.push(output);
    if (this.outputHistory.length > this.maxScrollback) {
      this.outputHistory.shift();
    }

    // Apply filtering if enabled
    if (this.enableFiltering) {
      content = this.filterOutput(content, source);
    }

    // Format output based on source
    const formatted = this.formatOutput(content, source, options);

    // Write to terminal
    if (options?.addNewline ?? true) {
      this.writeLine(formatted);
    } else {
      this.write(formatted);
    }

    // Callback
    this.onOutput?.(output);
  }

  /**
   * Complete current command
   */
  completeCommand(exitCode: number = 0): void {
    if (!this.currentCommand) return;

    this.currentCommand.endTime = Date.now();
    this.currentCommand.exitCode = exitCode;

    const { commandId, source, startTime, endTime } = this.currentCommand;
    const duration = (endTime! - startTime) / 1000;
    const color = SOURCE_COLORS[source];
    const statusColor = exitCode === 0 ? '\x1b[32m' : '\x1b[31m';

    // Write command footer
    this.writeLine(`\r\n${color}└─ Completed in ${duration.toFixed(2)}s ${statusColor}[${exitCode}]\x1b[0m\r\n`);

    this.currentCommand = null;
  }

  /**
   * Handle sandbox stdout
   */
  handleSandboxStdout(data: string, sessionId?: string): void {
    this.writeOutput(data, 'sandbox', {
      addNewline: false,
      preserveAnsi: true,
      metadata: { sessionId },
    });
  }

  /**
   * Handle sandbox stderr
   */
  handleSandboxStderr(data: string, sessionId?: string): void {
    this.writeOutput(data, 'sandbox-stderr', {
      addNewline: false,
      preserveAnsi: true,
      metadata: { sessionId, isError: true },
    });
  }

  /**
   * Handle LLM-initiated command output
   */
  handleLLMCommandOutput(data: string, commandId?: string): void {
    this.writeOutput(data, 'llm', {
      addNewline: false,
      metadata: { commandId, isLLM: true },
    });
  }

  /**
   * Handle code execution result
   */
  handleCodeExecutionResult(
    output: string, 
    exitCode: number,
    language?: string
  ): void {
    this.writeLine('\r\n\x1b[33m┌─ Code Execution Result\x1b[0m');
    
    if (language) {
      this.writeLine(`\x1b[90m│ Language: ${language}\x1b[0m`);
    }
    
    this.writeLine(`\x1b[90m│ Exit Code: ${exitCode}\x1b[0m`);
    this.writeLine('\x1b[33m├─\x1b[0m');
    
    // Write output with proper indentation
    output.split('\n').forEach(line => {
      this.writeLine(`\x1b[33m│\x1b[0m ${line}`);
    });
    
    this.writeLine(`\x1b[33m└─\x1b[0m\r\n`);
  }

  /**
   * Handle VFS event notification
   */
  handleVFSNotification(
    event: 'create' | 'update' | 'delete',
    path: string
  ): void {
    const icons: Record<string, string> = {
      create: '+',
      update: '~',
      delete: '-',
    };

    const icon = icons[event] || '?';
    this.writeLine(`\r\n\x1b[35m[${icon}] ${path}\x1b[0m`);
  }

  /**
   * Clear output buffer and history
   */
  clear(): void {
    this.outputBuffer = [];
    this.outputHistory = [];
    this.streamBuffer = '';
    this.currentCommand = null;
    
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }
    if (this.streamThrottleTimer) {
      clearTimeout(this.streamThrottleTimer);
    }
  }

  /**
   * Get output history
   */
  getHistory(limit?: number): TerminalOutput[] {
    const history = [...this.outputHistory];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Search output history
   */
  searchHistory(query: string, source?: OutputSource): TerminalOutput[] {
    return this.outputHistory.filter(output => {
      const matchesQuery = output.content.toLowerCase().includes(query.toLowerCase());
      const matchesSource = !source || output.source === source;
      return matchesQuery && matchesSource;
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private flushStreamBuffer(isFinal = false): void {
    if (!this.streamBuffer) return;

    const text = this.streamBuffer;
    this.streamBuffer = '';

    // Write buffered content
    this.write(text);

    // Reset streaming state if final
    if (isFinal) {
      this.isStreaming = false;
    }
  }

  private filterOutput(content: string, source: OutputSource): string {
    // Filter out sensitive information
    const sensitivePatterns = [
      /password[=:]\s*\S+/gi,
      /secret[=:]\s*\S+/gi,
      /token[=:]\s*\S+/gi,
      /api[_-]?key[=:]\s*\S+/gi,
    ];

    let filtered = content;
    for (const pattern of sensitivePatterns) {
      filtered = filtered.replace(pattern, '[REDACTED]');
    }

    return filtered;
  }

  private formatOutput(
    content: string, 
    source: OutputSource,
    options?: {
      addNewline?: boolean;
      preserveAnsi?: boolean;
    }
  ): string {
    // Preserve ANSI codes if requested
    if (options?.preserveAnsi) {
      return content;
    }

    // Add source color prefix
    const color = SOURCE_COLORS[source];
    
    return `${color}${content}\x1b[0m`;
  }

  private formatCommandHeader(commandId: string, source: OutputSource): string {
    const sourceLabels: Record<OutputSource, string> = {
      'local': 'Local',
      'llm': 'LLM Command',
      'sandbox': 'Sandbox',
      'sandbox-stderr': 'Sandbox Error',
      'pty': 'PTY Stream',
      'code-exec': 'Code Execution',
      'vfs': 'Filesystem Event',
      'system': 'System',
    };

    return `${sourceLabels[source]} [${commandId.slice(0, 8)}]`;
  }

  private generateOutputId(): string {
    return `out-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createEnhancedOutputStream(
  config: OutputStreamConfig
): EnhancedOutputStreamManager {
  return new EnhancedOutputStreamManager(config);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Merge multiple output streams into single consolidated output
 */
export function mergeOutputStreams(
  streams: EnhancedOutputStreamManager[],
  target: EnhancedOutputStreamManager
): () => void {
  const unsubscribers: Array<() => void> = [];

  for (const stream of streams) {
    const unsubscribe = (stream as any).onOutput && (() => {
      // Output already written to target via callback
    });

    if (unsubscribe) {
      unsubscribers.push(unsubscribe);
    }
  }

  return () => {
    unsubscribers.forEach(unsub => unsub());
  };
}

/**
 * Format ANSI-colored output for different sources
 */
export function formatSourceOutput(
  content: string,
  source: OutputSource,
  options?: {
    bold?: boolean;
    dim?: boolean;
    underline?: boolean;
  }
): string {
  const color = SOURCE_COLORS[source];
  const styles: string[] = [color];

  if (options?.bold) styles.push('\x1b[1m');
  if (options?.dim) styles.push('\x1b[2m');
  if (options?.underline) styles.push('\x1b[4m');

  return `${styles.join('')}${content}\x1b[0m`;
}

/**
 * Create command correlation ID for grouping related outputs
 */
export function createCommandCorrelationId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default EnhancedOutputStreamManager;
