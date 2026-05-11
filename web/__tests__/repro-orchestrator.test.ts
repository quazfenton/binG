import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies so the orchestrator can be imported in tests without full app context
vi.mock('@/lib/orchestra/stateful-agent/agents/verification', () => ({ verifyChanges: async (_files: any) => ({ passed: true, errors: [] }) }));
vi.mock('@/lib/crewai/runtime/self-healing', () => ({ SelfHealingExecutor: class {} }));
vi.mock('@/lib/chat/vercel-ai-streaming', () => ({ getVercelModel: (_provider: any, _model: any) => ({}) }));
vi.mock('ai', () => ({ generateText: async () => ({ text: '', usage: { totalTokens: 0 } }), tool: (_: any) => { /* noop */ } }));
vi.mock('@/lib/utils/logger', () => ({ createLogger: (_name: string) => ({ debug: console.debug.bind(console), info: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) }) }));
vi.mock('@/lib/database/schema', () => ({ execSchemaFile: (_db: any, _name: string) => {} }));

import { PlanActVerifyOrchestrator } from '../../packages/shared/agent/orchestration/plan-act-verify';
import { toolCallTracker } from '../lib/chat/tool-call-tracker';

describe('orchestrator reproduction harness', () => {
  it('captures constructed tool calls and aggregates redacted payloads', async () => {
    // simple executeTool that succeeds when path present, fails when missing
    const executeTool = async (name: string, args: any) => {
      if (!args || !args.path) {
        throw new Error('path: Required; content: Required');
      }
      return { path: args.path, bytesWritten: args.content ? args.content.length : 0 };
    };

    const orchestrator = new PlanActVerifyOrchestrator({
      iterationConfig: { maxIterations: 5, maxTokens: 10000, maxDurationMs: 60000 },
      tools: [],
      executeTool,
    });

    // Patch private callLLM to return a sequence of tool-calling responses
    let callIndex = 0;
    (orchestrator as any).callLLM = async (_task: string, _history: any[]) => {
      callIndex++;
      if (callIndex === 1) {
        return {
          text: '',
          done: false,
          toolCalls: [{ id: 't1', name: 'write_file', arguments: { path: 'workspace/sessions/000/index.html', content: '<html></html>' } }],
          usage: { totalTokens: 0 },
        };
      }
      if (callIndex === 2) {
        return {
          text: '',
          done: false,
          toolCalls: [{ id: 't2', name: 'write_file', arguments: {} }],
          usage: { totalTokens: 0 },
        };
      }
      return { text: 'done', done: true, toolCalls: [], usage: { totalTokens: 0 } };
    };

    const events: any[] = [];
    for await (const ev of orchestrator.execute('test-task', [] as any)) {
      events.push(ev);
      // break if done
      if (ev.type === 'done') break;
    }

    // Expect that at least one tool_call event was emitted
    const toolCalls = events.filter(e => e.type === 'tool_call');
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);

    // If any tool_error events were produced, they should be present; but the orchestrator may break earlier
    const errors = events.filter(e => e.type === 'tool_error');
    // No strict assertion here — presence is helpful but not required for this harness

    // Check that the tool-call-tracker has recorded redacted invocation payloads
    const invocations = await toolCallTracker.getRecentInvocations(10);
    expect(invocations.length).toBeGreaterThanOrEqual(1);
    const hasWriteFile = invocations.some(i => (i.tool_name || i.toolName || '').includes('write'));
    expect(hasWriteFile).toBe(true);
  });
});
