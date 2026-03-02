/**
 * E2B Structured Output Helpers
 * 
 * Provides schema-validated output for Claude Code and Codex agents.
 * Ensures reliable, parseable responses for building pipelines.
 * 
 * @see https://e2b.dev/docs/agents/claude-code#structured-output
 * @see https://e2b.dev/docs/agents/codex#schema-validated-output
 */

import type { SandboxHandle } from './sandbox-provider';

/**
 * JSON Schema definition
 */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  enum?: any[];
}

/**
 * Structured output configuration
 */
export interface StructuredOutputConfig {
  /**
   * JSON schema for output validation
   */
  schema: JsonSchema;
  
  /**
   * Output format
   * @default 'json'
   */
  format?: 'json' | 'stream-json';
  
  /**
   * Timeout in milliseconds
   * @default 300000 (5 minutes)
   */
  timeout?: number;
}

/**
 * Structured output result
 */
export interface StructuredOutputResult<T = any> {
  /**
   * Parsed output data
   */
  data: T;
  
  /**
   * Raw stdout
   */
  rawOutput: string;
  
  /**
   * Whether parsing succeeded
   */
  success: boolean;
  
  /**
   * Parse error if any
   */
  error?: string;
  
  /**
   * Execution metadata
   */
  metadata?: {
    duration: number;
    exitCode: number;
    tokenUsage?: {
      input: number;
      output: number;
    };
  };
}

/**
 * E2B Structured Output Manager
 * 
 * Manages schema-validated output for AI agents.
 * Ensures responses conform to specified JSON schemas.
 * 
 * @example
 * ```typescript
 * const outputManager = new E2BStructuredOutputManager(sandbox);
 * 
 * // Define schema for security audit
 * const schema: JsonSchema = {
 *   type: 'object',
 *   properties: {
 *     issues: {
 *       type: 'array',
 *       items: {
 *         type: 'object',
 *         properties: {
 *           file: { type: 'string' },
 *           line: { type: 'number' },
 *           severity: { type: 'string', enum: ['low', 'medium', 'high'] },
 *           description: { type: 'string' },
 *         },
 *         required: ['file', 'severity', 'description'],
 *       },
 *     },
 *   },
 *   required: ['issues'],
 * };
 * 
 * // Execute with structured output
 * const result = await outputManager.executeWithSchema(
 *   'claude --output-schema /schema.json -p "Find security issues"',
 *   schema
 * );
 * 
 * console.log(result.data.issues);
 * ```
 */
export class E2BStructuredOutputManager {
  private sandbox: SandboxHandle;

  constructor(sandbox: SandboxHandle) {
    this.sandbox = sandbox;
  }

  /**
   * Execute command with schema-validated output
   * 
   * @param command - Command to execute
   * @param schema - JSON schema for validation
   * @param options - Additional options
   * @returns Structured output result
   */
  async executeWithSchema<T = any>(
    command: string,
    schema: JsonSchema,
    options?: {
      timeout?: number;
      cwd?: string;
    }
  ): Promise<StructuredOutputResult<T>> {
    const startTime = Date.now();
    
    try {
      // Write schema to file
      const schemaPath = '/tmp/output-schema.json';
      await this.sandbox.writeFile(schemaPath, JSON.stringify(schema, null, 2));

      // Execute command with schema
      const fullCommand = `${command} --output-schema ${schemaPath}`;
      const result = await this.sandbox.executeCommand(
        fullCommand,
        options?.cwd,
        options?.timeout
      );

      // Parse output
      let data: T;
      let parseError: string | undefined;
      let success = false;

      try {
        data = JSON.parse(result.output);
        success = true;
      } catch (error: any) {
        data = {} as T;
        parseError = `Failed to parse output: ${error.message}`;
      }

      return {
        data,
        rawOutput: result.output,
        success,
        error: parseError,
        metadata: {
          duration: Date.now() - startTime,
          exitCode: result.exitCode || 0,
        },
      };
    } catch (error: any) {
      return {
        data: {} as T,
        rawOutput: '',
        success: false,
        error: error.message,
        metadata: {
          duration: Date.now() - startTime,
          exitCode: -1,
        },
      };
    }
  }

  /**
   * Execute command with streaming JSON output
   * 
   * @param command - Command to execute
   * @param onEvent - Event handler for streaming data
   * @param options - Additional options
   * @returns Execution result
   */
  async executeWithStreamingJson(
    command: string,
    onEvent: (event: {
      type: string;
      subtype?: string;
      data?: any;
      message?: {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };
    }) => void,
    options?: {
      timeout?: number;
      cwd?: string;
    }
  ): Promise<{
    success: boolean;
    error?: string;
    duration: number;
  }> {
    const startTime = Date.now();
    
    try {
      const fullCommand = `${command} --output-format stream-json`;
      
      const result = await this.sandbox.executeCommand(fullCommand, options?.cwd, options?.timeout, {
        onStdout: (data: string) => {
          // Parse streaming JSONL
          const lines = data.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              onEvent(event);
            } catch {
              // Skip invalid JSON lines
            }
          }
        },
      });

      return {
        success: result.success,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute Claude Code with structured output
   * 
   * @param prompt - Prompt for Claude
   * @param schema - JSON schema for validation
   * @param options - Additional options
   * @returns Structured output result
   */
  async executeClaudeWithSchema<T = any>(
    prompt: string,
    schema: JsonSchema,
    options?: {
      workingDir?: string;
      sessionId?: string;
      timeout?: number;
    }
  ): Promise<StructuredOutputResult<T>> {
    let command = `claude --output-format json -p "${prompt.replace(/"/g, '\\"')}"`;
    
    if (options?.sessionId) {
      command = `claude --session-id ${options.sessionId} ${command}`;
    }

    return this.executeWithSchema<T>(command, schema, {
      timeout: options?.timeout,
      cwd: options?.workingDir,
    });
  }

  /**
   * Execute Codex with schema-validated output
   * 
   * @param prompt - Prompt for Codex
   * @param schema - JSON schema for validation
   * @param options - Additional options
   * @returns Structured output result
   */
  async executeCodexWithSchema<T = any>(
    prompt: string,
    schema: JsonSchema,
    options?: {
      workingDir?: string;
      timeout?: number;
    }
  ): Promise<StructuredOutputResult<T>> {
    const command = `codex exec --full-auto --output-schema /schema.json -p "${prompt.replace(/"/g, '\\"')}"`;
    
    return this.executeWithSchema<T>(command, schema, {
      timeout: options?.timeout,
      cwd: options?.workingDir,
    });
  }

  /**
   * Create common schemas
   */
  static createSchema(type: 'security-audit' | 'code-review' | 'task-plan' | 'file-list'): JsonSchema {
    switch (type) {
      case 'security-audit':
        return {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string', description: 'File path' },
                  line: { type: 'number', description: 'Line number' },
                  severity: { 
                    type: 'string', 
                    enum: ['low', 'medium', 'high', 'critical'],
                    description: 'Issue severity',
                  },
                  type: { type: 'string', description: 'Issue type (e.g., XSS, SQL injection)' },
                  description: { type: 'string', description: 'Issue description' },
                  recommendation: { type: 'string', description: 'Fix recommendation' },
                },
                required: ['file', 'severity', 'type', 'description'],
              },
            },
            summary: {
              type: 'object',
              properties: {
                totalIssues: { type: 'number' },
                criticalCount: { type: 'number' },
                highCount: { type: 'number' },
              },
              required: ['totalIssues'],
            },
          },
          required: ['issues', 'summary'],
        };

      case 'code-review':
        return {
          type: 'object',
          properties: {
            feedback: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  file: { type: 'string' },
                  category: { 
                    type: 'string',
                    enum: ['bug', 'performance', 'style', 'security', 'maintainability'],
                  },
                  comment: { type: 'string' },
                  suggestion: { type: 'string' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
                required: ['file', 'category', 'comment'],
              },
            },
            overallScore: { type: 'number', minimum: 0, maximum: 100 },
          },
          required: ['feedback', 'overallScore'],
        };

      case 'task-plan':
        return {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  order: { type: 'number' },
                  action: { type: 'string' },
                  files: { type: 'array', items: { type: 'string' } },
                  estimatedTime: { type: 'string' },
                },
                required: ['order', 'action'],
              },
            },
            risks: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['task', 'steps'],
        };

      case 'file-list':
        return {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  type: { type: 'string', enum: ['file', 'directory'] },
                  size: { type: 'number' },
                  modified: { type: 'string' },
                },
                required: ['path', 'type'],
              },
            },
          },
          required: ['files'],
        };

      default:
        return { type: 'object' };
    }
  }
}

/**
 * Create structured output manager for sandbox
 * 
 * @param sandbox - Sandbox handle
 * @returns Structured output manager
 */
export function createStructuredOutputManager(sandbox: SandboxHandle): E2BStructuredOutputManager {
  return new E2BStructuredOutputManager(sandbox);
}

/**
 * Quick execute with common schema
 * 
 * @param sandbox - Sandbox handle
 * @param type - Schema type
 * @param prompt - Prompt for agent
 * @returns Structured output result
 */
export async function quickExecuteWithSchema<T = any>(
  sandbox: SandboxHandle,
  type: 'security-audit' | 'code-review' | 'task-plan' | 'file-list',
  prompt: string
): Promise<StructuredOutputResult<T>> {
  const manager = createStructuredOutputManager(sandbox);
  const schema = E2BStructuredOutputManager.createSchema(type);
  
  return await manager.executeClaudeWithSchema<T>(prompt, schema);
}
