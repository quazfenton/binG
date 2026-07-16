// ============================================================================
// lib/database/unwrap-default-export.ts
// ============================================================================
// SEV-8 (2026-06-18 audit chain) — module-graph init crash.
//
// Before this leaf module existed, the same unwrapDefaultExport function was
// co-located inside session-store.ts AND imported by connection-shim.ts. Any
// path that required connection-shim at session-store top-level body (where
// tryRequireDatabaseConnection() is called synchronously) created a
// session-store ↔ connection-shim cycle. When session-store’s top-level body
// hit the cycle, Node.js’s CJS require() against connection.ts (which has
// top-level await `const { createRequire } = await import('node' + ':module')`)
// returned a TLA-pending synthetic namespace. unwrapDefaultExport shape-C
// (`mod.getDatabase`) tripped with:
//
//   ReferenceError: Cannot access 'getDatabase' before initialization
//
// …which fell through classifySqliteFailure to `kind: 'unknown'` with the
// misleading `hint: 'rebuild better-sqlite3 (`pnpm rebuild`)'` operator
// message. SEV-2 fast-fail in assertSessionStorePersisted() correctly refused
// to start the dev server, but operators had no accurate diagnostic.
//
// After this leaf module: the cycle is structurally broken in BOTH
// directions. session-store’s top-level body still calls
// tryRequireDatabaseConnection -> require('./connection-shim') -> require('./connection'),
// but connection-shim's import path for the unwrap helper no longer routes
// back through session-store. Plus the shape-C access is now NARROW-catch
// guarded so even if a future unintended error reaches it, real bugs are
// re-thrown instead of silently swallowed.
//
// This file ships fitting all four SEV-1/-2/-4/-7 success criteria AND the
// new SEV-8 audit-coherence goals (see BUGS_AUDIT.md).
// ============================================================================
// Pure 3-shape unwrap helper for `require('./connection')` results, broken
// out into a LEAF MODULE so it has no dependencies on the rest of the DB code.
//
// Why a leaf module?
//
//   The dev-server crash analyzed from run.log 2026-06-18 was driven by an
//   import cycle:
//
//     instrumentation.ts
//       → server-init.ts
//       → connection-shim.ts
//       ← unwrapDefaultExport ← ─┐
//                                 │ (was a TS `import { ... }` from `session-store`)
//       session-store.ts ─────────┘
//       → tryRequireDatabaseConnection()
//       → require('../database/connection-shim')  ← reloads connection-shim
//       → connection-shim's body executes `require('./connection')`
//       → connection.ts has top-level `await import('node' + ':module')`
//       → connection.ts module is TLA-pending
//       → CJS-style require() against a TLA-pending module returns a
//          synthetic namespace whose properties THROW on access
//       → unwrapDefaultExport's third-shape check (`mod.getDatabase`) THREW
//          with the verbatim log line:
//            ReferenceError: Cannot access 'getDatabase' before initialization
//       → session-store caught it, classifySqliteFailure fell through to
//          `kind: 'unknown'` with the misleading
//          hint "rebuild better-sqlite3 (`pnpm rebuild`)"
//       → SEV-2 fast-fail correctly refused to start the server, but the
//          hint pointed at a NonExistent root cause.
//
//   Moving `unwrapDefaultExport` to a leaf module breaks BOTH directions of
//   the cycle (session-store no longer imports connection-shim *through*
//   unwrapDefaultExport; connection-shim no longer imports session-store).
//
// Why a defensive try/catch on the third-shape property access?
//
//   Even with the cycle broken, connection-ts has top-level await — when
//   connection-shim's `require('./connection')` resolves to a TLA-pending
//   synthetic namespace, accessing named exports through `mod.X` THROWS a
//   ReferenceError ("Cannot access 'X' before initialization"). The helper
//   must be totally safe-degrade for ANY module-shape it might encounter,
//   including the partial / pending one. Returning `undefined` on caught
//   ReferenceError lets the caller fall through to `nullDb()` without
//   polluting the warn log with a TDZ stack trace.
//
// Pure function — imports nothing, exports only the helper. Tests live in
// `lib/storage/__tests__/sqlite-diagnostics.test.ts` (3-shape ladder) plus
// the new TDZ-defensive cases appended here.
//
// Single source of truth across:
//   - lib/database/connection-shim.ts (the connection.ts unwrap)
//   - lib/storage/session-store.ts (tryRequireDatabaseConnection unwrap)
//   - lib/terminal/session/terminal-session-manager.ts (terminal dbModule unwrap)
//   - lib/auth/jwt.ts (3 unwrap sites — refreshKey, OAUTH, JWT verify)
// ============================================================================

/**
 * Unwrap a `require('./connection')` result into the callable `getDatabase`
 * function, falling through the three observable shapes that Next.js / Turbopack
 * can emit when bundling `export default getDatabase` + `export function getDatabase`:
 *
 *   Shape A — CJS-hoisted direct         : typeof mod === 'function' → return mod
 *   Shape B — ESM-wrapped namespace      : { default: fn, __esModule } → return mod.default
 *   Shape C — named-only flattened       : { getDatabase: fn, ... } (no default) → return mod.getDatabase
 *
 * Unwrap silently returns `undefined` when no shape resolves to a callable so
 * the caller can decide whether to throw (interop-mismatch hard-fail) or
 * fall-back (graceful degradation to in-memory).
 *
 * The third-shape check (`mod.getDatabase`) is wrapped in try/catch because
 * Node.js synthesizes a THROW-ON-ACCESS namespace for ESM modules with
 * top-level await during partial evaluation — the access throws
 *
 *   ReferenceError: Cannot access 'getDatabase' before initialization
 *
 * even though the property name `getDatabase` is reachable. This is the
 * exact verbatim message observed in run.log on 2026-06-18 that drove the
 * dev-server crash. The catch returns `undefined` so the caller falls
 * through to its safe-degrade path without polluting logs with TDZ stack
 * traces.
 *
 * @param mod — the result of `require('./connection')` or equivalent
 * @returns the unwrapped callable, or `undefined` when none of the three
 *   shapes is callable OR when third-shape access throws TDZ.
 */
export function unwrapDefaultExport<T = (...args: any[]) => any>(
  mod: unknown,
): T | undefined {
  // Shape A: `require('./connection')` returned the function itself.
  // (CJS-hoisted case where main is exported as `module.exports = fn`.)
  if (typeof mod === 'function') {
    return mod as T
  }

  // Shape B: ESM default-export wrapper. The `__esModule: true` marker is
  // preserved by turbo/Next.js bundlers when emulating ESM through CJS.
  if (mod && typeof (mod as any).default === 'function') {
    return (mod as any).default as T
  }

  // Shape C: named-only flattened export (NO `default` key). The actual
  // dev-server shape observed in run.log 2026-06-18:
  //   typeof conn = 'object'
  //   conn.default = undefined
  //   conn.getDatabase = fn  ← unwrap picks this
  //
  // Wrap the property access in try/catch — Node.js throws a TDZ
  // ReferenceError ("Cannot access 'X' before initialization") when
  // reading named exports from a TLA-pending synthetic namespace:
  //
  //   ReferenceError: Cannot access 'getDatabase' before initialization
  //
  // Narrow the catch to ONLY swallow TDZ ReferenceErrors from
  // module-resolution timing (TLA in-flight). Any other error
  // (TypeError on a malformed mod, future ESM getter that throws for
  // unrelated reasons) is RE-THROWN so real bugs aren't silently masked.
  // A blanket `catch {}` would let future regressions go undetected.
  // The TDZ ReferenceError is identified by:
  //   - `instanceof ReferenceError` — not a TypeError / DatabaseError / etc.
  //   - `message` matches `/before initialization/i` — the exact format
  //     Node.js emits for synthetic TLA-pending namespaces.
  try {
    if (mod && typeof (mod as any).getDatabase === 'function') {
      return (mod as any).getDatabase as T
    }
  } catch (caughtErr) {
    if (
      caughtErr instanceof ReferenceError &&
      /before initialization/i.test(caughtErr.message ?? '')
    ) {
      // TLA-pending — silent fallthrough to undefined so the caller falls
      // through to the safe-degrade path (e.g. `nullDb()` in connection-shim).
      // The TDZ error is upstream / informational; the operator sees the
      // accurate "esm-tla-pending" hint from classifySqliteFailure if the
      // error ever reaches there.
      return undefined
    }
    // Real bug — re-throw so it surfaces loudly instead of silently
    // degrading the runtime.
    throw caughtErr
  }

  // No callable resolution found across A/B/C.
  return undefined
}
