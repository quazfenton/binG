/**
 * WasmRunner — Wasmtime JS API runner with complete host import implementations.
 *
 * Host imports exposed to the wasm guest under the module name "host":
 *
 *   host_read(path_ptr, path_len, out_ptr, out_cap) → i32
 *     Read a VFS path. Copies UTF-8 content into guest memory at out_ptr.
 *     Returns the number of bytes written, or a negative error code.
 *
 *   host_write(path_ptr, path_len, data_ptr, data_len) → i32
 *     Write data bytes to a VFS path. Returns 0 on success, negative on error.
 *
 *   host_fetch(url_ptr, url_len) → i32
 *     Enqueue an HTTP GET. Returns a positive request-id (> 0) immediately.
 *     Guest must loop calling host_poll until status ≠ PENDING.
 *
 *   host_poll(req_id, out_ptr, out_cap) → i32
 *     Poll a pending fetch request.
 *     Returns: 0 = still pending, 1 = ready (bytes written to out_ptr),
 *              2 = error (error string written to out_ptr), -1 = unknown id
 *
 *   host_log(level_ptr, level_len, msg_ptr, msg_len) → void
 *     Write a structured log entry to stdout.
 *
 *   host_getrandom(out_ptr, out_len) → i32
 *     Fill guest memory with cryptographic random bytes.
 *
 * Memory convention:
 *   All string/byte arguments are (ptr: i32, len: i32) pairs pointing into
 *   the guest's linear memory. The guest is responsible for allocating output
 *   buffers (via its exported `alloc` function) and passing the capacity via
 *   the `out_cap` parameter. The host never writes beyond out_cap bytes.
 *
 * Guest required exports:
 *   alloc(size: i32) → i32     — allocate `size` bytes; return pointer
 *   dealloc(ptr: i32, size: i32)
 *   handle(in_ptr: i32, in_len: i32) → i32  — main entry point; returns out_ptr
 *   result_len() → i32         — length of the last handle() result
 *   memory                     — exported linear memory (optional; host provides one)
 */

import fs from 'fs/promises'
import crypto from 'crypto'
import { globalVFS } from './simpleVfs';
import {
  AsyncFetchQueue,
  STATUS_PENDING,
  STATUS_READY,
  STATUS_ERROR,
} from './fetchQueue'

// ── Wasmtime import shim ───────────────────────────────────────────────────
// We wrap the import so the file is still loadable in environments where the
// native wasmtime addon is not installed (e.g. CI, unit tests).
let WasmtimeEngine: any, WasmtimeStore: any, WasmtimeModule: any,
    WasmtimeInstance: any, WasmtimeMemory: any, WasmtimeWasi: any

try {
  // webpackIgnore: true prevents the "Module not found" warning
  // @ts-ignore - wasmtime is an optional dependency
  const wt = await import(/* webpackIgnore: true */ 'wasmtime')
  WasmtimeEngine   = wt.Engine
  WasmtimeStore    = wt.Store
  WasmtimeModule   = wt.Module
  WasmtimeInstance = wt.Instance
  WasmtimeMemory   = wt.Memory
  // Wasi lives at different paths depending on version:
  WasmtimeWasi = wt.Wasi ?? wt.wasi?.Wasi ?? null
} catch {
  console.warn('[WasmRunner] wasmtime native addon not found — using stub mode')
}

// ── Error codes written into guest memory ─────────────────────────────────
const ERR_NOT_FOUND    = -1
const ERR_CAPACITY     = -2
const ERR_ENCODE       = -3
const ERR_NET          = -4

const MAX_OUTPUT_BYTES = 512 * 1024  // 512 KB safety cap for any single host→guest write

// ── Helpers ───────────────────────────────────────────────────────────────

/** Read a UTF-8 string from guest linear memory. */
function readGuestString(
  memBuffer: ArrayBuffer,
  ptr: number,
  len: number
): string {
  const slice = new Uint8Array(memBuffer, ptr, len)
  return new TextDecoder().decode(slice)
}

/**
 * Write bytes into guest linear memory at `outPtr`, up to `outCap` bytes.
 * Returns the number of bytes actually written, or ERR_CAPACITY if the buffer
 * is too small.
 */
function writeGuestBytes(
  memBuffer: ArrayBuffer,
  outPtr: number,
  outCap: number,
  bytes: Uint8Array
): number {
  if (bytes.byteLength > outCap) return ERR_CAPACITY
  const view = new Uint8Array(memBuffer, outPtr, outCap)
  view.set(bytes)
  return bytes.byteLength
}

// ── WasmRunner ────────────────────────────────────────────────────────────

export interface RunOptions {
  timeoutMs?: number
  allowedHosts?: string[]   // for host_fetch allowlist
  vfsPathPrefix?: string    // restrict host_read/write to this prefix
  maxMemoryPages?: number   // Wasmtime memory page limit (64 KiB per page)
}

export interface RunResult {
  ok: boolean
  output?: string
  artifacts?: { path: string; content: string }[]  // base64-encoded
  error?: string
  logs: LogEntry[]
  durationMs: number
}

export interface LogEntry {
  level: string
  message: string
  ts: number
}

export class WasmRunner {
  private engine: any
  private moduleCache = new Map<string, any>()

  constructor() {
    if (WasmtimeEngine) {
      this.engine = new WasmtimeEngine()
    }
  }

  // ── Module compilation (cached) ──────────────────────────────────────────

  async compileModule(wasmPath: string): Promise<any> {
    const cached = this.moduleCache.get(wasmPath)
    if (cached) return cached

    const bytes = await fs.readFile(wasmPath)
    const module = await WasmtimeModule.fromBuffer(this.engine, bytes)
    this.moduleCache.set(wasmPath, module)
    return module
  }

  // ── High-level entry point ────────────────────────────────────────────────

  async call(
    wasmPath: string,
    inputJson: unknown,
    opts: RunOptions = {}
  ): Promise<RunResult> {
    const t0 = Date.now()
    const logs: LogEntry[] = []

    if (!WasmtimeEngine) {
      // Stub mode — return a mock result so the rest of the pipeline works
      return {
        ok: true,
        output: '[stub] wasmtime not installed; returning mock result',
        logs,
        durationMs: 0,
      }
    }

    const module = await this.compileModule(wasmPath)
    const fetchQueue = new AsyncFetchQueue()

    // ── Create store + interrupt handle ────────────────────────────────────
    const store = new WasmtimeStore(this.engine)
    const interrupt = await store.interruptHandle?.()

    // ── Timeout ────────────────────────────────────────────────────────────
    let timedOut = false
    let timer: NodeJS.Timeout | null = null
    if (opts.timeoutMs && interrupt) {
      timer = setTimeout(() => {
        timedOut = true
        interrupt.interrupt()
      }, opts.timeoutMs)
    }

    try {
      // ── Shared linear memory (host-provided) ───────────────────────────
      // The host creates a Memory and provides it as an import. The guest may
      // also export its own memory; we prefer the guest's exported one.
      const hostMemory = new WasmtimeMemory(store, {
        minimum: opts.maxMemoryPages ?? 32,   // 2 MB default
        maximum: opts.maxMemoryPages ?? 256,  // 16 MB cap
      })

      // Closure over `store` and `hostMemory`; updated after instantiation to
      // point at the guest's own exported memory if present.
      let activeMemory = hostMemory

      const getMemBuf = () => activeMemory.buffer(store) as ArrayBuffer

      // ── VFS path prefix check ──────────────────────────────────────────
      const vfsPrefix = opts.vfsPathPrefix ?? ''
      const checkVfsPath = (path: string) => {
        if (vfsPrefix && !path.startsWith(vfsPrefix)) {
          throw new Error(`vfs_path_denied:${path}`)
        }
      }

      // ── Host import implementations ────────────────────────────────────

      /**
       * host_read(path_ptr, path_len, out_ptr, out_cap) → i32
       * Reads VFS content synchronously into guest memory.
       */
      const host_read = (
        pathPtr: number, pathLen: number,
        outPtr: number, outCap: number
      ): number => {
        try {
          const path = readGuestString(getMemBuf(), pathPtr, pathLen)
          checkVfsPath(path)
          // globalVFS.readSync throws if not found
          const content = globalVFS.readSync(path)
          const bytes = new TextEncoder().encode(content)
          return writeGuestBytes(getMemBuf(), outPtr, outCap, bytes)
        } catch (e) {
          logs.push({ level: 'error', message: `host_read error: ${e}`, ts: Date.now() })
          return ERR_NOT_FOUND
        }
      }

      /**
       * host_write(path_ptr, path_len, data_ptr, data_len) → i32
       * Writes bytes from guest memory into VFS synchronously.
       * Returns 0 on success, negative on error.
       */
      const host_write = (
        pathPtr: number, pathLen: number,
        dataPtr: number, dataLen: number
      ): number => {
        try {
          const path = readGuestString(getMemBuf(), pathPtr, pathLen)
          checkVfsPath(path)
          const buf = getMemBuf()
          // Slice a copy — don't hold a reference into the wasm linear memory
          const data = new Uint8Array(buf, dataPtr, dataLen).slice()
          globalVFS.writeSync(path, data)
          return 0
        } catch (e) {
          logs.push({ level: 'error', message: `host_write error: ${e}`, ts: Date.now() })
          return ERR_NOT_FOUND
        }
      }

      /**
       * host_fetch(url_ptr, url_len) → i32 (request_id)
       * Enqueues an async HTTP GET. Returns a positive request-id.
       * Kicks off the underlying fetch Promise immediately; the result will be
       * available via host_poll once the Node event loop processes microtasks.
       */
      const host_fetch = (urlPtr: number, urlLen: number): number => {
        const url = readGuestString(getMemBuf(), urlPtr, urlLen)
        const reqId = fetchQueue.enqueue(url, opts.allowedHosts ?? [])
        logs.push({ level: 'debug', message: `host_fetch enqueued id=${reqId} url=${url}`, ts: Date.now() })
        return reqId
      }

      /**
       * host_poll(req_id, out_ptr, out_cap) → i32
       *   0   = PENDING  (call again)
       *   1   = READY    (response bytes written to out_ptr; return value = bytes written)
       *   2   = ERROR    (error string written to out_ptr)
       *  -1   = unknown request id
       *
       * This function IS synchronous — it merely checks a Map that the async
       * fetch Promise has already written into. The guest should yield between
       * calls (see the Rust poll loop in lib.rs). The event loop drains
       * microtasks at each host→wasm boundary so the fetch Promise settles
       * naturally within a few poll iterations.
       */
      const host_poll = (
        reqId: number,
        outPtr: number, outCap: number
      ): number => {
        const result = fetchQueue.poll(reqId)

        if (result.status === STATUS_PENDING) return STATUS_PENDING

        if (result.status === STATUS_ERROR) {
          const errBytes = new TextEncoder().encode(result.error ?? 'unknown_error')
          writeGuestBytes(getMemBuf(), outPtr, outCap, errBytes)
          return STATUS_ERROR
        }

        // STATUS_READY — copy response into guest memory
        const bytes = result.bytes!
        const written = writeGuestBytes(getMemBuf(), outPtr, outCap, bytes)
        if (written < 0) {
          // Capacity overflow — write truncation error
          const errBytes = new TextEncoder().encode(`response_too_large:${bytes.byteLength}`)
          writeGuestBytes(getMemBuf(), outPtr, outCap, errBytes)
          return STATUS_ERROR
        }
        return written // positive = byte count written; guest also interprets > 0 as READY
      }

      /**
       * host_log(level_ptr, level_len, msg_ptr, msg_len)
       */
      const host_log = (
        levelPtr: number, levelLen: number,
        msgPtr: number, msgLen: number
      ): void => {
        const level = readGuestString(getMemBuf(), levelPtr, levelLen)
        const message = readGuestString(getMemBuf(), msgPtr, msgLen)
        logs.push({ level, message, ts: Date.now() })
        console.log(`[wasm:${level}] ${message}`)
      }

      /**
       * host_getrandom(out_ptr, out_len) → i32
       */
      const host_getrandom = (outPtr: number, outLen: number): number => {
        const buf = crypto.randomBytes(outLen)
        const view = new Uint8Array(getMemBuf(), outPtr, outLen)
        view.set(buf)
        return 0
      }

      // ── Build import object ─────────────────────────────────────────────
      const importObject: Record<string, any> = {
        host: {
          host_read,
          host_write,
          host_fetch,
          host_poll,
          host_log,
          host_getrandom,
          memory: hostMemory,
        },
      }

      // Add WASI if available
      if (WasmtimeWasi) {
        const wasiInstance = new WasmtimeWasi({ env: {}, args: [], preopens: {} })
        Object.assign(importObject, { wasi_snapshot_preview1: wasiInstance.wasiImport })
      }

      // ── Instantiate ─────────────────────────────────────────────────────
      const instance = await WasmtimeInstance.instantiate(store, module, importObject)

      // Prefer the guest's own exported memory (it may have a different base)
      const guestMem = instance.exports.get('memory')
      if (guestMem) activeMemory = guestMem

      // ── Locate guest exports ────────────────────────────────────────────
      const allocFn    = instance.exports.get('alloc')
      const deallocFn  = instance.exports.get('dealloc')
      const handleFn   = instance.exports.get('handle')
      const resultLenFn = instance.exports.get('result_len')

      if (!allocFn || !handleFn || !resultLenFn) {
        throw new Error('guest_missing_exports: require alloc, handle, result_len')
      }

      // ── Write input JSON into guest memory ──────────────────────────────
      const inputStr   = JSON.stringify(inputJson)
      const inputBytes = new TextEncoder().encode(inputStr)
      const inPtr: number  = allocFn.call(store, inputBytes.byteLength)
      const inView = new Uint8Array(getMemBuf(), inPtr, inputBytes.byteLength)
      inView.set(inputBytes)

      // ── Call handle() ───────────────────────────────────────────────────
      const resultPtr: number = handleFn.call(store, inPtr, inputBytes.byteLength)
      const resultLen: number = resultLenFn.call(store)

      if (timedOut) throw new Error('wasm_execution_timeout')

      // ── Read result from guest memory ───────────────────────────────────
      const resultSlice = new Uint8Array(getMemBuf(), resultPtr, resultLen)
      const resultStr   = new TextDecoder().decode(resultSlice)

      // Optional: dealloc input buffer
      deallocFn?.call(store, inPtr, inputBytes.byteLength)

      const parsed = JSON.parse(resultStr) as RunResult & { ok: boolean }
      return {
        ...parsed,
        logs,
        durationMs: Date.now() - t0,
      }
    } catch (err) {
      const msg = timedOut ? 'wasm_execution_timeout' : String(err)
      return { ok: false, error: msg, logs, durationMs: Date.now() - t0 }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

export const globalRunner = new WasmRunner()
