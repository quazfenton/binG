/**
 * Smithery Registry Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSmitheryClient } from '../lib/mcp/smithery-registry';

describe('Smithery Client', () => {
  let client: ReturnType<typeof createSmitheryClient>;

  beforeEach(() => {
    vi.stubEnv('SMITHERY_API_KEY', 'test-smithery-key');
    client = createSmitheryClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('searchServers', () => {
    it('should search servers with query', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: [{ qualifiedName: 'github/mcp-server' }],
          total: 1,
          page: 1,
          pageSize: 10,
          hasMore: false,
        }),
      });

      const results = await client.searchServers({ q: 'github' });

      expect(results.servers.length).toBe(1);
      expect(results.servers[0].qualifiedName).toBe('github/mcp-server');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/servers?q=github'),
        expect.any(Object)
      );
    });

    it('should filter by verified status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: [],
          total: 0,
          page: 1,
          pageSize: 10,
          hasMore: false,
        }),
      });

      await client.searchServers({ verified: true });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('verified=true'),
        expect.any(Object)
      );
    });

    it('should filter by deployment status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ servers: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
      });

      await client.searchServers({ deploymentStatus: 'http' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('deploymentStatus=http'),
        expect.any(Object)
      );
    });

    it('should handle pagination', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          servers: [{}, {}, {}],
          total: 50,
          page: 2,
          pageSize: 20,
          hasMore: true,
        }),
      });

      const results = await client.searchServers({ page: 2, pageSize: 20 });

      expect(results.hasMore).toBe(true);
      expect(results.total).toBe(50);
    });

    it('should handle search failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
      });

      await expect(client.searchServers({ q: 'test' }))
        .rejects.toThrow('Smithery search failed');
    });
  });

  describe('getServer', () => {
    it('should get server details', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          qualifiedName: 'github/mcp-server',
          name: 'GitHub MCP',
          description: 'GitHub integration',
        }),
      });

      const server = await client.getServer('github/mcp-server');

      expect(server.qualifiedName).toBe('github/mcp-server');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/servers/github%2Fmcp-server'),
        expect.any(Object)
      );
    });

    it('should handle server not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(client.getServer('invalid/server'))
        .rejects.toThrow('Failed to get server');
    });
  });

  describe('listReleases', () => {
    it('should list server releases', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { id: 'release-1', version: '1.0.0', status: 'success' },
          { id: 'release-2', version: '1.1.0', status: 'success' },
        ]),
      });

      const releases = await client.listReleases('github/mcp-server');

      expect(releases.length).toBe(2);
      expect(releases[0].version).toBe('1.0.0');
    });
  });

  describe('downloadBundle', () => {
    it('should download MCPB bundle', async () => {
      const mockBlob = new Blob(['bundle data'], { type: 'application/octet-stream' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => mockBlob,
      });

      const bundle = await client.downloadBundle('github/mcp-server');

      expect(bundle).toBeInstanceOf(Blob);
      expect(bundle.size).toBeGreaterThan(0);
    });
  });

  describe('listConnections', () => {
    it('should list connections in namespace', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { id: 'conn-1', namespace: 'test', status: 'active' },
          { id: 'conn-2', namespace: 'test', status: 'active' },
        ]),
      });

      const connections = await client.listConnections('test');

      expect(connections.length).toBe(2);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/connect/test'),
        expect.any(Object)
      );
    });

    it('should filter by metadata', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      });

      await client.listConnections('test', { userId: 'alice' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('metadata.userId=alice'),
        expect.any(Object)
      );
    });
  });

  describe('createConnection', () => {
    it('should create new connection', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'conn-new',
          namespace: 'test',
          mcpUrl: 'https://mcp.example.com',
          status: 'active',
        }),
      });

      const connection = await client.createConnection('test', {
        mcpUrl: 'https://mcp.example.com',
      });

      expect(connection.id).toBe('conn-new');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/connect/test'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include metadata in connection', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'conn-1' }),
      });

      await client.createConnection('test', {
        mcpUrl: 'https://mcp.example.com',
        metadata: { userId: 'alice' },
      });

      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('upsertConnection', () => {
    it('should create or update connection', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'conn-1', status: 'active' }),
      });

      const connection = await client.upsertConnection('test', 'conn-1', {
        mcpUrl: 'https://mcp.example.com',
      });

      expect(connection.id).toBe('conn-1');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/connect/test/conn-1'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('deleteConnection', () => {
    it('should delete connection', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      await client.deleteConnection('test', 'conn-1');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/connect/test/conn-1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('pollEvents', () => {
    it('should poll for events', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [{ type: 'tool_call', data: {} }],
          done: false,
        }),
      });

      const result = await client.pollEvents('test', 'conn-1');

      expect(result.events.length).toBe(1);
      expect(result.done).toBe(false);
    });

    it('should return done when no events', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ events: [], done: true }),
      });

      const result = await client.pollEvents('test', 'conn-1');

      expect(result.done).toBe(true);
    });
  });

  describe('createNamespace', () => {
    it('should create namespace', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, name: 'my-namespace' }),
      });

      const result = await client.createNamespace('my-namespace');

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/namespaces/my-namespace'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('listNamespaces', () => {
    it('should list user namespaces', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { name: 'namespace-1' },
          { name: 'namespace-2' },
        ]),
      });

      const namespaces = await client.listNamespaces();

      expect(namespaces.length).toBe(2);
    });

    it('should search namespaces with query', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      });

      await client.listNamespaces({ q: 'github', hasServers: true });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('q=github'),
        expect.stringContaining('hasServers=true'),
        expect.any(Object)
      );
    });
  });
});
