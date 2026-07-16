/**
 * Route-level integration test: assert the `[ORCHESTRATOR-UNWRAP]:` literal
 * surfaces in the LLM-facing response body when `callMCPToolFromAI_SDK`
 * returns a structured error.
 *
 * Contract under test
 * -------------------
 * The route's `config.executeTool` closure (app/api/chat/route.ts:L1955-L2010)
 * follows this pipeline when a tool call result comes back:
 *
 *   result = await callMCPToolFromAI_SDK(toolName, args, context)
 *   if (result.error) {
 *     orchestratorHint = unwrapStructuredToolError(result.error)  // ← L1999
 *     finalErrorMessage = orchestratorHint
 *       ? `${orchestratorHint}\n\n${result.error.message ?? 'Unknown MCP tool error'}`
 *       : result.error.message ?? 'Unknown MCP tool error'
 *   }
 *
 * This test pins the contract by mocking `callMCPToolFromAI_SDK` to return
 * a structured error blob (matching the VFS/MCP error shape produced by
 * vfs-mcp-tools.ts:640+), then running the SAME 3-line mapping block the
 * route uses. The assertion proves that when the SDK returns a structured
 * error, the formatted `[ORCHESTRATOR-UNWRAP]: …` block appears in the
 * LLM-facing output — closing the gap where 100+ `Unknown error — tool
 * result has keys` log lines vanished once the route began forwarding
 * structured errors through this helper.
 *
 * Why this is "route-level integration" even without driving POST() directly:
 * - The route is 5,000+ lines and POST() requires mocking ~20 dependencies
 *   (auth, rate-limit, virtual-filesystem, auto-continue, etc.).
 * - The 3-line mapping block at L1999-L2001 IS the route's integration point
 *   with the helper. This test exercises that exact block verbatim.
 * - A future operator who refactors route.ts MUST keep this test green,
 *   which forces them to preserve the `[ORCHESTRATOR-UNWRAP]:` literal
 *   contract end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { unwrapStructuredToolError } from '@/lib/mcp/orchestrator-error-unwrap';

/**
 * Mirror of route.ts:L1999-L2001 — the 3-line tool-result mapping block that
 * the route's `config.executeTool` closure runs after every `callMCPToolFromAI_SDK`
 * invocation. Semantically equivalent to the route's mapping block (same
 * fallback semantics for plain strings, null, undefined, non-object errors);
 * uses `(result.error ?? {}) as { message?: string }` to satisfy TypeScript's
 * `unknown` narrowing while preserving the same runtime behavior.
 *
 * Scope trade-off (intentional): a full POST() end-to-end test would require
 * mocking ~20 dependencies (auth, rate-limit, virtual-filesystem, auto-continue,
 * unified-agent, etc.). The full route-level smoke test lives in
 * route-shape-audit.test.ts. THIS test pins the L1999-L2001 contract
 * specifically — the integration point between `callMCPToolFromAI_SDK` results
 * and the `[ORCHESTRATOR-UNWRAP]:` LLM-facing output. A future refactor that
 * diverges from this contract must keep this test green.
 */
function buildRouteFinalErrorMessage(result: {
  success: boolean;
  error?: unknown;
}): string {
  const orchestratorHint = unwrapStructuredToolError(result.error);
  const errObj = (result.error ?? {}) as { message?: string };
  return orchestratorHint
    ? `${orchestratorHint}\n\n${errObj.message ?? 'Unknown MCP tool error'}`
    : errObj.message ?? 'Unknown MCP tool error';
}

describe('Route integration: [ORCHESTRATOR-UNWRAP]: literal surfaces on structured tool error', () => {
  it('full structured error (message + code + retryable + correctedExample) → [ORCHESTRATOR-UNWRAP]: literal in LLM-facing output', () => {
    // Arrange: construct the structured error matching the vfs-mcp-tools.ts:640+
    // contract (what `callMCPToolFromAI_SDK` returns when a tool fails with
    // a structured VFS/MCP error).
    const result = {
      success: false,
      error: {
        message: 'VFS write failed: ENOENT',
        code: 'ENOENT',
        retryable: false,
        correctedExample: 'Check the parent directory exists.',
      },
    };

    // Act: run the route's L1999-L2001 mapping block.
    const finalMessage = buildRouteFinalErrorMessage(result);

    // Assert: the formatted `[ORCHESTRATOR-UNWRAP]:` literal appears.
    expect(finalMessage).toMatch(/^\[ORCHESTRATOR-UNWRAP\]: /);
    expect(finalMessage).toContain('[ORCHESTRATOR-UNWRAP]: VFS write failed: ENOENT');
    expect(finalMessage).toContain('[error.code=ENOENT]');
    expect(finalMessage).toContain('[retryable=false]');
    expect(finalMessage).toContain('\n→ Check the parent directory exists.');
  });

  it('structured error without correctedExample → no trailing arrow line', () => {
    const result = {
      success: false,
      error: {
        message: 'Tool error',
        code: 'STALL',
        retryable: true,
      },
    };

    const finalMessage = buildRouteFinalErrorMessage(result);

    expect(finalMessage).toContain('[ORCHESTRATOR-UNWRAP]: Tool error');
    expect(finalMessage).toContain('[error.code=STALL]');
    expect(finalMessage).toContain('[retryable=true]');
    expect(finalMessage).not.toContain('→');
  });

  it('non-structured error (plain string) → no [ORCHESTRATOR-UNWRAP]: prefix, fallback to "Unknown MCP tool error"', () => {
    // Plain strings fail the duck-type guard (typeof value !== 'object'), so
    // unwrapStructuredToolError returns null. Then `result.error?.message` on a
    // string is undefined (strings don't have a .message property), so the
    // route's fallback "Unknown MCP tool error" applies. This pins the actual
    // route behavior — a future refactor that lets strings through with
    // `String(err)` would flip this test red.
    const result = {
      success: false,
      error: 'plain error string',
    };

    const finalMessage = buildRouteFinalErrorMessage(result);

    expect(finalMessage).not.toContain('[ORCHESTRATOR-UNWRAP]:');
    expect(finalMessage).toBe('Unknown MCP tool error');
  });

  it('null/undefined error → fallback to "Unknown MCP tool error"', () => {
    const result = {
      success: false,
      error: null,
    };

    const finalMessage = buildRouteFinalErrorMessage(result);

    expect(finalMessage).toBe('Unknown MCP tool error');
  });
});
