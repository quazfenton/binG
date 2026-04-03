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
 * Get the default workspace root for the current platform
 */
export function getDefaultWorkspaceRoot(): string {
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';

  if (platform === 'win32') {
    const userProfile = typeof process !== 'undefined' ? process.env.USERPROFILE : undefined;
    return `${userProfile || 'C:\\Users\\Default'}\\opencode-workspaces`;
  }

  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  return `${home || '/tmp'}/opencode-workspaces`;
}

export interface DesktopConfig {
  workspaceRoot: string;
  shell: string;
  shellArgs: string[];
  isLocalExecution: boolean;
  platform: 'win32' | 'darwin' | 'linux';
}
