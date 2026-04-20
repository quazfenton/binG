/**
 * Agent Lifecycle Integration Test
 *
 * Tests the full agent lifecycle across real route handlers:
 *   POST /api/spawn          → spawn agent
 *   GET  /api/spawn/[id]     → verify agent exists
 *   POST /api/spawn/[id]     → send prompt
 *   GET  /api/spawn/[id]/events → subscribe to SSE events
 *   GET  /api/spawn          → list agents (includes spawned agent)
 *   DELETE /api/spawn/[id]   → stop agent
 *   GET  /api/spawn/[id]     → verify agent gone (404)
 *
 * Uses a shared in-memory service manager mock so that state flows
 * naturally between route handlers — just like the real runtime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Shared in-memory service manager mock
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a fresh, stateful AgentServiceManager mock for each test.
 * Agents are stored in a Map so that startAgent, getAgent, prompt,
 * subscribe, listAgents, and stopAgent all share the same state.
 */
function createServiceManager() {
  const agents = new Map<string, any>();

  return {
    agents,

    startAgent: vi.fn(async (cfg: any) => {
      const agentId = cfg.agentId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const agent = {
        agentId,
        type: cfg.type,
        containerId: 'container-mock',
        port: cfg.port || 5000,
        apiUrl: cfg.remoteAddress || `http://localhost:${cfg.port || 5000}`,
        workspaceDir: cfg.workspaceDir,
        startedAt: Date.now(),
        lastActivity: Date.now(),
        status: 'ready',
        health: 'healthy',
      };
      agents.set(agentId, agent);
      return agent;
    }),

    getAgent: vi.fn((id: string) => agents.get(id) || undefined),

    listAgents: vi.fn(() => Array.from(agents.values())),

    prompt: vi.fn(async (id: string, req: any) => {
      const agent = agents.get(id);
      if (!agent) throw new Error(`Agent ${id} not found`);
      agent.status = 'busy';
      agent.lastActivity = Date.now();
      // Simulate async work
      const result = {
        response: `Echo: ${req.message}`,
        duration: 50,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      };
      agent.status = 'idle';
      agent.lastActivity = Date.now();
      return result;
    }),

    subscribe: vi.fn(async (id: string) => {
      const agent = agents.get(id);
      if (!agent) throw new Error(`Agent ${id} not found`);

      // Yield a few synthetic events then complete
      async function* eventGenerator() {
        yield { type: 'message', data: { text: `agent ${id} event 1` } };
        yield { type: 'status_change', data: { status: 'idle' } };
      }
      return eventGenerator();
    }),

    stopAgent: vi.fn(async (id: string) => {
      const agent = agents.get(id);
      if (!agent) return;
      agent.status = 'stopping';
      agents.delete(id);
    }),
  };
}

let serviceManager: ReturnType<typeof createServiceManager>;

const { mockGetAgentServiceManager, mockGetAgentPool, mockGetAllPoolStats } =
  vi.hoisted(() => ({
    mockGetAgentServiceManager: vi.fn(),
    mockGetAgentPool: vi.fn(() => ({
      getStats: vi.fn(() => ({ total: 2, idle: 1, busy: 1 })),
    })),
    mockGetAllPoolStats: vi.fn(() => ({})),
  }));

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

// Auth mocks for events route
vi.mock('@/lib/auth0', () => ({
  auth0: {
    getSession: vi.fn(async () => ({
      user: { sub: 'auth0|lifecycle-test' },
    })),
  },
}));

vi.mock('@/lib/oauth/connections', () => ({
  getLocalUserIdFromAuth0: vi.fn(async () => 42),
}));

// ────────────────────────────────────────────────────────────────────────────
// Import route handlers AFTER mocks
// ────────────────────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server';
import { POST as spawnPOST, GET as spawnGET } from '@/app/api/spawn/route';
import { GET as agentGET, POST as agentPOST, DELETE as agentDELETE } from '@/app/api/spawn/[id]/route';
import { GET as eventsGET } from '@/app/api/spawn/[id]/events/route';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeSpawnRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function makeListRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/spawn');
}

function makeIdGetRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/spawn/${id}`, {
    method: 'GET',
  }) as unknown as Request;
}

function makeIdPostRequest(id: string, body: Record<string, unknown>): Request {
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

function makeEventsRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/spawn/${id}/events`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }) as unknown as Request;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Agent Lifecycle Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceManager = createServiceManager();
    mockGetAgentServiceManager.mockReturnValue(serviceManager);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Happy-path lifecycle: spawn → get → prompt → events → delete → 404
  // ────────────────────────────────────────────────────────────────────────

  it('completes the full agent lifecycle', async () => {
    // ── Step 1: Spawn an agent ──────────────────────────────────────────
    const spawnReq = makeSpawnRequest({
      type: 'codex',
      workspaceDir: '/workspace/lifecycle-test',
      apiKey: 'test-key',
    });
    const spawnResp = await spawnPOST(spawnReq as any);
    expect(spawnResp.status).toBe(201);

    const spawnData = await spawnResp.json();
    expect(spawnData.success).toBe(true);
    expect(spawnData.data.agent.type).toBe('codex');
    expect(spawnData.data.agent.status).toBe('ready');

    const agentId = spawnData.data.agent.agentId;
    expect(agentId).toBeTruthy();

    // ── Step 2: Verify agent exists via GET ─────────────────────────────
    const getResp = await agentGET(makeIdGetRequest(agentId) as any, params(agentId));
    expect(getResp.status).toBe(200);

    const getData = await getResp.json();
    expect(getData.success).toBe(true);
    expect(getData.data.agent.agentId).toBe(agentId);
    expect(getData.data.agent.workspaceDir).toBe('/workspace/lifecycle-test');

    // ── Step 3: List agents — should include our agent ──────────────────
    const listResp = await spawnGET(makeListRequest() as any);
    expect(listResp.status).toBe(200);

    const listData = await listResp.json();
    expect(listData.data.agents.length).toBeGreaterThanOrEqual(1);
    const found = listData.data.agents.find((a: any) => a.agentId === agentId);
    expect(found).toBeDefined();
    expect(found.type).toBe('codex');

    // ── Step 4: Send a prompt ───────────────────────────────────────────
    const promptResp = await agentPOST(
      makeIdPostRequest(agentId, { message: 'Hello, agent!' }) as any,
      params(agentId),
    );
    expect(promptResp.status).toBe(200);

    const promptData = await promptResp.json();
    expect(promptData.success).toBe(true);
    expect(promptData.data.result.response).toContain('Hello, agent!');
    expect(promptData.data.result.usage.totalTokens).toBe(30);

    // ── Step 5: Subscribe to SSE events ────────────────────────────────
    const eventsResp = await eventsGET(
      makeEventsRequest(agentId) as any,
      params(agentId),
    );
    expect(eventsResp.status).toBe(200);
    expect(eventsResp.headers.get('Content-Type')).toBe('text/event-stream');

    // Read the stream
    const reader = eventsResp.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    const dataLines = fullText.split('\n').filter(l => l.startsWith('data: '));
    expect(dataLines.length).toBeGreaterThanOrEqual(1);
    // First event should reference our agent
    const firstEvent = JSON.parse(dataLines[0].slice(6));
    expect(firstEvent.type).toBe('message');

    // ── Step 6: Delete the agent ────────────────────────────────────────
    const deleteResp = await agentDELETE(makeDeleteRequest(agentId) as any, params(agentId));
    expect(deleteResp.status).toBe(200);

    const deleteData = await deleteResp.json();
    expect(deleteData.success).toBe(true);
    expect(deleteData.message).toContain(agentId);

    // ── Step 7: Verify agent is gone ────────────────────────────────────
    const goneResp = await agentGET(makeIdGetRequest(agentId) as any, params(agentId));
    expect(goneResp.status).toBe(404);

    const goneData = await goneResp.json();
    expect(goneData.error).toBe('Agent not found');
  });

  // ────────────────────────────────────────────────────────────────────────
  // Multi-agent lifecycle
  // ────────────────────────────────────────────────────────────────────────

  it('manages multiple agents concurrently and deletes them independently', async () => {
    // Spawn two agents of different types
    const spawn1 = await spawnPOST(
      makeSpawnRequest({
        type: 'codex',
        workspaceDir: '/workspace/project-a',
        apiKey: 'key-a',
      }) as any,
    );
    const spawn2 = await spawnPOST(
      makeSpawnRequest({
        type: 'claude-code',
        workspaceDir: '/workspace/project-b',
        apiKey: 'key-b',
      }) as any,
    );

    expect(spawn1.status).toBe(201);
    expect(spawn2.status).toBe(201);

    const id1 = (await spawn1.json()).data.agent.agentId;
    const id2 = (await spawn2.json()).data.agent.agentId;
    expect(id1).not.toBe(id2);

    // List should show both
    const listResp = await spawnGET(makeListRequest() as any);
    const listData = await listResp.json();
    expect(listData.data.agents.length).toBe(2);

    // Prompt agent 1
    const prompt1 = await agentPOST(
      makeIdPostRequest(id1, { message: 'Task A' }) as any,
      params(id1),
    );
    expect(prompt1.status).toBe(200);
    expect((await prompt1.json()).data.result.response).toContain('Task A');

    // Prompt agent 2
    const prompt2 = await agentPOST(
      makeIdPostRequest(id2, { message: 'Task B' }) as any,
      params(id2),
    );
    expect(prompt2.status).toBe(200);
    expect((await prompt2.json()).data.result.response).toContain('Task B');

    // Delete agent 1 — agent 2 should still be accessible
    await agentDELETE(makeDeleteRequest(id1) as any, params(id1));

    const gone1 = await agentGET(makeIdGetRequest(id1) as any, params(id1));
    expect(gone1.status).toBe(404);

    const still2 = await agentGET(makeIdGetRequest(id2) as any, params(id2));
    expect(still2.status).toBe(200);
    expect((await still2.json()).data.agent.agentId).toBe(id2);

    // Delete agent 2
    await agentDELETE(makeDeleteRequest(id2) as any, params(id2));

    // List should be empty
    const finalList = await spawnGET(makeListRequest() as any);
    const finalData = await finalList.json();
    expect(finalData.data.agents.length).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Prompt after stop fails gracefully
  // ────────────────────────────────────────────────────────────────────────

  it('returns 404 when prompting a stopped agent', async () => {
    const spawnResp = await spawnPOST(
      makeSpawnRequest({
        type: 'opencode',
        workspaceDir: '/workspace/stale',
        apiKey: 'test',
      }) as any,
    );
    const id = (await spawnResp.json()).data.agent.agentId;

    // Stop the agent
    await agentDELETE(makeDeleteRequest(id) as any, params(id));

    // Attempt to prompt should 404
    const promptResp = await agentPOST(
      makeIdPostRequest(id, { message: 'Still there?' }) as any,
      params(id),
    );
    expect(promptResp.status).toBe(404);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Events after stop fails gracefully
  // ────────────────────────────────────────────────────────────────────────

  it('returns 404 when subscribing to events of a stopped agent', async () => {
    const spawnResp = await spawnPOST(
      makeSpawnRequest({
        type: 'amp',
        workspaceDir: '/workspace/gone',
        apiKey: 'test',
      }) as any,
    );
    const id = (await spawnResp.json()).data.agent.agentId;

    // Stop the agent
    await agentDELETE(makeDeleteRequest(id) as any, params(id));

    // Events should 404
    const eventsResp = await eventsGET(
      makeEventsRequest(id) as any,
      params(id),
    );
    expect(eventsResp.status).toBe(404);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Double-delete is idempotent (404 on second attempt)
  // ────────────────────────────────────────────────────────────────────────

  it('returns 404 on second delete of the same agent', async () => {
    const spawnResp = await spawnPOST(
      makeSpawnRequest({
        type: 'codex',
        workspaceDir: '/workspace/double-delete',
        apiKey: 'test',
      }) as any,
    );
    const id = (await spawnResp.json()).data.agent.agentId;

    // First delete succeeds
    const del1 = await agentDELETE(makeDeleteRequest(id) as any, params(id));
    expect(del1.status).toBe(200);

    // Second delete returns 404
    const del2 = await agentDELETE(makeDeleteRequest(id) as any, params(id));
    expect(del2.status).toBe(404);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Remote address agent lifecycle
  // ────────────────────────────────────────────────────────────────────────

  it('lifecycle works with a remoteAddress agent', async () => {
    const spawnResp = await spawnPOST(
      makeSpawnRequest({
        type: 'codex',
        workspaceDir: '/workspace/remote',
        apiKey: 'test',
        remoteAddress: 'https://codex.cloud.example.com:8080',
      }) as any,
    );
    expect(spawnResp.status).toBe(201);

    const { data } = await spawnResp.json();
    const id = data.agent.agentId;
    expect(data.agent.apiUrl).toBe('https://codex.cloud.example.com:8080');

    // GET should return the remote agent
    const getResp = await agentGET(makeIdGetRequest(id) as any, params(id));
    expect(getResp.status).toBe(200);
    const agent = (await getResp.json()).data.agent;
    expect(agent.apiUrl).toBe('https://codex.cloud.example.com:8080');

    // Prompt should work through the remote endpoint
    const promptResp = await agentPOST(
      makeIdPostRequest(id, { message: 'Remote hello' }) as any,
      params(id),
    );
    expect(promptResp.status).toBe(200);
    expect((await promptResp.json()).data.result.response).toContain('Remote hello');

    // Delete
    const delResp = await agentDELETE(makeDeleteRequest(id) as any, params(id));
    expect(delResp.status).toBe(200);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Custom agentId round-trip
  // ────────────────────────────────────────────────────────────────────────

  it('preserves a custom agentId through the full lifecycle', async () => {
    const customId = 'my-custom-agent-42';

    const spawnResp = await spawnPOST(
      makeSpawnRequest({
        type: 'codex',
        workspaceDir: '/workspace/custom-id',
        apiKey: 'test',
        agentId: customId,
      }) as any,
    );
    expect(spawnResp.status).toBe(201);

    const spawnData = await spawnResp.json();
    expect(spawnData.data.agent.agentId).toBe(customId);

    // GET by custom ID
    const getResp = await agentGET(makeIdGetRequest(customId) as any, params(customId));
    expect(getResp.status).toBe(200);
    expect((await getResp.json()).data.agent.agentId).toBe(customId);

    // Prompt by custom ID
    const promptResp = await agentPOST(
      makeIdPostRequest(customId, { message: 'Custom ID test' }) as any,
      params(customId),
    );
    expect(promptResp.status).toBe(200);

    // Delete by custom ID
    const delResp = await agentDELETE(makeDeleteRequest(customId) as any, params(customId));
    expect(delResp.status).toBe(200);

    // Gone
    const goneResp = await agentGET(makeIdGetRequest(customId) as any, params(customId));
    expect(goneResp.status).toBe(404);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Spawn-prompt-delete stress (sequential)
  // ────────────────────────────────────────────────────────────────────────

  it('handles 5 sequential spawn-prompt-delete cycles without state leaks', async () => {
    for (let i = 0; i < 5; i++) {
      const spawnResp = await spawnPOST(
        makeSpawnRequest({
          type: 'codex',
          workspaceDir: `/workspace/stress-${i}`,
          apiKey: 'test',
        }) as any,
      );
      expect(spawnResp.status).toBe(201);
      const id = (await spawnResp.json()).data.agent.agentId;

      const promptResp = await agentPOST(
        makeIdPostRequest(id, { message: `Round ${i}` }) as any,
        params(id),
      );
      expect(promptResp.status).toBe(200);
      expect((await promptResp.json()).data.result.response).toContain(`Round ${i}`);

      const delResp = await agentDELETE(makeDeleteRequest(id) as any, params(id));
      expect(delResp.status).toBe(200);

      // Verify cleanup
      const gone = await agentGET(makeIdGetRequest(id) as any, params(id));
      expect(gone.status).toBe(404);
    }

    // Final list should be empty
    const listResp = await spawnGET(makeListRequest() as any);
    expect((await listResp.json()).data.agents.length).toBe(0);
  });
});
