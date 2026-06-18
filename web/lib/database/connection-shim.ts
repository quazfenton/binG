// ============================================================================
// database/connection-shim.ts — ROOT FIX for the systemic interop-mismatch bug
// ============================================================================
// `connection.ts` exports BOTH `export function getDatabase()` AND
// `export default getDatabase`. Next.js / turbopack can bundle that into
// several different module shapes. All 30+ consumer sites previously used
//   const { getDatabase } = require('@/lib/database/connection')
// which fails on Shapes C/D because the destructured property is undefined.
//
// This shim IS the canonical "give me a callable getDatabase or a safe
// null-returning fallback" surface — every consumer routes through here so
// destructuring / static-import / dynamic-import / relative-path sites all
// see the same stable callable. The shim's own load failure (broken native
// binding, HMR reload race, etc.) is funneled through a one-line warn so
// log noise stays bounded under Next.js hot-module reload.

import { unwrapDefaultExport } from '@/lib/storage/session-store'

// Stable null-returning fallback used when connection.ts cannot be loaded
// or its default export is not callable. Declared FIRST so the export
// below can reference it without relying on function-declaration hoisting.
function nullDb(): any { return null }

// CJS-require connection.ts so we receive the SAME bundler-emitted shape
// that every other consumer receives when they require() it. Wrapped in a
// try/catch because connection.ts itself has a top-level
// `await import('node' + ':module')` dynamic-import that can throw under
// HMR reload, and we MUST NOT propagate that throw — every site importing
// this shim (25+ production + ~66 static-import sites) relies on a stable,
// never-throws callable surface.
let getDatabaseImpl: any = undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn: any = require('./connection')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDatabaseImpl = unwrapDefaultExport(conn)
} catch (loadErr: unknown) {
  // connection.ts threw at module-eval (broken native binding, missing
  // schema.sql at build, HMR reload race, etc.). Fall through to nullDb
  // below AND log a one-line breadcrumb so operators can correlate this
  // with the upstream cause.
  //
  // HMR DEDUP: persisted on globalThis so the warn fires at most ONCE per
  // process across module re-evaluations. Without this, Next.js hot-reload
  // can trigger N warns per minute during active development — same data
  // each time, useful signal degraded to noise. The flag is per-process
  // (worker restart clears the counter).
  const shimWarnState = (globalThis as unknown as {
    __connectionShimLoadWarned__?: boolean
  })
  if (!shimWarnState.__connectionShimLoadWarned__) {
    const msg = loadErr instanceof Error ? loadErr.message : String(loadErr)
    // eslint-disable-next-line no-console
    console.warn(
      '[connection-shim] database/connection failed to load \u2014 exporting nullDb fallback. ' +
      'Check upstream log for root cause. (inner: ' + msg.slice(0, 120) + ')',
    )
    shimWarnState.__connectionShimLoadWarned__ = true
  }
  // getDatabaseImpl was either set to a callable inside try (no catch) or
  // already its initial `undefined` if the throw happened before the
  // assignment — so no further reset is needed here.
}

export const getDatabase: () => any =
  typeof getDatabaseImpl === 'function' ? getDatabaseImpl : nullDb
export function isDatabaseConnectionCallable(): boolean {
  return typeof getDatabaseImpl === 'function'
}
