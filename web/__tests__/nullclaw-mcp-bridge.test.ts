/**
 * Tests for Nullclaw MCP Bridge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
// NOTE: Keep this mock in sync with the real NullclawIntegration surface used
// by lib/mcp/nullclaw-mcp-bridge.ts — missing methods cause TypeErrors at
// runtime since the bridge calls them directly on the mocked instance.
vi.mock('@bing/shared/agent/nullclaw-integration', () => ({
  nullclawIntegration: {
    isAvailable: vi.fn(() => true),
    initialize: vi.fn(() => Promise.resolve()),
    initializeForSession: vi.fn(() => Promise.resolve('container-mock')),
    getContainerForSession: vi.fn(() => ({ id: 'container-mock', endpoint: 'http://localhost:0', status: 'ready' })),
    stopContainer: vi.fn(() => Promise.resolve()),
    executeTask: vi.fn(() => Promise.resolve({ status: 'completed', result: { success: true } })),
    sendDiscordMessage: vi.fn(() => Promise.resolve({ id: 'task-1', status: 'completed', result: {} })),
    sendTelegramMessage: vi.fn(() => Promise.resolve({ id: 'task-2', status: 'completed', result: {} })),
    browseUrl: vi.fn(() => Promise.resolve({ id: 'task-3', status: 'completed', result: {} })),
    automateTask: vi.fn(() => Promise.resolve({ id: 'task-4', status: 'completed', result: {} })),
    searchWeb: vi.fn(() => Promise.resolve({ id: 'task-5', status: 'completed', result: {} })),
    getStatus: vi.fn(() => Promise.resolve({
      available: true,
      health: 'healthy',
      tasks: { pending: 0, running: 0, completed: 0, failed: 0 },
    })),
  }
}))

vi.mock('../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}))

describe('NullclawMCPBridge', () => {
  let bridge: any;

  beforeEach(async () => {
    vi.resetModules();
    const { nullclawMCPBridge } = await import('../lib/mcp/nullclaw-mcp-bridge');
    bridge = nullclawMCPBridge;
  });

  describe('getToolDefinitions', () => {
    it('should return tool definitions', () => {
      const tools = bridge.getToolDefinitions();

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      // Check tool names
      const toolNames = tools.map((t: any) => t.function.name);
      expect(toolNames).toContain('nullclaw_sendDiscord');
      expect(toolNames).toContain('nullclaw_sendTelegram');
      expect(toolNames).toContain('nullclaw_browse');
      expect(toolNames).toContain('nullclaw_automate');
      expect(toolNames).toContain('nullclaw_status');
    });

    it('should have correct parameter schemas', () => {
      const discordTool = bridge.getToolDefinitions()
        .find((t: any) => t.function.name === 'nullclaw_sendDiscord');

      expect(discordTool).toBeDefined();
      expect(discordTool.function.parameters.required).toContain('channelId');
      expect(discordTool.function.parameters.required).toContain('message');
    });
  });

  describe('executeTool', () => {
    it('should return error when container not available', async () => {
      // Mock nullclawIntegration to return no container and not be available
      const nullclaw = await import('@bing/shared/agent/nullclaw-integration');
      vi.mocked(nullclaw.nullclawIntegration.initializeForSession).mockResolvedValue(undefined);
      vi.mocked(nullclaw.nullclawIntegration.getContainerForSession).mockReturnValue(undefined);
      // Also mark as unavailable so URL-mode fallback is skipped
      vi.mocked(nullclaw.nullclawIntegration.isAvailable).mockReturnValue(false);

      const result = await bridge.executeTool(
        'nullclaw_sendDiscord',
        { channelId: '123', message: 'test' },
        'session-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('getStats', () => {
    it('should return pool statistics', () => {
      const stats = bridge.getStats();

      expect(stats).toBeDefined();
      expect(stats.containerPoolSize).toBeDefined();
      expect(stats.activeContainers).toBeDefined();
      expect(stats.sessionsMapped).toBeDefined();
      expect(stats.queuedTasks).toBeDefined();
    });
  });
});
