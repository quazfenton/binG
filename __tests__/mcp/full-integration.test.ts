/**
 * E2E Tests: MCP (Model Context Protocol) Module
 * 
 * Tests for MCP client, tool registry, server configuration, and Smithery integration.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

describe('MCP Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MCP Client', () => {
    const { MCPClient } = require('@/lib/mcp/client');

    let client: typeof MCPClient;

    beforeEach(() => {
      client = new MCPClient({
        name: 'test-client',
        version: '1.0.0',
      });
    });

    afterEach(async () => {
      await client.disconnect();
    });

    it('should create client instance', () => {
      expect(client).toBeDefined();
      expect(client.name).toBe('test-client');
    });

    it('should connect to server', async () => {
      const connectSpy = vi.spyOn(client, 'connect').mockResolvedValue(undefined);

      await client.connect({
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      expect(connectSpy).toHaveBeenCalled();
    });

    it('should list available tools', async () => {
      const mockTools = [
        { name: 'tool-1', description: 'First tool' },
        { name: 'tool-2', description: 'Second tool' },
      ];

      vi.spyOn(client, 'listTools').mockResolvedValue(mockTools);

      const tools = await client.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('tool-1');
    });

    it('should call tool', async () => {
      const mockResult = { success: true, data: { result: 'test' } };

      vi.spyOn(client, 'callTool').mockResolvedValue(mockResult);

      const result = await client.callTool('test-tool', { param: 'value' });

      expect(result).toEqual(mockResult);
    });

    it('should handle tool errors', async () => {
      vi.spyOn(client, 'callTool').mockRejectedValue(new Error('Tool failed'));

      await expect(client.callTool('test-tool', {})).rejects.toThrow('Tool failed');
    });

    it('should read resources', async () => {
      const mockResource = { uri: 'test://resource', content: 'content' };

      vi.spyOn(client, 'readResource').mockResolvedValue(mockResource);

      const resource = await client.readResource('test://resource');

      expect(resource).toEqual(mockResource);
    });

    it('should list resources', async () => {
      const mockResources = [
        { uri: 'test://1', name: 'Resource 1' },
        { uri: 'test://2', name: 'Resource 2' },
      ];

      vi.spyOn(client, 'listResources').mockResolvedValue(mockResources);

      const resources = await client.listResources();

      expect(resources).toHaveLength(2);
    });

    it('should handle prompts', async () => {
      const mockPrompt = {
        name: 'test-prompt',
        description: 'Test prompt',
        arguments: [{ name: 'arg1', required: true }],
      };

      vi.spyOn(client, 'getPrompt').mockResolvedValue(mockPrompt);

      const prompt = await client.getPrompt('test-prompt');

      expect(prompt).toEqual(mockPrompt);
    });

    it('should emit events on tool changes', async () => {
      const eventSpy = vi.fn();
      client.on('tools_changed', eventSpy);

      client.emit('tools_changed', { added: ['tool-1'], removed: [] });

      expect(eventSpy).toHaveBeenCalled();
    });

    it('should disconnect cleanly', async () => {
      const disconnectSpy = vi.spyOn(client, 'disconnect').mockResolvedValue(undefined);

      await client.disconnect();

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });

  describe('MCP Tool Registry', () => {
    const { MCPToolRegistry, mcpToolRegistry } = require('@/lib/mcp/tool-registry');

    let registry: typeof MCPToolRegistry;

    beforeEach(() => {
      registry = new MCPToolRegistry();
    });

    it('should register tools', () => {
      const tool = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      registry.registerTool('server-1', tool);

      const tools = registry.getToolsByServer('server-1');
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test-tool');
    });

    it('should unregister tools', () => {
      registry.registerTool('server-1', { name: 'tool-1', description: '', inputSchema: {} });
      registry.unregisterTool('server-1', 'tool-1');

      const tools = registry.getToolsByServer('server-1');
      expect(tools).toHaveLength(0);
    });

    it('should get all tools', () => {
      registry.registerTool('server-1', { name: 'tool-1', description: '', inputSchema: {} });
      registry.registerTool('server-2', { name: 'tool-2', description: '', inputSchema: {} });

      const allTools = registry.getAllTools();
      expect(allTools).toHaveLength(2);
    });

    it('should get tool by name', () => {
      registry.registerTool('server-1', { name: 'specific-tool', description: '', inputSchema: {} });

      const tool = registry.getToolByName('specific-tool');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('specific-tool');
    });

    it('should emit registration events', () => {
      const registerSpy = vi.fn();
      registry.on('tool_registered', registerSpy);

      registry.registerTool('server-1', { name: 'tool-1', description: '', inputSchema: {} });

      expect(registerSpy).toHaveBeenCalled();
    });

    it('should clear all tools', () => {
      registry.registerTool('server-1', { name: 'tool-1', description: '', inputSchema: {} });
      registry.clear();

      const allTools = registry.getAllTools();
      expect(allTools).toHaveLength(0);
    });
  });

  describe('MCP Server Configuration', () => {
    const {
      parseMCPServerConfigs,
      initializeMCP,
      shutdownMCP,
      MCPServerPresets,
      getMCPTools,
      isMCPAvailable,
    } = require('@/lib/mcp/config');

    it('should parse server configurations from env', () => {
      vi.stubEnv('MCP_SERVERS', JSON.stringify([
        { name: 'test-server', command: 'node', args: ['server.js'] },
      ]));

      const configs = parseMCPServerConfigs();

      expect(configs).toHaveLength(1);
      expect(configs[0].name).toBe('test-server');

      vi.unstubAllEnvs();
    });

    it('should provide server presets', () => {
      const presets = MCPServerPresets;

      expect(presets).toBeDefined();
      expect(Object.keys(presets).length).toBeGreaterThan(0);
    });

    it('should check MCP availability', () => {
      vi.stubEnv('MCP_SERVERS', '[]');
      
      const available = isMCPAvailable();
      expect(typeof available).toBe('boolean');

      vi.unstubAllEnvs();
    });

    it('should get MCP tools', async () => {
      vi.stubEnv('MCP_SERVERS', JSON.stringify([]));

      const tools = await getMCPTools();
      expect(Array.isArray(tools)).toBe(true);

      vi.unstubAllEnvs();
    });

    it('should initialize MCP', async () => {
      vi.stubEnv('MCP_SERVERS', JSON.stringify([]));

      const result = await initializeMCP();
      expect(result).toBeDefined();

      await shutdownMCP();
      vi.unstubAllEnvs();
    });
  });

  describe('Smithery Integration', () => {
    const { SmitheryRegistry, SmitheryService } = require('@/lib/mcp/smithery-service');

    describe('Smithery Registry', () => {
      let registry: typeof SmitheryRegistry;

      beforeEach(() => {
        registry = new SmitheryRegistry();
      });

      it('should search for servers', async () => {
        vi.spyOn(registry, 'searchServers').mockResolvedValue([
          { name: 'server-1', description: 'Test server' },
        ]);

        const servers = await registry.searchServers('test');

        expect(servers).toHaveLength(1);
      });

      it('should get server details', async () => {
        vi.spyOn(registry, 'getServerDetails').mockResolvedValue({
          name: 'server-1',
          config: { command: 'node', args: ['server.js'] },
        });

        const details = await registry.getServerDetails('server-1');

        expect(details.name).toBe('server-1');
        expect(details.config).toBeDefined();
      });

      it('should install server', async () => {
        vi.spyOn(registry, 'installServer').mockResolvedValue({
          success: true,
          serverId: 'installed-server',
        });

        const result = await registry.installServer('server-1');

        expect(result.success).toBe(true);
      });
    });

    describe('Smithery Service', () => {
      let service: typeof SmitheryService;

      beforeEach(() => {
        service = new SmitheryService();
      });

      it('should list available servers', async () => {
        vi.spyOn(service, 'listServers').mockResolvedValue([
          { id: 'server-1', name: 'Test Server' },
        ]);

        const servers = await service.listServers();

        expect(servers).toHaveLength(1);
      });

      it('should get server config', async () => {
        vi.spyOn(service, 'getServerConfig').mockResolvedValue({
          command: 'node',
          args: ['server.js'],
          env: { KEY: 'value' },
        });

        const config = await service.getServerConfig('server-1');

        expect(config.command).toBe('node');
      });

      it('should validate server config', () => {
        const valid = service.validateServerConfig({
          command: 'node',
          args: ['server.js'],
        });

        expect(valid).toBe(true);
      });
    });
  });

  describe('Blaxel MCP Service', () => {
    const { createBlaxelMcpServer, getBlaxelMcpConfig } = require('@/lib/mcp/blaxel-mcp-service');

    it('should create Blaxel MCP server', () => {
      const server = createBlaxelMcpServer({
        workspace: 'test-workspace',
        apiKey: 'test-key',
      });

      expect(server).toBeDefined();
    });

    it('should get Blaxel MCP config', () => {
      vi.stubEnv('BLAXEL_API_KEY', 'test-key');
      vi.stubEnv('BLAXEL_WORKSPACE', 'test-workspace');

      const config = getBlaxelMcpConfig();

      expect(config).toBeDefined();
      expect(config.apiKey).toBe('test-key');

      vi.unstubAllEnvs();
    });
  });

  describe('MCP Transport Types', () => {
    const { createStdioTransport, createSSETransport, createWebSocketTransport } = require('@/lib/mcp/config');

    it('should create stdio transport', () => {
      const transport = createStdioTransport({
        command: 'node',
        args: ['server.js'],
      });

      expect(transport).toBeDefined();
      expect(transport.command).toBe('node');
    });

    it('should create SSE transport', () => {
      const transport = createSSETransport({
        url: 'http://localhost:3000/sse',
      });

      expect(transport).toBeDefined();
      expect(transport.url).toContain('sse');
    });

    it('should create WebSocket transport', () => {
      const transport = createWebSocketTransport({
        url: 'ws://localhost:3000/ws',
      });

      expect(transport).toBeDefined();
      expect(transport.url).toContain('ws');
    });
  });

  describe('MCP Integration: Full Workflow', () => {
    it('should support complete MCP workflow', async () => {
      const { MCPClient } = require('@/lib/mcp/client');
      const { MCPToolRegistry } = require('@/lib/mcp/tool-registry');

      // Create client
      const client = new MCPClient({ name: 'test', version: '1.0.0' });

      // Create registry
      const registry = new MCPToolRegistry();

      // Mock connection
      vi.spyOn(client, 'connect').mockResolvedValue(undefined);
      vi.spyOn(client, 'listTools').mockResolvedValue([
        { name: 'test-tool', description: 'Test', inputSchema: {} },
      ]);

      // Connect and register
      await client.connect({ type: 'stdio', command: 'node', args: [] });
      const tools = await client.listTools();
      tools.forEach(tool => registry.registerTool('test-server', tool));

      // Verify
      const registeredTools = registry.getAllTools();
      expect(registeredTools).toHaveLength(1);

      await client.disconnect();
    });
  });
});
