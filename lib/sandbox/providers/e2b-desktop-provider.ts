/**
 * E2B Desktop Provider - Computer Use Agent Support
 * 
 * Provides desktop sandbox environments with VNC streaming and computer use capabilities
 * for AI agents that need to interact with graphical user interfaces.
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
 * 
 * Note: Uses dynamic imports for @e2b/desktop to avoid
 * app failures when the package is not installed.
 */

import { quotaManager } from '@/lib/services/quota-manager'
import type { ToolResult } from '../types'

// Dynamic import type for E2B Desktop Sandbox
type E2BDesktopSandboxType = any

// Desktop-specific configuration
const DESKTOP_DEFAULT_RESOLUTION = [1024, 720] as [number, number]
const DESKTOP_DEFAULT_DPI = 96
const DESKTOP_DEFAULT_TIMEOUT = 300000 // 5 minutes
const DESKTOP_TEMPLATE = 'desktop'

/**
 * Desktop action types for computer use agents
 */
export interface DesktopAction {
  type: 'mouse_move' | 'left_click' | 'right_click' | 'double_click' | 'middle_click' |
        'drag' | 'type' | 'keypress' | 'scroll' | 'screenshot' | 'wait'
  
  // Mouse actions
  x?: number
  y?: number
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  
  // Keyboard actions
  text?: string
  keys?: string | string[]
  
  // Scroll action
  scrollY?: number
  
  // Wait action
  duration?: number
}

/**
 * Desktop sandbox handle with computer use capabilities
 */
export class DesktopSandboxHandle {
  readonly id: string
  readonly streamUrl?: string
  private sandbox: DesktopSandbox
  private codeSandbox?: CodeSandbox

  constructor(sandbox: DesktopSandbox, streamUrl?: string) {
    this.sandbox = sandbox
    this.id = sandbox.sandboxId
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
      const screenshot = await this.sandbox.screenshot()
      return Buffer.from(screenshot)
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
  async leftClick(x?: number, y?: number): Promise<ToolResult> {
    try {
      if (x !== undefined && y !== undefined) {
        await this.sandbox.moveMouse(x, y)
      }
      await this.sandbox.leftClick()
      return { success: true, output: `Left click at (${x ?? 'current'}, ${y ?? 'current'})` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Right click at specified coordinates (or current position)
   */
  async rightClick(x?: number, y?: number): Promise<ToolResult> {
    try {
      if (x !== undefined && y !== undefined) {
        await this.sandbox.moveMouse(x, y)
      }
      await this.sandbox.rightClick()
      return { success: true, output: `Right click at (${x ?? 'current'}, ${y ?? 'current'})` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Double click at specified coordinates (or current position)
   */
  async doubleClick(x?: number, y?: number): Promise<ToolResult> {
    try {
      if (x !== undefined && y !== undefined) {
        await this.sandbox.moveMouse(x, y)
      }
      await this.sandbox.doubleClick()
      return { success: true, output: `Double click at (${x ?? 'current'}, ${y ?? 'current'})` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Middle click at specified coordinates (or current position)
   */
  async middleClick(x?: number, y?: number): Promise<ToolResult> {
    try {
      if (x !== undefined && y !== undefined) {
        await this.sandbox.moveMouse(x, y)
      }
      await this.sandbox.middleClick()
      return { success: true, output: `Middle click at (${x ?? 'current'}, ${y ?? 'current'})` }
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
   * @param direction 'up' or 'down'
   * @param ticks Number of scroll ticks (default: 1)
   */
  async scroll(direction: 'up' | 'down', ticks: number = 1): Promise<ToolResult> {
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
   * @param keys Key name (e.g., 'Enter', 'Control_L', 'Alt_L', 'Return')
   */
  async press(keys: string | string[]): Promise<ToolResult> {
    try {
      const keyArray = Array.isArray(keys) ? keys : [keys]
      for (const key of keyArray) {
        await this.sandbox.press(key)
      }
      return { success: true, output: `Pressed: ${keyArray.join(' + ')}` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Press key combination (e.g., Ctrl+C, Alt+Tab)
   */
  async hotkey(...keys: string[]): Promise<ToolResult> {
    return this.press(keys)
  }

  // ==================== Combined Actions ====================

  /**
   * Execute a desktop action (useful for agent loops)
   */
  async executeAction(action: DesktopAction): Promise<ToolResult> {
    switch (action.type) {
      case 'mouse_move':
        if (action.x !== undefined && action.y !== undefined) {
          return this.moveMouse(action.x, action.y)
        }
        return { success: false, output: 'Missing x/y coordinates for mouse_move' }

      case 'left_click':
        return this.leftClick(action.x, action.y)

      case 'right_click':
        return this.rightClick(action.x, action.y)

      case 'double_click':
        return this.doubleClick(action.x, action.y)

      case 'middle_click':
        return this.middleClick(action.x, action.y)

      case 'drag':
        if (action.startX !== undefined && action.startY !== undefined &&
            action.endX !== undefined && action.endY !== undefined) {
          return this.drag(action.startX, action.startY, action.endX, action.endY)
        }
        return { success: false, output: 'Missing coordinates for drag' }

      case 'type':
        if (action.text) {
          return this.type(action.text)
        }
        return { success: false, output: 'Missing text for type action' }

      case 'keypress':
        if (action.keys) {
          return this.press(action.keys)
        }
        return { success: false, output: 'Missing keys for keypress action' }

      case 'scroll':
        if (action.scrollY !== undefined) {
          const direction = action.scrollY < 0 ? 'up' : 'down'
          return this.scroll(direction, Math.abs(action.scrollY))
        }
        return { success: false, output: 'Missing scrollY for scroll action' }

      case 'screenshot':
        const screenshot = await this.screenshot()
        return { 
          success: true, 
          output: `Screenshot captured (${screenshot.length} bytes)`,
          data: screenshot.toString('base64')
        }

      case 'wait':
        if (action.duration) {
          await new Promise(resolve => setTimeout(resolve, action.duration))
          return { success: true, output: `Waited ${action.duration}ms` }
        }
        return { success: false, output: 'Missing duration for wait action' }

      default:
        return { success: false, output: `Unknown action type: ${(action as any).type}` }
    }
  }

  /**
   * Execute multiple actions in sequence
   */
  async executeActions(actions: DesktopAction[]): Promise<ToolResult[]> {
    const results: ToolResult[] = []
    for (const action of actions) {
      const result = await this.executeAction(action)
      results.push(result)
      if (!result.success) {
        break
      }
    }
    return results
  }

  // ==================== Terminal Commands ====================

  /**
   * Run terminal command in the desktop sandbox
   */
  async runCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const result = await this.sandbox.commands.run(command, {
        cwd: cwd || '/home/user',
        timeout: timeout || 60000,
      })
      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr || '',
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  // ==================== Computer Use Agent Loop ====================

  /**
   * Run computer use agent loop
   * Takes screenshots, gets actions from LLM, and executes them
   * 
   * @param getActionFromLLM - Function that takes screenshot and returns next action
   * @param maxIterations - Maximum number of iterations (default: 50)
   * @param onIteration - Optional callback called after each iteration
   */
  async runAgentLoop(
    getActionFromLLM: (screenshotBase64: string, iteration: number) => Promise<DesktopAction | null>,
    maxIterations: number = 50,
    onIteration?: (iteration: number, action: DesktopAction | null, result: ToolResult) => void
  ): Promise<{ completed: boolean; iterations: number; lastError?: string }> {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      try {
        // 1. Capture desktop state
        const screenshotBase64 = await this.screenshotBase64()

        // 2. Get next action from LLM
        const action = await getActionFromLLM(screenshotBase64, iteration)

        // LLM signals task is complete
        if (!action) {
          console.log(`[E2B Desktop] Agent completed task after ${iteration + 1} iterations`)
          return { completed: true, iterations: iteration + 1 }
        }

        // 3. Execute action
        const result = await this.executeAction(action)

        // Call iteration callback
        onIteration?.(iteration, action, result)

        if (!result.success) {
          console.error(`[E2B Desktop] Action failed at iteration ${iteration + 1}:`, result.output)
          return { completed: false, iterations: iteration + 1, lastError: result.output }
        }

        // Small delay between actions
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error: any) {
        console.error(`[E2B Desktop] Error at iteration ${iteration + 1}:`, error)
        return { completed: false, iterations: iteration + 1, lastError: error.message }
      }
    }

    console.warn(`[E2B Desktop] Agent reached max iterations (${maxIterations})`)
    return { completed: false, iterations: maxIterations, lastError: 'Max iterations reached' }
  }

  // ==================== Lifecycle ====================

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
   * Extend sandbox timeout
   */
  async setTimeout(timeoutMs: number): Promise<void> {
    try {
      await this.sandbox.setTimeout(timeoutMs)
    } catch (error: any) {
      console.error('[E2B Desktop] SetTimeout error:', error)
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
  }> {
    return {
      id: this.sandbox.sandboxId,
      template: DESKTOP_TEMPLATE,
      resolution: DESKTOP_DEFAULT_RESOLUTION,
      timeout: this.sandbox.timeout,
      streamUrl: this.streamUrl,
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
  private defaultTimeout: number
  private defaultResolution: [number, number]
  private defaultDpi: number
  private desktopModule?: any
  private moduleLoadError?: string

  constructor() {
    this.apiKey = process.env.E2B_API_KEY
    this.defaultTimeout = parseInt(process.env.E2B_DESKTOP_TIMEOUT || DESKTOP_DEFAULT_TIMEOUT.toString())
    this.defaultResolution = DESKTOP_DEFAULT_RESOLUTION
    this.defaultDpi = DESKTOP_DEFAULT_DPI

    if (!this.apiKey) {
      console.warn('[E2BDesktopProvider] E2B_API_KEY not set')
    }
  }

  /**
   * Lazily load E2B Desktop SDK module
   */
  private async ensureDesktopModule(): Promise<void> {
    if (this.desktopModule) return
    if (this.moduleLoadError) throw new Error(this.moduleLoadError)

    try {
      this.desktopModule = await import('@e2b/desktop')
    } catch (error: any) {
      this.moduleLoadError = `@e2b/desktop not installed. Run: npm install @e2b/desktop`
      console.error('[E2BDesktopProvider]', this.moduleLoadError)
      throw new Error(this.moduleLoadError)
    }
  }

  /**
   * Create a new desktop sandbox with VNC streaming
   */
  async createDesktop(config?: {
    resolution?: [number, number]
    dpi?: number
    timeoutMs?: number
    startStreaming?: boolean
  }): Promise<DesktopSandboxHandle> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY is not configured')
    }

    // Ensure desktop module is loaded
    await this.ensureDesktopModule()

    // Check quota
    if (!quotaManager.isAvailable('e2b')) {
      const remaining = quotaManager.getRemainingCalls('e2b')
      throw new Error(`E2B quota exceeded. Remaining: ${remaining}`)
    }

    try {
      const Sandbox = this.desktopModule.Sandbox

      const sandbox: E2BDesktopSandboxType = await Sandbox.create({
        resolution: config?.resolution || this.defaultResolution,
        dpi: config?.dpi ?? this.defaultDpi,
        timeoutMs: config?.timeoutMs ?? this.defaultTimeout,
      })

      let streamUrl: string | undefined

      // Start VNC streaming if requested
      if (config?.startStreaming !== false) {
        await sandbox.stream.start()
        streamUrl = sandbox.stream.getUrl()
        console.log(`[E2BDesktopProvider] VNC stream available at: ${streamUrl}`)
      }

      // Record usage
      quotaManager.recordUsage('e2b', 1)

      console.log(`[E2BDesktopProvider] Created desktop sandbox ${sandbox.sandboxId}`)

      return new DesktopSandboxHandle(sandbox, streamUrl)
    } catch (error: any) {
      console.error('[E2BDesktopProvider] Failed to create desktop:', error)
      
      if (error.message?.includes('authentication') || 
          error.message?.includes('template') ||
          error.message?.includes('unauthorized')) {
        quotaManager.findAlternative('sandbox', 'e2b')
      }
      
      throw error
    }
  }

  /**
   * Connect to existing desktop sandbox
   */
  async getDesktop(sandboxId: string): Promise<DesktopSandboxHandle> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY is not configured')
    }

    // Ensure desktop module is loaded
    await this.ensureDesktopModule()

    try {
      const Sandbox = this.desktopModule.Sandbox

      const sandbox = await Sandbox.connect(sandboxId)
      return new DesktopSandboxHandle(sandbox, undefined)
    } catch (error: any) {
      console.error('[E2BDesktopProvider] Failed to get desktop:', error)
      throw error
    }
  }

  /**
   * Destroy desktop sandbox
   */
  async destroyDesktop(sandboxId: string): Promise<void> {
    if (!this.apiKey) {
      return
    }

    // Ensure desktop module is loaded
    await this.ensureDesktopModule()

    try {
      const Sandbox = this.desktopModule.Sandbox

      const sandbox = await Sandbox.connect(sandboxId)
      await sandbox.kill()
      console.log(`[E2BDesktopProvider] Destroyed desktop ${sandboxId}`)
    } catch (error: any) {
      if (error.message?.includes('not found') || error.message?.includes('closed')) {
        return
      }
      throw error
    }
  }
}

// Export singleton instance
export const e2bDesktopProvider = new E2BDesktopProvider()
