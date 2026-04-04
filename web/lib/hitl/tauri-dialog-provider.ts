/**
 * Tauri Dialog Provider
 *
 * Uses Tauri's native dialog plugin for file/folder selection
 * instead of browser file inputs. Provides better UX on desktop.
 */

import { open, save, message, confirm } from '@tauri-apps/plugin-dialog';
import { isDesktopMode, isTauriRuntime } from '@/lib/utils/desktop-env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('TauriDialog');

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

export interface DialogResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Check if Tauri dialogs are available
 */
export function isDialogAvailable(): boolean {
  return isDesktopMode() || isTauriRuntime();
}

/**
 * Open a file dialog (single or multiple files)
 */
export async function openFileDialog(
  options: OpenDialogOptions = {}
): Promise<DialogResult<string[] | string>> {
  if (!isDialogAvailable()) {
    return {
      success: false,
      error: 'Tauri dialogs not available',
    };
  }

  try {
    const result = await open({
      title: options.title || 'Select File',
      defaultPath: options.defaultPath,
      multiple: options.multiple ?? false,
      directory: false,
      filters: options.filters,
    });

    if (result === null) {
      return {
        success: false,
        error: 'Dialog cancelled',
      };
    }

    // Filter out falsy values (empty strings, undefined)
    const paths = Array.isArray(result) 
      ? result.filter(Boolean) 
      : [result].filter(Boolean);
    
    if (paths.length === 0) {
      return {
        success: false,
        error: 'No valid path selected',
      };
    }

    return {
      success: true,
      data: paths,
    };
  } catch (error: any) {
    log.error('Failed to open file dialog', error);
    return {
      success: false,
      error: error.message || 'Failed to open dialog',
    };
  }
}

/**
 * Open a folder dialog (single or multiple directories)
 */
export async function openFolderDialog(
  options: OpenDialogOptions = {}
): Promise<DialogResult<string[] | string>> {
  if (!isDialogAvailable()) {
    return {
      success: false,
      error: 'Tauri dialogs not available',
    };
  }

  try {
    const result = await open({
      title: options.title || 'Select Folder',
      defaultPath: options.defaultPath,
      multiple: options.multiple ?? false,
      directory: true,
    });

    if (result === null) {
      return {
        success: false,
        error: 'Dialog cancelled',
      };
    }

    // Filter out falsy values (empty strings, undefined)
    const paths = Array.isArray(result) 
      ? result.filter(Boolean) 
      : [result].filter(Boolean);
    
    if (paths.length === 0) {
      return {
        success: false,
        error: 'No valid path selected',
      };
    }

    return {
      success: true,
      data: paths,
    };
  } catch (error: any) {
    log.error('Failed to open folder dialog', error);
    return {
      success: false,
      error: error.message || 'Failed to open dialog',
    };
  }
}

/**
 * Open a save file dialog
 */
export async function saveFileDialog(
  options: SaveDialogOptions = {}
): Promise<DialogResult<string>> {
  if (!isDialogAvailable()) {
    return {
      success: false,
      error: 'Tauri dialogs not available',
    };
  }

  try {
    const result = await save({
      title: options.title || 'Save File',
      defaultPath: options.defaultPath,
      filters: options.filters,
    });

    if (result === null) {
      return {
        success: false,
        error: 'Dialog cancelled',
      };
    }

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    log.error('Failed to open save dialog', error);
    return {
      success: false,
      error: error.message || 'Failed to open dialog',
    };
  }
}

/**
 * Show a message dialog (info, warning, error)
 */
export async function showMessage(
  title: string,
  messageText: string,
  type: 'info' | 'warning' | 'error' = 'info'
): Promise<DialogResult<void>> {
  if (!isDialogAvailable()) {
    log.warn('Tauri dialogs not available, using console', { title, message: messageText });
    console.log(`[${type.toUpperCase()}] ${title}: ${messageText}`);
    return { success: true };
  }

  try {
    await message(messageText, { title, kind: type });
    return { success: true };
  } catch (error: any) {
    log.error('Failed to show message dialog', error);
    return {
      success: false,
      error: error.message || 'Failed to show dialog',
    };
  }
}

/**
 * Show a confirmation dialog (yes/no)
 */
export async function showConfirm(
  title: string,
  message: string
): Promise<DialogResult<boolean>> {
  if (!isDialogAvailable()) {
    // Fallback to browser confirm
    const result = window.confirm(`${title}\n\n${message}`);
    return {
      success: true,
      data: result,
    };
  }

  try {
    const result = await confirm(message, { title, kind: 'info' });
    return {
      success: true,
      data: result ?? false,
    };
  } catch (error: any) {
    log.error('Failed to show confirm dialog', error);
    return {
      success: false,
      error: error.message || 'Failed to show dialog',
    };
  }
}

/**
 * Unified dialog provider for common operations
 */
export const tauriDialogProvider = {
  isAvailable: isDialogAvailable,

  openFile: openFileDialog,
  openFolder: openFolderDialog,
  saveFile: saveFileDialog,

  showMessage,
  showConfirm,

  /**
   * Select workspace directory (convenience method)
   */
  async selectWorkspace(
    defaultPath?: string
): Promise<DialogResult<string>> {
    const result = await openFolderDialog({
      title: 'Select Workspace Directory',
      defaultPath: defaultPath || process.env.HOME || process.env.USERPROFILE,
    });

    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const path = Array.isArray(result.data) ? result.data[0] : result.data;
    return { success: true, data: path };
  },

  /**
   * Select file to import (convenience method)
   */
  async selectImportFile(): Promise<DialogResult<string>> {
    const result = await openFileDialog({
      title: 'Select File to Import',
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Text', extensions: ['txt', 'md'] },
      ],
    });

    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const path = Array.isArray(result.data) ? result.data[0] : result.data;
    return { success: true, data: path };
  },

  /**
   * Select export destination (convenience method)
   */
  async selectExportDestination(
    defaultName: string,
    filters?: Array<{ name: string; extensions: string[] }>
  ): Promise<DialogResult<string>> {
    const result = await saveFileDialog({
      title: 'Save As',
      defaultPath: defaultName,
      filters: filters || [
        { name: 'All Files', extensions: ['*'] },
        { name: 'JSON', extensions: ['json'] },
      ],
    });

    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    return { success: true, data: result.data };
  },
};

export default tauriDialogProvider;
