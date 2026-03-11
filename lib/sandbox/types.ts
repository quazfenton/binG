export interface WorkspaceSession {
  sessionId: string
  sandboxId: string
  userId: string
  ptySessionId?: string
  cwd: string
  createdAt: string
  lastActive: string
  status: 'creating' | 'active' | 'snapshotting' | 'destroyed'
}

export interface ToolResult {
  success: boolean
  output: string
  exitCode?: number
  binary?: Uint8Array
}

export interface AgentMessage {
  role: 'user' | 'model' | 'tool'
  content: string
  toolCall?: {
    name: string
    args: Record<string, string>
  }
  toolResult?: ToolResult
}

export interface SandboxConfig {
  language?: string
  autoStopInterval?: number
  resources?: {
    cpu?: number
    memory?: number
  }
  envVars?: Record<string, string>
  // P1 FIX: Added provider field to allow explicit provider selection
  provider?: string
}

export interface PreviewInfo {
  port: number
  url: string
  token?: string
}
