/**
 * Type declarations for @bing/shared/agent/v2-executor
 * Stub for agent-worker — mirrors real exports from packages/shared/agent/v2-executor.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */

export type ExecutionPolicy =
  | 'local-safe' | 'sandbox-required' | 'sandbox-preferred' | 'sandbox-heavy'
  | 'persistent-sandbox' | 'desktop-required' | 'cloud-sandbox' | 'isolated-code-exec';

export interface V2ExecuteOptions {
  userId: string;
  conversationId: string;
  task: string;
  context?: string;
  stream?: boolean;
  preferredAgent?: 'opencode' | 'nullclaw' | 'cli' | 'advanced';
  executionPolicy?: ExecutionPolicy;
  cliCommand?: { command: string; args?: string[] };
  promptParams?: any;
}

export interface V2ExecutionResult {
  success: boolean;
  data?: unknown;
  content: string;
  rawContent: string;
  sessionId?: string;
  conversationId?: string;
  workspacePath?: string;
  executionPolicy?: ExecutionPolicy;
  fallbackToV1?: boolean;
  error?: string;
  errorCode?: string;
}

export function executeV2Task(options: V2ExecuteOptions): Promise<V2ExecutionResult>;
export function executeV2TaskStreaming(options: V2ExecuteOptions): ReadableStream;
