/**
 * Tauri IPC Bridge
 *
 * TypeScript wrapper around @tauri-apps/api/core invoke() for calling
 * Rust commands from the frontend. Provides typed interfaces for
 * native dialogs, file pickers, notifications, and custom commands.
 */

import { invoke } from '@tauri-apps/api/core';
import { isDesktopMode, isTauriRuntime } from '@bing/platform/env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('TauriInvoke');

// Type definitions for Tauri commands
export interface ExecuteCommandResult {
  success: boolean;
  output: string;
  exit_code: number;
  error?: string;
}

export interface FileOperationResult {
  success: boolean;
  output?: string;
  content?: string;
  error?: string;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

export interface SystemInfo {
  // Note: Rust only returns os, arch, hostname - other fields will be undefined
  platform: string;  // Maps from Rust 'os'
  arch: string;
  version?: string;  // Not available from Rust
  hostname: string;
  cpuCount?: number;  // Not available from Rust
  totalMemory?: number;  // Not available from Rust
  homeDir?: string;  // Not available from Rust
  tempDir?: string;  // Not available from Rust
}

export interface CheckpointInfo {
  id: string;
  name: string;
  created_at: string;
  file_count?: number;
}

export interface ResourceUsage {
  cpu_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  active_processes: number;
}

/**
 * Check if Tauri commands are available
 */
export function isTauriAvailable(): boolean {
  return isTauriRuntime() || isDesktopMode();
}

/**
 * Save desktop settings to Tauri store
 */
export async function saveSettings(settings: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri runtime not available');
  }

  try {
    return await invoke<{ success: boolean; error?: string }>('save_settings', { settings });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Load desktop settings from Tauri store
 */
export async function loadSettings(): Promise<Record<string, unknown> | null> {
  if (!isTauriAvailable()) {
    return null;
  }

  try {
    return await invoke<Record<string, unknown>>('load_settings');
  } catch {
    return null;
  }
}

/**
 * Open directory dialog
 */
export async function openDirectoryDialog(options: {
  title?: string;
  defaultPath?: string;
}): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!isTauriAvailable()) {
    // Fallback to browser file input
    return { success: false, error: 'Tauri not available' };
  }

  try {
    return await invoke<{ success: boolean; path?: string; error?: string }>('open_directory_dialog', options);
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}



/**
 * Execute a shell command in the sandbox
 */
export async function executeCommand(
  _sandboxId: string,  // Note: Not used - sandbox not implemented in Rust
  command: string,
  cwd?: string,
  _timeout?: number  // Note: Not used - timeout not implemented in Rust
): Promise<ExecuteCommandResult> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri runtime not available');
  }

  try {
    // Note: Rust handler only accepts 'command' and 'cwd' - sandboxId and timeout are ignored
    return await invoke<ExecuteCommandResult>('execute_command', {
      command,
      cwd,
    });
  } catch (error: any) {
    log.error('execute_command failed', error);
    return {
      success: false,
      output: '',
      exit_code: 1,
      error: error.message || String(error),
    };
  }
}

/**
 * Read a file from the sandbox
 */
export async function readFile(
  sandboxId: string,
  filePath: string
): Promise<FileOperationResult> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri runtime not available');
  }

  try {
    const content = await invoke<string>('read_file', {
      sandboxId,
      filePath,
    });
    return {
      success: true,
      content,
      output: content,
    };
  } catch (error: any) {
    log.error('read_file failed', error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Write a file to the sandbox
 */
export async function writeFile(
  sandboxId: string,
  filePath: string,
  content: string
): Promise<FileOperationResult> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri runtime not available');
  }

  try {
    await invoke('write_file', {
      sandboxId,
      filePath,
      content,
    });
    return {
      success: true,
      output: `File written: ${filePath}`,
    };
  } catch (error: any) {
    log.error('write_file failed', error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * List directory contents
 */
export async function listDirectory(
  sandboxId: string,
  dirPath: string
): Promise<{ success: boolean; entries?: DirectoryEntry[]; error?: string }> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri runtime not available');
  }

  try {
    const entries = await invoke<DirectoryEntry[]>('list_directory', {
      sandboxId,
      dirPath,
    });
    return {
      success: true,
      entries,
    };
  } catch (error: any) {
    log.error('list_directory failed', error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Get system information
 */
export async function getSystemInfo(): Promise<SystemInfo | null> {
  if (!isTauriAvailable()) {
    return null;
  }

  try {
    const raw = await invoke<{ os: string; arch: string; hostname: string }>('get_system_info');
    return {
      platform: raw.os,
      arch: raw.arch,
      hostname: raw.hostname,
      cpuCount: 0,
      totalMemory: 0,
      homeDir: '',
      tempDir: '',
    };
  } catch (error: any) {
    log.error('get_system_info failed', error);
    return null;
  }
}

// Note: Checkpoint commands (create_checkpoint, restore_checkpoint, list_checkpoints, delete_checkpoint)
// are NOT implemented in the Rust backend. These functions will always fail with "unknown command" errors.
// They're kept here for potential future implementation.

/**
 * Create a checkpoint (NOT IMPLEMENTED IN RUST)
 * @deprecated This command is not yet implemented in the Rust backend
 */
export async function createCheckpoint(
  _sandboxId: string,
  _name?: string
): Promise<CheckpointInfo | null> {
  if (!isTauriAvailable()) {
    return null;
  }
  log.warn('create_checkpoint is not implemented in the Rust backend');
  return null;
}

/**
 * Restore a checkpoint (NOT IMPLEMENTED IN RUST)
 * @deprecated This command is not yet implemented in the Rust backend
 */
export async function restoreCheckpoint(
  _sandboxId: string,
  _checkpointId: string
): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }
  log.warn('restore_checkpoint is not implemented in the Rust backend');
  return false;
}

/**
 * List checkpoints (NOT IMPLEMENTED IN RUST)
 * @deprecated This command is not yet implemented in the Rust backend
 */
export async function listCheckpoints(
  _sandboxId: string
): Promise<{ success: boolean; checkpoints?: CheckpointInfo[]; error?: string }> {
  if (!isTauriAvailable()) {
    return { success: false, error: 'Tauri not available' };
  }
  log.warn('list_checkpoints is not implemented in the Rust backend');
  return { success: false, error: 'list_checkpoints is not implemented in the Rust backend' };
}

/**
 * Delete a checkpoint (NOT IMPLEMENTED IN RUST)
 * @deprecated This command is not yet implemented in the Rust backend
 */
export async function deleteCheckpoint(
  _sandboxId: string,
  _checkpointId: string
): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }
  log.warn('delete_checkpoint is not implemented in the Rust backend');
  return false;
}

/**
 * Get current resource usage
 */
export async function getResourceUsage(): Promise<ResourceUsage | null> {
  if (!isTauriAvailable()) {
    return null;
  }

  try {
    return await invoke<ResourceUsage>('get_resource_usage');
  } catch (error: any) {
    log.error('get_resource_usage failed', error);
    return null;
  }
}

/**
 * Get workspace directory for sandbox
 */
export async function getWorkspaceDir(sandboxId: string): Promise<string | null> {
  if (!isTauriAvailable()) {
    return null;
  }

  try {
    return await invoke<string>('get_workspace_dir', { sandboxId });
  } catch (error: any) {
    log.error('get_workspace_dir failed', error);
    return null;
  }
}

/**
 * Open a URL in the default browser
 */
export async function openUrl(url: string): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }

  try {
    await invoke('open_url', { url });
    return true;
  } catch (error: any) {
    log.error('open_url failed', error);
    return false;
  }
}

/**
 * Show a notification
 */
export async function showNotification(
  title: string,
  body: string
): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }

  try {
    await invoke('show_notification', { title, body });
    return true;
  } catch (error: any) {
    log.error('show_notification failed', error);
    return false;
  }
}

// Export all functions as a unified API object
export const tauriInvoke = {
  isAvailable: isTauriAvailable,
  executeCommand,
  readFile,
  writeFile,
  listDirectory,
  getSystemInfo,
  createCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  getResourceUsage,
  getWorkspaceDir,
  openUrl,
  showNotification,
  openDirectoryDialog,
  saveSettings,
  saveSecret: async (key: string, value: string) => {
    if (!isTauriAvailable()) {
      throw new Error('Tauri runtime not available');
    }
    try {
      return await invoke<{ success: boolean; error?: string }>('save_secret', { key, value });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export default tauriInvoke;