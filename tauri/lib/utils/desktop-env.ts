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
    return process.env.DESKTOP_MODE === 'true';
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
 */
export function getShellCommand(): { shell: string; args: string[] } {
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';
  if (platform === 'win32') {
    return { shell: 'powershell.exe', args: ['-NoProfile', '-Command'] };
  }
  // Prefer user's SHELL env, fallback to bash
  const userShell = typeof process !== 'undefined' ? process.env.SHELL : undefined;
  return { shell: userShell || '/bin/bash', args: ['-c'] };
}

/**
 * Get desktop-specific configuration
 */
export function getDesktopConfig(): DesktopConfig {
  const platform = (typeof process !== 'undefined' ? process.platform : 'linux') as DesktopConfig['platform'];
  const { shell, args } = getShellCommand();

  let workspaceRoot: string;
  if (typeof process !== 'undefined' && process.env.DESKTOP_WORKSPACE_ROOT) {
    workspaceRoot = process.env.DESKTOP_WORKSPACE_ROOT;
  } else if (platform === 'win32') {
    workspaceRoot = process.env.USERPROFILE
      ? `${process.env.USERPROFILE}\\opencode-workspaces`
      : 'C:\\opencode-workspaces';
  } else {
    workspaceRoot = process.env.HOME
      ? `${process.env.HOME}/opencode-workspaces`
      : '/tmp/opencode-workspaces';
  }

  return {
    workspaceRoot,
    shell,
    shellArgs: args,
    isLocalExecution: isLocalExecution(),
    platform,
  };
}
