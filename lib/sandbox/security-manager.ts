/**
 * Sandbox Security Manager
 *
 * Provides unified security controls for all sandbox providers:
 * - Path validation and normalization
 * - Command sanitization and injection prevention
 * - Dangerous pattern detection
 * - Input size validation
 *
 * @see docs/COMPREHENSIVE_TECHNICAL_REVIEW_2026-02-28.md Security section
 */

import { resolve, relative } from 'node:path';
import { 
  FilePathSchema, 
  FileContentSchema, 
  ShellCommandSchema,
  validateToolInput,
  WriteFileSchema,
  ExecShellSchema,
} from './validation-schemas';

export interface SecurityValidationResult {
  isValid: boolean;
  reason?: string;
  normalizedPath?: string;
  sanitizedCommand?: string;
}

export class SandboxSecurityManager {
  private static readonly DANGEROUS_COMMAND_PARTIALS = [
    // Privilege escalation
    'sudo ', 'su ',
    // Network exfiltration / downloads
    'curl ', 'wget ', 'nc ', 'netcat ',
    // Container escapes
    'docker ', 'kubectl ',
    // System modification
    'chmod ', 'chown ', 'mkfs ', 'fdisk ',
    // Shell manipulation
    'eval ', 'source ', '. ',
  ];

  private static readonly SHELL_METADATA_CHARS = [';', '&&', '||', '|', '`', '$', '>', '<', '&', '\n', '\r'];

  // Input size limits
  private static readonly MAX_PATH_LENGTH = 500;
  private static readonly MAX_COMMAND_LENGTH = 10000;
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Resolve and validate a path within the workspace
   * 
   * Includes schema validation, path traversal detection, and workspace containment
   */
  static resolvePath(workspaceDir: string, inputPath: string): string {
    // First validate with schema
    try {
      validateToolInput(FilePathSchema, inputPath, 'file_path')
    } catch (error: any) {
      throw new Error(`Security Exception: Invalid path - ${error.message}`);
    }

    // Normalize path separators
    const normalized = inputPath.replace(/\\/g, '/');

    // Check for obvious traversal attempts
    if (normalized.includes('..') || normalized.includes('\0')) {
      throw new Error(`Security Exception: Path traversal attempt detected in '${inputPath}'`);
    }

    // Resolve absolute paths
    let resolved: string;
    if (inputPath.startsWith('/')) {
      resolved = resolve(inputPath);
    } else {
      resolved = resolve(workspaceDir, normalized);
    }

    // Ensure the resolved path is actually within the workspace
    const rel = relative(workspaceDir, resolved);
    const isWithin = !rel.startsWith('..') && !pathIsAbsolute(rel);

    if (!isWithin && resolved !== workspaceDir) {
      throw new Error(`Security Exception: Path '${inputPath}' is outside the authorized workspace '${workspaceDir}'`);
    }

    return resolved;
  }

  /**
   * Sanitize shell command to prevent injection and restricted tool usage
   * 
   * Includes schema validation, metacharacter blocking, and dangerous keyword detection
   */
  static sanitizeCommand(command: string): string {
    // First validate with schema
    try {
      validateToolInput(ExecShellSchema, { command }, 'exec_shell')
    } catch (error: any) {
      throw new Error(`Security Exception: Invalid command - ${error.message}`);
    }

    const trimmed = command.trim();

    if (!trimmed) {
      throw new Error('Command is empty');
    }

    // Additional length check (schema validates but explicit check is clearer)
    if (trimmed.length > this.MAX_COMMAND_LENGTH) {
      throw new Error(`Security Exception: Command too long (max ${this.MAX_COMMAND_LENGTH} characters)`);
    }

    // Block ALL shell metacharacters for security (no pipes, redirects, or chaining)
    for (const char of this.SHELL_METADATA_CHARS) {
      if (trimmed.includes(char)) {
        throw new Error(`Security Exception: Unsafe character '${char}' detected in command`);
      }
    }

    // Check for dangerous partials
    const lowerCommand = trimmed.toLowerCase();
    for (const partial of this.DANGEROUS_COMMAND_PARTIALS) {
      if (lowerCommand.startsWith(partial)) {
        throw new Error(`Security Exception: Command starts with restricted keyword '${partial.trim()}'`);
      }
    }

    return trimmed;
  }

  /**
   * Validate file content size
   * 
   * Prevents writing extremely large files that could exhaust disk space
   */
  static validateFileContent(content: string): string {
    try {
      validateToolInput(FileContentSchema, content, 'file_content')
    } catch (error: any) {
      throw new Error(`Security Exception: Invalid file content - ${error.message}`);
    }

    // Additional explicit size check
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > this.MAX_FILE_SIZE) {
      throw new Error(`Security Exception: File content too large (max ${this.MAX_FILE_SIZE / 1024 / 1024}MB, got ${(byteLength / 1024 / 1024).toFixed(2)}MB)`);
    }

    return content;
  }

  /**
   * Combined validation for write file operations
   * 
   * Validates both path and content in a single call
   */
  static validateWriteFile(filePath: string, content: string, workspaceDir: string): { resolvedPath: string; validatedContent: string } {
    // Validate path
    const resolvedPath = this.resolvePath(workspaceDir, filePath);
    
    // Validate content
    const validatedContent = this.validateFileContent(content);
    
    return { resolvedPath, validatedContent };
  }

  /**
   * Combined validation for command execution
   * 
   * Validates and sanitizes command in a single call
   */
  static validateAndSanitizeCommand(command: string): string {
    return this.sanitizeCommand(command);
  }
}

/**
 * Utility to check if a path is absolute (handles both Windows and POSIX)
 */
function pathIsAbsolute(p: string): boolean {
  return /^(?:\/|[a-z]:)/i.test(p);
}
