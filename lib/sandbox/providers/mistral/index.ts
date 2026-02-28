/**
 * Mistral Agent Provider Module
 * 
 * Comprehensive implementation of Mistral AI Agents API for sandbox code execution.
 * 
 * Features:
 * - Full Agent SDK integration (Agents API + Conversations API)
 * - Code interpreter tool with safety validation
 * - Web search integration for real-time information
 * - Virtual filesystem emulation
 * - Streaming support for real-time output
 * - Error handling with retry logic
 * - Quota management and usage tracking
 * - Connection pooling and response caching
 * - Batch processing for parallel code execution
 * - Multi-agent collaboration support
 * - Optimal prompt engineering
 * - Persistent workspaces
 * 
 * @module mistral
 */

// Main provider implementation
export { MistralAgentProvider } from './mistral-agent-provider'

// Supporting modules - Phase 2
export { MistralConversationManager, ConversationBuilder } from './mistral-conversation-manager'
export { MistralCodeExecutor } from './mistral-code-executor'
export { MistralVirtualFilesystem } from './mistral-file-system'
export { MistralStreamHandler, StreamAggregator, StreamTransformer } from './mistral-stream-handler'
export { 
  MistralErrorHandler, 
  MistralError, 
  MistralErrorType,
  ErrorRecoveryStrategies 
} from './mistral-error-handler'
export { MistralQuotaManager, UsageReporter } from './mistral-quota-manager'

// NEW: Batch processing for parallel code execution
export {
  MistralBatchProcessor,
  createBatchProcessor,
  type BatchJobConfig,
  type BatchJobResult,
  type BatchTaskResult,
  type BatchExecutionOptions,
} from './mistral-batch-processor'

// NEW: Multi-agent collaboration
export {
  MistralMultiAgentCollaboration,
  createMultiAgentCollaboration,
  createDefaultCollaboration,
  type AgentSpec,
  type MultiAgentTask,
  type CollaborationResult,
  type AgentMessage,
  type CollaborationConfig,
} from './mistral-multi-agent'

// Types - avoid duplicate exports
export type {
  // Provider configuration
  MistralProviderConfig,
  
  // Agent types
  MistralAgent,
  ToolDefinition,
  ToolType,
  FunctionDefinition,
  CompletionArgs,
  ResponseFormat,
  
  // Conversation types
  Conversation,
  ConversationEntry,
  EntryType,
  ContentChunk,
  TextChunk,
  ToolFileChunk,
  ImageChunk,
  TokenUsage,
  
  // Session management
  MistralSession,
  VirtualFileSystemState,
  
  // Code execution
  CodeExecutionRequest,
  CodeExecutionResult,
  CodeLanguage,
  ExecutionEnvironment,
  
  // Streaming
  StreamChunk,
  
  // Agent configuration
  AgentConfig,
  AgentUpdate,
  
  // Quota management
  QuotaUsage,
  UsageRecord,
  
  // Agent sandbox handle
  AgentSandboxHandle,
} from './mistral-types'

// Utils - Phase 3 complete
export { PromptBuilder, promptBuilder } from './utils/prompt-builder'
export { ResponseParser, responseParser } from './utils/response-parser'
export { CodeValidator, codeValidator } from './utils/code-validator'
