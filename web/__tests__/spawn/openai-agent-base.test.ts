/**
 * OpenAIAgentBase — Unit Tests
 *
 * Tests the shared base class for OpenAI-based coding agents (Amp, Codex).
 * Uses a minimal concrete subclass to exercise the abstract class logic.
 *
 * Covers:
 * - Constructor (default config merging, descriptor storage)
 * - start(): local binary found → spawn + health check
 * - start(): local binary spawn fails → containerized fallback
 * - start(): no binary → containerized mode
 * - stop(): kills local subprocess, clears references
 * - stop(): stops containerized agent via service manager
 * - prompt(): success with content, tool calls, usage
 * - prompt(): API error handling
 * - prompt(): throws when agent not started
 * - extractFileChanges(): write_file / edit_file tool calls
 * - Session management (getSessionMessages, clearSession)
 * - subscribe(): success and not-started error
 * - Convenience methods (generateCode, reviewCode, generateTests, refactorCode)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OpenAIAgentBase, OpenAIAgentConfig, OpenAIAgentDescriptor, OpenAIAgentTool } from '@/lib/spawn/openai-agent-base';

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────────────────────

const { mockSpawnLocalAgent, mockWaitForLocalServer, mockConnectToRemoteAgent } = vi.hoisted(() => {
  const mockCp = {
    pid: 42,
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  };
  return {
    mockSpawnLocalAgent: vi.fn(() => mockCp),
    mockWaitForLocalServer: vi.fn(async () => {}),
    mockConnectToRemoteAgent: vi.fn(async (opts: any) => ({
      agentId: opts.agentId || `${opts.agentType}-remote-${Date.now()}`,
      type: opts.agentType,
      containerId: '',
      port: 0,
      apiUrl: opts.remoteAddress.replace(/\/+$/, ''),
      workspaceDir: opts.workspaceDir,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      status: 'ready',
      health: 'healthy',
    })),
    mockCp,
  };
});

const { mockGetAgentServiceManager } = vi.hoisted(() => {
  const mockStartAgent = vi.fn(async (cfg: any) => ({
    agentId: cfg.agentId || `container-${Date.now()}`,
    type: cfg.type,
    containerId: 'container-abc',
    port: cfg.port || 3000,
    apiUrl: 'http://container-host:3000',
    workspaceDir: cfg.workspaceDir,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    status: 'ready',
    health: 'healthy',
  }));
  const mockStopAgent = vi.fn(async () => {});
  const mockSubscribe = vi.fn(async () => (async function* () { yield { type: 'message', agentId: 'test', timestamp: Date.now(), data: {} }; })());

  return {
    mockGetAgentServiceManager: vi.fn(() => ({
      startAgent: mockStartAgent,
      stopAgent: mockStopAgent,
      subscribe: mockSubscribe,
    })),
    mockStartAgent,
    mockStopAgent,
    mockSubscribe,
  };
});

// Mock modules
vi.mock('@/lib/spawn/local-server-utils', () => ({
  spawnLocalAgent: mockSpawnLocalAgent,
  waitForLocalServer: mockWaitForLocalServer,
  connectToRemoteAgent: mockConnectToRemoteAgent,
}));

vi.mock('@/lib/spawn/agent-service-manager', () => ({
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
// Import AFTER mocks are set up
// ────────────────────────────────────────────────────────────────────────────

import { OpenAIAgentBase as _OpenAIAgentBase } from '@/lib/spawn/openai-agent-base';

const OpenAIAgentBase = _OpenAIAgentBase as typeof import('@/lib/spawn/openai-agent-base').OpenAIAgentBase;

// ────────────────────────────────────────────────────────────────────────────
// Concrete test subclass
// ────────────────────────────────────────────────────────────────────────────

const TEST_TOOLS: Record<string, OpenAIAgentTool> = {
  write_file: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  edit_file: {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, diff: { type: 'string' } },
        required: ['path', 'diff'],
      },
    },
  },
};

const mockFindBinary = vi.fn(() => '/usr/local/bin/test-agent');

function makeDescriptor(overrides?: Partial<OpenAIAgentDescriptor>): OpenAIAgentDescriptor {
  return {
    agentType: 'test-agent',
    loggerLabel: 'TestAgent',
    defaultModel: 'test-model-v1',
    defaultPort: 4000,
    spawnArgs: (port: number) => ['serve', '--port', String(port)],
    findBinary: mockFindBinary,
    tools: TEST_TOOLS,
    promptRole: 'user',
    envPrefix: 'TEST',
    ...overrides,
  };
}

class TestAgent extends (OpenAIAgentBase as any)<OpenAIAgentConfig> {
  constructor(desc: OpenAIAgentDescriptor, config: OpenAIAgentConfig) {
    super(desc, config);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<OpenAIAgentConfig>): OpenAIAgentConfig {
  return {
    apiKey: 'test-api-key',
    workspaceDir: '/workspace/test',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────────────

describe('OpenAIAgentBase', () => {
  let mockFetch: typeof fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn() as any;
    vi.stubGlobal('fetch', mockFetch);

    mockFindBinary.mockReturnValue('/usr/local/bin/test-agent');
    mockSpawnLocalAgent.mockReturnValue({
      pid: 42,
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    });
    mockWaitForLocalServer.mockResolvedValue(undefined);
    mockGetAgentServiceManager.mockReturnValue({
      startAgent: vi.fn(async (cfg: any) => ({
        agentId: cfg.agentId || `container-${Date.now()}`,
        type: cfg.type,
        containerId: 'container-abc',
        port: cfg.port || 3000,
        apiUrl: 'http://container-host:3000',
        workspaceDir: cfg.workspaceDir,
        startedAt: Date.now(),
        lastActivity: Date.now(),
        status: 'ready',
        health: 'healthy',
      })),
      stopAgent: vi.fn(async () => {}),
      subscribe: vi.fn(async () => (async function* () {})()),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('merges config defaults from descriptor', () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      // model defaults to desc.defaultModel
      expect(agent.config.model).toBe('test-model-v1');
      // maxTokens defaults to 4096
      expect(agent.config.maxTokens).toBe(4096);
      // temperature defaults to 0.7
      expect(agent.config.temperature).toBeCloseTo(0.7);
    });

    it('keeps explicit config values over descriptor defaults', () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        model: 'custom-model',
        maxTokens: 8192,
        temperature: 0.3,
      }));
      expect(agent.config.model).toBe('custom-model');
      expect(agent.config.maxTokens).toBe(8192);
      expect(agent.config.temperature).toBeCloseTo(0.3);
    });

    it('stores the descriptor', () => {
      const desc = makeDescriptor();
      const agent = new TestAgent(desc, makeConfig());
      expect(agent.desc).toBe(desc);
    });

    it('starts with empty session messages', () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      expect(agent.getSessionMessages()).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // start() — local binary path
  // ────────────────────────────────────────────────────────────────────────

  describe('start() — local binary path', () => {
    it('finds local binary and spawns it', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      expect(mockFindBinary).toHaveBeenCalled();
      expect(mockSpawnLocalAgent).toHaveBeenCalledWith(
        '/usr/local/bin/test-agent',
        ['serve', '--port', '4000'],
        expect.objectContaining({
          cwd: '/workspace/test',
          label: 'test-agent',
        }),
      );
    });

    it('passes env vars with the configured prefix', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      const spawnOpts = mockSpawnLocalAgent.mock.calls[0][2];
      expect(spawnOpts.env).toEqual(expect.objectContaining({
        TEST_API_KEY: 'test-api-key',
        TEST_MODEL: 'test-model-v1',
        TEST_MAX_TOKENS: '4096',
        TEST_TEMPERATURE: '0.7',
      }));
    });

    it('passes system prompt env var when systemPrompt is set', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({ systemPrompt: 'Be helpful' }));
      await agent.start();

      const spawnOpts = mockSpawnLocalAgent.mock.calls[0][2];
      expect(spawnOpts.env).toEqual(expect.objectContaining({
        TEST_SYSTEM_PROMPT: 'Be helpful',
      }));
    });

    it('waits for the local server to be ready', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      expect(mockWaitForLocalServer).toHaveBeenCalledWith(4000);
    });

    it('uses configured port over default port', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({ port: 5555 }));
      await agent.start();

      expect(mockSpawnLocalAgent).toHaveBeenCalledWith(
        expect.any(String),
        ['serve', '--port', '5555'],
        expect.any(Object),
      );
      expect(mockWaitForLocalServer).toHaveBeenCalledWith(5555);
    });

    it('creates a synthetic AgentInstance with local binary info', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({ agentId: 'my-agent' }));
      await agent.start();

      expect(agent.agent).toEqual(expect.objectContaining({
        agentId: 'my-agent',
        type: 'test-agent',
        port: 4000,
        apiUrl: 'http://127.0.0.1:4000',
        workspaceDir: '/workspace/test',
        status: 'ready',
        health: 'healthy',
      }));
    });

    it('auto-generates agentId when not provided', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      expect(agent.agent?.agentId).toMatch(/^test-agent-local-/);
    });

    it('registers onExit and onError callbacks that clear localProcess', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      const spawnOpts = mockSpawnLocalAgent.mock.calls[0][2];
      expect(spawnOpts.onExit).toBeInstanceOf(Function);
      expect(spawnOpts.onError).toBeInstanceOf(Function);

      // Simulate exit — should clear localProcess
      spawnOpts.onExit(0);
      expect(agent.localProcess).toBeUndefined();

      // Reset for error test
      await agent.start();
      const spawnOpts2 = mockSpawnLocalAgent.mock.calls[1][2];
      spawnOpts2.onError(new Error('crash'));
      expect(agent.localProcess).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // start() — fallback to containerized mode
  // ────────────────────────────────────────────────────────────────────────

  describe('start() — containerized fallback', () => {
    it('falls back when no local binary is found', async () => {
      mockFindBinary.mockReturnValue(null);
      const agent = new TestAgent(makeDescriptor(), makeConfig());

      await agent.start();

      expect(mockSpawnLocalAgent).not.toHaveBeenCalled();
      const manager = mockGetAgentServiceManager();
      expect(manager.startAgent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'test-agent',
        workspaceDir: '/workspace/test',
        apiKey: 'test-api-key',
      }));
    });

    it('falls back when local spawn fails (waitForLocalServer rejects)', async () => {
      mockWaitForLocalServer.mockRejectedValue(new Error('timeout'));
      const agent = new TestAgent(makeDescriptor(), makeConfig());

      await agent.start();

      // Should have tried local first, then fallen back
      expect(mockSpawnLocalAgent).toHaveBeenCalled();
      const manager = mockGetAgentServiceManager();
      expect(manager.startAgent).toHaveBeenCalled();
    });

    it('cleans up local process on spawn failure before falling back', async () => {
      mockWaitForLocalServer.mockRejectedValue(new Error('timeout'));
      const agent = new TestAgent(makeDescriptor(), makeConfig());

      await agent.start();

      // localProcess and localPort should be cleared after failure
      expect(agent.localProcess).toBeUndefined();
      expect(agent.localPort).toBeUndefined();
    });

    it('passes env vars to containerized mode too', async () => {
      mockFindBinary.mockReturnValue(null);
      const agent = new TestAgent(makeDescriptor(), makeConfig());

      await agent.start();

      const manager = mockGetAgentServiceManager();
      expect(manager.startAgent).toHaveBeenCalledWith(expect.objectContaining({
        env: expect.objectContaining({
          TEST_MODEL: 'test-model-v1',
          TEST_MAX_TOKENS: '4096',
          TEST_TEMPERATURE: '0.7',
        }),
      }));
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // start() — remote address path
  // ────────────────────────────────────────────────────────────────────────

  describe('start() — remote address path', () => {
    it('connects to remote server when remoteAddress is set', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        remoteAddress: 'https://codex.example.com:8080',
      }));
      await agent.start();

      // Should NOT try local binary or containerized fallback
      expect(mockFindBinary).not.toHaveBeenCalled();
      expect(mockSpawnLocalAgent).not.toHaveBeenCalled();
      expect(mockGetAgentServiceManager().startAgent).not.toHaveBeenCalled();

      // Should call connectToRemoteAgent with correct args
      expect(mockConnectToRemoteAgent).toHaveBeenCalledWith({
        remoteAddress: 'https://codex.example.com:8080',
        agentType: 'test-agent',
        agentId: undefined,
        workspaceDir: '/workspace/test',
      });
    });

    it('uses provided agentId for remote connection', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        remoteAddress: 'https://codex.example.com:8080',
        agentId: 'my-remote-agent',
      }));
      await agent.start();

      expect(mockConnectToRemoteAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'my-remote-agent' }),
      );
    });

    it('sets agent instance from connectToRemoteAgent result', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        remoteAddress: 'https://codex.example.com:8080',
      }));
      await agent.start();

      expect(agent.agent).toEqual(expect.objectContaining({
        apiUrl: 'https://codex.example.com:8080',
        type: 'test-agent',
        workspaceDir: '/workspace/test',
        status: 'ready',
        containerId: '',
        port: 0,
      }));
    });

    it('skips local binary search entirely for remote agents', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        remoteAddress: 'https://remote.host:5000',
      }));
      await agent.start();

      // findBinary should never be called
      expect(mockFindBinary).not.toHaveBeenCalled();
      // waitForLocalServer should never be called
      expect(mockWaitForLocalServer).not.toHaveBeenCalled();
    });

    it('stops remote agent by clearing the agent reference', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        remoteAddress: 'https://codex.example.com:8080',
      }));
      await agent.start();
      expect(agent.agent).toBeDefined();

      await agent.stop();
      expect(agent.agent).toBeUndefined();
    });

    it('does not call service manager stopAgent for remote agents', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        remoteAddress: 'https://codex.example.com:8080',
      }));
      await agent.start();
      await agent.stop();

      // Remote agents have containerId = '' (falsy) — should NOT call stopAgent
      const manager = mockGetAgentServiceManager();
      expect(manager.stopAgent).not.toHaveBeenCalled();
    });

    it('sends prompt() to the remote apiUrl', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig({
        remoteAddress: 'https://codex.example.com:8080',
      }));
      await agent.start();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Remote response', role: 'assistant' } }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      });

      await agent.prompt({ message: 'Hello remote' });

      // The fetch URL should use the remote apiUrl, not localhost
      expect(mockFetch).toHaveBeenCalledWith(
        'https://codex.example.com:8080/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
          }),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // stop()
  // ────────────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('kills local subprocess and clears references', async () => {
      const mockKill = vi.fn();
      mockSpawnLocalAgent.mockReturnValue({
        pid: 42,
        kill: mockKill,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      });

      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();
      expect(agent.localProcess).toBeDefined();
      expect(agent.localPort).toBe(4000);

      await agent.stop();

      expect(mockKill).toHaveBeenCalled();
      expect(agent.localProcess).toBeUndefined();
      expect(agent.localPort).toBeUndefined();
      expect(agent.agent).toBeUndefined();
    });

    it('stops containerized agent via service manager', async () => {
      mockFindBinary.mockReturnValue(null);
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      const manager = mockGetAgentServiceManager();
      const agentId = agent.agent?.agentId;

      await agent.stop();

      expect(manager.stopAgent).toHaveBeenCalledWith(agentId);
      expect(agent.agent).toBeUndefined();
    });

    it('does not call service manager for local agents (no containerId)', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      await agent.stop();

      const manager = mockGetAgentServiceManager();
      // Local agents have containerId = '' (falsy) — should NOT call stopAgent
      expect(manager.stopAgent).not.toHaveBeenCalled();
    });

    it('clears session messages on stop', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      // Simulate some session state
      agent.sessionMessages.push({ role: 'user', content: 'hello' } as any);
      expect(agent.getSessionMessages().length).toBe(1);

      await agent.stop();
      expect(agent.getSessionMessages()).toEqual([]);
    });

    it('is a no-op when agent was never started', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      // Should not throw
      await expect(agent.stop()).resolves.toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // prompt()
  // ────────────────────────────────────────────────────────────────────────

  describe('prompt()', () => {
    let agent: InstanceType<typeof TestAgent>;

    beforeEach(async () => {
      agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();
    });

    it('throws when agent is not started', async () => {
      const unstarted = new TestAgent(makeDescriptor(), makeConfig());
      await expect(unstarted.prompt({ message: 'hi' })).rejects.toThrow('not started');
    });

    it('sends POST to /v1/chat/completions with correct payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Hello!', role: 'assistant' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      await agent.prompt({ message: 'Say hello' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4000/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
          }),
        }),
      );

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.model).toBe('test-model-v1');
      expect(body.max_tokens).toBe(4096);
      expect(body.temperature).toBeCloseTo(0.7);
      expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }]);
      expect(body.tools).toEqual(expect.any(Array));
    });

    it('returns content, tool calls, and usage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Created the file',
              role: 'assistant',
              tool_calls: [{
                function: { name: 'write_file', arguments: '{"path":"foo.ts","content":"x"}' },
              }],
            },
          }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
      });

      const result = await agent.prompt({ message: 'Create a file' });

      expect(result.response).toBe('Created the file');
      expect(result.toolCalls).toEqual([{
        name: 'write_file',
        arguments: { path: 'foo.ts', content: 'x' },
      }]);
      expect(result.usage).toEqual({
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('returns reasoning_content when present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: { content: 'Answer', role: 'assistant', reasoning_content: 'I thought about it' },
          }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      });

      const result = await agent.prompt({ message: 'Think' });
      expect(result.reasoning).toBe('I thought about it');
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(agent.prompt({ message: 'fail' })).rejects.toThrow('test-agent API error: 500');
    });

    it('appends messages to session history', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Reply 1', role: 'assistant' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      });

      await agent.prompt({ message: 'First' });

      const msgs = agent.getSessionMessages();
      expect(msgs.length).toBe(2);
      expect(msgs[0]).toEqual({ role: 'user', content: 'First' });
      expect(msgs[1]).toEqual({ role: 'assistant', content: 'Reply 1' });
    });

    it('uses the descriptor promptRole for user messages', async () => {
      const devDesc = makeDescriptor({ promptRole: 'developer' });
      const devAgent = new TestAgent(devDesc, makeConfig());
      await devAgent.start();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Ok', role: 'assistant' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      });

      await devAgent.prompt({ message: 'Do stuff' });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.messages[0].role).toBe('developer');
    });

    it('passes stream flag and timeout to the request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Streamed', role: 'assistant' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      });

      await agent.prompt({ message: 'Stream me', stream: true, timeout: 60000 });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.stream).toBe(true);
    });

    it('returns empty toolCalls when no tool_calls in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'No tools', role: 'assistant' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      });

      const result = await agent.prompt({ message: 'Simple' });
      expect(result.toolCalls).toBeUndefined();
    });

    it('returns filesModified from extractFileChanges', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: 'Wrote it',
              role: 'assistant',
              tool_calls: [
                { function: { name: 'write_file', arguments: '{"path":"a.ts","content":"x"}' } },
                { function: { name: 'edit_file', arguments: '{"path":"b.ts","diff":"---"}' } },
              ],
            },
          }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      });

      const result = await agent.prompt({ message: 'Edit files' });
      expect(result.filesModified).toEqual([
        { path: 'a.ts', action: 'create' },
        { path: 'b.ts', action: 'modify', diff: '---' },
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // extractFileChanges()
  // ────────────────────────────────────────────────────────────────────────

  describe('extractFileChanges()', () => {
    it('returns empty array for undefined toolCalls', () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      expect(agent.extractFileChanges(undefined)).toEqual([]);
    });

    it('filters to write_file and edit_file only', () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      const result = agent.extractFileChanges([
        { name: 'write_file', arguments: { path: 'a.ts', content: 'x' } },
        { name: 'some_other_tool', arguments: {} },
        { name: 'edit_file', arguments: { path: 'b.ts', diff: '---' } },
      ]);

      expect(result).toEqual([
        { path: 'a.ts', action: 'create' },
        { path: 'b.ts', action: 'modify', diff: '---' },
      ]);
    });

    it('maps write_file to "create" action', () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      const result = agent.extractFileChanges([
        { name: 'write_file', arguments: { path: 'new.ts' } },
      ]);
      expect(result[0].action).toBe('create');
    });

    it('maps edit_file to "modify" action', () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      const result = agent.extractFileChanges([
        { name: 'edit_file', arguments: { path: 'existing.ts', diff: '@@ ...' } },
      ]);
      expect(result[0].action).toBe('modify');
      expect(result[0].diff).toBe('@@ ...');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Session management
  // ────────────────────────────────────────────────────────────────────────

  describe('session management', () => {
    it('getSessionMessages returns a copy', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      agent.sessionMessages.push({ role: 'user', content: 'hi' } as any);
      const copy = agent.getSessionMessages();
      // Mutating the copy shouldn't affect the original
      copy.push({ role: 'assistant', content: 'hey' } as any);
      expect(agent.getSessionMessages().length).toBe(1);
    });

    it('clearSession empties messages', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      agent.sessionMessages.push({ role: 'user', content: 'hi' } as any);
      expect(agent.getSessionMessages().length).toBe(1);

      agent.clearSession();
      expect(agent.getSessionMessages()).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // subscribe()
  // ────────────────────────────────────────────────────────────────────────

  describe('subscribe()', () => {
    it('throws when agent is not started', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await expect(agent.subscribe()).rejects.toThrow('Agent not started');
    });

    it('delegates to service manager subscribe', async () => {
      const agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();

      const agentId = agent.agent?.agentId;
      await agent.subscribe();

      const manager = mockGetAgentServiceManager();
      expect(manager.subscribe).toHaveBeenCalledWith(agentId);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Convenience methods
  // ────────────────────────────────────────────────────────────────────────

  describe('convenience methods', () => {
    let agent: InstanceType<typeof TestAgent>;

    beforeEach(async () => {
      agent = new TestAgent(makeDescriptor(), makeConfig());
      await agent.start();
    });

    function mockPromptResponse(content: string) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content, role: 'assistant' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      });
    }

    it('generateCode() sends a code generation prompt', async () => {
      mockPromptResponse('const x = 1;');
      const result = await agent.generateCode('a hello world function', 'typescript');
      expect(result).toBe('const x = 1;');

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.messages[0].content).toContain('Generate code for');
      expect(body.messages[0].content).toContain('typescript');
    });

    it('reviewCode() sends a code review prompt', async () => {
      mockPromptResponse('Looks good');
      const result = await agent.reviewCode('function foo() {}', 'bar.ts');
      expect(result).toBe('Looks good');

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.messages[0].content).toContain('Review this code');
      expect(body.messages[0].content).toContain('bar.ts');
    });

    it('generateTests() sends a test generation prompt', async () => {
      mockPromptResponse('test("works", () => {});');
      const result = await agent.generateTests('function add(a,b) { return a+b; }', 'vitest');
      expect(result).toBe('test("works", () => {});');

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.messages[0].content).toContain('Generate comprehensive tests');
      expect(body.messages[0].content).toContain('vitest');
    });

    it('refactorCode() sends a refactoring prompt', async () => {
      mockPromptResponse('function better() {}');
      const result = await agent.refactorCode('function messy() {}', 'simplify');
      expect(result).toBe('function better() {}');

      const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
      expect(body.messages[0].content).toContain('Refactor this code');
      expect(body.messages[0].content).toContain('simplify');
    });
  });
});
