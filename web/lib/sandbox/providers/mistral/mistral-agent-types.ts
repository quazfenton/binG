// Types for Mistral Agent provider
export interface MistralSession {
  sessionId: string;
  userId: string;
  agentId?: string;
  model?: string;
  conversationId?: string;
  lastActive?: number;
  filesystemState?: any;
  createdAt: number;
}

export interface AgentConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  name?: string;
  description?: string;
  instructions?: string;
  tools?: any[];
  completionArgs?: Record<string, any>;
}

export interface AgentUpdate {
  sessionId: string;
  content?: string;
  status?: string;
  description?: string;
  instructions?: string;
  tools?: any[];
  completionArgs?: Record<string, any>;
}

export interface CodeExecutionRequest {
  sessionId: string;
  language: string;
  code: string;
  timeout?: number;
}

export interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  metadata?: Record<string, any>;
}

export interface ConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface WorkspaceState {
  sessionId: string;
  files?: string[];
  cwd?: string;
}

export interface MistralProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  serverURL?: string;
  model?: string;
  codeInterpreterModel?: string;
  timeout?: number;
  enableWebSearch?: boolean;
  enableStreaming?: boolean;
  defaultTemperature?: number;
  defaultTopP?: number;
  maxRetries?: number;
}

export interface MistralSessionCreate {
  userId: string;
  agentId?: string;
  model?: string;
  conversationId?: string;
  sandboxId?: string;
  config?: Partial<MistralProviderConfig>;
}

export interface MistralSession {
  sessionId: string;
  userId: string;
  agentId?: string;
  model?: string;
  conversationId?: string;
  lastActive?: number;
  filesystemState?: any;
  sandboxId?: string;
  workspaceDir?: string;
  config?: Partial<MistralProviderConfig>;
  createdAt: number;
}

export interface SandboxCreateConfig {
  userId?: string;
  sandboxId?: string;
  model?: string;
  config?: Partial<MistralProviderConfig>;
  [key: string]: any;
}
