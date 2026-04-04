import { describe, expect, it } from 'vitest';

import { UnifiedResponseHandler } from '@/lib/api/unified-response-handler';

describe('UnifiedResponseHandler tool invocation extraction', () => {
  it('prefers data.toolInvocations over messageMetadata/metadata/toolResults', () => {
    const handler = new UnifiedResponseHandler();
    const unified = handler.processResponse({
      success: true,
      source: 'test',
      data: {
        content: 'ok',
        toolInvocations: [
          {
            toolCallId: 'call-primary',
            toolName: 'primary.tool',
            state: 'result',
            args: { from: 'data.toolInvocations' },
            result: { ok: true },
          },
        ],
        toolResults: [
          {
            name: 'legacy.tool',
            result: { ok: false },
          },
        ],
      },
      messageMetadata: {
        toolInvocations: [
          {
            toolCallId: 'call-message-metadata',
            toolName: 'message.metadata.tool',
            state: 'result',
          },
        ],
      },
      metadata: {
        toolInvocations: [
          {
            toolCallId: 'call-metadata',
            toolName: 'metadata.tool',
            state: 'result',
          },
        ],
      },
    });

    expect(unified.data.toolInvocations).toHaveLength(1);
    expect(unified.data.toolInvocations?.[0].toolCallId).toBe('call-primary');
    expect(unified.data.toolInvocations?.[0].toolName).toBe('primary.tool');
  });
});
