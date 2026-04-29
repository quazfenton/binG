/**
 * Notifications Abstraction
 *
 * Provides a unified interface for system notifications:
 * - Desktop: Tauri native notifications (OS-level)
 * - Web: Browser Notification API
 *
 * Usage:
 * ```ts
 * import { notify } from '@/lib/platform/notifications';
 *
 * // Simple notification
 * await notify('Task Complete', 'Your files have been indexed.');
 *
 * // With options
 * await notify('Error', 'Failed to connect to server', {
 *   icon: 'error',
 *   actions: ['Retry', 'Dismiss'],
 * });
 * ```
 */

import { isDesktopMode } from './env';

export interface NotifyOptions {
  /** Notification body text */
  body?: string;
  /** Icon URL or name */
  icon?: string;
  /** Notification badge number (for app icon) */
  badge?: number;
  /** Action buttons */
  actions?: string[];
  /** Whether to play a sound */
  sound?: boolean;
  /** Click handler */
  onClick?: () => void;
}

/**
 * Show a system notification
 */
export async function notify(title: string, options?: string | NotifyOptions): Promise<void> {
  const opts: NotifyOptions = typeof options === 'string' ? { body: options } : options || {};

  if (isDesktopMode()) {
    // Desktop: Tauri native notifications
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('show_notification', {
        title,
        body: opts.body || '',
        icon: opts.icon,
      });

      if (opts.onClick) {
        // Tauri notifications don't support click handlers directly
        // You'd need to set up a Tauri event listener
      }
    } catch (error) {
      console.error('[Notifications] Failed to show desktop notification:', error);
      // Fallback to web notification
      showWebNotification(title, opts);
    }
  } else {
    // Web: Browser Notification API
    showWebNotification(title, opts);
  }
}

/**
 * Show a browser notification (web fallback)
 */
async function showWebNotification(title: string, opts: NotifyOptions): Promise<void> {
  if (!('Notification' in window)) {
    console.warn('[Notifications] Browser does not support notifications');
    return;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission === 'granted') {
    const notification = new Notification(title, {
      body: opts.body,
      icon: opts.icon,
      badge: opts.badge?.toString(),
    });

    if (opts.onClick) {
      notification.onclick = () => {
        opts.onClick?.();
        notification.close();
      };
    }
  }
}

/**
 * Request notification permission (web only)
 */
export async function requestPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (isDesktopMode()) {
    return 'granted'; // Desktop always has permission
  }

  if (!('Notification' in window)) {
    return 'denied';
  }

  return await Notification.requestPermission();
}

/**
 * Check if notifications are supported
 */
export function isSupported(): boolean {
  if (isDesktopMode()) {
    return true; // Desktop always supports notifications
  }
  return 'Notification' in window;
}

/**
 * LOW-11 fix: Get the current notification backend type.
 * Useful for UI indicators showing which notification system is active.
 */
export function getNotificationBackend(): 'desktop-tauri' | 'browser-api' | 'unavailable' {
  if (isDesktopMode()) {
    return 'desktop-tauri';
  }
  if (typeof window !== 'undefined' && 'Notification' in window) {
    return 'browser-api';
  }
  return 'unavailable';
}

/**
 * LOW-11 fix: Check if a real push notification backend is configured (not just browser API).
 * Returns true only if there's a server-side push notification service
 * (e.g. web push with VAPID keys) — not just the browser Notification API.
 */
export function hasPushNotificationBackend(): boolean {
  // Check for VAPID public key — indicates a real push service is configured
  return !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}
