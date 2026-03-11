/**
 * MCP Integration for Both Architectures
 * 
 * Architecture 1: Main LLM Call Implementation (AI SDK)
 * Architecture 2: OpenCode CLI Agent (Containerized)
 * 
 * This module provides unified MCP tool access for both architectures
 */

import { mcpToolRegistry } from './tool-registry'
import { parseMCPServerConfigs, initializeMCP, shutdownMCP, getMCPSettings, isMCPAvailable, getMCPToolCount } from './config'
import { callMCPorterTool, getMCPorterToolDefinitions, mcporterIntegration } from './mcporter-integration'
import { createLogger } from '../utils/logger'
import { BlaxelProvider } from '../sandbox/providers/blaxel-provider'
import { ArcadeService, getArcadeService } from '../api/arcade-service'
import { nullclawMCPBridge } from './nullclaw-mcp-bridge'

// Blaxel codegen tool definitions for LLM tool calling
const getBlaxelCodegenToolDefinitions = (): Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}> => [
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenCodebaseSearch',
      description: 'Semantic search to find relevant code snippets in a repository',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query string' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              limit: { type: 'number' },
              fileTypes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenFileSearch',
      description: 'Fast fuzzy file path search',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'File path pattern (supports glob)' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenGrepSearch',
      description: 'Exact regex search using ripgrep engine',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              path: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenListDir',
      description: 'List directory contents (quick discovery)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              includePatterns: { type: 'array', items: { type: 'string' } },
              excludePatterns: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenReadFileRange',
      description: 'Read file contents within a specific line range (max 250 lines)',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to file' },
          startLine: { type: 'number', description: 'Start line number' },
          endLine: { type: 'number', description: 'End line number' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
            },
          },
        },
        required: ['filePath', 'startLine', 'endLine'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenRerank',
      description: 'Performs semantic search/reranking on code files in a directory',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          directory: { type: 'string', description: 'Directory to search in' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        required: ['query', 'directory'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenParallelApply',
      description: 'Plan parallel edits across multiple file locations',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                filePath: { type: 'string' },
                startLine: { type: 'number' },
                endLine: { type: 'number' },
                newContent: { type: 'string' },
              },
              required: ['filePath', 'startLine', 'endLine', 'newContent'],
            },
            description: 'Array of edits to apply',
          },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              dryRun: { type: 'boolean' },
            },
          },
        },
        required: ['edits'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenReapply',
      description: 'Use smarter model to retry a failed edit',
      parameters: {
        type: 'object',
        properties: {
          editId: { type: 'string', description: 'ID of the failed edit to reapply' },
          options: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              maxRetries: { type: 'number' },
            },
          },
        },
        required: ['editId'],
      },
    },
  },
]

const logger = createLogger('MCP:Integration')

let cachedMCPorterTools: Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}> = []

async function refreshMCPorterToolsCache(): Promise<void> {
  if (!mcporterIntegration.isEnabled()) {
    cachedMCPorterTools = []
    return
  }

  try {
    cachedMCPorterTools = await getMCPorterToolDefinitions()
  } catch (error: any) {
    logger.warn(`Failed to refresh mcporter tools: ${error?.message || 'unknown error'}`)
  }
}

/**
 * Initialize MCP for Architecture 1 (Main LLM - AI SDK)
 * 
 * Call this during app initialization to make MCP tools available
 * to the main LLM call implementation
 */
export async function initializeMCPForArchitecture1(): Promise<void> {
  try {
    logger.info('Initializing MCP for Architecture 1 (AI SDK)...')
    
    const configs = parseMCPServerConfigs()
    
    if (configs.length === 0) {
      logger.info('No MCP servers configured. Set MCP_ENABLED=true or create mcp.config.json')
      return
    }

    for (const config of configs) {
      mcpToolRegistry.registerServer(config)
    }

    logger.info(`Connecting to ${configs.length} MCP server(s)...`)
    await mcpToolRegistry.connectAll()
    
    await refreshMCPorterToolsCache()

    const toolCount = getMCPToolCount()
    const mcporterTools = cachedMCPorterTools.length
    logger.info(`MCP initialized with ${toolCount} native tools and ${mcporterTools} mcporter tools available`)
    
  } catch (error) {
    logger.error('Failed to initialize MCP for Architecture 1', error as Error)
    throw error
  }
}

/**
 * Get MCP tools in AI SDK format for Architecture 1
 *
 * Use this in your chat/agent implementation to get MCP tools
 * in the format expected by AI SDK's tool calling
 */
export async function getMCPToolsForAI_SDK() {
  if (mcporterIntegration.isEnabled()) {
    await refreshMCPorterToolsCache()
  }

  const nativeTools = isMCPAvailable() ? mcpToolRegistry.getToolDefinitions() : []

  // Conditionally include Blaxel codegen tools when API key is available
  const blaxelTools: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: any
    }
  }> = process.env.BLAXEL_API_KEY ? getBlaxelCodegenToolDefinitions() : []

  // Conditionally include Arcade tools when API key is available
  const arcadeTools: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: any
    }
  }> = process.env.ARCADE_API_KEY ? await getArcadeToolDefinitions() : []

  // NEW: Include provider-specific advanced tools (E2B, Daytona, CodeSandbox, Sprites)
  const { getAllProviderAdvancedTools } = await import('./provider-advanced-tools')
  const providerTools = getAllProviderAdvancedTools()

  // NEW: Include Nullclaw tools when enabled
  const nullclawTools: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: any
    }
  }> = process.env.NULLCLAW_ENABLED === 'true' ? nullclawMCPBridge.getToolDefinitions() : []

  const tools = [...nativeTools, ...cachedMCPorterTools, ...blaxelTools, ...arcadeTools, ...providerTools, ...nullclawTools]

  if (tools.length === 0) {
    logger.debug('MCP not available - no tools to return')
    return []
  }

  logger.debug(`Returning ${tools.length} MCP tools for AI SDK (${blaxelTools.length} Blaxel, ${arcadeTools.length} Arcade, ${providerTools.length} provider-specific)`)
  return tools
}

// Cached Blaxel provider instance for tool execution
let cachedBlaxelProvider: BlaxelProvider | null = null

// Cached Arcade service instance
let cachedArcadeService: ArcadeService | null = null

function getBlaxelProviderInstance(): BlaxelProvider {
  if (!cachedBlaxelProvider) {
    cachedBlaxelProvider = new BlaxelProvider()
  }
  return cachedBlaxelProvider
}

function getArcadeServiceInstance(): ArcadeService | null {
  if (!cachedArcadeService) {
    cachedArcadeService = getArcadeService()
  }
  return cachedArcadeService
}

// Sanitize tool name: replace dots and invalid chars with underscores
const sanitizeToolName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

// Get Arcade tool definitions for LLM tool calling
async function getArcadeToolDefinitions(): Promise<Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}>> {
  const arcade = getArcadeServiceInstance()
  if (!arcade) {
    return []
  }

  try {
    // Get all available tools from Arcade
    const tools = await arcade.getTools({ limit: 100 })

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: `arcade_${sanitizeToolName(tool.name)}`,
        description: tool.description,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: {},
        },
      },
    }))
  } catch (error: any) {
    logger.warn(`Failed to get Arcade tools: ${error.message}`)
    return []
  }
}

/**
 * Execute a Blaxel codegen tool
 */
async function executeBlaxelCodegenTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const blaxel = getBlaxelProviderInstance()

    // Map tool name to method
    const methodName = toolName.replace(/^blaxel_/, '')
    const method = (blaxel as any)[methodName]

    if (!method || typeof method !== 'function') {
      return {
        success: false,
        output: '',
        error: `Blaxel tool method not found: ${methodName}`,
      }
    }

    // Extract parameters based on tool
    let result: any
    switch (methodName) {
      case 'codegenCodebaseSearch':
        result = await blaxel.codegenCodebaseSearch(args.query, args.options)
        break
      case 'codegenFileSearch':
        result = await blaxel.codegenFileSearch(args.pattern, args.options)
        break
      case 'codegenGrepSearch':
        result = await blaxel.codegenGrepSearch(args.pattern, args.options)
        break
      case 'codegenListDir':
        result = await blaxel.codegenListDir(args.path, args.options)
        break
      case 'codegenReadFileRange':
        result = await blaxel.codegenReadFileRange(args.filePath, args.startLine, args.endLine, args.options)
        break
      case 'codegenRerank':
        result = await blaxel.codegenRerank(args.query, args.directory, args.options)
        break
      case 'codegenParallelApply':
        result = await blaxel.codegenParallelApply(args.edits, args.options)
        break
      case 'codegenReapply':
        result = await blaxel.codegenReapply(args.editId, args.options)
        break
      default:
        return {
          success: false,
          output: '',
          error: `Unknown Blaxel tool: ${methodName}`,
        }
    }

    return {
      success: true,
      output: JSON.stringify(result),
    }
  } catch (error: any) {
    logger.error(`Blaxel codegen tool failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Blaxel tool execution failed',
    }
  }
}

/**
 * Execute a provider-specific advanced tool (E2B, Daytona, CodeSandbox, Sprites)
 */
async function executeProviderAdvancedTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { callProviderTool } = await import('./provider-advanced-tools')
    const result = await callProviderTool(toolName, args)

    return {
      success: result.success,
      output: result.output,
      error: result.error,
    }
  } catch (error: any) {
    logger.error(`Provider advanced tool failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Provider tool execution failed',
    }
  }
}

/**
 * Execute an Arcade tool
 */
async function executeArcadeTool(
  toolName: string,
  args: Record<string, any>,
  userId: string  // Required, no default
): Promise<{ success: boolean; output: string; error?: string }> {
  // Validate userId is a real user ID, not default/fake
  if (!userId || userId === 'default' || userId.length < 10) {
    logger.warn(`Invalid userId for Arcade tool: ${userId}`)
    return {
      success: false,
      output: '',
      error: 'Invalid or missing user authentication',
    }
  }

  const arcade = getArcadeServiceInstance()
  if (!arcade) {
    return {
      success: false,
      output: '',
      error: 'Arcade service not available',
    }
  }

  try {
    // Remove 'arcade_' prefix to get actual tool name
    const actualToolName = toolName.replace(/^arcade_/, '')
    const result = await arcade.executeTool(actualToolName, args, userId)

    if (result.requiresAuth && result.authUrl) {
      return {
        success: false,
        output: '',
        error: `Authorization required. Please visit: ${result.authUrl}`,
      }
    }

    if (!result.success) {
      return {
        success: false,
        output: '',
        error: result.error || 'Arcade tool execution failed',
      }
    }

    return {
      success: true,
      output: JSON.stringify(result.output),
    }
  } catch (error: any) {
    logger.error(`Arcade tool failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Arcade tool execution failed',
    }
  }
}

/**
 * Call MCP tool from Architecture 1 (AI SDK)
 *
 * Use this when the LLM requests a tool call
 */
export async function callMCPToolFromAI_SDK(
  toolName: string,
  args: Record<string, any>,
  userId: string  // Required for Arcade tools
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    logger.debug(`Calling MCP tool: ${toolName}`, { args })

    // Check if it's a Blaxel codegen tool
    if (toolName.startsWith('blaxel_') && process.env.BLAXEL_API_KEY) {
      return executeBlaxelCodegenTool(toolName, args)
    }

    // Check if it's an Arcade tool
    if (toolName.startsWith('arcade_') && process.env.ARCADE_API_KEY) {
      return executeArcadeTool(toolName, args, userId)
    }

    // NEW: Check if it's a provider-specific advanced tool
    if (
      toolName.startsWith('e2b_') ||
      toolName.startsWith('daytona_') ||
      toolName.startsWith('codesandbox_') ||
      toolName.startsWith('sprites_')
    ) {
      return executeProviderAdvancedTool(toolName, args)
    }

    // NEW: Check if it's a Nullclaw tool
    if (toolName.startsWith('nullclaw_') && process.env.NULLCLAW_ENABLED === 'true') {
      return nullclawMCPBridge.executeTool(toolName, args, userId)
    }

    const nativeResult = await mcpToolRegistry.callTool(toolName, args)
    if (nativeResult.success || !nativeResult.isError || !nativeResult.content.includes('Tool not found')) {
      logger.debug(`MCP tool result: ${toolName}`, {
        success: nativeResult.success,
        duration: nativeResult.duration,
      })

      return {
        success: nativeResult.success,
        output: nativeResult.content,
        error: nativeResult.isError ? nativeResult.content : undefined,
      }
    }

    const mcporterResult = await callMCPorterTool(toolName, args)
    logger.debug(`mcporter tool result: ${toolName}`, { success: mcporterResult.success })
    return mcporterResult
  } catch (error: any) {
    logger.error(`MCP tool call failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Tool call failed',
    }
  }
}

/**
 * Initialize MCP for Architecture 2 (OpenCode CLI Agent)
 * 
 * For OpenCode CLI, we expose MCP tools via a local HTTP endpoint
 * that the CLI agent can call
 */
export async function initializeMCPForArchitecture2(port: number = 8888): Promise<void> {
  try {
    logger.info(`Initializing MCP for Architecture 2 (OpenCode CLI) on port ${port}...`)
    
    // Initialize MCP (same as Architecture 1)
    await initializeMCPForArchitecture1()
    
    // Start HTTP server for CLI agent to call
    const { createMCPServerForCLI } = await import('./mcp-cli-server')
    await createMCPServerForCLI(port)
    
    logger.info(`MCP HTTP server for CLI agent running on http://localhost:${port}`)
    
  } catch (error) {
    logger.error('Failed to initialize MCP for Architecture 2', error as Error)
    throw error
  }
}

/**
 * Get MCP server URL for Architecture 2
 * 
 * OpenCode CLI agent can use this URL to discover and call MCP tools
 */
export function getMCPServerURL(): string {
  const port = process.env.MCP_CLI_PORT || '8888'
  return `http://localhost:${port}`
}

/**
 * Generate OpenCode CLI configuration for MCP
 * 
 * This creates a config file that tells OpenCode CLI
 * where to find MCP tools
 */
export function generateOpenCodeCLIConfig(): string {
  const url = getMCPServerURL()
  
  return JSON.stringify({
    mcp: {
      enabled: true,
      serverUrl: url,
      autoDiscover: true,
      timeout: 60000,
    },
    tools: {
      preferMCP: true,
      fallback: 'builtin',
    },
  }, null, 2)
}

/**
 * Shutdown MCP connections
 * 
 * Call this on app shutdown to clean up MCP connections
 */
export async function shutdownMCPConnections(): Promise<void> {
  try {
    logger.info('Shutting down MCP connections...')
    await shutdownMCP()
    logger.info('MCP connections shut down successfully')
  } catch (error) {
    logger.error('Failed to shutdown MCP connections', error as Error)
  }
}

/**
 * Check MCP health and availability
 */
export function checkMCPHealth(): {
  available: boolean
  toolCount: number
  serverStatuses: Array<{ id: string; name: string; connected: boolean; info?: any }>
} {
  const available = isMCPAvailable()
  const toolCount = getMCPToolCount()
  const rawStatuses = mcpToolRegistry.getAllServerStatuses()
  
  const serverStatuses = rawStatuses.map(s => {
    const state = s.info?.state;
    const connected = state === 'connected' || state === 'connecting';
    return {
      id: s.id,
      name: s.name,
      connected,
      info: s.info,
    };
  })
  
  return {
    available,
    toolCount,
    serverStatuses,
  }
}

/**
 * MCP Health Endpoint Handler
 * 
 * Use this in your API route for health checks
 */
export async function handleMCPHealthCheck() {
  const health = checkMCPHealth()
  
  return {
    status: health.available ? 'healthy' : 'degraded',
    mcp: health,
    timestamp: new Date().toISOString(),
  }
}
