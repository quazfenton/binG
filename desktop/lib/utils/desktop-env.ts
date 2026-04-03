/**
 * Desktop Environment Detection Utility
 *
 * Detects whether the app is running as a Tauri desktop app
 * and provides desktop-specific configuration.
 */

interface DesktopConfig {
  workspaceRoot: string;
  shell: string;
  shellArgs: string[];
  isLocalExecution: boolean;
  platform: 'win32' | 'darwin' | 'linux';
}

/**
 * Check if running inside a Tauri desktop shell (client-side)
 */
export function isTauriRuntime(): boolean {
  if (typeof window !== 'undefined') {
    return !!(window as any).__TAURI_INTERNALS__;
  }
  return false;
}

/**
 * Check if the app is configured for desktop mode (server-side or env-based)
 */
export function isDesktopMode(): boolean {
  if (isTauriRuntime()) return true;
  if (typeof process !== 'undefined' && process.env) {
    return process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
  }
  return false;
}

/**
 * Check if local (non-sandbox) execution is enabled
 */
export function isLocalExecution(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    return (
      process.env.DESKTOP_LOCAL_EXECUTION === 'true' ||
      process.env.DESKTOP_MODE === 'true'
    );
  }
  return isTauriRuntime();
}

/**
 * Get the platform-appropriate shell command
 * Validates shell path and provides robust fallbacks
 */
export function getShellCommand(): { shell: string; args: string[] } {
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';
  
  if (platform === 'win32') {
    // Windows always has PowerShell
    return { shell: 'powershell.exe', args: ['-NoProfile', '-Command'] };
  }
  
  // Unix-like systems: validate shell before using
  const userShell = typeof process !== 'undefined' ? process.env.SHELL : undefined;
  
  // Common shell fallbacks in order of preference
  const fallbackShells = ['/bin/bash', '/bin/sh', '/usr/bin/bash', '/usr/bin/sh'];
  
  // Check if user's shell exists (if fs module available)
  let selectedShell = userShell;
  if (userShell) {
    try {
      // Only check if running in Node.js with fs access
      if (typeof require !== 'undefined') {
        const fs = require('fs');
        if (!fs.existsSync(userShell)) {
          selectedShell = undefined;
        }
      }
    } catch {
      // fs not available or error - continue with validation
    }
  }
  
  // If no valid user shell, try fallbacks
  if (!selectedShell) {
    for (const fallback of fallbackShells) {
      try {
        if (typeof require !== 'undefined') {
          const fs = require('fs');
          if (fs.existsSync(fallback)) {
            selectedShell = fallback;
            break;
          }
        } else {
          // Can't check - use first fallback
          selectedShell = fallback;
          break;
        }
      } catch {
        continue;
      }
    }
  }
  
  // Final fallback
  if (!selectedShell) {
    selectedShell = '/bin/sh';
  }
  
  return { shell: selectedShell, args: ['-c'] };
}

/**
 * Get desktop-specific configuration
 * Validates workspace root path and ensures it's writable
 */
export function getDesktopConfig(): DesktopConfig {
  const platform = (typeof process !== 'undefined' ? process.platform : 'linux') as DesktopConfig['platform'];
  const { shell, args } = getShellCommand();

  let workspaceRoot: string;
  let workspaceRootValid = false;
  
  // Try configured path first
  if (typeof process !== 'undefined' && process.env.DESKTOP_WORKSPACE_ROOT) {
    workspaceRoot = process.env.DESKTOP_WORKSPACE_ROOT;
    workspaceRootValid = validateWorkspacePath(workspaceRoot);
  }
  
  // Try environment-based path
  if (!workspaceRootValid) {
    if (platform === 'win32') {
      if (process.env.USERPROFILE) {
        workspaceRoot = `${process.env.USERPROFILE}\\opencode-workspaces`;
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
      // Fallback to C: drive
      if (!workspaceRootValid) {
        workspaceRoot = 'C:\\opencode-workspaces';
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
    } else {
      if (process.env.HOME) {
        workspaceRoot = `${process.env.HOME}/opencode-workspaces`;
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
      // Fallback to /tmp
      if (!workspaceRootValid) {
        workspaceRoot = '/tmp/opencode-workspaces';
        workspaceRootValid = validateWorkspacePath(workspaceRoot);
      }
    }
  }
  
  // If all paths invalid, use current directory as last resort
  if (!workspaceRootValid) {
    workspaceRoot = './opencode-workspaces';
    console.warn('[DesktopConfig] All workspace paths invalid, using current directory:', workspaceRoot);
  }

  return {
    workspaceRoot,
    shell,
    shellArgs: args,
    isLocalExecution: isLocalExecution(),
    platform,
  };
}

/**
 * Validate that a workspace path exists and is writable
 */
function validateWorkspacePath(path: string): boolean {
  try {
    if (typeof require === 'undefined') {
      // Can't validate in browser environment - assume valid
      return true;
    }
    
    const fs = require('fs');
    const pathModule = require('path');
    
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
        `.write-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
        fs.rmdirSync(path);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    // Validation failed - assume valid to avoid breaking functionality
    return true;
  }
}
