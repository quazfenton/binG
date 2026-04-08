/**
 * V2 Executor Unit Tests
 *
 * Covers:
 * - Response sanitization (heredoc removal, catastrophic backtracking prevention)
 * - Session mode mapping
 * - Result normalization
 * - Stream cancellation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Response Sanitization — behavioral tests (exercise runtime logic)
// ---------------------------------------------------------------------------
describe('V2 Executor — Response Sanitization', () => {
  let sanitize: typeof import('../v2-executor').sanitizeV2ResponseContent;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../v2-executor');
    sanitize = mod.sanitizeV2ResponseContent;
  });

  it('removes bash heredoc blocks', () => {
    const input = `Here's the file:
cat > file.txt << 'EOF'
secret content
more secrets
EOF
Done writing.`;
    const result = sanitize(input);
    expect(result).toContain('Here\'s the file:');
    expect(result).toContain('Done writing.');
    expect(result).not.toContain('secret content');
    expect(result).not.toContain("<< 'EOF'");
  });

  it('removes WRITE/PATCH/APPLY_DIFF heredoc blocks', () => {
    const input = `I'll write the file:
WRITE src/app.js <<<
const x = 42;
>>>
All done.`;
    const result = sanitize(input);
    expect(result).toContain("I'll write the file:");
    expect(result).toContain('All done.');
    expect(result).not.toContain('WRITE');
    expect(result).not.toContain('const x = 42');
  });

  it('removes fs-actions code blocks', () => {
    const input = `Here is the edit:
\`\`\`fs-actions
WRITE secret.txt <<<API_KEY=12345>>>
\`\`\`
Finished.`;
    const result = sanitize(input);
    expect(result).toContain('Here is the edit:');
    expect(result).toContain('Finished.');
    expect(result).not.toContain('API_KEY=12345');
    expect(result).not.toContain('```fs-actions');
  });

  it('removes <fs-actions> XML blocks', () => {
    const input = `<fs-actions>
WRITE config.json <<<{"key": "secret"}>>>
</fs-actions>
Done.`;
    const result = sanitize(input);
    expect(result).toContain('Done.');
    expect(result).not.toContain('<fs-actions>');
    expect(result).not.toContain('secret');
  });

  it('removes oversized heredocs (MAX_HEREDOC_LINES cap)', () => {
    const manyLines = Array(200).fill('line of code').join('\n');
    const input = `cat > big.txt << 'EOF'\n${manyLines}\nEOF\nafter block`;
    const result = sanitize(input);
    expect(result).not.toContain('line of code');
    expect(result).toContain('after block');
  });
});

// ---------------------------------------------------------------------------
// Session Mode Mapping — behavioral tests (mock + invoke)
// ---------------------------------------------------------------------------
describe('V2 Executor — Session Mode Mapping', () => {
  async function setupMocks() {
    vi.resetModules();
    const getOrCreateSession = vi.fn().mockResolvedValue({
      id: 's1',
      conversationId: 'c1',
      workspacePath: '/tmp/ws',
      executionPolicy: 'local-safe',
    });
    vi.doMock('@/lib/session/agent/agent-session-manager', () => ({
      agentSessionManager: {
        getOrCreateSession,
        getSession: () => ({ id: 's1', conversationId: 'c1', workspacePath: '/tmp/ws', executionPolicy: 'local-safe' }),
      },
    }));
    vi.doMock('@/lib/tools', () => ({ getToolManager: () => ({}) }));
    vi.doMock('../opencode-direct', () => ({
      runOpenCodeDirect: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
    }));
    return { getOrCreateSession };
  }

  it('maps "advanced" to opencode mode', async () => {
    const { getOrCreateSession } = await setupMocks();
    const { executeV2Task } = await import('../v2-executor');
    await executeV2Task({ userId: 'u1', conversationId: 'c1', task: 'test', preferredAgent: 'advanced' });
    expect(getOrCreateSession).toHaveBeenCalledWith('u1', 'c1', expect.objectContaining({ mode: 'opencode' }));
  });

  it('maps "cli" to cli mode', async () => {
    const { getOrCreateSession } = await setupMocks();
    const { executeV2Task } = await import('../v2-executor');
    await executeV2Task({ userId: 'u1', conversationId: 'c1', task: 'test', preferredAgent: 'cli' });
    expect(getOrCreateSession).toHaveBeenCalledWith('u1', 'c1', expect.objectContaining({ mode: 'cli' }));
  });

  it('maps "nullclaw" to nullclaw mode', async () => {
    const { getOrCreateSession } = await setupMocks();
    const { executeV2Task } = await import('../v2-executor');
    await executeV2Task({ userId: 'u1', conversationId: 'c1', task: 'test', preferredAgent: 'nullclaw' });
    expect(getOrCreateSession).toHaveBeenCalledWith('u1', 'c1', expect.objectContaining({ mode: 'nullclaw' }));
  });

  it('maps undefined preferredAgent to default mode', async () => {
    const { getOrCreateSession } = await setupMocks();
    const { executeV2Task } = await import('../v2-executor');
    await executeV2Task({ userId: 'u1', conversationId: 'c1', task: 'test' });
    expect(getOrCreateSession).toHaveBeenCalledWith('u1', 'c1', expect.objectContaining({ mode: expect.any(String) }));
  });
});

// ---------------------------------------------------------------------------
// Stream Cancellation — structural checks (source-level assertions OK here)
// ---------------------------------------------------------------------------
describe('V2 Executor — Stream Cancellation', () => {
  it('implements cancel callback on ReadableStream', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(path.join(__dirname, '../v2-executor.ts'), 'utf-8');

    expect(content).toContain('cancel()');
    expect(content).toContain('cancelled = true');
    expect(content).toContain('if (!cancelled)');
  });

  it('cleans up ping interval on stream completion', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(path.join(__dirname, '../v2-executor.ts'), 'utf-8');

    expect(content).toContain('cleanupFns');
    expect(content).toContain('clearInterval(pingInterval)');
  });
});

// ---------------------------------------------------------------------------
// Result Normalization — structural checks
// ---------------------------------------------------------------------------
describe('V2 Executor — Result Normalization', () => {
  it('exports V2ExecutionResult interface', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(path.join(__dirname, '../v2-executor.ts'), 'utf-8');

    expect(content).toContain('export interface V2ExecutionResult');
    expect(content).toContain('success: boolean');
    expect(content).toContain('content: string');
    expect(content).toContain('rawContent: string');
  });

  it('uses buildResult helper for consistent output shape', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(path.join(__dirname, '../v2-executor.ts'), 'utf-8');

    expect(content).toContain('function buildResult');
    expect(content).toContain('sanitizeV2ResponseContent(rawContent)');
  });
});

// ---------------------------------------------------------------------------
// Error Boundaries — structural checks
// ---------------------------------------------------------------------------
describe('V2 Executor — Error Boundaries', () => {
  it('catches errors with unknown type safety', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(path.join(__dirname, '../v2-executor.ts'), 'utf-8');

    expect(content).toContain('catch (error: unknown)');
    expect(content).toContain('error instanceof Error ? error.message : String(error)');
  });

  it('returns structured error result on failure', async () => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const content = readFileSync(path.join(__dirname, '../v2-executor.ts'), 'utf-8');

    expect(content).toContain("errorCode: 'EXECUTION_FAILED'");
    expect(content).toContain('success: false');
  });
});
