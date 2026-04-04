/**
 * E2E Tests: API Endpoints Integration
 * 
 * Comprehensive tests for API endpoints including chat, agents, and integrations.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('API Endpoints Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Chat API', () => {
    const { POST } = require('@/app/api/chat/route');

    it('should handle chat request', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Hello' }],
          provider: 'openai',
          model: 'gpt-4o',
        }),
        headers: new Headers(),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
      expect(response.status).toBeDefined();
    });

    it('should validate messages array', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [], // Empty messages
          provider: 'openai',
          model: 'gpt-4o',
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('messages');
    });

    it('should validate provider and model', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Hello' }],
          provider: '', // Empty provider
          model: '',
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Provider and model');
    });

    it('should handle streaming requests', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Hello' }],
          provider: 'openai',
          model: 'gpt-4o',
          stream: true,
        }),
        headers: new Headers(),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
      expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    });

    it('should handle filesystem edits', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Create a file' }],
          provider: 'openai',
          model: 'gpt-4o',
          filesystemContext: {
            attachedFiles: [{ path: 'test.ts', content: 'test' }],
          },
        }),
        headers: new Headers(),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
    });
  });

  describe('Stateful Agent API', () => {
    const { POST } = require('@/app/api/stateful-agent/route');

    it('should handle stateful agent request', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Build a feature' }],
          sessionId: 'test-session',
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
      expect(response.status).toBeDefined();
    });

    it('should validate messages', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [],
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Messages array');
    });

    it('should handle CrewAI mode', async () => {
      vi.stubEnv('USE_CREWAI', 'true');

      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Test' }],
          useCrewAI: true,
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();

      vi.unstubAllEnvs();
    });

    it('should handle AI SDK streaming', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Test' }],
          stream: true,
          useAI_SDK: true,
        }),
        headers: new Headers(),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
      expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    });
  });

  describe('Sandbox API', () => {
    const { POST } = require('@/app/api/sandbox/route');

    it('should create sandbox', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'create',
          provider: 'e2b',
          config: {},
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
    });

    it('should execute command', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'execute',
          sandboxId: 'test-sandbox',
          command: 'ls -la',
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
    });

    it('should validate action', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'invalid-action',
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Invalid action');
    });
  });

  describe('Tools API', () => {
    const { POST } = require('@/app/api/tools/route');

    it('should list available tools', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'list',
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tools).toBeDefined();
      expect(Array.isArray(data.tools)).toBe(true);
    });

    it('should execute tool', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'execute',
          toolName: 'test-tool',
          parameters: { param: 'value' },
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
    });

    it('should handle tool errors', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'execute',
          toolName: 'nonexistent-tool',
          parameters: {},
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('MCP API', () => {
    const { GET, POST } = require('@/app/api/mcp/route');

    it('should list MCP servers', async () => {
      const mockRequest = {
        headers: new Headers(),
      };

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.servers).toBeDefined();
    });

    it('should add MCP server', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'add',
          server: { name: 'test-server', url: 'http://localhost:3000' },
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
    });

    it('should remove MCP server', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          action: 'remove',
          serverName: 'test-server',
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
    });
  });

  describe('Quota API', () => {
    const { GET } = require('@/app/api/quota/route');

    it('should get quota status', async () => {
      const mockRequest = {
        headers: new Headers(),
      };

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.quotas).toBeDefined();
    });

    it('should include all providers', async () => {
      const mockRequest = {
        headers: new Headers(),
      };

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(data.quotas).toBeDefined();
      expect(Object.keys(data.quotas).length).toBeGreaterThan(0);
    });
  });

  describe('Health API', () => {
    const { GET } = require('@/app/api/health/route');

    it('should return health status', async () => {
      const mockRequest = {
        headers: new Headers(),
      };

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBeDefined();
      expect(data.providers).toBeDefined();
    });

    it('should include provider health', async () => {
      const mockRequest = {
        headers: new Headers(),
      };

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(data.providers).toBeDefined();
      expect(typeof data.providers).toBe('object');
    });
  });

  describe('Auth API', () => {
    const { POST } = require('@/app/api/auth/login/route');

    it('should handle login', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          email: 'test@example.com',
          password: 'password123',
        }),
      };

      const response = await POST(mockRequest);

      expect(response).toBeDefined();
    });

    it('should validate credentials', async () => {
      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          email: '', // Empty email
          password: 'password',
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('email');
    });
  });

  describe('API Error Handling', () => {
    it('should handle JSON parse errors', async () => {
      const { POST } = require('@/app/api/chat/route');

      const mockRequest = {
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      };

      const response = await POST(mockRequest);

      expect(response.status).toBe(400);
    });

    it('should handle provider errors', async () => {
      const { POST } = require('@/app/api/chat/route');

      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Test' }],
          provider: 'invalid-provider',
          model: 'test-model',
        }),
      };

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('provider');
    });

    it('should handle timeout errors', async () => {
      const { POST } = require('@/app/api/chat/route');

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Timeout'));

      const mockRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Test' }],
          provider: 'openai',
          model: 'gpt-4o',
        }),
      };

      const response = await POST(mockRequest);

      expect(response.status).toBe(500);
    });
  });

  describe('API Integration: Full Workflow', () => {
    it('should support complete chat workflow', async () => {
      const { POST: chatPOST } = require('@/app/api/chat/route');

      // Send message
      const messageRequest = {
        json: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: 'Hello' }],
          provider: 'openai',
          model: 'gpt-4o',
        }),
        headers: new Headers(),
      };

      const messageResponse = await chatPOST(messageRequest);
      expect(messageResponse).toBeDefined();

      // Check health
      const { GET: healthGET } = require('@/app/api/health/route');
      const healthResponse = await healthGET({ headers: new Headers() });
      const healthData = await healthResponse.json();

      expect(healthData.status).toBeDefined();
    });
  });
});
