/**
 * Sandbox Tools Definition
 *
 * Defines available tools for sandbox execution.
 * Uses shared security utilities for command and path validation.
 *
 * @see lib/sandbox/security.ts Security utilities
 */

import { validateCommand, validateFilePath } from './security';

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
    /**
     * Validate command before execution
     */
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
    /**
     * Validate path before writing
     */
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
    /**
     * Validate path before reading
     */
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
          description:
            'Directory path relative to the sandbox workspace root. Defaults to workspace root.',
        },
      },
      required: [],
    },
    /**
     * Validate path before listing
     */
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
] as const

export type ToolName = (typeof SANDBOX_TOOLS)[number]['name']

/**
 * Validate command with security patterns
 * 
 * @deprecated Use validateCommand from security.ts instead
 */
export function validateCommandLegacy(command: string): {
  valid: boolean;
  reason?: string;
} {
  // This is kept for backward compatibility
  // New code should use validateCommand from security.ts
  return validateCommand(command);
}

/**
 * Blocked command patterns for security
 */
const BLOCKED_PATTERNS = [
  // rm commands - block recursive delete with force flag in any order
  /rm\s+-rf\s+\/(?:\s|$)/,      // rm -rf / with whitespace or end-of-line
  /rm\s+-rf\s+\/\S*/,           // rm -rf /anything (any path starting with /)
  /rm\s+-rf\s+\*\s*/,           // rm -rf *
  /rm\s+--no-preserve-root/,    // rm --no-preserve-root

  // Filesystem destruction
  /mkfs\./,                     // Format filesystem
  /dd\s+if=.*of=\/dev/,         // Write to device
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,  // Fork bomb

  // Permission manipulation
  /chmod\s+-R\s+777\s+\//,
  /chmod\s+000\s+\//,

  // Network download and execute (various encodings)
  /wget.*-O-.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
  /curl.*\|\s*(ba)?sh/,
  /curl.*-o\s+\S+\s*&&\s*(ba)?sh/,

  // Variable expansion and command substitution
  /\$\{.*\}/,                   // ${VAR}
  /\$\([^)]+\)/,                // $(command)
  /`[^`]+`/,                    // Backticks

  // Eval and code execution patterns
  /\beval\b/,
  /\bexec\b\s*\(/,
  /base64\s+-d\s*\|\s*(ba)?sh/, // Base64 decode and execute
  /echo\s+.*\|\s*base64\s+-d\s*\|\s*(ba)?sh/,
  /printf\s+['"]\\x[0-9a-fA-F]+['"]/,  // Hex encoding
  /printf\s+['"]\\[0-7]+['"]/,         // Octal encoding

  // Script interpreter execution
  /python\s+-c\s+['"].*exec\(/,
  /python\s+-c\s+['"].*eval\(/,
  /python\s+-c\s+['"].*compile\(/,
  /python3?\s+-c\s+['"].*__import__/,
  /python3?\s+-c\s+['"].*os\.system/,
  /perl\s+-e\s+['"].*eval['"]/,
  /perl\s+-e\s+['"].*system['"]/,
  /ruby\s+-e\s+['"].*eval['"]/,
  /ruby\s+-e\s+['"].*system['"]/,
  /node\s+-e\s+['"].*exec\(/,
  /node\s+-e\s+['"].*require\(['"]child_process/,
  /php\s+-r\s+['"].*exec\(/,
  /php\s+-r\s+['"].*system\(/,
  /php\s+-r\s+['"].*shell_exec\(/,

  // Process substitution (bash-specific)
  /<\(.*\)/,
  />\(.*\)/,

  // Here-strings and here-docs with execution
  /<<<.*\|/,
  /<<\s*['"]?\w+['"]?\s*\n.*\|.*sh/,

  // Shell escaping bypasses
  /\\[;&|]/,                    // Escaped special chars
  /['"][;&|]['"]/,              // Quoted special chars

  // Additional encoded execution patterns
  /\$\(printf\s+['"]%/,         // Printf format execution
  /\$\(echo\s+.*\|\s*xxd\s+-r/, // xxd decode
  /\$\(echo\s+.*\|\s*od\s+-A/,  // od decode

  // Container/VM escape attempts
  /docker\s+run\s+.*-v\s+\/:/,
  /kubectl\s+exec\s+.*--privileged/,

  // System file access
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /\/etc\/sudoers/,
  /\/proc\/\d+/,
  /\/sys\/kernel/,

  // Additional dangerous patterns from review plan
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/,  // Fork bomb variations
  /chsh\s+/,                     // Change shell
  /pwgen\s+/,                    // Password generation (could be used for mining)
  /shutdown\s+/,                 // System shutdown
  /reboot\s+/,                   // System reboot
  /init\s+\d/,                   // Runlevel change
  /mount\s+--bind/,              // Bind mount (escape chroot)
  /nproc\s*\|\s*xargs/,          // CPU detection for mining
  /lscpu\s*\|\s*xargs/,          // CPU detection for mining
  /cat\s+\/proc\/cpuinfo/,       // CPU info for mining
  /nohup\s+.*&/,                 // Background persistence
  /screen\s+-dmS/,               // Screen session (persistence)
  /tmux\s+new\s+-d/,             // Tmux session (persistence)
  /crontab\s+-e/,                // Cron job (persistence)
  /systemctl\s+enable/,          // Systemd service (persistence)
]

export function validateCommand(command: string): { valid: boolean; reason?: string } {
  // Normalize Unicode to detect homoglyph attacks (NFKC normalization)
  const normalizedCommand = command.normalize('NFKC')
  
  // Check for homoglyph attacks (Cyrillic, Greek, etc.)
  const homoglyphPatterns = [
    /[\u0400-\u04FF]/, // Cyrillic
    /[\u0370-\u03FF]/, // Greek and Coptic
    /[\u0500-\u052F]/, // Cyrillic Supplement
    /[\u2D00-\u2D2F]/, // Georgian Supplement
  ]
  
  for (const pattern of homoglyphPatterns) {
    if (pattern.test(normalizedCommand)) {
      return { valid: false, reason: 'Blocked: potential Unicode homoglyph attack detected' }
    }
  }
  
  // Validate against blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalizedCommand)) {
      return { valid: false, reason: `Blocked: dangerous command pattern detected` }
    }
  }
  
  return { valid: true }
}

/**
 * Validate and resolve file path to prevent path traversal attacks
 *
 * Security measures:
 * - Decodes URL-encoded paths (including double-encoding attacks)
 * - Normalizes path separators
 * - Checks for path traversal segments
 * - Verifies resolved path is within sandbox root
 * - Rejects null bytes and invalid characters
 * - Detects Unicode homoglyph attacks
 */
export function resolvePath(filePath: string, sandboxRoot: string = '/workspace'): { valid: boolean; resolvedPath?: string; reason?: string } {
  try {
    // Reject null bytes immediately
    if (filePath.includes('\0')) {
      return { valid: false, reason: 'Invalid path: null byte detected' }
    }

    // Normalize path separators
    let normalized = filePath.replace(/\\/g, '/')

    // Handle double-encoding and multiple encoding attacks
    // Keep decoding until no more changes (max 10 iterations to prevent DoS)
    let decoded = normalized
    let prevDecoded: string
    const maxIterations = 10
    let iterations = 0
    
    do {
      prevDecoded = decoded
      try {
        decoded = decodeURIComponent(decoded)
      } catch {
        break
      }
      iterations++
    } while (decoded !== prevDecoded && iterations < maxIterations)

    // Check for Unicode homoglyph attacks (Cyrillic, Greek, etc.)
    const homoglyphPatterns = [
      /[\u0400-\u04FF]/, // Cyrillic
      /[\u0370-\u03FF]/, // Greek and Coptic
      /[\u0500-\u052F]/, // Cyrillic Supplement
      /[\u2D00-\u2D2F]/, // Georgian Supplement
    ]
    
    for (const pattern of homoglyphPatterns) {
      if (pattern.test(decoded)) {
        return { valid: false, reason: 'Potential Unicode homoglyph attack detected' }
      }
    }

    // Reject if decoding revealed traversal attempts
    if (decoded.includes('..') || decoded.includes('\\')) {
      return { valid: false, reason: 'Path traversal detected in encoded path' }
    }

    // Normalize and split into segments
    const path = require('node:path')
    const segments = path.normalize(decoded).split(path.sep).filter((s: string) => s.length > 0)

    // Check each segment for traversal attempts
    for (const segment of segments) {
      // Check for .. with various encodings or modifications
      if (segment === '..' ||
          segment.startsWith('..') ||
          segment.includes('..') ||
          // Check for unicode lookalikes
          /[\u0430-\u044f]/.test(segment)) { // Cyrillic characters that look like Latin
        return { valid: false, reason: 'Path traversal detected' }
      }
    }

    // For absolute paths, ensure they're within sandbox root
    if (filePath.startsWith('/')) {
      const resolved = path.resolve(decoded)
      const sandboxRootResolved = path.resolve(sandboxRoot)

      // Path must equal sandboxRoot exactly or be within sandboxRoot directory
      if (resolved !== sandboxRootResolved && !resolved.startsWith(sandboxRootResolved + path.sep)) {
        return { valid: false, reason: `Path must be within ${sandboxRoot}` }
      }
      return { valid: true, resolvedPath: resolved }
    }

    // For relative paths, resolve within sandbox root
    const resolved = path.resolve(sandboxRoot, decoded)
    const sandboxRootResolved = path.resolve(sandboxRoot)

    // Double-check the resolved path is within sandbox
    if (!resolved.startsWith(sandboxRootResolved + path.sep) && resolved !== sandboxRootResolved) {
      return { valid: false, reason: 'Resolved path outside sandbox' }
    }

    return { valid: true, resolvedPath: resolved }
  } catch (error: any) {
    return {
      valid: false,
      reason: `Path resolution error: ${error.message}`
    }
  }
}
