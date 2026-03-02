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
  MCSPerverPresets,
  callMCPTool,
  getMCPTools,
  getMCPServerStatuses,
  isMCPAvailable,
  getMCPToolCount,
} from './config'

// Environment Loader
export { loadMCPEnv } from './load-env'

// Smithery Integration
export { 
  SmitheryRegistry, 
  SmitheryClient,
  smitheryRegistry,
  createSmitheryRegistry,
  createSmitheryClient,
} from './smithery-registry'

// Smithery Service (separate from registry)
export { 
  SmitheryService,
  SmitheryServer as SmitheryServerInfo,
  SmitheryConnection as SmitheryConnectionInfo,
  SmitheryToken,
} from './smithery-service'
