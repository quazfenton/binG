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
    // Web doesn't have a clear clipboard API. Writing empty string only clears text,
    // not other data types (images, files). This behavior is less comprehensive than
    // the desktop implementation which uses Tauri's dedicated clear method.
    // This limitation should be documented when choosing clipboard clearing behavior.
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const clipboardModule = await import('@tauri-apps/plugin-clipboard-manager') as any;
      if (typeof clipboardModule.readFiles !== 'function') {
        return [];
      }
      return await clipboardModule.readFiles();
    } catch (error) {
      console.error('[Clipboard] Failed to read files:', error);
      return [];
    }
  }

  async writeFiles(paths: string[]): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const clipboardModule = await import('@tauri-apps/plugin-clipboard-manager') as any;
      if (typeof clipboardModule.writeFiles !== 'function') {
        console.warn('[Clipboard] writeFiles is not supported by this Tauri clipboard plugin version');
        return;
      }
      await clipboardModule.writeFiles(paths);
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
    // Note: This lazy initialization is not thread-safe. In a multi-threaded or
    // async environment with rapid concurrent calls before first initialization,
    // multiple instances could be created. For most web use cases this is acceptable,
    // but consider using a lock mechanism or initializing at module load time if needed.
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
