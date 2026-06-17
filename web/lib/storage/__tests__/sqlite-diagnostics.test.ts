import { describe, it, expect } from 'vitest'
import {
  classifySqliteFailure,
  type SqliteFailure,
} from '../session-store'

// ---------------------------------------------------------------------------
// classifySqliteFailure — taxonomy coverage
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
      // null/undefined → unknown branch, reason = ''
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
