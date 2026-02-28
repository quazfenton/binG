/**
 * Unit Tests: MCP Client & Tool Registry
 * 
 * Tests the Model Context Protocol implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPClient } from '@/lib/mcp/client';
import { MCPToolRegistry } from '@/lib/mcp/tool-registry';
import type { MCPConfig } from '@/lib/mcp/config';

describe('MCPClient', () => {
  let client: MCPClient;
  let mockConfig: MCPConfig;

  beforeEach(() => {
    mockConfig = {
      servers: [
        {
          name: 'test-server',
          url: 'http://localhost:3001/mcp',
          transport: 'http',
        },
      ],
      timeout: 30000,
    };

    client = new MCPClient(mockConfig);
  });

  it('should initialize with config', () => {
    expect(client).toBeDefined();
    expect(client.getServers()).toHaveLength(1);
  });

  it('should connect to server', async () => {
    // Mock fetch for connection
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: {
            name: 'test-server',
            version: '1.0.0',
          },
        },
      }),
    });

    await client.connect('test-server');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/mcp'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Object),
      })
    );
  });

  it('should handle connection timeout', async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 40000);
      });
    });

    await expect(client.connect('test-server')).rejects.toThrow('Timeout');
  });

  it('should list available tools', async () => {
    const mockTools = {
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: {
              param1: { type: 'string' },
            },
          },
        },
      ],
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: mockTools }),
      });

    await client.connect('test-server');
    const tools = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test_tool');
  });

  it('should call tool with parameters', async () => {
    const mockResult = {
      content: [
        {
          type: 'text',
          text: 'Tool result',
        },
      ],
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: mockResult }),
      });

    await client.connect('test-server');
    const result = await client.callTool('test_tool', { param1: 'value1' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe('Tool result');
  });

  it('should handle tool errors', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Tool execution failed',
          },
        }),
      });

    await client.connect('test-server');

    await expect(
      client.callTool('failing_tool', {})
    ).rejects.toThrow('Tool execution failed');
  });

  it('should list resources', async () => {
    const mockResources = {
      resources: [
        {
          uri: 'file:///test.txt',
          name: 'Test File',
          mimeType: 'text/plain',
        },
      ],
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: mockResources }),
      });

    await client.connect('test-server');
    const resources = await client.listResources();

    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe('file:///test.txt');
  });

  it('should read resource content', async () => {
    const mockContent = {
      contents: [
        {
          uri: 'file:///test.txt',
          mimeType: 'text/plain',
          text: 'File content',
        },
      ],
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: mockContent }),
      });

    await client.connect('test-server');
    const content = await client.readResource('file:///test.txt');

    expect(content.contents).toHaveLength(1);
    expect(content.contents[0].text).toBe('File content');
  });

  it('should disconnect from server', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: {} }),
    });

    await client.connect('test-server');
    await client.disconnect('test-server');

    expect(client.getServers()).toHaveLength(0);
  });

  it('should handle multiple servers', async () => {
    const multiServerConfig: MCPConfig = {
      servers: [
        { name: 'server1', url: 'http://localhost:3001/mcp', transport: 'http' },
        { name: 'server2', url: 'http://localhost:3002/mcp', transport: 'http' },
      ],
      timeout: 30000,
    };

    const multiClient = new MCPClient(multiServerConfig);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: {} }),
    });

    await multiClient.connect('server1');
    await multiClient.connect('server2');

    expect(multiClient.getServers()).toHaveLength(2);
  });
});

describe('MCPToolRegistry', () => {
  let registry: MCPToolRegistry;

  beforeEach(() => {
    registry = new MCPToolRegistry();
  });

  it('should register tool', () => {
    const tool = {
      name: 'test_tool',
      description: 'Test tool',
      handler: vi.fn(),
      schema: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
      },
    };

    registry.register(tool);

    expect(registry.getTool('test_tool')).toBeDefined();
  });

  it('should unregister tool', () => {
    const tool = {
      name: 'temp_tool',
      description: 'Temporary',
      handler: vi.fn(),
      schema: {},
    };

    registry.register(tool);
    registry.unregister('temp_tool');

    expect(registry.getTool('temp_tool')).toBeUndefined();
  });

  it('should list all tools', () => {
    registry.register({
      name: 'tool1',
      description: 'First',
      handler: vi.fn(),
      schema: {},
    });
    registry.register({
      name: 'tool2',
      description: 'Second',
      handler: vi.fn(),
      schema: {},
    });

    const tools = registry.listTools();

    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toContain('tool1');
    expect(tools.map(t => t.name)).toContain('tool2');
  });

  it('should execute tool with validation', async () => {
    const handler = vi.fn().mockResolvedValue({ result: 'success' });
    
    registry.register({
      name: 'validated_tool',
      description: 'Validated',
      handler,
      schema: {
        type: 'object',
        required: ['input'],
        properties: {
          input: { type: 'string' },
        },
      },
    });

    const result = await registry.execute('validated_tool', { input: 'test' });

    expect(handler).toHaveBeenCalledWith({ input: 'test' });
    expect(result).toEqual({ result: 'success' });
  });

  it('should validate input before execution', async () => {
    registry.register({
      name: 'strict_tool',
      description: 'Strict',
      handler: vi.fn(),
      schema: {
        type: 'object',
        required: ['required_field'],
        properties: {
          required_field: { type: 'string' },
        },
      },
    });

    await expect(
      registry.execute('strict_tool', {})
    ).rejects.toThrow(/required_field/);
  });

  it('should handle tool execution errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Tool failed'));
    
    registry.register({
      name: 'failing_tool',
      description: 'Fails',
      handler,
      schema: {},
    });

    await expect(
      registry.execute('failing_tool', {})
    ).rejects.toThrow('Tool failed');
  });

  it('should get tool by name', () => {
    const tool = {
      name: 'specific_tool',
      description: 'Specific',
      handler: vi.fn(),
      schema: {},
    };

    registry.register(tool);

    const retrieved = registry.getTool('specific_tool');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('specific_tool');
  });

  it('should return undefined for unknown tool', () => {
    const tool = registry.getTool('unknown');
    expect(tool).toBeUndefined();
  });

  it('should clear all tools', () => {
    registry.register({
      name: 'tool1',
      description: 'First',
      handler: vi.fn(),
      schema: {},
    });

    registry.clear();

    expect(registry.listTools()).toHaveLength(0);
  });
});

describe('MCP Transport Types', () => {
  it('should support HTTP transport', () => {
    const config: MCPConfig = {
      servers: [{
        name: 'http-server',
        url: 'http://localhost:3001/mcp',
        transport: 'http',
      }],
      timeout: 30000,
    };

    const client = new MCPClient(config);
    expect(client).toBeDefined();
  });

  it('should support stdio transport', () => {
    const config: MCPConfig = {
      servers: [{
        name: 'stdio-server',
        command: 'node',
        args: ['server.js'],
        transport: 'stdio',
      }],
      timeout: 30000,
    };

    const client = new MCPClient(config);
    expect(client).toBeDefined();
  });

  it('should support SSE transport', () => {
    const config: MCPConfig = {
      servers: [{
        name: 'sse-server',
        url: 'http://localhost:3001/sse',
        transport: 'sse',
      }],
      timeout: 30000,
    };

    const client = new MCPClient(config);
    expect(client).toBeDefined();
  });
});
