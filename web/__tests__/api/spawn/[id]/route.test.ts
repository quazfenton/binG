/**
 * Dynamic Spawn Route — Unit Tests
 *
 * Tests for app/api/spawn/[id]/route.ts
 * Covers: GET (agent details), POST (prompt), DELETE (stop agent)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────────────────────

const mockAgent = {
  agentId: 'agent-test-123',
  type: 'codex',
  containerId: 'container-abc',
  port: 5000,
  apiUrl: 'http://localhost:5000',
  workspaceDir: '/workspace/test',
  startedAt: Date.now(),
  lastActivity: Date.now(),
  status: 'ready',
  health: 'healthy',
};

const mockPromptResult = {
  response: 'Hello from agent',
  duration: 150,
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
};

const { mockGetAgentServiceManager, mockPrompt, mockStopAgent } = vi.hoisted(() => {
  const _getAgent = vi.fn((id: string) =>
    id === 'agent-test-123' ? { ...mockAgent } : undefined,
  );
  const _prompt = vi.fn(async (_id: string, _req: any) => ({
    ...mockPromptResult,
  }));
  const _stopAgent = vi.fn(async (_id: string) => {});
  const _listAgents = vi.fn(() => [mockAgent]);

  return {
    mockGetAgentServiceManager: vi.fn(() => ({
      getAgent: _getAgent,
      prompt: _prompt,
      stopAgent: _stopAgent,
      listAgents: _listAgents,
    })),
    mockPrompt: _prompt,
    mockStopAgent: _stopAgent,
  };
});

vi.mock('@/lib/spawn', () => ({
  getAgentServiceManager: mockGetAgentServiceManager,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ────────────────────────────────────────────────────────────────────────────
// Import AFTER mocks
// ────────────────────────────────────────────────────────────────────────────

import { GET, POST, DELETE } from '@/app/api/spawn/[id]/route';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeGetRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/spawn/${id}`, {
    method: 'GET',
  }) as unknown as Request;
}

function makePostRequest(id: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000/api/spawn/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function makeDeleteRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/spawn/${id}`, {
    method: 'DELETE',
  }) as unknown as Request;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Dynamic Spawn Route — [id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET — Agent details
  // ────────────────────────────────────────────────────────────────────────

  describe('GET — agent details', () => {
    it('returns agent details for an existing agent', async () => {
      const req = makeGetRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.agent.agentId).toBe('agent-test-123');
      expect(data.data.agent.type).toBe('codex');
      expect(data.data.agent.status).toBe('ready');
    });

    it('returns 404 for a non-existent agent', async () => {
      const req = makeGetRequest('agent-nonexistent');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-nonexistent' }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('returns 500 when service manager throws', async () => {
      mockGetAgentServiceManager.mockImplementationOnce(() => ({
        getAgent: vi.fn(() => {
          throw new Error('Internal failure');
        }),
      }));

      const req = makeGetRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal failure');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST — Prompt agent
  // ────────────────────────────────────────────────────────────────────────

  describe('POST — prompt agent', () => {
    it('sends a prompt to an existing agent', async () => {
      const req = makePostRequest('agent-test-123', {
        message: 'Hello agent',
      });
      const response = await POST(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.result.response).toBe('Hello from agent');
      expect(mockPrompt).toHaveBeenCalledWith(
        'agent-test-123',
        expect.objectContaining({ message: 'Hello agent' }),
      );
    });

    it('sends a prompt with all optional fields', async () => {
      const req = makePostRequest('agent-test-123', {
        message: 'Refactor auth',
        model: 'claude-sonnet-4-5-20250929',
        system: 'You are a refactoring expert',
        context: ['src/auth.ts'],
        stream: true,
        timeout: 60000,
      });
      const response = await POST(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      expect(response.status).toBe(200);
      expect(mockPrompt).toHaveBeenCalledWith(
        'agent-test-123',
        expect.objectContaining({
          message: 'Refactor auth',
          model: 'claude-sonnet-4-5-20250929',
          system: 'You are a refactoring expert',
          context: ['src/auth.ts'],
          stream: true,
          timeout: 60000,
        }),
      );
    });

    it('returns 404 when prompting a non-existent agent', async () => {
      const req = makePostRequest('agent-nonexistent', {
        message: 'Hello',
      });
      const response = await POST(req as any, {
        params: Promise.resolve({ id: 'agent-nonexistent' }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('returns 400 when message is missing', async () => {
      const req = makePostRequest('agent-test-123', {});
      const response = await POST(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request');
      const msgError = data.details.find(
        (e: any) => e.path.join('.') === 'message',
      );
      expect(msgError).toBeDefined();
    });

    it('returns 400 when message is empty string', async () => {
      const req = makePostRequest('agent-test-123', { message: '' });
      const response = await POST(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 500 when prompt execution throws', async () => {
      mockGetAgentServiceManager.mockImplementationOnce(() => ({
        getAgent: vi.fn(() => ({ ...mockAgent })),
        prompt: vi.fn(async () => {
          throw new Error('Agent execution failed');
        }),
      }));

      const req = makePostRequest('agent-test-123', {
        message: 'Hello',
      });
      const response = await POST(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain('Agent execution failed');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // DELETE — Stop agent
  // ────────────────────────────────────────────────────────────────────────

  describe('DELETE — stop agent', () => {
    it('stops an existing agent', async () => {
      const req = makeDeleteRequest('agent-test-123');
      const response = await DELETE(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain('agent-test-123');
      expect(mockStopAgent).toHaveBeenCalledWith('agent-test-123');
    });

    it('returns 404 when stopping a non-existent agent', async () => {
      const req = makeDeleteRequest('agent-nonexistent');
      const response = await DELETE(req as any, {
        params: Promise.resolve({ id: 'agent-nonexistent' }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('returns 500 when stopAgent throws', async () => {
      mockGetAgentServiceManager.mockImplementationOnce(() => ({
        getAgent: vi.fn(() => ({ ...mockAgent })),
        stopAgent: vi.fn(async () => {
          throw new Error('Container stop failed');
        }),
      }));

      const req = makeDeleteRequest('agent-test-123');
      const response = await DELETE(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain('Container stop failed');
    });
  });
});
