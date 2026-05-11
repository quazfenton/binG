/**
 * E2B Desktop Provider - Enhanced with Session Management, MCP, and Structured Output
 * 
 * Provides desktop sandbox environments with VNC streaming and computer use capabilities
 * for AI agents that need to interact with graphical user interfaces.
 * 
 * Enhanced Features (per Deep Codebase Audit):
 * - Session ID support for conversation persistence
 * - MCP integration for 200+ Docker MCP tools
 * - Schema-validated output for reliable pipelines
 * - Custom system prompts (CLAUDE.md support)
 * 
 * Features:
 * - Ubuntu 22.04 desktop with XFCE environment
 * - VNC streaming via noVNC (port 6080)
 * - Mouse control (click, move, drag, scroll)
 * - Keyboard control (type, press keys)
 * - Screenshot capture for vision-based agents
 * - Pre-installed applications (LibreOffice, Firefox, terminal, etc.)
 * - Automation tools (xdotool, scrot, ffmpeg)
 *
 * @see https://e2b.dev/docs/template/examples/desktop
 * @see https://e2b.dev/docs/computer-use
 * @see https://github.com/e2b-dev/surf (reference implementation)
 */

import { quotaManager } from '../management/quota-manager'
import type { ToolResult } from '../sandbox/types'

// Dynamic import type for E2B Desktop SDK
type DesktopSandbox = any

// Desktop-specific configuration
const DESKTOP_DEFAULT_RESOLUTION = [1920, 1080] as [number, number]
const DESKTOP_DEFAULT_TIMEOUT = 300000 // 5 minutes

/**
 * AMP Session for conversation persistence
 */
export interface AmpSession {
  sessionId: string
  createdAt: number
  lastUsed: number
  task?: string
}

/**
 * MCP Configuration for tool integration
 */
export interface MCPConfig {
  [toolName: string]: {
    apiKey?: string
    projectId?: string
    [key: string]: any
  }
}

/**
 * Desktop sandbox handle for computer use operations
 */
export interface DesktopHandle {
  sessionId?: string
  sandboxId?: string
  // Desktop control methods
  screenshot(): Promise<Buffer>
  moveMouse(x: number, y: number): Promise<ToolResult>
  leftClick(x?: number, y?: number, button?: 'left' | 'right' | 'middle'): Promise<ToolResult>
  rightClick(x?: number, y?: number): Promise<ToolResult>
  middleClick?(x?: number, y?: number): Promise<ToolResult>
  type(text: string): Promise<ToolResult>
  write?(text: string): Promise<ToolResult> // Optional for compatibility adapters
  press(key: string | string[]): Promise<ToolResult>
}

// ==================== Desktop Action Types ====================
// Used for computer use agent interactions

/**
 * Mouse move action
 */
export interface MouseMoveAction {
  type: 'mouse_move'
  x: number
  y: number
}

/**
 * Left click action
 */
export interface LeftClickAction {
  type: 'left_click'
  x?: number
  y?: number
}

/**
 * Right click action
 */
export interface RightClickAction {
  type: 'right_click'
  x?: number
  y?: number
}

/**
 * Double click action
 */
export interface DoubleClickAction {
  type: 'double_click'
  x?: number
  y?: number
}

/**
 * Middle click action
 */
export interface MiddleClickAction {
  type: 'middle_click'
  x?: number
  y?: number
}

/**
 * Mouse drag action
 */
export interface DragAction {
  type: 'drag'
  startX: number
  startY: number
  endX: number
  endY: number
}

/**
 * Type text action
 */
export interface TypeAction {
  type: 'type'
  text: string
}

/**
 * Key press action
 */
export interface KeypressAction {
  type: 'keypress'
  keys: string[]
}

/**
 * Scroll action
 */
export interface ScrollAction {
  type: 'scroll'
  scrollY: number
}

/**
 * Screenshot action
 */
export interface ScreenshotAction {
  type: 'screenshot'
}

/**
 * Wait action
 */
export interface WaitAction {
  type: 'wait'
  duration: number
}

/**
 * Terminal command action
 */
export interface TerminalCommandAction {
  type: 'terminal_command'
  command: string
  cwd?: string
  timeout?: number
}

/**
 * Desktop action union type
 * All possible actions for computer use agents
 */
export type DesktopAction =
  | MouseMoveAction
  | LeftClickAction
  | RightClickAction
  | DoubleClickAction
  | MiddleClickAction
  | DragAction
  | TypeAction
  | KeypressAction
  | ScrollAction
  | ScreenshotAction
  | WaitAction
  | TerminalCommandAction

/**
 * Agent loop result for tracking desktop agent execution
 */
export interface AgentLoopResult {
  success: boolean
  action?: DesktopAction
  output?: string
  error?: string
  iteration: number
  screenshotBase64?: string
}

/**
 * Desktop statistics for monitoring
 */
export interface DesktopStats {
  id: string
  uptime: number
  actionCount: number
  actionsExecuted: number
  screenshotsTaken: number
  commandsRun: number
  lastActionAt?: number
  resolution: [number, number]
  streamUrl?: string
  mcpConfigured: boolean
  activeSessions: number
}

/**
 * Desktop sandbox handle with enhanced computer use capabilities
 */
export class DesktopSandboxHandle {
  readonly id: string
  readonly streamUrl?: string
  private sandbox: DesktopSandbox
  private ampSessions = new Map<string, AmpSession>()
  private mcpConfigured = false
  private mcpUrl?: string
  private mcpToken?: string

  constructor(sandbox: DesktopSandbox, streamUrl?: string) {
    this.sandbox = sandbox
    this.id = sandbox.id || `desktop-${Date.now()}`
    this.streamUrl = streamUrl
  }

  /**
   * Get VNC stream URL for browser-based desktop viewing
   */
  getStreamUrl(): string | undefined {
    return this.streamUrl
  }

  /**
   * Take a screenshot of the current desktop state
   * Returns Buffer containing PNG image data
   */
  async screenshot(): Promise<Buffer> {
    try {
      const img = await this.sandbox.screenshot()
      return img
    } catch (error: any) {
      console.error('[E2B Desktop] Screenshot error:', error)
      throw error
    }
  }

  /**
   * Take a screenshot and return as base64 (useful for LLM APIs)
   */
  async screenshotBase64(): Promise<string> {
    const buffer = await this.screenshot()
    return buffer.toString('base64')
  }

  // ==================== Mouse Actions ====================

  /**
   * Move mouse to specified coordinates
   */
  async moveMouse(x: number, y: number): Promise<ToolResult> {
    try {
      await this.sandbox.moveMouse(x, y)
      return { success: true, output: `Mouse moved to (${x}, ${y})` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Left click at specified coordinates (or current position)
   */
  async leftClick(x?: number, y?: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<ToolResult> {
    try {
      if (button === 'left') {
        await this.sandbox.leftClick(x, y)
      } else if (button === 'right') {
        await this.sandbox.rightClick(x, y)
      } else if (button === 'middle') {
        await this.sandbox.middleClick(x, y)
      }
      return { success: true, output: `${button} click at (${x ?? 'current'}, ${y ?? 'current'})` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Right click at specified coordinates (or current position)
   */
  async rightClick(x?: number, y?: number): Promise<ToolResult> {
    return this.leftClick(x, y, 'right')
  }

  /**
   * Double click at specified coordinates (or current position)
   */
  async doubleClick(x?: number, y?: number): Promise<ToolResult> {
    try {
      await this.sandbox.doubleClick(x, y)
      return { success: true, output: `Double click at (${x ?? 'current'}, ${y ?? 'current'})` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Drag mouse from start to end coordinates
   */
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<ToolResult> {
    try {
      await this.sandbox.drag([startX, startY], [endX, endY])
      return { success: true, output: `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Scroll up or down
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', ticks: number = 1): Promise<ToolResult> {
    try {
      await this.sandbox.scroll(direction, ticks)
      return { success: true, output: `Scrolled ${direction} ${ticks} tick(s)` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  // ==================== Keyboard Actions ====================

  /**
   * Type text (simulates keyboard input)
   */
  async type(text: string): Promise<ToolResult> {
    try {
      await this.sandbox.write(text)
      return { success: true, output: `Typed: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Press a key or key combination
   */
  async press(key: string | string[]): Promise<ToolResult> {
    try {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        await this.sandbox.press(k)
      }
      return { success: true, output: `Pressed: ${keys.join(' + ')}` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Press key combination (e.g., Ctrl+C, Alt+Tab)
   */
  async hotkey(...keys: string[]): Promise<ToolResult> {
    try {
      await this.sandbox.keyboard.hotkey(keys)
      return { success: true, output: `Hotkey: ${keys.join(' + ')}` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  // ==================== Clipboard Actions ====================

  /**
   * Read clipboard content
   */
  async clipboardRead(): Promise<ToolResult> {
    try {
      const text = await this.sandbox.clipboard.read()
      return { success: true, output: text }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Write to clipboard
   */
  async clipboardWrite(text: string): Promise<ToolResult> {
    try {
      await this.sandbox.clipboard.write(text)
      return { success: true, output: `Clipboard updated (${text.length} chars)` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  // ==================== AMP Integration with Sessions ====================

  /**
   * Run AMP (Amp Code) agent in the desktop sandbox
   * 
   * Enhanced features:
   * - Session persistence for follow-up tasks
   * - Schema-validated output for reliable pipelines
   * - Custom system prompts via CLAUDE.md
   * - Streaming JSON output for real-time monitoring
   * 
   * @see https://e2b.dev/docs/agents/amp
   */
  async runAmpAgent(
    task: string,
    options: {
      streamJson?: boolean
      sessionId?: string
      outputSchema?: any
      outputSchemaPath?: string
      systemPrompt?: string
      onEvent?: (event: any) => void
      timeout?: number
    } = {}
  ): Promise<{
    success: boolean
    output: string
    sessionId?: string
    events?: any[]
  }> {
    const events: any[] = []
    let sessionId = options.sessionId

    try {
      // Build AMP command with all options
      const ampCommandParts = [
        'amp',
        '--dangerously-skip-permissions',
      ]

      // Add session ID for conversation persistence
      if (options.sessionId) {
        ampCommandParts.push(`--session-id ${options.sessionId}`)
      }

      // Add output format
      ampCommandParts.push(options.streamJson ? '--output-format stream-json' : '--output-format json')

      // Add schema validation for reliable pipelines
      if (options.outputSchema || options.outputSchemaPath) {
        const schemaPath = options.outputSchemaPath || '/tmp/output-schema.json'
        ampCommandParts.push(`--output-schema ${schemaPath}`)
        
        // Write schema if provided inline
        if (options.outputSchema && !options.outputSchemaPath) {
          await this.sandbox.files.write(schemaPath, JSON.stringify(options.outputSchema))
        }
      }

      // Add custom system prompt via CLAUDE.md
      if (options.systemPrompt) {
        await this.sandbox.files.write('/home/user/CLAUDE.md', options.systemPrompt)
        ampCommandParts.push(`--system-prompt "${options.systemPrompt}"`)
      }

      // Add task
      ampCommandParts.push('-x', `"${task}"`)

      const ampCommand = ampCommandParts.filter(Boolean).join(' ')

      const result = await this.sandbox.commands.run(ampCommand, {
        timeout: options.timeout || 300000,
        onStdout: options.streamJson ? (data: string) => {
          // Parse streaming JSON events
          for (const line of data.split('\n').filter(Boolean)) {
            try {
              const event = JSON.parse(line)
              events.push(event)
              options.onEvent?.(event)

              // Track session ID from result events for continuation
              if (event.type === 'result' && event.session_id) {
                sessionId = event.session_id
                this.ampSessions.set(sessionId, {
                  sessionId,
                  createdAt: Date.now(),
                  lastUsed: Date.now(),
                  task,
                })
              }
            } catch {
              // Not JSON, ignore
            }
          }
        } : undefined,
      })

      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr || '',
        sessionId,
        events: options.streamJson ? events : undefined,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        sessionId,
        events: events.length > 0 ? events : undefined,
      }
    }
  }

  /**
   * List AMP sessions for conversation persistence
   */
  listAmpSessions(): AmpSession[] {
    return Array.from(this.ampSessions.values())
  }

  /**
   * Get MCP gateway URL
   * 
   * @see https://e2b.dev/docs/mcp
   */
  async getMcpUrl(): Promise<string> {
    if (this.mcpUrl) {
      return this.mcpUrl
    }
    
    // Get MCP gateway URL from sandbox
    this.mcpUrl = `https://mcp.${this.id}.e2b.dev`
    return this.mcpUrl
  }

  /**
   * Get MCP auth token
   */
  async getMcpToken(): Promise<string> {
    if (this.mcpToken) {
      return this.mcpToken
    }
    
    // Get MCP auth token
    const result = await this.sandbox.commands.run('e2b mcp token')
    this.mcpToken = result.stdout.trim()
    return this.mcpToken
  }

  /**
   * Setup MCP tools from Docker MCP Catalog
   * 
   * Provides access to 200+ tools from the Docker MCP Catalog
   * 
   * @see https://hub.docker.com/mcp
   */
  async setupMCP(config: MCPConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const mcpUrl = await this.getMcpUrl()
      const mcpToken = await this.getMcpToken()

      // Add each MCP tool
      for (const [toolName, toolConfig] of Object.entries(config)) {
        const envVars = Object.entries(toolConfig)
          .map(([k, v]) => `${k.toUpperCase()}=${v}`)
          .join(' ')

        await this.sandbox.commands.run(
          `claude mcp add --transport http ${toolName} ${mcpUrl} ` +
          `--header "Authorization: Bearer ${mcpToken}" ` +
          `--env "${envVars}"`
        )
      }

      this.mcpConfigured = true
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Check if MCP is configured
   */
  isMCPConfigured(): boolean {
    return this.mcpConfigured
  }

  // ==================== Stats & Lifecycle ====================

  /**
   * Check if desktop sandbox is still alive
   */
  isAlive(): boolean {
    // Sandbox is considered alive if it has an id and hasn't been killed
    return !!this.id && !!this.sandbox
  }

  /**
   * Get desktop statistics for monitoring
   */
  getStats(): DesktopStats {
    return {
      id: this.id,
      uptime: Date.now() - (this.sandbox?.createdAt || Date.now()),
      actionCount: 0,
      lastActionAt: undefined,
      resolution: DESKTOP_DEFAULT_RESOLUTION,
      streamUrl: this.streamUrl,
      mcpConfigured: this.mcpConfigured,
      activeSessions: this.ampSessions.size,
      actionsExecuted: 0,
      screenshotsTaken: 0,
      commandsRun: 0,
    } as any;
  }

  /**
   * Execute desktop action (mouse, keyboard, screenshot)
   */
  async executeAction(action: DesktopAction): Promise<ToolResult> {
    switch (action.type) {
      case 'mouse_move':
        return this.moveMouse(action.x, action.y)
      case 'left_click':
        return this.leftClick(action.x, action.y)
      case 'right_click':
        return this.rightClick(action.x, action.y)
      case 'double_click':
        return this.doubleClick(action.x, action.y)
      case 'drag':
        return this.drag(action.startX, action.startY, action.endX, action.endY);
      case 'scroll':
        return this.scroll(action.scrollY > 0 ? 'down' : 'up', Math.abs(action.scrollY))
      case 'type':
        return this.type(action.text)
      case 'keypress':
        return this.press(action.keys);
      case 'screenshot':
        const base64 = await this.screenshotBase64()
        return { success: true, output: `Screenshot taken (${base64.length} bytes)` }
      case 'middle_click':
        return this.leftClick(action.x, action.y, 'middle')
      case 'wait':
        await new Promise((resolve) => setTimeout(resolve, action.duration))
        return { success: true, output: `Waited ${action.duration}ms` }
      case 'terminal_command':
        return this.runCommand(action.command, action.cwd, action.timeout)
      default:
        return { success: false, output: `Unknown action type: ${(action as any).type}` }
    }
  }

  /**
   * Execute terminal command in the desktop sandbox
   */
  async runCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const result = await this.sandbox.commands.run(command, {
        cwd,
        timeout,
      })
      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr,
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      console.error('[E2B Desktop] Command error:', error)
      return {
        success: false,
        output: error.message,
        exitCode: -1,
      }
    }
  }

  /**
   * Run agent loop for desktop automation
   * Currently returns a helpful message with workaround instructions
   */
  async *runAgentLoop(task: string, options?: { maxIterations?: number }): AsyncGenerator<any> {
    // Placeholder implementation - yields task acknowledgment
    yield {
      type: 'agent_start',
      task,
      maxIterations: options?.maxIterations || 50,
    }

    // FIX: Provide actionable workaround instructions
    yield {
      type: 'agent_complete',
      message: 'Desktop agent loop is under development. Use individual action commands for now.',
      workaround: {
        screenshot: 'Use /screenshot to capture screen',
        click: 'Use /click x y to click at coordinates',
        type: 'Use /type text to type text',
        hotkey: 'Use /hotkey key1+key2 to press hotkeys',
        scroll: 'Use /scroll x y dx dy to scroll',
      },
      status: 'partial_implementation',
    }
  }

  /**
   * Kill the desktop sandbox
   */
  async kill(): Promise<void> {
    try {
      await this.sandbox.kill()
      console.log('[E2B Desktop] Sandbox killed')
    } catch (error: any) {
      console.error('[E2B Desktop] Kill error:', error)
    }
  }

  /**
   * Get sandbox info
   */
  async getInfo(): Promise<{
    id: string
    template: string
    resolution: [number, number]
    timeout: number
    streamUrl?: string
    mcpConfigured: boolean
    activeSessions: number
  }> {
    return {
      id: this.id,
      template: 'desktop',
      resolution: DESKTOP_DEFAULT_RESOLUTION,
      timeout: DESKTOP_DEFAULT_TIMEOUT,
      streamUrl: this.streamUrl,
      mcpConfigured: this.mcpConfigured,
      activeSessions: this.ampSessions.size,
    }
  }
}

/**
 * E2B Desktop Provider
 * Creates and manages desktop sandbox environments
 */
export class E2BDesktopProvider {
  readonly name = 'e2b-desktop'
  private apiKey?: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.E2B_API_KEY

    if (!this.apiKey) {
      console.warn('[E2BDesktopProvider] E2B_API_KEY not set')
    }
  }

  /**
   * Create a new desktop sandbox with VNC streaming
   *
   * @param config - Configuration options
   * @param config.template - Desktop template ID (default: 'desktop')
   * @param config.resolution - Screen resolution [width, height] (default: [1920, 1080])
   * @param config.dpi - Screen DPI (default: 96)
   * @param config.timeoutMs - Session timeout in milliseconds (default: 300000)
   * @param config.startStreaming - Start VNC streaming (default: true)
   */
  async createDesktop(config: {
    template?: string
    resolution?: [number, number]
    dpi?: number
    timeoutMs?: number
    startStreaming?: boolean
  } = {}): Promise<DesktopSandboxHandle> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY is not configured')
    }

    try {
      // Dynamic import to avoid requiring @e2b/desktop when not used
      const { Sandbox }: any = await import('@e2b/desktop')

      const sandbox: any = await Sandbox.create({
        template: config.template || 'desktop',
        timeoutMs: config.timeoutMs || DESKTOP_DEFAULT_TIMEOUT,
        resolution: config.resolution || DESKTOP_DEFAULT_RESOLUTION,
        dpi: config.dpi || 96,
      })

      let streamUrl: string | undefined

      // Start VNC streaming if requested
      if (config.startStreaming !== false) {
        streamUrl = (await sandbox.screen?.getStreamUrl()) || (await (sandbox as any).display?.getStreamUrl());
        console.log(`[E2BDesktopProvider] VNC stream available at: ${streamUrl}`)
      }

      // Record usage
      quotaManager.recordUsage('e2b', 1)

      console.log(`[E2BDesktopProvider] Created desktop sandbox ${sandbox.id || 'unknown'}`)

      return new DesktopSandboxHandle(sandbox, streamUrl);
    } catch (error: any) {
      console.error('[E2BDesktopProvider] Failed to create desktop:', error)
      throw new Error(`Failed to create E2B Desktop: ${error.message}`)
    }
  }
}

// Export singleton instance
export const e2bDesktopProvider = new E2BDesktopProvider()

/**
 * Desktop session manager for tracking active desktops
 */
export const desktopSessionManager = {
  sessions: new Map<string, DesktopSandboxHandle>(),

  async createSession(
    sessionId: string,
    config?: {
      template?: string
      resolution?: [number, number]
      dpi?: number
      timeoutMs?: number
      startStreaming?: boolean
      autoCleanup?: boolean
    }
  ): Promise<DesktopSandboxHandle> {
    const desktop = await e2bDesktopProvider.createDesktop(config)
    this.sessions.set(sessionId, desktop)
    return desktop
  },

  getSession(sessionId: string): DesktopSandboxHandle | undefined {
    return this.sessions.get(sessionId)
  },

  async destroySession(sessionId: string): Promise<void> {
    const desktop = this.sessions.get(sessionId)
    if (desktop) {
      await desktop.kill()
      this.sessions.delete(sessionId)
    }
  },

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  },
}

/**
 * Execute desktop command via API route helper
 */
export async function executeDesktopCommand(
  sessionId: string,
  action: 'screenshot' | 'click' | 'type' | 'keypress' | 'move' | 'drag' | 'clipboard_read' | 'clipboard_write',
  params: Record<string, any>
): Promise<ToolResult> {
  const desktop = desktopSessionManager.getSession(sessionId)

  if (!desktop) {
    return {
      success: false,
      output: `Desktop session not found: ${sessionId}`,
    }
  }

  try {
    switch (action) {
      case 'screenshot': {
        const screenshot: any = await desktop.screenshot()
        return {
          success: true,
          output: `Screenshot captured (${screenshot?.length || 0} bytes)`,
          binary: screenshot,
        }
      }

      case 'click': {
        const { x, y, button = 'left' } = params
        return await desktop.leftClick(x, y, button)
      }

      case 'type': {
        return await desktop.type(params.text || '')
      }

      case 'keypress': {
        return await desktop.press(params.key || params.keys || [])
      }

      case 'move': {
        return await desktop.moveMouse(params.x || 0, params.y || 0)
      }

      case 'drag': {
        return await desktop.drag(params.startX || 0, params.startY || 0, params.endX || 0, params.endY || 0)
      }

      case 'clipboard_read': {
        return await desktop.clipboardRead()
      }

      case 'clipboard_write': {
        return await desktop.clipboardWrite(params.text || '')
      }

      default:
        return {
          success: false,
          output: `Unknown desktop action: ${action}`,
        }
    }
  } catch (error: any) {
    return {
      success: false,
      output: `Desktop action failed: ${error.message}`,
    }
  }
}
