/**
 * marker-scanner.test.ts
 *
 * Regression coverage for `web/.bing-shared/services/scheduler/triggers/
 * marker-scanner.ts` — the 2nd production caller of the prompt-orchestrator
 * foundation (paired with `unified-agent-service.ts`'s 1st caller at L1517).
 *
 * Coverage (3 cases):
 *
 *   - **Case (a) — dynamic-import fallback**: stub the importable
 *     `@/lib/orchestra/prompt-orchestrator/marker-scanner` module to throw
 *     at load time, construct a `MarkerTailingTrigger` WITHOUT injected
 *     `scanMarkersFn`, call `start()`, and assert that the thrown error
 *     contains `MarkerTailingTrigger: cannot load prompt-orchestrator/
 *     marker-scanner` plus the parallel-wording suffix. This locks the
 *     boot-without-prompt-orchestrator contract: absence of the package
 *     surfaces as a loud start() throw.
 *
 *   - **Case (b) — applyScriptFn wiring path (structural no-op)**:
 *     Inject `scanMarkersFn`, `observeApplyScriptFn`, and `poDefaultScript`
 *     into MarkerTailingOptions. Use the deterministic pattern:
 *       1. Run start() (lastOffset = file size — first auto-poll returns
 *          early because nothing is new yet).
 *       2. Write content to the log file using writeFileSync AFTER
 *          start() — this would normally only be observed by the next
 *          setInterval tick, which is timing-dependent and flaky in CI.
 *       3. INVOKE `(trigger as any).poll()` directly — bypasses the
 *          timer and synchronously reads the new bytes.
 *     Assert: observeApplyScriptFn called with the 3 positional args
 *     `(newContent, poDefaultScript, 'marker-tail')` and the input
 *     passed through unchanged (PO_DEFAULT_SCRIPT empty steps → no-op).
 *
 *   - **Case (c) — lastError tracking on applyScript failure**:
 *     Inject an observeApplyScriptFn spy that throws, then exercise one
 *     poll cycle (a real one via (trigger as any).poll() after writing
 *     content). Assert getLastError() formats the throw as
 *     `observeApplyScript failed: <message>` and that the spy call
 *     count is ≥1 (regression coverage for lastError being assigned in
 *     the catch block, not lost on a happy-path re-assign).
 *
 * Mock scope: only the 3 injected hooks (scanMarkersFn + observeApplyScriptFn
 * + poDefaultScript) are stubbed. The dynamic-imports for the real
 * `@/lib/orchestra/prompt-orchestrator/*` are NOT exercised here (covered
 * by Case (a) via the parser stub) and not relied on in the happy paths
 * (Cases b + c inject the resolved hooks directly via ctor). This keeps
 * the test surface narrow and avoids the 50+ transitive-import problem
 * from importing the full prompt-orchestrator package in a vitest run.
 */
import { vi, describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PromptScript } from '@/lib/orchestra/prompt-orchestrator'

// === Stub the marker-scanner submodule so dynamic-imports fail loudly ===
//
// The dynamic-import in MarkerTailingTrigger.start() resolves
// `@/lib/orchestra/prompt-orchestrator/marker-scanner` and immediately
// invokes `scanMarkers` against the result. For Case (a), we throw at
// load time so the start() catch block fires. For Cases (b) + (c) the
// test injects `scanMarkersFn` directly into `MarkerTailingOptions`,
// which shortcuts the dynamic-import path — so the stub doesn't matter
// for those tests, but it's harmless.
vi.mock('@/lib/orchestra/prompt-orchestrator/marker-scanner', () => {
  throw new Error('simulated: prompt-orchestrator/marker-scanner not installed')
})

// === Import SUT AFTER the mock is registered ===
const { MarkerTailingTrigger } = await import('../marker-scanner')

/**
 * Helper: allocate an empty tmp log file path. We deliberately do NOT
 * pre-populate with content because the production offset-init captures
 * `lastOffset = file.size` on start()'s stat — a pre-populated file
 * would cause the first auto-poll() to return early (no new bytes
 * seen), making tests dependent on setInterval timing. The fix in Cases
 * (b) + (c) is to write content AFTER start() and then manually invoke
 * poll() once to observe the new bytes deterministically.
 */
function makeTmpLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'marker-scanner-test-'))
  return join(dir, 'tail.log')
}

describe('marker-scanner.ts (Tier 8 step 2 2nd production caller)', () => {
  it('case (a): start() throws the parallel-wording error when the marker-scanner dynamic-import fails', async () => {
    let thrownError: unknown
    try {
      // No scanMarkersFn injected → start() must dynamic-import the stub,
      // which throws → start() throws the production error message.
      const trigger = new MarkerTailingTrigger({
        logPath: makeTmpLogPath(),
        onTrigger: () => undefined,
      })
      await trigger.start()
    } catch (err) {
      thrownError = err
    }
    expect(thrownError).toBeInstanceOf(Error)
    const msg = thrownError instanceof Error ? thrownError.message : String(thrownError)
    // Locks the production catch-block message: prefix
    // `MarkerTailingTrigger: cannot load prompt-orchestrator/marker-scanner`
    // and suffix the parallel-wording clause about the trigger set being
    // unavailable.
    expect(msg).toMatch(/MarkerTailingTrigger: cannot load prompt-orchestrator\/marker-scanner/)
    expect(msg).toMatch(/scheduler runs without it/i)
    expect(msg).toMatch(/marker-in-history triggers .* are unavailable/)
  })

  it('case (b): applyScriptFn wiring runs PO_MARKER_TAIL_SCRIPT structurally (empty steps → input passes through)', async () => {
    // Empty file at start() — lastOffset = 0, first auto-poll returns
    // early (no growth). We then write content + manually invoke poll()
    // to observe the new bytes without relying on setInterval timing.
    const logPath = makeTmpLogPath()
    const logContents = 'hello marker-tail world\n'

    const observeApplyScriptSpy = vi.fn(
      (target: string, _script: PromptScript, _source: string): string => {
        // Structural no-op: PO_MARKER_TAIL_SCRIPT has empty steps so the
        // production observeApplyScript would itself return the input;
        // we mirror that here so the assertion on `arg1 === logContents`
        // matches the production no-op-output semantics.
        return target
      },
    )

    const trigger = new MarkerTailingTrigger({
      logPath,
      onTrigger: async () => undefined,
      // Inject all 3 hooks — shortcut the dynamic-imports so the test
      // doesn't depend on the (now stubbed) prompt-orchestrator modules.
      scanMarkersFn: (_target: string) => [],
      observeApplyScriptFn: observeApplyScriptSpy,
      poDefaultScript: {
        promptId: 'marker-tail-poll',
        steps: [],
      },
    })

    await trigger.start()
    // Deterministically exercise the wiring path: write content AFTER
    // start()'s first auto-poll, then run a single poll manually.
    writeFileSync(logPath, logContents)
    await (trigger as unknown as { poll: () => Promise<void> }).poll()
    await trigger.stop()

    // The observeApplyScriptFn was called (wiring path confirmed).
    expect(observeApplyScriptSpy).toHaveBeenCalled()
    // The 3 positional args preserve the production call shape.
    const callArgs = observeApplyScriptSpy.mock.calls[0]
    expect(callArgs).toBeDefined()
    const [arg1, arg2, arg3] = callArgs!
    expect(arg1).toBe(logContents)
    expect(arg2).toEqual(
      expect.objectContaining({
        promptId: 'marker-tail-poll',
        steps: expect.arrayContaining([]),
      }),
    )
    expect(arg3).toBe('marker-tail')

    // No error was tracked (the input passed through, no throw).
    expect(trigger.getLastError()).toBeUndefined()
  })

  it('case (c): lastError tracks observeApplyScript failure and surfaces the formatted message via getLastError()', async () => {
    const logPath = makeTmpLogPath()
    const logContents = 'boom test\n'

    const observeApplyScriptFailure: Error = new Error('metric-serialization blew up')
    const observeApplyScriptSpy = vi.fn(
      (_t: string, _s: PromptScript, _src: string): string => {
        throw observeApplyScriptFailure
      },
    )

    const trigger = new MarkerTailingTrigger({
      logPath,
      onTrigger: async () => undefined,
      // Decoupled from the stub via the same shortcut pattern.
      scanMarkersFn: (_target: string) => [],
      observeApplyScriptFn: observeApplyScriptSpy,
      poDefaultScript: {
        promptId: 'marker-tail-poll',
        steps: [],
      },
    })
    await trigger.start()
    writeFileSync(logPath, logContents)
    await (trigger as unknown as { poll: () => Promise<void> }).poll()
    await trigger.stop()

    // The observeApplyScriptFn was called and threw. The production
    // poll() catch path formats the error as `observeApplyScript failed:
    // <message>` and assigns to this.lastError so /triggers/status can
    // surface it.
    expect(observeApplyScriptSpy).toHaveBeenCalled()
    expect(observeApplyScriptSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    const lastError = trigger.getLastError()
    expect(lastError).toBeDefined()
    expect(lastError).toMatch(/observeApplyScript failed:/)
    expect(lastError).toContain('metric-serialization blew up')
  })
})
