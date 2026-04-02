/**
 * Tauri IPC Bridge
 *
 * TypeScript wrapper around @tauri-apps/api/core invoke() for calling
 * Rust commands from the frontend. Provides typed interfaces for
 * native dialogs, file pickers, notifications, and custom commands.
 */

import { invoke } from '@tauri-apps/api/core';
import { isDesktopMode, isTauriRuntime } from '@/lib/utils/desktop-env';
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
  platform: string;
  arch: string;
  version: string;
  hostname: string;
  cpuCount: number;
  totalMemory: number;
  homeDir: string;
  tempDir: string;
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
 * Get resource usage (CPU, memory, disk)
 */
export async function getResourceUsage(): Promise<ResourceUsage> {
  if (!isTauriAvailable()) {
    return {
      cpu_percent: 0,
      memory_used_mb: 0,
      memory_total_mb: 0,
      disk_used_gb: 0,
      disk_total_gb: 0,
      active_processes: 0,
    };
  }

  try {
    return await invoke<ResourceUsage>('get_resource_usage');
  } catch (error) {
    // Return mock data if not available
    return {
      cpu_percent: 0,
      memory_used_mb: 0,
      memory_total_mb: 0,
      disk_used_gb: 0,
      disk_total_gb: 0,
      active_processes: 0,
    };
  }
}

/**
 * Execute a shell command in the sandbox
 */
export async function executeCommand(
  sandboxId: string,
  command: string,
  cwd?: string,
  timeout?: number
): Promise<ExecuteCommandResult> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri runtime not available');
  }

  try {
    return await invoke<ExecuteCommandResult>('execute_command', {
      sandboxId,
      command,
      cwd,
      timeout,
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
    return await invoke<SystemInfo>('get_system_info');
  } catch (error: any) {
    log.error('get_system_info failed', error);
    return null;
  }
}

/**
 * Create a checkpoint
 */
export async function createCheckpoint(
  sandboxId: string,
  name?: string
): Promise<CheckpointInfo | null> {
  if (!isTauriAvailable()) {
    return null;
  }

  try {
    return await invoke<CheckpointInfo>('create_checkpoint', {
      sandboxId,
      name,
    });
  } catch (error: any) {
    log.error('create_checkpoint failed', error);
    return null;
  }
}

/**
 * Restore a checkpoint
 */
export async function restoreCheckpoint(
  sandboxId: string,
  checkpointId: string
): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }

  try {
    await invoke('restore_checkpoint', {
      sandboxId,
      checkpointId,
    });
    return true;
  } catch (error: any) {
    log.error('restore_checkpoint failed', error);
    return false;
  }
}

/**
 * List checkpoints - returns error result instead of empty array on failure
 */
export async function listCheckpoints(
  sandboxId: string
): Promise<{ success: boolean; checkpoints?: CheckpointInfo[]; error?: string }> {
  if (!isTauriAvailable()) {
    return { success: false, error: 'Tauri not available' };
  }

  try {
    const checkpoints = await invoke<CheckpointInfo[]>('list_checkpoints', {
      sandboxId,
    });
    return { success: true, checkpoints };
  } catch (error: any) {
    log.error('list_checkpoints failed', error);
    return { success: false, error: error.message || 'Failed to list checkpoints' };
  }
}

/**
 * Delete a checkpoint
 */
export async function deleteCheckpoint(
  sandboxId: string,
  checkpointId: string
): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }

  try {
    await invoke('delete_checkpoint', {
      sandboxId,
      checkpointId,
    });
    return true;
  } catch (error: any) {
    log.error('delete_checkpoint failed', error);
    return false;
  }
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
};

export default tauriInvoke;