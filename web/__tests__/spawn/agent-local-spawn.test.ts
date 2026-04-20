/**
 * Agent Local Spawn — Unit Tests
 *
 * Tests for the local-binary-first spawn path in:
 * - AmpAgent (via OpenAIAgentBase)
 * - ClaudeCodeAgent
 * - CodexAgent (via OpenAIAgentBase)
 *
 * Covers: binary detection, spawn args, env injection,
 * fallback to containerized mode, and stop() cleanup.
 *
 * NOTE: waitForLocalServer is mocked (tested separately in
 * local-server-utils.test.ts) to avoid fake-timer complexities.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks — must come before imports that reference the mocked modules
// ────────────────────────────────────────────────────────────────────────────

const { mockSpawn, createMockChildProcess } = vi.hoisted(() => {
  const createMockChildProcess = () => {
    const onListeners: Record<string, Function[]> = {};
    const stdoutOnListeners: Record<string, Function[]> = {};
    const stderrOnListeners: Record<string, Function[]> = {};

    const cp = {
      pid: 12345,
      kill: vi.fn(),
      stdout: {
        on: vi.fn((_event: string, fn: Function) => {
          stdoutOnListeners[_event] = stdoutOnListeners[_event] || [];
          stdoutOnListeners[_event].push(fn);
        }),
      },
      stderr: {
        on: vi.fn((_event: string, fn: Function) => {
          stderrOnListeners[_event] = stderrOnListeners[_event] || [];
          stderrOnListeners[_event].push(fn);
        }),
      },
      on: vi.fn((_event: string, fn: Function) => {
        onListeners[_event] = onListeners[_event] || [];
        onListeners[_event].push(fn);
      }),
      _emit: (event: string, ...args: any[]) => {
        (onListeners[event] || []).forEach(fn => fn(...args));
      },
      _emitStdout: (event: string, ...args: any[]) => {
        (stdoutOnListeners[event] || []).forEach(fn => fn(...args));
      },
      _emitStderr: (event: string, ...args: any[]) => {
        (stderrOnListeners[event] || []).forEach(fn => fn(...args));
      },
    };

    return cp;
  };

  let currentCp = createMockChildProcess();
  const mockSpawn = vi.fn(() => {
    currentCp = createMockChildProcess();
    return currentCp;
  });

  return { mockSpawn, createMockChildProcess, getCurrentCp: () => currentCp };
});

// Mock binary finders
const {
  mockFindAmpBinarySync,
  mockFindCodexBinarySync,
  mockFindClaudeCodeBinarySync,
} = vi.hoisted(() => ({
  mockFindAmpBinarySync: vi.fn(() => '/usr/local/bin/amp'),
  mockFindCodexBinarySync: vi.fn(() => '/usr/local/bin/codex'),
  mockFindClaudeCodeBinarySync: vi.fn(() => '/usr/local/bin/claude'),
}));

// Mock waitForLocalServer — resolves immediately by default (tested separately)
const { mockWaitForLocalServer } = vi.hoisted(() => ({
  mockWaitForLocalServer: vi.fn(async () => {}),
}));

// Mock agent-service-manager
const { mockStartAgent, mockStopAgent, mockSubscribe } = vi.hoisted(() => ({
  mockStartAgent: vi.fn(async (opts: any) => ({
    agentId: opts.agentId || `container-${Date.now()}`,
    type: opts.type,
    containerId: 'container-abc',
    port: opts.port || 8080,
    apiUrl: 'http://container-host:8080',
    workspaceDir: opts.workspaceDir,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    status: 'ready',
    health: 'healthy',
  })),
  mockStopAgent: vi.fn(async () => {}),
  mockSubscribe: vi.fn(async function* () { yield { type: 'log', data: 'test' }; }),
}));

// ────────────────────────────────────────────────────────────────────────────
// Apply mocks
// ────────────────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('@/lib/agent-bins/find-amp-binary', () => ({
  findAmpBinarySync: mockFindAmpBinarySync,
}));

vi.mock('@/lib/agent-bins/find-codex-binary', () => ({
  findCodexBinarySync: mockFindCodexBinarySync,
}));

vi.mock('@/lib/agent-bins/find-claude-code-binary', () => ({
  findClaudeCodeBinarySync: mockFindClaudeCodeBinarySync,
}));

vi.mock('@/lib/spawn/local-server-utils', () => ({
  spawnLocalAgent: mockSpawn, // reuse the same mock
  waitForLocalServer: mockWaitForLocalServer,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@/lib/spawn/agent-service-manager', () => ({
  getAgentServiceManager: vi.fn(() => ({
    startAgent: mockStartAgent,
    stopAgent: mockStopAgent,
    subscribe: mockSubscribe,
  })),
}));

// ────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────────────────────────────────────

import { AmpAgent, type AmpConfig } from '@/lib/spawn/amp-agent';
import { CodexAgent, type CodexConfig } from '@/lib/spawn/codex-agent';
import { ClaudeCodeAgent, type ClaudeCodeConfig } from '@/lib/spawn/claude-code-agent';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Get the ChildProcess mock created by the most recent spawn call */
function lastCp() {
  return mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;
}

const defaultAmpConfig: AmpConfig = {
  apiKey: 'test-amp-key',
  workspaceDir: '/workspace',
};

const defaultCodexConfig: CodexConfig = {
  apiKey: 'test-codex-key',
  workspaceDir: '/workspace',
};

const defaultClaudeConfig: ClaudeCodeConfig = {
  apiKey: 'test-claude-key',
  workspaceDir: '/workspace',
};

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Agent Local Spawn Path', () => {
  beforeEach(() => {
    // Reset binary finders to return a path by default
    mockFindAmpBinarySync.mockReturnValue('/usr/local/bin/amp');
    mockFindCodexBinarySync.mockReturnValue('/usr/local/bin/codex');
    mockFindClaudeCodeBinarySync.mockReturnValue('/usr/local/bin/claude');
    // Health check succeeds by default
    mockWaitForLocalServer.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // AmpAgent (via OpenAIAgentBase)
  // ──────────────────────────────────────────────────────────────────────

  describe('AmpAgent — local binary', () => {
    it('spawns local binary when findAmpBinarySync returns a path', async () => {
      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      expect(mockSpawn).toHaveBeenCalled();
      const [cmd, args] = mockSpawn.mock.calls[0];
      expect(cmd).toBe('/usr/local/bin/amp');
      expect(args).toContain('serve');
      expect(args).toContain('--port');
    });

    it('passes OPENAI_API_KEY in env', async () => {
      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.env.OPENAI_API_KEY).toBe('test-amp-key');
    });

    it('uses default port 3000 when not specified', async () => {
      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('3000');
    });

    it('uses custom port when specified', async () => {
      const agent = new AmpAgent({ ...defaultAmpConfig, port: 9999 });
      await agent.start();

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('9999');
    });

    it('waits for local server health check', async () => {
      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      expect(mockWaitForLocalServer).toHaveBeenCalledWith(3000);
    });

    it('falls back to containerized mode when no binary found', async () => {
      mockFindAmpBinarySync.mockReturnValue(null);

      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockStartAgent).toHaveBeenCalled();
    });

    it('falls back to containerized mode when health check fails', async () => {
      mockWaitForLocalServer.mockRejectedValue(new Error('Local server not ready'));

      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      // Should have tried spawn first, then fallen back
      expect(mockSpawn).toHaveBeenCalled();
      expect(mockStartAgent).toHaveBeenCalled();
    });

    it('kills local subprocess on stop()', async () => {
      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      const cp = lastCp();
      await agent.stop();

      expect(cp.kill).toHaveBeenCalled();
    });

    it('does not call service manager stop for local agents', async () => {
      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      await agent.stop();

      expect(mockStopAgent).not.toHaveBeenCalled();
    });

    it('calls service manager stop for containerized agents', async () => {
      mockFindAmpBinarySync.mockReturnValue(null);

      const agent = new AmpAgent(defaultAmpConfig);
      await agent.start();

      await agent.stop();

      expect(mockStopAgent).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // CodexAgent (via OpenAIAgentBase)
  // ──────────────────────────────────────────────────────────────────────

  describe('CodexAgent — local binary', () => {
    it('spawns local binary when findCodexBinarySync returns a path', async () => {
      const agent = new CodexAgent(defaultCodexConfig);
      await agent.start();

      expect(mockSpawn).toHaveBeenCalled();
      const [cmd, args] = mockSpawn.mock.calls[0];
      expect(cmd).toBe('/usr/local/bin/codex');
      expect(args).toContain('serve');
    });

    it('passes OPENAI_API_KEY in env', async () => {
      const agent = new CodexAgent(defaultCodexConfig);
      await agent.start();

      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.env.OPENAI_API_KEY).toBe('test-codex-key');
    });

    it('uses default port 5000 when not specified', async () => {
      const agent = new CodexAgent(defaultCodexConfig);
      await agent.start();

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('5000');
    });

    it('waits for local server health check', async () => {
      const agent = new CodexAgent(defaultCodexConfig);
      await agent.start();

      expect(mockWaitForLocalServer).toHaveBeenCalledWith(5000);
    });

    it('falls back to containerized mode when no binary found', async () => {
      mockFindCodexBinarySync.mockReturnValue(null);

      const agent = new CodexAgent(defaultCodexConfig);
      await agent.start();

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockStartAgent).toHaveBeenCalled();
    });

    it('falls back to containerized mode when health check fails', async () => {
      mockWaitForLocalServer.mockRejectedValue(new Error('Local server not ready'));

      const agent = new CodexAgent(defaultCodexConfig);
      await agent.start();

      expect(mockSpawn).toHaveBeenCalled();
      expect(mockStartAgent).toHaveBeenCalled();
    });

    it('kills local subprocess on stop()', async () => {
      const agent = new CodexAgent(defaultCodexConfig);
      await agent.start();

      const cp = lastCp();
      await agent.stop();

      expect(cp.kill).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // ClaudeCodeAgent (standalone class, not using OpenAIAgentBase)
  // ──────────────────────────────────────────────────────────────────────

  describe('ClaudeCodeAgent — local binary', () => {
    it('spawns local binary when findClaudeCodeBinarySync returns a path', async () => {
      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      expect(mockSpawn).toHaveBeenCalled();
      const [cmd, args] = mockSpawn.mock.calls[0];
      expect(cmd).toBe('/usr/local/bin/claude');
      expect(args).toContain('--server');
    });

    it('passes ANTHROPIC_API_KEY in env', async () => {
      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.env.ANTHROPIC_API_KEY).toBe('test-claude-key');
    });

    it('uses default port 8080 when not specified', async () => {
      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('8080');
    });

    it('uses custom port when specified', async () => {
      const agent = new ClaudeCodeAgent({ ...defaultClaudeConfig, port: 7777 });
      await agent.start();

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('7777');
    });

    it('waits for local server health check', async () => {
      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      expect(mockWaitForLocalServer).toHaveBeenCalledWith(8080);
    });

    it('falls back to containerized mode when no binary found', async () => {
      mockFindClaudeCodeBinarySync.mockReturnValue(null);

      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockStartAgent).toHaveBeenCalled();
    });

    it('falls back to containerized mode when health check fails', async () => {
      mockWaitForLocalServer.mockRejectedValue(new Error('Local server not ready'));

      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      expect(mockSpawn).toHaveBeenCalled();
      expect(mockStartAgent).toHaveBeenCalled();
    });

    it('kills local subprocess on stop()', async () => {
      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      const cp = lastCp();
      await agent.stop();

      expect(cp.kill).toHaveBeenCalled();
    });

    it('does not call service manager stop for local agents', async () => {
      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      await agent.stop();

      expect(mockStopAgent).not.toHaveBeenCalled();
    });

    it('calls service manager stop for containerized agents', async () => {
      mockFindClaudeCodeBinarySync.mockReturnValue(null);

      const agent = new ClaudeCodeAgent(defaultClaudeConfig);
      await agent.start();

      await agent.stop();

      expect(mockStopAgent).toHaveBeenCalled();
    });

    it('passes CLAUDE_CODE_MODEL env var', async () => {
      const agent = new ClaudeCodeAgent({ ...defaultClaudeConfig, model: 'claude-opus-4' });
      await agent.start();

      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.env.CLAUDE_CODE_MODEL).toBe('claude-opus-4');
    });

    it('passes CLAUDE_CODE_SYSTEM_PROMPT when provided', async () => {
      const agent = new ClaudeCodeAgent({
        ...defaultClaudeConfig,
        systemPrompt: 'You are a code reviewer',
      });
      await agent.start();

      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.env.CLAUDE_CODE_SYSTEM_PROMPT).toBe('You are a code reviewer');
    });
  });
});
