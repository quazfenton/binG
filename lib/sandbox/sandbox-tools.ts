export const SANDBOX_TOOLS = [
  {
    name: 'exec_shell',
    description:
      'Execute a shell command in the sandbox workspace. Use for installing packages, running scripts, compiling code, or any CLI operation.',
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
  },
  {
    name: 'write_file',
    description:
      'Write or overwrite a file in the sandbox workspace. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to /home/daytona/workspace/',
        },
        content: {
          type: 'string',
          description: 'The full file content to write',
        },
      },
      required: ['path', 'content'],
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
          description: 'File path relative to /home/daytona/workspace/',
        },
      },
      required: ['path'],
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
          description:
            'Directory path relative to /home/daytona/workspace/. Defaults to workspace root.',
        },
      },
      required: [],
    },
  },
] as const

export type ToolName = (typeof SANDBOX_TOOLS)[number]['name']

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\s)/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /chmod\s+-R\s+777\s+\//,
  /wget.*\|\s*sh/,
  /curl.*\|\s*sh/,
]

export function validateCommand(command: string): { valid: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, reason: `Blocked: dangerous command pattern detected` }
    }
  }
  return { valid: true }
}
