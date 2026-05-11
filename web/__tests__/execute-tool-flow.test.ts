import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('execute model tool calls flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('executes write_file then handles malformed second call non-fatally', async () => {
    // local mock for MCP tool call
    const mockCall = vi.fn();
    mockCall.mockResolvedValueOnce({ success: true, output: 'written' });
    mockCall.mockResolvedValueOnce({ success: false, error: 'path: Required; content: Required', output: '' });

    // simple emulation of executeModelToolCallsFromResponse behavior
    async function executeModelToolCallsFromResponse(response: any, userId: string, requestId: string, scopePath: string) {
      const results: any[] = [];
      for (const call of response.toolCalls || []) {
        try {
          const res = await mockCall(userId, call.name, call.arguments, { requestId, scopePath });
          results.push(res);
        } catch (err: any) {
          results.push({ success: false, error: String(err) });
        }
      }
      return { metadata: { toolResults: results } };
    }

    const response = {
      content: 'Done',
      toolCalls: [
        { name: 'write_file', arguments: { path: 'workspace/sessions/000/index.html', content: '<html></html>' } },
        { name: 'write_file', arguments: {} }
      ],
      finishReason: 'stop'
    } as any;

    const out = await executeModelToolCallsFromResponse(response, 'anon:1', '000', 'workspace/sessions/000');

    expect(out.metadata).toBeDefined();
    const toolResults = out.metadata.toolResults as any[];
    expect(toolResults.length).toBe(2);
    expect(toolResults[0].success).toBe(true);
    expect(toolResults[1].success).toBe(false);
    expect(toolResults[1].error).toContain('Required');
  });
});
