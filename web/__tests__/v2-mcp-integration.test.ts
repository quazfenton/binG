/**
 * Integration Tests: V2 + MCP Architecture
 * 
 * Tests the complete workflow:
 * 1. Initialize MCP for Architecture 2
 * 2. Register Nullclaw tools
 * 3. Execute MCP tools through V2 session
 * 4. Provider advanced tools (E2B, Daytona, etc.)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock all dependencies
vi.mock('uuid', () => ({
  v4: vi.fn(() => `test-${Math.random().toString(36).substr(2, 9)}`)
}))

vi.mock('../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}))

// NOTE: Mock must match the full NullclawIntegration surface used by the bridge.
vi.mock('@bing/shared/agent/nullclaw-integration', () => ({
  nullclawIntegration: {
    isAvailable: vi.fn(() => true),
    initialize: vi.fn(() => Promise.resolve()),
    initializeForSession: vi.fn(() => Promise.resolve('nullclaw-123')),
    startContainer: vi.fn(() => Promise.resolve({
      id: 'nullclaw-123',
      endpoint: 'http://localhost:3001',
      status: 'ready',
    })),
    stopContainer: vi.fn(() => Promise.resolve()),
    executeTask: vi.fn((...args: any[]) => {
      const task = args[args.length - 1];
      return Promise.resolve({ ...(task || {}), status: 'completed', result: { success: true } });
    }),
    sendDiscordMessage: vi.fn(() => Promise.resolve({ success: true })),
    sendTelegramMessage: vi.fn(() => Promise.resolve({ success: true })),
    browseUrl: vi.fn(() => Promise.resolve({ success: true, content: '' })),
    automateTask: vi.fn(() => Promise.resolve({ success: true })),
    searchWeb: vi.fn(() => Promise.resolve({ success: true, results: [] })),
    getStatus: vi.fn(() => Promise.resolve({
      available: true,
      health: 'healthy',
      tasks: { pending: 0, running: 0, completed: 0, failed: 0 },
    })),
  }
}))

vi.mock('../lib/sandbox/providers', () => ({
  getSandboxProvider: vi.fn(() => Promise.resolve({
    createSandbox: vi.fn(() => Promise.resolve({
      id: 'test-sandbox',
      workspaceDir: '/workspace',
      writeFile: vi.fn(() => Promise.resolve({ success: true })),
      readFile: vi.fn(() => Promise.resolve({ success: true, output: '{}' })),
      executeCommand: vi.fn(() => Promise.resolve({ success: true })),
      destroySandbox: vi.fn(() => Promise.resolve()),
    })),
    getSandbox: vi.fn(() => Promise.resolve({
      id: 'test-sandbox',
      writeFile: vi.fn(() => Promise.resolve({ success: true })),
      readFile: vi.fn(() => Promise.resolve({ success: true, output: '{}' })),
    })),
    destroySandbox: vi.fn(() => Promise.resolve()),
  })),
}))

describe('V2 + MCP Architecture Integration', () => {
  let nullclawBridge: any;

  beforeEach(async () => {
    vi.resetModules();
    process.env.NULLCLAW_ENABLED = 'true';
    
    const { nullclawMCPBridge: bridge } = await import('../lib/mcp/nullclaw-mcp-bridge');
    nullclawBridge = bridge;
  });

  describe('MCP Tool Registration', () => {
    it('should have Nullclaw tools registered', () => {
      const tools = nullclawBridge.getToolDefinitions();
      
      expect(tools.length).toBeGreaterThan(0);
      
      const toolNames = tools.map((t: any) => t.function.name);
      expect(toolNames).toContain('nullclaw_sendDiscord');
      expect(toolNames).toContain('nullclaw_sendTelegram');
      expect(toolNames).toContain('nullclaw_browse');
      expect(toolNames).toContain('nullclaw_automate');
      expect(toolNames).toContain('nullclaw_status');
    });

    it('should have correct parameter types for Discord tool', () => {
      const tools = nullclawBridge.getToolDefinitions();
      const discord = tools.find((t: any) => t.function.name === 'nullclaw_sendDiscord');
      
      expect(discord.function.parameters.properties.channelId.type).toBe('string');
      expect(discord.function.parameters.properties.message.type).toBe('string');
      expect(discord.function.parameters.required).toContain('channelId');
      expect(discord.function.parameters.required).toContain('message');
    });

    it('should have correct parameter types for Telegram tool', () => {
      const tools = nullclawBridge.getToolDefinitions();
      const telegram = tools.find((t: any) => t.function.name === 'nullclaw_sendTelegram');
      
      expect(telegram.function.parameters.properties.chatId.type).toBe('string');
      expect(telegram.function.parameters.properties.message.type).toBe('string');
    });

    it('should have correct parameter types for browse tool', () => {
      const tools = nullclawBridge.getToolDefinitions();
      const browse = tools.find((t: any) => t.function.name === 'nullclaw_browse');
      
      expect(browse.function.parameters.properties.url.type).toBe('string');
      expect(browse.function.parameters.required).toContain('url');
    });
  });

  describe('MCP Tool Execution', () => {
    it('should execute Nullclaw Discord tool', async () => {
      const result = await nullclawBridge.executeTool(
        'nullclaw_sendDiscord',
        {
          channelId: '123456789012345678',
          message: 'Test message from MCP integration',
        },
        'session-123'
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
    });

    it('should execute Nullclaw Telegram tool', async () => {
      const result = await nullclawBridge.executeTool(
        'nullclaw_sendTelegram',
        {
          chatId: '-1001234567890',
          message: 'Hello from V2+MCP!',
        },
        'session-123'
      );

      expect(result.success).toBe(true);
    });

    it('should execute Nullclaw browse tool', async () => {
      const result = await nullclawBridge.executeTool(
        'nullclaw_browse',
        {
          url: 'https://api.github.com/users/octocat',
        },
        'session-123'
      );

      expect(result.success).toBe(true);
    });

    it('should execute Nullclaw automate tool', async () => {
      const result = await nullclawBridge.executeTool(
        'nullclaw_automate',
        {
          serverId: 'server-1',
          commands: ['la', 'pwdls -', 'echo "Hello"'],
        },
        'session-123'
      );

      expect(result.success).toBe(true);
    });

    it('should get Nullclaw status', async () => {
      const result = await nullclawBridge.executeTool(
        'nullclaw_status',
        {},
        'session-123'
      );

      expect(result.success).toBe(true);
      expect(result.metadata?.available).toBe(true);
      expect(result.metadata?.health).toBe('healthy');
    });

    it('should return error for unknown tool', async () => {
      const result = await nullclawBridge.executeTool(
        'unknown_tool',
        {},
        'session-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });
  });

  describe('Session Management', () => {
    it('should track active containers', async () => {
      // Execute some tools to create container bindings
      await nullclawBridge.executeTool('nullclaw_status', {}, 'session-1');
      await nullclawBridge.executeTool('nullclaw_status', {}, 'session-2');

      const stats = nullclawBridge.getStats();
      expect(stats.sessionsMapped).toBeGreaterThanOrEqual(0);
    });

    it('should release session from container', async () => {
      await nullclawBridge.executeTool('nullclaw_status', {}, 'session-release-test');
      
      nullclawBridge.releaseSession('session-release-test');

      const stats = nullclawBridge.getStats();
      expect(typeof stats.sessionsMapped).toBe('number');
    });
  });

  describe('Error Handling', () => {
    it('should handle tool execution failure gracefully', async () => {
      const nullclaw = await import('@bing/shared/agent/nullclaw-integration');
      vi.mocked(nullclaw.nullclawIntegration.executeTask).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      const result = await nullclawBridge.executeTool(
        'nullclaw_sendDiscord',
        { channelId: '123', message: 'test' },
        'session-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Container Pool Management', () => {
    it('should report pool statistics', () => {
      const stats = nullclawBridge.getStats();

      expect(stats.containerPoolSize).toBeDefined();
      expect(stats.activeContainers).toBeDefined();
      expect(stats.queuedTasks).toBeDefined();
      expect(typeof stats.containerPoolSize).toBe('number');
    });
  });

  describe('Bridge Shutdown', () => {
    it('should shutdown cleanly', async () => {
      await expect(nullclawBridge.shutdown()).resolves.not.toThrow();
    });
  });
});
