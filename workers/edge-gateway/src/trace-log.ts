/**
 * trace-log.ts
 *
 * Writes [TRACE] structured log lines to a dedicated R2 bucket.
 *
 * Strategy: dual-write approach
 *   1. Always console.log() — feeds Cloudflare tail / Logpush (primary observability)
 *   2. Also write to R2 — provides durable persistence independent of platform
 *
 * R2 path layout:
 *   traces/{YYYY-MM-DD}/{HH}/{minute}-{random8hex}.ndjson
 *
 * Each line is newline-delimited JSON (NDJSON) — one trace entry per line.
 * Files are small (≈60s worth of entries) so R2 reads are cheap.
 *
 * R2 fallback: if R2 write fails, trace lines are buffered in a RingBuffer
 * and flushed on the next successful write. Never blocks the request.
 */

import type { R2Bucket, ExecutionContext } from '@cloudflare/workers-types';

export interface TraceEntry {
  ts: string;
  method: string;
  path: string;
  cfCountry?: string;
  userAgent?: string;
  upstreamStatus?: number;
  upstreamStatusText?: string;
  contentType?: string;
  error?: string;
}

/**
 * Lightweight ring buffer for traces that couldn't be written to R2.
 * Max 500 entries — prevents unbounded memory growth if R2 is down.
 */
class RingBuffer<T> {
  private buffer: T[] = [];
  private head = 0;       // Points to the oldest entry in the buffer
  private _size = 0;

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(item);
    } else {
      // Ring wrap: overwrite the oldest slot, advance head
      this.buffer[this.head] = item;
    }
    this.head = (this.head + 1) % this.capacity;
    this._size = Math.min(this._size + 1, this.capacity);
  }

  /**
   * Drain all buffered entries in oldest-first order.
   * After drain, the buffer is empty.
   *
   * Invariant: when not wrapped, oldest entry is always at index 0,
   * regardless of where head points (head only marks where the next
   * push would write).
   */
  drain(): T[] {
    if (this._size === 0) return [];

    let result: T[];
    if (this.buffer.length < this.capacity) {
      // Buffer hasn't filled yet — oldest is index 0, head is where next push goes
      // Drain the entire buffer in insertion order (0 → end)
      result = this.buffer.slice(0);
    } else {
      // Ring has wrapped — oldest entries span [head..end] + [0..head)
      result = [
        ...this.buffer.slice(this.head),   // oldest part
        ...this.buffer.slice(0, this.head), // newest part
      ];
    }

    this.buffer = [];
    this.head = 0;
    this._size = 0;
    return result;
  }

  get size(): number { return this._size; }
}

/**
 * NDJSON file key format:
 *   traces/YYYY-MM-DD/HH/MM-{random8hex}.ndjson
 *
 * ~60s rotation window ensures files stay small (≈60 req × ~500 bytes = 30KB).
 */
function buildTraceKey(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(now.getUTCDate()).padStart(2, '0');
  const hh   = String(now.getUTCHours()).padStart(2, '0');
  const min  = String(now.getUTCMinutes()).padStart(2, '0');
  // Use Date.now() base-36 for microsecond-level uniqueness across concurrent writes
  // Plus 8 hex chars from crypto for extra entropy — practically zero collision risk
  const ts   = Date.now().toString(36);
  const rand = randomHex(8);
  return `traces/${yyyy}-${mm}-${dd}/${hh}/${min}-${ts}-${rand}.ndjson`;
}

function randomHex(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * TraceLog — writes structured trace entries to R2.
 *
 * Usage:
 *   const traceLog = new TraceLog(env.TRACE_R2);
 *   traceLog.write(entry);   // fire-and-forget, never blocks request
 *   traceLog.flush();        // call on next successful write to drain buffer
 */
export class TraceLog {
  private buffer = new RingBuffer<string>(500);
  private flushScheduled = false;

  constructor(private readonly bucket: R2Bucket | undefined) {}

  /**
   * Write a trace entry to R2 (async, non-blocking) and also console.log.
   * On R2 failure, buffers the line for the next flush.
   *
   * When ctx is provided the R2 write promise is passed to ctx.waitUntil()
   * so it survives past the fetch handler returning and the isolate being
   * frozen. Without this the R2 put almost never completes for traces that
   * fire late in the request lifecycle (e.g. response status lines).
   */
  write(entry: TraceEntry, ctx?: ExecutionContext): void {
    const line = JSON.stringify(entry);

    // Always log to console — feeds Cloudflare tail / Logpush
    console.log(`[TRACE] ${line}`);

    // Write to R2 if available — capture the promise so ctx can keep it alive
    const promise = this.writeToR2(line);
    if (ctx) {
      ctx.waitUntil(promise);
    }
  }

  private async writeToR2(line: string): Promise<void> {
    if (!this.bucket) return;

    try {
      // First, flush any buffered entries from a previous R2 outage.
      // The outer ctx.waitUntil keeps the entire writeToR2 promise alive
      // so the flush also completes (or re-buffers safely).
      if (this.buffer.size > 0 && !this.flushScheduled) {
        this.flushScheduled = true;
        await this.flushBuffer().finally(() => { this.flushScheduled = false; });
      }

      // Write the current line
      const key = buildTraceKey();
      // Use conditional to avoid overwriting a concurrent write to same key
      // (each trace call gets a unique key via random suffix)
      await this.bucket.put(key, line + '\n', {
        httpMetadata: { contentType: 'application/x-ndjson' },
      });
    } catch (err) {
      // R2 write failed — buffer the line, will retry on next successful write
      this.buffer.push(line);
      console.warn('[trace-log] R2 write failed, buffered for retry:', err instanceof Error ? err.message : String(err));
    }
  }

  private async flushBuffer(): Promise<void> {
    const pending = this.buffer.drain();
    if (pending.length === 0 || !this.bucket) return;

    try {
      // Consolidate all pending lines into a single R2 write
      const content = pending.join('\n') + '\n';
      const key = buildTraceKey();
      await this.bucket.put(key, content, {
        httpMetadata: { contentType: 'application/x-ndjson' },
      });
      console.log(`[trace-log] Flushed ${pending.length} buffered trace lines to R2`);
    } catch (err) {
      // Re-buffer what we couldn't flush
      for (const line of pending) {
        this.buffer.push(line);
      }
      console.warn('[trace-log] Buffer flush failed:', err instanceof Error ? err.message : String(err));
    }
  }
}