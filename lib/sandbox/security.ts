/**
 * Sandbox Security Utilities
 *
 * Shared security functions for all sandbox providers.
 * Includes command validation, path validation, and security constants.
 *
 * @see docs/COMPREHENSIVE_REVIEW_FINDINGS.md Security section
 */

import { resolve, relative } from 'path';

/**
 * Blocked command patterns to prevent security issues
 * 
 * These patterns block:
 * - System destruction (rm -rf /)
 * - Permission escalation (chmod 777)
 * - Remote code execution (curl | bash)
 * - Process manipulation (kill, pkill)
 * - Network attacks (nmap, masscan)
 * - Privilege escalation (sudo, su)
 * - Data exfiltration (nc, netcat)
 * - Fork bombs
 */
export const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[rf]+\s+)?\/(\s|$)/,           // rm -rf /
  /\brm\s+(-[rf]+\s+)?\*\s*$/,             // rm -rf *
  /\bchmod\s+(-R\s+)?777/,                 // chmod 777
  /\bcurl\b.*\|\s*(ba)?sh/,                // curl | bash
  /\bwget\b.*\|\s*(ba)?sh/,                // wget | bash
  /\bkill\b\s+-\d/,                        // kill signals
  /\bpkill\b/,                             // pkill
  /\bnmap\b/,                              // nmap
  /\bmasscan\b/,                           // masscan
  /\bsudo\b/,                              // sudo
  /\bsu\s+-/,                              // su -
  /\bnc\s+-[el]/,                          // netcat listener
  /\bnetcat\b.*-[el]/,                     // netcat listener
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/,          // Fork bomb
  /\bmkfs\b/,                              // Format filesystem
  /\bdd\s+if=\/dev\/zero/,                 // dd zero fill
  /\bshutdown\b/,                          // Shutdown
  /\breboot\b/,                            // Reboot
  /\binit\s+\d/,                           // Runlevel change
  /\bmount\s+--bind/,                      // Bind mount (escape chroot)
  /\bchsh\s+/,                             // Change shell
  /\bpwgen\b/,                             // Password generation (mining)
  /\bpython.*-m\s+http\.server/,           // Python HTTP server (data exfil)
  /\bphp.*-S\s+0\.0\.0\.0/,                // PHP server (data exfil)
];

/**
 * Blocked file patterns to prevent security issues
 */
export const BLOCKED_FILE_PATTERNS: RegExp[] = [
  /\/etc\/passwd/,                         // Password file
  /\/etc\/shadow/,                         // Shadow password file
  /\/etc\/ssh\//,                          // SSH config
  /\/root\/\.ssh\//,                       // Root SSH keys
  /\/proc\//,                              // Proc filesystem
  /\/sys\//,                               // Sys filesystem
  /\/dev\/(?!null|zero|random|urandom)/,   // Most /dev files
];

/**
 * Validate command for security issues
 *
 * @param command - Command to validate
 * @returns Validation result with reason if blocked
 *
 * @example
 * const validation = validateCommand('rm -rf /');
 * if (!validation.valid) {
 *   console.error(validation.reason);
 * }
 */
export function validateCommand(command: string): {
  valid: boolean;
  reason?: string;
} {
  // Check for Unicode homoglyph attacks (Cyrillic characters that look Latin)
  const homoglyphPattern = /[\u0400-\u04FF]/; // Cyrillic range
  if (homoglyphPattern.test(command)) {
    return {
      valid: false,
      reason: `Command blocked: Unicode homoglyph character detected - potential security risk`,
    };
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason: `Command blocked: dangerous operation detected`,
      };
    }
  }

  // Check for shell injection attempts
  const injectionPatterns = [
    /\$\(/,                    // Command substitution
    /`[^`]+`/,                 // Backtick command substitution
    /;\s*\w/,                  // Command chaining
    /\|\|/,                    // OR operator
    /&&/,                      // AND operator (allowed in moderation)
    />\s*\/dev\//,             // Redirect to /dev
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(command)) {
      // Allow && for simple command chaining
      if (pattern.source === /&&/.source) {
        const andCount = (command.match(/&&/g) || []).length;
        if (andCount > 3) {
          return {
            valid: false,
            reason: `Too many command chains (max 3): ${command}`,
          };
        }
        continue;
      }

      return {
        valid: false,
        reason: `Potential shell injection detected: ${command}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate file path for security issues
 * 
 * @param filePath - File path to validate
 * @param workspaceDir - Workspace directory (must stay within)
 * @returns Validation result with reason if blocked
 * 
 * @example
 * const validation = validateFilePath('../../../etc/passwd', '/workspace');
 * if (!validation.valid) {
 *   console.error(validation.reason);
 * }
 */
export function validateFilePath(
  filePath: string,
  workspaceDir: string
): {
  valid: boolean;
  reason?: string;
} {
  // Check for null bytes
  if (filePath.includes('\0')) {
    return {
      valid: false,
      reason: `Null byte in path: ${filePath}`,
    };
  }

  // Check against blocked file patterns
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return {
        valid: false,
        reason: `Access to sensitive path blocked: ${filePath}`,
      };
    }
  }

  // Resolve and validate path stays within workspace
  try {
    const resolved = filePath.startsWith('/')
      ? resolve(filePath)
      : resolve(workspaceDir, filePath);

    const rel = relative(workspaceDir, resolved);
    if (
      rel.startsWith('..') ||
      resolved === '..' ||
      resolve(workspaceDir, rel) !== resolved
    ) {
      return {
        valid: false,
        reason: `Path traversal rejected: ${filePath}`,
      };
    }
  } catch (error: any) {
    return {
      valid: false,
      reason: `Invalid path: ${error.message}`,
    };
  }

  return { valid: true };
}

/**
 * Resolve and validate path (combines resolve + validate)
 * 
 * @param filePath - File path to resolve
 * @param workspaceDir - Workspace directory (must stay within)
 * @returns Resolved path or throws error
 * @throws Error if path is invalid or traversal attempt
 * 
 * @example
 * const resolved = resolveAndValidatePath('../test.txt', '/workspace');
 * // Throws: Path traversal rejected: ../test.txt
 */
export function resolveAndValidatePath(
  filePath: string,
  workspaceDir: string
): string {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');

  // SECURITY: Block path traversal attempts
  if (normalized.includes('..') || normalized.includes('\0')) {
    throw new Error(`Path traversal rejected: ${filePath}`);
  }

  // Resolve absolute paths
  if (filePath.startsWith('/')) {
    const resolved = resolve(filePath);

    // SECURITY: Ensure path stays within workspace
    const rel = relative(workspaceDir, resolved);
    if (
      rel.startsWith('..') ||
      resolved === '..' ||
      resolve(workspaceDir, rel) !== resolved
    ) {
      throw new Error(`Path traversal rejected: ${filePath}`);
    }

    return resolved;
  }

  // Resolve relative paths
  const resolved = resolve(workspaceDir, filePath);

  // SECURITY: Double-check path is within workspace
  const rel = relative(workspaceDir, resolved);
  if (
    rel.startsWith('..') ||
    resolved === '..' ||
    resolve(workspaceDir, rel) !== resolved
  ) {
    throw new Error(`Path traversal rejected: ${filePath}`);
  }

  return resolved;
}

/**
 * Sanitize command for safe execution
 * 
 * This escapes special characters to prevent shell injection.
 * Use with caution - validation is preferred over sanitization.
 * 
 * @param command - Command to sanitize
 * @returns Sanitized command
 * 
 * @deprecated Use validateCommand() instead - sanitization can hide issues
 */
export function sanitizeCommand(command: string): string {
  // Escape single quotes
  return command.replace(/'/g, "'\\''");
}

/**
 * Security configuration for sandbox providers
 */
export interface SandboxSecurityConfig {
  /** Enable command validation (default: true) */
  enableCommandValidation?: boolean;
  /** Enable path validation (default: true) */
  enablePathValidation?: boolean;
  /** Enable file pattern blocking (default: true) */
  enableFileBlocking?: boolean;
  /** Additional blocked patterns */
  additionalBlockedPatterns?: RegExp[];
  /** Workspace directory */
  workspaceDir: string;
}

/**
 * Create security validator for sandbox provider
 * 
 * @param config - Security configuration
 * @returns Validator functions
 * 
 * @example
 * const security = createSandboxSecurity({ workspaceDir: '/workspace' });
 * 
 * // Validate before executing
 * const cmdValidation = security.validateCommand('rm -rf /');
 * if (!cmdValidation.valid) {
 *   throw new Error(cmdValidation.reason);
 * }
 */
export function createSandboxSecurity(config: SandboxSecurityConfig) {
  const {
    enableCommandValidation = true,
    enablePathValidation = true,
    enableFileBlocking = true,
    additionalBlockedPatterns = [],
    workspaceDir,
  } = config;

  // Add custom blocked patterns
  const allBlockedPatterns = [
    ...BLOCKED_COMMAND_PATTERNS,
    ...additionalBlockedPatterns,
  ];

  return {
    /**
     * Validate command
     */
    validateCommand(command: string) {
      if (!enableCommandValidation) {
        return { valid: true };
      }

      for (const pattern of allBlockedPatterns) {
        if (pattern.test(command)) {
          return {
            valid: false,
            reason: `Command blocked by security policy: ${command}`,
          };
        }
      }

      return { valid: true };
    },

    /**
     * Validate file path
     */
    validateFilePath(filePath: string) {
      if (!enablePathValidation && !enableFileBlocking) {
        return { valid: true };
      }

      return validateFilePath(filePath, workspaceDir);
    },

    /**
     * Resolve and validate path
     */
    resolvePath(filePath: string): string {
      return resolveAndValidatePath(filePath, workspaceDir);
    },
  };
}

/**
 * Default security configuration
 * 
 * Use this as a base for provider-specific configurations
 */
export const DEFAULT_SECURITY_CONFIG: SandboxSecurityConfig = {
  enableCommandValidation: true,
  enablePathValidation: true,
  enableFileBlocking: true,
  workspaceDir: '/workspace',
};
