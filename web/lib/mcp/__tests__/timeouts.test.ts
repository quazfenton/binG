/**
 * __tests__/lib/mcp/timeouts.test.ts
 *
 * Regression lock for MCP timeout constants. Asserts:
 *   1. MCP_AGENT_TIMEOUT_MS === 60_000 at all times (future retunes must
 *      update this test).
 *   2. INIT_PROBE_TIMEOUT_MS === 5_000.
 *   3. Every known caller imports the constant from the canonical module
 *      (`@/lib/mcp/timeouts` or `@/lib/mcp` barrel) rather than inlining.
 *
 * Caller-reference assertions use readFileSync to grep the consumer source.
 * When a future change adds a 5th back-port site or retunes the ceiling,
 * the assertion value or the caller list must be updated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_AGENT_TIMEOUT_MS, INIT_PROBE_TIMEOUT_MS } from '@/lib/mcp/timeouts';

const ROOT = process.cwd();

// ─── Locked values ───────────────────────────────────────────────────

describe('MCP_AGENT_TIMEOUT_MS', () => {
  it('equals 60_000 (the canonical 60s ceiling)', () => {
    expect(MCP_AGENT_TIMEOUT_MS).toBe(60_000);
  });
});

describe('INIT_PROBE_TIMEOUT_MS', () => {
  it('equals 5_000 (the canonical 5s per-server probe ceiling)', () => {
    expect(INIT_PROBE_TIMEOUT_MS).toBe(5_000);
  });
});

// ─── Caller references ───────────────────────────────────────────────
//
// Each consumer MUST import the constant rather than inlining the literal.
// The grep patterns below match both static and dynamic import forms.

const CALLERS = [
  // 3 back-port sites (relative to web/, which is process.cwd())
  { path: '../packages/shared/agent/unified-agent.ts',      pattern: /MCP_AGENT_TIMEOUT_MS/ },
  { path: '../packages/shared/agent/task-router.ts',         pattern: /MCP_AGENT_TIMEOUT_MS/ },
  { path: '../packages/shared/agent/opencode-direct.ts',     pattern: /MCP_AGENT_TIMEOUT_MS/ },
  // NOTE: route.ts is deliberately NOT in this list. The per-turn agent
  // signal used to bundle `AbortSignal.timeout(MCP_AGENT_TIMEOUT_MS)`,
  // but doing so capped the whole agent turn (and the 240s fallback chain
  // budget) at 60s and bypassed the route's stall-watchdog 524 mapping.
  // `MCP_AGENT_TIMEOUT_MS` now stays scoped to INDIVIDUAL MCP tool calls,
  // enforced at the tool-call layer (callMCPToolFromAI_SDK + task-router).
  // The route's own ROUTE_MAX_TURN_MS stall watchdog bounds the turn.
  // http-transport.ts re-exports INIT_PROBE_TIMEOUT_MS from timeouts.ts
  { path: 'lib/mcp/http-transport.ts',                       pattern: /INIT_PROBE_TIMEOUT_MS/ },
  // architecture-integration.ts uses INIT_PROBE_TIMEOUT_MS
  { path: 'lib/mcp/architecture-integration.ts',             pattern: /INIT_PROBE_TIMEOUT_MS/ },
];

describe('constant callers — every known consumer imports the constant', () => {
  for (const caller of CALLERS) {
    it(`${caller.path} references ${caller.pattern.source}`, () => {
      const src = readFileSync(join(ROOT, caller.path), 'utf-8');
      expect(src).toMatch(caller.pattern);
    });
  }
});
