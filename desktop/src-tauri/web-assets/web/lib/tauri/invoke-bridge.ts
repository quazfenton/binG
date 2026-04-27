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
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import {
  rewriteCommand,
  filterOutput,
  groupGrepOutput,
  summarizeCode,
  trackSavings,
  estimateTokens,
  canRewrite,
  getCommandCategory,
  type FilterOptions,
} from '@/lib/tools/rtk-integration';

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

// Shell Completion Types
export interface ShellCompletionResult {
  success: boolean;
  completions: string[];
  error?: string;
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
 * RTK Token Reduction Options for LLM Consumption
 */
export interface RTKLLMOptions {
  /** Apply RTK command rewriting (default: true) */
  rewriteCommand?: boolean;
  /** Apply RTK output filtering for LLM consumption (default: true) */
  filterForLLM?: boolean;
  /** Group grep/search output by file (default: true) */
  groupGrepOutput?: boolean;
  /** Maximum lines in filtered output (default: 100) */
  maxLines?: number;
  /** Maximum characters in filtered output (default: 50000) */
  maxChars?: number;
  /** Track token savings for analytics (default: false) */
  trackSavings?: boolean;
}

const DEFAULT_RTK_LLM_OPTIONS: Required<RTKLLMOptions> = {
  rewriteCommand: true,
  filterForLLM: true,
  groupGrepOutput: true,
  maxLines: 100,
  maxChars: 50000,
  trackSavings: false,
};

/**
 * Execute a shell command in the sandbox (desktop mode)
 * 
 * @param _sandboxId - Not used - sandbox not implemented in Rust
 * @param command - The command to execute
 * @param cwd - Working directory
 * @param _timeout - Not used - timeout not implemented in Rust
 * @param rtkOptions - RTK options for LLM consumption (not for terminal display)
 */
export async function executeCommand(
  _sandboxId: string,
  command: string,
  cwd?: string,
  _timeout?: number,
  rtkOptions?: RTKLLMOptions
): Promise<ExecuteCommandResult & {
  rtkRewritten?: string;
  rtkCategory?: string;
  rtkStats?: { originalTokens: number; filteredTokens: number; savedTokens: number; savingsPercent: number };
}> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri runtime not available');
  }

  const opts = { ...DEFAULT_RTK_LLM_OPTIONS, ...rtkOptions };
  
  // RTK: Rewrite command for token optimization (only for LLM consumption)
  let rewrittenCommand = command;
  let rtkCategory: string | undefined;
  let wasRewritten = false;
  
  if (opts.rewriteCommand && canRewrite(command)) {
    rewrittenCommand = rewriteCommand(command, { enableRewrite: true });
    wasRewritten = rewrittenCommand !== command;
    rtkCategory = getCommandCategory(command) || undefined;
    
    if (wasRewritten) {
      log.debug('RTK: Command rewritten', {
        original: command.substring(0, 80),
        rewritten: rewrittenCommand.substring(0, 80),
        category: rtkCategory,
      });
    }
  }

  try {
    const result = await invoke<ExecuteCommandResult>('execute_command', {
      command: rewrittenCommand,
      cwd,
    });

    // RTK: Filter output for LLM consumption (NOT for terminal display)
    // Terminal display should get raw output, LLM consumption gets filtered
    let output = result.output || '';
    let rtkStats: { originalTokens: number; filteredTokens: number; savedTokens: number; savingsPercent: number } | undefined;
    
    if (opts.filterForLLM && result.success && output) {
      const filterOptions: FilterOptions = {
        maxLines: opts.maxLines,
        maxChars: opts.maxChars,
        groupByFile: opts.groupGrepOutput,
        enableDedupe: true,
        enableAnsiFilter: true,
      };
      
      const filtered = filterOutput(output, rewrittenCommand, filterOptions);
      
      if (filtered !== output) {
        output = filtered;
        
        // Track token savings if enabled
        if (opts.trackSavings) {
          const origTokens = estimateTokens(result.output || '');
          const filteredTokens = estimateTokens(filtered);
          const savedTokens = origTokens - filteredTokens;
          
          rtkStats = {
            originalTokens: origTokens,
            filteredTokens,
            savedTokens,
            savingsPercent: Math.round((savedTokens / origTokens) * 100),
          };
          
          log.debug('RTK: Token savings', {
            command: rewrittenCommand,
            category: rtkCategory,
            originalTokens: origTokens,
            filteredTokens,
            savedTokens,
            savingsPercent: rtkStats.savingsPercent + '%',
          });
        }
      }
    }

    return {
      success: result.success,
      output,
      exit_code: result.exit_code,
      error: result.error,
      // RTK metadata for LLM context
      rtkRewritten: wasRewritten ? rewrittenCommand : undefined,
      rtkCategory,
      rtkStats,
    };
  } catch (error: any) {
    log.error('execute_command failed', error);
    return {
      success: false,
      output: '',
      exit_code: 1,
      error: error.message || String(error),
      rtkRewritten: wasRewritten ? rewrittenCommand : undefined,
      rtkCategory,
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
    
    // Emit filesystem event for consistency with VFS flow
    emitFilesystemUpdated({
      path: filePath,
      type: 'update',
      source: 'tauri:write_file',
      sessionId: sandboxId,
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

/**
 * Get shell completions for a given input
 * Uses the shell's native completion mechanism (compgen for bash, etc.)
 */
export async function getShellCompletions(
  input: string,
  cwd?: string,
  shell?: string
): Promise<ShellCompletionResult> {
  if (!isTauriAvailable()) {
    return { success: false, completions: [], error: 'Tauri not available' };
  }

  try {
    return await invoke<ShellCompletionResult>('get_shell_completions', {
      input,
      cwd,
      shell,
    });
  } catch (error: any) {
    return { success: false, completions: [], error: error.message };
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
  getShellCompletions,
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

  /**
   * Set the workspace root directory for the desktop app.
   * Updates DESKTOP_WORKSPACE_ROOT env var and persists to settings.json.
   */
  setWorkspaceRoot: async (workspacePath: string): Promise<{ success: boolean; path?: string; error?: string }> => {
    if (!isTauriAvailable()) {
      return { success: false, error: 'Tauri not available' };
    }
    try {
      return await invoke<{ success: boolean; path?: string; error?: string }>('set_workspace_root', { workspacePath });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export default tauriInvoke;
