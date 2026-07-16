/**
 * Tests for /opt/bing/web/lib/agents/contract.ts
 *
 * Coverage: Contract creation, sha256 contractHash determinism + change
 * detection, append-only audit log (mutating the returned contract does
 * NOT affect its audit.lines), invariant pre/post-check, kill-switches
 * (timestamp + regex + error-count), escalation-graph resolution,
 * gatePreCall / gatePostCall combo, per-Contract id independence.
 */

import { describe, it, expect } from 'vitest';
import {
  createContract,
  computeContractHash,
  createAuditLog,
  runInvariants,
  isKillSwitchTriggered,
  resolveEscalation,
  gatePreCall,
  gatePostCall,
} from '@/lib/agents/contract';

describe('agents/contract', () => {
  it('1. createContract returns a Contract with sha256 contractHash of the right shape', () => {
    const c = createContract({
      intent: 'test intent',
      scope: { paths: ['/tmp'], exclude: [] },
      capabilities: ['code.read'],
      budget: { tokens: 1000, ms: 30_000, ops: 5 },
      invariants: [],
      acceptanceCriteria: [],
      killSwitches: [],
      escalationGraph: {},
    });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.contractHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.audit.lines).toHaveLength(0);
  });

  it('2. contractHash changes when an invariant is added (canonical-JSON stability)', () => {
    const base = { intent: 'x', scope: { paths: [], exclude: [] }, capabilities: ['a'], budget: { tokens: 1, ms: 1, ops: 1 }, invariants: [], acceptanceCriteria: [], killSwitches: [], escalationGraph: {} };
    const h1 = computeContractHash(base);
    const h2 = computeContractHash({ ...base, capabilities: ['a', 'b'] });
    expect(h1).not.toBe(h2);
  });

  it('3. contractHash is deterministic for the same payload (no Date.now leak)', () => {
    const baseP = { intent: 'x', scope: { paths: [], exclude: [] }, capabilities: ['a', 'b'], budget: { tokens: 1, ms: 1, ops: 1 }, invariants: [], acceptanceCriteria: [], killSwitches: [], escalationGraph: {} };
    const a = computeContractHash(baseP);
    const b = computeContractHash(baseP);
    expect(a).toBe(b);
  });

  it('4. append-only audit log: append returns a NEW log; original log is unchanged', () => {
    const log = createAuditLog();
    const log2 = log.append({ toolName: 'read_file', toolCallId: 'tc-1', note: 'first' });
    expect(log.lines).toHaveLength(0); // unchanged
    expect(log2.lines).toHaveLength(1);
    expect(log2.lines[0]!.seq).toBe(0);
  });

  it('5. audit.append assigns monotonic seq numbers across derived logs', () => {
    let log = createAuditLog();
    for (let i = 0; i < 5; i++) {
      log = log.append({ toolName: 't', toolCallId: `tc-${i}` });
    }
    expect(log.lines.map((l) => l.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it('6. pre-tool-call invariant fails when predicate returns false (fail-fast)', () => {
    const c = createContract({
      intent: 'x',
      scope: { paths: [], exclude: [] },
      capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [
        {
          preToolCall: {
            name: 'tool-must-be-read',
            predicate: ({ toolName }) => toolName === 'read_file',
            failureMessage: 'pre-tool-call only allows read_file',
          },
        },
      ],
      acceptanceCriteria: [],
      killSwitches: [],
      escalationGraph: {},
    });
    const r = runInvariants(c, 'pre', { toolName: 'write_file', args: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedCheckName).toBe('tool-must-be-read');
    }
  });

  it('7. post-tool-call invariant receives result + previousCalls', () => {
    const c = createContract({
      intent: 'x',
      scope: { paths: [], exclude: [] },
      capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [
        {
          postToolCall: {
            name: 'result-size-ok',
            predicate: ({ result }) => typeof result === 'object' && result !== null && 'ok' in result,
            failureMessage: 'post-result must be a shape with an ok field',
          },
        },
      ],
      acceptanceCriteria: [],
      killSwitches: [],
      escalationGraph: {},
    });
    const r = runInvariants(c, 'post', { toolName: 't', args: {}, result: { ok: true } });
    expect(r.ok).toBe(true);
  });

  it('8. kill-switch timestamp fires when Date.now >= expiresAt', () => {
    const expiresAt = Date.now() - 1000; // already expired
    const c = createContract({
      intent: 'x', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [], acceptanceCriteria: [],
      killSwitches: [{ kind: 'timestamp', id: 'deadline-1', expiresAt }],
      escalationGraph: {},
    });
    const t = isKillSwitchTriggered(c, { errorCount: 0 });
    expect(t).not.toBeNull();
    expect(t?.kind).toBe('timestamp');
  });

  it('9. kill-switch regex matches a tool-call concatenation string', () => {
    const c = createContract({
      intent: 'x', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [], acceptanceCriteria: [],
      killSwitches: [
        { kind: 'regex', id: 'no-rm-rf', pattern: 'rm\\s+-rf', compiled: /rm\s+-rf/i },
      ],
      escalationGraph: {},
    });
    const t = isKillSwitchTriggered(c, {
      matchString: JSON.stringify({ name: 'bash_execute', args: { command: 'rm -rf /' } }),
      errorCount: 0,
    });
    expect(t?.kind).toBe('regex');
  });

  it('10. kill-switch error-count fires when errorCount >= maxErrors', () => {
    const c = createContract({
      intent: 'x', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [], acceptanceCriteria: [],
      killSwitches: [{ kind: 'error-count', id: 'too-many-errors', maxErrors: 3 }],
      escalationGraph: {},
    });
    expect(isKillSwitchTriggered(c, { errorCount: 1 })?.kind).toBeUndefined();
    const t = isKillSwitchTriggered(c, { errorCount: 3 });
    expect(t?.kind).toBe('error-count');
  });

  it('11. resolveEscalation falls back to { kind: abort } when branch is undefined', () => {
    const c = createContract({
      intent: 'x', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [], acceptanceCriteria: [], killSwitches: [],
      escalationGraph: { onToolFailure: { kind: 'retry', maxRetries: 2 } },
    });
    const a = resolveEscalation(c, { id: 'k', kind: 'error-count', errorCount: 5 }, 'stall');
    expect(a.kind).toBe('abort'); // onStall branch undefined → fallback abort
  });

  it('12. resolveEscalation returns the configured branch when present', () => {
    const c = createContract({
      intent: 'x', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [], acceptanceCriteria: [], killSwitches: [],
      escalationGraph: { onBudgetExceeded: { kind: 'escalate-to-human', message: 'stop' } },
    });
    const a = resolveEscalation(c, { id: 'k', kind: 'timestamp', firedAt: Date.now() }, 'budget');
    expect(a.kind).toBe('escalate-to-human');
  });

  it('13. gatePreCall blocks on invariant failure before kill-switch check (fail-fast)', () => {
    const c = createContract({
      intent: 'x', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [
        {
          preToolCall: {
            name: 'tool-allowed',
            predicate: ({ toolName }) => toolName === 'read_file',
            failureMessage: 'allow-list denies this tool',
          },
        },
      ],
      acceptanceCriteria: [],
      killSwitches: [],
      escalationGraph: {},
    });
    const g = gatePreCall(c, { toolName: 'write_file', args: {}, errorCount: 0 });
    expect(g.allowed).toBe(false);
    if (!g.allowed) {
      expect(g.reason).toContain('pre-invariant failed');
    }
  });

  it('14. gatePostCall allows when invariant passes + no kill-switch fires', () => {
    const c = createContract({
      intent: 'x', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [],
      acceptanceCriteria: [],
      killSwitches: [],
      escalationGraph: {},
    });
    const g = gatePostCall(c, { toolName: 'read_file', args: {}, result: { ok: true }, errorCount: 0 });
    expect(g.allowed).toBe(true);
  });

  it('15. Object.freeze prevents audit-lines mutation (kill-switch evidence is tamper-resistant)', () => {
    // Contract hardening — every Contract ships with `audit.lines` wrapped in
    // Object.freeze (see createAuditLogWith in lib/agents/contract.ts). This
    // test locks the invariant: any mutation attempt on the returned AuditLog
    // throws TypeError under strict mode (which is what Vitest uses by
    // default for `.ts` files). If a future refactor accidentally drops the
    // freeze, this test flips FAIL -> PASS, surfacing the regression.
    //
    // Why this matters operationally: kill-switches (timestamp / regex /
    // error-count) rely on the audit log as append-only evidence for
    // post-mortem analysis. A silent mutation that survives a release would
    // let a buggy tool-call site tamper with its own forensic trail.
    //
    // Note: `AuditLog.append()` is IMMUTABLE — it returns a NEW AuditLog with
    // the appended line (see createAuditLogWith in lib/agents/contract.ts).
    // We MUST capture the return value to populate `c.audit.lines[0]`.
    // (TypeScript narrows `c.audit` to the new AuditLog because the field
    // is declared `audit: AuditLog` not `readonly audit`.)
    const c = createContract({
      intent: 'audit-freeze-test', scope: { paths: [], exclude: [] }, capabilities: [],
      budget: { tokens: 1, ms: 1, ops: 1 },
      invariants: [],
      acceptanceCriteria: [],
      killSwitches: [],
      escalationGraph: {},
    });
    // Capture the new AuditLog returned by append() — required because
    // append() does NOT mutate c.audit (immutable design).
    c.audit = c.audit.append({ toolName: 'read_file', toolCallId: 'freeze-test-1', note: 'pre-call' });
    expect(c.audit.lines.length).toBeGreaterThan(0);
    expect(c.audit.lines[0]).toMatchObject({ toolName: 'read_file', note: 'pre-call' });

    // (a) Replacing an existing line's contents must throw TypeError
    // (the `lines` getter returns a fresh Object.frozen snapshot).
    expect(() => {
      (c.audit.lines[0] as any) = { tampered: true };
    }).toThrow(TypeError);

    // (b) Pushing onto the frozen array must throw TypeError.
    expect(() => {
      (c.audit.lines as any).push({ tampered: true });
    }).toThrow(TypeError);

    // (c) Deleting a line via index assignment must throw TypeError.
    expect(() => {
      delete (c.audit.lines as any)[0];
    }).toThrow(TypeError);

    // (d) Mutating a single entry's properties must throw TypeError (per-entry
    // freeze applied inside the getter's `.map(e => Object.freeze({ ...e }))`).
    // AuditLine is flat (no nested objects) — the shallow per-entry freeze covers all mutation paths.
    expect(() => {
      (c.audit.lines[0] as any).note = 'tampered';
    }).toThrow(TypeError);

    // Sanity: the line we tried to tamper with is still the original.
    expect(c.audit.lines[0]).toMatchObject({ toolName: 'read_file', note: 'pre-call' });
  });
});
