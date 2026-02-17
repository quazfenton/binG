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
          description: 'File path relative to the sandbox workspace root',
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
          description: 'File path relative to the sandbox workspace root',
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
            'Directory path relative to the sandbox workspace root. Defaults to workspace root.',
        },
      },
      required: [],
    },
  },
] as const

export type ToolName = (typeof SANDBOX_TOOLS)[number]['name']

const BLOCKED_PATTERNS = [
  // rm commands - block recursive delete with force flag in any order
  // Matches: rm -rf /, rm -fr /, rm -r -f /, rm --recursive --force /, etc.
  /rm\s+(?:(?:-[^\s]*[rR][^\s]*\s+[^\s]*[fF]|[^\s]*[fF][^\s]*\s+[^\s]*[rR])|(?:--recursive\s+--force|--force\s+--recursive))\s+(?:\/|\*)/i,
  /rm\s+-rf\s+\/(?:\s|$)/,      // rm -rf / with whitespace or end-of-line
  /rm\s+-rf\s+\/\S*/,           // rm -rf /anything (any path starting with /)
  /rm\s+-rf\s+\*\s*/,           // rm -rf *
  /rm\s+--no-preserve-root/,    // rm --no-preserve-root
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,  // Fork bomb
  /chmod\s+-R\s+777\s+\//,
  /chmod\s+000\s+\//,
  /wget.*\|\s*(ba)?sh/,
  /curl.*\|\s*(ba)?sh/,
  // Variable expansion and command substitution
  /\$\{.*\}/,  // ${VAR}
  /\$\([^)]+\)/,  // $(command)
  /`[^`]+`/,  // Backticks
  // Eval and execution patterns
  /\beval\b/,
  /\bexec\b\s*\(/,
  /base64\s+-d\s*\|\s*(ba)?sh/,
  /python\s+-c/,
  /perl\s+-e/,
  /ruby\s+-e/,
  /node\s+-e/,
  /php\s+-r/,
  // Shell escaping bypasses
  /\\[;&|]/,  // Escaped special chars
]

export function validateCommand(command: string): { valid: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, reason: `Blocked: dangerous command pattern detected` }
    }
  }
  return { valid: true }
}

/**
 * Validate and resolve file path to prevent path traversal attacks
 */
export function resolvePath(filePath: string, sandboxRoot: string = '/workspace'): { valid: boolean; resolvedPath?: string; reason?: string } {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');
  
  // Reject path traversal attempts
  if (normalized.includes('..')) {
    return { valid: false, reason: 'Path traversal detected: ".." not allowed' };
  }
  
  // Reject null bytes
  if (normalized.includes('\0')) {
    return { valid: false, reason: 'Invalid path: null byte detected' };
  }
  
  // For absolute paths, ensure they're within sandbox root (check directory boundary)
  if (filePath.startsWith('/')) {
    // Path must either equal sandboxRoot exactly or be within sandboxRoot directory
    if (normalized !== sandboxRoot && !normalized.startsWith(sandboxRoot + '/')) {
      return { valid: false, reason: `Path must be within ${sandboxRoot}` };
    }
    return { valid: true, resolvedPath: normalized };
  }
  
  // For relative paths, resolve within sandbox root
  const resolved = `${sandboxRoot}/${normalized}`.replace(/\/+/g, '/');
  return { valid: true, resolvedPath: resolved };
}
