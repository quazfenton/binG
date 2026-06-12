/**
 * ProcessMemoryMonitor — Bug #8 fix
 *
 * Closes the run.log audit "Memory growth 484 MB → 1 GB+ in 4 min, survives
 * GC" by instrumenting the Node.js process with:
 *   - A periodic tick that samples `process.memoryUsage().heapUsed`.
 *   - A **soft-throttle** threshold (default 1.2 GB): emits a `[WARN]` log,
 *     fires an `onAlert` callback with `severity: 'warning'`, and flips
 *     `shouldThrottle()` to `true` so callers (chat route, agent loop) can
 *     shed new request load.
 *   - A **critical** threshold (default 1.8 GB): emits a `[CRITICAL]` log,
 *     fires an `onAlert` callback with `severity: 'critical'`, captures a
 *     V8 heap snapshot via `v8.writeHeapSnapshot()` (best-effort, never
 *     throws), and keeps `shouldThrottle()` at `true` until the heap drops
 *     back below the soft threshold with hysteresis.
 *
 * Why this matters: prior to this fix, a 4-minute memory climb from 484 MB
 * to 1 GB+ was completely silent. Operators had no way to know which
 * request spiked the heap, no way to shed load before the worker OOM'd,
 * and no heap snapshot to postmortem.
 *
 * Design notes:
 *   - Singleton: `processMemoryMonitor` is exported and is what callers use.
 *     Tests can use the `createProcessMemoryMonitor()` factory to get an
 *     isolated instance with custom thresholds.
 *   - Tick interval: `MEMORY_TICK_INTERVAL_MS` (default 10_000). Cheap
 *     enough to run in any deployment, slow enough to not itself contribute
 *     to heap pressure.
 *   - Heap snapshots: captured only at the **critical** crossing (not every
 *     tick), and capped to one snapshot per `MEMORY_SNAPSHOT_COOLDOWN_MS`
 *     (default 5 min) so a sustained critical state doesn't fill the disk.
 *   - Hysteresis: `shouldThrottle()` stays `true` until `heapUsed` drops
 *     below `(softThreshold * HYSTERESIS_RATIO)` (default 0.9) — prevents
 *     flapping around the threshold.
 *   - Thresholds are in **MB** (int operator-friendly), env-tunable via
 *     `MEMORY_SOFT_THROTTLE_MB` (default 1228) and
 *     `MEMORY_CRITICAL_MB` (default 1843).
 *   - Best-effort: every code path is wrapped in try/catch and never
 *     throws out of the tick. A misconfigured monitor must not crash the
 *     worker.
 *
 * @module process-memory-monitor
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('ProcessMemoryMonitor');

// ============================================================================
// Configuration
// ============================================================================

/**
 * Tunable knobs. All have env-var fallbacks so production can adjust
 * thresholds without a code change.
 */
export interface ProcessMemoryMonitorConfig {
  /** Soft-throttle threshold in MB. Above this, shouldThrottle() flips to true and a [WARN] is logged. */
  softThrottleMb: number;
  /** Critical threshold in MB. Above this, a [CRITICAL] is logged and a heap snapshot is captured. */
  criticalMb: number;
  /** Tick interval in ms. */
  tickIntervalMs: number;
  /** Cooldown between heap snapshots in ms. Prevents disk fill in a sustained critical state. */
  snapshotCooldownMs: number;
  /**
   * Hysteresis ratio: shouldThrottle() stays true until heapUsed drops below
   * `softThrottleMb * hysteresisRatio` (in MB). 0.9 = 10% below soft threshold.
   * Set to 0 to disable hysteresis (instant flip when crossing).
   */
  hysteresisRatio: number;
  /**
   * When true, the monitor auto-starts on first `shouldThrottle()` / `getStatus()`
   * call if it hasn't been started explicitly. Useful in serverless / Next.js
   * route handlers that don't have a clean module-init hook. Set to false in
   * tests to keep the monitor idle.
   */
  autoStart: boolean;
  /**
   * Directory for V8 heap snapshots. Defaults to `./heap-snapshots/` in CWD.
   * The directory is created on first snapshot if it doesn't exist.
   */
  snapshotDir: string;
}

const DEFAULT_CONFIG: ProcessMemoryMonitorConfig = {
  softThrottleMb: 1024,       // 1 GB (Bug #43: down from 1228 — observed steady-state 890 MB)
  criticalMb: 1843,           // 1.8 GB
  tickIntervalMs: 10_000,     // 10 s
  snapshotCooldownMs: 300_000, // 5 min
  hysteresisRatio: 0.9,
  autoStart: true,
  snapshotDir: './heap-snapshots',
};

/** Read env-var overrides. Returns a partial config — caller fills in defaults. */
function readEnvOverrides(): Partial<ProcessMemoryMonitorConfig> {
  const out: Partial<ProcessMemoryMonitorConfig> = {};
  const soft = Number.parseInt(process.env.MEMORY_SOFT_THROTTLE_MB ?? '', 10);
  if (Number.isFinite(soft) && soft > 0) out.softThrottleMb = soft;
  const critical = Number.parseInt(process.env.MEMORY_CRITICAL_MB ?? '', 10);
  if (Number.isFinite(critical) && critical > 0) out.criticalMb = critical;
  const tick = Number.parseInt(process.env.MEMORY_TICK_INTERVAL_MS ?? '', 10);
  if (Number.isFinite(tick) && tick >= 1000) out.tickIntervalMs = tick;
  const cooldown = Number.parseInt(process.env.MEMORY_SNAPSHOT_COOLDOWN_MS ?? '', 10);
  if (Number.isFinite(cooldown) && cooldown >= 0) out.snapshotCooldownMs = cooldown;
  const hys = Number.parseFloat(process.env.MEMORY_HYSTERESIS_RATIO ?? '');
  if (Number.isFinite(hys) && hys >= 0 && hys < 1) out.hysteresisRatio = hys;
  if (process.env.MEMORY_AUTO_START === 'false') out.autoStart = false;
  if (process.env.MEMORY_SNAPSHOT_DIR) out.snapshotDir = process.env.MEMORY_SNAPSHOT_DIR;
  return out;
}

// ============================================================================
// Public types
// ============================================================================

/** Alert severity emitted when a threshold is crossed. */
export type ProcessMemoryAlertSeverity = 'warning' | 'critical';

/** An alert fired by the monitor. */
export interface ProcessMemoryAlert {
  severity: ProcessMemoryAlertSeverity;
  /** Current heapUsed in bytes. */
  heapUsedBytes: number;
  /** Current heapUsed in MB (rounded to int). */
  heapUsedMb: number;
  /** Threshold that was crossed, in MB. */
  thresholdMb: number;
  /** Epoch ms when the alert fired. */
  timestamp: number;
  /** Path to the heap snapshot, if one was captured. */
  snapshotPath?: string;
}

/** Snapshot of the monitor's current state. Exposed via getStatus() and /api/health. */
export interface ProcessMemoryStatus {
  /** Current heapUsed in MB, or null if process.memoryUsage() threw. */
  heapUsedMb: number | null;
  /** Current rss in MB, or null if process.memoryUsage() threw. */
  rssMb: number | null;
  /** Current external memory in MB, or null if process.memoryUsage() threw. */
  externalMb: number | null;
  /** Soft-throttle threshold in MB. */
  softThrottleMb: number;
  /** Critical threshold in MB. */
  criticalMb: number;
  /** True if shouldThrottle() is currently true. */
  throttled: boolean;
  /** Severity of the most recent alert ('warning' | 'critical' | null). */
  lastAlertSeverity: ProcessMemoryAlertSeverity | null;
  /** Epoch ms of the most recent alert, or null. */
  lastAlertAtMs: number | null;
  /** Path to the most recent heap snapshot, or null. */
  lastSnapshotPath: string | null;
  /** Total number of alerts fired since process start. */
  alertCount: number;
  /** Number of times the monitor has ticked (sampled). */
  tickCount: number;
  /** Whether the monitor is currently running. */
  running: boolean;
  /** Epoch ms when the monitor started, or null. */
  startedAtMs: number | null;
  /** True if process.memoryUsage() threw on the last status read. */
  memoryApiError: boolean;
}

/** Listener for alert events. */
export type ProcessMemoryAlertListener = (alert: ProcessMemoryAlert) => void;

// ============================================================================
// Monitor
// ============================================================================

/**
 * ProcessMemoryMonitor — periodic heap sampler with soft-throttle/critical
 * thresholds, alert events, and best-effort heap snapshot capture.
 *
 * Use the exported singleton `processMemoryMonitor` in production; use
 * `createProcessMemoryMonitor(config)` in tests for isolation.
 */
export class ProcessMemoryMonitor extends EventEmitter {
  private readonly config: ProcessMemoryMonitorConfig;
  private interval: NodeJS.Timeout | null = null;
  private throttled = false;
  private lastAlertSeverity: ProcessMemoryAlertSeverity | null = null;
  private lastAlertAtMs: number | null = null;
  private lastSnapshotPath: string | null = null;
  private lastSnapshotAtMs = 0;
  private alertCount = 0;
  private tickCount = 0;
  private startedAtMs: number | null = null;
  private explicitStart = false;

  constructor(configOverrides: Partial<ProcessMemoryMonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...readEnvOverrides(), ...configOverrides };

    if (this.config.softThrottleMb >= this.config.criticalMb) {
      // Invalid config: soft must be strictly less than critical. Fall back to defaults
      // with a warning so the monitor still runs.
      logger.warn('[ProcessMemoryMonitor] softThrottleMb >= criticalMb — falling back to defaults', {
        configuredSoft: this.config.softThrottleMb,
        configuredCritical: this.config.criticalMb,
      });
      this.config.softThrottleMb = DEFAULT_CONFIG.softThrottleMb;
      this.config.criticalMb = DEFAULT_CONFIG.criticalMb;
    }
  }

  /** Start the periodic tick. Idempotent. */
  start(): void {
    if (this.interval) return;
    this.explicitStart = true;
    this.startedAtMs = Date.now();
    this.interval = setInterval(() => this.tick(), this.config.tickIntervalMs);
    // Don't keep the process alive just for the monitor.
    if (typeof this.interval.unref === 'function') this.interval.unref();
    logger.info('[ProcessMemoryMonitor] started', {
      softThrottleMb: this.config.softThrottleMb,
      criticalMb: this.config.criticalMb,
      tickIntervalMs: this.config.tickIntervalMs,
    });
  }

  /** Stop the periodic tick. Idempotent. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.startedAtMs !== null) {
      logger.info('[ProcessMemoryMonitor] stopped', {
        uptimeMs: Date.now() - this.startedAtMs,
        tickCount: this.tickCount,
        alertCount: this.alertCount,
      });
    }
    this.explicitStart = false;
  }

  /**
   * Sample memory once and run the threshold logic. Called by the interval
   * but also exposed for tests / manual probing.
   *
   * Never throws.
   */
  tick(): void {
    this.tickCount += 1;
    try {
      const mu = process.memoryUsage();
      const heapUsedMb = Math.round(mu.heapUsed / 1024 / 1024);
      const rssMb = Math.round(mu.rss / 1024 / 1024);
      const externalMb = Math.round(mu.external / 1024 / 1024);

      // 1. Critical takes priority over soft.
      if (heapUsedMb >= this.config.criticalMb) {
        const alert = this.fireAlert('critical', mu.heapUsed, heapUsedMb, this.config.criticalMb);
        // Try to capture a heap snapshot (best-effort, never throws out).
        this.trySnapshot(alert).catch(() => {
          // trySnapshot already swallows; this is belt-and-suspenders.
        });
        this.throttled = true;
        return;
      }

      // 2. Soft threshold.
      if (heapUsedMb >= this.config.softThrottleMb) {
        if (!this.throttled) {
          this.fireAlert('warning', mu.heapUsed, heapUsedMb, this.config.softThrottleMb);
        }
        this.throttled = true;
        return;
      }

      // 3. Below soft — apply hysteresis before clearing throttle.
      const clearThresholdMb = this.config.hysteresisRatio > 0
        ? Math.floor(this.config.softThrottleMb * this.config.hysteresisRatio)
        : this.config.softThrottleMb;
      if (this.throttled && heapUsedMb < clearThresholdMb) {
        logger.info('[ProcessMemoryMonitor] heap below soft-threshold hysteresis — clearing throttle', {
          heapUsedMb,
          clearThresholdMb,
          rssMb,
          externalMb,
        });
        this.throttled = false;
      }
    } catch (err: any) {
      // NEVER throw out of tick — a misconfigured monitor must not crash the worker.
      logger.error('[ProcessMemoryMonitor] tick failed', { error: err?.message });
    }
  }

  /**
   * Returns true if the monitor currently believes new request load should
   * be shed. Callers (chat route, agent loop, etc.) can use this to return
   * a 503 early and avoid pushing the heap further.
   *
   * Auto-starts the monitor on first call if `autoStart` is true.
   */
  shouldThrottle(): boolean {
    this.ensureStarted();
    return this.throttled;
  }

  /** Get a snapshot of the monitor's current state. */
  getStatus(): ProcessMemoryStatus {
    this.ensureStarted();
    // process.memoryUsage() can theoretically throw in low-memory situations
    // (Node 18+ has the `memoryUsage` API documented as non-throwing but
    // some sandboxed runtimes have been observed to fail). We never want
    // getStatus() to throw — fall back to `null` for the memory fields and
    // set `memoryApiError: true` so operators reading /api/health can
    // distinguish "API broken" from "0 MB used". A zero fallback would
    // silently mask a real failure.
    let mu: NodeJS.MemoryUsage | null = null;
    let memoryApiError = false;
    try {
      mu = process.memoryUsage();
    } catch (err: any) {
      logger.error('[ProcessMemoryMonitor] getStatus: process.memoryUsage() threw', { error: err?.message });
      memoryApiError = true;
    }
    return {
      heapUsedMb: mu ? Math.round(mu.heapUsed / 1024 / 1024) : null,
      rssMb: mu ? Math.round(mu.rss / 1024 / 1024) : null,
      externalMb: mu ? Math.round(mu.external / 1024 / 1024) : null,
      softThrottleMb: this.config.softThrottleMb,
      criticalMb: this.config.criticalMb,
      throttled: this.throttled,
      lastAlertSeverity: this.lastAlertSeverity,
      lastAlertAtMs: this.lastAlertAtMs,
      lastSnapshotPath: this.lastSnapshotPath,
      alertCount: this.alertCount,
      tickCount: this.tickCount,
      running: this.interval !== null,
      startedAtMs: this.startedAtMs,
      memoryApiError,
    };
  }

  /** Read the current config. Useful for tests and /api/health debug. */
  getConfig(): Readonly<ProcessMemoryMonitorConfig> {
    return this.config;
  }

  /**
   * Reset all in-memory state. Does NOT restart the interval — caller can
   * call start() afterwards. Used by tests for isolation.
   */
  reset(): void {
    this.stop();
    this.throttled = false;
    this.lastAlertSeverity = null;
    this.lastAlertAtMs = null;
    this.lastSnapshotPath = null;
    this.lastSnapshotAtMs = 0;
    this.alertCount = 0;
    this.tickCount = 0;
    this.startedAtMs = null;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private ensureStarted(): void {
    if (!this.interval && this.config.autoStart && !this.explicitStart) {
      // Mark as auto-started (not explicit) so stop() doesn't think the user
      // called it. We still start the interval so shouldThrottle() reflects
      // current reality.
      this.startedAtMs = Date.now();
      this.interval = setInterval(() => this.tick(), this.config.tickIntervalMs);
      if (typeof this.interval.unref === 'function') this.interval.unref();
      // Sample the current heap immediately so the first shouldThrottle() /
      // getStatus() call reflects reality (not the default `throttled:false`).
      // Without this, a warm Lambda container or hot-reloaded worker that
      // comes up already over the soft threshold would return `false` on the
      // first check, shedding no load until the first interval tick (10 s later).
      //
      // Defer the first tick to the next macrotask so listeners that attach
      // to the 'alert' event synchronously AFTER the first shouldThrottle()
      // call still get notified. setImmediate is the cheapest way to break
      // the "register listener → first call fires alert before listener is
      // attached" race.
      setImmediate(() => this.tick());
      logger.info('[ProcessMemoryMonitor] auto-started (lazy on first shouldThrottle/getStatus)', {
        softThrottleMb: this.config.softThrottleMb,
        criticalMb: this.config.criticalMb,
        tickIntervalMs: this.config.tickIntervalMs,
      });
    }
  }

  private fireAlert(
    severity: ProcessMemoryAlertSeverity,
    heapUsedBytes: number,
    heapUsedMb: number,
    thresholdMb: number,
  ): ProcessMemoryAlert {
    this.lastAlertSeverity = severity;
    this.lastAlertAtMs = Date.now();
    this.alertCount += 1;
    const alert: ProcessMemoryAlert = {
      severity,
      heapUsedBytes,
      heapUsedMb,
      thresholdMb,
      timestamp: this.lastAlertAtMs,
    };
    const level = severity === 'critical' ? '[CRITICAL]' : '[WARN]';
    logger.warn(`${level} ProcessMemoryMonitor threshold crossed`, {
      severity,
      heapUsedMb,
      thresholdMb,
      alertCount: this.alertCount,
    });
    try {
      this.emit('alert', alert);
    } catch (err: any) {
      // An alert listener that throws must not crash the monitor.
      logger.error('[ProcessMemoryMonitor] alert listener threw', { error: err?.message });
    }
    return alert;
  }

  /**
   * Best-effort V8 heap snapshot capture. The `v8` module is built into
   * Node and is always available, but the write can fail (disk full,
   * permission denied). We log and swallow — never throw.
   *
   * Cooldown: at most one snapshot per `snapshotCooldownMs` to avoid
   * filling the disk during a sustained critical state.
   */
  private async trySnapshot(alert: ProcessMemoryAlert): Promise<void> {
    const now = Date.now();
    if (now - this.lastSnapshotAtMs < this.config.snapshotCooldownMs) {
      return;
    }
    try {
      // Dynamic import keeps this module lightweight for callers that only
      // want shouldThrottle() (e.g. middleware) and avoids a hard dep.
      const v8 = await import('node:v8');
      const fs = await import('node:fs');
      const path = await import('node:path');

      // Ensure directory exists.
      try {
        fs.mkdirSync(this.config.snapshotDir, { recursive: true });
      } catch { /* best effort */ }

      const filename = `heap-${alert.timestamp}-${alert.heapUsedMb}MB.heapsnapshot`;
      const fullPath = path.resolve(this.config.snapshotDir, filename);
      v8.writeHeapSnapshot(fullPath);
      this.lastSnapshotPath = fullPath;
      this.lastSnapshotAtMs = now;
      alert.snapshotPath = fullPath;
      logger.warn('[ProcessMemoryMonitor] heap snapshot captured', {
        path: fullPath,
        heapUsedMb: alert.heapUsedMb,
      });
    } catch (err: any) {
      logger.error('[ProcessMemoryMonitor] heap snapshot failed', {
        error: err?.message,
        heapUsedMb: alert.heapUsedMb,
      });
    }
  }
}

// ============================================================================
// Factory + singleton
// ============================================================================

/**
 * Create a new monitor instance. Use in tests for isolation; production
 * should use the exported `processMemoryMonitor` singleton.
 */
export function createProcessMemoryMonitor(
  configOverrides: Partial<ProcessMemoryMonitorConfig> = {},
): ProcessMemoryMonitor {
  return new ProcessMemoryMonitor(configOverrides);
}

/** Process-wide singleton monitor. Auto-starts on first shouldThrottle() / getStatus() call. */
export const processMemoryMonitor = new ProcessMemoryMonitor();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wrap a request handler so it short-circuits with a 503 + Retry-After when
 * the process is over its soft-throttle threshold. The handler is only
 * invoked when shouldThrottle() is false.
 *
 * Usage:
 *   export const POST = withMemoryThrottle(async (req) => { ... });
 *
 * If the handler is async and returns a Response/NextResponse, it's returned
 * as-is. If it throws, the error propagates.
 */
export function withMemoryThrottle<THandler extends (...args: any[]) => any>(
  handler: THandler,
  options: { retryAfterSeconds?: number } = {},
): THandler {
  const retryAfter = options.retryAfterSeconds ?? 30;
  return (async (...args: any[]) => {
    if (processMemoryMonitor.shouldThrottle()) {
      const status = processMemoryMonitor.getStatus();
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Server is under memory pressure. Please retry shortly.',
          errorCode: 'MEMORY_PRESSURE',
          retryable: true,
          retryAfterSeconds: retryAfter,
          memory: {
            heapUsedMb: status.heapUsedMb,
            softThrottleMb: status.softThrottleMb,
            criticalMb: status.criticalMb,
            throttled: status.throttled,
          },
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        },
      );
    }
    return await handler(...args);
  }) as unknown as THandler;
}
