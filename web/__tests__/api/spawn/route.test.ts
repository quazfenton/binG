/**
 * Spawn Route — Unit Tests
 *
 * Tests for app/api/spawn/route.ts
 * Covers: startAgentSchema validation (agent type enum, required fields),
 * POST handler schema acceptance/rejection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────────────────────

const { mockGetAgentServiceManager, mockGetAgentPool, mockGetAllPoolStats } = vi.hoisted(() => {
  const mockStartAgent = vi.fn(async (cfg: any) => ({
    agentId: cfg.agentId || `agent-${Date.now()}`,
    type: cfg.type,
    containerId: 'container-abc',
    port: cfg.port || 5000,
    apiUrl: 'http://localhost:5000',
    workspaceDir: cfg.workspaceDir,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    status: 'ready',
    health: 'healthy',
  }));
  const mockListAgents = vi.fn(() => []);
  const mockGetAgent = vi.fn(() => undefined);

  return {
    mockGetAgentServiceManager: vi.fn(() => ({
      startAgent: mockStartAgent,
      listAgents: mockListAgents,
      getAgent: mockGetAgent,
    })),
    mockGetAgentPool: vi.fn(() => ({
      getStats: vi.fn(() => ({ total: 2, idle: 1, busy: 1 })),
    })),
    mockGetAllPoolStats: vi.fn(() => ({})),
    mockStartAgent,
    mockListAgents,
    mockGetAgent,
  };
});

vi.mock('@/lib/spawn', () => ({
  getAgentServiceManager: mockGetAgentServiceManager,
  getAgentPool: mockGetAgentPool,
  getAllPoolStats: mockGetAllPoolStats,
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

import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/spawn/route';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function makeGetRequest(action?: string): NextRequest {
  const url = action
    ? `http://localhost:3000/api/spawn?action=${action}`
    : 'http://localhost:3000/api/spawn';
  return new NextRequest(url);
}

const VALID_AGENT_TYPES = ['claude-code', 'amp', 'opencode', 'codex'] as const;

const basePayload = {
  workspaceDir: '/workspace/test',
  apiKey: 'test-key',
};

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Spawn Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST — Agent type validation
  // ────────────────────────────────────────────────────────────────────────

  describe('POST — agent type validation', () => {
    it.each(VALID_AGENT_TYPES)('accepts "%s" as a valid agent type', async (type) => {
      const req = makeRequest({ ...basePayload, type });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.agent.type).toBe(type);
    });

    it('rejects an invalid agent type', async () => {
      const req = makeRequest({ ...basePayload, type: 'invalid-agent' });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request');
      // Zod should report the invalid enum value
      const typeError = data.details.find(
        (e: any) => e.path.join('.') === 'type',
      );
      expect(typeError).toBeDefined();
    });

    it('rejects a missing agent type', async () => {
      const req = makeRequest({ workspaceDir: '/workspace/test' });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const typeError = data.details.find(
        (e: any) => e.path.join('.') === 'type',
      );
      expect(typeError).toBeDefined();
    });

    it('specifically verifies codex is in the accepted enum', async () => {
      // This is the core regression test — codex was recently added
      const req = makeRequest({ ...basePayload, type: 'codex' });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
      expect(mockGetAgentServiceManager().startAgent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'codex' }),
      );
    });

    it('requires workspaceDir', async () => {
      const req = makeRequest({ type: 'codex' });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const wsError = data.details.find(
        (e: any) => e.path.join('.') === 'workspaceDir',
      );
      expect(wsError).toBeDefined();
    });

    it('rejects empty workspaceDir', async () => {
      const req = makeRequest({ type: 'codex', workspaceDir: '' });
      const response = await POST(req as any);

      expect(response.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST — successful agent start
  // ────────────────────────────────────────────────────────────────────────

  describe('POST — successful agent start', () => {
    it('passes all provided fields to the service manager', async () => {
      const req = makeRequest({
        type: 'codex',
        workspaceDir: '/workspace/project',
        apiKey: 'sk-123',
        port: 5555,
        agentId: 'my-codex-agent',
        env: { CODEX_VERBOSE: '1' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
      expect(mockGetAgentServiceManager().startAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'codex',
          workspaceDir: '/workspace/project',
          apiKey: 'sk-123',
          port: 5555,
          agentId: 'my-codex-agent',
          env: { CODEX_VERBOSE: '1' },
        }),
      );
    });

    it('uses pool when poolConfig is provided', async () => {
      const req = makeRequest({
        type: 'codex',
        workspaceDir: '/workspace/test',
        poolConfig: { minSize: 1, maxSize: 5 },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.pool).toBe(true);
      expect(mockGetAgentPool).toHaveBeenCalledWith('codex', expect.any(Object));
    });

    it('passes remoteAddress to pool agentConfig when both poolConfig and remoteAddress are provided', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        remoteAddress: 'https://codex.example.com:8080',
        poolConfig: { minSize: 1, maxSize: 3 },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.pool).toBe(true);
      expect(mockGetAgentPool).toHaveBeenCalledWith(
        'codex',
        expect.objectContaining({
          agentConfig: expect.objectContaining({
            remoteAddress: 'https://codex.example.com:8080',
          }),
        }),
      );
    });

    it('passes undefined remoteAddress to pool agentConfig when remoteAddress is omitted', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { minSize: 1, maxSize: 3 },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(200);
      expect(mockGetAgentPool).toHaveBeenCalledWith(
        'codex',
        expect.objectContaining({
          agentConfig: expect.objectContaining({
            remoteAddress: undefined,
          }),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST — remoteAddress field
  // ────────────────────────────────────────────────────────────────────────

  describe('POST — remoteAddress field', () => {
    it('accepts a valid remoteAddress URL', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        remoteAddress: 'https://codex.example.com:8080',
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
      expect(mockGetAgentServiceManager().startAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteAddress: 'https://codex.example.com:8080',
        }),
      );
    });

    it('accepts remoteAddress with http scheme', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'amp',
        remoteAddress: 'http://localhost:5000',
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
      expect(mockGetAgentServiceManager().startAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteAddress: 'http://localhost:5000',
        }),
      );
    });

    it('rejects an invalid remoteAddress (not a URL)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        remoteAddress: 'not-a-valid-url',
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const raError = data.details.find(
        (e: any) => e.path.join('.') === 'remoteAddress',
      );
      expect(raError).toBeDefined();
    });

    it('allows remoteAddress to be omitted (optional field)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
      expect(mockGetAgentServiceManager().startAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteAddress: undefined,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST — port validation edge cases
  // ────────────────────────────────────────────────────────────────────────

  describe('POST — port validation', () => {
    it('accepts a valid port number', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex', port: 8080 });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
      expect(mockGetAgentServiceManager().startAgent).toHaveBeenCalledWith(
        expect.objectContaining({ port: 8080 }),
      );
    });

    it('accepts port 1 (minimum valid)', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex', port: 1 });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts port 65535 (maximum valid)', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex', port: 65535 });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('rejects port 0', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex', port: 0 });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const portError = data.details.find(
        (e: any) => e.path.join('.') === 'port',
      );
      expect(portError).toBeDefined();
    });

    it('rejects negative port', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex', port: -1 });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const portError = data.details.find(
        (e: any) => e.path.join('.') === 'port',
      );
      expect(portError).toBeDefined();
    });

    it('rejects port > 65535', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex', port: 70000 });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const portError = data.details.find(
        (e: any) => e.path.join('.') === 'port',
      );
      expect(portError).toBeDefined();
    });

    it('rejects port as string type', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex', port: '8080' });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const portError = data.details.find(
        (e: any) => e.path.join('.') === 'port',
      );
      expect(portError).toBeDefined();
    });

    it('allows port to be omitted (optional field)', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex' });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST — pool config validation
  // ────────────────────────────────────────────────────────────────────────

  describe('POST — pool config validation', () => {
    it('accepts valid poolConfig with all fields', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { minSize: 1, maxSize: 5, idleTimeout: 30000 },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(200);
      const resp = await response.json();
      expect(resp.data.pool).toBe(true);
    });

    it('rejects minSize > maxSize', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { minSize: 10, maxSize: 5 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
      // Zod refine on poolConfig appends its path to the base path,
      // producing 'poolConfig.poolConfig' (or just the refine message)
      const poolError = resp.details.find(
        (e: any) =>
          e.path.join('.') === 'poolConfig' ||
          e.path.join('.') === 'poolConfig.poolConfig' ||
          e.message?.includes('minSize must be <= maxSize'),
      );
      expect(poolError).toBeDefined();
    });

    it('rejects negative minSize', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { minSize: -1 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
      const minError = resp.details.find(
        (e: any) => e.path.join('.') === 'poolConfig.minSize',
      );
      expect(minError).toBeDefined();
    });

    it('rejects maxSize of 0', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { maxSize: 0 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
      const maxError = resp.details.find(
        (e: any) => e.path.join('.') === 'poolConfig.maxSize',
      );
      expect(maxError).toBeDefined();
    });

    it('rejects negative maxSize', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { maxSize: -2 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
    });

    it('rejects minSize > 100', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { minSize: 101 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
      const minError = resp.details.find(
        (e: any) => e.path.join('.') === 'poolConfig.minSize',
      );
      expect(minError).toBeDefined();
    });

    it('rejects maxSize > 100', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { maxSize: 200 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
    });

    it('rejects idleTimeout < 1000ms', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { idleTimeout: 500 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
      const idleError = resp.details.find(
        (e: any) => e.path.join('.') === 'poolConfig.idleTimeout',
      );
      expect(idleError).toBeDefined();
    });

    it('rejects idleTimeout > 1 hour', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { idleTimeout: 4000000 },
      });
      const response = await POST(req as any);
      const resp = await response.json();

      expect(response.status).toBe(400);
    });

    it('accepts minSize equal to maxSize', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { minSize: 3, maxSize: 3 },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(200);
    });

    it('accepts minSize 0', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: { minSize: 0, maxSize: 5 },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(200);
    });

    it('accepts empty poolConfig (all fields optional)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        poolConfig: {},
      });
      const response = await POST(req as any);

      expect(response.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST — resources validation
  // ────────────────────────────────────────────────────────────────────────

  describe('POST — resources validation', () => {
    it('accepts valid resources with both cpu and memory', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: 2, memory: '512m' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
      expect(mockGetAgentServiceManager().startAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          resources: { cpu: 2, memory: '512m' },
        }),
      );
    });

    it('accepts resources with only cpu', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: 4 },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts resources with only memory', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { memory: '1g' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts empty resources object', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: {},
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('allows resources to be omitted entirely', async () => {
      const req = makeRequest({ ...basePayload, type: 'codex' });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    // CPU boundary tests

    it('accepts cpu at minimum boundary (0.1)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: 0.1 },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts cpu at maximum boundary (128)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: 128 },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('rejects cpu below minimum (0.05)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: 0.05 },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const cpuError = data.details.find(
        (e: any) => e.path.join('.') === 'resources.cpu',
      );
      expect(cpuError).toBeDefined();
    });

    it('rejects cpu of 0', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: 0 },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const cpuError = data.details.find(
        (e: any) => e.path.join('.') === 'resources.cpu',
      );
      expect(cpuError).toBeDefined();
    });

    it('rejects negative cpu', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: -1 },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const cpuError = data.details.find(
        (e: any) => e.path.join('.') === 'resources.cpu',
      );
      expect(cpuError).toBeDefined();
    });

    it('rejects cpu above maximum (129)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: 129 },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const cpuError = data.details.find(
        (e: any) => e.path.join('.') === 'resources.cpu',
      );
      expect(cpuError).toBeDefined();
    });

    it('rejects cpu as string type', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { cpu: '2' },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const cpuError = data.details.find(
        (e: any) => e.path.join('.') === 'resources.cpu',
      );
      expect(cpuError).toBeDefined();
    });

    // Memory format tests

    it('accepts memory with megabyte suffix', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { memory: '256m' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts memory with gigabyte suffix', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { memory: '4g' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts memory with kilobyte suffix', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { memory: '512k' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts memory with byte suffix', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { memory: '1024b' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('accepts memory as plain number string (no suffix)', async () => {
      // The schema defines memory as z.string(), so any string is valid.
      // The service manager's parseMemory() handles actual parsing.
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { memory: '512' },
      });
      const response = await POST(req as any);

      expect(response.status).toBe(201);
    });

    it('rejects memory as number type (must be string)', async () => {
      const req = makeRequest({
        ...basePayload,
        type: 'codex',
        resources: { memory: 512 },
      });
      const response = await POST(req as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      const memError = data.details.find(
        (e: any) => e.path.join('.') === 'resources.memory',
      );
      expect(memError).toBeDefined();
    });

    // Note: Zod's default "strip" mode silently removes unknown keys like
    // `gpu` from resources rather than rejecting them. This is intentional —
    // the schema strips unknown fields instead of erroring. No test needed.
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET — list agents / pool stats
  // ────────────────────────────────────────────────────────────────────────

  describe('GET', () => {
    it('lists agents', async () => {
      const req = makeGetRequest();
      const response = await GET(req as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.agents).toEqual([]);
      expect(mockGetAgentServiceManager().listAgents).toHaveBeenCalled();
    });

    it('returns pool stats when action=pool-stats', async () => {
      const req = makeGetRequest('pool-stats');
      const response = await GET(req as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.poolStats).toEqual({});
      expect(mockGetAllPoolStats).toHaveBeenCalled();
    });
  });
});
