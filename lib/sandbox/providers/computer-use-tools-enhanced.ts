/**
 * Enhanced Computer Use Tools
 *
 * Comprehensive tool definitions for desktop interaction
 * Compatible with Vercel AI SDK, OpenAI, Anthropic, and other LLM providers
 *
 * Features:
 * - Type-safe tool definitions
 * - Automatic action conversion
 * - System prompt generation
 * - Multi-provider support
 * - Error handling and validation
 */

import type { Tool } from 'ai'
import type { DesktopAction } from './e2b-desktop-provider-enhanced'

// ==================== Tool Definitions ====================

/**
 * Mouse movement tool
 */
export const mouseMoveTool: Tool = {
  description: 'Move the mouse cursor to specified coordinates on the screen',
  parameters: {
    type: 'object',
    properties: {
      x: {
        type: 'number',
        description: 'X coordinate (horizontal position). Range: 0-1920 for typical screens.',
      },
      y: {
        type: 'number',
        description: 'Y coordinate (vertical position). Range: 0-1080 for typical screens.',
      },
    },
    required: ['x', 'y'],
  },
  execute: async ({ x, y }: { x: number; y: number }) => ({
    type: 'mouse_move' as const,
    x,
    y,
  }),
}

/**
 * Left click tool
 */
export const leftClickTool: Tool = {
  description: 'Perform a left mouse click at the specified or current position. Use for selecting items, clicking buttons, etc.',
  parameters: {
    type: 'object',
    properties: {
      x: {
        type: 'number',
        description: 'X coordinate (optional - uses current position if not specified)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate (optional - uses current position if not specified)',
      },
    },
  },
  execute: async ({ x, y }: { x?: number; y?: number } = {}) => ({
    type: 'left_click' as const,
    x,
    y,
  }),
}

/**
 * Right click tool
 */
export const rightClickTool: Tool = {
  description: 'Perform a right mouse click to open context menus',
  parameters: {
    type: 'object',
    properties: {
      x: {
        type: 'number',
        description: 'X coordinate (optional)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate (optional)',
      },
    },
  },
  execute: async ({ x, y }: { x?: number; y?: number } = {}) => ({
    type: 'right_click' as const,
    x,
    y,
  }),
}

/**
 * Double click tool
 */
export const doubleClickTool: Tool = {
  description: 'Perform a double left click. Use to open files, folders, or applications.',
  parameters: {
    type: 'object',
    properties: {
      x: {
        type: 'number',
        description: 'X coordinate (optional)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate (optional)',
      },
    },
  },
  execute: async ({ x, y }: { x?: number; y?: number } = {}) => ({
    type: 'double_click' as const,
    x,
    y,
  }),
}

/**
 * Mouse drag tool
 */
export const dragMouseTool: Tool = {
  description: 'Drag the mouse from one position to another. Use for moving windows, selecting text, or drawing.',
  parameters: {
    type: 'object',
    properties: {
      startX: {
        type: 'number',
        description: 'Starting X coordinate',
      },
      startY: {
        type: 'number',
        description: 'Starting Y coordinate',
      },
      endX: {
        type: 'number',
        description: 'Ending X coordinate',
      },
      endY: {
        type: 'number',
        description: 'Ending Y coordinate',
      },
    },
    required: ['startX', 'startY', 'endX', 'endY'],
  },
  execute: async ({ startX, startY, endX, endY }: { startX: number; startY: number; endX: number; endY: number }) => ({
    type: 'drag' as const,
    startX,
    startY,
    endX,
    endY,
  }),
}

/**
 * Scroll tool
 */
export const scrollTool: Tool = {
  description: 'Scroll up or down in the current window',
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: 'Direction to scroll',
      },
      ticks: {
        type: 'number',
        description: 'Number of scroll ticks (default: 1)',
        default: 1,
      },
    },
    required: ['direction'],
  },
  execute: async ({ direction, ticks = 1 }: { direction: 'up' | 'down'; ticks?: number }) => ({
    type: 'scroll' as const,
    scrollY: direction === 'down' ? ticks : -ticks,
  }),
}

/**
 * Type text tool
 */
export const typeTextTool: Tool = {
  description: 'Type text using the keyboard. Simulates human typing. Use for entering text in input fields, search boxes, etc.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to type',
      },
    },
    required: ['text'],
  },
  execute: async ({ text }: { text: string }) => ({
    type: 'type' as const,
    text,
  }),
}

/**
 * Press key tool
 */
export const pressKeyTool: Tool = {
  description: 'Press a key or key combination. Use for special keys (Enter, Tab, Escape) or shortcuts (Ctrl+C, Alt+Tab).',
  parameters: {
    type: 'object',
    properties: {
      keys: {
        type: 'array',
        items: {
          type: 'string',
          description: 'Key name (e.g., "Enter", "Control_L", "Alt_L", "Tab", "Escape", "arrow_up")',
        },
        description: 'Key or keys to press (for combinations like Ctrl+C, use ["Control_L", "c"])',
      },
    },
    required: ['keys'],
  },
  execute: async ({ keys }: { keys: string[] }) => ({
    type: 'keypress' as const,
    keys,
  }),
}

/**
 * Screenshot tool
 */
export const screenshotTool: Tool = {
  description: 'Take a screenshot of the current desktop state. Returns base64-encoded PNG image. Always use this first to understand the desktop state.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => ({
    type: 'screenshot' as const,
  }),
}

/**
 * Wait tool
 */
export const waitTool: Tool = {
  description: 'Wait for a specified duration. Use to allow time for animations, page loads, or application startup.',
  parameters: {
    type: 'object',
    properties: {
      duration: {
        type: 'number',
        description: 'Duration to wait in milliseconds (e.g., 1000 for 1 second)',
      },
    },
    required: ['duration'],
  },
  execute: async ({ duration }: { duration: number }) => ({
    type: 'wait' as const,
    duration,
  }),
}

/**
 * Terminal command tool
 */
export const terminalCommandTool: Tool = {
  description: 'Execute a terminal command in the Linux desktop environment. Use for running scripts, installing packages, file operations, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The terminal command to execute (e.g., "ls -la", "firefox &", "pip install package")',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (default: /home/user)',
      },
      timeout: {
        type: 'number',
        description: 'Command timeout in milliseconds (default: 60000)',
      },
    },
    required: ['command'],
  },
  execute: async ({ command, cwd, timeout }: { command: string; cwd?: string; timeout?: number }) => ({
    type: 'terminal_command' as const,
    command,
    cwd,
    timeout,
  }),
}

// ==================== Tool Collection ====================

/**
 * All computer use tools
 * Export for use with Vercel AI SDK
 */
export const computerUseTools = {
  mouse_move: mouseMoveTool,
  left_click: leftClickTool,
  right_click: rightClickTool,
  double_click: doubleClickTool,
  drag_mouse: dragMouseTool,
  scroll: scrollTool,
  type_text: typeTextTool,
  press_key: pressKeyTool,
  take_screenshot: screenshotTool,
  wait: waitTool,
  run_terminal_command: terminalCommandTool,
}

// ==================== Action Conversion ====================

/**
 * Convert tool result to DesktopAction
 */
export function toolResultToAction(toolResult: any): DesktopAction | null {
  if (!toolResult || typeof toolResult !== 'object') {
    return null
  }

  const { type } = toolResult
  if (!type || typeof type !== 'string') {
    return null
  }

  // Validate action type
  const validTypes = [
    'mouse_move', 'left_click', 'right_click', 'double_click', 'middle_click',
    'drag', 'type', 'keypress', 'scroll', 'screenshot', 'wait', 'terminal_command',
  ]

  if (!validTypes.includes(type)) {
    return null
  }

  return toolResult as DesktopAction
}

/**
 * Convert tool call to DesktopAction (for OpenAI/Anthropic tool calling)
 */
export function toolCallToAction(
  toolName: string,
  args: Record<string, any>
): DesktopAction | null {
  switch (toolName) {
    case 'mouse_move':
      return {
        type: 'mouse_move',
        x: args.x,
        y: args.y,
      }

    case 'left_click':
      return {
        type: 'left_click',
        x: args.x,
        y: args.y,
      }

    case 'right_click':
      return {
        type: 'right_click',
        x: args.x,
        y: args.y,
      }

    case 'double_click':
      return {
        type: 'double_click',
        x: args.x,
        y: args.y,
      }

    case 'drag_mouse':
      return {
        type: 'drag',
        startX: args.startX,
        startY: args.startY,
        endX: args.endX,
        endY: args.endY,
      }

    case 'scroll': {
      const ticks = typeof args.ticks === 'number' && Number.isFinite(args.ticks) ? args.ticks : 1
      return {
        type: 'scroll',
        scrollY: args.direction === 'down' ? ticks : -ticks,
      }
    }

    case 'type_text':
      return {
        type: 'type',
        text: args.text,
      }

    case 'press_key':
      return {
        type: 'keypress',
        keys: args.keys,
      }

    case 'take_screenshot':
      return {
        type: 'screenshot',
      }

    case 'wait':
      return {
        type: 'wait',
        duration: args.duration,
      }

    case 'run_terminal_command':
      return {
        type: 'terminal_command',
        command: args.command,
        cwd: args.cwd,
        timeout: args.timeout,
      }

    default:
      return null
  }
}

// ==================== System Prompt ====================

/**
 * Get system prompt for computer use agents
 * Comprehensive prompt with guidelines, coordinate system, and key names
 */
export function getComputerUseSystemPrompt(options?: {
  includeExamples?: boolean
  includeTips?: boolean
  customInstructions?: string
}): string {
  const includeExamples = options?.includeExamples ?? true
  const includeTips = options?.includeTips ?? true
  const customInstructions = options?.customInstructions ?? ''

  let prompt = `You are a computer use AI agent that can interact with a Linux desktop environment (Ubuntu 22.04 with XFCE).

## Your Capabilities

You have access to these tools:
- **mouse_move**: Move the mouse to coordinates (x, y)
- **left_click**: Click left mouse button (for selecting, activating)
- **right_click**: Click right mouse button (for context menus)
- **double_click**: Double-click (to open files/apps)
- **drag_mouse**: Drag from one position to another (for moving, selecting)
- **scroll**: Scroll up or down
- **type_text**: Type text using keyboard
- **press_key**: Press specific keys (Enter, Control_L, Alt_L, Tab, Escape, etc.)
- **take_screenshot**: Capture current screen state (returns base64 PNG)
- **wait**: Wait for a duration (for animations/loading)
- **run_terminal_command**: Execute terminal commands

## Screen Coordinate System

- Origin (0,0) is at the **top-left corner**
- X increases **rightward** (0 to 1920 for typical screens)
- Y increases **downward** (0 to 1080 for typical screens)
- Typical resolution: 1024x720 or 1920x1080

## Common Key Names

- **Basic**: Enter, Return, Tab, Escape, Space, BackSpace
- **Modifiers**: Control_L, Control_R, Alt_L, Alt_R, Shift_L, Shift_R, Super_L (Windows key)
- **Function**: F1, F2, ..., F12
- **Arrows**: arrow_up, arrow_down, arrow_left, arrow_right
- **Navigation**: Home, End, Page_Up, Page_Down, Insert, Delete

## Guidelines

1. **Always screenshot first** - Use take_screenshot to understand the current desktop state before acting
2. **Plan your actions** - Think about what you're trying to accomplish and break it into steps
3. **Use wait actions** - Allow time for animations, page loads, and application startup (1-3 seconds typical)
4. **Verify with screenshots** - Take screenshots after important actions to confirm results
5. **Small steps** - Break complex tasks into simple, sequential actions
6. **Handle errors** - If an action fails, try an alternative approach
7. **Be precise** - Use accurate coordinates for clicks and drags
${customInstructions ? `\n## Custom Instructions\n\n${customInstructions}` : ''}
`

  if (includeExamples) {
    prompt += `
## Example Workflows

### Opening a Web Browser
1. take_screenshot - See current desktop
2. mouse_move (x=50, y=10) - Move to applications menu
3. left_click - Open menu
4. mouse_move (x=100, y=150) - Move to Firefox icon
5. left_click - Launch Firefox
6. wait (duration=3000) - Wait for Firefox to open
7. take_screenshot - Verify Firefox is open

### Typing in a Text Field
1. mouse_move (x=400, y=300) - Move to text field
2. left_click - Focus the field
3. type_text (text="Hello, World!") - Type text
4. press_key (keys=["Enter"]) - Submit

### Using Keyboard Shortcuts
1. press_key (keys=["Control_L", "t"]) - Open new tab (Ctrl+T)
2. wait (duration=1000) - Wait for tab to open
3. type_text (text="https://example.com") - Type URL
4. press_key (keys=["Enter"]) - Navigate
`
  }

  if (includeTips) {
    prompt += `
## Pro Tips

- **Context menus**: Use right_click to access context menus for files, folders, and applications
- **Window management**: Click and drag window title bars to move windows
- **Text selection**: Use drag_mouse to select text, then press_key (keys=["Control_L", "c"]) to copy
- **Terminal commands**: Run "firefox &" to launch Firefox in background, "pcmanfm &" for file manager
- **Patience**: Desktop operations take time - use wait actions liberally
- **Debugging**: If stuck, take a screenshot and reassess the situation
`
  }

  return prompt
}

// ==================== Helper Functions ====================

/**
 * Create a complete tool configuration for Vercel AI SDK
 */
export function createComputerUseAgent(options?: {
  maxSteps?: number
  systemPrompt?: string
}): {
  tools: typeof computerUseTools
  system: string
  maxSteps: number
} {
  return {
    tools: computerUseTools,
    system: options?.systemPrompt ?? getComputerUseSystemPrompt(),
    maxSteps: options?.maxSteps ?? 50,
  }
}

/**
 * Validate desktop action
 */
export function validateAction(action: DesktopAction): { valid: boolean; error?: string } {
  switch (action.type) {
    case 'mouse_move':
      if (action.x === undefined || action.y === undefined) {
        return { valid: false, error: 'mouse_move requires x and y coordinates' }
      }
      break

    case 'drag':
      if (action.startX === undefined || action.startY === undefined ||
          action.endX === undefined || action.endY === undefined) {
        return { valid: false, error: 'drag requires startX, startY, endX, endY' }
      }
      break

    case 'type':
      if (!action.text) {
        return { valid: false, error: 'type requires text' }
      }
      break

    case 'keypress':
      if (!action.keys) {
        return { valid: false, error: 'keypress requires keys' }
      }
      break

    case 'wait':
      if (action.duration === undefined || action.duration < 0) {
        return { valid: false, error: 'wait requires positive duration' }
      }
      break

    case 'terminal_command':
      if (!action.command) {
        return { valid: false, error: 'terminal_command requires command' }
      }
      break
  }

  return { valid: true }
}
