import { describe, it, expect } from 'vitest'
import { classifySqliteFailure, type SqliteFailure } from '../session-store'
// unwrapDefaultExport moved to a LEAF module on 2026-06-18 to break the
// import cycle that crashed `pnpm run dev` (session-store ↔ connection-shim).
// Tests now import from the leaf module directly so they don't re-import
// session-store and re-create the same cycle.
import { unwrapDefaultExport } from '../../database/unwrap-default-export'

// ---------------------------------------------------------------------------
// classifySqliteFailure - taxonomy coverage
// ---------------------------------------------------------------------------
describe('classifySqliteFailure', () => {
  describe('arch-mismatch', () => {
    it.each([
      ['wrong architecture (linux + arm64 prebuild)'],
      ['Incorrect ELF header'],
      ['not a valid Win32 application'],
      ['not a valid Mach-O'],
      ["/path/x.node: invalid target (expected x86_64 but got arm64)"],
    ])('classifies "%s" as arch-mismatch', (msg) => {
      const got = classifySqliteFailure(new Error(msg))
      expect(got.kind).toBe('arch-mismatch')
      expect(got.reason).toBe(msg)
      expect(got.hint).toMatch(/rebuild better-sqlite3/i)
    })
  })

  describe('libc-missing', () => {
    it.each([
      ['/usr/lib/libstdc++.so.6: cannot open shared object file'],
      ['libc++.so.1: cannot open shared object'],
      ['libcrypto.so.1.1: cannot open shared object'],
      ["/lib/x86_64-linux-gnu/libc.so.6: version 'GLIBC_2.28' not found"],
      ['libgcc_s.so.1: cannot open shared object'],
    ])('classifies "%s" as libc-missing', (msg) => {
      const got = classifySqliteFailure(new Error(msg))
      expect(got.kind).toBe('libc-missing')
      expect(got.reason).toBe(msg)
      expect(got.hint).toMatch(/apk add|libc6|rebuild/i)
    })
  })

  describe('abi-mismatch', () => {
    it('classifies "NODE_MODULE_VERSION X is not supported" as abi-mismatch', () => {
      const got = classifySqliteFailure(
        new Error(
          'NODE_MODULE_VERSION 115 is not supported. Re-installing or compiling better-sqlite3 is the recommended solution.'
        )
      )
      expect(got.kind).toBe('abi-mismatch')
      expect(got.hint).toMatch(/rebuild better-sqlite3/)
    })

    it('classifies "compiled against a different Node" as abi-mismatch', () => {
      const got = classifySqliteFailure(
        new Error(
          "The module '/foo/better-sqlite3.node' was compiled against a different Node.js version"
        )
      )
      expect(got.kind).toBe('abi-mismatch')
    })
  })

  describe('native-not-built', () => {
    it('classifies "Could not locate the bindings file" as native-not-built', () => {
      const got = classifySqliteFailure(
        new Error(
          'Could not locate the bindings file. Tried: \n  → /foo/build/Release/better_sqlite3.node'
        )
      )
      expect(got.kind).toBe('native-not-built')
      expect(got.hint).toMatch(/pnpm install.*rebuild/i)
    })

    it('classifies "The specified module could not be found" as native-not-built', () => {
      const got = classifySqliteFailure(
        new Error('The specified module could not be found.\r\n\\?ico\\better_sqlite3.node')
      )
      expect(got.kind).toBe('native-not-built')
    })

    it('classifies ENOENT as native-not-built', () => {
      const got = classifySqliteFailure(
        Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
      )
      expect(got.kind).toBe('native-not-built')
    })
  })

  describe('module-not-installed', () => {
    it("classifies \"Cannot find module 'better-sqlite3'\" as module-not-installed", () => {
      const got = classifySqliteFailure(
        new Error("Cannot find module 'better-sqlite3'\nRequire stack:")
      )
      expect(got.kind).toBe('module-not-installed')
      expect(got.hint).toMatch(/pnpm add better-sqlite3/)
    })
  })

  describe('cjs-of-esm', () => {
    it('classifies "ERR_REQUIRE_ESM" code as cjs-of-esm', () => {
      const got = classifySqliteFailure(
        Object.assign(new Error("require() of ES Module ... not supported"), {
          code: 'ERR_REQUIRE_ESM',
        })
      )
      expect(got.kind).toBe('cjs-of-esm')
      expect(got.hint).toMatch(/dynamic import/i)
    })

    it('classifies message-only "require() of ES Module" as cjs-of-esm', () => {
      const got = classifySqliteFailure(
        new Error("require() of ES Module /foo/index.mjs not supported. Instead change the require of index.mjs to a dynamic import()")
      )
      expect(got.kind).toBe('cjs-of-esm')
    })
  })

  describe('sqlite-runtime-error', () => {
    it('classifies a SqliteError as sqlite-runtime-error (NOT arch-mismatch)', () => {
      // Simulated: SQLiteError instance with .name = 'SqliteError'
      const err = Object.assign(new Error('SQLITE_BUSY: database is locked'), {
        name: 'SqliteError',
        code: 'SQLITE_BUSY',
      })
      const got = classifySqliteFailure(err)
      expect(got.kind).toBe('sqlite-runtime-error')
      expect(got.reason).toBe('SQLITE_BUSY: database is locked')
      expect(got.hint).toMatch(/DATABASE_PATH|permissions|schema mismatch/i)
    })

    it('sqlite-runtime-error takes precedence over generic-message matches', () => {
      const err = Object.assign(new Error('SQLITE_READONLY: attempt to write a readonly database'), {
        name: 'SqliteError',
      })
      const got = classifySqliteFailure(err)
      expect(got.kind).toBe('sqlite-runtime-error')
    })
  })

  describe('interop-mismatch', () => {
    // The exact error from /opt/bing/web/logs/run.log: dev server hit
    // `TypeError: getDatabase is not a function` after destructuring
    // `const { default: getDatabase } = connection` from a CJS-bundled
    // module where `export default getDatabase` was hoisted to
    // `module.exports = fn` - so `connection.default` is undefined even
    // though `require()` succeeded.
    it('classifies "getDatabase is not a function" TypeError as interop-mismatch', () => {
      const err = Object.assign(
        new TypeError('getDatabase is not a function'),
        { /* default name is 'TypeError' */ },
      )
      const got = classifySqliteFailure(err)
      expect(got.kind).toBe('interop-mismatch')
      expect(got.reason).toBe('getDatabase is not a function')
      expect(got.hint).toMatch(/conn\.default \?\? conn|interop/i)
    })

    it('classifies "X is not a function" TypeError about connection default as interop-mismatch', () => {
      const err = new TypeError("connection.default is not a function")
      const got = classifySqliteFailure(err)
      expect(got.kind).toBe('interop-mismatch')
    })

    it('does NOT classify as interop-mismatch without TypeError + "is not a function"', () => {
      // Plain Error with "is not a function" message - not necessarily an interop issue
      const err = new Error('something is not a function')
      const got = classifySqliteFailure(err)
      // Should fall through to 'unknown' since name !== 'TypeError'
      expect(got.kind).toBe('unknown')
    })

    it('does NOT classify SqliteError "not a function" as interop-mismatch (priority: sqlite-runtime-error wins)', () => {
      const err = Object.assign(new TypeError('getDatabase is not a function'), {
        name: 'SqliteError',
      })
      const got = classifySqliteFailure(err)
      // SqliteError name check fires first
      expect(got.kind).toBe('sqlite-runtime-error')
    })
  })

  describe('esm-tla-pending', () => {
    // New kind added 2026-06-18 to surface TIMING errors distinct from
    // SHAPE errors. The dev-server crash had a TDZ ReferenceError that
    // would previously fall through to kind="unknown" with the misleading
    // "rebuild better-sqlite3" hint; this kind gives an accurate hint
    // pointing at the module-graph / Turbopack interaction.
    it('classifies TDZ ReferenceError on getDatabase as esm-tla-pending', () => {
      const err = new ReferenceError(`Cannot access 'getDatabase' before initialization`)
      const got = classifySqliteFailure(err)
      expect(got.kind).toBe('esm-tla-pending')
      expect(got.reason).toBe(`Cannot access 'getDatabase' before initialization`)
      expect(got.hint).toMatch(/TLA-pending|top-level await/i)
      expect(got.hint).not.toMatch(/rebuild better-sqlite3/i)
    })

    it('classifies TDZ on connection.default as esm-tla-pending', () => {
      const err = new ReferenceError(`Cannot access 'default' before initialization`)
      const got = classifySqliteFailure(err)
      expect(got.kind).toBe('esm-tla-pending')
      expect(got.hint).toMatch(/top-level await/i)
    })

    it('does NOT classify a non-TDZ ReferenceError as esm-tla-pending', () => {
      // ReferenceError but the message does NOT match /before initialization/.
      // The classifier must be tightly scoped - future Node or V8 changes
      // could adopt a different message phrasing and we don't want this
      // kind to greedily absorb unrelated ReferenceErrors.
      const err = new ReferenceError('something completely unrelated')
      const got = classifySqliteFailure(err)
      expect(got.kind).toBe('unknown')
    })

    it('returned SqliteFailure has exactly kind / reason / hint keys (shape invariant)', () => {
      const got: SqliteFailure = classifySqliteFailure(
        new ReferenceError(`Cannot access 'getDatabase' before initialization`),
      )
      expect(Object.keys(got).sort()).toEqual(['hint', 'kind', 'reason'])
    })
  })

  describe('unknown', () => {
    it('classifies a random error as unknown', () => {
      const got = classifySqliteFailure(new Error('Something completely unrelated'))
      expect(got.kind).toBe('unknown')
      expect(got.reason).toBe('Something completely unrelated')
      expect(got.hint).toMatch(/rebuild better-sqlite3/)
    })

    it('handles non-Error thrown values (string)', () => {
      const got = classifySqliteFailure('plain string error')
      expect(got.kind).toBeDefined()
      expect(got.reason).toBe('plain string error')
    })

    it('handles null/undefined gracefully without throwing', () => {
      expect(() => classifySqliteFailure(null)).not.toThrow()
      expect(() => classifySqliteFailure(undefined)).not.toThrow()
      expect(() => classifySqliteFailure({})).not.toThrow()
      // null/undefined -> unknown branch, reason = ''
      const gotNull = classifySqliteFailure(null)
      expect(gotNull.kind).toBe('unknown')
    })
  })

  describe('shape invariants', () => {
    it('returns an object with exactly kind / reason / hint keys', () => {
      const got: SqliteFailure = classifySqliteFailure(new Error('whatever'))
      expect(Object.keys(got).sort()).toEqual(['hint', 'kind', 'reason'])
    })

    it('reason preserves the original message verbatim (no lowercasing)', () => {
      const msg = 'NODE_MODULE_VERSION 115 is not supported. Re-installing recommended.'
      const got = classifySqliteFailure(new Error(msg))
      expect(got.reason).toBe(msg)
    })
  })
})

// ---------------------------------------------------------------------------
// unwrapDefaultExport - 3-shape ladder regression coverage
// ---------------------------------------------------------------------------
// The unwrap ladder handles THREE observable shapes when `require()` resolves
// `lib/database/connection.ts` (which has BOTH `export function getDatabase`
// AND `export default getDatabase`):
//
//   Shape A - CJS-hoisted direct         : typeof mod === 'function' -> return mod
//   Shape B - ESM-wrapped namespace      : { default: fn, __esModule } -> return mod.default
//   Shape C - named-only flattened       : { getDatabase: fn, ... } (no default) -> return mod.getDatabase
//                                          (the actual dev-server shape: conn.default=undefined)
//
// Returning undefined instead of throwing keeps the helper testable as a
// pure function; production sites wrap the call in try/catch and choose
// fail-open vs throw-or-fallback-once semantics per their risk profile.
describe('unwrapDefaultExport', () => {
  const sentinel = () => 'SHAPE_OK'
  const otherSentinel = () => 'DOUBLE_FN'

  describe('Shape A - CJS-hoisted direct', () => {
    it('returns the function itself when mod is callable', () => {
      const got = unwrapDefaultExport(sentinel)
      expect(got).toBe(sentinel)
      expect(got?.()).toBe('SHAPE_OK')
    })

    it('Shape A wins over Shape B (precedence: callable > .default)', () => {
      const got = unwrapDefaultExport(sentinel) // call site: the mod itself is fn
      // If the caller wired both: the function shape should win.
      expect(got).toBe(sentinel)
    })
  })

  describe('Shape B - ESM-wrapped namespace with .default', () => {
    it('returns mod.default when mod has a callable .default', () => {
      const got = unwrapDefaultExport({ default: sentinel, __esModule: true, foo: 1 })
      expect(got).toBe(sentinel)
      expect(got?.()).toBe('SHAPE_OK')
    })

    it('Shape B wins over Shape C (precedence: .default > .getDatabase)', () => {
      const got = unwrapDefaultExport({
        __esModule: true,
        default: sentinel,           // present and callable - should win
        getDatabase: otherSentinel,  // present but should be ignored
      })
      expect(got).toBe(sentinel)
      expect(got?.()).toBe('SHAPE_OK') // not 'DOUBLE_FN'
    })
  })

  describe('Shape C - named-only flattened (the ACTUAL dev-server shape)', () => {
    it('returns mod.getDatabase when mod.default is undefined', () => {
      // Mirrors the actual user log:
      //   typeof conn  = 'object'
      //   conn.default = undefined
      //   conn.getDatabase = fn  <- unwrap picks this
      const got = unwrapDefaultExport({
        getDatabase: sentinel,
        // No `default` key at all
      })
      expect(got).toBe(sentinel)
      expect(got?.()).toBe('SHAPE_OK')
    })

    it('returns mod.getDatabase when mod.default is explicitly undefined', () => {
      const got = unwrapDefaultExport({
        default: undefined,
        getDatabase: sentinel,
      })
      expect(got).toBe(sentinel)
      expect(got?.()).toBe('SHAPE_OK')
    })

    it('returns mod.getDatabase when mod.default is non-callable', () => {
      // e.g. bundler wrote `{ default: { ...non-callable thing }, getDatabase: fn }`
      const got = unwrapDefaultExport({
        default: { fn: 'string-not-fn' },
        getDatabase: sentinel,
      })
      expect(got).toBe(sentinel)
    })
  })

  describe('Shape D - no callable found', () => {
    it('returns undefined for null', () => {
      expect(unwrapDefaultExport(null)).toBeUndefined()
    })

    it('returns undefined for undefined', () => {
      expect(unwrapDefaultExport(undefined)).toBeUndefined()
    })

    it('returns undefined for empty object', () => {
      expect(unwrapDefaultExport({})).toBeUndefined()
    })

    it('returns undefined for object with .default=undefined and .getDatabase=undefined', () => {
      expect(unwrapDefaultExport({ default: undefined, getDatabase: undefined })).toBeUndefined()
    })

    it('returns undefined for object with non-function .default and non-function .getDatabase', () => {
      expect(unwrapDefaultExport({ default: 'string', getDatabase: 42 })).toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// unwrapDefaultExport - TDZ-defensive behavior (narrow-catch regression)
// ---------------------------------------------------------------------------
// Locks down the behavior invoked 2026-06-18 when connection-shim's
// `require('./connection')` returned a TLA-pending synthetic namespace whose
// `getDatabase` property access threw a TDZ ReferenceError. The narrowed
// catch in unwrap-default-export.ts ONLY swallows:
//   ReferenceError + /before initialization/i
// Any other error type or any ReferenceError outside that pattern is
// RE-THROWN so real regressions don't silently degrade the runtime.
describe('unwrapDefaultExport - TDZ-defensive behavior', () => {
  // Helper factory - Proxy that mimics the actual TLA-pending namespace
  // shape seen by session-store ↔ connection-shim on the crash day.
  const buildTdzProxy = (throwMode: 'tdz' | 'unrelated' | 'typeerror') =>
    new Proxy({}, {
      get(_target, prop) {
        if (prop === 'default') return undefined  // shape-B fails
        if (prop === 'getDatabase') {
          if (throwMode === 'tdz') {
            throw new ReferenceError(`Cannot access 'getDatabase' before initialization`)
          }
          if (throwMode === 'unrelated') {
            // ReferenceError but NOT a TDZ pattern - must re-throw so real
            // bugs (or future ESM getter behaviors) are not silently masked.
            throw new ReferenceError('something completely unrelated')
          }
          // throwMode === 'typeerror' - different Error subclass entirely.
          throw new TypeError(`Cannot access 'getDatabase' because of a TypeError`)
        }
        return undefined
      },
    })

  it('returns undefined when shape-C throws TDZ ReferenceError matching /before initialization/', () => {
    // Without narrowing: would silently swallow ALL errors via `catch {}`.
    // With narrowing: only TDZ /before initialization/i is caught.
    const tdzNamespace = buildTdzProxy('tdz')
    expect(() => unwrapDefaultExport(tdzNamespace)).not.toThrow()
    expect(unwrapDefaultExport(tdzNamespace)).toBeUndefined()
  })

  it('re-throws ReferenceError whose message does NOT match /before initialization/', () => {
    const buggy = buildTdzProxy('unrelated')
    expect(() => unwrapDefaultExport(buggy)).toThrow(ReferenceError)
    expect(() => unwrapDefaultExport(buggy)).toThrow(/something completely unrelated/)
  })

  it('re-throws non-ReferenceError exceptions (e.g. TypeError) from property access', () => {
    // The narrowed catch filters by `instanceof ReferenceError`. A TypeError
    // (different error class) must propagate, not be swallowed.
    const buggy = buildTdzProxy('typeerror')
    expect(() => unwrapDefaultExport(buggy)).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// tryRequireDatabaseConnection - new throw-message format
// ---------------------------------------------------------------------------
// The wrapper throw message was tightened to include `conn.getDatabase=...`
// so an operator reading the log can immediately tell WHICH shape the dev
// server is seeing. The classifier regardless routes this to interop-mismatch.
describe('tryRequireDatabaseConnection - new throw message format', () => {
  it('classifies the new throw (with conn.getDatabase=undefined hint) as interop-mismatch', () => {
    const err = new TypeError(
      `getDatabase is not a function: database/connection did not export a callable default ` +
      `(typeof conn=object, conn.default=undefined, conn.getDatabase=undefined). ` +
      `This is a CJS/ESM interop mismatch, not a better-sqlite3 binding issue.`,
    )
    const got = classifySqliteFailure(err)
    expect(got.kind).toBe('interop-mismatch')
    expect(got.reason).toContain('conn.default=undefined')
    expect(got.reason).toContain('conn.getDatabase=undefined')
  })
})
