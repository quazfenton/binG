/**
 * Unified Agent Interface
 * 
 * Provides a single, consistent interface for AI agents to interact with:
 * - Terminal (WebSocket/SSE)
 * - Desktop (Computer Use)
 * - MCP Tools
 * - File System
 * - Code Execution
 * - Git Operations
 * 
 * This abstraction layer allows agents to work across multiple providers
 * (E2B, Daytona, Blaxel, Sprites, etc.) with a unified API.
 * 
 * @example
 * ```typescript
 * import { createAgent } from '@/lib/agent/unified-agent'
 * 
 * const agent = await createAgent({
 *   provider: 'e2b',
 *   capabilities: ['terminal', 'desktop', 'mcp', 'code-execution'],
 *   mcp: {
 *     browserbase: { apiKey: process.env.BROWSERBASE_API_KEY },
 *   },
 * })
 * 
 * // Use terminal
 * await agent.terminal.send('ls -la')
 * 
 * // Use desktop (computer use)
 * await agent.desktop.click({ x: 100, y: 200 })
 * 
 * // Use MCP tools
 * const result = await agent.mcp.call('browserbase_navigate', { url: 'https://example.com' })
 * 
 * // Execute code
 * const codeResult = await agent.code.run('python', 'print("Hello!")')
 * 
 * // Cleanup
 * await agent.cleanup()
 * ```
 */

import { enhancedTerminalManager } from '@/lib/sandbox/enhanced-terminal-manager'
import { getSandboxProvider } from '@/lib/sandbox/providers'
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge'
import { MCPClient, type MCPToolResult } from '@/lib/mcp'
import type { PreviewInfo } from '@/lib/sandbox/types'
import type { DesktopHandle } from '@/lib/sandbox/providers/sandbox-provider'
import { GitManager, type GitStatusResult } from './git-manager'

// ==================== Types ====================

export interface UnifiedAgentConfig {
  /** Sandbox provider (e2b, daytona, blaxel, etc.) */
  provider: 'e2b' | 'daytona' | 'blaxel' | 'sprites' | 'codesandbox' | 'microsandbox'
  
  /** User ID for session ownership */
  userId?: string
  
  /** Capabilities to enable */
  capabilities?: AgentCapability[]
  
  /** MCP server configurations */
  mcp?: Record<string, any>
  
  /** Desktop configuration */
  desktop?: {
    enabled: boolean
    resolution?: { width: number; height: number }
  }
  
  /** Code execution configuration */
  codeExecution?: {
    enabled: boolean
    defaultLanguage: 'python' | 'javascript' | 'typescript' | 'go' | 'rust'
    timeout?: number
  }
  
  /** Environment variables */
  env?: Record<string, string>
  
  /** Session options */
  session?: {
    autoResume?: boolean
    timeout?: number
  }
}

export type AgentCapability = 
  | 'terminal'
  | 'desktop'
  | 'mcp'
  | 'code-execution'
  | 'git'
  | 'file-ops'
  | 'preview'

export interface AgentSession {
  sessionId: string
  sandboxId: string
  userId: string
  provider: string
  capabilities: AgentCapability[]
  createdAt: number
  lastActive: number
}

export interface TerminalOutput {
  type: 'stdout' | 'stderr' | 'error' | 'system'
  data: string
  timestamp: number
}

export interface CodeExecutionResult {
  success: boolean
  output: string
  error?: string
  exitCode?: number
  executionTime?: number
}

// ==================== Agent Interface ====================

export class UnifiedAgent {
  private config: UnifiedAgentConfig
  private session: AgentSession | null = null
  private terminalOutput: TerminalOutput[] = []
  private desktopHandle: DesktopHandle | null = null
  private mcpClient: MCPClient | null = null
  private gitManager: GitManager | null = null
  private onOutputCallback?: (output: TerminalOutput) => void

  constructor(config: UnifiedAgentConfig) {
    this.config = config
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the agent session with real sandbox
   */
  async initialize(): Promise<AgentSession> {
    const userId = this.config.userId || 'anonymous-agent'
    console.log(`[UnifiedAgent] Initializing session for ${userId}...`)

    // Create real sandbox session via bridge
    const workspaceSession = await sandboxBridge.getOrCreateSession(userId, {
      provider: this.config.provider,
      env: this.config.env,
    })

    this.session = {
      sessionId: workspaceSession.sessionId,
      sandboxId: workspaceSession.sandboxId,
      userId,
      provider: this.config.provider,
      capabilities: this.config.capabilities || ['terminal'],
      createdAt: Date.now(),
      lastActive: Date.now(),
    }

    // Initialize Git Manager if capability enabled
    if (this.config.capabilities?.includes('git')) {
       const provider = getSandboxProvider(this.config.provider as any)
       const handle = await provider.getSandbox(this.session.sandboxId)
       this.gitManager = new GitManager(handle)
    }

    // Initialize capabilities
    if (this.config.capabilities?.includes('terminal')) {
      await this.initializeTerminal()
    }

    if (this.config.capabilities?.includes('desktop')) {
      await this.initializeDesktop()
    }

    if (this.config.capabilities?.includes('mcp') && this.config.mcp) {
      await this.initializeMCP()
    }

    console.log('[UnifiedAgent] Session initialized:', this.session.sessionId)
    return this.session
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    if (!this.session) return
    console.log(`[UnifiedAgent] Cleaning up session ${this.session.sessionId}...`)

    if (this.mcpClient) {
      await this.mcpClient.disconnect()
      this.mcpClient = null
    }

    // Disconnect terminal but keep sandbox alive unless explicitly requested
    await enhancedTerminalManager.disconnectTerminal(this.session.sessionId)
    
    this.session = null
    this.terminalOutput = []
    console.log('[UnifiedAgent] Cleanup complete')
  }

  // ==================== Terminal ====================

  /**
   * Send input to terminal
   */
  async terminalSend(input: string): Promise<string> {
    if (!this.session) throw new Error('Session not initialized')
    
    this.updateLastActive()
    
    try {
      // Use sandbox bridge for command execution
      const result = await sandboxBridge.executeCommand(this.session.sandboxId, input)
      
      const output: TerminalOutput = {
        type: result.success ? 'stdout' : 'stderr',
        data: result.output || '',
        timestamp: Date.now(),
      }

      this.terminalOutput.push(output)
      this.onOutputCallback?.(output)

      return output.data
    } catch (error: any) {
      const output: TerminalOutput = {
        type: 'error',
        data: error.message,
        timestamp: Date.now(),
      }
      this.terminalOutput.push(output)
      this.onOutputCallback?.(output)
      throw error
    }
  }

  /**
   * Get terminal output history
   */
  getTerminalOutput(): TerminalOutput[] {
    return [...this.terminalOutput]
  }

  /**
   * Set callback for terminal output
   */
  onTerminalOutput(callback: (output: TerminalOutput) => void): void {
    this.onOutputCallback = callback
  }

  private async initializeTerminal(): Promise<void> {
    if (!this.session) return

    await enhancedTerminalManager.createTerminalSession(
      this.session.sessionId,
      this.session.sandboxId,
      (data) => this.handleTerminalOutput(data),
      (preview) => this.handlePortDetected(preview),
    )

    // Enable auto-resume if configured
    if (this.config.session?.autoResume) {
      enhancedTerminalManager.enableAutoResume(
        this.session.sessionId,
        this.config.session.timeout || 300000
      )
    }
  }

  private handleTerminalOutput(data: string): void {
    const output: TerminalOutput = {
      type: 'stdout',
      data,
      timestamp: Date.now(),
    }

    this.terminalOutput.push(output)

    if (this.onOutputCallback) {
      this.onOutputCallback(output)
    }
  }

  private handlePortDetected(preview: PreviewInfo): void {
    const output: TerminalOutput = {
      type: 'system',
      data: `Port detected: ${preview.port} → ${preview.url}`,
      timestamp: Date.now(),
    }

    this.terminalOutput.push(output)

    if (this.onOutputCallback) {
      this.onOutputCallback(output)
    }
  }

  private updateLastActive(): void {
    if (this.session) {
      this.session.lastActive = Date.now()
    }
  }

  // ==================== Desktop (Computer Use) ====================

  /**
   * Take a screenshot
   */
  async desktopScreenshot(): Promise<Buffer> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    return this.desktopHandle.screenshot()
  }

  /**
   * Get screen resolution
   */
  async desktopResolution(): Promise<{ width: number; height: number }> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    // Standardized for now, providers can return their own
    return { width: 1920, height: 1080 }
  }

  /**
   * Click at position
   */
  async desktopClick(opts: { 
    x: number
    y: number
    button?: 'left' | 'right' | 'middle'
  }): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    if (opts.button === 'right') await this.desktopHandle.rightClick(opts.x, opts.y)
    else if (opts.button === 'middle') await this.desktopHandle.middleClick(opts.x, opts.y)
    else await this.desktopHandle.leftClick(opts.x, opts.y)
  }

  /**
   * Move mouse to position
   */
  async desktopMove(opts: { x: number; y: number }): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.moveMouse(opts.x, opts.y)
  }

  /**
   * Type text
   */
  async desktopType(text: string): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.write(text)
  }

  /**
   * Press key
   */
  async desktopPress(key: string): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.press(key)
  }

  private async initializeDesktop(): Promise<void> {
    if (!this.session) return

    try {
      const provider = getSandboxProvider(this.config.provider as any)
      const handle = await provider.getSandbox(this.session.sandboxId)
      
      if ('getComputerUseService' in handle) {
         // Specialized service (Daytona)
         this.desktopHandle = (handle as any).getComputerUseService()
      } else if ('screenshot' in handle) {
         // Direct handle (E2B)
         this.desktopHandle = handle as any
      }

      if (this.desktopHandle) {
        console.log('[UnifiedAgent] Desktop initialized')
      }
    } catch (error) {
      console.warn('[UnifiedAgent] Desktop initialization failed:', error)
    }
  }

  // ==================== MCP ====================

  /**
   * Call MCP tool
   */
  async mcpCall(toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    if (!this.mcpClient) {
      throw new Error('MCP not initialized')
    }

    return this.mcpClient.callTool(toolName, args)
  }

  /**
   * List available MCP tools
   */
  async mcpListTools(): Promise<Array<{ name: string; description: string }>> {
    if (!this.mcpClient) {
      throw new Error('MCP not initialized')
    }

    return this.mcpClient.listTools()
  }

  private async initializeMCP(): Promise<void> {
    if (!this.config.mcp) return

    this.mcpClient = new MCPClient()

    try {
      await this.mcpClient.connect({
        servers: this.config.mcp,
      })
      console.log(`[UnifiedAgent] MCP initialized`)
    } catch (error) {
      console.warn('[UnifiedAgent] MCP initialization failed:', error)
    }
  }

  // ==================== Code Execution ====================

  /**
   * Execute code using native provider API if available
   */
  async codeExecute(
    language: string,
    code: string,
    options?: { timeout?: number }
  ): Promise<CodeExecutionResult> {
    if (!this.session) throw new Error('Session not initialized')

    const startTime = Date.now()
    
    try {
      const provider = getSandboxProvider(this.config.provider as any)
      const handle = await provider.getSandbox(this.session.sandboxId)
      
      // Some providers have native runCode (e.g. E2B)
      if ('runCode' in handle) {
        const result = await (handle as any).runCode(code, language)
        return {
          success: result.exitCode === 0,
          output: result.stdout || result.stderr || '',
          exitCode: result.exitCode,
          executionTime: Date.now() - startTime,
        }
      }

      // Fallback: Execute via terminal with proper command construction
      const command = this.getCodeCommand(language, code)
      const result = await sandboxBridge.executeCommand(
        this.session.sandboxId, 
        command, 
        undefined
      )

      return {
        success: result.success,
        output: result.output || '',
        exitCode: result.exitCode,
        executionTime: Date.now() - startTime,
      }
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
      }
    }
  }

  private getCodeCommand(language: string, code: string): string {
    const escaped = code.replace(/'/g, "'\\''")
    switch (language) {
      case 'python':
        return `python3 -c '${escaped}'`
      case 'javascript':
      case 'typescript':
        return `node -e '${escaped}'`
      case 'bash':
      case 'sh':
        return code
      default:
        throw new Error(`Unsupported language for terminal execution: ${language}`)
    }
  }

  // ==================== Git ====================

  /**
   * Clone Git repository
   */
  async gitClone(
    url: string,
    options?: { path?: string; branch?: string; depth?: number }
  ): Promise<void> {
    if (!this.gitManager) throw new Error('Git capability not enabled')
    await this.gitManager.clone(url, options?.path)
  }

  /**
   * Get Git status
   */
  async gitStatus(): Promise<GitStatusResult> {
    if (!this.gitManager) throw new Error('Git capability not enabled')
    return this.gitManager.status()
  }

  /**
   * Commit changes
   */
  async gitCommit(message: string, all?: boolean): Promise<void> {
    if (!this.gitManager) throw new Error('Git capability not enabled')
    if (all) await this.gitManager.add('.')
    await this.gitManager.commit(message)
  }

  /**
   * Push changes
   */
  async gitPush(remote?: string, branch?: string): Promise<void> {
    if (!this.gitManager) throw new Error('Git capability not enabled')
    await this.gitManager.push(remote, branch)
  }

  // ==================== File Operations ====================

  /**
   * Read file using real FS API
   */
  async readFile(path: string): Promise<string> {
    if (!this.session) throw new Error('Session not initialized')
    const result = await sandboxBridge.readFile(this.session.sandboxId, path)
    return result.output
  }

  /**
   * Write file using real FS API
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.session) throw new Error('Session not initialized')
    await sandboxBridge.writeFile(this.session.sandboxId, path, content)
  }

  // ==================== Session Management ====================

  /**
   * Get current session
   */
  getSession(): AgentSession | null {
    return this.session
  }

  /**
   * Get session stats
   */
  getSessionStats(): {
    uptime: number
    terminalOutputLength: number
    desktopEnabled: boolean
    mcpEnabled: boolean
  } {
    if (!this.session) {
      throw new Error('Session not initialized')
    }

    return {
      uptime: Date.now() - this.session.createdAt,
      terminalOutputLength: this.terminalOutput.length,
      desktopEnabled: !!this.desktopHandle,
      mcpEnabled: !!this.mcpClient,
    }
  }
}

// ==================== Factory ====================

/**
 * Create a new unified agent
 */
export async function createAgent(config: UnifiedAgentConfig): Promise<UnifiedAgent> {
  const agent = new UnifiedAgent(config)
  await agent.initialize()
  return agent
}

/**
 * Create agent with default settings for quick prototyping
 */
export async function createQuickAgent(options?: {
  provider?: UnifiedAgentConfig['provider']
  desktop?: boolean
  mcp?: boolean
}): Promise<UnifiedAgent> {
  return createAgent({
    provider: options?.provider || 'e2b',
    capabilities: [
      'terminal',
      ...(options?.desktop ? ['desktop' as const] : []),
      ...(options?.mcp ? ['mcp' as const] : []),
    ],
    desktop: options?.desktop ? { enabled: true } : undefined,
  })
}

export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  files: Array<{
    path: string
    status: 'modified' | 'added' | 'deleted' | 'untracked'
  }>
}
