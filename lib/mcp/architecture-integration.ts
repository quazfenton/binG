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
import { createLogger } from '../utils/logger'

const logger = createLogger('MCP:Integration')

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
    
    const toolCount = getMCPToolCount()
    logger.info(`MCP initialized with ${toolCount} tools available`)
    
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
export function getMCPToolsForAI_SDK() {
  if (!isMCPAvailable()) {
    logger.debug('MCP not available - no tools to return')
    return []
  }

  const tools = mcpToolRegistry.getToolDefinitions()
  logger.debug(`Returning ${tools.length} MCP tools for AI SDK`)
  
  return tools
}

/**
 * Call MCP tool from Architecture 1 (AI SDK)
 * 
 * Use this when the LLM requests a tool call
 */
export async function callMCPToolFromAI_SDK(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    logger.debug(`Calling MCP tool: ${toolName}`, { args })
    
    const result = await mcpToolRegistry.callTool(toolName, args)
    
    logger.debug(`MCP tool result: ${toolName}`, { 
      success: result.success, 
      duration: result.duration 
    })

    return {
      success: result.success,
      output: result.content,
      error: result.isError ? result.content : undefined,
    }
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
  serverStatuses: Array<{ id: string; name: string; connected: boolean }>
} {
  const available = isMCPAvailable()
  const toolCount = getMCPToolCount()
  const serverStatuses = mcpToolRegistry.getAllServerStatuses()
  
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
