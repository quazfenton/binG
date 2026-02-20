/**
 * Computer Use Tool Definitions
 * 
 * Tool calling definitions for AI agents to interact with desktop environments
 * Compatible with OpenAI, Anthropic, and other LLM tool calling APIs
 */

import type { Tool } from 'ai'
import { DesktopAction } from './e2b-desktop-provider'

/**
 * Computer use tools for desktop interaction
 */
export const computerUseTools: Tool[] = [
  // ==================== Mouse Tools ====================
  
  {
    type: 'function',
    function: {
      name: 'mouse_move',
      description: 'Move the mouse cursor to specified coordinates',
      parameters: {
        type: 'object',
        properties: {
          x: {
            type: 'number',
            description: 'X coordinate (horizontal position) on the screen',
          },
          y: {
            type: 'number',
            description: 'Y coordinate (vertical position) on the screen',
          },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'left_click',
      description: 'Perform a left mouse click at the specified or current position',
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
    },
  },
  {
    type: 'function',
    function: {
      name: 'right_click',
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
    },
  },
  {
    type: 'function',
    function: {
      name: 'double_click',
      description: 'Perform a double left click (e.g., to open files or applications)',
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
    },
  },
  {
    type: 'function',
    function: {
      name: 'drag_mouse',
      description: 'Drag the mouse from one position to another (e.g., to move windows or select text)',
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
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
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
    },
  },

  // ==================== Keyboard Tools ====================
  
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text using the keyboard (simulates human typing)',
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
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a specific key or key combination',
      parameters: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: {
              type: 'string',
              description: 'Key name (e.g., "Enter", "Control_L", "Alt_L", "Tab", "Escape")',
            },
            description: 'Key or keys to press (for combinations like Ctrl+C)',
          },
        },
        required: ['keys'],
      },
    },
  },

  // ==================== Screenshot Tool ====================
  
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Take a screenshot of the current desktop state. Returns base64-encoded PNG image.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  // ==================== Utility Tools ====================
  
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for a specified duration (useful for allowing animations or loading to complete)',
      parameters: {
        type: 'object',
        properties: {
          duration: {
            type: 'number',
            description: 'Duration to wait in milliseconds',
          },
        },
        required: ['duration'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description: 'Execute a terminal command in the desktop environment',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The terminal command to execute',
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
    },
  },
]

/**
 * Convert tool call to DesktopAction
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

    case 'scroll':
      return {
        type: 'scroll',
        scrollY: args.direction === 'down' ? args.ticks : -args.ticks,
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
      // This one needs special handling - execute directly
      return null

    default:
      return null
  }
}

/**
 * Get system prompt for computer use agents
 */
export function getComputerUseSystemPrompt(): string {
  return `You are a computer use AI agent that can interact with a Linux desktop environment.

You have access to the following tools:
- mouse_move: Move the mouse to coordinates (x, y)
- left_click: Click left mouse button
- right_click: Click right mouse button (for context menus)
- double_click: Double-click (to open files/apps)
- drag_mouse: Drag from one position to another
- scroll: Scroll up or down
- type_text: Type text using keyboard
- press_key: Press specific keys (Enter, Control_L, Alt_L, Tab, Escape, etc.)
- take_screenshot: Capture current screen state
- wait: Wait for a duration
- run_terminal_command: Execute terminal commands

Guidelines:
1. Always use take_screenshot first to understand the current state
2. Use mouse_move before clicking to ensure accurate positioning
3. Use type_text for entering text in input fields
4. Use press_key for special keys like Enter, Tab, or shortcuts
5. Use wait after actions that may take time (opening apps, loading pages)
6. Break complex tasks into small, sequential actions
7. Verify results by taking screenshots after important actions

Screen coordinates:
- Origin (0,0) is top-left corner
- X increases rightward, Y increases downward
- Typical resolution: 1024x720

Common key names:
- Enter, Return, Tab, Escape, Space
- Control_L, Control_R (Ctrl)
- Alt_L, Alt_R
- Shift_L, Shift_R
- F1-F12 (function keys)
- arrow_up, arrow_down, arrow_left, arrow_right`
}
