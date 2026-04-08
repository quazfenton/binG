/**
 * metrics.ts — Performance tracing and metrics
 *
 * Track: embedding time, retrieval latency, diff time, agent iterations.
 * Lightweight — no external deps, stores in memory.
 */

// ─── Trace ────────────────────────────────────────────────────────────────────

export interface TraceEntry {
  name: string;
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const _traces: TraceEntry[] = [];
const MAX_TRACES = 500;

/**
 * Wrap an async function in a timing trace.
 * Returns the function result and records the duration.
 */
export async function trace<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - start;
    record(name, durationMs, metadata);
    return result;
  } catch (err) {
    const durationMs = performance.now() - start;
    record(name, durationMs, { ...metadata, error: String(err) });
    throw err;
  }
}

function record(name: string, durationMs: number, metadata?: Record<string, unknown>) {
  _traces.push({ name, durationMs, timestamp: Date.now(), metadata });
  if (_traces.length > MAX_TRACES) _traces.shift();

  if (process.env.NODE_ENV === "development") {
    const ms = durationMs.toFixed(1);
    console.debug(`[trace] ${name} — ${ms}ms`, metadata ?? "");
  }
}

// ─── Counters ─────────────────────────────────────────────────────────────────

const _counters = new Map<string, number>();

export function increment(name: string, by = 1) {
  _counters.set(name, (_counters.get(name) ?? 0) + by);
}

export function getCounter(name: string): number {
  return _counters.get(name) ?? 0;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface MetricsSummary {
  traces: {
    name: string;
    count: number;
    avgMs: number;
    maxMs: number;
    p95Ms: number;
  }[];
  counters: Record<string, number>;
}

export function getMetricsSummary(): MetricsSummary {
  // Group traces by name
  const grouped = new Map<string, number[]>();
  for (const t of _traces) {
    if (!grouped.has(t.name)) grouped.set(t.name, []);
    grouped.get(t.name)!.push(t.durationMs);
  }

  const traces = Array.from(grouped.entries()).map(([name, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    return {
      name,
      count: durations.length,
      avgMs: parseFloat((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)),
      maxMs: parseFloat(Math.max(...durations).toFixed(1)),
      p95Ms: parseFloat((sorted[p95Index] ?? sorted[sorted.length - 1]).toFixed(1)),
    };
  });

  const counters = Object.fromEntries(_counters);

  return { traces, counters };
}

export function clearMetrics() {
  _traces.length = 0;
  _counters.clear();
}
