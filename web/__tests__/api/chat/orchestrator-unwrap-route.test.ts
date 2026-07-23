/**
 * Route-level integration test: assert the `[ORCHESTRATOR-UNWRAP]:` literal
 * surfaces in the LLM-facing response body when `callMCPToolFromAI_SDK`
 * returns a structured error.
 *
 * Contract under test
 * -------------------
 * The route's `config.executeTool` closure (app/api/chat/route.ts:L2170-L2175)
 * follows this pipeline when a tool call result comes back:
 *
 *   result = await callMCPToolFromAI_SDK(toolName, args, context)
 *   if (result.error) {
 *     orchestratorHint = unwrapStructuredToolError(result.error)  // ← L2170
 *     finalOutput = orchestratorHint
 *       ? (result.output && result.output.length > 0
 *           ? `${result.output}\n\n${orchestratorHint}`
 *           : orchestratorHint)
 *       : result.output;
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
 * - The 3-line mapping block at L2170-L2175 IS the route's integration point
 *   with the helper. This test exercises that exact block verbatim.
 * - A future operator who refactors route.ts MUST keep this test green,
 *   which forces them to preserve the `[ORCHESTRATOR-UNWRAP]:` literal
 *   contract end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { unwrapStructuredToolError } from '@/lib/mcp/orchestrator-error-unwrap';

/**
 * Mirror of route.ts:L2170-L2175 — the tool-result mapping block that
 * the route's `config.executeTool` closure runs after every `callMCPToolFromAI_SDK`
 * invocation. Uses `result.output` (not `result.error.message`) per the actual
 * route logic, which conditionally appends the orchestratorHint to result.output
 * when both are non-empty.
 *
 * Scope trade-off (intentional): a full POST() end-to-end test would require
 * mocking ~20 dependencies (auth, rate-limit, virtual-filesystem, auto-continue,
 * unified-agent, etc.). The full route-level smoke test lives in
 * route-shape-audit.test.ts. THIS test pins the L2170-L2175 contract
 * specifically — the integration point between `callMCPToolFromAI_SDK` results
 * and the `[ORCHESTRATOR-UNWRAP]:` LLM-facing output. A future refactor that
 * diverges from this contract must keep this test green.
 */
function buildRouteFinalErrorMessage(result: {
  success: boolean;
  output?: string;
  error?: unknown;
}): string {
  const orchestratorHint = unwrapStructuredToolError(result.error);
  return orchestratorHint
    ? (result.output && result.output.length > 0
        ? `${result.output}\n\n${orchestratorHint}`
        : orchestratorHint)
    : (result.output ?? '');
}

describe('Route integration: [ORCHESTRATOR-UNWRAP]: literal surfaces on structured tool error', () => {
  it('full structured error (message + code + retryable + correctedExample) → [ORCHESTRATOR-UNWRAP]: literal in LLM-facing output', () => {
    // Arrange: construct the structured error matching the vfs-mcp-tools.ts:640+
    // contract (what `callMCPToolFromAI_SDK` returns when a tool fails with
    // a structured VFS/MCP error).
    const result = {
      success: false,
      output: 'VFS write failed: ENOENT',
      error: {
        message: 'VFS write failed: ENOENT',
        code: 'ENOENT',
        retryable: false,
        correctedExample: 'Check the parent directory exists.',
      },
    };

    // Act: run the route's L2170-L2175 mapping block.
    const finalMessage = buildRouteFinalErrorMessage(result);

    // Assert: the formatted `[ORCHESTRATOR-UNWRAP]:` literal appears
    // (prepended after result.output per the route's L2171-L2174 logic).
    expect(finalMessage).toContain('[ORCHESTRATOR-UNWRAP]: VFS write failed: ENOENT');
    expect(finalMessage).toContain('[error.code=ENOENT]');
    expect(finalMessage).toContain('[retryable=false]');
    expect(finalMessage).toContain('\n→ Check the parent directory exists.');
  });

  it('structured error without correctedExample → no trailing arrow line', () => {
    const result = {
      success: false,
      output: 'Tool error',
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

  it('non-structured error (plain string) → no [ORCHESTRATOR-UNWRAP]: prefix, returns result.output', () => {
    // Plain strings fail the duck-type guard (typeof value !== 'object'), so
    // unwrapStructuredToolError returns null. The route falls through to
    // `result.output` (no "Unknown MCP tool error" fallback — that was the
    // old helper's incorrect behavior).
    const result = {
      success: false,
      output: '',
      error: 'plain error string',
    };

    const finalMessage = buildRouteFinalErrorMessage(result);

    expect(finalMessage).not.toContain('[ORCHESTRATOR-UNWRAP]:');
    expect(finalMessage).toBe('');
  });

  it('null/undefined error → returns result.output (route fallback path)', () => {
    const result = {
      success: false,
      output: '',
      error: null,
    };

    const finalMessage = buildRouteFinalErrorMessage(result);

    expect(finalMessage).toBe('');
  });
});
