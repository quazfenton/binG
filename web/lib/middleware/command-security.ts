/**
 * Command Security Middleware
 *
 * Provides security validation for command execution.
 * Prevents command injection, dangerous commands, and other security risks.
 *
 * Features:
 * - Command injection prevention
 * - Dangerous command blocking
 * - Pattern matching for known attacks
 * - Whitelist support
 * - Resource limit enforcement
 *
 * @see docs/sdk/command-security.md
 */

import { z } from 'zod';
import { validatePath } from './filesystem-security';

/**
 * Command validation result
 */
export interface CommandValidationResult {
  valid: boolean;
  sanitizedCommand?: string;
  error?: {
    type: string;
    message: string;
    code?: string;
    blockedPattern?: string;
  };
}

/**
 * Command security configuration
 */
export interface CommandSecurityConfig {
  /** Enable command validation */
  enableValidation: boolean;
  /** Enable pattern matching */
  enablePatternMatching: boolean;
  /** Enable whitelist mode */
  enableWhitelist: boolean;
  /** Allowed commands (whitelist mode) */
  allowedCommands: string[];
  /** Blocked patterns */
  blockedPatterns: RegExp[];
  /** Maximum command length */
  maxCommandLength: number;
  /** Enable resource limits */
  enableResourceLimits: boolean;
  /** Maximum execution time in seconds */
  maxExecutionTime: number;
  /** Maximum memory in MB */
  maxMemory: number;
}

/**
 * Default command security configuration
 */
const DEFAULT_COMMAND_SECURITY_CONFIG: CommandSecurityConfig = {
  enableValidation: true,
  enablePatternMatching: true,
  enableWhitelist: false,
  allowedCommands: [],
  blockedPatterns: [
    // Filesystem destruction
    /\brm\s+(-[rf]+\s+)?\/(\s|$)/i,
    /\brm\s+--no-preserve-root/i,
    /\bmkfs\./i,
    /\bdd\s+if=.*of=\/dev/i,

    // Permission escalation
    /\bchmod\s+(-R\s+)?777\s+\//i,
    /\bchown\s+.*:.*\//i,

    // Process manipulation
    /\bkill\s+-\d/i,
    /\bpkill\b/i,
    /\bfuser\b/i,

    // Network attacks
    /\bnmap\b/i,
    /\bmasscan\b/i,
    /\btcpdump\b/i,

    // Privilege escalation
    /\bsudo\b/i,
    /\bsu\s+-/i,
    /\bpasswd\b/i,

    // Data exfiltration
    /\bcurl\b.*\|.*\b(ba)?sh/i,
    /\bwget\b.*\|.*\b(ba)?sh/i,
    /\bnc\s+-[el]/i,
    /\bnetcat\b.*-[el]/i,

    // Code execution
    /\beval\b/i,
    /\bexec\b\s*\(/i,
    /\bpython\s+-c\s+.*import\s+os/i,
    /\bperl\s+-e\s+.*system/i,
    /\bruby\s+-e\s+.*`/i,

    // Fork bombs
    /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/i,
    /\bfork\s*\(\s*\)\s*&/i,

    // Shell injection
    /;\s*\w/i,
    /\|\s*\w/i,
    /`\s*\w/i,
    /\$\(\s*\w/i,

    // Hidden files
    /\b\.[a-z_]+\s+/i,

    // System directories
    /\/etc\/(passwd|shadow|hosts|resolv\.conf)/i,
    /\/proc\//i,
    /\/sys\//i,
    /\/dev\/(?!null|zero|random|urandom)/i,
  ],
  maxCommandLength: 10000,
  enableResourceLimits: true,
  maxExecutionTime: 300, // 5 minutes
  maxMemory: 1024, // 1GB
};

/**
 * Validate command for security issues
 *
 * @param command - Command to validate
 * @param config - Command security configuration
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const validation = validateCommand(command);
 * if (!validation.valid) {
 *   return NextResponse.json(validation.error, { status: 400 });
 * }
 * ```
 */
export function validateCommand(
  command: string,
  config: CommandSecurityConfig = DEFAULT_COMMAND_SECURITY_CONFIG
): CommandValidationResult {
  if (!config.enableValidation) {
    return { valid: true, sanitizedCommand: command };
  }

  // Check command length
  if (command.length > config.maxCommandLength) {
    return {
      valid: false,
      error: {
        type: 'command_validation_error',
        message: `Command exceeds maximum length (${command.length} > ${config.maxCommandLength} characters)`,
        code: 'COMMAND_TOO_LONG',
      },
    };
  }

  // Check for null bytes
  if (command.includes('\0')) {
    return {
      valid: false,
      error: {
        type: 'command_validation_error',
        message: 'Command contains null bytes',
        code: 'COMMAND_NULL_BYTE',
      },
    };
  }

  // Check against blocked patterns
  if (config.enablePatternMatching) {
    for (const pattern of config.blockedPatterns) {
      if (pattern.test(command)) {
        return {
          valid: false,
          error: {
            type: 'command_security_error',
            message: `Command contains blocked pattern: ${command}`,
            code: 'COMMAND_BLOCKED',
            blockedPattern: pattern.source,
          },
        };
      }
    }
  }

  // Check whitelist if enabled
  if (config.enableWhitelist && config.allowedCommands.length > 0) {
    const isAllowed = config.allowedCommands.some(allowed => {
      if (typeof allowed === 'string') {
        return command.startsWith(allowed);
      }
      return (allowed as RegExp).test(command);
    });

    if (!isAllowed) {
      return {
        valid: false,
        error: {
          type: 'command_security_error',
          message: 'Command is not in whitelist',
          code: 'COMMAND_NOT_WHITELISTED',
        },
      };
    }
  }

  // Sanitize command (basic)
  const sanitizedCommand = command
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  return {
    valid: true,
    sanitizedCommand,
  };
}

/**
 * Validate command arguments
 *
 * @param args - Command arguments
 * @param config - Command security configuration
 * @returns Validation result
 */
export function validateCommandArgs(
  args: string[],
  config: CommandSecurityConfig = DEFAULT_COMMAND_SECURITY_CONFIG
): CommandValidationResult {
  if (!config.enableValidation) {
    return { valid: true };
  }

  // Validate each argument
  for (const arg of args) {
    // Check for null bytes
    if (arg.includes('\0')) {
      return {
        valid: false,
        error: {
          type: 'command_validation_error',
          message: 'Argument contains null bytes',
          code: 'ARG_NULL_BYTE',
        },
      };
    }

    // Check for shell injection in arguments
    if (/[;&|`$()]/.test(arg)) {
      return {
        valid: false,
        error: {
          type: 'command_security_error',
          message: `Argument contains shell metacharacters: ${arg}`,
          code: 'ARG_SHELL_INJECTION',
        },
      };
    }
  }

  return { valid: true };
}

/**
 * Validate complete command execution request
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @param cwd - Working directory
 * @param env - Environment variables
 * @param config - Command security configuration
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const validation = validateCommandExecution(command, args, cwd, env);
 * if (!validation.valid) {
 *   return NextResponse.json(validation.error, { status: 400 });
 * }
 * ```
 */
export async function validateCommandExecution(
  command: string,
  args: string[] = [],
  cwd?: string,
  env?: Record<string, string>,
  config: CommandSecurityConfig = DEFAULT_COMMAND_SECURITY_CONFIG
): Promise<CommandValidationResult> {
  // Validate main command
  const commandValidation = validateCommand(command, config);
  if (!commandValidation.valid) {
    return commandValidation;
  }

  // Validate arguments
  const argsValidation = validateCommandArgs(args, config);
  if (!argsValidation.valid) {
    return argsValidation;
  }

  // Validate working directory if provided
  if (cwd) {
    const cwdValidation = validatePath(cwd);
    if (!cwdValidation.valid) {
      return {
        valid: false,
        error: {
          type: 'command_validation_error',
          message: `Invalid working directory: ${cwdValidation.error?.message}`,
          code: 'INVALID_CWD',
        },
      };
    }
  }

  // Validate environment variables
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      // Check for null bytes in env vars
      if (key.includes('\0') || value.includes('\0')) {
        return {
          valid: false,
          error: {
            type: 'command_validation_error',
            message: 'Environment variable contains null bytes',
            code: 'ENV_NULL_BYTE',
          },
        };
      }

      // Check for shell injection in env vars
      if (/[;&|`$()]/.test(value)) {
        return {
          valid: false,
          error: {
            type: 'command_security_error',
            message: `Environment variable contains shell metacharacters: ${key}`,
            code: 'ENV_SHELL_INJECTION',
          },
        };
      }
    }
  }

  return {
    valid: true,
    sanitizedCommand: commandValidation.sanitizedCommand,
  };
}

/**
 * Sanitize command for logging
 *
 * @param command - Command to sanitize
 * @returns Sanitized command
 */
export function sanitizeCommandForLogging(command: string): string {
  // Remove sensitive information
  return command
    .replace(/(password|secret|token|key)=\S+/gi, '$1=[REDACTED]')
    .replace(/-u\s+\S+/gi, '-u [REDACTED]')
    .replace(/-p\s+\S+/gi, '-p [REDACTED]')
    .replace(/API_?KEY=\S+/gi, 'API_KEY=[REDACTED]')
    .replace(/AWS_?SECRET=\S+/gi, 'AWS_SECRET=[REDACTED]');
}

/**
 * Get command risk level
 *
 * @param command - Command to analyze
 * @returns Risk level (low, medium, high, critical)
 */
export function getCommandRiskLevel(command: string): 'low' | 'medium' | 'high' | 'critical' {
  const lowerCommand = command.toLowerCase();

  // Critical risk
  if (/\b(rm|mkfs|dd|chmod|chown)\b/.test(lowerCommand) && /\s+\//.test(command)) {
    return 'critical';
  }

  // High risk
  if (/\b(sudo|su|passwd|curl|wget|nc|netcat)\b/.test(lowerCommand)) {
    return 'high';
  }

  // Medium risk
  if (/\b(python|perl|ruby|node|bash|sh)\b/.test(lowerCommand)) {
    return 'medium';
  }

  // Low risk
  return 'low';
}

/**
 * Create command validator with custom config
 *
 * @param config - Command security configuration
 * @returns Validator function
 *
 * @example
 * ```typescript
 * const validate = createCommandValidator({
 *   enableWhitelist: true,
 *   allowedCommands: ['ls', 'cat', 'grep'],
 * });
 *
 * const result = validate(command);
 * ```
 */
export function createCommandValidator(config: Partial<CommandSecurityConfig> = {}) {
  const fullConfig: CommandSecurityConfig = {
    ...DEFAULT_COMMAND_SECURITY_CONFIG,
    ...config,
  };

  return async function validate(command: string, args?: string[]): Promise<CommandValidationResult> {
    return validateCommandExecution(command, args, undefined, undefined, fullConfig);
  };
}

/**
 * Default command validator instance
 */
export const validateCommandExecutionDefault = createCommandValidator();

/**
 * Command execution Zod schema
 */
export const CommandExecutionSchema = z.object({
  command: z.string({
    required_error: 'Command is required',
  }).refine(
    (command) => {
      const validation = validateCommand(command);
      return validation.valid;
    },
    {
      message: 'Command contains blocked patterns or is too long',
    }
  ),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(),
});

/**
 * Validate command execution request with Zod
 *
 * @param data - Request data
 * @returns Validation result
 */
export async function validateCommandExecutionRequest(data: unknown): Promise<{
  valid: true;
  data: z.infer<typeof CommandExecutionSchema>;
} | {
  valid: false;
  error: {
    type: 'validation_error' | 'security_error';
    message: string;
    code?: string;
    details?: any;
  };
}> {
  const result = CommandExecutionSchema.safeParse(data);

  if (!result.success) {
    return {
      valid: false,
      error: {
        type: 'validation_error',
        message: 'Invalid command execution request',
        details: result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    };
  }

  // Additional security validation
  const { command, args, cwd, env } = result.data;
  const validation = await validateCommandExecution(command, args, cwd, env);

  if (!validation.valid) {
    return {
      valid: false,
      error: {
        type: 'security_error',
        message: validation.error!.message,
        code: validation.error!.code,
      },
    };
  }

  return {
    valid: true,
    data: {
      ...result.data,
      command: validation.sanitizedCommand!,
    },
  };
}

/**
 * Common safe commands whitelist
 */
export const SAFE_COMMANDS = [
  'ls', 'dir', 'pwd',
  'cat', 'head', 'tail', 'less', 'more',
  'grep', 'find', 'locate',
  'echo', 'printf',
  'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch',
  'chmod', 'chown', 'ln',
  'git', 'svn',
  'npm', 'yarn', 'pnpm', 'pip', 'pip3',
  'node', 'python', 'python3', 'go', 'rustc', 'javac',
  'curl', 'wget',
  'ps', 'top', 'htop', 'df', 'du', 'free',
  'uname', 'hostname', 'whoami', 'id',
  'date', 'time', 'cal',
];

/**
 * Add command to whitelist
 *
 * @param command - Command to add
 * @param config - Command security configuration
 */
export function addToWhitelist(command: string, config: CommandSecurityConfig): void {
  if (!config.allowedCommands.includes(command)) {
    config.allowedCommands.push(command);
    config.enableWhitelist = true;
  }
}

/**
 * Remove command from whitelist
 *
 * @param command - Command to remove
 * @param config - Command security configuration
 */
export function removeFromWhitelist(command: string, config: CommandSecurityConfig): void {
  const index = config.allowedCommands.indexOf(command);
  if (index > -1) {
    config.allowedCommands.splice(index, 1);
  }
}

/**
 * Add blocked pattern
 *
 * @param pattern - Pattern to add
 * @param config - Command security configuration
 */
export function addBlockedPattern(pattern: RegExp, config: CommandSecurityConfig): void {
  if (!config.blockedPatterns.some(p => p.source === pattern.source)) {
    config.blockedPatterns.push(pattern);
  }
}
