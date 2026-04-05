/**
 * AsyncFetchQueue — implements the host_fetch / host_poll async hostcall protocol.
 *
 * PROBLEM: Wasmtime host import functions must be synchronous (they run on the
 * JS call stack while the wasm instance is mid-execution). But fetch() is
 * inherently async. We solve this with a two-phase handshake:
 *
 *   Phase 1 — host_fetch (sync)
 *     Guest encodes a URL + headers into guest memory and calls host_fetch().
 *     Host copies the URL out of guest memory, enqueues a pending fetch, and
 *     returns a numeric request-id immediately. No network I/O happens yet.
 *
 *   Phase 2 — host_poll (sync, called in a tight guest loop)
 *     Guest calls host_poll(request_id, out_ptr, out_cap) repeatedly.
 *     Host checks whether the JS promise for that request has settled:
 *       • Not yet   → returns STATUS_PENDING (0)
 *       • Error      → returns STATUS_ERROR   (2); out_ptr holds error string
 *       • Done       → returns STATUS_READY   (1); copies response bytes into
 *                      guest memory at out_ptr and returns STATUS_READY
 *
 * The trick: between host_poll calls the guest returns control to the JS event
 * loop via a cooperative yield (a Shared-Memory Atomics.wait or, in our demo,
 * a tight call to a no-op wasm export that the runner intercepts to drain
 * microtasks). For a real production system you would use Atomics.waitAsync or
 * wasm-threads to block a worker without blocking the main thread.
 *
 * For this demo we use a simpler strategy that works in a single-threaded
 * Node environment: the runner sets up a Promise that runs alongside the wasm
 * execution and stores settled values in a plain Map; host_poll checks the Map
 * synchronously. Because Node's event loop drains microtasks between wasm
 * calls (each guest → host boundary is a microtask boundary), the fetch
 * promise settles by the time the guest loops back to host_poll.
 */

import nodeFetch from 'node-fetch'

export const STATUS_PENDING = 0
export const STATUS_READY   = 1
export const STATUS_ERROR   = 2

export interface PendingRequest {
  id: number
  url: string
  allowedHosts: string[]
  // Settled state (filled by the Promise callback)
  status: typeof STATUS_PENDING | typeof STATUS_READY | typeof STATUS_ERROR
  responseBytes: Uint8Array | null
  errorMessage: string | null
}

export class AsyncFetchQueue {
  private counter = 0
  private queue = new Map<number, PendingRequest>()

  /**
   * Enqueue a fetch and kick off the Promise (non-blocking).
   * Returns the request id synchronously so the guest can store it and poll.
   */
  enqueue(url: string, allowedHosts: string[]): number {
    const id = ++this.counter
    const req: PendingRequest = {
      id, url, allowedHosts,
      status: STATUS_PENDING,
      responseBytes: null,
      errorMessage: null,
    }
    this.queue.set(id, req)

    // Kick off the async work; result will be stored in `req` when it settles.
    this._doFetch(req)

    return id
  }

  private async _doFetch(req: PendingRequest): Promise<void> {
    try {
      // ── Allowlist check ───────────────────────────────────────────────────
      const host = new URL(req.url).hostname
      const allowed =
        req.allowedHosts.length === 0 ||
        req.allowedHosts.some(h => host === h || host.endsWith(`.${h}`))
      if (!allowed) {
        req.status = STATUS_ERROR
        req.errorMessage = `host_not_allowed:${host}`
        return
      }

      // ── Real fetch ────────────────────────────────────────────────────────
      const res = await nodeFetch(req.url, {
        headers: { 'User-Agent': 'skill-wasm-runner/1.0' },
        // Prevent huge downloads from filling memory
        size: 512 * 1024, // 512 KB max
      })

      if (!res.ok) {
        req.status = STATUS_ERROR
        req.errorMessage = `http_error:${res.status}`
        return
      }

      const buf = await res.arrayBuffer()
      req.responseBytes = new Uint8Array(buf)
      req.status = STATUS_READY
    } catch (err) {
      req.status = STATUS_ERROR
      req.errorMessage = String(err)
    }
  }

  /**
   * Poll a request by id. Returns the current status.
   * If READY, also provides the response bytes.
   * Once READY or ERROR, the request is removed from the queue (one-shot).
   */
  poll(id: number): { status: number; bytes: Uint8Array | null; error: string | null } {
    const req = this.queue.get(id)
    if (!req) return { status: STATUS_ERROR, bytes: null, error: 'unknown_request_id' }

    if (req.status === STATUS_PENDING) {
      return { status: STATUS_PENDING, bytes: null, error: null }
    }

    // Settled — remove and return
    this.queue.delete(id)

    if (req.status === STATUS_ERROR) {
      return { status: STATUS_ERROR, bytes: null, error: req.errorMessage }
    }

    return { status: STATUS_READY, bytes: req.responseBytes, error: null }
  }

  pendingCount(): number {
    return [...this.queue.values()].filter(r => r.status === STATUS_PENDING).length
  }
}
