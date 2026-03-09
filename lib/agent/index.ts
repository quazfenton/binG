/**
 * Agent Module
 * 
 * Unified interface for AI agent interactions with:
 * - Terminal (WebSocket/SSE)
 * - Desktop (Computer Use)
 * - MCP Tools
 * - Code Execution
 * - Git Operations
 * 
 * @module agent
 */

// Core agent
export {
  UnifiedAgent,
  createAgent,
  createQuickAgent,
  type UnifiedAgentConfig,
  type AgentCapability,
  type AgentSession,
  type TerminalOutput,
  type CodeExecutionResult,
  type GitStatus,
} from './unified-agent'

// React hook
export {
  useAgent,
  useDesktopAgent,
  useTerminalAgent,
  type UseAgentOptions,
  type UseAgentReturn,
} from './use-agent'


