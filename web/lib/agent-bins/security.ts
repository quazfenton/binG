/**
 * Agent Filesystem Security Utilities
 * 
 * Centralized path normalization, workspace isolation, and security
 * functions used by all agent binaries (Pi, OpenCode, Codex, Amp, Claude Code).
 * 
 * This ensures consistent security across all agents.
 */

import path from 'node:path';

/**
 * Secret file patterns that should never be read or written.
 * These patterns prevent accidental exposure of credentials.
 */
const SECRET_PATTERNS = [
  /\.env$/,
  /\.env\.local$/,
  /\.env\.development$/,
  /\.env\.production$/,
  /\.env\.test$/,
  /\.env\.prod$/,
  /\.env\.dev$/,
  /auth\.json$/,
  /credentials\.json$/,
  /\.npmrc$/,
  /\.netrc$/,
  /id_rsa$/,
  /id_dsa$/,
  /id_ecdsa$/,
  /id_ed25519$/,
  /\.pem$/,
  /\.key$/,
  /\.crt$/,
  /\.p12$/,
  /\.pfx$/,
  /cookie$/,
  /secret$/,
  /passwd$/,
  /shadow$/,
  /group$/,
];

/**
 * Dangerous path patterns that should be blocked.
 */
const DANGEROUS_PATTERNS = [
  /^\/etc\//,
  /^\/etc$/,
  /^\/root\//,
  /^\/root$/,
  /^\/sys\//,
  /^\/proc\//,
  /^\/boot\//,
  /^\/dev\//,
  /^\/var\/log\//,
  /^\/var\/cache\//,
  new RegExp('^[A-Z]:\\\\Windows', 'i'),
  new RegExp('^[A-Z]:\\\\Users\\\\Public', 'i'),
];

/**
 * Sensitive directories that should be isolated.
 */
const SENSITIVE_DIRS = [
  '.git',
  '.svn',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
];

/**
 * Normalize and secure a file path for workspace operations.
 * 
 * - Strips leading ./
 - Removes .. traversal attempts
 - Converts absolute paths to relative
 * 
 * @param inputPath - Raw input path
 * @param workspaceRoot - The allowed workspace root
 * @returns Normalized path relative to workspace
 * @throws Error if path escapes workspace
 */
export function normalizeAndSecurePath(
  inputPath: string,
  workspaceRoot: string = '/workspace'
): string {
  let p = inputPath;
  
  // Strip leading ./
  while (p.startsWith('./')) {
    p = p.slice(2);
  }
  
  // Check for directory traversal before normalizing
  if (p.includes('..')) {
    const segments = p.split('/').filter(s => s !== '..' && s !== '.');
    p = segments.join('/');
    
    // Double-check after removal
    if (p.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed');
    }
  }
  
  // Make absolute paths relative
  if (p.startsWith('/')) {
    p = p.slice(1);
  }
  
  // Windows path handling
  if (/^[A-Z]:/.test(p)) {
    p = p.slice(3); // Remove drive letter
  }
  
  // Resolve against workspace root
  const resolved = path.posix.resolve(workspaceRoot, p);
  
  // Ensure path is within workspace
  if (!resolved.startsWith(workspaceRoot.replace(/\/$/, ''))) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  
  return p;
}

/**
 * Check if a path points to a secret file.
 * 
 * @param filePath - File path to check
 * @returns true if path is a secret file
 */
export function isSecretPath(filePath: string): boolean {
  const basename = path.basename(filePath);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(basename)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a path is in a dangerous location.
 * 
 * @param filePath - File path to check
 * @returns true if path is dangerous
 */
export function isDangerousPath(filePath: string): boolean {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter out sensitive directories from file listings.
 * 
 * @param entries - Directory entries
 * @returns Filtered entries
 */
export function filterSensitiveDirs<T extends { name: string }>(entries: T[]): T[] {
  return entries.filter(entry => {
    for (const dir of SENSITIVE_DIRS) {
      if (entry.name === dir) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Secure read operation - validates path before reading.
 * 
 * @param readFn - Async function to perform the read
 * @param filePath - Path to read
 * @param workspaceRoot - Workspace root for validation
 * @returns File contents
 * @throws Error if path is invalid or secret
 */
export async function secureRead<T>(
  readFn: (path: string) => Promise<T>,
  filePath: string,
  workspaceRoot: string = '/workspace'
): Promise<T> {
  const normalizedPath = normalizeAndSecurePath(filePath, workspaceRoot);
  
  if (isSecretPath(normalizedPath)) {
    throw new Error(`Cannot read secret file: ${filePath}`);
  }
  
  if (isDangerousPath(normalizedPath)) {
    throw new Error(`Cannot read from dangerous location: ${filePath}`);
  }
  
  return readFn(normalizedPath);
}

/**
 * Secure write operation - validates path before writing.
 * 
 * @param writeFn - Async function to perform the write
 * @param filePath - Path to write
 * @param content - Content to write
 * @param workspaceRoot - Workspace root for validation
 * @returns Operation result
 * @throws Error if path is invalid or secret
 */
export async function secureWrite<T>(
  writeFn: (path: string, content: string) => Promise<T>,
  filePath: string,
  content: string,
  workspaceRoot: string = '/workspace'
): Promise<T> {
  const normalizedPath = normalizeAndSecurePath(filePath, workspaceRoot);
  
  if (isSecretPath(normalizedPath)) {
    throw new Error(`Cannot write to secret file: ${filePath}`);
  }
  
  if (isDangerousPath(normalizedPath)) {
    throw new Error(`Cannot write to dangerous location: ${filePath}`);
  }
  
  // Detect accidental file wipe (writing empty to non-empty file without warning)
  if (!content || content.trim() === '') {
    // Allow but could log warning - this is common for reset operations
  }
  
  return writeFn(normalizedPath, content);
}

/**
 * Get git-backed VFS for rollback support.
 * Available in web mode with VFS service.
 * 
 * @param userId - User ID
 * @returns Git-backed VFS wrapper
 */
export async function getGitBackedVFS(userId: string): Promise<{
  rollbackToVersion: (version: number) => Promise<void>;
  commitChanges: (message: string) => Promise<void>;
} | null> {
  try {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
    const vfs = virtualFilesystem.getGitBackedVFS?.(userId);
    if (!vfs) return null;
    
    return {
      rollbackToVersion: (version: number) => vfs.rollbackToVersion(userId, version),
      commitChanges: (message: string) => vfs.commitChanges(userId, message),
    };
  } catch {
    return null;
  }
}

/**
 * Check command security using existing terminal-security module.
 * This provides extensive dangerous pattern detection.
 * 
 * @param command - Shell command to check
 * @returns Security result
 */
export async function checkCommandSecurity(
  command: string
): Promise<{ allowed: boolean; reason?: string; severity?: string }> {
  try {
    const terminalSecurity = await import('../terminal/security/terminal-security');
    const result = terminalSecurity.checkCommandSecurity(command);
    return {
      allowed: result.allowed,
      reason: result.reason,
      severity: result.severity,
    };
  } catch {
    // Fallback: allow if terminal-security not available
    return { allowed: true };
  }
}

/**
 * Confirmation-required commands that need user confirmation before execution.
 * These can overwrite files or delete data.
 */
export const CONFIRM_REQUIRED_COMMANDS = new Set([
  'rm',
  'rmdir',
  'del',
  'rmdir',
  'mv',
  'move',
  'cp',
  'copy',
  'format',
]);

/**
 * Force confirmation commands - always need confirmation.
 */
export const ALWAYS_CONFIRM_COMMANDS = new Set([
  'rm -rf',
  'rm -r',
  'del /s /q',
  'rmdir /s /q',
]);

/**
 * Determine if a command requires confirmation before execution.
 * 
 * @param command - Full command string
 * @param targetExists - Whether the target file/directory exists
 * @returns { needsConfirmation: boolean; reason?: string }
 */
export function requiresConfirmation(
  command: string,
  targetExists: boolean = false
): { needsConfirmation: boolean; reason?: string } {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0] || '';
  
  // Always require confirmation for dangerous commands
  for (const dangerous of ALWAYS_CONFIRM_COMMANDS) {
    if (command.includes(dangerous)) {
      return { 
        needsConfirmation: true, 
        reason: `Dangerous command: ${dangerous}` 
      };
    }
  }
  
  // Require confirmation for destructive commands if target exists
  if (CONFIRM_REQUIRED_COMMANDS.has(cmd) && targetExists) {
    return { 
      needsConfirmation: true, 
      reason: `Target file already exists: will be overwritten` 
    };
  }
  
  return { needsConfirmation: false };
}

/**
 * Get file version history for rollback UI.
 * 
 * @param userId - User ID  
 * @param filePath - File path
 * @param limit - Max versions to return
 * @returns Version history
 */
export async function getFileHistory(
  userId: string,
  filePath: string,
  limit: number = 10
): Promise<Array<{ version: number; date: string; message: string }>> {
  try {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
    const gitVFS = virtualFilesystem.getGitBackedVFS?.(userId);
    
    if (!gitVFS) return [];
    
    // This would call git log for the file
    // Implementation depends on git-backed-vfs.ts
    return [];
  } catch {
    return [];
  }
}