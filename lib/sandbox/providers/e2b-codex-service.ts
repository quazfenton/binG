/**
 * E2B Codex Service
 * 
 * Run OpenAI Codex agent in E2B sandboxes
 * 
 * Codex is OpenAI's open-source coding agent. This service provides programmatic
 * access to run Codex commands in E2B sandboxes with advanced features like:
 * - Schema-validated output
 * - Streaming JSON events
 * - Image/design mockup input
 * - Thread management
 * 
 * @see https://e2b.dev/docs/agents/codex
 * @see https://github.com/openai/codex
 * 
 * @example
 * ```typescript
 * import { Sandbox } from '@e2b/code-interpreter'
 * import { createCodexService } from './e2b-codex-service'
 * 
 * const sandbox = await Sandbox.create('codex', {
 *   envs: { CODEX_API_KEY: process.env.CODEX_API_KEY },
 * })
 * 
 * const codex = createCodexService(sandbox, process.env.CODEX_API_KEY!)
 * 
 * // Run Codex with prompt
 * const result = await codex.run({
 *   prompt: 'Create a hello world HTTP server in Go',
 *   fullAuto: true,
 *   skipGitRepoCheck: true,
 * })
 * 
 * // Run with schema-validated output
 * await sandbox.files.write('/home/user/schema.json', JSON.stringify({
 *   type: 'object',
 *   properties: {
 *     issues: {
 *       type: 'array',
 *       items: {
 *         type: 'object',
 *         properties: {
 *           file: { type: 'string' },
 *           severity: { type: 'string', enum: ['low', 'medium', 'high'] },
 *           description: { type: 'string' },
 *         },
 *         required: ['file', 'severity', 'description'],
 *       },
 *     },
 *   },
 *   required: ['issues'],
 * }))
 * 
 * const result = await codex.run({
 *   prompt: 'Review this codebase for security issues',
 *   outputSchemaPath: '/home/user/schema.json',
 *   workingDir: '/home/user/repo',
 * })
 * 
 * const issues = JSON.parse(result.stdout)
 * console.log(issues.issues)
 * 
 * // Stream events for real-time monitoring
 * for await (const event of codex.streamEvents({
 *   prompt: 'Refactor the utils module',
 *   workingDir: '/home/user/repo',
 * })) {
 *   if (event.type === 'tool_call') {
 *     console.log(`Tool: ${event.data.tool_name}`)
 *   }
 * }
 * 
 * // Run with image input (design mockup)
 * const fs = await import('node:fs')
 * await sandbox.files.write(
 *   '/home/user/mockup.png',
 *   fs.readFileSync('./mockup.png')
 * )
 * 
 * const result = await codex.run({
 *   prompt: 'Implement this UI design as a React component',
 *   imagePath: '/home/user/mockup.png',
 *   workingDir: '/home/user/repo',
 * })
 * ```
 */

import type { Sandbox } from '@e2b/code-interpreter'
import type { Readable } from 'node:stream'

/**
 * Codex execution configuration
 */
export interface CodexExecutionConfig {
  /** The prompt/task for Codex to execute */
  prompt: string
  
  /** Auto-approve all tool calls (safe inside E2B sandboxes) */
  fullAuto?: boolean
  
  /** Skip git repository ownership check */
  skipGitRepoCheck?: boolean
  
  /** Path to JSON schema for output validation */
  outputSchemaPath?: string
  
  /** Path to image/design mockup file */
  imagePath?: string
  
  /** Working directory for the command */
  workingDir?: string
  
  /** Timeout in milliseconds */
  timeout?: number
  
  /** Callback for stdout (streaming) */
  onStdout?: (data: string) => void
  
  /** Callback for stderr */
  onStderr?: (data: string) => void
  
  /** Callback for events (when streaming) */
  onEvent?: (event: CodexEvent) => void
}

/**
 * Codex event from streaming output
 */
export interface CodexEvent {
  /** Event type */
  type: 'tool_call' | 'file_change' | 'message' | 'error' | 'thinking'
  
  /** Event data */
  data: {
    /** Tool name if tool_call */
    tool_name?: string
    
    /** Tool arguments */
    arguments?: any
    
    /** File path if file_change */
    file_path?: string
    
    /** Change type */
    change_type?: 'create' | 'modify' | 'delete'
    
    /** Message content */
    content?: string
    
    /** Error message */
    error?: string
    
    /** Thinking content */
    thinking?: string
  }
  
  /** Timestamp */
  timestamp?: number
}

/**
 * Codex execution result
 */
export interface CodexExecutionResult {
  /** Standard output */
  stdout: string
  
  /** Standard error */
  stderr: string
  
  /** Exit code */
  exitCode: number
  
  /** Parsed events if streaming was enabled */
  events?: CodexEvent[]
  
  /** Parsed output if schema was used */
  parsedOutput?: any
}

/**
 * E2B Codex Service interface
 */
export interface E2BCodexService {
  /** Run Codex with configuration */
  run(config: CodexExecutionConfig): Promise<CodexExecutionResult>
  
  /** Stream Codex events */
  streamEvents(config: CodexExecutionConfig): AsyncIterable<CodexEvent>
  
  /** Run with image input */
  runWithImage(config: CodexExecutionConfig & { imageData?: Buffer }): Promise<CodexExecutionResult>
}

/**
 * Create Codex service instance
 * 
 * @param sandbox - E2B sandbox instance
 * @param apiKey - OpenAI API key for Codex
 * @returns Codex service instance
 */
export function createCodexService(
  sandbox: Sandbox,
  apiKey: string
): E2BCodexService {
  const CODEX_CMD = 'codex exec'

  /**
   * Build Codex command arguments
   */
  function buildArgs(config: CodexExecutionConfig): string {
    const args = [
      config.fullAuto ? '--full-auto' : '',
      config.skipGitRepoCheck ? '--skip-git-repo-check' : '',
      config.outputSchemaPath ? `--output-schema ${config.outputSchemaPath}` : '',
      config.imagePath ? `--image ${config.imagePath}` : '',
      config.workingDir ? `-C ${config.workingDir}` : '',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')

    return args
  }

  /**
   * Run Codex with configuration
   */
  async function run(config: CodexExecutionConfig): Promise<CodexExecutionResult> {
    // Write output schema if provided
    if (config.outputSchemaPath && !config.imagePath) {
      // Schema should already be written by user
      // Just verify it exists
      try {
        await sandbox.files.read(config.outputSchemaPath)
      } catch {
        throw new Error(`Output schema file not found: ${config.outputSchemaPath}`)
      }
    }

    // Upload image if data provided
    if ('imageData' in config && config.imageData) {
      await sandbox.files.write(config.imagePath!, config.imageData as Buffer)
    }

    const args = buildArgs(config)
    const command = `${CODEX_CMD} ${args}`

    const executeOptions: any = {
      timeout: config.timeout || 600000, // 10 minutes default
    }

    if (config.onStdout) {
      executeOptions.onStdout = config.onStdout
    }

    if (config.onStderr) {
      executeOptions.onStderr = config.onStderr
    }

    const result = await sandbox.commands.run(command, executeOptions)

    // Parse events if JSON output
    let events: CodexEvent[] | undefined
    if (config.onEvent || config.onStdout) {
      events = []
      // Events would be parsed from stdout if --json was used
    }

    // Parse output if schema was used
    let parsedOutput: any
    if (config.outputSchemaPath) {
      try {
        parsedOutput = JSON.parse(result.stdout)
      } catch {
        // Output doesn't match schema or isn't JSON
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode || 0,
      events,
      parsedOutput,
    }
  }

  /**
   * Stream Codex events
   */
  async function* streamEvents(config: CodexExecutionConfig): AsyncIterable<CodexEvent> {
    const args = [
      '--full-auto',
      '--skip-git-repo-check',
      '--json',
      config.workingDir ? `-C ${config.workingDir}` : '',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')

    const command = `${CODEX_CMD} ${args}`

    // Execute command and capture output
    const result = await sandbox.commands.run(command, {
      timeout: config.timeout || 600000,
    })

    // Parse JSONL output (events to stdout, progress to stderr)
    const events: CodexEvent[] = []
    
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      try {
        const event: CodexEvent = JSON.parse(line)
        events.push(event)
        yield event
        
        // Also call callback if provided
        config.onEvent?.(event)
      } catch {
        // Skip invalid JSON lines - might be progress output
        // Progress goes to stderr in Codex
      }
    }

    // Store events on result for later access
    ;(result as any).events = events
  }

  /**
   * Run with image input
   * 
   * Enhanced with image format and size validation
   */
  async function runWithImage(
    config: CodexExecutionConfig & { imageData?: Buffer }
  ): Promise<CodexExecutionResult> {
    if (!config.imagePath) {
      throw new Error('imagePath is required for runWithImage');
    }

    // Validate and write image if data provided
    if ('imageData' in config && config.imageData) {
      const imageFormat = getImageFormat(config.imageData);
      const validFormats = ['png', 'jpeg', 'gif', 'webp'];
      
      if (!validFormats.includes(imageFormat)) {
        throw new Error(
          `Unsupported image format: ${imageFormat}. Supported formats: ${validFormats.join(', ')}`
        );
      }
      
      // Validate size (max 10MB)
      const maxSize = 10 * 1024 * 1024;
      if (config.imageData.length > maxSize) {
        throw new Error(
          `Image too large: ${(config.imageData.length / 1024 / 1024).toFixed(2)}MB (max 10MB)`
        );
      }
      
      // Write image to sandbox
      try {
        await sandbox.files.write(config.imagePath, config.imageData);
        console.log(`[Codex] Image written to ${config.imagePath} (${imageFormat}, ${(config.imageData.length / 1024).toFixed(2)}KB)`);
      } catch (writeError: any) {
        throw new Error(`Failed to write image to sandbox: ${writeError.message}`);
      }
    }

    return run(config);
  }

  /**
   * Detect image format from buffer magic bytes
   */
  function getImageFormat(buffer: Buffer): string {
    if (buffer.length < 4) {
      return 'unknown';
    }
    
    // Check magic bytes for common image formats
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'png';
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'jpeg';
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'gif';
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      return 'webp';
    }
    
    return 'unknown';
  }

  return {
    run,
    streamEvents,
    runWithImage,
  }
}

/**
 * Codex service factory for E2B sandbox handle
 * 
 * Add this to your E2BSandboxHandle class:
 * 
 * ```typescript
 * class E2BSandboxHandle implements SandboxHandle {
 *   private sandbox: Sandbox
 *   private codexService?: E2BCodexService
 *   
 *   getCodexService(apiKey: string): E2BCodexService {
 *     if (!this.codexService) {
 *       this.codexService = createCodexService(this.sandbox, apiKey)
 *     }
 *     return this.codexService
 *   }
 * }
 * ```
 */
export function getCodexService(
  sandbox: any,
  apiKey: string
): E2BCodexService {
  return createCodexService(sandbox as Sandbox, apiKey)
}

/**
 * Helper to create JSON schema for Codex output validation
 */
export function createCodexOutputSchema(schema: object): string {
  return JSON.stringify(schema, null, 2)
}

/**
 * Example schemas for common use cases
 */
export const CodexSchemas = {
  /** Security review schema */
  securityReview: {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
            severity: { 
              type: 'string', 
              enum: ['low', 'medium', 'high', 'critical'] 
            },
            description: { type: 'string' },
            recommendation: { type: 'string' },
          },
          required: ['file', 'severity', 'description'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['issues'],
  },

  /** Code review schema */
  codeReview: {
    type: 'object',
    properties: {
      improvements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            suggestion: { type: 'string' },
            before: { type: 'string' },
            after: { type: 'string' },
          },
          required: ['file', 'suggestion'],
        },
      },
      overall_assessment: { type: 'string' },
    },
    required: ['improvements'],
  },

  /** Refactoring plan schema */
  refactoringPlan: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            order: { type: 'number' },
            description: { type: 'string' },
            files_affected: { type: 'array', items: { type: 'string' } },
            estimated_complexity: { 
              type: 'string', 
              enum: ['low', 'medium', 'high'] 
            },
          },
          required: ['order', 'description'],
        },
      },
      total_files: { type: 'number' },
    },
    required: ['steps'],
  },
}
