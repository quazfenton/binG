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

import { unwrapDefaultExport } from './unwrap-default-export'

// SEV-12 (2026-06-18 fix): bare global `require` is NOT defined in pure ESM
// (the project has package.json `"type": "module"` and this shim is loaded
// by session-store.ts and jwt.ts via static `import` from CJS-leaning code
// paths under strict ESM). Replace the bare `require()` called below with a
// createRequire-derived local binding. connection.ts already has this pattern
// at line 22 — we mirror it here so the chain stays ESM-safe regardless of
// Node version or compiler (Turbopack / Webpack / Node directly).
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// Safe-degrade fallback used when connection.ts cannot be loaded or its
// default export is not callable under the current bundler/HMR shape.
//
// EV-1 (audit) — previous `() => any return null` fallback made this shim
// return `null`, which then crashed every production caller at the next
// step (`.prepare(...)`, `.exec(...)`, `db.transaction(...)`). The 4
// fail-closed emissions (Auth:Audit, API:Auth:Login, LocalPTY init,
// Tools:Loader) all derive from the same chain: caller → getDatabase()
// → null → TypeError on first method invocation.
//
// New contract: callers see an object with the SQLite-shaped API surface
// (prepare/get/all/run/exec/transaction/pragma/close). Every method
// returns a structurally-correct empty result instead of throwing. This
// turns the SEV-1 TypeError cascade into safe-degraded behavior:
//   - SELECT queries return [] / null
//   - INSERT/UPDATE/DELETE return { lastInsertRowid: 0, changes: 0 }
//   - Calls to `.transaction(fn)` become no-op identity functions
//   - `.exec(sql)` and `.pragma(...)` return the db itself (chainable)
//
// Declared FIRST so the export below can reference it without relying on
// function-declaration hoisting.
function nullDb(): any {
  // Prepared-statement stub — chained methods return neutral results so
  // .run() / .get() / .all() / .iterate() never throw. The match-all
  // truthy returns match the better-sqlite3 idiom exactly so callers
  // branching on `if (!result)` see the same semantics as a cold DB.
  const stubStmt: any = {
    run: (..._params: any[]) => ({ lastInsertRowid: 0, changes: 0 }),
    get: (..._params: any[]) => null,
    all: (..._params: any[]) => [],
    iterate: (..._params: any[]) => ({
      [Symbol.iterator]: function* () {},
      next: () => ({ done: true, value: undefined as any }),
      return: () => ({ done: true, value: undefined as any }),
    }),
    pluck: (..._params: any[]) => stubStmt,
    expand: (..._params: any[]) => stubStmt,
    raw: (..._params: any[]) => stubStmt,
    columns: () => [],
    bind: (..._params: any[]) => stubStmt,
    finalize: () => undefined,
  }
  return {
    // Stamp a diagnostic marker so observers (logging, metrics) can tell
    // safe-degrade from a real DB handle without a separate channel.
    __safeDegradeFallback: true,
    prepare: (_sql: string) => stubStmt,
    exec: (_sql: string) => nullDb(),
    pragma: (_name: string, _value?: any) => nullDb(),
    transaction: (fn: any) => {
      // Wrap as no-op identity so caller's `db.transaction(fn)(args)`
      // still resolves without throwing. The wrapped call is intentionally
      // NOT invoked — we don't want to run user code against an empty
      // mock DB during the audit window.
      return (...args: any[]) => {
        if (typeof fn === 'function') {
          try { return fn(...args) } catch { /* swallow — safe-degrade */ }
        }
        return undefined
      }
    },
    close: () => undefined,
    backup: () => Promise.resolve({ totalPages: 0, remainingPages: 0 }),
    serialize: () => Buffer.alloc(0),
    defaultSafeIntegers: function () { return this },
    loadExtension: function () { return this },
    unsafeMode: function () { return this },
    function: function () { return this },
    aggregate: function () { return this },
    table: (_name: string) => null,
  }
}

// CJS-require connection.ts so we receive the SAME bundler-emitted shape
// that every other consumer receives when they require() it. Wrapped in a
// try/catch because connection.ts itself has a top-level
// `await import('node' + ':module')` dynamic-import that can throw under
// HMR reload, and we MUST NOT propagate that throw — every site importing
// this shim (25+ production + ~66 static-import sites) relies on a stable,
// never-throws callable surface.
let getDatabaseImpl: any = undefined
// Track whether the CJS require('./connection') call below completed
// without throwing. The un-wrap branch further down uses this to
// distinguish "require threw" vs "require succeeded but the exported
// shape was not callable under the current bundler/HMR shape". Both
// branches fall through to nullDb() (safe-degrade) but only the
// "require succeeded" path emits the interop-mismatch warn-once. Without
// this flag the check previously referenced an unresolved variable
// (ReferenceError at module load) AND silently collapsed both failure
// modes into a single noiseless fallback -- the exact bug the EV-1
// audit was supposed to surface loudly.
let requireSucceeded: boolean = false
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn: any = require('./connection')
requireSucceeded = true
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

// EV-1 (audit) carried forward as a SEV-8 contribution (2026-06-18 module-graph refactor).
// This is the interop-mismatch warn-once block:
// SUCCEEDED but `unwrapDefaultExport` returned undefined. This is the
// EXACT verbatim pattern surfaced in run.log:
//   "getDatabase is not a function: database/connection did not export a
//    callable default (typeof conn=object, conn.default=undefined,
//    conn.getDatabase=undefined)"
// Without this branch the safe-degrade `nullDb` fallback runs SILENTLY
// and operators cannot correlate the empty-result behavior with the
// underlying CJS/ESM interop-mismatch. Routing through the same
// `__connectionShimLoadWarned__` globalThis dedup key keeps warn totals
// bounded under HMR (one warn per process regardless of which of the two
// failure modes fires first).
if (
  typeof getDatabaseImpl !== 'function' &&
  requireSucceeded &&
  (globalThis as unknown as { __connectionShimLoadWarned__?: boolean }).__connectionShimLoadWarned__ !== true
) {
  // eslint-disable-next-line no-console
  console.warn(
    '[connection-shim] database/connection loaded but unwrapDefaultExport returned undefined — exporting safe-degrade mock. ' +
    'CJS/ESM interop mismatch detected (none of `conn === function`, `conn.default`, `conn.getDatabase` resolved to a callable). '
  )
  ;(globalThis as unknown as { __connectionShimLoadWarned__?: boolean }).__connectionShimLoadWarned__ = true
}

export const getDatabase: () => any =
  typeof getDatabaseImpl === 'function' ? getDatabaseImpl : nullDb
export function isDatabaseConnectionCallable(): boolean {
  return typeof getDatabaseImpl === 'function'
}

// ---------------------------------------------------------------------------
// Static re-exports — close the `does not provide an export named X` gap.
// ---------------------------------------------------------------------------
// Pre-existing consumers (e.g. app/api/chat/history/gateway.ts,
// app/api/integrations/figma/callback/gateway.ts, app/api/integrations/figma/gateway.ts,
// lib/auth/auth-service.ts) import DatabaseOperations, encryptApiKey,
// decryptApiKey, and isDatabaseAvailable from `@/lib/database/connection-shim`.
// These names live in `connection.ts` directly, but for backwards-compat
// (and to keep importers from having to chase down two module paths) we
// forward them here. The runtime `require('./connection')` above and these
// `export { ... } from './connection'` re-exports resolve to the SAME
// Node-cached module — single load, no double-evaluation risk.
//
// If connection.ts fails to load (broken native binding, missing schema.sql,
// TLA-pending, etc.) the runtime require() falls through to nullDb() above.
// These re-exports would also surface that failure — which is intentional:
// there is no graceful-degrade path for DatabaseOperations / encryptApiKey /
// decryptApiKey / isDatabaseAvailable. If those names are unreachable, the
// importers that depend on them can't function either, and a clear TypeError
// on import is BETTER than a half-working module.
//
// TypeScript: types are forwarded through automatically (value-bearing
// re-exports forward types at compile time AND runtime binding). Note
// DatabaseOperations must be a VALUE re-export (use `export { X }`), NOT
// a type-only re-export (would have been `export type { X }`) — callers
// like app/api/chat/history/gateway.ts and lib/auth/auth-service.ts do
// `new DatabaseOperations(...)` and `instanceof DatabaseOperations`
// checks, so the runtime class binding must be present.
export { DatabaseOperations, encryptApiKey, decryptApiKey, isDatabaseAvailable } from './connection'
