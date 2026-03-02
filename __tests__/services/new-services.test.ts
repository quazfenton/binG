/**
 * Tests for new service integrations (Tambo, Arcade, Nango)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TamboService', () => {
  const { TamboService, createTamboService } = require('../../tambo/tambo-service');

  describe('initialization', () => {
    it('should create service with config', () => {
      const service = new TamboService({ apiKey: 'test_key' });
      expect(service).toBeDefined();
    });

    it('should create via factory', () => {
      const service = createTamboService({ apiKey: 'test_key' });
      expect(service).toBeDefined();
    });

    it('should initialize lazily', async () => {
      const service = createTamboService({ apiKey: 'test_key' });
      const status = service.getStatus();
      expect(status.initialized).toBe(false);
      
      // Initialize will fail without actual SDK but should not throw
      try {
        await service.initialize();
      } catch (e) {
        // Expected to fail in test environment
        expect(e).toBeDefined();
      }
    });
  });

  describe('thread management', () => {
    let service: any;

    beforeEach(() => {
      service = createTamboService({ apiKey: 'test_key' });
    });

    it('should create thread', async () => {
      const thread = await service.createThread('user_123');
      expect(thread.id).toBeDefined();
      expect(thread.userId).toBe('user_123');
      expect(thread.messages).toEqual([]);
    });

    it('should get thread by ID', async () => {
      const thread = await service.createThread('user_123');
      const retrieved = service.getThread(thread.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(thread.id);
    });

    it('should send message to thread', async () => {
      const thread = await service.createThread('user_123');
      const result = await service.sendMessage(thread.id, 'Hello');
      
      expect(result.response).toBeDefined();
      expect(thread.messages.length).toBe(2); // user + assistant
    });

    it('should get thread history', async () => {
      const thread = await service.createThread('user_123');
      await service.sendMessage(thread.id, 'Message 1');
      await service.sendMessage(thread.id, 'Message 2');
      
      const history = service.getThreadHistory(thread.id);
      expect(history.length).toBe(4); // 2 user + 2 assistant
    });

    it('should clear thread', async () => {
      const thread = await service.createThread('user_123');
      await service.sendMessage(thread.id, 'Hello');
      
      service.clearThread(thread.id);
      const history = service.getThreadHistory(thread.id);
      expect(history.length).toBe(0);
    });
  });

  describe('component registration', () => {
    let service: any;

    beforeEach(() => {
      service = createTamboService({ apiKey: 'test_key' });
    });

    it('should register component', () => {
      const component = {
        name: 'TestComponent',
        description: 'A test component',
        propsSchema: {} as any,
        component: {} as any,
      };
      
      service.registerComponent(component);
      const components = service.getAvailableComponents();
      expect(components).toHaveLength(1);
      expect(components[0].name).toBe('TestComponent');
    });
  });

  describe('tool execution', () => {
    let service: any;

    beforeEach(() => {
      service = createTamboService({ apiKey: 'test_key' });
    });

    it('should register and execute tool', async () => {
      const tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {} as any,
        execute: vi.fn().mockResolvedValue({ result: 'success' }),
      };
      
      service.registerTool(tool);
      const result = await service.executeTool('user_123', 'test_tool', {});
      
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ result: 'success' });
    });

    it('should handle unknown tool', async () => {
      const result = await service.executeTool('user_123', 'unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});

describe('ArcadeService', () => {
  const { ArcadeService, createArcadeService } = require('../../api/arcade-service');

  describe('initialization', () => {
    it('should create service with config', () => {
      const service = new ArcadeService({ apiKey: 'test_key' });
      expect(service).toBeDefined();
    });

    it('should create via factory', () => {
      const service = createArcadeService({ apiKey: 'test_key' });
      expect(service).toBeDefined();
    });
  });

  describe('tool execution', () => {
    let service: any;

    beforeEach(() => {
      service = createArcadeService({ apiKey: 'test_key' });
    });

    it('should handle missing connection', async () => {
      const result = await service.executeTool('github.create_issue', {}, 'user_123');
      
      // Should return auth required since no connection exists
      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
    });

    it('should extract toolkit from tool name', () => {
      const toolkit = service.extractToolkit('github.create_issue');
      expect(toolkit).toBe('github');
    });
  });

  describe('connection management', () => {
    let service: any;

    beforeEach(() => {
      service = createArcadeService({ apiKey: 'test_key' });
    });

    it('should get connections for user', async () => {
      const connections = await service.getConnections('user_123');
      expect(Array.isArray(connections)).toBe(true);
    });

    it('should get auth URL', async () => {
      const authUrl = await service.getAuthUrl('github', 'user_123');
      expect(authUrl).toBeDefined();
      expect(authUrl).toContain('auth');
    });
  });
});

describe('NangoService', () => {
  const { NangoService, createNangoService } = require('../../api/nango-service');

  describe('initialization', () => {
    it('should create service with config', () => {
      const service = new NangoService({ secretKey: 'test_key' });
      expect(service).toBeDefined();
    });

    it('should create via factory', () => {
      const service = createNangoService({ secretKey: 'test_key' });
      expect(service).toBeDefined();
    });
  });

  describe('proxy requests', () => {
    let service: any;

    beforeEach(() => {
      service = createNangoService({ secretKey: 'test_key' });
    });

    it('should handle missing connection', async () => {
      const result = await service.executeTool(
        'github',
        '/user/repos',
        {},
        'user_123'
      );
      
      // Should return auth required since no connection exists
      expect(result.requiresAuth).toBe(true);
      expect(result.authUrl).toBeDefined();
    });

    it('should get providers', async () => {
      const providers = await service.getProviders();
      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe('connection management', () => {
    let service: any;

    beforeEach(() => {
      service = createNangoService({ secretKey: 'test_key' });
    });

    it('should get connections for user', async () => {
      const connections = await service.getConnections('user_123');
      expect(Array.isArray(connections)).toBe(true);
    });

    it('should create connection (get auth URL)', async () => {
      const authUrl = await service.createConnection('github', 'user_123');
      expect(authUrl).toBeDefined();
      expect(authUrl).toContain('oauth');
    });
  });
});
