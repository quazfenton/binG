/**
 * MCP (Model Context Protocol) Module
 * 
 * Provides integration with MCP servers for tools, resources, and prompts
 * 
 * @module mcp
 */

// Load .env.mcp automatically
import './load-env'

// Types
export * from './types'

// Client
export { MCPClient } from './client'

// Tool Registry
export { 
  MCPToolRegistry, 
  mcpToolRegistry,
  type MCPRegistryEvent,
  type MCPRegistryEventType,
} from './tool-registry'

// Configuration
export {
  parseMCPServerConfigs,
  initializeMCP,
  shutdownMCP,
  createStdioTransport,
  createSSETransport,
  createWebSocketTransport,
  MCPServerPresets,
  callMCPTool,
  getMCPTools,
  getMCPServerStatuses,
  isMCPAvailable,
  getMCPToolCount,
} from './config'

// Environment Loader
export { loadMCPEnv } from './load-env'
