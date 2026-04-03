/**
 * Window Control Abstraction
 *
 * Provides desktop-specific window management:
 * - Desktop: Tauri window API (title, size, position, minimize, etc.)
 * - Web: No-op (browser windows are managed by the browser)
 *
 * Usage:
 * ```ts
 * import { windowControl } from '@/lib/platform/window';
 *
 * // Set window title
 * await windowControl.setTitle('My App');
 *
 * // Minimize window
 * await windowControl.minimize();
 *
 * // Toggle fullscreen
 * await windowControl.toggleFullscreen();
 * ```
 */

import { isDesktopMode } from './env';

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

class WindowControl {
  /**
   * Set the window title
   */
  async setTitle(title: string): Promise<void> {
    if (!isDesktopMode()) {
      document.title = title;
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.setTitle(title);
    } catch (error) {
      console.error('[WindowControl] Failed to set title:', error);
    }
  }

  /**
   * Set window size
   */
  async setSize(size: WindowSize): Promise<void> {
    if (!isDesktopMode()) return;

    try {
      const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.setSize(new LogicalSize(size.width, size.height));
    } catch (error) {
      console.error('[WindowControl] Failed to set size:', error);
    }
  }

  /**
   * Set window position
   */
  async setPosition(pos: WindowPosition): Promise<void> {
    if (!isDesktopMode()) return;

    try {
      const { getCurrentWindow, LogicalPosition } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.setPosition(new LogicalPosition(pos.x, pos.y));
    } catch (error) {
      console.error('[WindowControl] Failed to set position:', error);
    }
  }

  /**
   * Minimize the window
   */
  async minimize(): Promise<void> {
    if (!isDesktopMode()) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (error) {
      console.error('[WindowControl] Failed to minimize:', error);
    }
  }

  /**
   * Maximize the window
   */
  async maximize(): Promise<void> {
    if (!isDesktopMode()) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.maximize();
    } catch (error) {
      console.error('[WindowControl] Failed to maximize:', error);
    }
  }

  /**
   * Toggle fullscreen mode
   */
  async toggleFullscreen(): Promise<void> {
    if (!isDesktopMode()) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      const isFullscreen = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!isFullscreen);
    } catch (error) {
      console.error('[WindowControl] Failed to toggle fullscreen:', error);
    }
  }

  /**
   * Close the window (and app)
   */
  async close(): Promise<void> {
    if (!isDesktopMode()) {
      window.close();
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch (error) {
      console.error('[WindowControl] Failed to close:', error);
    }
  }

  /**
   * Check if window is focused
   */
  async isFocused(): Promise<boolean> {
    if (!isDesktopMode()) {
      return document.hasFocus();
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      return await appWindow.isFocused();
    } catch {
      return false;
    }
  }

  /**
   * Focus the window
   */
  async focus(): Promise<void> {
    if (!isDesktopMode()) {
      window.focus();
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.setFocus();
    } catch (error) {
      console.error('[WindowControl] Failed to focus:', error);
    }
  }
}

export const windowControl = new WindowControl();
export default windowControl;
