/**
 * Generic client-side stub for server-only npm packages.
 *
 * Replaces packages like mcporter, modal, tar, node-fetch, @daytonaio/sdk
 * that leak into client bundles via transitive imports. These packages
 * require Node.js built-ins (fs, net, child_process) that don't exist
 * in browser contexts.
 *
 * Returns a no-op proxy that silently accepts any property access or
 * function call, preventing runtime crashes when server-only code is
 * inadvertently imported by client components.
 *
 * SEV-10 (2026-06-18 fix): Each aliased package has CONSUMERS that
 * reference NAMED exports (static ESM imports, not just default). The
 * `Proxy` handles runtime access gracefully, but Turbopack's static
 * resolver rejects any `import { X } from 'aliased-package'` whose `X`
 * is not in the module's static export list — it errors BEFORE the
 * proxy ever gets a chance to handle the lookup. Without explicit
 * named exports below, the dev bundler raises:
 *
 *   The export <Name> was not found in module
 *   [project]/web/lib/utils/empty-module.ts [...] Did you mean to import
 *   default? All exports of the module are statically known [...]
 *
 * Every named export here is the same `stub` proxy at runtime, so any
 * chain like `import { Request } from 'node-fetch'; new Request(...)`
 * still gets a no-op `Request` that returns the proxy — preserving the
 * file's belt-and-suspenders invariant. New consumers referencing a
 * named symbol not yet declared here should add it below; the
 * audit-marker list lives next to the exports so future SEV-N entries
 * find this site via `rg 'SEV-10'`.
 */
const stub = new Proxy(function () { return stub; } as any, {
  get(_target: any, _prop: string | symbol) {
    return stub;
  },
  apply(_target: any, _thisArg: any, _args: any[]) {
    return stub;
  },
  construct(_target: any, _args: any[]) {
    return stub;
  },
});

// ---- node-fetch named exports (consumed by @buttercup/fetch/dist/index.node.js,
//      which transitively leaks into webdav → cloud-storage → instrumentation.ts).
//      Without these Turbopack errors with 'The export Headers was not found...'
//      and the dev log repeats the same message for Request, Response, fetch.
export const Headers = stub;
export const Request = stub;
export const Response = stub;
export const fetch = (..._args: unknown[]): unknown => stub;

// ---- mcporter named exports (consumed by lib/mcp/mcporter-integration.ts:
//      `import { createRuntime } from 'mcporter'`).
//      createRuntime is the function-shaped export; `Runtime` and
//      `ServerDefinition` are TYPE-only imports in the consumer (elided by
//      the bundler) and don't need static runtime declarations.
export const createRuntime = (..._args: unknown[]): unknown => stub;

// ---- @daytonaio/sdk / modal / tar / shared request/stream primitives.
//      These names aren't currently referenced in static imports for the
//      touched files but are listed preemptively so the next consumer
//      hitting the same named-export rejection doesn't require a new fix.
//      Cover the common Web-Fetch API surface plus a handful of common
//      SDK-shaped exports.

// SEV-13 (2026-06-18 followup): @daytonaio/sdk named export — consumed by
// `lib/sandbox/providers/daytona-provider.ts:1` (`import { Daytona }`).
// Turbopack resolves through next.config.mjs's `turbopack.resolveAlias`
// to this stub; without an explicit named export the static ESM resolver
// rejects the import at instrumentation compile-time with:
//   "The export Daytona was not found in module
//    [project]/web/lib/utils/empty-module.ts [...] Did you mean to import
//    createRuntime?"
// Surfaced via the route-loader chain: daytona-provider → providers/index →
// opencode-cli → tools/router → tools/capabilities → tools/loader →
// server-init → instrumentation.ts. Using `= stub` (the Proxy) preserves
// both `Daytona({...})` factory call and `new Daytona({...})` constructor
// invocation through the Proxy's `apply` / `construct` traps, matching the
// Headers/Request/Response precedent.
export const Daytona = stub;
export const Blob = stub;
export const File = stub;
export const FormData = stub;
export const URL = stub;
export const URLSearchParams = stub;
export const ReadableStream = stub;
export const Buffer = stub;
export const process = stub;

export default stub;
