// ============================================================================
// lib/database/sqlite-failure.ts — LEAF MODULE for SQLite failure taxonomy
// ============================================================================
// SEV-11 follow-up (2026-06-18): `classifySqliteFailure` used to live in
// `lib/storage/session-store.ts`. connection.ts imported it from there
// (`import { classifySqliteFailure } from '@/lib/storage/session-store'`),
// which CLOSED an import cycle:
//
//   connection.ts
//     → (import) session-store.ts
//         → (module-load) tryRequireDatabaseConnection()
//             → require('../database/connection-shim')
//                 → (module-load) require('./connection')   ← back to a
//                    partially-evaluated connection.ts (only reached the
//                    classifySqliteFailure import line), whose `getDatabase`
//                    binding is still in the TDZ
//                 → unwrapDefaultExport(conn).getDatabase access throws
//                    "Cannot access 'getDatabase' before initialization"
//
// `classifySqliteFailure` is a PURE function with no dependencies, so moving
// it to this leaf module lets connection.ts import the classifier WITHOUT
// pulling in session-store's module-load DB init. session-store.ts re-exports
// the symbols from here so every existing `@/lib/storage/session-store`
// importer keeps working unchanged.
// ============================================================================

export type SqliteFailureKind =
  | 'arch-mismatch'
  | 'libc-missing'
  | 'abi-mismatch'
  | 'native-not-built'
  | 'module-not-installed'
  | 'cjs-of-esm'
  | 'sqlite-runtime-error'
  | 'interop-mismatch'
  | 'esm-tla-pending'
  | 'unknown';

export interface SqliteFailure {
  kind: SqliteFailureKind;
  reason: string;
  hint: string;
}

/**
 * Best-effort classification of a failure encountered while requiring or
 * initializing better-sqlite3. Combines `message`, `code`, and `name` into a
 * single haystack so a check on `err.code === 'ERR_REQUIRE_ESM'` does not
 * silently miss the actual message text.
 *
 * Pure function — exported for direct unit testing without needing vi.mock
 * on the better-sqlite3 native module.
 */
export function classifySqliteFailure(err: unknown): SqliteFailure {
  const e = err as { message?: string; code?: string; name?: string } | null;
  const haystack =
    `${e?.message ?? ''} ${e?.code ?? ''} ${e?.name ?? ''}`.toLowerCase();

  // SqliteError instances mean the binding loaded but a SQL operation failed
  // (locked DB, permission denied, file-system error, etc.) — distinctly
  // different from a binding-load failure and a different remediation path.
  if (err instanceof Error && err.name === 'SqliteError') {
    return {
      kind: 'sqlite-runtime-error',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 loaded but a SQL operation failed (database locked, missing directory, permission denied, or schema mismatch); check DATABASE_PATH and filesystem permissions',
    };
  }
  if (
    /wrong architecture|incorrect elf|not a valid (win32|mach-o)|invalid target|mach-o .* but.+ is required/.test(
      haystack
    )
  ) {
    return {
      kind: 'arch-mismatch',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 .node binary was built for a different CPU architecture (x64 vs arm64, macOS vs Linux); run `pnpm rebuild better-sqlite3` to recompile against the current arch',
    };
  }
  if (
    /glibc[_\s]?\d|libstdc\+\+|libc\+\+|libc\.so\.1|cannot open shared object|libgcc_s\.so|libcrypto\.so|libssl\.so/.test(
      haystack
    )
  ) {
    return {
      kind: 'libc-missing',
      reason: e?.message ?? haystack,
      hint:
        'a native shared library (libc++ / libstdc++ / libssl) is missing; on Alpine run `apk add libstdc++`, on Debian/Ubuntu install `libc6` + `libssl3`, then `pnpm rebuild better-sqlite3`',
    };
  }
  if (
    /node_module_version|the module '[^']+' was compiled against a different node|abi version/i.test(
      haystack
    )
  ) {
    return {
      kind: 'abi-mismatch',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 was compiled against a different Node.js version; run `pnpm rebuild better-sqlite3` to recompile against the current NODE_MODULE_VERSION',
    };
  }
  if (
    /could not locate the bindings|bindings? (file)? .* did not match|the specified module could not be found|enoent/.test(
      haystack
    )
  ) {
    return {
      kind: 'native-not-built',
      reason: e?.message ?? haystack,
      hint:
        'the prebuilt .node binary is missing or invalid for this platform; try `pnpm install --force better-sqlite3` then `pnpm rebuild better-sqlite3`',
    };
  }
  if (/cannot find module 'better-sqlite3'|cannot find package 'better-sqlite3'/.test(haystack)) {
    return {
      kind: 'module-not-installed',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 is not declared as a dependency; add it with `pnpm add better-sqlite3` and rebuild',
    };
  }
  if (/err_require_esm|require\(\) of es module|\berm\b.*esm/.test(haystack)) {
    return {
      kind: 'cjs-of-esm',
      reason: e?.message ?? haystack,
      hint:
        'a CJS require() tried to import an ESM module; replace the require() with a dynamic import() or upgrade better-sqlite3 to a CJS-compatible prebuild',
    };
  }
  // CJS/ESM default-export hoisting mismatch: `module.exports = fn` (default
  // hoisted to module.exports), so `require(...).default` is undefined but
  // `require(...)` IS the callable. Distinguish from generic TypeErrors by
  // requiring TypeError AND a function-callability signal. Match EITHER the
  // runtime message ("is not a function") OR our wrapper's own throw message
  // ("did not export a callable default") — both signal the same CJS/ESM
  // interop issue and should yield the same hint.
  if (
    err instanceof TypeError &&
    (/is not a function/.test(haystack) || /did not export a callable default/.test(haystack)) &&
    /getDatabase|default/i.test(haystack)
  ) {
    return {
      kind: 'interop-mismatch',
      reason: e?.message ?? haystack,
      hint:
        'database/connection-shim module loaded but its default export was not callable through this require() site — CJS/ESM interop hoisted the default to module.exports. Use `conn.default ?? conn` (defensive unwrap) instead of destructuring `const { default } = conn`.',
    };
  }
  // SEV-8 (2026-06-18 audit chain) — ESM TLA-pending case. Node.js throws `ReferenceError: Cannot access
  // '<name>' before initialization` when a CJS `require()` reads named exports
  // from a synthetic namespace whose owning module is mid-evaluation (top-level
  // await not yet resolved). Observed verbatim in run.log on 2026-06-18 against
  // connection-shim's `require('./connection')` where connection.ts has
  // `const { createRequire } = await import('node' + ':module')`. Classify as
  // its own kind so operators see accurate remediation instead of the vague
  // `unknown`-hint "rebuild better-sqlite3". SEV-2 hard-fail policy applies —
  // see decideOnSqliteLoadFailure.
  if (
    /cannot access .* before initialization/i.test(haystack) &&
    /getDatabase|default/i.test(haystack)
  ) {
    return {
      kind: 'esm-tla-pending',
      reason: e?.message ?? haystack,
      // NOTE: double-quote outer string so the inner `await import('node:module')`
      // substring does not break the literal. Single-quoted outer (matching the
      // other hints above) would close prematurely on the `'` inside `import('..')`
      // and trip the parser with `Expected , or } but found Identifier`.
      hint:
        'an ESM dependency (connection.ts) is mid-evaluation due to a top-level await; `require()` returned a TLA-pending namespace whose named export read threw a TDZ ReferenceError. This is a module-graph / Next.js / Turbopack interaction with the `await import(\"node:module\")` pattern in connection.ts, NOT a better-sqlite3 binding issue. Fix the import cycle or move the `await` inside a function body.',
    };
  }
  return {
    kind: 'unknown',
    reason: e?.message ?? String(err),
    hint:
      'rebuild better-sqlite3 (`pnpm rebuild`) and verify the active Node.js version has a matching prebuild in the better-sqlite3 release matrix',
  };
}
