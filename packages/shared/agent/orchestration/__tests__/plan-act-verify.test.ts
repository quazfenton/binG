import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Controllable mock for generateText ────────────────────────────────────
// vi.mock is hoisted, so we can reference variables declared with `var` or
// use a getter pattern. We use a mutable reference so each test can set
// different rejection/resolution sequences.

let mockGenerateText = vi.fn();
let mockVerifyChanges = vi.fn().mockResolvedValue({ passed: true, errors: [] });

vi.mock('ai', () => ({
  generateText: (...args: any[]) => mockGenerateText(...args),
  tool: vi.fn(),
}));

vi.mock('@/lib/chat/vercel-ai-streaming', () => ({
  getVercelModel: vi.fn().mockReturnValue({ provider: 'test', modelId: 'test-model' }),
}));

vi.mock('@/lib/orchestra/stateful-agent/agents/verification', () => ({
  verifyChanges: (...args: any[]) => mockVerifyChanges(...args),
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

    // First call: system messages already stripped by sanitizeMessages upfront
    const firstCallMessages = mockGenerateText.mock.calls[0][0].messages;
    const userMessages = firstCallMessages.filter((m: any) => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
    expect(userMessages[userMessages.length - 1].content).toBe('test prompt');

    // Second call: also has no system messages (re-sanitize happened on retry)
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

  it('throws after retries + plain-text fallback when schema error persists', async () => {
    const orchestrator = makeOrchestrator();

    const schemaError = new Error('messages do not match the ModelMessage[] schema');
    mockGenerateText.mockRejectedValue(schemaError);

    await expect(
      (orchestrator as any).callLLM('test prompt', historyWithSystem),
    ).rejects.toThrow('messages do not match');

    // 2 retry attempts + 1 plain-text fallback = 3 calls total
    expect(mockGenerateText).toHaveBeenCalledTimes(3);

    // Verify the fallback call used plain text (no history, no tools)
    const fallbackCallArgs = mockGenerateText.mock.calls[2][0];
    expect(fallbackCallArgs.messages).toEqual([
      { role: 'user', content: 'test prompt' },
    ]);
    expect(fallbackCallArgs.tools).toBeUndefined();
    expect(fallbackCallArgs.maxOutputTokens).toBe(4000);
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

  it('passes caller workspace context through the system channel', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 5, maxTokens: 10000, maxDurationMs: 60000 },
      tools: [],
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
      systemPrompt: 'SMART_CONTEXT_SENTINEL',
    });
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { totalTokens: 1 } });

    await (orchestrator as any).callLLM('ORIGINAL_TASK_SENTINEL', historyWithSystem);

    const args = mockGenerateText.mock.calls[0][0];
    expect(args.system).toContain('SMART_CONTEXT_SENTINEL');
    expect(args.messages.some((message: any) => message.role === 'system')).toBe(false);
    expect(args.messages.at(-1)).toEqual({ role: 'user', content: 'ORIGINAL_TASK_SENTINEL' });
  });

  it('applies an adopted role to subsequent system prompts', async () => {
    const orchestrator = makeOrchestrator();
    const adopted = (orchestrator as any).adoptRole({
      role: 'reviewer',
      reason: 'Review the completed change for quality',
    });
    mockGenerateText.mockResolvedValue({ text: 'ok', usage: { totalTokens: 1 } });

    await (orchestrator as any).callLLM('next turn', []);

    expect(adopted.success).toBe(true);
    expect(mockGenerateText.mock.calls[0][0].system).toContain('### Active Expert Role');
    expect(mockGenerateText.mock.calls[0][0].system.toLowerCase()).toContain('review');
  });
});

describe('verification coverage', () => {
  it('tracks common single-file and batch write aliases', () => {
    const orchestrator = makeOrchestrator();

    expect((orchestrator as any).getModifiedPaths('write_file', { path: 'src/a.ts' })).toEqual(['src/a.ts']);
    expect((orchestrator as any).getModifiedPaths('apply_diff', { file: 'src/b.ts' })).toEqual(['src/b.ts']);
    expect((orchestrator as any).getModifiedPaths('batch_write', {
      files: [{ path: 'src/a.ts' }, { path: 'src/c.ts' }],
    })).toEqual(['src/a.ts', 'src/c.ts']);
  });
});

describe('stepHistory threading', () => {
  beforeEach(() => {
    mockGenerateText = vi.fn();
    mockVerifyChanges = vi.fn().mockResolvedValue({ passed: true, errors: [] });
  });

  it('threads tool results into stepHistory across plan steps', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 10, maxTokens: 100000, maxDurationMs: 60000 },
      tools: [],
      executeTool: vi.fn().mockResolvedValue({ content: 'file content' }),
    });

    // Plan phase: task with 2 steps
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify([
        { action: 'Read source files', tool: 'read_file' },
        { action: 'Write implementation', tool: 'write_file' },
      ]),
      usage: { totalTokens: 10 },
    });

    // Step 1: LLM calls read_file (investigating)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Let me read the source files first.',
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'read_file', args: { path: '/src/main.ts' } },
      ],
      usage: { totalTokens: 20 },
    });

    // Step 2: LLM should have tool results from step 1 in its history
    mockGenerateText.mockResolvedValueOnce({
      text: 'Based on my analysis, I will now write the implementation.',
      usage: { totalTokens: 15 },
    });

    // Respond phase
    mockGenerateText.mockResolvedValueOnce({
      text: 'Completed the two plan steps successfully.',
      usage: { totalTokens: 5 },
    });

    // Consume the async generator
    const events: any[] = [];
    for await (const event of (orchestrator as any).execute('test task', [])) {
      events.push(event);
    }

    // Plan: call 0, Step 1: call 1, Step 2: call 2, Respond: call 3
    // Step 2's call to generateText should include history from step 1
    const step2Messages = mockGenerateText.mock.calls[2][0].messages;

    // Should contain the assistant message from step 1
    const step1Assistant = step2Messages.find((message: any) => message.role === 'assistant');
    expect(step1Assistant.content).toEqual(expect.arrayContaining([
      { type: 'text', text: 'Let me read the source files first.' },
    ]));

    // Should contain the tool result from step 1 (read_file call)
    expect(step2Messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'read_file',
            }),
          ]),
        }),
      ]),
    );

    // The user prompt for step 2 should be the last message
    const lastMsg = step2Messages[step2Messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Write implementation');
  });

  it('accumulates history correctly on verification failure retry', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 10, maxTokens: 100000, maxDurationMs: 60000 },
      tools: [],
      executeTool: vi.fn().mockImplementation((name: string, args: any) => {
        if (name === 'readFile') return { content: 'mock file content' };
        return { ok: true };
      }),
    });

    // Plan phase: single step that triggers verification
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify([
        { action: 'Edit the main file', tool: 'write_file' },
      ]),
      usage: { totalTokens: 10 },
    });

    // Step 1 (first attempt): LLM calls writeFile (camelCase triggers modifiedFiles)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Writing the changes.',
      toolCalls: [
        { toolCallId: 'call-v1', toolName: 'writeFile', args: { path: '/src/main.ts', content: 'updated' } },
      ],
      usage: { totalTokens: 20 },
    });

    // Verification fails → retry same step
    mockVerifyChanges.mockResolvedValueOnce({
      passed: false,
      errors: [{ file: '/src/main.ts', message: 'Syntax error found', suggestion: 'Check brackets' }],
    });

    // Step 1 (second attempt): LLM fixes the issue
    mockGenerateText.mockResolvedValueOnce({
      text: 'Fixing the syntax issue.',
      toolCalls: [
        { toolCallId: 'call-v2', toolName: 'writeFile', args: { path: '/src/main.ts', content: 'fixed content' } },
      ],
      usage: { totalTokens: 25 },
    });

    // Verification passes on second attempt
    mockVerifyChanges.mockResolvedValueOnce({
      passed: true,
      errors: [],
    });

    // Independent reviewer passes after deterministic verification.
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ passed: true, issues: [] }),
      usage: { totalTokens: 5 },
    });

    // Respond phase
    mockGenerateText.mockResolvedValueOnce({
      text: 'Fixed the file after verification failure.',
      usage: { totalTokens: 5 },
    });

    const events: any[] = [];
    for await (const event of (orchestrator as any).execute('test task', [])) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'review_passed' });
    expect(mockGenerateText.mock.calls[3][0].messages.at(-1).content).toContain('ORIGINAL REQUEST:\ntest task');

    // Plan: call 0, attempts: calls 1-2, review: call 3, respond: call 4.
    // Step 1 attempt 2 should have history from attempt 1
    const retryMessages = mockGenerateText.mock.calls[2][0].messages;

    // Should contain assistant message from first attempt
    const firstAttemptAssistant = retryMessages.find((message: any) => message.role === 'assistant');
    expect(firstAttemptAssistant.content).toEqual(expect.arrayContaining([
      { type: 'text', text: 'Writing the changes.' },
    ]));

    // Should contain tool result from first attempt (writeFile call-v1)
    expect(retryMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'tool-result',
              toolCallId: 'call-v1',
              toolName: 'writeFile',
            }),
          ]),
        }),
      ]),
    );

    // Verify the retry context includes the verification failure feedback
    const lastMsg = retryMessages[retryMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Verification failed');

    // Final respond phase should have BOTH attempts' history
    const respondMessages = mockGenerateText.mock.calls[4][0].messages;
    const assistantTexts = respondMessages
      .filter((m: any) => m.role === 'assistant')
      .flatMap((m: any) => Array.isArray(m.content)
        ? m.content.filter((part: any) => part.type === 'text').map((part: any) => part.text)
        : [m.content]);

    expect(assistantTexts).toContain('Writing the changes.');
    expect(assistantTexts).toContain('Fixing the syntax issue.');
  });

  it('truncates stepHistory at 30 messages cap', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 25, maxTokens: 100000, maxDurationMs: 120000 },
      tools: [],
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
    });

    // Generate a plan with 18 steps (each step adds 1 assistant + 1 tool msg = 36 total, exceeding 30 cap)
    const planSteps = Array.from({ length: 18 }, (_, i) => ({
      action: `Step ${i + 1}: Process module`, tool: 'read_file',
    }));

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(planSteps),
      usage: { totalTokens: 10 },
    });

    // Each step returns a read_file tool call (1 assistant + 1 tool msg = 2 per step)
    for (let i = 0; i < 18; i++) {
      mockGenerateText.mockResolvedValueOnce({
        text: `Processing step ${i + 1}...`,
        toolCalls: [
          { toolCallId: `call-${i}`, toolName: 'read_file', args: { path: `/src/module${i + 1}.ts` } },
        ],
        usage: { totalTokens: 10 },
      });
    }

    // Respond phase
    mockGenerateText.mockResolvedValueOnce({
      text: 'All steps processed.',
      usage: { totalTokens: 5 },
    });

    const events: any[] = [];
    for await (const event of (orchestrator as any).execute('test task', [])) {
      events.push(event);
    }

    // Plan: call 0, Steps 1-18: calls 1-18, Respond: call 19
    // After 15 steps (30 messages), truncation starts at step 16
    // Respond phase (call 19) should have ≤ 30 history messages + 1 user prompt = ≤ 31 total
    const respondMessages = mockGenerateText.mock.calls[19][0].messages;

    // Total messages should be at most 31 (30 history + 1 user prompt)
    expect(respondMessages.length).toBeLessThanOrEqual(31);

    // The first history message (index 0) should NOT be from step 1 (which was truncated)
    // Step 1's assistant content was "Processing step 1..."
    const nonUserMessages = respondMessages.filter((m: any) => m.role !== 'user');
    expect(nonUserMessages.length).toBeLessThanOrEqual(30);

    // Verify that step 1's content is NOT present (it was truncated)
    const allAssistantContents = respondMessages
      .filter((m: any) => m.role === 'assistant')
      .map((m: any) => m.content);
    expect(allAssistantContents).not.toContain('Processing step 1...');

    // Later steps should still be present
    const lastAssistantContent = allAssistantContents[allAssistantContents.length - 1];
    expect(lastAssistantContent).toEqual(expect.arrayContaining([
      { type: 'text', text: 'Processing step 18...' },
    ]));
  });
});
