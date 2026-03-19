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

import { enhancedTerminalManager } from '@/lib/terminal/enhanced-terminal-manager'
import { getSandboxProvider } from '@/lib/sandbox/providers'
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge'
import { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } from '@/lib/mcp'
import type { PreviewInfo } from '@/lib/sandbox/types'
import type { DesktopHandle } from '@/lib/computer/e2b-desktop-provider-enhanced'
import { GitManager, type GitStatusResult } from './git-manager'
import { createLogger } from '@/lib/utils/logger'

const log = createLogger('UnifiedAgent')

// ==================== Types ====================

export interface UnifiedAgentConfig {
  /** Sandbox provider (e2b, daytona, blaxel, etc.) */
  provider?: 'e2b' | 'daytona' | 'blaxel' | 'sprites' | 'codesandbox' | 'microsandbox'

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
  
  // Bounded terminal output array to prevent memory leaks
  private readonly MAX_OUTPUT_LENGTH = 1000
  private terminalOutput: TerminalOutput[] = []
  
  private desktopHandle: DesktopHandle | null = null
  private mcpInitialized: boolean = false
  private gitManager: GitManager | null = null
  private onOutputCallback?: (output: TerminalOutput) => void
  private initializedCapabilities: Set<AgentCapability> = new Set()
  private initializationErrors: Map<AgentCapability, Error> = new Map()
  
  // Session timeout enforcement
  private sessionCheckInterval?: NodeJS.Timeout

  constructor(config: UnifiedAgentConfig) {
    this.config = config
    
    // Validate configuration
    if (!config.provider) {
      throw new Error('Provider is required')
    }
    
    const validProviders = ['e2b', 'daytona', 'blaxel', 'sprites', 'codesandbox', 'microsandbox']
    if (!validProviders.includes(config.provider)) {
      throw new Error(`Invalid provider: ${config.provider}. Valid providers: ${validProviders.join(', ')}`)
    }
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the agent session with real sandbox
   *
   * ERROR HANDLING: Each capability initialization is wrapped in try-catch
   * CAPABILITY TRACKING: Tracks which capabilities were successfully initialized
   */
  async initialize(): Promise<AgentSession> {
    const userId = this.config.userId || 'anonymous-agent'
    const initStartTime = Date.now()
    log.info(`Initializing agent session for user ${userId} with provider ${this.config.provider}`)
    log.debug(`Requested capabilities: ${this.config.capabilities?.join(', ') || 'terminal'}`)

    try {
      // P1 FIX: Pass provider to bridge and use correct env key
      let workspaceSession
      try {
        log.debug(`Creating workspace for user ${userId} with provider ${this.config.provider}...`)
        workspaceSession = await sandboxBridge.createWorkspace(userId, {
          // P1 FIX: Pass provider to ensure sandbox is created on the correct backend
          provider: this.config.provider,
          // P1 FIX: Use envVars key instead of env
          envVars: this.config.env,
        } as any)
        log.info(`Workspace created: ${workspaceSession.sandboxId} on provider ${workspaceSession.provider || this.config.provider}`)
      } catch (error: any) {
        log.error(`Failed to create sandbox session: ${error.message}`)
        throw new Error(
          `Failed to initialize sandbox: ${error.message}. ` +
          `Check that provider "${this.config.provider}" is properly configured.`
        )
      }

      this.session = {
        sessionId: workspaceSession.sessionId,
        sandboxId: workspaceSession.sandboxId,
        userId,
        provider: this.config.provider,
        capabilities: this.config.capabilities || ['terminal'],
        createdAt: Date.now(),
        lastActive: Date.now(),
      }

      // Initialize capabilities with individual error handling
      const capabilities = this.config.capabilities || ['terminal']
      const initResults: Record<string, boolean> = {}

      for (const capability of capabilities) {
        try {
          log.debug(`Initializing capability: ${capability}`)
          switch (capability) {
            case 'terminal':
              await this.initializeTerminal()
              this.initializedCapabilities.add('terminal')
              initResults.terminal = true
              break

            case 'desktop':
              if (this.config.desktop?.enabled !== false) {
                await this.initializeDesktop()
                if (this.desktopHandle) {
                  this.initializedCapabilities.add('desktop')
                  initResults.desktop = true
                } else {
                  initResults.desktop = false
                }
              }
              break

            case 'mcp':
              if (this.config.mcp) {
                await this.initializeMCP()
                if (this.mcpInitialized) {
                  this.initializedCapabilities.add('mcp')
                  initResults.mcp = true
                } else {
                  initResults.mcp = false
                }
              }
              break

            case 'git':
              await this.initializeGit()
              if (this.gitManager) {
                this.initializedCapabilities.add('git')
                initResults.git = true
              } else {
                initResults.git = false
              }
              break

            case 'code-execution':
              this.initializedCapabilities.add('code-execution')
              initResults['code-execution'] = true
              break

            case 'file-ops':
              this.initializedCapabilities.add('file-ops')
              initResults['file-ops'] = true
              break

            case 'preview':
              this.initializedCapabilities.add('preview')
              initResults.preview = true
              break

            default:
              console.warn(`[UnifiedAgent] Unknown capability: ${capability}`)
              initResults[capability] = false
          }
        } catch (error: any) {
          console.error(`[UnifiedAgent] Failed to initialize capability ${capability}:`, error.message)
          this.initializationErrors.set(capability, error)
          initResults[capability] = false
          
          // Don't fail entire initialization for non-critical capabilities
          if (['desktop', 'mcp', 'git'].includes(capability)) {
            console.warn(`[UnifiedAgent] Continuing without ${capability} capability`)
          }
        }
      }

      const initDuration = Date.now() - initStartTime
      console.log(
        `[UnifiedAgent] Session initialized: ${this.session.sessionId} ` +
        `(${initDuration}ms). Capabilities: ${JSON.stringify(initResults)}`
      )

      // Start session timeout checker if configured
      if (this.config.session?.timeout) {
        this.startSessionTimeoutChecker()
      }

      return this.session

    } catch (error: any) {
      console.error('[UnifiedAgent] Initialization failed:', error.message)
      throw error
    }
  }

  /**
   * Get capability initialization status
   */
  getCapabilityStatus(): {
    initialized: AgentCapability[]
    failed: AgentCapability[]
    errors: Map<AgentCapability, Error>
  } {
    const allCapabilities = this.config.capabilities || ['terminal']
    const failed = allCapabilities.filter(c => !this.initializedCapabilities.has(c)) as AgentCapability[]
    
    return {
      initialized: Array.from(this.initializedCapabilities) as AgentCapability[],
      failed,
      errors: new Map(this.initializationErrors),
    }
  }

  /**
   * Clean up all resources with comprehensive error handling
   */
  async cleanup(): Promise<void> {
    if (!this.session) {
      log.debug('No session to cleanup')
      return
    }

    log.info(`Cleaning up session ${this.session.sessionId}...`)
    const cleanupErrors: Error[] = []

    try {
      // Stop session timeout checker
      this.stopSessionTimeoutChecker()

      this.mcpInitialized = false

      // Disconnect terminal but keep sandbox alive unless explicitly requested
      try {
        await enhancedTerminalManager.disconnectTerminal(this.session.sessionId)
        this.initializedCapabilities.delete('terminal')
        log.debug('Terminal disconnected')
      } catch (error: any) {
        log.error(`Terminal disconnect failed: ${error.message}`)
        cleanupErrors.push(error)
      }

      // Cleanup desktop handle if exists
      if (this.desktopHandle && 'cleanup' in this.desktopHandle) {
        try {
          await (this.desktopHandle as any).cleanup()
          this.desktopHandle = null
          this.initializedCapabilities.delete('desktop')
          log.debug('Desktop cleaned up')
        } catch (error: any) {
          log.error(`Desktop cleanup failed: ${error.message}`)
          cleanupErrors.push(error)
        }
      }

      // Cleanup Git manager if exists
      this.gitManager = null
      this.initializedCapabilities.delete('git')

      // Clear all resources to prevent memory leaks
      this.terminalOutput = []
      this.initializationErrors.clear()
      this.initializedCapabilities.clear()
      this.onOutputCallback = undefined

      this.session = null

      if (cleanupErrors.length > 0) {
        log.warn(`Cleanup completed with ${cleanupErrors.length} error(s)`)
      } else {
        log.info('Cleanup complete')
      }

    } catch (error: any) {
      log.error(`Cleanup failed: ${error.message}`)
      throw error
    }
  }

  /**
   * Initialize Git manager with error handling
   */
  private async initializeGit(): Promise<void> {
    if (!this.session) {
      throw new Error('Session not initialized')
    }

    try {
      log.debug('Initializing Git manager...')
      const provider = await getSandboxProvider(this.config.provider as any)
      const handle = await provider.getSandbox(this.session.sandboxId)
      this.gitManager = new GitManager(handle)
      log.info('Git manager initialized')
    } catch (error: any) {
      log.error(`Git initialization failed: ${error.message}`)
      throw new Error(`Failed to initialize Git: ${error.message}`)
    }
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

    log.debug('Creating terminal session...')
    await enhancedTerminalManager.createTerminalSessionWithDesktop(
      this.session.sessionId,
      this.session.sandboxId,
      (data) => this.handleTerminalOutput(data),
      (preview) => this.handlePortDetected(preview),
    )
    log.info('Terminal session created')

    // Enable auto-resume if configured
    if (this.config.session?.autoResume) {
      log.debug('Enabling auto-resume for terminal')
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

    // Prevent unbounded growth - keep only last N entries
    if (this.terminalOutput.length > this.MAX_OUTPUT_LENGTH) {
      this.terminalOutput = this.terminalOutput.slice(-this.MAX_OUTPUT_LENGTH)
    }

    if (this.onOutputCallback) {
      this.onOutputCallback(output)
    }
  }

  private handlePortDetected(preview: PreviewInfo): void {
    log.info(`Port detected: ${preview.port} → ${preview.url}`)
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

  /**
   * Start session timeout checker to enforce idle timeout
   */
  private startSessionTimeoutChecker(): void {
    const timeout = this.config.session?.timeout || 300000 // Default 5 minutes
    const checkInterval = Math.min(timeout / 2, 60000) // Check every 30s or half timeout
    log.debug(`Starting session timeout checker (timeout: ${timeout}ms, check interval: ${checkInterval}ms)`)

    this.sessionCheckInterval = setInterval(() => {
      if (this.session) {
        const idleTime = Date.now() - this.session.lastActive
        if (idleTime > timeout) {
          log.warn(`Session idle timeout (${timeout}ms). Cleaning up...`)
          this.cleanup().catch((error) => {
            log.error(`Cleanup after timeout failed: ${error.message}`)
          })
        }
      }
    }, checkInterval)
  }

  /**
   * Stop session timeout checker
   */
  private stopSessionTimeoutChecker(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval)
      this.sessionCheckInterval = undefined
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
      log.debug('Initializing desktop...')
      const provider = await getSandboxProvider(this.config.provider as any)
       const handle = await provider.getSandbox(this.session.sandboxId)

       if ('getComputerUseService' in handle) {
         // Specialized service (Daytona)
         this.desktopHandle = (handle as any).getComputerUseService()
         log.debug('Desktop initialized with specialized service (Daytona)')
      } else if ('screenshot' in handle) {
         // Direct handle (E2B)
         this.desktopHandle = handle as any
         log.debug('Desktop initialized with direct handle (E2B)')
      }

      if (this.desktopHandle) {
        log.info('Desktop initialized')
      }
    } catch (error: any) {
      log.warn(`Desktop initialization failed: ${error.message}`)
    }
  }

  // ==================== MCP ====================

  /**
   * Call MCP tool
   */
  async mcpCall(toolName: string, args: Record<string, any>): Promise<{ success: boolean; output: string; error?: string }> {
    if (!this.mcpInitialized) {
      throw new Error('MCP not initialized')
    }

    log.debug(`Calling MCP tool: ${toolName}`)
    const userId = this.config.userId || 'anonymous-agent'
    return callMCPToolFromAI_SDK(toolName, args, userId)
  }

  /**
   * List available MCP tools
   */
  async mcpListTools(): Promise<Array<{ name: string; description?: string }>> {
    if (!this.mcpInitialized) {
      throw new Error('MCP not initialized')
    }

    log.debug('Listing MCP tools...')
    const tools = await getMCPToolsForAI_SDK(this.config.userId)
    log.debug(`Found ${tools.length} MCP tools`)
    return tools.map(t => ({ name: t.function.name, description: t.function.description }))
  }

  private async initializeMCP(): Promise<void> {
    if (!this.config.mcp) return

    try {
      log.debug('Initializing MCP...')
      const tools = await getMCPToolsForAI_SDK(this.config.userId)
      this.mcpInitialized = true
      log.info(`MCP initialized with ${tools.length} tools`)
    } catch (error: any) {
      log.warn(`MCP initialization failed: ${error.message}`)
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
      const provider = await getSandboxProvider(this.config.provider as any)
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

      // Safe execution: write to temporary file and execute file
      const ext = this.getCodeExtension(language);
      const tempPath = `/tmp/agent_exec_${Date.now()}.${ext}`;
      await sandboxBridge.writeFile(this.session.sandboxId, tempPath, code);

      const command = this.getCodeCommand(language, tempPath);
      let result: any;
      try {
        result = await sandboxBridge.executeCommand(
          this.session.sandboxId,
          command,
          undefined
        );
      } finally {
        // Best-effort cleanup of temporary file
        try {
          await sandboxBridge.executeCommand(this.session.sandboxId, `rm ${tempPath}`);
        } catch {
          // Ignore cleanup errors
        }
      }

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

  private getCodeExtension(language: string): string {
    switch (language) {
      case 'python': return 'py';
      case 'javascript': return 'js';
      case 'typescript': return 'ts';
      case 'bash':
      case 'sh': return 'sh';
      default: return 'txt';
    }
  }

  private getCodeCommand(language: string, filePath: string): string {
    switch (language) {
      case 'python':
        return `python3 ${filePath}`
      case 'javascript':
      case 'typescript':
        return `node ${filePath}`
      case 'bash':
      case 'sh':
        return `bash ${filePath}`
      default:
        throw new Error(`Unsupported language for execution: ${language}`)
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
      mcpEnabled: this.mcpInitialized,
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
