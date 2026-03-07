/**
 * Mistral Agent Provider Types
 *
 * Type definitions for the Mistral Agent SDK sandbox provider implementation.
 */

import type {
  SandboxCreateConfig,
  SandboxHandle,
  PtyConnectOptions,
} from '../sandbox-provider'

// ============================================================================
// Provider Configuration
// ============================================================================

export interface MistralProviderConfig {
  /** Mistral API key */
  apiKey: string
  /** Mistral API server URL */
  serverURL: string
  /** Default model for agent tasks */
  model: string
  /** Model for code interpretation */
  codeInterpreterModel: string
  /** Temperature for agent responses (0.0 - 1.0) */
  defaultTemperature: number
  /** Top P for sampling (0.0 - 1.0) */
  defaultTopP: number
  /** Maximum retry attempts */
  maxRetries: number
  /** Request timeout in milliseconds */
  timeout: number
  /** Enable streaming responses */
  enableStreaming: boolean
  /** Enable quota tracking */
  enableQuotaTracking: boolean
  /** Enable web search tool */
  enableWebSearch?: boolean
}

// ============================================================================
// Agent Types (from Mistral API)
// ============================================================================

export interface MistralAgent {
  /** Agent ID */
  id: string
  /** Model used by the agent */
  model: string
  /** Agent name */
  name: string
  /** Agent description */
  description: string
  /** System instructions */
  instructions?: string
  /** Available tools */
  tools: ToolDefinition[]
  /** Completion arguments */
  completionArgs?: CompletionArgs
  /** Agent version */
  version: number
  /** Creation timestamp */
  createdAt: string
  /** Last update timestamp */
  updatedAt: string
  /** Object type */
  object: 'agent'
}

export interface ToolDefinition {
  /** Tool type */
  type: ToolType
  /** Function definition (for function tools) */
  function?: FunctionDefinition
}

export type ToolType = 
  | 'code_interpreter'
  | 'web_search'
  | 'web_search_premium'
  | 'image_generation'
  | 'document_library'
  | 'function'

export interface FunctionDefinition {
  /** Function name */
  name: string
  /** Function description */
  description?: string
  /** JSON schema for parameters */
  parameters: Record<string, any>
}

export interface CompletionArgs {
  /** Sampling temperature */
  temperature?: number
  /** Top P sampling */
  topP?: number
  /** Maximum tokens */
  maxTokens?: number
  /** Random seed */
  randomSeed?: number
  /** Stop sequences */
  stop?: string[]
  /** Response format */
  responseFormat?: ResponseFormat
  /** Tool choice */
  toolChoice?: 'auto' | 'none' | 'required'
}

export interface ResponseFormat {
  /** Format type */
  type: 'text' | 'json_object' | 'json_schema'
  /** JSON schema (for json_schema type) */
  jsonSchema?: Record<string, any>
}

// ============================================================================
// Conversation Types
// ============================================================================

export interface Conversation {
  /** Conversation ID */
  conversationId: string
  /** Conversation outputs */
  outputs: ConversationEntry[]
  /** Token usage */
  usage?: TokenUsage
  /** Creation timestamp */
  createdAt: Date
}

export interface ConversationEntry {
  /** Entry role */
  role?: 'user' | 'assistant' | 'system'
  /** Entry content */
  content: string | ContentChunk[]
  /** Entry object type */
  object: 'entry'
  /** Entry type */
  type: EntryType
  /** Creation timestamp */
  createdAt?: string
  /** Completion timestamp */
  completedAt?: string
  /** Entry ID */
  id?: string
  /** Agent ID (for assistant messages) */
  agentId?: string
  /** Model used (for assistant messages) */
  model?: string
}

export type EntryType = 
  | 'message.input'
  | 'message.output'
  | 'tool.execution'
  | 'tool.result'

export type ContentChunk = TextChunk | ToolFileChunk | ImageChunk

export interface TextChunk {
  /** Chunk type */
  type: 'text'
  /** Text content */
  text: string
}

export interface ToolFileChunk {
  /** Chunk type */
  type: 'tool_file'
  /** Tool name */
  tool: string
  /** File ID */
  file_id: string
  /** File name */
  file_name: string
  /** File type (mime type) */
  file_type: string
}

export interface ImageChunk {
  /** Chunk type */
  type: 'image_url'
  /** Image URL */
  image_url: {
    url: string
  }
}

export interface TokenUsage {
  /** Prompt tokens */
  prompt_tokens: number
  /** Completion tokens */
  completion_tokens: number
  /** Total tokens */
  total_tokens: number
  /** Connector tokens */
  connector_tokens?: number | null
  /** Connector breakdown */
  connectors?: Record<string, number> | null
}

// ============================================================================
// Session Management
// ============================================================================

export interface MistralSession {
  /** Sandbox ID */
  sandboxId: string
  /** Agent ID */
  agentId?: string
  /** Conversation ID */
  conversationId?: string
  /** Model used */
  model?: string
  /** Creation timestamp */
  createdAt: number
  /** Last active timestamp */
  lastActive: number
  /** Sandbox configuration */
  config: SandboxCreateConfig
  /** Workspace directory */
  workspaceDir: string
  /** Virtual filesystem state */
  filesystemState?: VirtualFileSystemState
}

export interface VirtualFileSystemState {
  /** Files in workspace */
  files: Array<{
    path: string
    size: number
    modifiedAt: number
  }>
  /** Directories in workspace */
  directories: Array<{
    path: string
    entries: string[]
  }>
}

// ============================================================================
// Code Execution
// ============================================================================

export interface CodeExecutionRequest {
  /** Code to execute */
  code: string
  /** Programming language */
  language: CodeLanguage
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Execution timeout in milliseconds */
  timeout?: number
  /** Require JSON output */
  requireJsonOutput?: boolean
  /** Conversation ID (for stateful execution) */
  conversationId?: string
  /** Stop on first failure (for batch) */
  stopOnFailure?: boolean
}

export type CodeLanguage = 
  | 'python'
  | 'python3'
  | 'javascript'
  | 'typescript'
  | 'bash'
  | 'shell'

export interface CodeExecutionResult extends ToolResult {
  /** Execution metadata */
  metadata?: {
    /** Execution time in milliseconds */
    executionTime?: number
    /** Token usage */
    tokenUsage?: TokenUsage
    /** Code that was executed */
    executedCode?: string
    /** Language used */
    language?: string
  }
  /** Validation errors (if any) */
  validationErrors?: string[]
}

export interface ExecutionEnvironment {
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
}

// ============================================================================
// Streaming
// ============================================================================

export interface StreamChunk {
  /** Chunk type */
  type: string
  /** Chunk content */
  content: string
  /** Timestamp */
  timestamp: Date
  /** Additional metadata */
  metadata?: {
    conversationId?: string
    entryId?: string
    [key: string]: any
  }
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
  /** Agent name */
  name: string
  /** Agent description */
  description: string
  /** Model to use */
  model?: string
  /** System instructions */
  instructions?: string
  /** Tools to enable */
  tools?: ToolType[]
  /** Completion arguments */
  completionArgs?: CompletionArgs
}

export interface AgentUpdate {
  /** New description */
  description?: string
  /** New instructions */
  instructions?: string
  /** New tools */
  tools?: ToolType[]
  /** New completion arguments */
  completionArgs?: CompletionArgs
}

// ============================================================================
// Error Handling
// ============================================================================

export enum MistralErrorType {
  /** API rate limit exceeded */
  RATE_LIMIT = 'RATE_LIMIT',
  /** Request timeout */
  TIMEOUT = 'TIMEOUT',
  /** Authentication failure */
  AUTH_FAILURE = 'AUTH_FAILURE',
  /** Quota exceeded */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  /** Validation error */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Code execution error */
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  /** Network error */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

export interface RetryConfig {
  /** Maximum retry attempts */
  maxRetries: number
  /** Request timeout in milliseconds */
  timeout: number
  /** Backoff multiplier */
  backoffMultiplier?: number
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs?: number
}

// ============================================================================
// Quota Management
// ============================================================================

export interface QuotaUsage {
  /** Current month usage count */
  currentUsage: number
  /** Monthly quota limit */
  quota: number
  /** Remaining quota */
  remaining: number
  /** Quota reset date */
  resetDate: Date
}

export interface UsageRecord {
  /** Record timestamp */
  timestamp: number
  /** Sandbox ID */
  sandboxId: string
  /** Conversation ID */
  conversationId?: string
  /** Execution count */
  executionCount: number
  /** Token usage breakdown */
  tokenUsage?: {
    prompt: number
    completion: number
    total: number
  }
}

// ============================================================================
// Agent Sandbox Handle
// ============================================================================

export interface AgentSandboxHandle {
  /** Sandbox ID */
  readonly id: string
  /** Workspace directory */
  readonly workspaceDir: string
  /** Agent ID */
  readonly agentId?: string
  /** Conversation ID */
  readonly conversationId?: string

  // Standard sandbox methods (from SandboxHandle)
  executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult>
  writeFile(filePath: string, content: string): Promise<ToolResult>
  readFile(filePath: string): Promise<ToolResult>
  listDirectory(dirPath: string): Promise<ToolResult>

  // Agent-specific methods
  executeCode(code: string, options?: ExecutionEnvironment): Promise<CodeExecutionResult>
  streamCodeExecution(code: string): AsyncIterable<StreamChunk>
  getConversationHistory(): Promise<ConversationEntry[]>
  clearConversation(): Promise<void>
}

// ============================================================================
// Additional Missing Types
// ============================================================================

/**
 * Workspace state for Mistral agent sessions
 */
export interface WorkspaceState {
  /** Workspace ID */
  id: string
  /** Workspace files */
  files: Record<string, string>
  /** Last modified timestamp */
  lastModified: number
}

/**
 * Code execution result from Mistral code interpreter
 */
export interface CodeExecutionResult {
  /** Whether execution was successful */
  success: boolean
  /** Execution output */
  output?: string
  /** Error message if failed */
  error?: string
  /** Exit code */
  exitCode?: number
  /** Execution time in milliseconds */
  executionTime?: number
  /** Token usage */
  tokenUsage?: TokenUsage
}

/**
 * Stream chunk for code execution streaming
 */
export interface StreamChunk {
  /** Chunk type */
  type: 'stdout' | 'stderr' | 'error' | 'done'
  /** Chunk content */
  content?: string
  /** Error if type is 'error' */
  error?: string
}

/**
 * Execution environment configuration
 */
export interface ExecutionEnvironment {
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Execution timeout */
  timeout?: number
  /** Language for execution */
  language?: 'python' | 'javascript' | 'typescript' | 'bash'
}

/**
 * Tool execution result
 */
export interface ToolResult {
  /** Whether tool execution was successful */
  success: boolean
  /** Tool output */
  output?: string
  /** Error message if failed */
  error?: string
  /** Tool name */
  toolName?: string
  /** Execution time in milliseconds */
  executionTime?: number
}
