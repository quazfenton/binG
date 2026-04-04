import { describe, expect, it } from 'vitest';

import { normalizeToolInvocation } from '@/lib/types/tool-invocation';

describe('normalizeToolInvocation', () => {
  it('extracts provenance metadata fields from raw producer payload', () => {
    const normalized = normalizeToolInvocation({
      toolName: 'github.search_repos',
      args: { query: 'binG' },
      result: { success: true },
      provider: 'composio',
      sourceAgent: 'v2',
      sourceSystem: 'priority-router',
      requestId: 'req-1',
      conversationId: 'conv-1',
      state: 'custom-state',
      timestamp: 1234567890,
    });

    expect(normalized.toolName).toBe('github.search_repos');
    expect(normalized.state).toBe('result');
    expect(normalized.metadata).toEqual({
      provider: 'composio',
      sourceAgent: 'v2',
      sourceSystem: 'priority-router',
      requestId: 'req-1',
      conversationId: 'conv-1',
      rawState: 'custom-state',
    });
  });

  it('falls back to "unknown" when no tool name field is present', () => {
    const normalized = normalizeToolInvocation({
      result: { items: [1, 2, 3] },
      provider: 'composio',
      sourceSystem: 'priority-router',
    });

    expect(normalized.toolName).toBe('unknown');
    expect(normalized.toolCallId).toMatch(/^unknown-/);
    expect(normalized.state).toBe('result');
    expect(normalized.metadata?.provider).toBe('composio');
  });

  it('preserves explicit composio fallback name like composio-tool-1', () => {
    const normalized = normalizeToolInvocation({
      toolName: 'composio-tool-1',
      args: { query: 'test' },
      result: { ok: true },
      provider: 'composio',
      sourceSystem: 'priority-router',
      requestId: 'req-42',
    });

    expect(normalized.toolName).toBe('composio-tool-1');
    expect(normalized.metadata?.provider).toBe('composio');
    expect(normalized.metadata?.requestId).toBe('req-42');
  });
});
