/**
 * Tests for Nullclaw MCP Bridge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../../packages/shared/agent/nullclaw-integration', () => ({
  nullclawIntegration: {
    startContainer: vi.fn(),
    stopContainer: vi.fn(),
    executeTask: vi.fn(),
    getStatus: vi.fn(),
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
      // Mock nullclawIntegration to return no container
      const nullclaw = await import('../../packages/shared/agent/nullclaw-integration');
      vi.mocked(nullclaw.nullclawIntegration.startContainer).mockRejectedValue(
        new Error('Container not available')
      );

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
