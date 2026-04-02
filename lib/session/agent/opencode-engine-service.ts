/**
 * OpenCode V2 Engine Service
 * 
 * Primary agentic engine using OpenCode CLI for:
 * - Native bash command execution
 * - File system operations
 * - Code generation and refactoring
 * - Multi-step reasoning
 * - Tool calling with real execution
 * 
 * This replaces manual LLM call handling with OpenCode's built-in agentic capabilities.
 */

import { spawn } from 'child_process';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { normalizeToolInvocation, type ToolInvocation } from '@/lib/types/tool-invocation';

export interface OpenCodeEngineConfig {
  // Core
  model?: string;
  systemPrompt?: string;
  workingDir?: string;
  
  // Execution
  maxSteps?: number;
  timeout?: number;
  
  // Features
  enableBash?: boolean;
  enableFileOps?: boolean;
  enableCodegen?: boolean;
  
  // Streaming
  onStreamChunk?: (chunk: string) => void;
  onToolCall?: (tool: string, args: any) => void;
  onBashCommand?: (command: string) => void;
}

export interface OpenCodeEngineResult {
  success: boolean;
  response: string;
  bashCommands?: Array<{
    command: string;
    output: string;
    exitCode: number;
  }>;
  fileChanges?: Array<{
    path: string;
    action: string;
    content?: string;
  }>;
  steps?: number;
  reasoning?: string;
  toolInvocations?: ToolInvocation[];
  error?: string;
  metadata?: {
    model: string;
    duration: number;
    tokensUsed?: number;
  };
}

export interface OpenCodeSession {
  id: string;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
}

/**
 * Session manager for persistent OpenCode conversations
 */
class OpenCodeSessionManager {
  private sessions = new Map<string, OpenCodeSession>();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes

  createSession(): string {
    const id = uuidv4();
    this.sessions.set(id, {
      id,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
    });
    return id;
  }

  getSession(id: string): OpenCodeSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    // Check TTL
    if (Date.now() - session.lastActivity > this.TTL_MS) {
      this.sessions.delete(id);
      return undefined;
    }

    return session;
  }

  updateActivity(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = Date.now();
      session.messageCount++;
    }
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

export const openCodeSessionManager = new OpenCodeSessionManager();

/**
 * OpenCode V2 Engine - Primary agentic backend
 */
export class OpenCodeEngineService {
  private config: OpenCodeEngineConfig;
  private sessionId?: string;

  constructor(config: OpenCodeEngineConfig = {}) {
    this.config = {
      model: process.env.OPENCODE_MODEL || 'claude-3-5-sonnet',
      systemPrompt: 'You are an expert software engineer. Use bash commands and file operations to complete tasks efficiently.',
      workingDir: process.cwd(),
      maxSteps: 20,
      timeout: 300000, // 5 minutes
      enableBash: true,
      enableFileOps: true,
      enableCodegen: true,
      ...config,
    };
  }

  /**
   * Execute a task using OpenCode CLI
   * 
   * This leverages OpenCode's native agentic capabilities:
   * - Automatic bash command generation and execution
   * - File system operations with real execution
   * - Multi-step reasoning with tool calling
   * - Code generation with immediate validation
   */
  async execute(task: string): Promise<OpenCodeEngineResult> {
    const startTime = Date.now();
    const sessionId = openCodeSessionManager.createSession();
    this.sessionId = sessionId;

    try {
      // Check if opencode is available
      const opencodePath = await this.findOpencodeBinary();
      if (!opencodePath) {
        return {
          success: false,
          response: '',
          error: 'OpenCode CLI not found. Install with: npm install -g opencode-ai',
          metadata: {
            model: this.config.model!,
            duration: Date.now() - startTime,
          },
        };
      }

      // Prepare the execution environment
      const tempDir = join(tmpdir(), `opencode-${sessionId}`);
      await mkdir(tempDir, { recursive: true });

      // Build the prompt with context
      const prompt = this.buildPrompt(task);

      // Execute OpenCode
      const result = await this.runOpencodeCLI(opencodePath, prompt, tempDir);

      // Parse and structure the output
      const parsed = this.parseOpencodeOutput(result);

      // Update session
      openCodeSessionManager.updateActivity(sessionId);

      return {
        success: true,
        response: parsed.response,
        bashCommands: parsed.bashCommands,
        fileChanges: parsed.fileChanges,
        steps: parsed.steps,
        toolInvocations: parsed.toolInvocations,
        metadata: {
          model: this.config.model!,
          duration: Date.now() - startTime,
          tokensUsed: parsed.tokensUsed,
        },
      };
    } catch (error: any) {
      openCodeSessionManager.deleteSession(sessionId);
      
      return {
        success: false,
        response: '',
        error: error.message || 'OpenCode execution failed',
        metadata: {
          model: this.config.model!,
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute with streaming output
   */
  async *executeStream(task: string): AsyncGenerator<{
    type: 'chunk' | 'tool' | 'bash' | 'complete' | 'error';
    data: any;
  }> {
    const sessionId = openCodeSessionManager.createSession();
    this.sessionId = sessionId;

    try {
      const opencodePath = await this.findOpencodeBinary();
      if (!opencodePath) {
        yield {
          type: 'error',
          data: 'OpenCode CLI not found',
        };
        return;
      }

      const tempDir = join(tmpdir(), `opencode-${sessionId}`);
      await mkdir(tempDir, { recursive: true });

      const prompt = this.buildPrompt(task);

      // Run with streaming
      const proc = spawn(opencodePath, [
        'chat',
        '--json',
        '--model',
        this.config.model!,
      ], {
        cwd: this.config.workingDir,
        env: {
          ...process.env,
          OPENCODE_SYSTEM_PROMPT: this.config.systemPrompt,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Send prompt
      proc.stdin.write(JSON.stringify({ prompt }) + '\n');
      proc.stdin.end();

      let buffer = '';
      let steps = 0;

      for await (const chunk of proc.stdout) {
        buffer += chunk.toString();
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);
            
            if (parsed.text) {
              yield {
                type: 'chunk',
                data: parsed.text,
              };
              this.config.onStreamChunk?.(parsed.text);
            }

            if (parsed.tool_call) {
              steps++;
              yield {
                type: 'tool',
                data: {
                  name: parsed.tool_call.name,
                  args: parsed.tool_call.arguments,
                },
              };
              this.config.onToolCall?.(parsed.tool_call.name, parsed.tool_call.arguments);
            }

            if (parsed.bash_command) {
              yield {
                type: 'bash',
                data: parsed.bash_command,
              };
              this.config.onBashCommand?.(parsed.bash_command);
            }

            if (parsed.done || parsed.complete) {
              openCodeSessionManager.updateActivity(sessionId);
              
              yield {
                type: 'complete',
                data: {
                  response: parsed.response || parsed.text,
                  steps,
                },
              };
              return;
            }
          } catch {
            // Non-JSON output, treat as text
            yield {
              type: 'chunk',
              data: line,
            };
          }
        }
      }

      // Check for errors
      await new Promise((resolve, reject) => {
        proc.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`OpenCode exited with code ${code}`));
          } else {
            resolve(undefined);
          }
        });
        
        proc.on('error', reject);
      });

    } catch (error: any) {
      openCodeSessionManager.deleteSession(sessionId);
      
      yield {
        type: 'error',
        data: error.message,
      };
    }
  }

  /**
   * Find opencode binary in PATH
   */
  private async findOpencodeBinary(): Promise<string | null> {
    // Check explicit path first
    if (process.env.OPENCODE_BIN) {
      return process.env.OPENCODE_BIN;
    }

    // Try `which` / `where` to locate the binary
    const { execSync } = await import('child_process');
    try {
      const cmd = process.platform === 'win32' ? 'where opencode' : 'which opencode';
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (result) return result.split('\n')[0].trim();
    } catch {
      // Not found in PATH
    }

    return null;
  }

  /**
   * Build the prompt with context and instructions
   */
  private buildPrompt(task: string): string {
    const parts: string[] = [];

    // System prompt
    if (this.config.systemPrompt) {
      parts.push(`SYSTEM: ${this.config.systemPrompt}`);
    }

    // Capabilities
    const capabilities: string[] = [];
    if (this.config.enableBash) capabilities.push('bash_command_execution');
    if (this.config.enableFileOps) capabilities.push('file_operations');
    if (this.config.enableCodegen) capabilities.push('code_generation');

    parts.push(`CAPABILITIES: ${capabilities.join(', ')}`);

    // Constraints
    parts.push(`CONSTRAINTS:
- Maximum ${this.config.maxSteps} tool execution steps
- Timeout: ${this.config.timeout / 1000} seconds
- Working directory: ${this.config.workingDir}
- Always validate code after generation
- Use bash for system operations
- Use file operations for code changes

FILE WRITING SYNTAX:
Use structured file operations for writing files (preferred):
  - Create: { file_operation: { action: "create", path: "src/file.ts", content: "..." } }
  - Modify: { file_operation: { action: "modify", path: "src/file.ts", content: "..." } }
  - Delete: { file_operation: { action: "delete", path: "src/old.ts" } }

For bash operations (directories, git, etc.):
  mkdir -p path/to/directory
  rm path/to/old-file.ts
  git add . && git commit -m "message"

DO NOT use: <file_write>, <file_edit>, WRITE <<<, or XML-like tags`);

    // Task
    parts.push(`TASK: ${task}`);

    return parts.join('\n\n');
  }

  /**
   * Run OpenCode CLI and capture output
   */
  private async runOpencodeCLI(
    binaryPath: string,
    prompt: string,
    tempDir: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binaryPath, [
        'chat',
        '--json',
        '--model',
        this.config.model!,
      ], {
        cwd: this.config.workingDir,
        env: {
          ...process.env,
          OPENCODE_SYSTEM_PROMPT: this.config.systemPrompt,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      // Send prompt
      proc.stdin.write(JSON.stringify({ prompt }) + '\n');
      proc.stdin.end();

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        this.config.onStreamChunk?.(data.toString());
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        if (process.env.NODE_ENV === 'development') {
          console.error('[OpenCode stderr]', data.toString());
        }
      });

      proc.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          code: code || 0,
        });
      });

      proc.on('error', reject);

      // Timeout
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('OpenCode execution timed out'));
      }, this.config.timeout);
    });
  }

  /**
   * Parse OpenCode output into structured result
   */
  private parseOpencodeOutput(result: {
    stdout: string;
    stderr: string;
    code: number;
  }): {
    response: string;
    bashCommands: Array<{ command: string; output: string; exitCode: number }>;
    fileChanges: Array<{ path: string; action: string; content?: string }>;
    steps: number;
    tokensUsed?: number;
    reasoning?: string;
    toolInvocations: ToolInvocation[];
  } {
    const bashCommands: any[] = [];
    const fileChanges: any[] = [];
    const toolInvocations: ToolInvocation[] = [];
    let response = '';
    let steps = 0;
    let tokensUsed = 0;
    let reasoning = '';

    const lines = result.stdout.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        // Text response
        if (parsed.text) {
          response += parsed.text;
        }

        // Bash command execution
        if (parsed.bash_command) {
          bashCommands.push({
            command: parsed.bash_command,
            output: parsed.bash_output || '',
            exitCode: parsed.exit_code || 0,
          });
          toolInvocations.push(normalizeToolInvocation({
            toolName: 'bash',
            args: { command: parsed.bash_command },
            result: { output: parsed.bash_output || '', exitCode: parsed.exit_code || 0 },
            sourceSystem: 'opencode-engine',
          }));
          steps++;
        }

        // File operations
        if (parsed.file_operation) {
          const action = parsed.file_operation.action;
          fileChanges.push({
            path: parsed.file_operation.path,
            action: (action === 'create' || action === 'modify' || action === 'delete') 
              ? action 
              : 'modify' as const,
            content: parsed.file_operation.content,
          });
          toolInvocations.push(normalizeToolInvocation({
            toolName: 'file_operation',
            args: { path: parsed.file_operation.path, action },
            result: { content: parsed.file_operation.content },
            sourceSystem: 'opencode-engine',
          }));
          steps++;
        }

        // Tool calls
        if (parsed.tool_call) {
          toolInvocations.push(normalizeToolInvocation({
            toolName: parsed.tool_call.name || parsed.tool_call.tool || 'unknown',
            args: parsed.tool_call.arguments || parsed.tool_call.args || parsed.tool_call.input,
            result: parsed.tool_call.result || parsed.tool_call.output,
            sourceSystem: 'opencode-engine',
          }));
          steps++;
        }

        // Token usage
        if (parsed.usage) {
          tokensUsed += (parsed.usage.total_tokens || 0);
        }

        // Completion
        if (parsed.done || parsed.complete) {
          if (parsed.response) {
            response = parsed.response;
          }
        }

        // Extract reasoning/thinking from the output
        if (parsed.thinking || parsed.reasoning || parsed.thought) {
          reasoning += (parsed.thinking || parsed.reasoning || parsed.thought) + '\n';
        }
      } catch {
        // Non-JSON line, append to response
        response += line + '\n';
      }
    }

    return {
      response: response.trim(),
      bashCommands,
      fileChanges,
      steps,
      tokensUsed,
      reasoning: reasoning.trim() || undefined,
      toolInvocations,
    };
  }

  /**
   * Get current session info
   */
  getSessionInfo(): OpenCodeSession | undefined {
    if (!this.sessionId) return undefined;
    return openCodeSessionManager.getSession(this.sessionId);
  }

  /**
   * Check if OpenCode is available and working
   */
  async healthCheck(): Promise<{
    available: boolean;
    version?: string;
    binary?: string;
    error?: string;
  }> {
    try {
      const binary = await this.findOpencodeBinary();
      if (!binary) {
        return {
          available: false,
          error: 'OpenCode binary not found in PATH',
        };
      }

      // Get version
      const version = await new Promise<string>((resolve, reject) => {
        const proc = spawn(binary, ['--version']);
        let output = '';
        
        proc.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        proc.on('close', () => resolve(output.trim()));
        proc.on('error', reject);
        
        setTimeout(() => reject(new Error('Timeout')), 5000);
      });

      return {
        available: true,
        version,
        binary,
      };
    } catch (error: any) {
      return {
        available: false,
        error: error.message,
      };
    }
  }
}

/**
 * Create OpenCode engine instance
 */
export function createOpenCodeEngine(config?: OpenCodeEngineConfig): OpenCodeEngineService {
  return new OpenCodeEngineService(config);
}

/**
 * Quick execute helper
 */
export async function executeWithOpenCode(
  task: string,
  config?: Partial<OpenCodeEngineConfig>
): Promise<OpenCodeEngineResult> {
  const engine = createOpenCodeEngine(config);
  return engine.execute(task);
}
