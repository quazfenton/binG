/**
 * Daytona Computer Use Service
 *
 * Provides computer use capabilities for AI agents to interact with
 * graphical desktop environments via Daytona's Computer Use API.
 *
 * Features:
 * - Mouse operations (click, move, drag, scroll, get position)
 * - Keyboard operations (type, press, hotkey)
 * - Screenshot operations (full screen, region, compressed)
 * - Screen recording (start, stop, list, download)
 * - Display operations (get info, get windows)
 *
 * @see https://www.daytona.io/docs/en/computer-use.md
 */

import type { ToolResult } from '../types'

// Computer Use API types
export interface MouseClickRequest {
  x?: number
  y?: number
  button?: 'left' | 'right' | 'middle'
}

export interface MouseMoveRequest {
  x: number
  y: number
}

export interface MouseDragRequest {
  startX: number
  startY: number
  endX: number
  endY: number
}

export interface MouseScrollRequest {
  direction: 'up' | 'down' | 'left' | 'right'
  ticks?: number
}

export interface KeyboardTypeRequest {
  text: string
  delay?: number
}

export interface KeyboardPressRequest {
  keys: string | string[]
}

export interface ScreenshotRequest {
  region?: {
    x: number
    y: number
    width: number
    height: number
  }
  quality?: number
}

export interface ScreenRecordingRequest {
  path?: string
  duration?: number
}

export interface ComputerUseStatus {
  active: boolean
  processId?: string
  display?: number
  errorMessage?: string
}

/**
 * Daytona Computer Use Service
 */
export class ComputerUseService {
  private sandboxId: string
  private apiBaseUrl: string
  private apiKey: string

  constructor(sandboxId: string, apiKey: string, apiBaseUrl: string = 'https://app.daytona.io/api') {
    this.sandboxId = sandboxId
    this.apiKey = apiKey
    this.apiBaseUrl = apiBaseUrl
  }

  /**
   * Get computer use status
   */
  async getStatus(): Promise<ComputerUseStatus> {
    const response = await fetch(
      `${this.apiBaseUrl}/computer-use/${this.sandboxId}/status`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`)
    }

    return response.json()
  }

  // ==================== Mouse Operations ====================

  /**
   * Click mouse at specified coordinates
   */
  async click(options: MouseClickRequest): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/mouse/click`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Click failed: ${response.statusText}`)
      }

      const coords = options.x !== undefined && options.y !== undefined
        ? `(${options.x}, ${options.y})`
        : 'current position'

      return {
        success: true,
        output: `Clicked ${options.button || 'left'} button at ${coords}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Click failed: ${error.message}`,
      }
    }
  }

  /**
   * Move mouse to specified coordinates
   */
  async move(options: MouseMoveRequest): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/mouse/move`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Move failed: ${response.statusText}`)
      }

      return {
        success: true,
        output: `Mouse moved to (${options.x}, ${options.y})`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Move failed: ${error.message}`,
      }
    }
  }

  /**
   * Drag mouse from start to end coordinates
   */
  async drag(options: MouseDragRequest): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/mouse/drag`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Drag failed: ${response.statusText}`)
      }

      return {
        success: true,
        output: `Dragged from (${options.startX}, ${options.startY}) to (${options.endX}, ${options.endY})`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Drag failed: ${error.message}`,
      }
    }
  }

  /**
   * Scroll in specified direction
   */
  async scroll(options: MouseScrollRequest): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/mouse/scroll`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Scroll failed: ${response.statusText}`)
      }

      return {
        success: true,
        output: `Scrolled ${options.direction} ${options.ticks || 1} tick(s)`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Scroll failed: ${error.message}`,
      }
    }
  }

  /**
   * Get current mouse position
   */
  async getPosition(): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/mouse/position`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Get position failed: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        success: true,
        output: `Mouse position: (${data.x}, ${data.y})`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Get position failed: ${error.message}`,
      }
    }
  }

  // ==================== Keyboard Operations ====================

  /**
   * Type text
   */
  async type(options: KeyboardTypeRequest): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/keyboard/type`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Type failed: ${response.statusText}`)
      }

      return {
        success: true,
        output: `Typed: ${options.text.substring(0, 50)}${options.text.length > 50 ? '...' : ''}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Type failed: ${error.message}`,
      }
    }
  }

  /**
   * Press key or key combination
   */
  async press(options: KeyboardPressRequest): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/keyboard/press`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            keys: Array.isArray(options.keys) ? options.keys : [options.keys],
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`Press failed: ${response.statusText}`)
      }

      const keys = Array.isArray(options.keys) ? options.keys : [options.keys]
      return {
        success: true,
        output: `Pressed: ${keys.join(' + ')}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Press failed: ${error.message}`,
      }
    }
  }

  /**
   * Press hotkey combination
   */
  async hotkey(...keys: string[]): Promise<ToolResult> {
    return this.press({ keys })
  }

  // ==================== Screenshot Operations ====================

  /**
   * Take full screen screenshot
   */
  async takeFullScreen(): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/screenshot`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Screenshot failed: ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      return {
        success: true,
        output: `Screenshot captured (${buffer.length} bytes)`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Screenshot failed: ${error.message}`,
      }
    }
  }

  /**
   * Take screenshot of specified region
   */
  async takeRegion(options: { x: number; y: number; width: number; height: number }): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/screenshot/region`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Region screenshot failed: ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      return {
        success: true,
        output: `Region screenshot captured (${buffer.length} bytes)`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Region screenshot failed: ${error.message}`,
      }
    }
  }

  /**
   * Take compressed screenshot
   */
  async takeCompressed(options: { quality?: number } = {}): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/screenshot/compressed`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Compressed screenshot failed: ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      return {
        success: true,
        output: `Compressed screenshot captured (${buffer.length} bytes)`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Compressed screenshot failed: ${error.message}`,
      }
    }
  }

  // ==================== Screen Recording ====================

  /**
   * Start screen recording
   */
  async startRecording(options: ScreenRecordingRequest = {}): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/recording`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options),
        }
      )

      if (!response.ok) {
        throw new Error(`Start recording failed: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        success: true,
        output: `Recording started: ${data.recordingId}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Start recording failed: ${error.message}`,
      }
    }
  }

  /**
   * Stop screen recording
   */
  async stopRecording(recordingId: string): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/recording/${recordingId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Stop recording failed: ${response.statusText}`)
      }

      return {
        success: true,
        output: `Recording stopped: ${recordingId}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Stop recording failed: ${error.message}`,
      }
    }
  }

  /**
   * List recordings
   */
  async listRecordings(): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/recordings`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`List recordings failed: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        success: true,
        output: `Found ${data.recordings?.length || 0} recording(s)`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `List recordings failed: ${error.message}`,
      }
    }
  }

  /**
   * Get recording info
   */
  async getRecording(recordingId: string): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/recordings/${recordingId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Get recording failed: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        success: true,
        output: `Recording: ${recordingId}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Get recording failed: ${error.message}`,
      }
    }
  }

  /**
   * Delete recording
   */
  async deleteRecording(recordingId: string): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/recordings/${recordingId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Delete recording failed: ${response.statusText}`)
      }

      return {
        success: true,
        output: `Recording deleted: ${recordingId}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Delete recording failed: ${error.message}`,
      }
    }
  }

  /**
   * Download recording
   */
  async downloadRecording(recordingId: string): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/recordings/${recordingId}/download`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Download recording failed: ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      return {
        success: true,
        output: `Recording downloaded (${buffer.length} bytes)`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Download recording failed: ${error.message}`,
      }
    }
  }

  // ==================== Display Operations ====================

  /**
   * Get display info
   */
  async getDisplayInfo(): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/display`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Get display info failed: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        success: true,
        output: `Display: ${data.width}x${data.height}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Get display info failed: ${error.message}`,
      }
    }
  }

  /**
   * Get open windows
   */
  async getWindows(): Promise<ToolResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/computer-use/${this.sandboxId}/display/windows`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Get windows failed: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        success: true,
        output: `Found ${data.windows?.length || 0} window(s)`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Get windows failed: ${error.message}`,
      }
    }
  }
}

/**
 * Factory function to create Computer Use Service
 */
export function createComputerUseService(
  sandboxId: string,
  apiKey: string,
  apiBaseUrl?: string
): ComputerUseService {
  return new ComputerUseService(sandboxId, apiKey, apiBaseUrl)
}
