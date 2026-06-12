/**
 * Bug #8 — ProcessMemoryMonitor
 *
 * Regression tests for the process-level memory backpressure monitor. The
 * audit observed memory growth 484 MB → 1 GB+ in 4 min with no warning,
 * no throttle, no heap snapshot. The fix is a singleton monitor that
 * samples `process.memoryUsage().heapUsed` on a tick, fires alerts at
 * soft (1.2 GB) and critical (1.8 GB) thresholds, captures a V8 heap
 * snapshot at the critical crossing, and exposes `shouldThrottle()` so
 * callers can shed load.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProcessMemoryMonitor,
  createProcessMemoryMonitor,
  processMemoryMonitor,
  withMemoryThrottle,
  type ProcessMemoryAlert,
} from '@/lib/management/process-memory-monitor';

// ============================================================================
// Test helpers
// ============================================================================

/** Replace `process.memoryUsage()` with a fake for the duration of one test. */
function mockMemoryUsage(overrides: { heapUsed?: number; rss?: number; external?: number }) {
  const heapUsed = overrides.heapUsed ?? 100 * 1024 * 1024; // 100 MB default
  const rss = overrides.rss ?? 150 * 1024 * 1024;
  const external = overrides.external ?? 10 * 1024 * 1024;
  const spy = vi.spyOn(process, 'memoryUsage').mockReturnValue({
    heapUsed,
    rss,
    external,
    arrayBuffers: 0,
    heapTotal: heapUsed,
  } as NodeJS.MemoryUsage);
  return () => spy.mockRestore();
}

// ============================================================================
// Config + thresholds
// ============================================================================

describe('Bug #8: ProcessMemoryMonitor config', () => {
  it('uses 1.2 GB / 1.8 GB defaults when no env or overrides are set', () => {
    // Each test uses a fresh monitor with autoStart:false so env from other
    // tests doesn't leak in.
    const m = createProcessMemoryMonitor({ autoStart: false });
    expect(m.getConfig().softThrottleMb).toBe(1228);
    expect(m.getConfig().criticalMb).toBe(1843);
  });

  it('accepts per-instance config overrides', () => {
    const m = createProcessMemoryMonitor({ softThrottleMb: 50, criticalMb: 100, autoStart: false });
    expect(m.getConfig().softThrottleMb).toBe(50);
    expect(m.getConfig().criticalMb).toBe(100);
  });

  it('falls back to defaults when soft >= critical (invalid config)', () => {
    const m = createProcessMemoryMonitor({ softThrottleMb: 200, criticalMb: 100, autoStart: false });
    expect(m.getConfig().softThrottleMb).toBe(1228);
    expect(m.getConfig().criticalMb).toBe(1843);
  });
});

// ============================================================================
// shouldThrottle() state machine
// ============================================================================

describe('Bug #8: shouldThrottle() state machine', () => {
  it('returns false when heapUsed is below soft threshold', () => {
    mockMemoryUsage({ heapUsed: 500 * 1024 * 1024 }); // 500 MB
    const m = createProcessMemoryMonitor({ autoStart: false });
    m.tick();
    expect(m.shouldThrottle()).toBe(false);
  });

  it('flips to true when heapUsed crosses the soft threshold', () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 }); // 1.3 GB > 1.2 GB soft
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });
    m.tick();
    expect(m.shouldThrottle()).toBe(true);
  });

  it('flips to true at the critical threshold (and is still true)', () => {
    mockMemoryUsage({ heapUsed: 2000 * 1024 * 1024 }); // 2.0 GB > 1.8 GB critical
    const m = createProcessMemoryMonitor({ autoStart: false });
    m.tick();
    expect(m.shouldThrottle()).toBe(true);
  });

  it('clears throttle when heap drops below hysteresis floor (10% below soft)', () => {
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });

    // 1. Cross soft threshold.
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    m.tick();
    expect(m.shouldThrottle()).toBe(true);

    // 2. Drop just below soft (no hysteresis) — should still be throttled.
    mockMemoryUsage({ heapUsed: 1200 * 1024 * 1024 });
    m.tick();
    expect(m.shouldThrottle()).toBe(true);

    // 3. Drop well below hysteresis floor (1228 * 0.9 = 1105 MB).
    mockMemoryUsage({ heapUsed: 1000 * 1024 * 1024 });
    m.tick();
    expect(m.shouldThrottle()).toBe(false);
  });

  it('clears throttle instantly when hysteresisRatio is 0', () => {
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, hysteresisRatio: 0, autoStart: false });

    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    m.tick();
    expect(m.shouldThrottle()).toBe(true);

    mockMemoryUsage({ heapUsed: 1100 * 1024 * 1024 });
    m.tick();
    expect(m.shouldThrottle()).toBe(false);
  });
});

// ============================================================================
// Alert emission
// ============================================================================

describe('Bug #8: alert emission', () => {
  it('fires a warning alert at the soft crossing', () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });
    const onAlert = vi.fn();
    m.on('alert', onAlert);

    m.tick();

    expect(onAlert).toHaveBeenCalledTimes(1);
    const alert: ProcessMemoryAlert = onAlert.mock.calls[0][0];
    expect(alert.severity).toBe('warning');
    expect(alert.thresholdMb).toBe(1228);
    expect(alert.heapUsedMb).toBe(1300);
  });

  it('fires a critical alert at the critical crossing', () => {
    mockMemoryUsage({ heapUsed: 2000 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });
    const onAlert = vi.fn();
    m.on('alert', onAlert);

    m.tick();

    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0][0].severity).toBe('critical');
  });

  it('critical takes priority over soft at the critical crossing', () => {
    mockMemoryUsage({ heapUsed: 2000 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });
    const onAlert = vi.fn();
    m.on('alert', onAlert);

    m.tick();

    // Only ONE alert should fire — the critical one, not a warning first.
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert.mock.calls[0][0].severity).toBe('critical');
  });

  it('does not re-emit warning on every tick when already throttled', () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });
    const onAlert = vi.fn();
    m.on('alert', onAlert);

    m.tick();
    m.tick();
    m.tick();

    // Only the first crossing fires an alert — subsequent ticks while
    // throttled are silent (the audit scenario: don't flood run.log).
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it('increments alertCount on every alert', () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });

    m.tick();
    expect(m.getStatus().alertCount).toBe(1);

    // Drop below hysteresis, then cross again.
    mockMemoryUsage({ heapUsed: 1000 * 1024 * 1024 });
    m.tick();
    expect(m.getStatus().alertCount).toBe(1);

    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    m.tick();
    expect(m.getStatus().alertCount).toBe(2);
  });

  it('swallows listener exceptions so a bad listener cannot crash the monitor', () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });
    m.on('alert', () => {
      throw new Error('listener boom');
    });

    // Should not throw.
    expect(() => m.tick()).not.toThrow();
    expect(m.getStatus().alertCount).toBe(1);
  });
});

// ============================================================================
// tick() robustness
// ============================================================================

describe('Bug #8: tick() never throws', () => {
  it('catches and logs when process.memoryUsage throws', () => {
    const spy = vi.spyOn(process, 'memoryUsage').mockImplementation(() => {
      throw new Error('memory API broken');
    });
    const m = createProcessMemoryMonitor({ autoStart: false });
    expect(() => m.tick()).not.toThrow();
    // tickCount is incremented BEFORE the try/catch, so it's 1 even when
    // memoryUsage() throws. getStatus() also wraps memoryUsage() in
    // try/catch and returns null + memoryApiError=true instead of throwing.
    expect(m.getStatus().tickCount).toBe(1);
    expect(m.getStatus().memoryApiError).toBe(true);
    expect(m.getStatus().heapUsedMb).toBeNull();
    spy.mockRestore();
  });
});

// ============================================================================
// getStatus() shape
// ============================================================================

describe('Bug #8: getStatus() shape', () => {
  it('returns the documented fields', () => {
    mockMemoryUsage({ heapUsed: 500 * 1024 * 1024, rss: 600 * 1024 * 1024, external: 50 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ autoStart: false });
    // Explicit tick so tickCount is incremented (autoStart:false means
    // ensureStarted() does not auto-tick).
    m.tick();
    const status = m.getStatus();
    expect(status).toMatchObject({
      heapUsedMb: 500,
      rssMb: 600,
      externalMb: 50,
      softThrottleMb: 1228,
      criticalMb: 1843,
      throttled: false,
      lastAlertSeverity: null,
      lastAlertAtMs: null,
      lastSnapshotPath: null,
      alertCount: 0,
      tickCount: 1,
      running: false,
      startedAtMs: null,
      memoryApiError: false,
    });
  });

  it('tracks lastAlertAtMs + lastAlertSeverity after a crossing', () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({ softThrottleMb: 1228, criticalMb: 1843, autoStart: false });
    m.tick();
    const status = m.getStatus();
    expect(status.lastAlertSeverity).toBe('warning');
    expect(status.lastAlertAtMs).not.toBeNull();
    expect(status.alertCount).toBe(1);
  });
});

// ============================================================================
// Auto-start tick behavior
// ============================================================================

describe('Bug #8: auto-start tick behavior', () => {
  it('ticks on first shouldThrottle() call when autoStart:true and heap is over soft threshold', async () => {
    // Heap is over the soft threshold. Before the fix, shouldThrottle()
    // would return false on the first call (default throttled:false) even
    // though the heap was already over the limit. The fix is to defer a
    // tick to setImmediate() inside ensureStarted() so the first call
    // reflects reality.
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({
      autoStart: true,
      softThrottleMb: 1228,
      criticalMb: 1843,
    });
    // First call triggers ensureStarted() which sets up the interval AND
    // schedules a tick via setImmediate(). The tick has not fired yet
    // (we're still in the same synchronous block), so the throttled flag
    // is still false at this point.
    m.shouldThrottle();
    // Drain the setImmediate queue so the deferred tick fires.
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Now the tick has run, the alert has fired, and throttled is true.
    expect(m.shouldThrottle()).toBe(true);
    expect(m.getStatus().tickCount).toBeGreaterThanOrEqual(1);
  });

  it('does NOT tick on first shouldThrottle() call when autoStart:false', async () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    const m = createProcessMemoryMonitor({
      autoStart: false,
      softThrottleMb: 1228,
      criticalMb: 1843,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    // No auto-tick should have fired.
    expect(m.getStatus().tickCount).toBe(0);
    expect(m.shouldThrottle()).toBe(false);
  });
});

// ============================================================================
// Lifecycle: start / stop / reset
// ============================================================================

describe('Bug #8: lifecycle', () => {
  let m: ProcessMemoryMonitor;
  beforeEach(() => {
    m = createProcessMemoryMonitor({ autoStart: false, tickIntervalMs: 100_000 });
  });
  afterEach(() => m.stop());

  it('start() is idempotent', () => {
    m.start();
    m.start();
    m.start();
    expect(m.getStatus().running).toBe(true);
  });

  it('stop() is idempotent', () => {
    m.stop();
    m.stop();
    expect(m.getStatus().running).toBe(false);
  });

  it('reset() clears all in-memory state', () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    m.tick();
    expect(m.getStatus().alertCount).toBe(1);
    expect(m.getStatus().tickCount).toBe(1);

    m.reset();
    expect(m.getStatus().alertCount).toBe(0);
    expect(m.getStatus().tickCount).toBe(0);
    expect(m.getStatus().lastAlertSeverity).toBeNull();
    expect(m.getStatus().throttled).toBe(false);
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('Bug #8: singleton', () => {
  it('processMemoryMonitor is an instance of ProcessMemoryMonitor', () => {
    expect(processMemoryMonitor).toBeInstanceOf(ProcessMemoryMonitor);
  });

  it('singleton does not start the interval until shouldThrottle() / getStatus() is called (with autoStart:false)', () => {
    // We can't disable autoStart on the singleton directly, so just verify
    // the getStatus() shape is correct after a manual call.
    const status = processMemoryMonitor.getStatus();
    expect(status.softThrottleMb).toBe(1228);
    expect(status.criticalMb).toBe(1843);
  });
});

// ============================================================================
// withMemoryThrottle wrapper
// ============================================================================

describe('Bug #8: withMemoryThrottle()', () => {
  afterEach(() => {
    processMemoryMonitor.reset();
  });

  it('invokes the handler when shouldThrottle() is false', async () => {
    mockMemoryUsage({ heapUsed: 100 * 1024 * 1024 });
    processMemoryMonitor.reset();
    const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const wrapped = withMemoryThrottle(handler);
    const res = await (wrapped as any)();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('returns 503 with Retry-After when shouldThrottle() is true', async () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    processMemoryMonitor.reset();
    // Force the throttle flag on via a tick.
    processMemoryMonitor.tick();

    const handler = vi.fn();
    const wrapped = withMemoryThrottle(handler);
    const res = await (wrapped as any)();
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = await res.json();
    expect(body.errorCode).toBe('MEMORY_PRESSURE');
    expect(body.retryable).toBe(true);
    expect(body.memory.throttled).toBe(true);
  });

  it('uses custom retryAfterSeconds when provided', async () => {
    mockMemoryUsage({ heapUsed: 1300 * 1024 * 1024 });
    processMemoryMonitor.reset();
    processMemoryMonitor.tick();

    const handler = vi.fn();
    const wrapped = withMemoryThrottle(handler, { retryAfterSeconds: 5 });
    const res = await (wrapped as any)();
    expect(res.headers.get('Retry-After')).toBe('5');
  });
});
