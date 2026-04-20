/**
 * Pi Agent SDK - Core Types and Interfaces
 * 
 * Modular SDK for embedding Pi coding agent capabilities in binG.
 * Supports both Web (VFS) and Desktop (local FS) modes.
 */

import type { AgentMessage, ToolCall, ToolResult } from '@/lib/agent/types';

/** Mode of operation */
export type PiMode = 'vfs' | 'local' | 'mcp' | 'remote';

/** Run mode - CLI (subprocess) or Remote (HTTP) */
export type RunMode = 'cli' | 'remote';

/** Event types from the agent */
export type PiEvent = 
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: AgentMessage; toolResults: ToolResult[] }
  | { type: 'message_start'; message: AgentMessage }
  | { type: 'message_end'; message: AgentMessage }
  | { type: 'message_update'; message: AgentMessage; assistantMessageEvent: StreamingEvent }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult: ToolResult }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: ToolResult; isError: boolean }
  | { type: 'queue_update'; steering: string[]; followUp: string[] }
  | { type: 'compaction_start'; reason: 'manual' | 'threshold' | 'overflow' }
  | { type: 'compaction_end'; summary: string; aborted: boolean }
  | { type: 'error'; message: string };

/** Streaming delta events */
export interface StreamingEvent {
  type: 'text_delta' | 'text_start' | 'text_end' | 'thinking_delta' | 'thinking_start' | 'thinking_end' | 'toolcall_delta' | 'toolcall_start' | 'toolcall_end' | 'done' | 'error';
  contentIndex?: number;
  delta?: string;
  partial?: unknown;
  toolCall?: ToolCall;
}

/** Configuration for Pi session */
export interface PiConfig {
  /** Working directory */
  cwd: string;
  /** Mode: 'vfs' for web/VFS, 'local' for desktop local FS */
  mode: PiMode;
  /** Model provider and ID */
  provider?: string;
  modelId?: string;
  /** Thinking level */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Auth storage */
  apiKey?: string;
  /** Session persistence */
  sessionDir?: string;
  /** No session persistence */
  noSession?: boolean;
}

/** Pi Session - main interface */
export interface PiSession {
  /** Session ID */
  sessionId: string;
  /** Whether agent is currently processing */
  isStreaming: boolean;
  
  /** Send a prompt to the agent */
  prompt(message: string, options?: PiPromptOptions): Promise<void>;
  
  /** Queue a steering message during streaming */
  steer(message: string): Promise<void>;
  
  /** Queue a follow-up message after streaming completes */
  followUp(message: string): Promise<void>;
  
  /** Subscribe to events */
  subscribe(listener: (event: PiEvent) => void): () => void;
  
  /** Abort current operation */
  abort(): Promise<void>;
  
  /** Get current state */
  getState(): Promise<PiState>;
  
  /** Get all messages */
  getMessages(): Promise<AgentMessage[]>;
  
  /** Cycle to next model */
  cycleModel(): Promise<void>;
  
  /** Cycle thinking level */
  cycleThinkingLevel(): Promise<void>;
  
  /** Compact conversation */
  compact(): Promise<void>;
  
  /** Dispose session */
  dispose(): void;
}

/** Options for prompt */
export interface PiPromptOptions {
  expandPromptTemplates?: boolean;
  images?: PiImage[];
  streamingBehavior?: 'steer' | 'followUp';
}

/** Image content */
export interface PiImage {
  type: 'image';
  data: string;
  mimeType: string;
}

/** Session state */
export interface PiState {
  model: PiModel | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile: string | null;
  sessionId: string;
  messageCount: number;
}

/** Model info */
export interface PiModel {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

/** Factory configuration */
export interface PiFactoryConfig extends PiConfig {
  /** Run mode: 'cli' spawns binary, 'remote' uses HTTP */
  runMode?: RunMode;
  /** Remote endpoint URL (for 'remote' mode) */
  remoteUrl?: string;
  /** Session manager */
  sessionManager?: PiSessionManager;
  /** Custom tools */
  tools?: PiTool[];
}

/** Session manager */
export interface PiSessionManager {
  create(cwd: string): Promise<PiSession>;
  open(sessionPath: string): Promise<PiSession>;
  list(cwd: string): Promise<string[]>;
  continueRecent(cwd: string): Promise<PiSession>;
}

/** Custom tool definition */
export interface PiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: PiToolContext): Promise<ToolResult>;
}

/** Tool execution context */
export interface PiToolContext {
  cwd: string;
  sessionId: string;
  userId?: string;
  getFilesystem(): PiFilesystemAdapter;
}

/** Extended filesystem adapter with git support */
export interface PiFilesystemAdapter {
  // Core file operations
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDirectory(path: string): Promise<PiDirEntry[]>;
  exists(path: string): Promise<boolean>;
  search(query: string, options?: { path?: string; limit?: number }): Promise<PiDirEntry[]>;
  
  // Git operations (for version rollback)
  gitDiff?(path: string): Promise<string>;
  gitLog?(path: string, limit?: number): Promise<Array<{ hash: string; message: string; date: string }>>;
  gitRevert?(path: string, hash: string): Promise<void>;
}

/** Directory entry */
export interface PiDirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: string;
}

/** In-memory session manager */
export class PiInMemorySessionManager implements PiSessionManager {
  async create(cwd: string): Promise<PiSession> {
    return createPiSession({ cwd, mode: 'local' });
  }
  async open(sessionPath: string): Promise<PiSession> {
    throw new Error('Not implemented');
  }
  async list(cwd: string): Promise<string[]> {
    return [];
  }
  async continueRecent(cwd: string): Promise<PiSession> {
    return this.create(cwd);
  }
}

/** Create a Pi session */
export async function createPiSession(config: PiFactoryConfig): Promise<PiSession> {
  const { runMode = 'cli' } = config;
  
  if (runMode === 'remote') {
    const { createRemotePiSession } = await import('./pi-remote-session');
    return createRemotePiSession(config);
  }
  
  const { createCliPiSession } = await import('./pi-cli-session');
  return createCliPiSession(config);
}

export type {
  AgentMessage,
  ToolCall,
  ToolResult,
} from '@/lib/agent/types';