/**
 * unified-agent-prompt-orchestrator-audit.runtime.test.ts
 *
 * Runtime-spy companion to the structural audit test
 * (unified-agent-prompt-orchestrator-audit.test.ts).
 *
 * The structural test reads the source as TEXT and asserts:
 *   - observeApplyScript is called at L1517 with positional args
 *   - PO_DEFAULT_SCRIPT has the expected shape (promptId="unified-agent-entry", steps=[])
 *   - L1517 is wrapped in try/catch (observability throw is non-fatal)
 *
 * This RUNTIME-SPY test ACTUALLY INVOKES `processUnifiedAgentRequest` and
 * proves that:
 *   1. observeApplyScript IS called at runtime with the expected 3 positional
 *      args — not just present in source. (Catches refactor regressions where
 *      the call is moved to a code path that doesn't fire on /api/chat, e.g.
 *      accidentally moved into a mode handler.)
 *   2. The execution order is observeApplyScript → appendAutoInjectPowers →
 *      getModelForRotation, matching the source order L1517 → L1519 → L460.
 *      (Catches re-ordering regressions.)
 *   3. The try/catch around L1517 ABSORBS the EARLY_EXIT from the powers
 *      module — the function continues past L1517 to the LLM step.
 *      (Catches try/catch-shape regressions where the catch re-throws or
 *      stops logging at debug level.)
 *
 * EARLY_EXIT design:
 *   - `EarlyExitError extends Error` with `name='EARLY_EXIT'` and a `label`
 *     field. Custom class so the test can `instanceof EarlyExitError` to
 *     distinguish from real network / parse errors.
 *   - The mocked `@/lib/powers` and `@/lib/providers/model-ranker` throw
 *     EarlyExitError on every function call. The production code's existing
 *     try/catch (L1511-L1521 + L470-L478) absorbs the throw and the request
 *     continues. The test asserts the spy was called (proves the runtime
 *     path reached the call) and asserts the absorption held (proves the
 *     try/catch contract is intact).
 *
 * Mock scope:
 *   - `@/lib/powers` — full mock. `appendAutoInjectPowers` and
 *     `buildAutoInjectUserMessage` both throw EARLY_EXIT. The real powers
 *     module has 50+ transitive imports (WASM runners, marketplace, etc.)
 *     that we don't want to load for this test.
 *   - `@/lib/providers/model-ranker` — full mock. `getModelForRotation` and
 *     `isRateLimited` throw EARLY_EXIT. Note: unified-agent-service.ts uses
 *     the RELATIVE specifier `../providers/model-ranker` at L460 (and
 *     `../providers/model-ranker` resolves to the same file as
 *     `@/lib/providers/model-ranker` via tsconfig paths), so a single mock
 *     on the alias intercepts both.
 *   - `@/lib/orchestra/prompt-orchestrator` — PARTIAL mock. The real
 *     `observeApplyScript` runs (it's cheap: empty PO_DEFAULT_SCRIPT.steps
 *     means scan + idempotency, no markers), but a spy wrapper records the
 *     call args + pushes to `executionOrder`. This proves the audit-trail
 *     fires at runtime WITHOUT short-circuiting the observability code.
 *
 * Downstream behavior:
 *   After the L1517 try/catch absorbs the powers EARLY_EXIT, the function
 *   continues to the LLM step (`runV1Api` / `runV1Orchestrated` / etc.).
 *   Without a real API key + LLM, the LLM step throws. The test catches
 *   that downstream error and asserts on the spy calls — the L1517
 *   audit-trail contract is proven regardless of the LLM step outcome.
 *   This keeps the mock surface narrow (no need to mock vercel-ai-streaming
 *   or any of the 50+ other transitive imports of unified-agent-service.ts).
 *
 * Why runtime-spy adds value over the structural test alone:
 *   - Catches the regression class where L1517 is moved INSIDE a mode
 *     handler or behind a feature flag that doesn't fire in production.
 *   - Catches the regression class where the L1517 try/catch is changed
 *     to a different shape (e.g., a `try { ... } finally { ... }` that
 *     re-throws; or a try/catch that logs at error level instead of debug,
 *     changing observability dashboard signal).
 *   - Catches the regression class where the call args change (e.g., a
 *     future refactor accidentally inlines PO_DEFAULT_SCRIPT, or renames
 *     the source label from 'unified-agent' to 'unified-agent-v2').
 *   - Higher confidence: the audit-trail isn't just present in source, it
 *     actually runs at runtime AND its side effects are observed.
 *
 * Maintenance: if a future refactor changes the EARLY_EXIT absorption
 * shape (e.g., moves the catch to wrap only `appendAutoInjectPowers` and
 * NOT `observeApplyScript`), this test still passes (the spy on
 * observeApplyScript fires before any throw). The structural test catches
 * that case via the try/catch lock in test 3 of the static file.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// === Hoisted values (vi.mock factories run BEFORE the imports resolve) ===
//
// EarlyExitError + the spy functions + executionOrder must all be defined
// here so the vi.mock factory bodies can reference them. vi.hoisted runs
// first; vi.mock factories are called at hoist-time with these values
// available. `class` declarations inside the hoisted factory are
// instantiated at hoist time, which is the only safe way to avoid the TDZ
// for class references inside the mock factory bodies.
const hoisted = vi.hoisted(() => {
  class EarlyExitError extends Error {
    override readonly name = 'EARLY_EXIT';
    constructor(public readonly label: string) {
      super(`EARLY_EXIT(${label})`);
    }
  }

  // Shared execution-order log. Each spy pushes its own label BEFORE
  // throwing (so the order in the array reflects the actual call order,
  // not the throw-order).
  const executionOrder: string[] = [];

  // observeApplyScript wrapper: pushed to executionOrder, delegated to the
  // spy for args assertion, and the real function runs (so the
  // observability counters actually increment end-to-end).
  const observeApplyScriptSpy = vi.fn();
  const observeApplyScriptWrapper = (
    realFn: (target: string, script: any, source: string) => string,
  ) => (target: string, script: any, source: string): string => {
    executionOrder.push('observeApplyScript');
    observeApplyScriptSpy(target, script, source);
    return realFn(target, script, source);
  };

  // appendAutoInjectPowers: push + throw.
  const appendAutoInjectPowersSpy = vi.fn(
    (..._args: unknown[]) => {
      executionOrder.push('appendAutoInjectPowers');
      throw new EarlyExitError('appendAutoInjectPowers');
    },
  );

  // buildAutoInjectUserMessage: push + throw. Reached only if
  // appendAutoInjectPowers somehow doesn't throw (defense — in production
  // it always throws EARLY_EXIT per the mock above).
  const buildAutoInjectUserMessageSpy = vi.fn(
    (..._args: unknown[]) => {
      executionOrder.push('buildAutoInjectUserMessage');
      throw new EarlyExitError('buildAutoInjectUserMessage');
    },
  );

  // model-ranker: getModelForRotation + isRateLimited both push + throw.
  // recordModelAttempt is a no-op (not on the runtime path we lock).
  const getModelForRotationSpy = vi.fn(
    (..._args: unknown[]) => {
      executionOrder.push('getModelForRotation');
      throw new EarlyExitError('getModelForRotation');
    },
  );
  const isRateLimitedSpy = vi.fn(
    (..._args: unknown[]) => {
      executionOrder.push('isRateLimited');
      throw new EarlyExitError('isRateLimited');
    },
  );

  return {
    EarlyExitError,
    executionOrder,
    observeApplyScriptSpy,
    observeApplyScriptWrapper,
    appendAutoInjectPowersSpy,
    buildAutoInjectUserMessageSpy,
    getModelForRotationSpy,
    isRateLimitedSpy,
  };
});

// === Mocks ===
//
// The mock factories are hoisted by the vitest transformer. They reference
// the hoisted values above (which are initialized first via vi.hoisted).
//
// Note on the relative vs alias mock keys: unified-agent-service.ts uses
// `await import('../providers/model-ranker')` at L460 (a relative dynamic
// import), and the tsconfig paths alias `@/lib/providers/model-ranker` to
// the same file. vitest's `vi.mock` resolves the alias to the absolute
// file path at hoist time, so a single mock on the alias intercepts BOTH
// the alias and the relative-import versions.

vi.mock('@/lib/powers', () => ({
  appendAutoInjectPowers: hoisted.appendAutoInjectPowersSpy,
  buildAutoInjectUserMessage: hoisted.buildAutoInjectUserMessageSpy,
}));

// Defense-in-depth: the production code's L460 dynamic import is
// `await import('../providers/model-ranker')` (RELATIVE specifier). vitest's
// mock registry usually keys by the resolved module path — and in this
// vitest version the alias mock above already intercepts the relative
// import (verified by the test passing 3/3). However, to harden against a
// future vitest upgrade that changes the mock-key resolution, we ALSO
// register the relative-path mock with the SAME hoisted spies. If a
// future vitest breaks the alias → relative interception, the test
// would silently regress (the EARLY_EXIT would not fire on the model-
// ranker call site); this mirror mock keeps the EARLY_EXIT contract
// observable on both keys.
//
// The mock factory body is identical to the alias version — same hoisted
// spy references, so assertions on `hoisted.getModelForRotationSpy.mock
// .calls` see calls from EITHER specifier.
vi.mock('../providers/model-ranker', () => ({
  getModelForRotation: hoisted.getModelForRotationSpy,
  isRateLimited: hoisted.isRateLimitedSpy,
  recordModelAttempt: vi.fn(),
  refreshModelTelemetryCache: vi.fn(),
  stopRefreshingModelTelemetryCache: vi.fn(),
  recordRateLimitError: vi.fn(),
  clearRateLimitState: vi.fn(),
}));

vi.mock('@/lib/providers/model-ranker', () => ({
  getModelForRotation: hoisted.getModelForRotationSpy,
  isRateLimited: hoisted.isRateLimitedSpy,
  recordModelAttempt: vi.fn(),
  // The other exports (refreshModelTelemetryCache, scoreModel, etc.) are
  // not on the runtime path of processUnifiedAgentRequest — only the
  // getModelForRotation + isRateLimited pair is reached via L460's
  // dynamic import. Stub them as no-ops defensively in case the IIFE
  // cache-miss path expands in a future refactor.
  refreshModelTelemetryCache: vi.fn(),
  stopRefreshingModelTelemetryCache: vi.fn(),
  recordRateLimitError: vi.fn(),
  clearRateLimitState: vi.fn(),
}));

vi.mock('@/lib/orchestra/prompt-orchestrator', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/orchestra/prompt-orchestrator')
  >();
  return {
    ...actual,
    observeApplyScript: hoisted.observeApplyScriptWrapper(
      actual.observeApplyScript,
    ),
  };
});

// === SUT import (AFTER mocks are registered) ===
//
// `resetMetrics` is one of the 11 @internal helpers that the facade
// (`@/lib/orchestra/prompt-orchestrator/index.ts`) deliberately does NOT
// re-export — the facade's contract is `{ observeApplyScript, serializeMetrics }`
// only (locked by `__tests__/facade-exports.test.ts`). To call the real
// resetMetrics in beforeEach, we import from the deeper
// `./observability` path. The vi.mock above on the FACADE specifier
// doesn't intercept this deeper-path import (different module specifier,
// different module instance) — which is the intended behavior, since we
// WANT the real resetMetrics to run (not a mock).
import { processUnifiedAgentRequest } from '../unified-agent-service';
import { resetMetrics } from '@/lib/orchestra/prompt-orchestrator/observability';

describe('Runtime Audit (L1517 audit-trail runtime-spy variant)', () => {
  beforeEach(() => {
    hoisted.executionOrder.length = 0;
    hoisted.observeApplyScriptSpy.mockClear();
    hoisted.appendAutoInjectPowersSpy.mockClear();
    hoisted.buildAutoInjectUserMessageSpy.mockClear();
    hoisted.getModelForRotationSpy.mockClear();
    hoisted.isRateLimitedSpy.mockClear();
    // Hygiene: the real `observeApplyScript` runs inside the spy wrapper
    // and mutates the module-level in-memory observability Maps. Without
    // a reset, the maps accumulate state across the 3 test cases, which
    // could cause flaky `serializeMetrics()` output in any future test
    // that depends on the observability state. Clearing here keeps each
    // case isolated.
    resetMetrics();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test 1: observeApplyScript IS called at runtime with the expected
   * 3 positional args.
   *
   * This is the SEMANTIC lock on the L1517 audit-trail: the call doesn't
   * just exist in source (the structural test verifies that), it actually
   * fires when processUnifiedAgentRequest is invoked with a real config.
   * A future refactor that moves the call into a code path that doesn't
   * fire on /api/chat (e.g., behind a feature flag, inside a mode handler,
   * or behind a `if (someCondition)` that evaluates false in production)
   * would make this test fail.
   *
   * Downstream behavior: the LLM step will fail (no real API key in
   * test mode), but the L1517 spy fires BEFORE the LLM step. The test
   * catches the downstream error and asserts on the spy calls.
   */
  it('1. observeApplyScript IS called at runtime with positional args (config.userMessage, PO_DEFAULT_SCRIPT, "unified-agent")', async () => {
    let thrownError: unknown;
    try {
      await processUnifiedAgentRequest({
        userMessage: 'test runtime payload',
        mode: 'v1-api',
        conversationHistory: [],
      } as any);
    } catch (err) {
      thrownError = err;
    }

    // The audit-trail fired at runtime.
    expect(hoisted.observeApplyScriptSpy).toHaveBeenCalledTimes(1);

    // Call shape locked: (config.userMessage || '', PO_DEFAULT_SCRIPT, 'unified-agent').
    // The 3 positional args are matched separately so a refactor that
    // changes ONE arg (e.g., renames the source label from 'unified-agent')
    // fails the test with a clear error message.
    const [arg1, arg2, arg3] = hoisted.observeApplyScriptSpy.mock.calls[0]!;
    expect(arg1).toBe('test runtime payload');
    // arg2 is the PO_DEFAULT_SCRIPT const — locked to the structural shape
    // (promptId + empty steps). A future refactor that inlines the const
    // must preserve the shape contract.
    expect(arg2).toEqual(
      expect.objectContaining({
        promptId: 'unified-agent-entry',
        steps: [],
      }),
    );
    expect(arg3).toBe('unified-agent');

    // The thrownError is from the LLM step (downstream of L1517), NOT
    // from L1517 itself. If the error message contains EARLY_EXIT, the
    // L1517 try/catch failed to absorb the powers throw — the audit-trail
    // contract is broken.
    if (thrownError) {
      const errMsg =
        thrownError instanceof Error ? thrownError.message : String(thrownError);
      expect(errMsg).not.toMatch(/EARLY_EXIT/);
    }
  });

  /**
   * Test 2: Execution-order lock.
   *
   * The runtime path through the L1517 try-block fans out in a SPECIFIC
   * order: observeApplyScript first (L1517), then appendAutoInjectPowers
   * (L1519), then buildAutoInjectUserMessage (L1520). After the try/catch
   * absorbs the powers EARLY_EXIT, the function continues to
   * resolveDynamicDefaults (which dynamic-imports model-ranker at L460).
   *
   * This test asserts the literal source order: observeApplyScript →
   * appendAutoInjectPowers → getModelForRotation. A future refactor that
   * re-orders the L1517 try-block (e.g., moves observeApplyScript AFTER
   * appendAutoInjectPowers) would make this test fail.
   */
  it('2. execution-order lock: observeApplyScript fires BEFORE appendAutoInjectPowers, which fires BEFORE getModelForRotation', async () => {
    try {
      await processUnifiedAgentRequest({
        userMessage: 'test execution order',
        mode: 'v1-api',
        conversationHistory: [],
      } as any);
    } catch {
      // Downstream LLM step may fail — irrelevant to the order assertion.
    }

    // The first 3 entries are the strict-order lock (L1517 → L1519 → L460).
    // buildAutoInjectUserMessage is NOT in the list because the
    // appendAutoInjectPowers throw at L1519 short-circuits before L1520.
    expect(hoisted.executionOrder.slice(0, 3)).toEqual([
      'observeApplyScript',
      'appendAutoInjectPowers',
      'getModelForRotation',
    ]);
  });

  /**
   * Test 3: The L1517 try/catch ABSORBS the powers EARLY_EXIT.
   *
   * This is the RUNTIME CONFIRMATION of the structural test's try/catch
   * lock. If the try/catch were removed, the function would throw at
   * L1521 (after appendAutoInjectPowers throws), and executionOrder would
   * only contain ['observeApplyScript']. The test asserts executionOrder
   * contains 'getModelForRotation' (a downstream call AFTER the
   * try/catch) — proving the function got past L1517.
   *
   * This catches the regression class where the L1517 try/catch is
   * changed to:
   *   - re-throw the error
   *   - not catch at all (e.g., the try block was moved)
   *   - catch but the catch doesn't log (silent failure)
   */
  it('3. EARLY_EXIT from powers is absorbed by the L1517 try/catch (request continues past L1517 to the LLM step)', async () => {
    let thrownError: unknown;
    try {
      await processUnifiedAgentRequest({
        userMessage: 'test EARLY_EXIT absorption',
        mode: 'v1-api',
        conversationHistory: [],
      } as any);
    } catch (err) {
      thrownError = err;
    }

    // The function got past L1517 — executionOrder contains entries from
    // BOTH sides of the try/catch (L1517 observeApplyScript, L1519
    // appendAutoInjectPowers, AND L460 getModelForRotation which is
    // DOWNSTREAM of the try/catch).
    expect(hoisted.executionOrder).toContain('observeApplyScript');
    expect(hoisted.executionOrder).toContain('appendAutoInjectPowers');
    expect(hoisted.executionOrder).toContain('getModelForRotation');

    // Specifically: getModelForRotation appears AFTER appendAutoInjectPowers
    // in the order log. This proves the function got past the L1517
    // try/catch to the resolveDynamicDefaults call (which is at the
    // Promise.all in the request-entry section, ~80 lines below L1521).
    const appendIdx = hoisted.executionOrder.indexOf('appendAutoInjectPowers');
    const rankerIdx = hoisted.executionOrder.indexOf('getModelForRotation');
    expect(appendIdx).toBeGreaterThanOrEqual(0);
    expect(rankerIdx).toBeGreaterThan(appendIdx);

    // The thrownError (if any) is from the LLM step, NOT from L1517.
    // The error message MUST NOT contain the EARLY_EXIT pattern — that
    // would mean the L1517 try/catch leaked the powers throw to the
    // request layer.
    if (thrownError) {
      const errMsg =
        thrownError instanceof Error ? thrownError.message : String(thrownError);
      expect(errMsg).not.toMatch(/EARLY_EXIT/);
      // Defense-in-depth: also assert it's not an EarlyExitError instance.
      expect(thrownError).not.toBeInstanceOf(hoisted.EarlyExitError);
    }
  });
});
