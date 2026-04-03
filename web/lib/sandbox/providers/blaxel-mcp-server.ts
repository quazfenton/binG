/**
 * Blaxel MCP (Model Context Protocol) Server
 * 
 * Expose Blaxel sandbox capabilities as MCP tools for AI assistants.
 * This allows AI agents (Cursor, Claude, etc.) to interact with the sandbox
 * through standardized MCP tool calls.
 * 
 * Features:
 * - Execute commands in sandbox
 * - Read/write files
 * - List directories
 * - Get sandbox info
 * - Run batch jobs
 * - Execute asynchronously
 * 
 * Documentation: https://docs.blaxel.ai/Sandboxes/MCP
 */

import type { SandboxHandle } from './sandbox-provider'
import type { BatchTask, BatchJobConfig } from './sandbox-provider'

// MCP SDK types (simplified for dynamic import)
interface McpServerOptions {
  name: string
  version: string
}

interface McpToolSchema {
  type: string
  description?: string
  properties?: Record<string, any>
  required?: string[]
}

interface McpToolResult {
  content: Array<{
    type: string
    text: string
  }>
  isError?: boolean
}

/**
 * Blaxel MCP Server Class
 * 
 * Wraps a Blaxel sandbox handle and exposes its capabilities as MCP tools.
 */
export class BlaxelMcpServer {
  private server: any = null
  private sandboxHandle: SandboxHandle
  private connected: boolean = false

  constructor(sandboxHandle: SandboxHandle) {
    this.sandboxHandle = sandboxHandle
  }

  /**
   * Register all sandbox tools as MCP tools
   */
  private registerTools(): void {
    if (!this.server) return

    // Tool: Execute Command
    this.server.tool(
      'execute_command',
      'Execute a shell command in the Blaxel sandbox. Best for running scripts, installing packages, building projects, and general shell operations.',
      {
        type: 'object',
        description: 'Command execution parameters',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute (e.g., "npm install", "python script.py")',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for command execution (default: /workspace)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 60000, max: 300000)',
          },
        },
        required: ['command'],
      } as McpToolSchema,
      async (params: any): Promise<McpToolResult> => {
        try {
          const result = await this.sandboxHandle.executeCommand(
            params.command,
            params.cwd || '/workspace',
            params.timeout || 60000
          )

          return {
            content: [
              {
                type: 'text',
                text: result.success
                  ? `Command executed successfully.\n\nOutput:\n${result.output}`
                  : `Command failed with exit code ${result.exitCode}.\n\nError:\n${result.output}`,
              },
            ],
            isError: !result.success,
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Execution error: ${error.message}` }],
            isError: true,
          }
        }
      }
    )

    // Tool: Write File
    this.server.tool(
      'write_file',
      'Write content to a file in the sandbox. Creates parent directories if needed. Best for creating source files, configuration files, and data files.',
      {
        type: 'object',
        description: 'File write parameters',
        properties: {
          path: {
            type: 'string',
            description: 'File path (relative to /workspace or absolute path within sandbox)',
          },
          content: {
            type: 'string',
            description: 'File content to write',
          },
        },
        required: ['path', 'content'],
      } as McpToolSchema,
      async (params: any): Promise<McpToolResult> => {
        try {
          const result = await this.sandboxHandle.writeFile(params.path, params.content)

          return {
            content: [
              {
                type: 'text',
                text: result.success
                  ? `File written successfully: ${params.path}`
                  : `Failed to write file: ${result.output}`,
              },
            ],
            isError: !result.success,
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Write error: ${error.message}` }],
            isError: true,
          }
        }
      }
    )

    // Tool: Read File
    this.server.tool(
      'read_file',
      'Read content from a file in the sandbox. Best for viewing source code, configuration files, logs, and data files.',
      {
        type: 'object',
        description: 'File read parameters',
        properties: {
          path: {
            type: 'string',
            description: 'File path to read',
          },
        },
        required: ['path'],
      } as McpToolSchema,
      async (params: any): Promise<McpToolResult> => {
        try {
          const result = await this.sandboxHandle.readFile(params.path)

          return {
            content: [
              {
                type: 'text',
                text: result.success
                  ? `File content:\n\n${result.output}`
                  : `Failed to read file: ${result.output}`,
              },
            ],
            isError: !result.success,
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Read error: ${error.message}` }],
            isError: true,
          }
        }
      }
    )

    // Tool: List Directory
    this.server.tool(
      'list_directory',
      'List contents of a directory in the sandbox. Shows files, directories, and permissions.',
      {
        type: 'object',
        description: 'Directory listing parameters',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (default: /workspace)',
          },
        },
        required: [],
      } as McpToolSchema,
      async (params: any): Promise<McpToolResult> => {
        try {
          const result = await this.sandboxHandle.listDirectory(params.path || '/workspace')

          return {
            content: [
              {
                type: 'text',
                text: result.success
                  ? `Directory contents:\n\n${result.output}`
                  : `Failed to list directory: ${result.output}`,
              },
            ],
            isError: !result.success,
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `List error: ${error.message}` }],
            isError: true,
          }
        }
      }
    )

    // Tool: Get Sandbox Info
    this.server.tool(
      'get_sandbox_info',
      'Get information about the sandbox including status, URL, region, and resource usage.',
      {
        type: 'object',
        description: 'No parameters required',
        properties: {},
        required: [],
      } as McpToolSchema,
      async (): Promise<McpToolResult> => {
        try {
          const info = await this.sandboxHandle.getProviderInfo?.()

          if (!info) {
            return {
              content: [{ type: 'text', text: 'Sandbox info not available' }],
              isError: false,
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: `Sandbox Information:\n` +
                  `- Provider: ${info.provider}\n` +
                  `- Status: ${info.status}\n` +
                  `- Region: ${info.region || 'N/A'}\n` +
                  `- URL: ${info.url || 'N/A'}\n` +
                  `- Created: ${info.createdAt}\n` +
                  `${info.expiresIn ? `- Expires in: ${info.expiresIn}s\n` : ''}`,
              },
            ],
            isError: false,
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Info error: ${error.message}` }],
            isError: true,
          }
        }
      }
    )

    // Tool: Run Batch Job (if available)
    if (this.sandboxHandle.runBatchJob) {
      this.server.tool(
        'run_batch_job',
        'Execute multiple tasks in parallel. Best for batch processing, running multiple test suites, or processing large datasets.',
        {
          type: 'object',
          description: 'Batch job parameters',
          properties: {
            tasks: {
              type: 'array',
              description: 'Array of tasks to execute',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Task ID' },
                  data: { type: 'object', description: 'Task data' },
                },
              },
            },
            maxConcurrentTasks: {
              type: 'number',
              description: 'Maximum number of concurrent tasks (default: 10)',
            },
            timeout: {
              type: 'number',
              description: 'Timeout per task in seconds (default: 300)',
            },
          },
          required: ['tasks'],
        } as McpToolSchema,
        async (params: any): Promise<McpToolResult> => {
          try {
            const config: BatchJobConfig = {
              runtime: {
                maxConcurrentTasks: params.maxConcurrentTasks || 10,
                timeout: params.timeout ? params.timeout * 1000 : 300000,
              },
            }

            const tasks: BatchTask[] = params.tasks || []
            const result = await this.sandboxHandle.runBatchJob!(tasks, config)

            return {
              content: [
                {
                  type: 'text',
                  text: `Batch job completed:\n` +
                    `- Total tasks: ${result.totalTasks}\n` +
                    `- Completed: ${result.completedTasks}\n` +
                    `- Failed: ${result.failedTasks}\n` +
                    `- Status: ${result.status}`,
                },
              ],
              isError: result.failedTasks > 0,
            }
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Batch job error: ${error.message}` }],
              isError: true,
            }
          }
        }
      )
    }

    // Tool: Execute Async (if available)
    if (this.sandboxHandle.executeAsync) {
      this.server.tool(
        'execute_async',
        'Execute a long-running command asynchronously (up to 15 minutes). Returns immediately with execution ID. Best for builds, deployments, and long test runs.',
        {
          type: 'object',
          description: 'Async execution parameters',
          properties: {
            command: {
              type: 'string',
              description: 'Command to execute',
            },
            callbackUrl: {
              type: 'string',
              description: 'Webhook URL for completion notification (optional)',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 900000 for 15 min)',
            },
          },
          required: ['command'],
        } as McpToolSchema,
        async (params: any): Promise<McpToolResult> => {
          try {
            const result = await this.sandboxHandle.executeAsync!({
              command: params.command,
              callbackUrl: params.callbackUrl,
              timeout: params.timeout || 900000,
            })

            return {
              content: [
                {
                  type: 'text',
                  text: `Async execution started:\n` +
                    `- Execution ID: ${result.executionId}\n` +
                    `- Status: ${result.status}\n` +
                    `${result.callbackUrl ? `- Callback: ${result.callbackUrl}\n` : ''}`,
                },
              ],
              isError: false,
            }
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Async error: ${error.message}` }],
              isError: true,
            }
          }
        }
      )
    }

    // Tool: Stream Logs (if available)
    if (this.sandboxHandle.streamLogs) {
      this.server.tool(
        'stream_logs',
        'Stream sandbox logs in real-time. Returns log entries as they are generated. Best for monitoring long-running processes and debugging.',
        {
          type: 'object',
          description: 'Log streaming parameters',
          properties: {
            follow: {
              type: 'boolean',
              description: 'Follow log stream (default: true)',
            },
            tail: {
              type: 'number',
              description: 'Number of lines to retrieve initially (default: 100)',
            },
          },
          required: [],
        } as McpToolSchema,
        async (params: any): Promise<McpToolResult> => {
          try {
            const logStream = await this.sandboxHandle.streamLogs!({
              follow: params.follow ?? true,
              tail: params.tail ?? 100,
            })

            const logs: string[] = []
            let count = 0
            const maxLogs = 50 // Limit to prevent overflow

            for await (const log of logStream) {
              logs.push(`[${log.timestamp}] ${log.level?.toUpperCase() || 'INFO'}: ${log.message}`)
              count++
              if (count >= maxLogs) break
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Recent logs (${logs.length} entries):\n\n${logs.join('\n')}`,
                },
              ],
              isError: false,
            }
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Log streaming error: ${error.message}` }],
              isError: true,
            }
          }
        }
      )
    }

    // Tool: Agent Handoff (if available)
    if (this.sandboxHandle.callAgent) {
      this.server.tool(
        'call_agent',
        'Call another Blaxel agent for multi-stage pipelines or specialized agent orchestration. Best for microservice architecture and agent chaining.',
        {
          type: 'object',
          description: 'Agent handoff parameters',
          properties: {
            targetAgent: {
              type: 'string',
              description: 'Name of the target agent to call',
            },
            input: {
              type: 'object',
              description: 'Input data to pass to the target agent',
            },
            waitForCompletion: {
              type: 'boolean',
              description: 'Wait for agent completion (default: true)',
            },
          },
          required: ['targetAgent', 'input'],
        } as McpToolSchema,
        async (params: any): Promise<McpToolResult> => {
          try {
            const result = await this.sandboxHandle.callAgent!({
              targetAgent: params.targetAgent,
              input: params.input,
              waitForCompletion: params.waitForCompletion ?? true,
            })

            return {
              content: [
                {
                  type: 'text',
                  text: `Agent handoff completed:\n${JSON.stringify(result, null, 2)}`,
                },
              ],
              isError: false,
            }
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Agent handoff error: ${error.message}` }],
              isError: true,
            }
          }
        }
      )
    }
  }

  /**
   * Start MCP server with stdio transport
   * 
   * This is the standard way to run MCP servers for AI assistants.
   * The server communicates via stdin/stdout.
   * 
   * @example
   * ```typescript
   * const handle = await blaxelProvider.createSandbox({})
   * const mcpServer = new BlaxelMcpServer(handle)
   * await mcpServer.start()
   * ```
   */
  async start(): Promise<void> {
    try {
      const { Server: McpServer } = await import('@modelcontextprotocol/sdk/server/index.js')
      const { StdioServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/stdio.js'
      )

      this.server = new McpServer({
        name: 'blaxel-sandbox',
        version: '1.0.0',
      } as any as any)

      this.registerTools()

      const transport = new StdioServerTransport()
      await this.server.connect(transport)

      this.connected = true
      console.error('[BlaxelMCP] Server running on stdio')
      console.error('[BlaxelMCP] Available tools:')
      console.error('[BlaxelMCP]   - execute_command')
      console.error('[BlaxelMCP]   - write_file')
      console.error('[BlaxelMCP]   - read_file')
      console.error('[BlaxelMCP]   - list_directory')
      console.error('[BlaxelMCP]   - get_sandbox_info')
      if (this.sandboxHandle.runBatchJob) {
        console.error('[BlaxelMCP]   - run_batch_job')
      }
      if (this.sandboxHandle.executeAsync) {
        console.error('[BlaxelMCP]   - execute_async')
      }
    } catch (error: any) {
      console.error('[BlaxelMCP] Failed to start server:', error.message)
      console.error('[BlaxelMCP] Install MCP SDK: npm install @modelcontextprotocol/sdk')
      throw error
    }
  }

  /**
   * Deploy as HTTP MCP server
   * 
   * Runs MCP server over HTTP transport for remote access.
   * 
   * @param port - Port to listen on (default: 3000)
   * @returns HTTP endpoint URL
   * 
   * @example
   * ```typescript
   * const url = await mcpServer.deployHttpMcp(3000)
   * // Connect with: http://localhost:3000/mcp
   * ```
   */
  async deployHttpMcp(port: number = 3000): Promise<string> {
    try {
      const { Server: McpServer } = await import('@modelcontextprotocol/sdk/server/index.js')
      const { StreamableHTTPServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/streamableHttp.js'
      )

      this.server = new McpServer({
        name: 'blaxel-sandbox',
        version: '1.0.0',
      } as any as any)

      this.registerTools()

      const transport = new StreamableHTTPServerTransport({
        port: port as unknown as number,
        endpoint: '/mcp',
      } as any)

      await this.server.connect(transport)

      this.connected = true
      const url = `http://localhost:${port}/mcp`
      console.error(`[BlaxelMCP] HTTP server running on ${url}`)

      return url
    } catch (error: any) {
      console.error('[BlaxelMCP] Failed to start HTTP server:', error.message)
      throw error
    }
  }

  /**
   * Check if server is connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Close MCP server
   */
  async close(): Promise<void> {
    if (this.server && this.connected) {
      await this.server.close()
      this.connected = false
      console.error('[BlaxelMCP] Server closed')
    }
  }
}

/**
 * Quick helper to create and start MCP server
 * 
 * @example
 * ```typescript
 * const handle = await blaxelProvider.createSandbox({})
 * await createBlaxelMcpServer(handle)
 * ```
 */
export async function createBlaxelMcpServer(
  sandboxHandle: SandboxHandle,
  httpPort?: number
): Promise<BlaxelMcpServer> {
  const mcpServer = new BlaxelMcpServer(sandboxHandle)

  if (httpPort) {
    await mcpServer.deployHttpMcp(httpPort)
  } else {
    await mcpServer.start()
  }

  return mcpServer
}
