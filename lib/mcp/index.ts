/**
 * MCP (Model Context Protocol) Module
 *
 * Provides integration with MCP servers for tools, resources, and prompts
 *
 * Architecture Support:
 * - Architecture 1: Main LLM (AI SDK) - Direct MCP tool integration
 * - Architecture 2: OpenCode CLI Agent - HTTP-based MCP tool access
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
  loadMCPConfigFromJSON,
  getMCPSettings,
} from './config'

// Architecture Integration (NEW)
export {
  initializeMCPForArchitecture1,
  getMCPToolsForAI_SDK,
  callMCPToolFromAI_SDK,
  initializeMCPForArchitecture2,
  getMCPServerURL,
  generateOpenCodeCLIConfig,
  shutdownMCPConnections,
  checkMCPHealth,
  handleMCPHealthCheck,
} from './architecture-integration'

// CLI Server (NEW)
export {
  createMCPServerForCLI,
  shutdownMCPServer,
} from './mcp-cli-server'

export {
  mcporterIntegration,
  getMCPorterToolDefinitions,
  callMCPorterTool,
} from './mcporter-integration'

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
  getSmitheryService,
} from './smithery-service'

export type {
  SmitheryServiceServer,
  SmitheryServiceConnection,
  SmitheryToken,
} from './smithery-service'

export {
  SmitheryServerSchema,
  SmitheryConnectionSchema,
} from './smithery-service'
