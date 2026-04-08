import type { ToolResult } from '../types'

export interface LLMProvider {
  readonly name: string

  runAgentLoop(options: LLMAgentOptions): Promise<LLMAgentResult>
}

export interface LLMAgentOptions {
  userMessage: string
  conversationHistory?: any[]
  tools: LLMToolDefinition[]
  systemPrompt: string
  maxSteps?: number
  executeTool: (name: string, args: Record<string, any>) => Promise<ToolResult>
  onToolExecution?: (toolName: string, args: Record<string, any>, result: ToolResult) => void
  onStreamChunk?: (chunk: string) => void
  /** Working directory for shell commands (overrides session default) */
  cwd?: string
  /** Enable self-healing retry on command failure (default: true) */
  enableSelfHeal?: boolean
}

export interface LLMAgentResult {
  response: string
  steps: LLMAgentStep[]
  totalSteps: number
}

export interface LLMAgentStep {
  toolName: string
  args: Record<string, any>
  result: ToolResult
}

export interface LLMToolDefinition {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, any>
    required: readonly string[]
  }
}
