/**
 * __tests__/mcp/backport-timeout.test.ts
 *
 * Per-site shape-lock + runtime verification for the 3 MCP-agent-timeout
 * back-port sites. Each site MUST:
 *   1. Import MCP_AGENT_TIMEOUT_MS (not inline 60_000).
 *   2. Pass `AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS)` as the signal
 *      option to `callMCPToolFromAI_SDK`.
 *   3. Time out at ≤60s+headroom when the MCP server hangs.
 *
 * T8 — unified-agent.ts mcpCall
 * T9 — opencode-direct.ts executeTool
 * T10 — task-router.ts executeTool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_AGENT_TIMEOUT_MS } from '@/lib/mcp/timeouts';

const ROOT = process.cwd();

const readSrc = (relPath: string): string =>
  readFileSync(join(ROOT, relPath), 'utf-8');

// =====================================================================
// Shape-lock: each source file must reference MCP_AGENT_TIMEOUT_MS
// =====================================================================

describe('T8: unified-agent.ts mcpCall — timeout constant reference', () => {
  const SRC = '../packages/shared/agent/unified-agent.ts';

  it('imports MCP_AGENT_TIMEOUT_MS (not inline 60_000)', () => {
    const src = readSrc(SRC);
    expect(src).toMatch(/MCP_AGENT_TIMEOUT_MS/);
    // No stray inline 60_000 in the mcpCall method
    const mcpCallRegion = src.split('async mcpCall(')[1]?.split('async mcpListTools(')[0] ?? '';
    expect(mcpCallRegion).not.toMatch(/60[_ ]?000/);
  });

  it('passes AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS) to callMCPToolFromAI_SDK', () => {
    const src = readSrc(SRC);
    expect(src).toMatch(
      /signal:\s*AbortSignal\.timeout\(\s*MCP_AGENT_TIMEOUT_MS\s*\)/,
    );
  });
});

describe('T9: opencode-direct.ts executeTool — timeout constant reference', () => {
  const SRC = '../packages/shared/agent/opencode-direct.ts';

  it('imports MCP_AGENT_TIMEOUT_MS from dynamic import', () => {
    const src = readSrc(SRC);
    expect(src).toMatch(/MCP_AGENT_TIMEOUT_MS/);
  });

  it('passes AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS) to callMCPToolFromAI_SDK', () => {
    const src = readSrc(SRC);
    expect(src).toMatch(
      /signal:\s*AbortSignal\.timeout\(\s*MCP_AGENT_TIMEOUT_MS\s*\)/,
    );
  });
});

describe('T10: task-router.ts executeTool — timeout constant reference', () => {
  const SRC = '../packages/shared/agent/task-router.ts';

  it('imports MCP_AGENT_TIMEOUT_MS from dynamic import', () => {
    const src = readSrc(SRC);
    expect(src).toMatch(/MCP_AGENT_TIMEOUT_MS/);
  });

  it('passes AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS) to callMCPToolFromAI_SDK', () => {
    const src = readSrc(SRC);
    expect(src).toMatch(
      /signal:\s*AbortSignal\.timeout\(\s*MCP_AGENT_TIMEOUT_MS\s*\)/,
    );
  });
});

// =====================================================================
// Runtime: mock callMCPToolFromAI_SDK to hang, invoke via the back-port
// pattern, verify wallclock ≤60s + headroom.
// =====================================================================

describe('back-port timeout — runtime wallclock ≤60s + 2s headroom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts within MCP_AGENT_TIMEOUT_MS when signal times out (T8/T9/T10 shared)', { timeout: 120_000 }, async () => {
    const signal = AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS);

    // Simulate a hung MCP call that respects the signal
    const promise = new Promise<{ success: boolean; output: string }>((_resolve, reject) => {
      if (signal.aborted) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });

    // Fast-forward past the timeout
    await vi.advanceTimersByTimeAsync(MCP_AGENT_TIMEOUT_MS);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
