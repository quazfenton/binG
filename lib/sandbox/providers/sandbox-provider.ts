import type { ToolResult, PreviewInfo } from '../types'

export interface SandboxProvider {
  readonly name: string

  createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle>
  getSandbox(sandboxId: string): Promise<SandboxHandle>
  destroySandbox(sandboxId: string): Promise<void>
}

export interface SandboxHandle {
  readonly id: string
  readonly workspaceDir: string

  executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult>
  writeFile(filePath: string, content: string): Promise<ToolResult>
  readFile(filePath: string): Promise<ToolResult>
  listDirectory(dirPath: string): Promise<ToolResult>
  getPreviewLink?(port: number): Promise<PreviewInfo>

  createPty?(options: PtyOptions): Promise<PtyHandle>
  connectPty?(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle>
  killPty?(sessionId: string): Promise<void>
  resizePty?(sessionId: string, cols: number, rows: number): Promise<void>
}

export interface PtyHandle {
  readonly sessionId: string
  sendInput(data: string): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  waitForConnection(): Promise<void>
  wait?(): Promise<{ exitCode: number }>
  disconnect(): Promise<void>
  kill(): Promise<void>
}

export interface PtyOptions {
  id: string  // Session identifier
  cwd?: string
  envs?: Record<string, string>
  cols?: number
  rows?: number
  onData: (data: Uint8Array) => void
}

export interface PtyConnectOptions {
  onData: (data: Uint8Array) => void
}

export interface SandboxCreateConfig {
  language?: string
  autoStopInterval?: number
  resources?: { cpu?: number; memory?: number }
  envVars?: Record<string, string>
  labels?: Record<string, string>
  mounts?: Array<{ source: string; target: string }>
}
