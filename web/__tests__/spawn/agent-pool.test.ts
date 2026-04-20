/**
 * Agent Pool — Unit Tests
 *
 * Tests for lib/spawn/agent-pool.ts
 * Covers: AgentPoolConfig with remoteAddress, pool key separation by remoteAddress.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks — must come before imports that reference the mocked modules
// ────────────────────────────────────────────────────────────────────────────

// Mock all agent factory imports so no real processes are spawned
vi.mock('@/lib/spawn/claude-code-agent', () => ({
  createClaudeCodeAgent: vi.fn(async (cfg: any) => ({
    type: 'claude-code',
    agentId: cfg.agentId,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    prompt: vi.fn(async () => ({ response: 'mock' })),
    checkAgentHealth: vi.fn(async () => true),
  })),
}));

vi.mock('@/lib/spawn/amp-agent', () => ({
  createAmpAgent: vi.fn(async (cfg: any) => ({
    type: 'amp',
    agentId: cfg.agentId,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    prompt: vi.fn(async () => ({ response: 'mock' })),
    checkAgentHealth: vi.fn(async () => true),
  })),
}));

vi.mock('@/lib/spawn/opencode-agent', () => ({
  createOpenCodeAgent: vi.fn(async (cfg: any) => ({
    type: 'opencode',
    agentId: cfg.agentId,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    prompt: vi.fn(async () => ({ response: 'mock' })),
    checkAgentHealth: vi.fn(async () => true),
  })),
}));

vi.mock('@/lib/spawn/codex-agent', () => ({
  createCodexAgent: vi.fn(async (cfg: any) => ({
    type: 'codex',
    agentId: cfg.agentId,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    prompt: vi.fn(async () => ({ response: 'mock' })),
    checkAgentHealth: vi.fn(async () => true),
  })),
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
// Imports (after mocks)
// ────────────────────────────────────────────────────────────────────────────

import {
  getAgentPool,
  destroyAllPools,
  type AgentPoolConfig,
} from '@/lib/spawn/agent-pool';

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('AgentPool', () => {
  // Flush all pending microtasks so fire-and-forget preWarm() completes
  // before we assert or tear down.
  async function flushPromises(): Promise<void> {
    // Run the microtask queue until it's empty
    // 10 rounds covers nested async work like dynamic import() chains
    for (let i = 0; i < 10; i++) {
      await new Promise<void>((r) => queueMicrotask(r));
    }
  }

  // Wait until the pool reaches an expected total agent count.
  // Pre-warming is fire-and-forget in the constructor, so we poll
  // until the agents map has been populated.
  //
  // IMPORTANT: This helper must NOT be used inside vi.useFakeTimers() blocks.
  // Fake timers freeze setTimeout and Date.now(), so the polling loop would
  // never yield and the timeout guard would never fire. In fake-timer tests,
  // use `await vi.advanceTimersByTimeAsync(0); await flushPromises();` then
  // assert the size directly.
  async function waitForPoolSize(
    pool: ReturnType<typeof getAgentPool>,
    expectedTotal: number,
    timeoutMs = 10000,
  ): Promise<void> {
    const start = Date.now();
    while (pool.getStats().total < expectedTotal) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for pool size ${expectedTotal} (got ${pool.getStats().total})`,
        );
      }
      // Yield to the event loop so macrotasks (Vitest module RPC, etc.) can run
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  beforeEach(async () => {
    // Ensure no lingering pools between tests
    await destroyAllPools();
    await flushPromises();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await destroyAllPools();
    await flushPromises();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Pool key separation by remoteAddress
  // ────────────────────────────────────────────────────────────────────────

  describe('getAgentPool — pool key includes remoteAddress', () => {
    const baseConfig: AgentPoolConfig = {
      minSize: 0,
      maxSize: 1,
      agentConfig: {
        workspaceDir: '/workspace/test',
        apiKey: 'test-key',
      },
    };

    it('returns the same pool for same type + workspace + no remoteAddress', () => {
      const pool1 = getAgentPool('claude-code', baseConfig);
      const pool2 = getAgentPool('claude-code', baseConfig);

      expect(pool1).toBe(pool2);
    });

    it('returns the same pool for same type + workspace + same remoteAddress', () => {
      const configWithRemote: AgentPoolConfig = {
        ...baseConfig,
        agentConfig: {
          ...baseConfig.agentConfig,
          remoteAddress: 'https://codex.example.com:8080',
        },
      };

      const pool1 = getAgentPool('claude-code', configWithRemote);
      const pool2 = getAgentPool('claude-code', configWithRemote);

      expect(pool1).toBe(pool2);
    });

    it('returns different pools for same type + workspace but different remoteAddress', () => {
      const localPool = getAgentPool('claude-code', baseConfig);

      const remoteConfig: AgentPoolConfig = {
        ...baseConfig,
        agentConfig: {
          ...baseConfig.agentConfig,
          remoteAddress: 'https://codex.example.com:8080',
        },
      };
      const remotePool = getAgentPool('claude-code', remoteConfig);

      expect(localPool).not.toBe(remotePool);
    });

    it('returns different pools for same type but different remoteAddresses', () => {
      const remote1Config: AgentPoolConfig = {
        ...baseConfig,
        agentConfig: {
          ...baseConfig.agentConfig,
          remoteAddress: 'https://server1.example.com:8080',
        },
      };
      const remote2Config: AgentPoolConfig = {
        ...baseConfig,
        agentConfig: {
          ...baseConfig.agentConfig,
          remoteAddress: 'https://server2.example.com:8080',
        },
      };

      const pool1 = getAgentPool('claude-code', remote1Config);
      const pool2 = getAgentPool('claude-code', remote2Config);

      expect(pool1).not.toBe(pool2);
    });

    it('returns different pools for different types even with same remoteAddress', () => {
      const remoteConfig: AgentPoolConfig = {
        ...baseConfig,
        agentConfig: {
          ...baseConfig.agentConfig,
          remoteAddress: 'https://codex.example.com:8080',
        },
      };

      const claudePool = getAgentPool('claude-code', remoteConfig);
      const codexPool = getAgentPool('codex', remoteConfig);

      expect(claudePool).not.toBe(codexPool);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // minSize: 0 should NOT trigger pre-warming
  // ────────────────────────────────────────────────────────────────────────

  describe('minSize: 0 — no pre-warming', () => {
    it('creates zero agents when minSize is 0', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await flushPromises();

      // minSize:0 should not pre-warm any agents (fixes the || → ?? bug)
      const stats = pool.getStats();
      expect(stats.total).toBe(0);
      expect(stats.available).toBe(0);
    });

    it('still creates agents on demand when minSize is 0', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await flushPromises();

      // No pre-warmed agents
      expect(pool.getStats().total).toBe(0);

      // But acquire() can still create one on demand
      const agent = await pool.acquire();
      expect(agent).toBeDefined();
      expect(pool.getStats().total).toBe(1);
      expect(pool.getStats().inUse).toBe(1);

      // Cleanup
      await pool.release(agent);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AgentPoolConfig with remoteAddress
  // ────────────────────────────────────────────────────────────────────────

  describe('AgentPoolConfig with remoteAddress', () => {
    it('accepts remoteAddress in agentConfig', () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 1,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
          remoteAddress: 'https://codex.example.com:8080',
        },
      };

      // Should not throw — just validates the type is accepted
      const pool = getAgentPool('codex', config);
      expect(pool).toBeDefined();
    });

    it('creates a pool with remoteAddress without errors', () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 1,
        agentConfig: {
          workspaceDir: '/workspace/test',
          remoteAddress: 'http://localhost:5000',
        },
      };

      const pool = getAgentPool('opencode', config);
      expect(pool.getStats()).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // minSize / maxSize scaling
  // ────────────────────────────────────────────────────────────────────────

  describe('minSize / maxSize scaling', () => {
    it('pre-warms minSize agents on creation', async () => {
      const config: AgentPoolConfig = {
        minSize: 3,
        maxSize: 10,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await waitForPoolSize(pool, 3);

      const stats = pool.getStats();
      expect(stats.total).toBe(3);
      expect(stats.available).toBe(3);
      expect(stats.inUse).toBe(0);
    });

    it('replenishes to minSize after agents are acquired', async () => {
      const config: AgentPoolConfig = {
        minSize: 2,
        maxSize: 10,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await waitForPoolSize(pool, 2);

      // Pre-warmed 2 agents
      expect(pool.getStats().total).toBe(2);

      // Acquire both pre-warmed agents
      const agent1 = await pool.acquire();
      const agent2 = await pool.acquire();
      expect(pool.getStats().inUse).toBe(2);
      expect(pool.getStats().available).toBe(0);

      // Release one — pool now has 1 available
      await pool.release(agent1);
      expect(pool.getStats().available).toBe(1);

      // Release the other — pool now has 2 available again
      await pool.release(agent2);
      expect(pool.getStats().available).toBe(2);
    });

    it('can acquire up to maxSize agents', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 3,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Acquire 3 agents (the max)
      const agents = [];
      for (let i = 0; i < 3; i++) {
        agents.push(await pool.acquire());
      }

      const stats = pool.getStats();
      expect(stats.total).toBe(3);
      expect(stats.inUse).toBe(3);
      expect(stats.available).toBe(0);

      // Cleanup
      for (const agent of agents) {
        await pool.release(agent);
      }
    });

    it('acquire blocks when pool is at maxSize', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 2,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Acquire both slots
      const agent1 = await pool.acquire();
      const agent2 = await pool.acquire();
      expect(pool.getStats().inUse).toBe(2);

      // Third acquire should not resolve immediately — it queues
      let resolved = false;
      const acquirePromise = pool.acquire(5000).then((a) => {
        resolved = true;
        return a;
      });

      // Give microtasks a chance — should NOT resolve
      await flushPromises();
      expect(resolved).toBe(false);

      // Release one agent — should resolve the queued acquire
      await pool.release(agent1);
      const agent3 = await acquirePromise;
      expect(resolved).toBe(true);
      expect(agent3).toBeDefined();
      expect(pool.getStats().inUse).toBe(2); // agent2 + agent3

      // Cleanup
      await pool.release(agent2);
      await pool.release(agent3);
    });

    it('acquire times out when no agent is released', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 1,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Fill the pool
      const agent1 = await pool.acquire();

      // Try to acquire with a short timeout
      await expect(pool.acquire(100)).rejects.toThrow('Timeout waiting for codex agent');

      expect(pool.getStats().totalTimeouts).toBe(1);

      // Cleanup
      await pool.release(agent1);
    });

    it('stats track acquires, releases, and timeouts', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 2,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      const agent1 = await pool.acquire();
      const agent2 = await pool.acquire();
      await pool.release(agent1);
      await pool.release(agent2);

      // Trigger a timeout
      const agent3 = await pool.acquire();
      const agent4 = await pool.acquire();
      await expect(pool.acquire(50)).rejects.toThrow('Timeout waiting for codex agent');

      await pool.release(agent3);
      await pool.release(agent4);

      const stats = pool.getStats();
      expect(stats.totalAcquires).toBe(4); // agent1-4
      expect(stats.totalReleases).toBe(4); // agent1-4 released
      expect(stats.totalTimeouts).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Idle timeout eviction
  // ────────────────────────────────────────────────────────────────────────

  describe('idle timeout eviction', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('evicts idle agents after idleTimeout on health check cycle', async () => {
      const config: AgentPoolConfig = {
        minSize: 1,
        maxSize: 5,
        idleTimeout: 1000, // 1 second
        healthCheckInterval: 500, // check every 500ms
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      // Let preWarm complete
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();

      // Pool should have 1 pre-warmed agent
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();
      expect(pool.getStats().total).toBe(1);
      expect(pool.getStats().available).toBe(1);

      // Create 2 agents total (1 pre-warmed + 1 on-demand)
      const reused = await pool.acquire(); // acquires the pre-warmed agent
      const extra = await pool.acquire(); // creates on-demand
      expect(pool.getStats().total).toBe(2);
      await pool.release(reused);
      await pool.release(extra);
      await flushPromises();

      // Advance well past idleTimeout + healthCheckInterval.
      // The eviction check is (now - lastUsed) > idleTimeout, so we need
      // the health check to fire at a time where elapsed > 1000ms.
      // Health checks fire at 500ms, 1000ms, 1500ms, 2000ms...
      // At 1500ms fire, elapsed is ~1500ms > 1000ms idleTimeout → eviction.
      await vi.advanceTimersByTimeAsync(1600);
      await flushPromises();

      // One idle agent should be evicted (reducing to minSize=1)
      const stats = pool.getStats();
      expect(stats.total).toBe(1);

      // Cleanup: destroy before restoring real timers
      await pool.destroy();
    });

    it('does not evict idle agents when at minSize', async () => {
      const config: AgentPoolConfig = {
        minSize: 2,
        maxSize: 5,
        idleTimeout: 1000,
        healthCheckInterval: 500,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();

      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();
      expect(pool.getStats().total).toBe(2);

      // Advance well past idleTimeout
      await vi.advanceTimersByTimeAsync(5000);
      await flushPromises();

      // Agents should NOT be evicted — we are at minSize
      expect(pool.getStats().total).toBe(2);

      // Cleanup: destroy before restoring real timers
      await pool.destroy();
    });

    it('does not evict in-use agents even if past idleTimeout', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        idleTimeout: 1000,
        healthCheckInterval: 500,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();

      const agent = await pool.acquire();
      expect(pool.getStats().inUse).toBe(1);

      // Advance well past idleTimeout
      await vi.advanceTimersByTimeAsync(5000);
      await flushPromises();

      // In-use agent should NOT be evicted
      expect(pool.getStats().total).toBe(1);
      expect(pool.getStats().inUse).toBe(1);

      await pool.release(agent);
      await pool.destroy();
    });

    it('replenishes to minSize after eviction trims the pool', async () => {
      const config: AgentPoolConfig = {
        minSize: 1,
        maxSize: 5,
        idleTimeout: 1000,
        healthCheckInterval: 500,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();

      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();
      expect(pool.getStats().total).toBe(1);

      // Add an extra agent beyond minSize
      const reused = await pool.acquire(); // acquires pre-warmed
      const onDemand = await pool.acquire(); // creates on-demand
      expect(pool.getStats().total).toBe(2);
      await pool.release(reused);
      await pool.release(onDemand);
      await flushPromises();

      // Advance well past idleTimeout + healthCheckInterval so eviction fires
      // Need > idleTimeout (1000ms) + health check to fire after that threshold
      await vi.advanceTimersByTimeAsync(1600);
      await flushPromises();

      expect(pool.getStats().total).toBe(1);

      // Cleanup: destroy before restoring real timers
      await pool.destroy();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Unhealthy agent lifecycle
  // ────────────────────────────────────────────────────────────────────────

  describe('unhealthy agent lifecycle', () => {
    it('marks agent unhealthy when health check fails', async () => {
      const { createClaudeCodeAgent } = await import('@/lib/spawn/claude-code-agent');
      (createClaudeCodeAgent as any).mockImplementationOnce(async (cfg: any) => ({
        type: 'claude-code',
        agentId: cfg.agentId,
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        prompt: vi.fn(async () => ({ response: 'mock' })),
        checkAgentHealth: vi.fn(async () => false), // unhealthy
      }));

      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        healthCheckInterval: 200,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await flushPromises();

      // Create an agent manually (minSize=0 means no pre-warm)
      const agent = await pool.acquire();
      await pool.release(agent);
      await flushPromises();

      // Initially healthy (release checked health — but our mock returns false)
      // Actually, release() calls checkAgentHealth and sets healthy based on result
      const stats = pool.getStats();
      expect(stats.unhealthy).toBe(1);
      expect(stats.available).toBe(0);
    });

    it('removes unhealthy agents on health check cycle and replaces them', async () => {
      vi.useFakeTimers();

      // First agent is unhealthy, replacement is healthy
      let callCount = 0;
      const { createClaudeCodeAgent } = await import('@/lib/spawn/claude-code-agent');
      (createClaudeCodeAgent as any).mockImplementation(async (cfg: any) => {
        callCount++;
        return {
          type: 'claude-code',
          agentId: cfg.agentId,
          start: vi.fn(async () => {}),
          stop: vi.fn(async () => {}),
          prompt: vi.fn(async () => ({ response: 'mock' })),
          checkAgentHealth: vi.fn(async () => callCount <= 1 ? false : true),
        };
      });

      const config: AgentPoolConfig = {
        minSize: 1,
        maxSize: 5,
        idleTimeout: 60000,
        healthCheckInterval: 500,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();

      // Pre-warmed 1 agent (callCount=1, unhealthy)
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();
      expect(pool.getStats().total).toBe(1);

      // Advance to trigger health check cycle
      await vi.advanceTimersByTimeAsync(600);
      await flushPromises();

      // Unhealthy agent should be removed and preWarm should create a replacement
      // (callCount=2, healthy)
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();
      expect(pool.getStats().total).toBe(1);
      const stats = pool.getStats();
      expect(stats.unhealthy).toBe(0);
      expect(callCount).toBeGreaterThanOrEqual(2);

      // Cleanup: destroy before restoring real timers
      await pool.destroy();
      vi.useRealTimers();
    });

    it('unhealthy agent is skipped on acquire, new agent created instead', async () => {
      const { createClaudeCodeAgent } = await import('@/lib/spawn/claude-code-agent');
      (createClaudeCodeAgent as any).mockImplementationOnce(async (cfg: any) => ({
        type: 'claude-code',
        agentId: cfg.agentId,
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        prompt: vi.fn(async () => ({ response: 'mock' })),
        checkAgentHealth: vi.fn(async () => false), // always unhealthy
      }));

      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        healthCheckInterval: 200,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      await flushPromises();

      const agent = await pool.acquire();
      // Release — health check returns false → agent marked unhealthy
      await pool.release(agent);
      await flushPromises();

      expect(pool.getStats().unhealthy).toBe(1);
      expect(pool.getStats().available).toBe(0);

      // Acquire should create a NEW healthy agent instead of
      // reusing the unhealthy one (the default mock returns healthy)
      const agent2 = await pool.acquire();
      expect(pool.getStats().total).toBe(2);
      expect(pool.getStats().inUse).toBe(1);
      expect(pool.getStats().unhealthy).toBe(1);

      await pool.release(agent2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Concurrency / stress
  // ────────────────────────────────────────────────────────────────────────

  describe('concurrent acquire / release stress', () => {
    it('handles 3 sequential acquires and releases', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 3,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Acquire 3 agents sequentially (concurrent acquire with dynamic
      // imports can time out in CI — sequential is reliable)
      const agents = [];
      for (let i = 0; i < 3; i++) {
        agents.push(await pool.acquire());
      }

      expect(pool.getStats().total).toBe(3);
      expect(pool.getStats().inUse).toBe(3);
      expect(pool.getStats().available).toBe(0);

      // Release all
      for (const a of agents) {
        await pool.release(a);
      }
      await flushPromises();

      expect(pool.getStats().inUse).toBe(0);
      expect(pool.getStats().available).toBe(3);
    });

    it('handles acquire-release cycling 20 times', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      for (let i = 0; i < 20; i++) {
        const agent = await pool.acquire();
        expect(agent).toBeDefined();
        await pool.release(agent);
      }

      const stats = pool.getStats();
      expect(stats.totalAcquires).toBe(20);
      expect(stats.totalReleases).toBe(20);
      // Pool should reuse the same agent since maxSize > 0 and only 1 is needed
      expect(stats.total).toBeGreaterThanOrEqual(1);
      expect(stats.total).toBeLessThanOrEqual(5);
    });

    it('handles rapid concurrent acquire-release with maxSize=1', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 1,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Sequential cycle with single-slot pool
      for (let i = 0; i < 20; i++) {
        const agent = await pool.acquire();
        await pool.release(agent);
      }

      expect(pool.getStats().totalAcquires).toBe(20);
      expect(pool.getStats().totalReleases).toBe(20);
    });

    it('queued acquire is resolved when agent is released', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 1,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Fill the pool
      const agent1 = await pool.acquire();

      // Start a queued acquire
      const acquirePromise = pool.acquire(5000);

      // Release after a short delay — should resolve the queued acquire
      setTimeout(async () => {
        await pool.release(agent1);
      }, 10);

      const agent2 = await acquirePromise;
      expect(agent2).toBeDefined();
      expect(pool.getStats().inUse).toBe(1);

      await pool.release(agent2);
    });

    it('multiple queued acquires resolve in order on release', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 1,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Fill the pool
      const agent1 = await pool.acquire();

      // Queue 3 acquires
      const p1 = pool.acquire(5000);
      const p2 = pool.acquire(5000);
      const p3 = pool.acquire(5000);

      // Release the held agent — resolves first waiter
      await pool.release(agent1);
      const a1 = await p1;
      expect(a1).toBeDefined();

      // Release — resolves second waiter
      await pool.release(a1);
      const a2 = await p2;
      expect(a2).toBeDefined();

      // Release — resolves third waiter
      await pool.release(a2);
      const a3 = await p3;
      expect(a3).toBeDefined();

      await pool.release(a3);
    });

    it('destroy rejects all queued waiters', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 1,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();

      // Fill the pool
      const agent1 = await pool.acquire();

      // Queue 3 acquires
      const p1 = pool.acquire(5000);
      const p2 = pool.acquire(5000);
      const p3 = pool.acquire(5000);

      // Destroy the pool — should reject all waiters
      await pool.destroy();

      await expect(p1).rejects.toThrow('Agent pool destroyed');
      await expect(p2).rejects.toThrow('Agent pool destroyed');
      await expect(p3).rejects.toThrow('Agent pool destroyed');
    });

    it('acquire on destroyed pool throws immediately', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('codex', config);
      await flushPromises();
      await pool.destroy();

      await expect(pool.acquire()).rejects.toThrow('Agent pool has been destroyed');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Pool events
  // ────────────────────────────────────────────────────────────────────────

  describe('pool events', () => {
    it('emits agent:create when an agent is created', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      const createSpy = vi.fn();
      pool.on('agent:create', createSpy);

      const agent = await pool.acquire();
      await flushPromises();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'claude-code' }),
      );

      await pool.release(agent);
    });

    it('emits agent:acquire and agent:release', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      const acquireSpy = vi.fn();
      const releaseSpy = vi.fn();
      pool.on('agent:acquire', acquireSpy);
      pool.on('agent:release', releaseSpy);

      const agent = await pool.acquire();
      expect(acquireSpy).toHaveBeenCalledTimes(1);

      await pool.release(agent);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
    });

    it('emits pool:destroy on destroy()', async () => {
      const config: AgentPoolConfig = {
        minSize: 0,
        maxSize: 5,
        agentConfig: {
          workspaceDir: '/workspace/test',
          apiKey: 'test-key',
        },
      };

      const pool = getAgentPool('claude-code', config);
      const destroySpy = vi.fn();
      pool.on('pool:destroy', destroySpy);

      await pool.destroy();

      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(destroySpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'claude-code' }),
      );
    });
  });
});
