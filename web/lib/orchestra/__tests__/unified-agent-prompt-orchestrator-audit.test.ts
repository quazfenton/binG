/**
 * unified-agent-prompt-orchestrator-audit.test.ts
 *
 * Structural integration test for the FIRST production caller of the
 * prompt-orchestrator foundation at
 * /opt/bing/web/lib/orchestra/unified-agent-service.ts.
 *
 * The applyScript call at L1517 is the entry-point path of every
 * /api/chat request, threading:
 *   - V1-API path (appendAutoInjectPowers + streamWithVercelAI)
 *   - V2 modes that don't use conversationHistory (OpenCodeEngine,
 *     StatefulAgent, Mastra) → buildAutoInjectUserMessage
 *   - All down-stream mode handlers (runV1Orchestrated, runV2Native,
 *     runOpencodeSDKMode, runMastraWorkflow, etc.)
 *
 * The production-call line (verified by `awk 'NR==1517'` on 2026-07-08):
 *   const userMsg = observeApplyScript(config.userMessage || '', PO_DEFAULT_SCRIPT, 'unified-agent');
 *
 * ## Empty-steps caveat (intentional, NOT a TODO)
 *
 * PO_DEFAULT_SCRIPT.steps is intentionally EMPTY. The source file documents
 * this in two places (L30-L36 + L1511-L1516). applyScript is a no-op for
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
 *
 * ## Why structural assertions (versus a runtime spy)
 *
 * 1. unified-agent-service.ts has 50+ transitive imports — a runtime
 *    spy test would require mocking ~10 of (`@/lib/powers`,
 *    `@/lib/providers/model-ranker`, `@/lib/bash/env-probe`,
 *    `./startup-capabilities`, `./provider-530-tracker`,
 *    `@/lib/observability/degradation-tracker`, etc.) just to
 *    short-circuit before hitting the actual LLM provider.
 * 2. The audit-trail intent is purely static (positional args + shape).
 *    Reading the source text is more durable than a runtime spy that
 *    breaks on unrelated module changes.
 * 3. Structural assertions catch refactor regressions (renaming the
 *    source label, accidentally moving the call inside a mode handler,
 *    accidentally adding a step) BEFORE they reach production.
 *
 * ## Maintenance
 *
 * If the source file moves the call line (currently L1517), update
 * the literal in test 1 below. The comment at L25 references "L1491"
 * but the actual call is L1517 once the docstring + module-level
 * const + imports are accounted for — the prior comment is stale.
 * A grep for `observeApplyScript(` will always find the real line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_PATH = join(__dirname, '..', 'unified-agent-service.ts');
const serviceSrc = readFileSync(SERVICE_PATH, 'utf8');
const serviceLines = serviceSrc.split('\n');

describe('Unified Agent → Prompt-Orchestrator audit trail (Tier 8 step 8 first production caller; empty-steps no-op fast path)', () => {
  /**
   * Primary structural lock.
   *
   * Test name explicitly documents the empty-steps no-op intent (per the
   * user's "document the empty-steps caveat in the test name" request).
   * Anyone reading the test runner output sees the caveat immediately.
   */
  it('wires observeApplyScript at L1517 with positional args (config.userMessage || "", PO_DEFAULT_SCRIPT, "unified-agent") — empty-steps no-op fast path', () => {
    // Find the production caller — the unique line containing
    // observeApplyScript( outside of import statements + comments.
    const callIdx = serviceLines.findIndex((line) =>
      /observeApplyScript\s*\(/.test(line),
    );
    expect(callIdx).toBeGreaterThan(0);

    // HARD-LOCK the line number to L1517. If the file gains or loses
    // preceding lines, this assertion breaks — which is exactly the
    // audit-trail intent. Update the literal here when the source
    // comment at L25 (which references "L1491") is reconciled.
    expect(callIdx + 1).toBe(1517);

    // 3 positional args: (target, script, source). Each is matched
    // separately so refactors that modify ONE arg don't silently satisfy
    // the others.
    const callLine = serviceLines[callIdx];

    // First arg: sanitized userMessage (empty-string fallback).
    expect(callLine).toMatch(
      /observeApplyScript\s*\(\s*config\.userMessage\s*\|\|\s*['"]['"]\s*,/,
    );

    // Second arg: the module-level PO_DEFAULT_SCRIPT const (the const
    // shape — empty steps, promptId "unified-agent-entry" — is locked
    // in the sibling test below). Do NOT match an inline-object literal
    // here; a future refactor that inlines the const should also
    // re-affirm the L30-L36 module-scope rationale.
    expect(callLine).toMatch(/,\s*PO_DEFAULT_SCRIPT\s*,/);

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
   * Locks PO_DEFAULT_SCRIPT's module-scope positioning (no indentation)
   * + its consumer direction (precedes processUnifiedAgentRequest) +
   * its shape (promptId="unified-agent-entry", steps=[]).
   */
  it('PO_DEFAULT_SCRIPT is module-scoped, precedes its consumer, and has the empty-steps audit shape — future loadScript swap target', () => {
    const idx = serviceLines.findIndex((line) =>
      /const\s+PO_DEFAULT_SCRIPT\s*:\s*PromptScript\s*=/.test(line),
    );
    expect(idx).toBeGreaterThan(0);

    // (a) Module-scope primitive: line starts with `const`. Collapses
    // "no leading whitespace" + "declaration keyword" into one semantic
    // check. Also closes a hole where a comment line matching the
    // const regex would otherwise pass the leading-whitespace check.
    // (Rigor: brace-balance walk is the gold standard, deferred until
    // the startsWith primitive is observed to misfire on the source.)
    expect(serviceLines[idx].startsWith('const')).toBe(true);

    // (b) Consumer direction: precedes processUnifiedAgentRequest.
    const consumerIdx = serviceLines.findIndex((line) =>
      /^export\s+async\s+function\s+processUnifiedAgentRequest/.test(line),
    );
    expect(consumerIdx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(consumerIdx);

    // (c) Shape: promptId + empty steps. The empty-steps value is
    // EXACTLY [] — a future refactor that adds even one step must also
    // update the test name to remove the "empty-steps no-op" clause.
    const block = serviceLines.slice(idx, idx + 8).join('\n');
    expect(block).toMatch(/promptId:\s*['"]unified-agent-entry['"]/);
    expect(block).toMatch(/steps:\s*\[\s*\]/);
  });

  /**
   * Locks the try/catch contract: the observability call is non-fatal.
   *
   * The source documents this at L1514-L1517: "Inside the existing
   * try/catch — a prompt-orchestrator throw fails the same way as a
   * powers throw. AUTO-INJECT POWERS / PROMPT SCRIPT skipped at entry
   * point" — the catch clause logs at debug level and the request
   * continues without the auto-inject context. A future refactor that
   * moves the call OUT of the try/catch (or throws uncaught) would
   * silently regress every /api/chat request on a prompt-orchestrator
   * internal failure.
   */
  it('L1517 call is wrapped in try/catch (observability throw is non-fatal — fall-through skips auto-inject, request proceeds)', () => {
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
    // line. Search window: 60 lines after the call site (the catch
    // clause is typically within a handful of lines).
    const window = serviceLines.slice(callIdx, callIdx + 60);
    const catchRelIdx = window.findIndex((line) =>
      /^\s*\}\s*catch\s*\(/.test(line),
    );
    expect(catchRelIdx).toBeGreaterThan(0);

    // The catch body must log (best-effort) and NOT re-throw — verify
    // by scanning the next 5 lines for `log.debug`/`log.warn` AND the
    // absence of `throw`. A throw would surface observability errors
    // to the request layer, which violates the documented contract.
    const catchBody = window
      .slice(catchRelIdx, catchRelIdx + 5)
      .join('\n');
    expect(catchBody).toMatch(/log\.debug|log\.warn/);
    expect(catchBody).not.toMatch(/\bthrow\b/);
  });
});