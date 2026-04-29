/**
 * Desktop Environment Detection Utility
 *
 * Detects whether the app is running as a Tauri desktop app
 * and provides desktop-specific configuration.
 */

import { 
  isTauriRuntime as platformIsTauriRuntime,
  isDesktopMode as platformIsDesktopMode,
  isLocalExecution as platformIsLocalExecution,
  getPlatform as platformGetPlatform,
  getDefaultWorkspaceRoot as platformGetDefaultWorkspaceRoot,
  type DesktopConfig as PlatformDesktopConfig
} from '@bing/platform/env';

export type DesktopConfig = PlatformDesktopConfig;

/**
 * Check if running inside a Tauri desktop shell (client-side)
 */
export const isTauriRuntime = platformIsTauriRuntime;

/**
 * Check if the app is configured for desktop mode (server-side or env-based)
 */
export const isDesktopMode = platformIsDesktopMode;

/**
 * Check if local (non-sandbox) execution is enabled
 */
export const isLocalExecution = platformIsLocalExecution;

/**
 * Get the current platform identifier
 */
export const getPlatform = platformGetPlatform;

/**
 * Get the default workspace root for the current platform
 */
export const getDefaultWorkspaceRoot = platformGetDefaultWorkspaceRoot;

/**
 * Get the desktop workspace directory
 * Re-implementation of the removed function using platform-safe methods
 */
export function getDesktopWorkspaceDir(): string {
  // Priority 1: Tauri config (set at app startup, available in browser context)
  if (typeof window !== 'undefined' && (window as any).__SIDECAR_CONFIG__?.workspace_root) {
    return (window as any).__SIDECAR_CONFIG__.workspace_root;
  }
  // Priority 2: Environment variable (set by Tauri before spawning sidecar)
  if (typeof process !== 'undefined' && process.env.DESKTOP_WORKSPACE_ROOT) {
    return process.env.DESKTOP_WORKSPACE_ROOT;
  }
  // Priority 3: Fallback to platform defaults
  return getDefaultWorkspaceRoot();
}

/**
 * Get desktop-specific configuration
 * Browser-safe version that doesn't use 'fs'
 */
export function getDesktopConfig(): DesktopConfig {
  return {
    workspaceRoot: getDesktopWorkspaceDir(),
    shell: typeof process !== 'undefined' && process.platform === 'win32' ? 'powershell.exe' : 'bash',
    shellArgs: typeof process !== 'undefined' && process.platform === 'win32' ? ['-NoProfile', '-Command'] : ['-c'],
    isLocalExecution: isLocalExecution(),
    platform: (typeof process !== 'undefined' ? process.platform : 'linux') as DesktopConfig['platform'],
  };
}
