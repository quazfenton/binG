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
}

export interface PreviewInfo {
  port: number
  url: string
  token?: string
}
