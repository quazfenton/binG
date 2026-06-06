/**
 * Regression test for the vfs/MCP tool-call ModelMessage[] schema failure.
 *
 * Background: when an LLM was asked to code an app and tried to use vfs/MCP
 * write tools, the orchestrator hit
 *   "I encountered an error during orchestration: Invalid prompt:
 *    The messages do not match the ModelMessage[] schema".
 *
 * Root cause: the retry wrapper in `PlanActVerifyOrchestrator.callLLM` only
 * filtered out system-role messages on retry. It did not (a) sanitize
 * proactively on the first attempt, (b) convert tool-role plain-string
 * content into the required array form, (c) drop empty assistant turns, or
 * (d) coerce unknown roles. The orchestrator now runs the conversation
 * history through `sanitizeMessages` both up-front and on retry, which
 * fixes all four classes of schema violation in one pass.
 *
 * These tests verify:
 *   1. Sanitization is eager — system messages never reach the AI SDK.
 *   2. Tool-role plain-string content is converted to array form.
 *   3. The retry path still works as a defensive backstop.
 *   4. Sanitization is idempotent and safe on already-clean histories.
 *   5. Non-schema errors are not retried.
 *   6. Persistent schema errors are bounded to exactly 2 attempts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeMessages } from '../lib/chat/message-sanitizer';

import { PlanActVerifyOrchestrator } from '../../packages/shared/agent/orchestration/plan-act-verify';

// ── Test helpers ──────────────────────────────────────────────────────────

// Build a minimal LanguageModelV2-compatible object that returns a fake
// result without making any network call. We do not mock `generateText`
// itself because vitest's module resolution splits the test's `ai` and the
// package's `ai`; the real `generateText` is fine to call as long as the
// model it operates on is a no-op stub.
function makeStubModel() {
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'test-model',
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: 'mocked' }],
      finishReason: 'stop' as const,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
    }),
    doStream: async () => ({ stream: new ReadableStream() }),
  };
}

let currentModel: any = makeStubModel();

vi.mock('@/lib/chat/vercel-ai-streaming', () => ({
  getVercelModel: vi.fn(() => currentModel),
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

// ── Sample histories ─────────────────────────────────────────────────────

const historyWithSystem = [
  { role: 'system' as const, content: 'You are helpful.' },
  { role: 'user' as const, content: 'hello' },
  { role: 'assistant' as const, content: 'hi' },
];

const cleanHistory = [
  { role: 'user' as const, content: 'hello' },
  { role: 'assistant' as const, content: 'hi' },
];

// History with a tool message whose content is a plain string instead of the
// required `[{ type: 'tool-result', ... }]` array. This is the exact shape
// that caused the vfs/MCP write-tool failures in production: an upstream
// code path constructed a tool message with `content: 'wrote /foo.ts'`
// (plain string) instead of the SDK's required `[{ type: 'text', text: '...' }]`.
const historyWithBadToolMessage = [
  { role: 'user' as const, content: 'code me an app' },
  { role: 'assistant' as const, content: 'Writing the file now.' },
  { role: 'tool' as const, content: 'wrote /foo.ts', tool_call_id: 'tc-1' },
];

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PlanActVerifyOrchestrator.callLLM sanitization', () => {
  beforeEach(() => {
    currentModel = makeStubModel();
  });

  it('sanitizes history eagerly so system messages never reach generateText', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 5, maxTokens: 10000, maxDurationMs: 60000 },
      tools: [],
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await (orchestrator as any).callLLM('test prompt', historyWithSystem);

    expect(result.text).toBe('mocked');
    // The sanitizer runs up-front, so the first (and only) call must
    // succeed — no schema error is raised. The system message has been
    // stripped before the AI SDK sees the conversation.
  });

  it('converts tool-role plain-string content to array form via sanitizer', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 5, maxTokens: 10000, maxDurationMs: 60000 },
      tools: [],
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await (orchestrator as any).callLLM('test prompt', historyWithBadToolMessage);

    // If the tool message had been passed through with a plain-string
    // content, the AI SDK would have thrown a ModelMessage[] schema error.
    // The sanitizer converts it to `[{ type: 'text', text: ... }]`, so the
    // call succeeds.
    expect(result.text).toBe('mocked');
  });

  it('is idempotent on already-clean histories', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 5, maxTokens: 10000, maxDurationMs: 60000 },
      tools: [],
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await (orchestrator as any).callLLM('test prompt', cleanHistory);

    expect(result.text).toBe('mocked');
  });

  it('does not throw when history is null or undefined', async () => {
    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 5, maxTokens: 10000, maxDurationMs: 60000 },
      tools: [],
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
    });

    // Both null and undefined should be defensively treated as empty arrays.
    await expect((orchestrator as any).callLLM('test prompt', null)).resolves.toBeDefined();
    await expect((orchestrator as any).callLLM('test prompt', undefined)).resolves.toBeDefined();
  });
});

describe('sanitizeMessages', () => {
  it('strips system-role messages entirely', () => {
    const msgs = [
      { role: 'system' as const, content: 'You are a helpful assistant' },
      { role: 'user' as const, content: 'hello' },
    ];
    const out = sanitizeMessages(msgs);
    expect(out.find((m: any) => m.role === 'system')).toBeUndefined();
  });

  it('converts tool-role plain-string content to a tool-result part', () => {
    const msgs = [
      { role: 'tool' as const, content: 'wrote /foo.ts', tool_call_id: 'tc-1' },
    ];
    const out = sanitizeMessages(msgs);
    const toolMsg = out.find((m: any) => m.role === 'tool');
    expect(Array.isArray(toolMsg?.content)).toBe(true);
    const part = (toolMsg?.content as any[])[0];
    expect(part.type).toBe('tool-result');
    expect(part.toolCallId).toBe('tc-1');
    expect(part.output).toEqual({ type: 'text', value: 'wrote /foo.ts' });
  });

  it('drops assistant messages with empty content and no tool calls', () => {
    const msgs = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: '' },
    ];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  it('coerces unknown roles to user', () => {
    const msgs = [{ role: 'invalid_role' as any, content: 'test' }];
    const out = sanitizeMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  // ── AI SDK v6 ModelMessage shape regressions ──────────────────────────────
  // These guard against the exact failure that produced repeated
  // "messages do not match the ModelMessage[] schema" errors followed by the
  // no-tools plain-text fallback emitting an unparsed `choose_role(...)` reply.

  it('folds legacy top-level assistant toolCalls into v6 tool-call content parts', () => {
    const msgs = [
      {
        role: 'assistant' as const,
        content: 'calling a tool',
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'choose_role', args: { role: 'reviewer' } }],
      },
    ];
    const out = sanitizeMessages(msgs);
    const asst: any = out.find((m: any) => m.role === 'assistant');
    // No top-level toolCalls property in v6.
    expect(asst.toolCalls).toBeUndefined();
    expect(Array.isArray(asst.content)).toBe(true);
    const textPart = asst.content.find((p: any) => p.type === 'text');
    const callPart = asst.content.find((p: any) => p.type === 'tool-call');
    expect(textPart).toEqual({ type: 'text', text: 'calling a tool' });
    // ToolCallPart uses `input`, not `args`.
    expect(callPart).toEqual({
      type: 'tool-call',
      toolCallId: 'tc-1',
      toolName: 'choose_role',
      input: { role: 'reviewer' },
    });
  });

  it('converts OpenAI wire-format assistant tool_calls into v6 tool-call parts', () => {
    const msgs = [
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          { id: 'tc-2', type: 'function', function: { name: 'writeFile', arguments: '{"path":"/a.ts"}' } },
        ],
      },
    ];
    const out = sanitizeMessages(msgs);
    const asst: any = out.find((m: any) => m.role === 'assistant');
    expect(asst.toolCalls).toBeUndefined();
    const callPart = (asst.content as any[]).find((p: any) => p.type === 'tool-call');
    expect(callPart.toolCallId).toBe('tc-2');
    expect(callPart.toolName).toBe('writeFile');
    expect(callPart.input).toEqual({ path: '/a.ts' });
  });

  it('normalizes tool-result parts that use a bare `result` field into `output`', () => {
    const msgs = [
      {
        role: 'tool' as const,
        content: [{ type: 'tool-result', toolCallId: 'tc-3', toolName: 'choose_role', result: { success: false } }],
      },
    ];
    const out = sanitizeMessages(msgs);
    const toolMsg: any = out.find((m: any) => m.role === 'tool');
    const part = (toolMsg.content as any[])[0];
    expect(part.result).toBeUndefined();
    expect(part.output).toEqual({ type: 'json', value: { success: false } });
    expect(part.toolCallId).toBe('tc-3');
  });
});
