/**
 * Register Tauri Invoke Bridge Tools
 *
 * Registers native desktop capabilities when running in Tauri desktop mode.
 * Provides native command execution, file operations, and system info
 * via the Tauri IPC bridge instead of cloud sandboxes.
 *
 * @see lib/tauri/invoke-bridge.ts - Tauri IPC bridge
 */

import type { ToolRegistry } from '../registry';
import { isDesktopMode } from '@bing/platform/env';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:Tauri-Bootstrap');

/**
 * Register Tauri invoke tools (only in desktop mode)
 *
 * @param registry - Tool registry instance
 * @returns Number of tools registered
 */
export async function registerTauriTools(registry: ToolRegistry): Promise<number> {
  if (!isDesktopMode()) {
    return 0;
  }

  let count = 0;
  logger.info('Registering Tauri invoke tools');

  // Import invoke-bridge dynamically to avoid bundling Tauri APIs in web build
  const { tauriInvoke } = await import('../../tauri/invoke-bridge');

  if (!tauriInvoke.isAvailable()) {
    logger.warn('Tauri invoke not available, skipping tool registration');
    return 0;
  }

  // ============================================================================
  // File Capabilities (native FS via Tauri)
  // ============================================================================

  // file.read → tauriInvoke.readFile
  await registry.registerTool({
    name: 'tauri:file.read',
    capability: 'file.read',
    provider: 'tauri-invoke',
    handler: async (args: { path: string }) => {
      const result = await tauriInvoke.readFile('desktop', args.path);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return {
        success: true,
        content: result.content || '',
        encoding: 'utf-8',
        size: (result.content || '').length,
        exists: true,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['tauri', 'native-fs', 'file'],
    },
    permissions: ['file:read'],
  });
  count++;

  // file.write → tauriInvoke.writeFile
  await registry.registerTool({
    name: 'tauri:file.write',
    capability: 'file.write',
    provider: 'tauri-invoke',
    handler: async (args: { path: string; content: string; createDirs?: boolean }) => {
      const result = await tauriInvoke.writeFile('desktop', args.path, args.content);
      return {
        success: result.success,
        path: args.path,
        bytesWritten: (args.content || '').length,
        error: result.error,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['tauri', 'native-fs', 'file'],
    },
    permissions: ['file:write'],
  });
  count++;

  // file.list → tauriInvoke.listDirectory
  await registry.registerTool({
    name: 'tauri:file.list',
    capability: 'file.list',
    provider: 'tauri-invoke',
    handler: async (args: { path: string }) => {
      const result = await tauriInvoke.listDirectory('desktop', args.path);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return (result.entries || []).map(e => ({
        name: e.name,
        path: e.name,
        type: e.isDirectory ? 'directory' as const : 'file' as const,
        size: e.size,
        modified: e.modified,
      }));
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['tauri', 'native-fs', 'directory'],
    },
    permissions: ['file:read'],
  });
  count++;

  // file.delete → uses executeCommand for rm
  await registry.registerTool({
    name: 'tauri:file.delete',
    capability: 'file.delete',
    provider: 'tauri-invoke',
    handler: async (args: { path: string; recursive?: boolean }) => {
      const cmd = args.recursive ? `rm -rf "${args.path}"` : `rm "${args.path}"`;
      const result = await tauriInvoke.executeCommand('desktop', cmd);
      return {
        success: result.success,
        path: args.path,
        error: result.error,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.95,
      tags: ['tauri', 'native-fs', 'delete'],
    },
    permissions: ['file:delete'],
  });
  count++;

  // file.search → uses executeCommand for find
  await registry.registerTool({
    name: 'tauri:file.search',
    capability: 'file.search',
    provider: 'tauri-invoke',
    handler: async (args: { query: string; path?: string; type?: string }) => {
      const searchPath = args.path || '.';
      const cmd = `find "${searchPath}" -name "*${args.query}*"`;
      const result = await tauriInvoke.executeCommand('desktop', cmd);
      if (!result.success) {
        return [];
      }
      return result.output
        .split('\n')
        .filter(Boolean)
        .map(p => ({ path: p, matches: [] }));
    },
    metadata: {
      latency: 'medium',
      cost: 'low',
      reliability: 0.90,
      tags: ['tauri', 'native-fs', 'search'],
    },
    permissions: ['file:read'],
  });
  count++;

  // ============================================================================
  // Sandbox Capabilities (native shell via Tauri)
  // ============================================================================

  // sandbox.shell → tauriInvoke.executeCommand
  await registry.registerTool({
    name: 'tauri:sandbox.shell',
    capability: 'sandbox.shell',
    provider: 'tauri-invoke',
    handler: async (args: { command: string; cwd?: string; env?: Record<string, string>; timeout?: number }) => {
      const result = await tauriInvoke.executeCommand('desktop', args.command, args.cwd, args.timeout);
      return {
        success: result.success,
        stdout: result.output,
        stderr: result.error || '',
        exitCode: result.exit_code,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.98,
      tags: ['tauri', 'native-shell', 'bash'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  // sandbox.execute → tauriInvoke.executeCommand (alias)
  await registry.registerTool({
    name: 'tauri:sandbox.execute',
    capability: 'sandbox.execute',
    provider: 'tauri-invoke',
    handler: async (args: { code: string; language?: string; cwd?: string }) => {
      const { language = 'bash', code, cwd } = args;
      const command = language === 'bash' ? code : `${language} -c '${code.replace(/'/g, "\\'")}'`;
      const result = await tauriInvoke.executeCommand('desktop', command, cwd);
      return {
        success: result.success,
        output: result.output,
        error: result.error,
        exitCode: result.exit_code,
        duration: 0,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.98,
      tags: ['tauri', 'native-exec', 'code'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  // ============================================================================
  // System Monitoring (diagnostic, not routed through capability system)
  // These are registered as standalone tools for desktop diagnostics
  // ============================================================================

  // system.info → tauriInvoke.getSystemInfo
  await registry.registerTool({
    name: 'tauri:system.info',
    capability: 'sandbox.shell',
    provider: 'tauri-invoke',
    handler: async () => {
      const info = await tauriInvoke.getSystemInfo();
      if (!info) {
        return { success: false, error: 'System info unavailable' };
      }
      return {
        success: true,
        platform: info.platform,
        arch: info.arch,
        hostname: info.hostname,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['tauri', 'system', 'info'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  // system.resources → tauriInvoke.getResourceUsage
  await registry.registerTool({
    name: 'tauri:system.resources',
    capability: 'sandbox.shell',
    provider: 'tauri-invoke',
    handler: async () => {
      const usage = await tauriInvoke.getResourceUsage();
      if (!usage) {
        return { success: false, error: 'Resource usage unavailable' };
      }
      return {
        success: true,
        cpuPercent: usage.cpu_percent,
        memoryUsedMb: usage.memory_used_mb,
        memoryTotalMb: usage.memory_total_mb,
        diskUsedGb: usage.disk_used_gb,
        diskTotalGb: usage.disk_total_gb,
      };
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['tauri', 'system', 'resources'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  logger.info(`Registered ${count} Tauri invoke tools`);
  return count;
}
