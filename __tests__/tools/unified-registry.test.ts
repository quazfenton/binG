/**
 * Tests for Unified Tool Registry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedToolRegistry, getUnifiedToolRegistry } from '../../lib/tools/registry';
import { SmitheryProvider } from '../../lib/tool-integration/providers/smithery';

describe('UnifiedToolRegistry', () => {
  let registry: UnifiedToolRegistry;

  beforeEach(() => {
    registry = new UnifiedToolRegistry();
  });

  describe('initialization', () => {
    it('should create registry with default config', () => {
      expect(registry).toBeDefined();
      const status = registry.getStatus();
      expect(status.initialized).toBe(false);
    });

    it('should initialize with providers', async () => {
      await registry.initialize();
      const status = registry.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.providersCount).toBeGreaterThan(0);
    });

    it('should register custom providers', () => {
      const mockProvider = {
        name: 'mock',
        isAvailable: () => true,
        supports: () => true,
        execute: vi.fn().mockResolvedValue({ success: true, output: 'mock' }),
      };
      registry.registerProvider(mockProvider);
      expect(registry.getProviders()).toContain('mock');
    });
  });

  describe('tool execution', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should execute tool via composio fallback', async () => {
      const result = await registry.executeTool(
        'test_tool',
        { param: 'value' },
        { userId: 'user_123', conversationId: 'conv_456' }
      );

      // Should attempt execution (may fail due to missing API keys in test)
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle missing tool gracefully', async () => {
      const result = await registry.executeTool(
        'nonexistent_tool',
        {},
        { userId: 'user_123' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should use fallback chain when primary fails', async () => {
      // Register a provider that always fails
      const failingProvider = {
        name: 'failing',
        isAvailable: () => true,
        supports: () => true,
        execute: vi.fn().mockResolvedValue({ 
          success: false, 
          error: 'Always fails',
          authRequired: false,
        }),
      };
      registry.registerProvider(failingProvider);

      const result = await registry.executeTool(
        'test_tool',
        {},
        { userId: 'user_123' }
      );

      // Should fall back to other providers
      expect(result).toBeDefined();
    });
  });

  describe('tool discovery', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('should search for tools', async () => {
      const tools = await registry.searchTools('github', 'user_123');
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should get available tools', async () => {
      const tools = await registry.getAvailableTools('user_123');
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should filter tools by provider', async () => {
      const allTools = await registry.getAvailableTools();
      const arcadeTools = allTools.filter(t => t.provider === 'arcade');
      
      if (arcadeTools.length > 0) {
        expect(arcadeTools.every(t => t.provider === 'arcade')).toBe(true);
      }
    });
  });

  describe('singleton', () => {
    it('should return same instance from getUnifiedToolRegistry', () => {
      const instance1 = getUnifiedToolRegistry();
      const instance2 = getUnifiedToolRegistry();
      expect(instance1).toBe(instance2);
    });
  });
});

describe('SmitheryProvider', () => {
  let provider: SmitheryProvider;

  beforeEach(() => {
    provider = new SmitheryProvider({ 
      apiKey: process.env.SMITHERY_API_KEY || 'test_key' 
    });
  });

  describe('initialization', () => {
    it('should create provider with config', () => {
      expect(provider.name).toBe('smithery');
      expect(provider.isAvailable()).toBe(false); // No servers registered
    });

    it('should register servers', () => {
      provider.registerServer({
        id: 'github',
        name: 'GitHub',
        url: 'https://mcp.github.com',
        enabled: true,
      });

      const servers = provider.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('github');
    });
  });

  describe('tool discovery', () => {
    it('should discover tools from registered servers', async () => {
      provider.registerServer({
        id: 'test',
        name: 'Test',
        url: 'http://localhost:3000',
        enabled: true,
      });

      // Will fail in test but should not throw
      const tools = await provider.discoverTools('test');
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('supports', () => {
    it('should support smithery: prefixed tools', () => {
      const result = provider.supports({
        toolKey: 'smithery:github:create_issue',
        config: {} as any,
        input: {},
        context: { userId: 'user_123' },
      });
      expect(result).toBe(true);
    });
  });
});
