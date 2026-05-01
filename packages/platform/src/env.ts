/**
 * Platform Environment Detection
 *
 * Centralized detection of whether the app is running in a
 * Tauri desktop shell or a web browser.
 *
 * @see https://tauri.app/v1/api/js
 */

/**
 * Check if running inside a Tauri desktop shell (client-side)
 * Uses the official Tauri runtime marker
 */
export function isTauriRuntime(): boolean {
  if (typeof window !== 'undefined') {
    return !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
  }
  return false;
}

/**
 * Check if the app is configured for desktop mode (server-side or env-based)
 * Falls back to environment variables for SSR/Next.js contexts
 */
export function isDesktopMode(): boolean {
  if (isTauriRuntime()) return true;
  if (typeof process !== 'undefined' && process.env) {
    return process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
  }
  return false;
}

/**
 * Check if running in a web browser (not desktop)
 * Use as function to get runtime value, not module-load-time value
 */
export function isWeb(): boolean {
  return !isDesktopMode();
}

/**
 * Get the current platform identifier
 */
export function getPlatform(): 'desktop' | 'web' {
  return isDesktopMode() ? 'desktop' : 'web';
}

/**
 * Check if local (non-sandbox) execution is enabled
 * Used by the server to determine whether to execute commands locally
 *
 * DESKTOP_LOCAL_EXECUTION: Explicitly enables local execution
 * DESKTOP_MODE: Enables desktop mode (which implies local execution)
 */
export function isLocalExecution(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    // Explicit local execution flag takes priority
    if (process.env.DESKTOP_LOCAL_EXECUTION === 'true') {
      return true;
    }
    // Desktop mode implies local execution
    if (process.env.DESKTOP_MODE === 'true') {
      return true;
    }
  }
  // Tauri runtime always supports local execution
  return isTauriRuntime();
}

/**
 * Get the default workspace root for the current platform
 * Returns null if no suitable home directory can be determined
 */
export function getDefaultWorkspaceRoot(): string | null {
  // Priority 1: explicit desktop/workspace launch env vars.
  if (typeof process !== 'undefined' && process.env) {
    const explicitRoot =
      process.env.INITIAL_CWD ||
      process.env.LAUNCH_CWD ||
      process.env.DESKTOP_WORKSPACE_ROOT;
    if (explicitRoot) {
      return explicitRoot;
    }
  }

  // Priority 2: CLI/standalone mode — use the process's actual working directory.
  // The parent process's cwd is the directory from which the CLI was invoked,
  // which is the correct workspace root (not the bundled binary's location).
  if (typeof process !== 'undefined' && process.cwd) {
    try {
      const cwd = process.cwd();
      if (cwd) {
        return cwd;
      }
    } catch (err) {
      // process.cwd() may throw in some environments (e.g., restricted context, permission denied)
      // Log for debugging but continue to fallback logic
      if (typeof console !== 'undefined') {
        console.warn('[env.ts] Failed to get process.cwd():', err);
      }
    }
  }
  
import * as path from 'path';

  const platform = typeof process !== 'undefined' ? process.platform : 'linux';

// ... (existing code, skipping to getDefaultWorkspaceRoot)

  if (platform === 'win32') {
    const userProfile = typeof process !== 'undefined' && process.env ? process.env.USERPROFILE : undefined;
    if (!userProfile || typeof userProfile !== 'string' || userProfile.trim() === '') {
      return null;
    }
    return path.join(userProfile, 'workspace');
  }

  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  if (!home || typeof home !== 'string' || home.trim() === '') {
    return null;
  }
  return path.join(home, 'workspace');
}

export interface DesktopConfig {
  workspaceRoot: string;
  shell: string;
  shellArgs: string[];
  isLocalExecution: boolean;
  platform: 'win32' | 'darwin' | 'linux';
}
