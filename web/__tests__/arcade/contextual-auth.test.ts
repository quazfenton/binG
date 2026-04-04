/**
 * Tests for Arcade Contextual Auth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Arcade Contextual Auth', () => {
  const { ArcadeService, createArcadeService } = require('@/lib/api/arcade-service');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTools', () => {
    it('should get tools with filters', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        tools: {
          list: vi.fn().mockResolvedValue([
            {
              name: 'github.create_issue',
              description: 'Create GitHub issue',
              toolkit: 'github',
              input_schema: {},
              requires_auth: true,
            },
          ]),
        },
      };

      const tools = await service.getTools({
        toolkit: 'github',
        tags: ['issues'],
        limit: 10,
      });

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('github.create_issue');
      expect(service.client.tools.list).toHaveBeenCalledWith({
        toolkit: 'github',
        tags: ['issues'],
        limit: 10,
      });
    });

    it('should handle empty results', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        tools: {
          list: vi.fn().mockResolvedValue([]),
        },
      };

      const tools = await service.getTools({ toolkit: 'github' });

      expect(tools).toEqual([]);
    });
  });

  describe('searchTools', () => {
    it('should search tools by query', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        tools: {
          search: vi.fn().mockResolvedValue([
            {
              name: 'github.create_issue',
              description: 'Create issue',
              toolkit: 'github',
            },
          ]),
        },
      };

      const tools = await service.searchTools('github issues', { limit: 5 });

      expect(tools).toHaveLength(1);
      expect(service.client.tools.search).toHaveBeenCalledWith({
        query: 'github issues',
        limit: 5,
      });
    });
  });

  describe('getContextualAuth', () => {
    it('should get contextual authorization', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        auth: {
          authorize: vi.fn().mockResolvedValue({
            authorized: false,
            auth_url: 'https://github.com/oauth/authorize',
            connection_id: 'conn_123',
            context: { repo: 'user/repo' },
          }),
        },
      };

      const result = await service.getContextualAuth(
        'user_123',
        'github.create_issue',
        { repo: 'user/repo' }
      );

      expect(result.authorized).toBe(false);
      expect(result.authUrl).toContain('github.com');
      expect(result.connectionId).toBe('conn_123');
    });

    it('should return authorized if already connected', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        auth: {
          authorize: vi.fn().mockResolvedValue({
            authorized: true,
            connection_id: 'conn_123',
          }),
        },
      };

      const result = await service.getContextualAuth(
        'user_123',
        'github.create_issue'
      );

      expect(result.authorized).toBe(true);
      expect(result.authUrl).toBeUndefined();
    });
  });

  describe('executeWithContext', () => {
    it('should check auth before execution', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        auth: {
          authorize: vi.fn().mockResolvedValue({
            authorized: true,
          }),
        },
        tools: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            data: { id: 'issue_123' },
          }),
        },
      };

      const result = await service.executeWithContext(
        'user_123',
        'github.create_issue',
        { title: 'Bug' },
        { repo: 'user/repo' }
      );

      expect(result.success).toBe(true);
      expect(service.client.auth.authorize).toHaveBeenCalled();
      expect(service.client.tools.execute).toHaveBeenCalled();
    });

    it('should return auth URL if not authorized', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        auth: {
          authorize: vi.fn().mockResolvedValue({
            authorized: false,
            auth_url: 'https://github.com/oauth/authorize',
          }),
        },
      };

      const result = await service.executeWithContext(
        'user_123',
        'github.create_issue',
        { title: 'Bug' }
      );

      expect(result.success).toBe(false);
      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toContain('github.com');
    });
  });

  describe('getToolkits', () => {
    it('should get available toolkits', async () => {
      const service = createArcadeService({ apiKey: 'test_key' });

      service.client = {
        toolkits: {
          list: vi.fn().mockResolvedValue([
            { name: 'github' },
            { name: 'slack' },
            { name: 'notion' },
          ]),
        },
      };

      const toolkits = await service.getToolkits();

      expect(toolkits).toHaveLength(3);
      expect(toolkits).toContain('github');
    });
  });
});
