/**
 * Server-side Shell Utilities
 * 
 * This module contains Node.js-specific shell detection and validation logic.
 * It is intended for use in server-side or desktop-local execution contexts.
 * 
 * ESM compatibility: Uses dynamic imports and createRequire for Node.js module access.
 */

import { type DesktopConfig } from '../env';
import { createRequire } from 'node:module';

// createRequire for ESM compatibility - allows using require in ESM modules
const _require = createRequire(import.meta.url);

/**
 * Sanitize and validate shell path to prevent PATH manipulation attacks.
 * Ensures the path is an absolute, normalized path that exists and is executable.
 */
function validateShellPath(shellPath: string): string | null {
  // Reject relative paths - prevents PATH manipulation
  if (!shellPath.startsWith('/')) {
    return null;
  }
  
  // Reject paths with null bytes (poison null byte attack)
  if (shellPath.includes('\0')) {
    return null;
  }
  
  // Normalize path to prevent directory traversal (e.g., /bin/../bin/sh)
  let normalized: string;
  try {
    // ESM-compatible: use _require for Node.js modules in this ESM package
    const pathModule = _require('path');
    normalized = pathModule.normalize(shellPath);
  } catch {
    // Fallback: convert backslashes and normalize traversal manually
    normalized = shellPath.replace(/\\/g, '/');
    // Remove any ../ components
    while (normalized.includes('/../')) {
      normalized = normalized.replace(/\/\.\.\//, '/');
    }
    // Remove any ./ components
    normalized = normalized.replace(/\/\.\//g, '/');
  }
  
  // Reject if path changed after normalization (directory traversal attempt)
  // This catches cases like "/bin/../bin/sh" -> "/bin/sh"
  if (normalized !== shellPath.replace(/\\/g, '/')) {
    return null;
  }
  
  // Validate file exists and is executable (on supported platforms)
  // NOTE: Uses _require (createRequire) for ESM compatibility since platform package is ESM
  try {
    const fs = _require('fs');
    const stats = fs.statSync(normalized);
    // Check if it's a file (not directory) and executable
    if (stats.isFile()) {
      const mode = stats.mode;
      // Check ALL execute bits (owner, group, other) - not just owner
      // This handles multi-user environments where shell may be executable by group/other
      if (mode & 0o111) return normalized;
    }
  } catch {
    // File doesn't exist or can't be accessed
  }
  
  return null;
}

/**
 * Get the platform-appropriate shell command
 * Used by the sandbox provider for command execution
 * 
 * Security: Shell path is validated to prevent PATH manipulation attacks
 * where a malicious user could inject a fake shell via environment variables.
 */
export function getShellCommand(): { shell: string; args: string[] } {
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';

  if (platform === 'win32') {
    return { shell: 'powershell.exe', args: ['-NoProfile', '-Command'] };
  }

  const fallbackShells = ['/bin/bash', '/bin/sh', '/usr/bin/bash', '/usr/bin/sh'];

  // NOTE: We do NOT trust process.env.SHELL directly as it could be
  // manipulated in shared server environments. Instead, we only use
  // well-known system paths that we can verify exist.
  // If you need user-preferred shells, add them to the fallback list
  // with proper validation.

  // Try known shells in order of preference
  for (const shell of fallbackShells) {
    const validated = validateShellPath(shell);
    if (validated) {
      return { shell: validated, args: ['-c'] };
    }
  }

  // Final fallback - last resort for compatibility
  // Uses the safest possible option
  return { shell: '/bin/sh', args: ['-c'] };
}

/**
 * Validate that a workspace path exists and is writable
 */
export function validateWorkspacePath(path: string): boolean {
  try {
    // ESM-compatible: use _require for fs and path modules (always available since we create it at module level)
    const fs = _require('fs');
    const pathModule = _require('path');

    // Check if path is empty
    if (!path) return false;

    // Check if parent directory exists
    const parentDir = pathModule.dirname(path);
    if (!fs.existsSync(parentDir)) {
      return false;
    }

    // Check if path exists and is writable
    if (fs.existsSync(path)) {
      // Try to write a test file with unique name to avoid race conditions
      const testFile = pathModule.join(
        path,
        `.write-test-${typeof process !== 'undefined' ? process.pid : 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return true;
      } catch {
        return false;
      }
    } else {
      // Path doesn't exist - check if we can create it
      try {
        fs.mkdirSync(path, { recursive: true });
        // Verify the directory is writable without deleting it
        fs.accessSync(path, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    // Validation failed - don't mask the error
    return false;
  }
}

/**
 * Get desktop-specific configuration for the current platform
 */
export function getDesktopConfig(
  isLocalExecution: boolean
): DesktopConfig {
  const platform = (typeof process !== 'undefined' ? process.platform : 'linux') as DesktopConfig['platform'];
  const { shell, args } = getShellCommand();

  let workspaceRoot: string = '';
  let workspaceRootValid = false;
  
  // Try configured path first
  if (typeof process !== 'undefined' && process.env.DESKTOP_WORKSPACE_ROOT) {
    workspaceRoot = process.env.DESKTOP_WORKSPACE_ROOT;
    workspaceRootValid = validateWorkspacePath(workspaceRoot);
  }
  
  // Try environment-based path
  if (!workspaceRootValid) {
    if (platform === 'win32') {
      if (typeof process !== 'undefined' && process.env.USERPROFILE) {
        workspaceRoot = `${process.env.USERPROFILE}\\workspace`;
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
      // Fallback to C: drive
      if (!workspaceRootValid) {
        workspaceRoot = 'C:\\workspace';
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
    } else {
      if (typeof process !== 'undefined' && process.env.HOME) {
        workspaceRoot = `${process.env.HOME}/workspace`;
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
      // Fallback to /tmp
      if (!workspaceRootValid) {
        workspaceRoot = '/tmp/workspace';
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
    }
  }
  
  // If all paths invalid, use current directory as last resort
  if (!workspaceRootValid) {
    workspaceRoot = './workspace';
  }

  return {
    workspaceRoot,
    shell,
    shellArgs: args,
    isLocalExecution,
    platform,
  };
}
