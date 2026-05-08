/**
 * Register Desktop Automation Tools
 *
 * Registers native desktop automation capabilities when running in Tauri desktop mode.
 * Provides accessibility tree access, UI interaction, screenshots, and app management
 * via the agent-desktop integration in the Tauri Rust backend.
 *
 * @see desktop/src-tauri/src/desktop_automation.rs - Rust implementation
 */

import type { ToolRegistry } from '../registry';
import { isDesktopMode } from '@bing/platform/env';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:DesktopAutomation');

/**
 * Register desktop automation tools (only in desktop mode)
 *
 * @param registry - Tool registry instance
 * @returns Number of tools registered
 */
export async function registerDesktopAutomationTools(registry: ToolRegistry): Promise<number> {
  if (!isDesktopMode()) {
    return 0;
  }

  let count = 0;
  logger.info('Registering desktop automation tools');

  // Import invoke-bridge dynamically to avoid bundling Tauri APIs in web build
  const { tauriInvoke } = await import('../../tauri/invoke-bridge');

  if (!tauriInvoke.isAvailable()) {
    logger.warn('Tauri invoke not available, skipping desktop automation tool registration');
    return 0;
  }

  // Helper to call desktop automation commands
  const callDesktop = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    return tauriInvoke.invoke(command, args);
  };

  // ============================================================================
  // Desktop Status & Permissions
  // ============================================================================

  await registry.registerTool({
    name: 'tauri:desktop.status',
    capability: 'desktop.snapshot',
    provider: 'tauri-desktop',
    handler: async () => {
      const result = await callDesktop<{
        version: string;
        ok: boolean;
        data?: { platform: string; permission_granted: boolean; version: string };
        error?: { code: string; message: string };
      }>('desktop_automation_status');
      return {
        ok: result.ok,
        platform: result.data?.platform,
        permissionGranted: result.data?.permission_granted,
        version: result.data?.version,
        error: result.error?.message,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['desktop', 'status', 'permissions'],
    },
    permissions: ['desktop:accessibility'],
  });
  count++;

  // ============================================================================
  // Snapshot & Observation
  // ============================================================================

  await registry.registerTool({
    name: 'tauri:desktop.snapshot',
    capability: 'desktop.snapshot',
    provider: 'tauri-desktop',
    handler: async (args: {
      app?: string;
      windowId?: string;
      interactiveOnly?: boolean;
      compact?: boolean;
      includeBounds?: boolean;
      maxDepth?: number;
      skeleton?: boolean;
      root?: string;
    }) => {
      return callDesktop('desktop_automation_snapshot', {
        app: args.app,
        window_id: args.windowId,
        interactive_only: args.interactiveOnly ?? false,
        compact: args.compact ?? false,
        include_bounds: args.includeBounds ?? false,
        max_depth: args.maxDepth ?? 10,
        skeleton: args.skeleton ?? false,
        root: args.root,
        surface: 'window',
      });
    },
    metadata: {
      latency: 'medium',
      cost: 'low',
      reliability: 0.95,
      tags: ['desktop', 'snapshot', 'accessibility'],
    },
    permissions: ['desktop:accessibility'],
  });
  count++;

  await registry.registerTool({
    name: 'tauri:desktop.screenshot',
    capability: 'desktop.screenshot',
    provider: 'tauri-desktop',
    handler: async (args: { windowId?: string; quality?: number }) => {
      return callDesktop('desktop_automation_screenshot', {
        window_id: args.windowId,
        quality: args.quality ?? 80,
      });
    },
    metadata: {
      latency: 'medium',
      cost: 'low',
      reliability: 0.98,
      tags: ['desktop', 'screenshot', 'capture'],
    },
    permissions: ['desktop:screen-capture'],
  });
  count++;

  await registry.registerTool({
    name: 'tauri:desktop.list_windows',
    capability: 'desktop.list_windows',
    provider: 'tauri-desktop',
    handler: async () => {
      return callDesktop('desktop_automation_list_windows');
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['desktop', 'windows', 'list'],
    },
    permissions: ['desktop:accessibility'],
  });
  count++;

  await registry.registerTool({
    name: 'tauri:desktop.list_apps',
    capability: 'desktop.list_apps',
    provider: 'tauri-desktop',
    handler: async () => {
      return callDesktop('desktop_automation_list_apps');
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['desktop', 'apps', 'list'],
    },
    permissions: ['desktop:accessibility'],
  });
  count++;

  // ============================================================================
  // UI Interaction
  // ============================================================================

  await registry.registerTool({
    name: 'tauri:desktop.click',
    capability: 'desktop.click',
    provider: 'tauri-desktop',
    handler: async (args: { refId: string; clicks?: number }) => {
      return callDesktop('desktop_automation_click', {
        ref_id: args.refId,
        clicks: args.clicks ?? 1,
      });
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.95,
      tags: ['desktop', 'click', 'interaction'],
    },
    permissions: ['desktop:accessibility'],
  });
  count++;

  await registry.registerTool({
    name: 'tauri:desktop.type',
    capability: 'desktop.type',
    provider: 'tauri-desktop',
    handler: async (args: { refId: string; text: string }) => {
      return callDesktop('desktop_automation_type', {
        ref_id: args.refId,
        text: args.text,
      });
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.95,
      tags: ['desktop', 'type', 'keyboard'],
    },
    permissions: ['desktop:accessibility'],
  });
  count++;

  await registry.registerTool({
    name: 'tauri:desktop.key_press',
    capability: 'desktop.key_press',
    provider: 'tauri-desktop',
    handler: async (args: { combo: string }) => {
      return callDesktop('desktop_automation_press_key', { combo: args.combo });
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.98,
      tags: ['desktop', 'keyboard', 'shortcut'],
    },
    permissions: ['desktop:accessibility'],
  });
  count++;

  // ============================================================================
  // Application Management
  // ============================================================================

  await registry.registerTool({
    name: 'tauri:desktop.launch_app',
    capability: 'desktop.launch_app',
    provider: 'tauri-desktop',
    handler: async (args: { appId: string; wait?: boolean }) => {
      return callDesktop('desktop_automation_launch_app', {
        app_id: args.appId,
        wait: args.wait ?? true,
      });
    },
    metadata: {
      latency: 'medium',
      cost: 'low',
      reliability: 0.95,
      tags: ['desktop', 'launch', 'app'],
    },
    permissions: ['desktop:app-management'],
  });
  count++;

  await registry.registerTool({
    name: 'tauri:desktop.close_app',
    capability: 'desktop.close_app',
    provider: 'tauri-desktop',
    handler: async (args: { appName: string; force?: boolean }) => {
      return callDesktop('desktop_automation_close_app', {
        app_name: args.appName,
        force: args.force ?? false,
      });
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.95,
      tags: ['desktop', 'close', 'quit', 'app'],
    },
    permissions: ['desktop:app-management'],
  });
  count++;

  // ============================================================================
  // Clipboard
  // ============================================================================

  await registry.registerTool({
    name: 'tauri:desktop.clipboard_get',
    capability: 'desktop.clipboard_get',
    provider: 'tauri-desktop',
    handler: async () => {
      return callDesktop('desktop_automation_get_clipboard');
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['desktop', 'clipboard', 'get'],
    },
    permissions: ['desktop:clipboard'],
  });
  count++;

  await registry.registerTool({
    name: 'tauri:desktop.clipboard_set',
    capability: 'desktop.clipboard_set',
    provider: 'tauri-desktop',
    handler: async (args: { text: string }) => {
      return callDesktop('desktop_automation_set_clipboard', { text: args.text });
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['desktop', 'clipboard', 'set'],
    },
    permissions: ['desktop:clipboard'],
  });
  count++;

  logger.info(`Registered ${count} desktop automation tools`);
  return count;
}
