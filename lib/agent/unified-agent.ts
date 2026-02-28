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
import { E2BDesktopProvider, type DesktopHandle } from '@/lib/sandbox/providers/e2b-desktop-provider'
import { MCPClient, type MCPToolResult } from '@/lib/mcp'
import type { PreviewInfo } from '@/lib/sandbox/types'

// ==================== Types ====================

export interface UnifiedAgentConfig {
  /** Sandbox provider (e2b, daytona, blaxel, etc.) */
  provider: 'e2b' | 'daytona' | 'blaxel' | 'sprites' | 'codesandbox' | 'microsandbox'
  
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

export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  files: Array<{
    path: string
    status: 'modified' | 'added' | 'deleted' | 'untracked'
  }>
}

// ==================== Agent Interface ====================

export class UnifiedAgent {
  private config: UnifiedAgentConfig
  private session: AgentSession | null = null
  private terminalOutput: TerminalOutput[] = []
  private desktopHandle: DesktopHandle | null = null
  private mcpClient: MCPClient | null = null
  private onOutputCallback?: (output: TerminalOutput) => void

  constructor(config: UnifiedAgentConfig) {
    this.config = config
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the agent session
   */
  async initialize(): Promise<AgentSession> {
    console.log('[UnifiedAgent] Initializing session...')

    // Create sandbox session (would integrate with sandbox-service-bridge)
    const sessionId = `agent-${Date.now()}`
    const sandboxId = `sbx-${Date.now()}`

    this.session = {
      sessionId,
      sandboxId,
      provider: this.config.provider,
      capabilities: this.config.capabilities || ['terminal'],
      createdAt: Date.now(),
      lastActive: Date.now(),
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

    console.log('[UnifiedAgent] Session initialized:', sessionId)
    return this.session
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    console.log('[UnifiedAgent] Cleaning up...')

    if (this.desktopHandle) {
      // Desktop cleanup handled by enhancedTerminalManager
    }

    if (this.mcpClient) {
      await this.mcpClient.disconnect()
      this.mcpClient = null
    }

    if (this.session) {
      await enhancedTerminalManager.disconnectTerminal(this.session.sessionId)
      this.session = null
    }

    this.terminalOutput = []
    console.log('[UnifiedAgent] Cleanup complete')
  }

  // ==================== Terminal ====================

  /**
   * Send input to terminal
   */
  async terminalSend(input: string): Promise<void> {
    if (!this.session) throw new Error('Session not initialized')
    
    this.updateLastActive()
    
    // Terminal output is handled by callbacks
    const term = enhancedTerminalManager['activePtyConnections'].get(this.session.sessionId)
    if (term) {
      // Send via WebSocket if available, otherwise via command mode
      // This is handled internally by enhancedTerminalManager
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

    return this.desktopHandle.screen.capture()
  }

  /**
   * Get screen resolution
   */
  async desktopResolution(): Promise<{ width: number; height: number }> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    return this.desktopHandle.screen.resolution()
  }

  /**
   * Click at position
   */
  async desktopClick(opts: { 
    x: number
    y: number
    button?: 'left' | 'right' | 'middle'
    clicks?: number
  }): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.mouse.click(opts)
  }

  /**
   * Move mouse to position
   */
  async desktopMove(opts: { x: number; y: number }): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.mouse.move(opts)
  }

  /**
   * Type text
   */
  async desktopType(text: string): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.keyboard.type(text)
  }

  /**
   * Press key
   */
  async desktopPress(key: string): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.keyboard.press(key)
  }

  /**
   * Press hotkey combination
   */
  async desktopHotkey(keys: string[]): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized')
    }

    await this.desktopHandle.keyboard.hotkey(keys)
  }

  private async initializeDesktop(): Promise<void> {
    if (!this.session) return

    const desktopProvider = new E2BDesktopProvider()
    
    try {
      this.desktopHandle = await desktopProvider.createDesktop({
        resolution: this.config.desktop?.resolution,
      })

      console.log('[UnifiedAgent] Desktop initialized')
    } catch (error) {
      console.warn('[UnifiedAgent] Desktop initialization failed:', error)
      // Continue without desktop
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

      const tools = await this.mcpClient.listTools()
      console.log(`[UnifiedAgent] MCP initialized with ${tools.length} tools`)
    } catch (error) {
      console.warn('[UnifiedAgent] MCP initialization failed:', error)
    }
  }

  // ==================== Code Execution ====================

  /**
   * Execute code
   */
  async codeExecute(
    language: string,
    code: string,
    options?: { timeout?: number; args?: string[] }
  ): Promise<CodeExecutionResult> {
    if (!this.session) throw new Error('Session not initialized')

    const startTime = Date.now()
    
    try {
      // Use terminal to execute code
      const command = this.getCodeCommand(language, code)
      await this.terminalSend(command)
      
      // Wait for output (simplified - would need proper async handling)
      await new Promise(resolve => setTimeout(resolve, 1000))

      const output = this.getTerminalOutput()
        .filter(o => o.timestamp > startTime)
        .map(o => o.data)
        .join('')

      return {
        success: true,
        output,
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
    switch (language) {
      case 'python':
        return `python3 -c "${code.replace(/"/g, '\\"')}"`
      case 'javascript':
      case 'typescript':
        return `node -e "${code.replace(/"/g, '\\"')}"`
      case 'go':
        return `go run main.go` // Would need to write file first
      default:
        throw new Error(`Unsupported language: ${language}`)
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
    if (!this.session) throw new Error('Session not initialized')

    const depth = options?.depth ? `--depth ${options.depth}` : ''
    const branch = options?.branch ? `--branch ${options.branch}` : ''
    const path = options?.path || '.'

    const command = `git clone ${depth} ${branch} ${url} ${path}`
    await this.terminalSend(command)
  }

  /**
   * Get Git status
   */
  async gitStatus(): Promise<GitStatus> {
    if (!this.session) throw new Error('Session not initialized')

    // Would parse git status output
    return {
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [],
    }
  }

  /**
   * Commit changes
   */
  async gitCommit(message: string, all?: boolean): Promise<void> {
    if (!this.session) throw new Error('Session not initialized')

    if (all) {
      await this.terminalSend('git add -A')
    }
    await this.terminalSend(`git commit -m "${message.replace(/"/g, '\\"')}"`)
  }

  /**
   * Push changes
   */
  async gitPush(remote?: string, branch?: string): Promise<void> {
    if (!this.session) throw new Error('Session not initialized')

    const r = remote || 'origin'
    const b = branch || 'main'
    await this.terminalSend(`git push ${r} ${b}`)
  }

  // ==================== File Operations ====================

  /**
   * Read file
   */
  async readFile(path: string): Promise<string> {
    if (!this.session) throw new Error('Session not initialized')

    await this.terminalSend(`cat ${path}`)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    const output = this.getTerminalOutput()
      .slice(-10)
      .filter(o => o.type === 'stdout')
      .map(o => o.data)
      .join('')
    
    return output
  }

  /**
   * Write file
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.session) throw new Error('Session not initialized')

    // Use heredoc for multi-line content
    const escapedContent = content.replace(/'/g, "'\\''")
    await this.terminalSend(`cat > ${path} << 'EOF'`)
    await this.terminalSend(escapedContent)
    await this.terminalSend('EOF')
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
