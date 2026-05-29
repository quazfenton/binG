import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Controllable mock for generateText ────────────────────────────────────
// vi.mock is hoisted, so we can reference variables declared with `var` or
// use a getter pattern. We use a mutable reference so each test can set
// different rejection/resolution sequences.

let mockGenerateText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: any[]) => mockGenerateText(...args),
  tool: vi.fn(),
}));

vi.mock('@/lib/chat/vercel-ai-streaming', () => ({
  getVercelModel: vi.fn().mockReturnValue({ provider: 'test', modelId: 'test-model' }),
}));

vi.mock('@/lib/orchestra/stateful-agent/agents/verification', () => ({
  verifyChanges: vi.fn().mockResolvedValue({ passed: true, errors: [] }),
}));

vi.mock('@/lib/crewai/runtime/self-healing', () => ({
  SelfHealingExecutor: class {},
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: (_name: string) => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/errors/logging-utils', () => ({
  createOriginStack: () => [],
  redactArgsForLogging: (args: any) => JSON.stringify(args),
}));

import { PlanActVerifyOrchestrator } from '../plan-act-verify';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeOrchestrator() {
  return new PlanActVerifyOrchestrator({
    iterationConfig: { maxIterations: 5, maxTokens: 10000, maxDurationMs: 60000 },
    tools: [],
    executeTool: vi.fn().mockResolvedValue({ ok: true }),
  });
}

const historyWithSystem = [
  { role: 'system' as const, content: 'You are helpful.' },
  { role: 'user' as const, content: 'hello' },
  { role: 'assistant' as const, content: 'hi' },
];

const cleanHistory = [
  { role: 'user' as const, content: 'hello' },
  { role: 'assistant' as const, content: 'hi' },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('callLLM retry wrapper', () => {
  beforeEach(() => {
    mockGenerateText = vi.fn();
  });

  it('filters system messages and retries on schema validation error', async () => {
    const orchestrator = makeOrchestrator();

    // Attempt 1: throw ModelMessage[] schema error
    mockGenerateText.mockRejectedValueOnce(
      new Error('The messages do not match the ModelMessage[] schema'),
    );
    // Attempt 2: succeed after filtering
    mockGenerateText.mockResolvedValueOnce({
      text: 'success after retry',
      usage: { totalTokens: 50 },
    });

    const result = await (orchestrator as any).callLLM('test prompt', historyWithSystem);

    expect(result.text).toBe('success after retry');
    expect(result.usage.totalTokens).toBe(50);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);

    // First call must have contained the system message (proving filtering was needed)
    const firstCallMessages = mockGenerateText.mock.calls[0][0].messages;
    expect(firstCallMessages.filter((m: any) => m.role === 'system')).toHaveLength(1);

    // Second call must have zero system-role messages (proving filtering worked)
    const secondCallMessages = mockGenerateText.mock.calls[1][0].messages;
    const systemInSecond = secondCallMessages.filter((m: any) => m.role === 'system');
    expect(systemInSecond).toHaveLength(0);
  });

  it('does not retry on non-schema errors', async () => {
    const orchestrator = makeOrchestrator();

    mockGenerateText.mockRejectedValue(new Error('Network timeout: connection refused'));

    await expect(
      (orchestrator as any).callLLM('test prompt', historyWithSystem),
    ).rejects.toThrow('Network timeout');

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('throws after exactly one retry when schema error persists', async () => {
    const orchestrator = makeOrchestrator();

    const schemaError = new Error('messages do not match the ModelMessage[] schema');
    mockGenerateText.mockRejectedValue(schemaError);

    await expect(
      (orchestrator as any).callLLM('test prompt', historyWithSystem),
    ).rejects.toThrow('messages do not match');

    // Exactly 2 attempts, no more
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it('succeeds on first attempt when history has no system messages', async () => {
    const orchestrator = makeOrchestrator();

    mockGenerateText.mockResolvedValue({
      text: 'first-try success',
      usage: { totalTokens: 10 },
    });

    const result = await (orchestrator as any).callLLM('test prompt', cleanHistory);

    expect(result.text).toBe('first-try success');
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });
});
