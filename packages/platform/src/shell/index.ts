/**
 * Server-side Shell Utilities
 * 
 * This module contains Node.js-specific shell detection and validation logic.
 * It is intended for use in server-side or desktop-local execution contexts.
 */

import { type DesktopConfig } from '../env';

/**
 * Get the platform-appropriate shell command
 * Used by the sandbox provider for command execution
 */
export function getShellCommand(): { shell: string; args: string[] } {
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';

  if (platform === 'win32') {
    return { shell: 'powershell.exe', args: ['-NoProfile', '-Command'] };
  }

  const userShell = typeof process !== 'undefined' ? process.env.SHELL : undefined;
  const fallbackShells = ['/bin/bash', '/bin/sh', '/usr/bin/bash', '/usr/bin/sh'];

  // Try user shell first, then fallbacks
  const shellsToTry = userShell ? [userShell, ...fallbackShells] : fallbackShells;

  for (const shell of shellsToTry) {
    try {
      if (typeof require !== 'undefined') {
        try {
          const fs = require('fs');
          if (fs.existsSync(shell)) {
            return { shell, args: ['-c'] };
          }
        } catch {
          // Module not found or other require error
          continue;
        }
      } else {
        // Can't check - use first available
        return { shell, args: ['-c'] };
      }
    } catch {
      continue;
    }
  }

  // Final fallback
  return { shell: '/bin/sh', args: ['-c'] };
}

/**
 * Validate that a workspace path exists and is writable
 */
export function validateWorkspacePath(path: string): boolean {
  try {
    if (typeof require === 'undefined') {
      // Can't validate in browser environment - assume valid
      return true;
    }

    let fs;
    let pathModule;
    try {
      fs = require('fs');
      pathModule = require('path');
    } catch {
      return true;
    }

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
