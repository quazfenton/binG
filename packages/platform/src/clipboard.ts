/**
 * Clipboard Abstraction
 *
 * Provides a unified interface for clipboard operations:
 * - Desktop: Tauri clipboard API (more reliable, supports images)
 * - Web: Browser Clipboard API
 *
 * Use cases:
 * - Copy code snippets
 * - Paste file paths
 * - Drag-and-drop file content
 *
 * Usage:
 * ```ts
 * import { clipboard } from '@/lib/platform/clipboard';
 *
 * // Copy text
 * await clipboard.writeText('Hello, world!');
 *
 * // Read text
 * const text = await clipboard.readText();
 *
 * // Copy file paths (drag-and-drop)
 * await clipboard.writeFiles(['/path/to/file.txt']);
 * ```
 */

import { isDesktopMode } from './env';

export interface ClipboardAdapter {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  readFiles(): Promise<string[]>;
  writeFiles(paths: string[]): Promise<void>;
  clear(): Promise<void>;
}

class WebClipboard implements ClipboardAdapter {
  async readText(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error('[Clipboard] Failed to read text:', error);
      return '';
    }
  }

  async writeText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('[Clipboard] Failed to write text:', error);
      throw error;
    }
  }

  async readFiles(): Promise<string[]> {
    // Web clipboard doesn't support file paths directly
    // Can use File System Access API as alternative
    console.warn('[Clipboard] readFiles not supported in web environment');
    return [];
  }

  async writeFiles(paths: string[]): Promise<void> {
    // Web clipboard doesn't support file paths
    console.warn('[Clipboard] writeFiles not supported in web environment');
  }

  async clear(): Promise<void> {
    // Web doesn't have a clear clipboard API
    await this.writeText('');
  }
}

class DesktopClipboard implements ClipboardAdapter {
  async readText(): Promise<string> {
    try {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
      return await readText();
    } catch (error) {
      console.error('[Clipboard] Failed to read text:', error);
      return '';
    }
  }

  async writeText(text: string): Promise<void> {
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeText(text);
    } catch (error) {
      console.error('[Clipboard] Failed to write text:', error);
      throw error;
    }
  }

  async readFiles(): Promise<string[]> {
    try {
      const { readFiles } = await import('@tauri-apps/plugin-clipboard-manager');
      return await readFiles();
    } catch (error) {
      console.error('[Clipboard] Failed to read files:', error);
      return [];
    }
  }

  async writeFiles(paths: string[]): Promise<void> {
    try {
      const { writeFiles } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeFiles(paths);
    } catch (error) {
      console.error('[Clipboard] Failed to write files:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      const { clear } = await import('@tauri-apps/plugin-clipboard-manager');
      await clear();
    } catch (error) {
      console.error('[Clipboard] Failed to clear:', error);
    }
  }
}

// Lazy initialization to avoid bundling Tauri APIs in web build
let clipboardInstance: ClipboardAdapter | null = null;

function getClipboard(): ClipboardAdapter {
  if (!clipboardInstance) {
    clipboardInstance = isDesktopMode()
      ? new DesktopClipboard()
      : new WebClipboard();
  }
  return clipboardInstance;
}

export const clipboard: ClipboardAdapter = {
  readText: async () => getClipboard().readText(),
  writeText: async (text: string) => getClipboard().writeText(text),
  readFiles: async () => getClipboard().readFiles(),
  writeFiles: async (paths: string[]) => getClipboard().writeFiles(paths),
  clear: async () => getClipboard().clear(),
};

export default clipboard;
