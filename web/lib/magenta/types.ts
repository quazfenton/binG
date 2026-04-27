/**
 * Agent Types
 * 
 * Basic type definitions for agent modules.
 * Placeholder - actual implementations may be elsewhere.
 */

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: AgentContext) => Promise<ToolResult>;
}

export interface AgentContext {
  userId?: string;
  sessionId?: string;
  cwd?: string;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}