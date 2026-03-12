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
});
