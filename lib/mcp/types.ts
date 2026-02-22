/**
 * MCP (Model Context Protocol) Types and Interfaces
 * 
 * Based on the official MCP specification:
 * @see https://modelcontextprotocol.io/specification
 */

/**
 * MCP Protocol Version
 */
export const MCP_PROTOCOL_VERSION = '2024-11-05'

/**
 * MCP Role types
 */
export type MCPRole = 'user' | 'assistant' | 'tool'

/**
 * MCP Content types
 */
export type MCPContentType = 'text' | 'image' | 'resource' | 'prompt'

/**
 * MCP Message structure
 */
export interface MCPMessage {
  role: MCPRole
  content: MCPContent
}

/**
 * MCP Content union type
 */
export type MCPContent = 
  | MCPTextContent
  | MCPImageContent
  | MCPResourceContent
  | MCPPromptContent

/**
 * Text content
 */
export interface MCPTextContent {
  type: 'text'
  text: string
}

/**
 * Image content (base64 encoded)
 */
export interface MCPImageContent {
  type: 'image'
  data: string
  mimeType: string
}

/**
 * Resource content (text or blob)
 * Per MCP spec: resources/read returns direct content objects, not wrapped
 */
export interface MCPResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

/**
 * Prompt content
 */
export interface MCPPromptContent {
  type: 'prompt'
  name: string
  arguments?: Record<string, string>
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, any>
    required?: string[]
  }
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

/**
 * MCP Tool Call
 */
export interface MCPToolCall {
  id: string
  name: string
  arguments?: Record<string, any>
}

/**
 * MCP Tool Result
 */
export interface MCPToolResult {
  toolCallId: string
  content: MCPContent[]
  isError?: boolean
}

/**
 * MCP Prompt definition
 */
export interface MCPPrompt {
  name: string
  description?: string
  arguments?: MCPPromptArgument[]
}

/**
 * MCP Prompt Argument
 */
export interface MCPPromptArgument {
  name: string
  description?: string
  required?: boolean
}

/**
 * MCP Server Info
 */
export interface MCPServerInfo {
  name: string
  version: string
  protocolVersion: typeof MCP_PROTOCOL_VERSION
  capabilities: MCPCapabilities
}

/**
 * MCP Server Capabilities
 */
export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean
  }
  resources?: {
    subscribe?: boolean
    listChanged?: boolean
  }
  prompts?: {
    listChanged?: boolean
  }
  logging?: boolean
}

/**
 * MCP Transport types
 */
export type MCPTransportType = 'stdio' | 'sse' | 'websocket'

/**
 * MCP Transport configuration
 */
export interface MCPTransportConfig {
  type: MCPTransportType
  
  // For stdio transport
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  
  // For SSE transport
  url?: string
  
  // For websocket transport
  wsUrl?: string
}

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  id: string
  name: string
  transport: MCPTransportConfig
  enabled?: boolean
  timeout?: number
  trust?: boolean
}

/**
 * MCP Connection state
 */
export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * MCP Connection info
 */
export interface MCPConnectionInfo {
  state: MCPConnectionState
  server: MCPServerInfo | null
  error?: string
  lastError?: Date
  connectedAt?: Date
}

/**
 * MCP Request options
 */
export interface MCPRequestOptions {
  timeout?: number
  signal?: AbortSignal
}

/**
 * MCP List Tools response
 */
export interface MCPListToolsResponse {
  tools: MCPTool[]
}

/**
 * MCP Call Tool request
 */
export interface MCPCallToolRequest {
  name: string
  arguments?: Record<string, any>
}

/**
 * MCP List Resources response
 */
export interface MCPListResourcesResponse {
  resources: MCPResource[]
}

/**
 * MCP Read Resource request
 */
export interface MCPReadResourceRequest {
  uri: string
}

/**
 * MCP Read Resource response
 */
export interface MCPReadResourceResponse {
  contents: MCPResourceContent[]
}

/**
 * MCP List Prompts response
 */
export interface MCPListPromptsResponse {
  prompts: MCPPrompt[]
}

/**
 * MCP Get Prompt request
 */
export interface MCPGetPromptRequest {
  name: string
  arguments?: Record<string, string>
}

/**
 * MCP Get Prompt response
 */
export interface MCPGetPromptResponse {
  description?: string
  messages: MCPMessage[]
}

/**
 * MCP Log Level
 */
export type MCPLogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency'

/**
 * MCP Log Message
 */
export interface MCPLogMessage {
  level: MCPLogLevel
  logger?: string
  data: any
  timestamp?: Date
}

/**
 * MCP Progress notification
 */
export interface MCPProgress {
  progress: number
  total: number
  message?: string
}

/**
 * MCP Root definition (for file system access)
 */
export interface MCPRoot {
  uri: string
  name: string
}

/**
 * MCP Sampling request (for LLM calls from server)
 */
export interface MCPSamplingRequest {
  messages: MCPMessage[]
  modelPreferences?: {
    hints?: Array<{ name: string }>
    costPriority?: number
    speedPriority?: number
    intelligencePriority?: number
  }
  systemPrompt?: string
  includeContext?: 'none' | 'thisServer' | 'allServers'
  temperature?: number
  maxTokens: number
  stopSequences?: string[]
  metadata?: Record<string, any>
}

/**
 * MCP Sampling response
 */
export interface MCPSamplingResponse {
  role: MCPRole
  content: MCPContent
  model: string
  stopReason?: 'endTurn' | 'stopSequence' | 'maxTokens' | 'error'
}

/**
 * MCP Handler function type
 */
export type MCPHandler<T = any> = (request: T) => Promise<any>

/**
 * MCP Middleware function
 */
export type MCPMiddleware = (
  request: any,
  next: () => Promise<any>
) => Promise<any>

/**
 * MCP Event types
 */
export type MCPEventType =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'tool_registered'
  | 'tool_unregistered'
  | 'resource_registered'
  | 'prompt_registered'
  | 'log'
  | 'progress'

/**
 * MCP Event
 */
export interface MCPEvent {
  type: MCPEventType
  data?: any
  timestamp: Date
}

/**
 * MCP Event Listener
 */
export type MCPEventListener = (event: MCPEvent) => void
