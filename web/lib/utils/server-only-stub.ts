/**
 * Client-side stub for 'server-only' npm package.
 *
 * The 'server-only' package throws at import time to prevent server-only
 * code from being bundled into client components. However, transitive
 * import chains (e.g., bash-tool.ts → index.server.ts → 'server-only')
 * can leak server-only imports into client bundles even through
 * dynamic import() calls that Next.js traces statically.
 *
 * This stub replaces 'server-only' with a no-op in client webpack builds,
 * preventing the build-time throw while preserving the module's intent:
 * server-only code that leaks into the client bundle simply becomes a
 * dead import (no-op) rather than a build failure.
 *
 * NOTE: This does NOT make server-only code work on the client —
 * Node.js APIs (fs, child_process, etc.) are still stubbed to `false`
 * by the webpack fallback config. It only prevents the 'server-only'
 * package's import-time throw.
 */
// No-op: 'server-only' has no exports, it's a side-effect-only module
// that throws at import time. In client builds, we suppress the throw.
export {};
