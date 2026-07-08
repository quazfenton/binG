/**
 * scheduler/triggers/marker-scanner.ts
 *
 * `marker-in-history` trigger source. Tails a log file (default 5s poll)
 * and scans the new bytes for [PO-INJECT ...]...[/PO-INJECT] markers
 * (defined by the prompt-orchestrator foundation in step 1). For each
 * new marker found, fires the registered onTrigger callback with the
 * parsed marker + the source log file.
 *
 * Why polling instead of fs.watch? Polling is robust to log rotation
 * (size shrinks → reset offset to 0), slow filesystems, and the
 * "second-watcher" race that fs.watch exhibits under Node.js. The
 * 5s default keeps cost negligible for typical log volumes.
 *
 * Why dynamic import of the prompt-orchestrator scanner? The scheduler
 * is a shared service that other apps depend on; we don't want to
 * require the prompt-orchestrator to be installed. If it's not, this
 * trigger source fails loudly at start() so the operator knows.
 */
import { open, stat } from 'node:fs/promises'
import type { TriggerEvent } from '../types'

// NEW-1 followup-d at `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts`
// (2nd production caller for prompt-orchestrator foundation, L23-L37). Paired with the
// 1st production caller at `web/lib/orchestra/unified-agent-service.ts:L1517` (auto-inject
// powers site). The pair unlocks Tier 8 step 8 (observability/metrics dashboard) de-defer
// on production data — step 8 is a pure additive consumer of step 1's applyScript return
// value + step 3's metadata.json logs. Static import mirrors the 1st caller's pattern.
// Idempotent: PO_DEFAULT_SCRIPT has empty steps so the call is structural smoke-test
// (input newContent passes through unchanged; no actual markers injected). Step 8 de-defer
// requires a follow-up apply that adds a step to PO_DEFAULT_SCRIPT (or switches to
// loadScript for a disk-stored script).
// NOTE on the import split: this file preserves the boot-without-prompt-orchestrator contract
// documented at L11-L16 (the static type-only `import type { PromptScript }` below does NOT
// load the prompt-orchestrator module — TS types are compile-time only). The `applyScript` value
// is dynamic-imported in `start()` (parallel to the existing `scanMarkers` dynamic-import) and
// cached on the instance — so the scheduler still boots even when prompt-orchestrator isn't
// installed, failing loudly only when marker-in-history triggers are actually needed.
import type { PromptScript } from '@/lib/orchestra/prompt-orchestrator'

/** Subset of the InjectedMarker shape we need (avoids hard import). */
type ParsedMarker = {
  promptId: string
  step: string
  sha: string
  ts: string
  mode: string
  content: string
  startIndex: number
  endIndex: number
}

/**
 * Module-level default prompt script for the marker-in-history 2nd caller.
 * Mirrors the `PO_DEFAULT_SCRIPT` shape at `unified-agent-service.ts:L33`. Empty
 * `steps: []` makes the applyScript call structural (input passes through unchanged).
 * Future: replace with `loadScript('~/.prompt-orchestrator/scripts/marker-tail.json')`
 * when the disk-format scripts are stable + when step 8 de-defer warrants real steps.
 */
const PO_DEFAULT_SCRIPT: PromptScript = {
  promptId: 'marker-tail-poll',
  steps: [],
}

export interface MarkerTailingOptions {
  /** Path to the log file to tail. */
  logPath: string
  /** Poll interval in ms. Default 5000. */
  pollIntervalMs?: number
  /** Trigger callback. */
  onTrigger: (event: TriggerEvent) => void | Promise<void>
  /** Optional logger. */
  log?: (msg: string, ...rest: any[]) => void
  /**
   * Inject the scanner for testing. Default: dynamic import of
   * `@/lib/orchestra/prompt-orchestrator/marker-scanner`.
   */
  scanMarkersFn?: (target: string) => ParsedMarker[]
  /**
   * Inject the applyScript function for testing. Default: dynamic
   * import of `@/lib/orchestra/prompt-orchestrator/index` (resolves
   * at start() time so the scheduler boots even when the
   * prompt-orchestrator module is not installed).
   */
  // Tier 8 step 8 observability wiring: the marker-tail 2nd production caller
  // now goes through `observeApplyScript` (a drop-in wrapper around `applyScript`
  // that records counters + gauges + duration). The 3rd arg `source` becomes
  // the metric label so the dashboard splits this call site from the
  // unified-agent 1st caller. The function shape mirrors scanMarkersFn's
  // pattern (test-injectable, fallback to dynamic-import at start()).
  observeApplyScriptFn?: (target: string, script: PromptScript, source: string) => string
}

export class MarkerTailingTrigger {
  private timer: NodeJS.Timeout | null = null
  private lastOffset = 0
  private readonly log: (msg: string, ...rest: any[]) => void
  private scanMarkersFn: ((target: string) => ParsedMarker[]) | null = null
  private observeApplyScriptFn: ((target: string, script: PromptScript, source: string) => string) | null = null
  private lastError: string | undefined

  constructor(private readonly opts: MarkerTailingOptions) {
    this.log = opts.log ?? ((msg, ...rest) => console.log(msg, ...rest))
  }

  async start(): Promise<void> {
    // Resolve the scanner. If the caller injected one, use it; else try
    // the dynamic import. Cache for subsequent polls.
    if (this.opts.scanMarkersFn) {
      this.scanMarkersFn = this.opts.scanMarkersFn
    } else {
      try {
        const mod = await import('@/lib/orchestra/prompt-orchestrator/marker-scanner')
        this.scanMarkersFn = (mod as any).scanMarkers as (t: string) => ParsedMarker[]
      } catch (err: any) {
        throw new Error(
          `MarkerTailingTrigger: cannot load prompt-orchestrator/marker-scanner (${err.message}). ` +
            'The scheduler runs without it, but marker-in-history triggers (including the applyScript 2nd caller) are unavailable.',
        )
      }
    }
    // NEW-1 followup-d at `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts`
    // (start(), L101-L116) — Tier 8 step 2 2nd production caller precondition. Resolve applyScript
    // dynamically in parallel to scanMarkers above so the scheduler still boots when the
    // prompt-orchestrator module is absent (matches the existing contract at L11-L16). Both
    // resolve from the same `@/lib/orchestra/prompt-orchestrator` package — scanMarkers targets
    // the marker-scanner submodule; applyScript targets the index (top-level re-export). Failure
    // mode is identical (loud throw) so an install with missing prompt-orchestrator gives the same
    // error regardless of which entry was hit first.
    if (this.opts.observeApplyScriptFn) {
      this.observeApplyScriptFn = this.opts.observeApplyScriptFn
    } else {
      try {
        // Tier 8 step 8 observability wiring: dynamically resolve the
        // observability wrapper (NOT the bare applyScript — the wrapper
        // records metrics around the applyScript call). Resolved from
        // the `@/lib/orchestra/prompt-orchestrator/observability` submodule
        // so the scheduler still boots when the orchestrator is absent
        // (matches the existing scanMarkers dynamic-import contract).
        const mod = await import('@/lib/orchestra/prompt-orchestrator/observability')
        this.observeApplyScriptFn = (mod as any).observeApplyScript as (
          target: string,
          script: PromptScript,
          source: string,
        ) => string
      } catch (err: any) {
        throw new Error(
          `MarkerTailingTrigger: cannot load prompt-orchestrator/observability (${err.message}). ` +
            'The scheduler runs without it, but marker-in-history triggers (including the observability-wrapped 2nd caller) are unavailable.',
        )
      }
    }
    // Initialize the offset to the current end-of-file so we only see
    // NEW markers from now on, not historical ones.
    try {
      const s = await stat(this.opts.logPath)
      this.lastOffset = s.size
    } catch {
      // File doesn't exist yet — start at 0; the first successful poll
      // will catch up.
      this.lastOffset = 0
    }
    // Run the first poll immediately so we don't wait a full interval.
    await this.poll()
    this.timer = setInterval(() => this.poll(), this.opts.pollIntervalMs ?? 5000)
    this.log(`[MarkerTailingTrigger] started tailing ${this.opts.logPath}`)
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.log(`[MarkerTailingTrigger] stopped tailing ${this.opts.logPath}`)
  }

  /** Expose the most recent error so /triggers/status can surface it. */
  getLastError(): string | undefined {
    return this.lastError
  }

  private async poll(): Promise<void> {
    if (!this.scanMarkersFn) return
    try {
      const s = await stat(this.opts.logPath)
      // Log rotation: file shrank → reset to start.
      if (s.size < this.lastOffset) {
        this.lastOffset = 0
      }
      if (s.size === this.lastOffset) return

      const fh = await open(this.opts.logPath, 'r')
      try {
        const length = s.size - this.lastOffset
        const buf = Buffer.alloc(length)
        await fh.read(buf, 0, length, this.lastOffset)
        const newContent = buf.toString('utf-8')
        this.lastOffset = s.size
        const markers = this.scanMarkersFn(newContent)
        for (const m of markers) {
          await this.opts.onTrigger({
            source: 'marker-in-history',
            taskId: '', // Filled in by EventTriggerManager.
            payload: {
              logPath: this.opts.logPath,
              marker: m,
            },
            timestamp: Date.now(),
          })
        }
        // NEW-1 followup-d at `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts`
        // (poll(), L160-L181) — Tier 8 step 2 2nd production caller. Apply the foundation's
        // applyScript to the new log tail bytes AFTER the marker-firing for-loop completes.
        // Critically: applyScript is OUTSIDE the marker-firing path so a future malformed
        // script can't silently suppress onTrigger dispatches. Its own try/catch isolates
        // any foundation error from the marker-firing outcome (this.lastError surfaces the
        // error to /triggers/status). Structural: PO_DEFAULT_SCRIPT has empty steps so the
        // call is a no-op (input → same output) but wires a 2nd production data path through
        // the foundation, unlocking Tier 8 step 8 (observability) de-defer on real production
        // data. The applyScriptFn is dynamic-imported in start() (parallel to scanMarkersFn);
        // absence causes loud failure on first poll — preserves the file's boot-without-
        // prompt-orchestrator contract. Result intentionally unused; the call exists to
        // materialize the 2nd caller. To go structural → behavioral, add a step to
        // PO_DEFAULT_SCRIPT (one-line follow-up).
        try {
          // Tier 8 step 8 observability wiring: the marker-tail 2nd production
          // caller now uses `observeApplyScript` (resolves to the wrapper from
          // start()'s dynamic-import). The 3rd arg 'marker-tail' becomes the
          // counter+duration label so the dashboard splits this call site
          // from the unified-agent 1st caller. PO_DEFAULT_SCRIPT has empty
          // steps so no markers are injected — the wrapper still records a
          // duration sample every poll cycle (true positive signal that the
          // observability path is reaching production).
          if (this.observeApplyScriptFn) {
            this.observeApplyScriptFn(newContent, PO_DEFAULT_SCRIPT, 'marker-tail')
          }
          this.lastError = undefined
        } catch (err: any) {
          this.lastError = `observeApplyScript failed: ${err.message}`
        }
      } finally {
        await fh.close()
      }
    } catch (err: any) {
      // ENOENT is normal if the log file is rotated away or not yet
      // created. Record the error but don't crash.
      this.lastError = err.message
    }
  }
}
