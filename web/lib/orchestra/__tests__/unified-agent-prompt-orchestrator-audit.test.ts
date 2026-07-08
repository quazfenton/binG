/**
 * unified-agent-prompt-orchestrator-audit.test.ts
 *
 * Structural integration test for the FIRST production caller of the
 * prompt-orchestrator foundation at
 * /opt/bing/web/lib/orchestra/unified-agent-service.ts.
 *
 * The applyScript call at L1512 is the entry-point path of every
 * /api/chat request, threading:
 *   - V1-API path (appendAutoInjectPowers + streamWithVercelAI)
 *   - V2 modes that don't use conversationHistory (OpenCodeEngine,
 *     StatefulAgent, Mastra) → buildAutoInjectUserMessage
 *   - All down-stream mode handlers (runV1Orchestrated, runV2Native,
 *     runOpencodeSDKMode, runMastraWorkflow, etc.)
 *
 * The production-call line (verified by `awk 'NR==1512'` on 2026-07-08):
 *   const userMsg = observeApplyScript(config.userMessage || '', PO_UNIFIED_AGENT_SCRIPT, 'unified-agent');
 *
 * ## Post-consolidation contract (2026-07-08 update)
 *
 * The `PO_DEFAULT_SCRIPT` const was promoted to a SHARED module at
 * `web/lib/orchestra/prompt-orchestrator/default-scripts.ts` and renamed
 * to `PO_UNIFIED_AGENT_SCRIPT` (per-call-site naming so observability
 * metrics keep splitting the 2 production callers). The caller file
 * imports it from the facade:
 *   import { observeApplyScript, PO_UNIFIED_AGENT_SCRIPT } from '@/lib/orchestra/prompt-orchestrator';
 *
 * Test 1 locks the call site + args. Test 2 locks the cross-file contract
 * (caller imports at module-scope + facade re-exports + default-scripts
 * defines the audit shape). Test 3 (try/catch) is unchanged.
 *
 * ## Empty-steps caveat (intentional, NOT a TODO)
 *
 * The default-scripts.ts `steps: []` value is intentionally EMPTY. The
 * caller docs at L1511-L1516 explain this. applyScript is a no-op for
 * empty scripts beyond the scanMarkers scan, so this first-caller is
 * "zero behavior change in the happy path" — it establishes the audit
 * trail for the marker-in-history scan (step 7b) and the observability
 * counters (step 8) on real production data with zero risk of regressing
 * the existing `/api/chat` request flow.
 *
 * To unlock the foundation's payload functionality, a follow-up apply
 * must add real steps (Tier 8 step 4 — round-trip writes) to
 * PO_DEFAULT_SCRIPT, OR replace the const with a `loadScript(...)` call
 * pointing at a disk-stored script. THIS TEST LOCKS THAT THE AUDIT
 * TRAIL IS WIRED CORRECTLY NOW, and will fail loudly when the
 * empty-steps caveat is finally replaced with real steps — forcing the
 * developer to (a) acknowledge the audit-trail surface change, and
 * (b) update the test name to remove the "empty-steps no-op" clause.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_PATH = join(__dirname, '..', 'unified-agent-service.ts');
const FACADE_PATH = join(__dirname, '..', 'prompt-orchestrator', 'index.ts');
const DEFAULTS_PATH = join(__dirname, '..', 'prompt-orchestrator', 'default-scripts.ts');

const serviceSrc = readFileSync(SERVICE_PATH, 'utf8');
const serviceLines = serviceSrc.split('\n');
const facadeSrc = readFileSync(FACADE_PATH, 'utf8');
const facadeLines = facadeSrc.split('\n');
const defaultsSrc = readFileSync(DEFAULTS_PATH, 'utf8');
const defaultsLines = defaultsSrc.split('\n');

describe('Unified Agent → Prompt-Orchestrator audit trail (Tier 8 step 8 first production caller; empty-steps no-op fast path)', () => {
  /**
   * Test 1 — Call-site lock.
   *
   * Hard-locks the call line number + position + 3 positional args.
   *
   * After the 2026-07-08 consolidation, the 2nd arg is `PO_UNIFIED_AGENT_SCRIPT`
   * (was `PO_DEFAULT_SCRIPT` pre-consolidation). The audit-trail intent is
   * unchanged.
   */
  it('wires observeApplyScript at L1512 with positional args (config.userMessage || "", PO_UNIFIED_AGENT_SCRIPT, "unified-agent") — empty-steps no-op fast path', () => {
    // Find the production caller — the unique line containing
    // observeApplyScript( outside of import statements + comments.
    const callIdx = serviceLines.findIndex((line) =>
      /observeApplyScript\s*\(/.test(line),
    );
    expect(callIdx).toBeGreaterThan(0);

    // HARD-LOCK the line number to L1512. If the file gains or loses
    // preceding lines, this assertion breaks — which is exactly the
    // audit-trail intent.
    expect(callIdx + 1).toBe(1512);

    // 3 positional args: (target, script, source). Each is matched
    // separately so refactors that modify ONE arg don't silently satisfy
    // the others.
    const callLine = serviceLines[callIdx];

    // First arg: sanitized userMessage (empty-string fallback).
    expect(callLine).toMatch(
      /observeApplyScript\s*\(\s*config\.userMessage\s*\|\|\s*['"]['"]\s*,/,
    );

    // Second arg: PO_UNIFIED_AGENT_SCRIPT (the shared constant imported
    // from the facade). The const shape lives in default-scripts.ts and
    // is locked by test 2 below. A future refactor that inlines the
    // const OR switches to loadScript must keep the (promptId, empty-
    // steps) shape contract — test 2 enforces the source-side contract.
    expect(callLine).toMatch(/,\s*PO_UNIFIED_AGENT_SCRIPT\s*,/);

    // Third arg: the source label that separates this call site from
    // the marker-scanner.ts poll-loop's second production caller in
    // the observability Prometheus exposition.
    expect(callLine).toMatch(/,\s*['"]unified-agent['"]\s*\)/);

    // Defensive: the production call MUST NOT be inside a comment
    // block. A future comment-only edit could introduce a line
    // matching `observeApplyScript(` and the regex above would still
    // fire — this assertion disqualifies comment lines.
    const trimmed = callLine.trim();
    expect(trimmed.startsWith('//')).toBe(false);
    expect(trimmed.startsWith('*')).toBe(false);
    expect(trimmed.startsWith('const')).toBe(true);
  });

  /**
   * Test 2 — Cross-file contract lock (the consolidation move).
   *
   * The audit shape moved from inline-in-caller to default-scripts.ts
   * (with facade re-export). This test locks the 3-file chain:
   *
   *   (a) Caller file: imports PO_UNIFIED_AGENT_SCRIPT at module-scope
   *       (no leading whitespace). Precedence constraint: import must
   *       appear BEFORE the consumer function `processUnifiedAgentRequest`.
   *   (b) Facade (`index.ts`): re-exports PO_UNIFIED_AGENT_SCRIPT from
   *       `./default-scripts`. Defends against accidentally dropping the
   *       re-export during a future refactor.
   *   (c) Source (`default-scripts.ts`): defines PO_UNIFIED_AGENT_SCRIPT
   *       with the expected (promptId, empty steps) shape. The empty-steps
   *       value is EXACTLY [] — a future refactor that adds even one
   *       step must also update the test name to remove the
   *       "empty-steps no-op" clause.
   */
  it('PO_UNIFIED_AGENT_SCRIPT is imported at module-scope + re-exported from default-scripts.ts + has the empty-steps audit shape — cross-file contract', () => {
    // (a) Caller file imports PO_UNIFIED_AGENT_SCRIPT from the facade at
    //     module-scope. The import line must start with `import` (no
    //     leading whitespace = module-scope, not function-scope).
    const importIdx = serviceLines.findIndex((line) =>
      /^import\s+\{[^}]*PO_UNIFIED_AGENT_SCRIPT[^}]*\}\s+from\s+['"]@\/lib\/orchestra\/prompt-orchestrator['"]/.test(line),
    );
    expect(importIdx).toBeGreaterThan(0);

    // Precedence: import precedes the consumer function.
    const consumerIdx = serviceLines.findIndex((line) =>
      /^export\s+async\s+function\s+processUnifiedAgentRequest/.test(line),
    );
    expect(consumerIdx).toBeGreaterThan(0);
    expect(importIdx).toBeLessThan(consumerIdx);

    // (b) Facade re-exports PO_UNIFIED_AGENT_SCRIPT from
    //     `./default-scripts`. The regex is permissive about surrounding
    //     other symbols in the same export block.
    const facadeReExportIdx = facadeLines.findIndex((line) =>
      /^\s*export\s*\{[^}]*\bPO_UNIFIED_AGENT_SCRIPT\b[^}]*\}\s*from\s+['"]\.\/default-scripts['"]/.test(line),
    );
    expect(facadeReExportIdx).toBeGreaterThan(0);

    // (c) default-scripts.ts defines PO_UNIFIED_AGENT_SCRIPT with the
    //     expected shape. Same shape contract as the previous inline
    //     const — but now at the canonical source.
    const defaultsIdx = defaultsLines.findIndex((line) =>
      /^export\s+const\s+PO_UNIFIED_AGENT_SCRIPT\s*:\s*PromptScript\s*=/.test(line),
    );
    expect(defaultsIdx).toBeGreaterThan(0);
    const defaultsBlock = defaultsLines.slice(defaultsIdx, defaultsIdx + 8).join('\n');
    expect(defaultsBlock).toMatch(/promptId:\s*['"]unified-agent-entry['"]/);
    expect(defaultsBlock).toMatch(/steps:\s*\[\s*\]/);
  });

  /**
   * Test 3 — try/catch lock (unchanged from pre-consolidation).
   *
   * Locks the contract that the observability call is non-fatal: a
   * prompt-orchestrator throw fails the same way as a powers throw.
   * A future refactor that moves the call OUT of the try/catch (or
   * throws uncaught) would silently regress every /api/chat request
   * on a prompt-orchestrator internal failure.
   */
  it('L1512 call is wrapped in try/catch (observability throw is non-fatal — fall-through skips auto-inject, request proceeds)', () => {
    const callIdx = serviceLines.findIndex((line) =>
      /observeApplyScript\s*\(/.test(line),
    );
    expect(callIdx).toBeGreaterThan(0);

    // Find the most recent `try {` strictly BEFORE the call line.
    const tryIdx = serviceLines
      .slice(0, callIdx)
      .findLastIndex((line) => /^\s*try\s*\{/.test(line));
    expect(tryIdx).toBeGreaterThan(0);

    // Find the matching `} catch (err: any)` strictly AFTER the call
    // line. Search window: 60 lines after the call site.
    const window = serviceLines.slice(callIdx, callIdx + 60);
    const catchRelIdx = window.findIndex((line) =>
      /^\s*\}\s*catch\s*\(/.test(line),
    );
    expect(catchRelIdx).toBeGreaterThan(0);

    const catchBody = window
      .slice(catchRelIdx, catchRelIdx + 5)
      .join('\n');
    expect(catchBody).toMatch(/log\.debug|log\.warn/);
    expect(catchBody).not.toMatch(/\bthrow\b/);
  });
});
