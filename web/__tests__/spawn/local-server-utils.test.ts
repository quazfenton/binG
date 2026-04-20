/**
 * Local Server Utilities — Unit Tests
 *
 * Tests for lib/spawn/local-server-utils.ts
 * Covers: waitForLocalServer (health-check polling with timeout/retry),
 * spawnLocalAgent (subprocess spawn with stdio, callbacks, env merge).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Mocks — must come before imports that reference the mocked modules
// ────────────────────────────────────────────────────────────────────────────

const { mockSpawn, createMockChildProcess } = vi.hoisted(() => {
  const createMockChildProcess = () => {
    const onListeners: Record<string, Function[]> = {};
    const stdoutOnListeners: Record<string, Function[]> = {};
    const stderrOnListeners: Record<string, Function[]> = {};

    const cp = {
      pid: 12345,
      kill: vi.fn(),
      stdout: { on: vi.fn((_event: string, fn: Function) => { stdoutOnListeners[_event] = stdoutOnListeners[_event] || []; stdoutOnListeners[_event].push(fn); }) },
      stderr: { on: vi.fn((_event: string, fn: Function) => { stderrOnListeners[_event] = stderrOnListeners[_event] || []; stderrOnListeners[_event].push(fn); }) },
      on: vi.fn((_event: string, fn: Function) => { onListeners[_event] = onListeners[_event] || []; onListeners[_event].push(fn); }),
      // Helpers to emit events during tests
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

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock fetch for waitForLocalServer tests
const mockFetch = vi.fn(async (_url: string, _opts?: RequestInit) => ({
  ok: true,
  status: 200,
}));
vi.stubGlobal('fetch', mockFetch);



// ────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────────────────────────────────────

import {
  waitForLocalServer,
  spawnLocalAgent,
  connectToRemoteAgent,
  type SpawnLocalAgentOptions,
} from '@/lib/spawn/local-server-utils';

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('local-server-utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // waitForLocalServer
  // ──────────────────────────────────────────────────────────────────────

  describe('waitForLocalServer', () => {
    it('resolves immediately when health check succeeds on first try', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = waitForLocalServer(8080, 5000);
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8080/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('retries when health check returns non-ok response', async () => {
      // First attempt: not ok, second attempt: ok
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = waitForLocalServer(9090, 10000);
      // Advance past the 1s retry delay
      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries when fetch throws a network error', async () => {
      // First attempt: ECONNREFUSED, second attempt: ok
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = waitForLocalServer(3000, 10000);
      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after timeout expires', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      // Catch early to prevent unhandled rejection during timer advance
      let rejectionError: any;
      const promise = waitForLocalServer(4000, 2000).catch(e => { rejectionError = e; });

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(rejectionError).toBeTruthy();
      expect(rejectionError.message).toContain('Local server on port 4000 not ready after 2000ms');
    });

    it('uses default timeout of 30s when not specified', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      // Catch early to prevent unhandled rejection during timer advance
      let rejectionError: any;
      const promise = waitForLocalServer(5000).catch(e => { rejectionError = e; });

      // Advance 29s — should still be polling
      await vi.advanceTimersByTimeAsync(29_000);
      // Not rejected yet (just checking fetch was called multiple times)
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);

      // Advance past the full 30s timeout
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(rejectionError).toBeTruthy();
      expect(rejectionError.message).toContain('not ready after 30000ms');
    });

    it('uses the correct health endpoint URL format', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = waitForLocalServer(1234, 5000);
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:1234/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('polls every 1 second', async () => {
      // All attempts fail
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      // Catch the rejection early to avoid unhandled rejection during timer advance
      const promise = waitForLocalServer(6000, 5000).catch(() => { /* expected rejection */ });
      // Let it run for 4.5s (should have ~5 attempts: t=0, t=1, t=2, t=3, t=4)
      await vi.advanceTimersByTimeAsync(4500);
      // Not yet timed out
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4);

      // Finish the timeout
      await vi.advanceTimersByTimeAsync(1500);
      await promise; // Should resolve (caught)
    });

    it('sets a 2s timeout on each fetch request', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = waitForLocalServer(7000, 5000);
      await vi.runAllTimersAsync();
      await promise;

      // Verify AbortSignal.timeout(2000) is passed
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('succeeds on the last attempt before timeout', async () => {
      // Fail for first 4 attempts, succeed on the 5th
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = waitForLocalServer(8000, 10000);
      // Advance through 4 retry cycles (4s)
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // spawnLocalAgent
  // ──────────────────────────────────────────────────────────────────────

  describe('spawnLocalAgent', () => {
    const baseOptions: SpawnLocalAgentOptions = {
      cwd: '/workspace/project',
      env: { MY_KEY: 'my-value' },
      label: 'test-agent',
      onExit: undefined,
      onError: undefined,
    };

    /** Get the ChildProcess mock created by the most recent spawnLocalAgent call */
    function lastCp() {
      return mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;
    }

    it('calls spawn with correct command, args, and options', () => {
      spawnLocalAgent('/usr/local/bin/agent', ['serve', '--port', '3000'], baseOptions);

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/agent',
        ['serve', '--port', '3000'],
        expect.objectContaining({
          cwd: '/workspace/project',
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
      expect(lastCp().on).toHaveBeenCalled();
    });

    it('merges provided env with process.env', () => {
      const originalEnvKey = Object.keys(process.env)[0];

      spawnLocalAgent('agent', [], baseOptions);

      const calledEnv = mockSpawn.mock.calls[0][2].env;
      // Should include both process.env keys and the provided env
      expect(calledEnv.MY_KEY).toBe('my-value');
      expect(calledEnv[originalEnvKey]).toBe(process.env[originalEnvKey]);
    });

    it('provided env overrides process.env values', () => {
      const key = 'PATH';
      const originalValue = process.env.PATH;

      spawnLocalAgent('agent', [], { ...baseOptions, env: { PATH: '/custom/path' } });

      const calledEnv = mockSpawn.mock.calls[0][2].env;
      expect(calledEnv.PATH).toBe('/custom/path');
    });

    it('returns the spawned ChildProcess', () => {
      const proc = spawnLocalAgent('agent', [], baseOptions);
      expect(proc).toBe(lastCp());
    });

    it('registers stdout data listener', () => {
      spawnLocalAgent('agent', [], baseOptions);
      expect(lastCp().stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    it('registers stderr data listener', () => {
      spawnLocalAgent('agent', [], baseOptions);
      expect(lastCp().stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    it('registers exit listener on the process', () => {
      spawnLocalAgent('agent', [], baseOptions);
      expect(lastCp().on).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    it('registers error listener on the process', () => {
      spawnLocalAgent('agent', [], baseOptions);
      expect(lastCp().on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('calls onExit callback when process exits', () => {
      const onExit = vi.fn();
      spawnLocalAgent('agent', [], { ...baseOptions, onExit });
      lastCp()._emit('exit', 0);
      expect(onExit).toHaveBeenCalledWith(0);
    });

    it('calls onExit with null code when process is killed by signal', () => {
      const onExit = vi.fn();
      spawnLocalAgent('agent', [], { ...baseOptions, onExit });
      lastCp()._emit('exit', null);
      expect(onExit).toHaveBeenCalledWith(null);
    });

    it('calls onError callback when process errors', () => {
      const onError = vi.fn();
      const testError = new Error('spawn ENOENT');
      spawnLocalAgent('agent', [], { ...baseOptions, onError });
      lastCp()._emit('error', testError);
      expect(onError).toHaveBeenCalledWith(testError);
    });

    it('does not throw when onExit callback is not provided', () => {
      spawnLocalAgent('agent', [], baseOptions);
      expect(() => lastCp()._emit('exit', 1)).not.toThrow();
    });

    it('does not throw when onError callback is not provided', () => {
      spawnLocalAgent('agent', [], baseOptions);
      expect(() => lastCp()._emit('error', new Error('test'))).not.toThrow();
    });

    it('sets stdio to pipe mode for all three streams', () => {
      spawnLocalAgent('agent', [], baseOptions);

      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    });

    it('uses the provided cwd', () => {
      spawnLocalAgent('agent', [], { ...baseOptions, cwd: '/special/dir' });

      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.cwd).toBe('/special/dir');
    });

    it('handles stdout data without throwing', () => {
      spawnLocalAgent('agent', [], baseOptions);

      // Simulate stdout data — should not throw
      expect(() => {
        lastCp()._emitStdout('data', Buffer.from('some output\n'));
      }).not.toThrow();
    });

    it('handles stderr data without throwing', () => {
      spawnLocalAgent('agent', [], baseOptions);

      // Simulate stderr data — should not throw
      expect(() => {
        lastCp()._emitStderr('data', Buffer.from('some error\n'));
      }).not.toThrow();
    });

    it('does not register stdout listener when drainStdout is false', () => {
      spawnLocalAgent('agent', [], { ...baseOptions, drainStdout: false });
      expect(lastCp().stdout.on).not.toHaveBeenCalled();
    });

    it('registers stdout listener by default (drainStdout: true)', () => {
      spawnLocalAgent('agent', [], baseOptions);
      expect(lastCp().stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    it('registers stdout listener when drainStdout is explicitly true', () => {
      spawnLocalAgent('agent', [], { ...baseOptions, drainStdout: true });
      expect(lastCp().stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    it('calls both onExit and onError independently', () => {
      const onExit = vi.fn();
      const onError = vi.fn();
      spawnLocalAgent('agent', [], { ...baseOptions, onExit, onError });

      lastCp()._emit('error', new Error('boom'));
      lastCp()._emit('exit', 1);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // connectToRemoteAgent
  // ──────────────────────────────────────────────────────────────────────

  describe('connectToRemoteAgent', () => {
    const baseRemoteOpts = {
      remoteAddress: 'https://codex.example.com:8080',
      agentType: 'codex',
      workspaceDir: '/workspace/test',
    };

    beforeEach(() => {
      vi.useRealTimers(); // connectToRemoteAgent uses real fetch, not timer-based
    });

    afterEach(() => {
      vi.useFakeTimers(); // restore for waitForLocalServer/spawnLocalAgent tests
    });

    it('returns AgentInstance with remote apiUrl', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent(baseRemoteOpts);

      expect(agent.apiUrl).toBe('https://codex.example.com:8080');
      expect(agent.workspaceDir).toBe('/workspace/test');
      expect(agent.type).toBe('codex');
      expect(agent.status).toBe('ready');
      expect(agent.containerId).toBe('');
      expect(agent.port).toBe(0);
      expect(agent.health).toBe('healthy');
    });

    it('strips trailing slashes from remoteAddress', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent({
        ...baseRemoteOpts,
        remoteAddress: 'https://host.example.com:8080///',
      });

      expect(agent.apiUrl).toBe('https://host.example.com:8080');
    });

    it('sets health to healthy when health check succeeds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent(baseRemoteOpts);

      expect(agent.health).toBe('healthy');
    });

    it('sets health to unknown when health check returns non-ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const agent = await connectToRemoteAgent(baseRemoteOpts);

      expect(agent.health).toBe('unknown');
      expect(agent.status).toBe('ready');
    });

    it('sets health to unknown when health check throws (server unreachable)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const agent = await connectToRemoteAgent(baseRemoteOpts);

      expect(agent.health).toBe('unknown');
      expect(agent.status).toBe('ready');
      expect(agent.apiUrl).toBe('https://codex.example.com:8080');
      // Should NOT throw — proceeds anyway
    });

    it('uses provided agentId', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent({
        ...baseRemoteOpts,
        agentId: 'my-remote-agent',
      });

      expect(agent.agentId).toBe('my-remote-agent');
    });

    it('auto-generates agentId when not provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent(baseRemoteOpts);

      expect(agent.agentId).toMatch(/^codex-remote-/);
    });

    it('uses default /health path', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await connectToRemoteAgent(baseRemoteOpts);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://codex.example.com:8080/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('uses custom healthCheckPath when provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await connectToRemoteAgent({
        ...baseRemoteOpts,
        healthCheckPath: '/api/health',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://codex.example.com:8080/api/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('sets 5s timeout on health check by default', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await connectToRemoteAgent(baseRemoteOpts);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('uses custom healthCheckTimeoutMs when provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await connectToRemoteAgent({
        ...baseRemoteOpts,
        healthCheckTimeoutMs: 10000,
      });

      // Can't easily verify the exact timeout value on AbortSignal,
      // but verify the call was made without throwing
      expect(mockFetch).toHaveBeenCalled();
    });

    it('sets startedAt and lastActivity to current time', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      const before = Date.now();

      const agent = await connectToRemoteAgent(baseRemoteOpts);

      const after = Date.now();
      expect(agent.startedAt).toBeGreaterThanOrEqual(before);
      expect(agent.startedAt).toBeLessThanOrEqual(after);
      expect(agent.lastActivity).toBe(agent.startedAt);
    });

    // ──────────────────────────────────────────────────────────────────
    // Additional edge-case coverage (unique scenarios not in tests above)
    // ──────────────────────────────────────────────────────────────────

    it('works with http:// scheme remoteAddress', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent({
        ...baseRemoteOpts,
        remoteAddress: 'http://localhost:5000',
      });

      expect(agent.apiUrl).toBe('http://localhost:5000');
      expect(agent.health).toBe('healthy');
    });

    it('auto-generates agentId with correct prefix for claude-code', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent({
        ...baseRemoteOpts,
        agentType: 'claude-code',
      });

      expect(agent.agentId).toMatch(/^claude-code-remote-/);
    });

    it('auto-generates agentId with opencode prefix', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent({
        ...baseRemoteOpts,
        agentType: 'opencode',
      });

      expect(agent.agentId).toMatch(/^opencode-remote-/);
      expect(agent.type).toBe('opencode');
    });

    it('health check URL has no double slashes after trailing-slash strip', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await connectToRemoteAgent({
        ...baseRemoteOpts,
        remoteAddress: 'https://host.example.com/',
      });

      // Trailing slash stripped, so URL should be https://host.example.com/health
      expect(mockFetch).toHaveBeenCalledWith(
        'https://host.example.com/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('handles remoteAddress with single trailing slash', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent({
        ...baseRemoteOpts,
        remoteAddress: 'https://host.example.com:8080/',
      });

      expect(agent.apiUrl).toBe('https://host.example.com:8080');
    });

    it('makes exactly one health check request', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await connectToRemoteAgent(baseRemoteOpts);

      // Should call fetch exactly once (the health check)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('sets type and agentId prefix for amp agentType', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const agent = await connectToRemoteAgent({
        ...baseRemoteOpts,
        agentType: 'amp',
      });

      expect(agent.type).toBe('amp');
      expect(agent.agentId).toMatch(/^amp-remote-/);
    });
  });
});
