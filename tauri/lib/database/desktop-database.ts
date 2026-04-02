/**
 * Desktop Database Configuration
 *
 * Provides desktop-specific database path and initialization.
 * In desktop mode, uses a bundled SQLite database in the user's
 * app data directory instead of server-based paths.
 */

import path from 'node:path';
import os from 'node:os';
import { isDesktopMode } from '@/lib/utils/desktop-env';

/**
 * Get the database path for the current environment
 */
export function getDesktopDBPath(): string {
  const homeDir = os.homedir();
  const platform = process.platform;

  if (platform === 'win32') {
    return path.join(homeDir, '.opencode', 'data', 'binG.db');
  }

  // macOS / Linux
  return path.join(homeDir, '.opencode', 'data', 'binG.db');
}

/**
 * Get the app data directory for desktop
 */
export function getDesktopAppDataDir(): string {
  const homeDir = os.homedir();
  const platform = process.platform;

  if (platform === 'win32') {
    return path.join(homeDir, '.opencode');
  }

  return path.join(homeDir, '.opencode');
}

/**
 * Get the workspace directory for desktop mode
 */
export function getDesktopWorkspaceDir(): string {
  const homeDir = os.homedir();
  const platform = process.platform;
  const envWorkspace = process.env.DESKTOP_WORKSPACE_ROOT;

  if (envWorkspace) {
    return envWorkspace;
  }

  if (platform === 'win32') {
    return path.join(homeDir, 'Documents', 'opencode-workspaces');
  }

  return path.join(homeDir, 'opencode-workspaces');
}

/**
 * Get checkpoint directory for desktop mode
 */
export function getDesktopCheckpointDir(): string {
  return path.join(getDesktopAppDataDir(), 'checkpoints');
}

/**
 * Get log directory for desktop mode
 */
export function getDesktopLogDir(): string {
  return path.join(getDesktopAppDataDir(), 'logs');
}

/**
 * Check if database should use desktop path
 */
export function shouldUseDesktopDB(): boolean {
  return isDesktopMode();
}

/**
 * Get database configuration based on environment
 */
export function getDatabaseConfig() {
  const isDesktop = shouldUseDesktopDB();

  if (isDesktop) {
    return {
      path: getDesktopDBPath(),
      appDataDir: getDesktopAppDataDir(),
      workspaceDir: getDesktopWorkspaceDir(),
      checkpointDir: getDesktopCheckpointDir(),
      logDir: getDesktopLogDir(),
      isDesktop: true,
    };
  }

  // Server/default configuration
  return {
    path: process.env.DATABASE_PATH || './data/binG.db',
    appDataDir: undefined,
    workspaceDir: undefined,
    checkpointDir: undefined,
    logDir: undefined,
    isDesktop: false,
  };
}

export default getDatabaseConfig;