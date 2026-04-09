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

import { resolve, relative, posix as posixPath } from 'node:path';
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

  private static readonly SHELL_METADATA_CHARS = ['`', '$', '\n', '\r'];


  // Input size limits
  private static readonly MAX_PATH_LENGTH = 500;
  private static readonly MAX_COMMAND_LENGTH = 10000;
  private static readonly MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

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
    let normalized = inputPath.replace(/\\/g, '/');

    // Handle embedded Windows paths in Linux paths, e.g. "/home/user/C:/home/user"
    // This happens when a Windows absolute path is concatenated with a workspace dir
    // Pattern: some-prefix + DriveLetter:/ + rest
    const embeddedWindowsPath = normalized.match(/^(.*?)([A-Za-z]):\/(.*)$/);
    if (embeddedWindowsPath && normalized.startsWith('/')) {
      const prefix = embeddedWindowsPath[1];
      const rest = embeddedWindowsPath[3];
      console.warn(`[SandboxSecurityManager] Embedded Windows path detected`, {
        inputPath,
        normalized,
        prefix,
        rest,
        hint: 'Stripping Windows drive letter from embedded path'
      });
      normalized = prefix + rest;
    }

    // Check for Windows drive letters (e.g., C:\, D:\) - convert to Linux path
    // These appear as absolute paths on Windows but need special handling on Linux
    const windowsDriveMatch = normalized.match(/^([A-Za-z]):\//);
    if (windowsDriveMatch) {
      const driveLetter = windowsDriveMatch[1].toLowerCase();
      console.warn(`[SandboxSecurityManager] Converting Windows path to Linux path`, {
        inputPath,
        normalized,
        driveLetter,
        workspaceDir,
        hint: 'Windows absolute path detected - stripping drive letter'
      });
      // Strip the drive letter (e.g., "C:/home/user" -> "/home/user")
      normalized = normalized.slice(2);
    }

    // Handle paths that start with /workspace/ - convert to workspace-relative paths
    // This handles our internal /workspace/users/... paths for cloud sandboxes
    if (normalized.startsWith('/workspace/')) {
      // Convert /workspace/users/... to /home/user/workspace/...
      normalized = normalized.replace(/^\/workspace\//, '/home/user/workspace/');
    }

    // FIX: Strip any remaining Windows drive letter patterns (e.g., "/foo/C:/bar" → "/foo/bar")
    // This catches embedded paths that survived earlier normalization
    // The regex matches: anything + DriveLetter + / + anything
    const remainingDrivePattern = normalized.match(/^(.*)\/([A-Za-z]):\/(.*)$/);
    if (remainingDrivePattern) {
      const prefix = remainingDrivePattern[1];
      const rest = remainingDrivePattern[3];
      console.warn(`[SandboxSecurityManager] Stripping remaining embedded Windows path`, {
        inputPath,
        before: normalized,
        after: `${prefix}/${rest}`,
      });
      normalized = `${prefix}/${rest}`;
    }

    // Check for obvious traversal attempts
    if (normalized.includes('..') || normalized.includes('\0')) {
      throw new Error(`Security Exception: Path traversal attempt detected in '${inputPath}'`);
    }

    // Resolve absolute paths
    // Check normalized path for absoluteness (handles Windows paths converted to Linux absolute)
    let resolved: string;
    if (normalized.startsWith('/')) {
      resolved = resolve(normalized);
    } else {
      resolved = resolve(workspaceDir, normalized);
    }

    // CRITICAL: node:path.resolve() returns platform-native paths.
    // On Windows, resolve('/home/user') → 'C:\home\user'.
    // Sandbox providers (E2B, Daytona, etc.) run Linux — we MUST return
    // forward-slash paths. Strip Windows drive letters and convert separators.
    resolved = resolved.replace(/\\/g, '/');

    // FIX: Strip Windows drive letter while preserving absolute path semantics
    // C:/home/user → /home/user  (drive at start = root path)
    // /foo/C:/bar → /foo/bar     (embedded drive = strip drive + colon)
    if (/^[A-Za-z]:\//.test(resolved)) {
      // Drive at start: C:/home/user → /home/user (slice(2) keeps the /)
      resolved = resolved.slice(2);
    } else {
      // Embedded drive: /foo/C:/bar → /foo/bar
      const embeddedMatch = resolved.match(/^(.*)\/([A-Za-z]):\/(.*)$/);
      if (embeddedMatch) {
        resolved = `${embeddedMatch[1]}/${embeddedMatch[3]}`;
      }
    }

    // Ensure the resolved path is actually within the workspace
    // Allow /tmp paths for temporary prompt files
    if (normalized.startsWith('/tmp/') || normalized.startsWith('/tmp')) {
      return resolved;
    }

    // FIX: Use posix.relative() since sandbox paths are Linux-style
    // Using platform-native relative() on Windows breaks POSIX path comparisons
    const rel = posixPath.relative(workspaceDir, resolved);
    const isWithin = !rel.startsWith('..') && !posixPath.isAbsolute(rel);

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
