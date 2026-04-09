/**
 * Enhanced Sandbox Tools
 * 
 * Extends the base SANDBOX_TOOLS with advanced capabilities:
 * - Computer use operations (mouse, keyboard, screenshot)
 * - MCP tool access
 * - Desktop operations
 * - Git operations with authentication
 * - File operations with sync optimization
 * - Code interpretation and execution
 * 
 * @see docs/sdk/e2b-llms-full.txt - E2B code interpreter and desktop
 * @see docs/sdk/daytona-llms.txt - Daytona computer use service
 * @see docs/sdk/blaxel-llms-full.txt - Blaxel async operations
 */

import { validateCommand, validateFilePath } from './security';

export const ENHANCED_SANDBOX_TOOLS = [
  // Base tools (from SANDBOX_TOOLS)
  {
    name: 'exec_shell',
    description: 'Execute a shell command in the sandbox workspace. Use for installing packages, running scripts, compiling code, or any CLI operation.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
      },
      required: ['command'],
    },
    validate: (args: { command: string }) => {
      const validation = validateCommand(args.command);
      if (!validation.valid) {
        return {
          valid: false,
          reason: validation.reason,
        };
      }
      return { valid: true };
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the sandbox workspace. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the sandbox workspace root',
        },
        content: {
          type: 'string',
          description: 'The full file content to write',
        },
      },
      required: ['path', 'content'],
    },
    validate: (args: { path: string; content: string }, workspaceDir: string) => {
      const validation = validateFilePath(args.path, workspaceDir);
      if (!validation.valid) {
        return {
          valid: false,
          reason: validation.reason,
        };
      }
      return { valid: true };
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in the sandbox workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the sandbox workspace root',
        },
      },
      required: ['path'],
    },
    validate: (args: { path: string }, workspaceDir: string) => {
      const validation = validateFilePath(args.path, workspaceDir);
      if (!validation.valid) {
        return {
          valid: false,
          reason: validation.reason,
        };
      }
      return { valid: true };
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories at the given path in the sandbox workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to the sandbox workspace root. Defaults to workspace root.',
        },
      },
      required: [],
    },
    validate: (args: { path?: string }, workspaceDir: string) => {
      const path = args.path || '.';
      const validation = validateFilePath(path, workspaceDir);
      if (!validation.valid) {
        return {
          valid: false,
          reason: validation.reason,
        };
      }
      return { valid: true };
    },
  },

  // Enhanced: Computer Use Tools
  {
    name: 'computer_use_click',
    description: 'Click at a specific screen position or on a UI element. For computer use agents with desktop access.',
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate (pixels from left)',
        },
        y: {
          type: 'number',
          description: 'Y coordinate (pixels from top)',
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button to click',
          default: 'left',
        },
        clicks: {
          type: 'number',
          description: 'Number of clicks (1 for single, 2 for double)',
          default: 1,
        },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'computer_use_type',
    description: 'Type text using the keyboard. For computer use agents with desktop access.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to type',
        },
        clear: {
          type: 'boolean',
          description: 'Clear existing text before typing',
          default: false,
        },
        enter: {
          type: 'boolean',
          description: 'Press Enter after typing',
          default: false,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'computer_use_screenshot',
    description: 'Take a screenshot of the current screen. Returns base64 encoded image.',
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          description: 'Optional region to capture',
        },
        quality: {
          type: 'number',
          description: 'Image quality (1-100)',
          default: 90,
        },
      },
    },
  },
  {
    name: 'computer_use_scroll',
    description: 'Scroll the screen by specified amount. For computer use agents.',
    parameters: {
      type: 'object',
      properties: {
        deltaX: {
          type: 'number',
          description: 'Horizontal scroll amount',
          default: 0,
        },
        deltaY: {
          type: 'number',
          description: 'Vertical scroll amount (positive = down)',
          default: 0,
        },
      },
    },
  },

  // Enhanced: Git Operations
  {
    name: 'git_clone',
    description: 'Clone a Git repository to the sandbox workspace.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Git repository URL',
        },
        path: {
          type: 'string',
          description: 'Destination path (relative to workspace)',
        },
        branch: {
          type: 'string',
          description: 'Branch to clone (default: main/master)',
        },
        depth: {
          type: 'number',
          description: 'Shallow clone depth (1 for latest commit only)',
        },
        username: {
          type: 'string',
          description: 'Git username (for private repos)',
        },
        password: {
          type: 'string',
          description: 'Git password or token (for private repos)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'git_status',
    description: 'Get Git repository status showing changed files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to Git repository (default: workspace root)',
        },
      },
    },
  },
  {
    name: 'git_commit',
    description: 'Commit changes to Git repository.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message',
        },
        all: {
          type: 'boolean',
          description: 'Automatically stage all changes',
          default: false,
        },
        path: {
          type: 'string',
          description: 'Path to Git repository (default: workspace root)',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'git_push',
    description: 'Push Git commits to remote repository.',
    parameters: {
      type: 'object',
      properties: {
        remote: {
          type: 'string',
          description: 'Remote name (default: origin)',
          default: 'origin',
        },
        branch: {
          type: 'string',
          description: 'Branch to push (default: current)',
        },
        force: {
          type: 'boolean',
          description: 'Force push (use with caution)',
          default: false,
        },
      },
    },
  },

  // Enhanced: Code Execution
  {
    name: 'run_code',
    description: 'Execute code in a specific language and return the result.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code to execute',
        },
        language: {
          type: 'string',
          enum: ['python', 'javascript', 'typescript', 'go', 'rust', 'java', 'r', 'cpp'],
          description: 'Programming language',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command line arguments',
        },
        stdin: {
          type: 'string',
          description: 'Standard input to provide',
        },
        timeout: {
          type: 'number',
          description: 'Execution timeout in seconds',
          default: 30,
        },
      },
      required: ['code', 'language'],
    },
  },

  // Enhanced: MCP Tools
  {
    name: 'mcp_list_tools',
    description: 'List available MCP (Model Context Protocol) tools.',
    parameters: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'MCP server name (optional, lists all if not specified)',
        },
      },
    },
  },
  {
    name: 'mcp_call_tool',
    description: 'Call an MCP tool with specified arguments.',
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'Name of the MCP tool to call',
        },
        arguments: {
          type: 'object',
          description: 'Tool arguments as key-value pairs',
        },
        server: {
          type: 'string',
          description: 'MCP server name',
        },
      },
      required: ['toolName', 'arguments'],
    },
  },

  // Enhanced: File Operations
  {
    name: 'sync_files',
    description: 'Synchronize files between local and sandbox with incremental sync.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['to-sandbox', 'from-sandbox', 'bidirectional'],
          description: 'Sync direction',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific paths to sync (syncs all if not specified)',
        },
        deleteOrphans: {
          type: 'boolean',
          description: 'Delete files that exist only on destination',
          default: false,
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for files by name or content pattern.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern (glob or regex)',
        },
        path: {
          type: 'string',
          description: 'Directory to search (default: workspace root)',
        },
        content: {
          type: 'string',
          description: 'Content pattern to search for',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return',
          default: 100,
        },
      },
      required: ['pattern'],
    },
  },

  // Enhanced: Process Management
  {
    name: 'start_process',
    description: 'Start a long-running process in the background.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to run',
        },
        background: {
          type: 'boolean',
          description: 'Run in background',
          default: true,
        },
        captureOutput: {
          type: 'boolean',
          description: 'Capture stdout/stderr',
          default: true,
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'stop_process',
    description: 'Stop a running process by PID or name.',
    parameters: {
      type: 'object',
      properties: {
        pid: {
          type: 'number',
          description: 'Process ID',
        },
        name: {
          type: 'string',
          description: 'Process name',
        },
        signal: {
          type: 'string',
          enum: ['SIGTERM', 'SIGKILL', 'SIGINT'],
          description: 'Signal to send',
          default: 'SIGTERM',
        },
      },
    },
  },
  {
    name: 'list_processes',
    description: 'List all running processes.',
    parameters: {
      type: 'object',
      properties: {
        user: {
          type: 'string',
          description: 'Filter by user',
        },
      },
    },
  },

  // Enhanced: Preview Management
  {
    name: 'get_previews',
    description: 'Get list of active preview URLs for running services.',
    parameters: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Filter by port',
        },
      },
    },
  },
  {
    name: 'forward_port',
    description: 'Forward a sandbox port to a public URL.',
    parameters: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Port to forward',
        },
        public: {
          type: 'boolean',
          description: 'Make publicly accessible',
          default: true,
        },
      },
      required: ['port'],
    },
  },
]

// Tool categories for organization
export const TOOL_CATEGORIES = {
  base: ['exec_shell', 'write_file', 'read_file', 'list_dir'],
  computerUse: ['computer_use_click', 'computer_use_type', 'computer_use_screenshot', 'computer_use_scroll'],
  git: ['git_clone', 'git_status', 'git_commit', 'git_push'],
  codeExecution: ['run_code'],
  mcp: ['mcp_list_tools', 'mcp_call_tool'],
  fileOps: ['sync_files', 'search_files'],
  process: ['start_process', 'stop_process', 'list_processes'],
  preview: ['get_previews', 'forward_port'],
  terminal: ['terminal_create_session', 'terminal_send_input', 'terminal_get_output', 'terminal_resize', 'terminal_close_session', 'terminal_list_sessions'],
  projectAnalysis: ['project_analyze', 'project_list_scripts', 'project_dependencies', 'project_structure'],
  port: ['port_status'],
}

export type ToolName = typeof ENHANCED_SANDBOX_TOOLS[number]['name']

// Helper to get tools by category
export function getToolsByCategory(category: keyof typeof TOOL_CATEGORIES) {
  const categoryTools = TOOL_CATEGORIES[category]
  return ENHANCED_SANDBOX_TOOLS.filter(tool => categoryTools.includes(tool.name))
}

// Helper to check if tool is available
export function isToolAvailable(toolName: string): boolean {
  return ENHANCED_SANDBOX_TOOLS.some(tool => tool.name === toolName)
}

// Helper to get tool by name
export function getToolByName(toolName: string) {
  return ENHANCED_SANDBOX_TOOLS.find(tool => tool.name === toolName)
}
