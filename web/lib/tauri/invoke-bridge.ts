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

// PTY Session Types
export interface PtyCreateResult {
  session_id: string;
  success: boolean;
  error?: string;
}

export interface PtyInputResult {
  success: boolean;
  error?: string;
}

export interface PtyOutputEvent {
  session_id: string;
  data: string;
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

// Checkpoint functions - now fully implemented in Rust backend

/**
 * Create a checkpoint (shadow commit) of workspace state
 */
export async function createCheckpoint(
  sandboxId: string,
  name?: string
): Promise<CheckpointInfo | null> {
  if (!isTauriAvailable()) {
    return null;
  }

  try {
    const result = await invoke<CheckpointInfo>('create_checkpoint', {
      workspacePath: sandboxId || undefined,
      name,
    });
    return result;
  } catch (error: any) {
    log.error('create_checkpoint failed', error);
    return null;
  }
}

/**
 * Restore a checkpoint by reverting workspace to checkpoint state
 */
export async function restoreCheckpoint(
  sandboxId: string,
  checkpointId: string
): Promise<boolean> {
  if (!isTauriAvailable()) {
    return false;
  }

  try {
    const result = await invoke<{ success: boolean; files_restored: number }>('restore_checkpoint', {
      workspacePath: sandboxId,
      checkpointId,
    });
    return result.success;
  } catch (error: any) {
    log.error('restore_checkpoint failed', error);
    return false;
  }
}

/**
 * List all checkpoints for a workspace
 */
export async function listCheckpoints(
  sandboxId: string
): Promise<{ success: boolean; checkpoints?: CheckpointInfo[]; error?: string }> {
  if (!isTauriAvailable()) {
    return { success: false, error: 'Tauri not available' };
  }

  try {
    const result = await invoke<{ success: boolean; checkpoints: CheckpointInfo[]; error?: string }>('list_checkpoints', {
      workspacePath: sandboxId || undefined,
    });
    return {
      success: result.success,
      checkpoints: result.checkpoints,
      error: result.error,
    };
  } catch (error: any) {
    log.error('list_checkpoints failed', error);
    return { success: false, error: error.message };
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
    const result = await invoke<boolean>('delete_checkpoint', {
      workspacePath: sandboxId,
      checkpointId,
    });
    return result;
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
/**
 * Create a PTY session for real terminal interaction
 */
export async function createPtySession(
  cols?: number,
  rows?: number,
  cwd?: string,
  shell?: string
): Promise<PtyCreateResult> {
  if (!isTauriAvailable()) {
    return { session_id: '', success: false, error: 'Tauri not available' };
  }

  try {
    return await invoke<PtyCreateResult>('create_pty_session', {
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      shell,
    });
  } catch (error: any) {
    return { session_id: '', success: false, error: error.message };
  }
}

/**
 * Write input to PTY session
 */
export async function writePtyInput(
  sessionId: string,
  data: string
): Promise<PtyInputResult> {
  if (!isTauriAvailable()) {
    return { success: false, error: 'Tauri not available' };
  }

  try {
    return await invoke<PtyInputResult>('write_pty_input', {
      sessionId,
      data,
    });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Resize PTY session
 */
export async function resizePty(
  sessionId: string,
  cols: number,
  rows: number
): Promise<PtyInputResult> {
  if (!isTauriAvailable()) {
    return { success: false, error: 'Tauri not available' };
  }

  try {
    return await invoke<PtyInputResult>('resize_pty', {
      sessionId,
      cols,
      rows,
    });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Close PTY session
 */
export async function closePtySession(sessionId: string): Promise<PtyInputResult> {
  if (!isTauriAvailable()) {
    return { success: false, error: 'Tauri not available' };
  }

  try {
    return await invoke<PtyInputResult>('close_pty_session', { sessionId });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

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
  // PTY functions
  createPtySession,
  writePtyInput,
  resizePty,
  closePtySession,
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
