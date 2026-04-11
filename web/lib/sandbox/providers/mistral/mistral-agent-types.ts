// Stub types for Mistral Agent provider
export interface MistralSession {
  sessionId: string;
  userId: string;
  createdAt: number;
}

export interface AgentConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AgentUpdate {
  sessionId: string;
  content?: string;
  status?: string;
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
