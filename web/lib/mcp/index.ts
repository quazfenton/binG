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
} from './registry'

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

// Architecture Integration (server-only)
// Re-exported here for server consumers (chat/route.ts, etc.)
// Client bundles should use dynamic imports to avoid pulling Node.js deps.
export {
  initializeMCPForArchitecture1,
  getMCPToolsForAI_SDK,
  callMCPToolFromAI_SDK,
  initializeMCPForArchitecture2,
  getMCPServerURL,
  generateOpenCodeCLIConfig,
  shutdownMCPConnections,
} from './architecture-integration'

// Desktop MCP Manager - server-only, import directly from './desktop-mcp-manager'
// Do NOT re-export here to avoid pulling Node.js deps into client bundles.

// HTTP Server (NEW)
export {
  createMCPServerForCLI,
  shutdownMCPServer,
} from './mcp-http-server'

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

// MCP Store & Discovery (NEW)
export {
  mcpStoreService,
  type MCPStoreService,
} from './mcp-store-service'

export type {
  MCPServerPackage,
  MCPApiKeyConfig,
  MCPStoreConfig,
  MCPStoreStats,
} from './mcp-store-service'

// VFS MCP Tools (NEW - Web MCP Server)
export {
  vfsTools,
  writeFileTool,
  applyDiffTool,
  readFileTool,
  listFilesTool,
  searchFilesTool,
  batchWriteTool,
  deleteFileTool,
  createDirectoryTool,
  getWorkspaceStatsTool,
  getVFSToolDefinitions,
  getVFSTool,
  setToolContext,
  toolContextStore,
  initializeVFSTools,
  type ToolContext,
} from './vfs-mcp-tools'

// HTTP Transport for Remote MCP
export {
  HTTPTransport,
  createHTTPTransport,
  createHTTPTransports,
  parseMCPURL,
  isValidMCPURL,
  type HTTPTransportConfig,
} from './http-transport'

// Health Check & Monitoring
export {
  checkMCPHealth,
  isMCPHealthy,
  getServerHealth,
  startHealthMonitoring,
  stopHealthMonitoring,
  handleMCPHealthCheck,
  type MCPServerHealth,
  type MCPHealthStatus,
} from './health-check'
