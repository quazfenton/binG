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
/**
 * @rationale `= stub` Proxy (Rule B proposed-it-inline-at-imp-boundary): Turbopack static-rejects `import { Headers / Request / Response / fetch }` from `node-fetch` because the static-resolved named-export list is empty; the Proxy preserves callable+construct shape across `Headers.constructor(...)` / `fetch(url)` / `Request(input)` so every CJS-importer collapse-via-stub. Remove when `node-fetch` is removed from the transitive CJS chain.
 * Ticket: SEV-10.
 */
export const Headers = stub;
/**
 * @rationale `= stub` Proxy: same Turbopack static-reject as Headers above; Proxy preserves `new Request(input)` constructor invocation through the construct trap.
 * Ticket: SEV-10.
 */
export const Request = stub;
/**
 * @rationale `= stub` Proxy: same Turbopack static-reject; Proxy preserves `new Response(body)` + `response.headers.get(...)` chains via get/apply traps returning `stub`.
 * Ticket: SEV-10.
 */
export const Response = stub;
/**
 * @rationale arrow returning stub: the Web-Fetch API needs a callable shape; Proxy's `apply` trap handles `fetch(url)` directly, but a typed arrow `(args) => unknown => stub` keeps the export shape distinct from the Proxy-shaped cousins, signaling "this name MAY be called with args and is intentionally permissive" to readers.
 * Ticket: SEV-10.
 */
export const fetch = (..._args: unknown[]): unknown => stub;

// ---- mcporter named exports (consumed by lib/mcp/mcporter-integration.ts:
//      `import { createRuntime } from 'mcporter'`).
//      createRuntime is the function-shaped export; `Runtime` and
//      `ServerDefinition` are TYPE-only imports in the consumer (elided by
//      the bundler) and don't need static runtime declarations.
export const createRuntime = (..._args: unknown[]): unknown => stub;

// ---- @daytonaio/sdk / modal / tar / shared request/stream primitives.
//      Some of the names below ARE statically referenced today:
//        - Daytona@SEV-13  →  lib/sandbox/providers/daytona-provider.ts:1
//        - ModalClient@SEV-14  →  lib/sandbox/providers/modal-com-provider.ts:40
//      The others (Headers / Request / Response / fetch / createRuntime /
//      Sandbox / Image / App / Secret / Volume) are preemptively listed to
//      short-circuit the next consumer's named-export rejection without
//      requiring a new fix. Sandbox / Image / Volume are SHARED between
//      @daytonaio/sdk and modal — a single declaration satisfies both
//      packages' named-import sites (the Proxy doesn't care which surface
//      it fronts for). Caveat: type-level fidelity is collapsed via the
//      Proxy's `any`-shaped return — future `import type { Sandbox } from
//      '@daytonaio/sdk'` would resolve to the stub's `any` type,
//      losing real SDK type shapes. If per-package type fidelity matters,
//      split into `empty-module-daytonaio.ts` + `empty-module-modal.ts`
//      and re-route the webpack aliases in next.config.mjs.
//      The Headers / Request / Response / fetch set covers
//      the Web-Fetch API surface used by transitive CJS importers page-
//      listed in SEV-10.

// SEV-14 (2026-06-18 modal-com-provider dev-boot fix): the `modal` npm
// package is alias-mapped to this stub via next.config.mjs's
// `turbopack.resolveAlias`; without explicit named exports, Turbopack's
// static resolver rejects the named imports at instrumentation
// compile-time with:
//   "The export ModalClient was not found in module
//    [project]/web/lib/utils/empty-module.ts [instrumentation] (ecmascript).
//    Did you mean to import default?"
// Surfaced via the route-loader chain: modal-com-provider →
// providers/index → instrumentation.ts. Adding the 6 named exports used
// by `lib/sandbox/providers/modal-com-provider.ts:40`:
// `import { ModalClient, Sandbox, Image, App, Secret, Volume } from 'modal'`.
// Using `= stub` (the Proxy) preserves both `ModalClient({...})` factory
// call and `new ModalClient({...})` constructor invocation, matching the
// Daytona / Headers / Request precedent. The docs examples under
// `docs/sdk/modal/examples/*.ts` are excluded from the web tsconfig
// `include` (they live under `docs/`), so only the production-code
// symbols in modal-com-provider.ts trigger the rejection — adding only
// these 6 covers the actual reach without bloating the stub.
/**
 * @rationale `= stub` Proxy: Turbopack static-rejects `import { X } from 'modal'` without these declarations; shared names cover both `@daytonaio/sdk` and `modal` because Proxy is shape-agnostic. Caveat per Rule C: collapses `import type` fidelity (any-return). Drift anchor (ARCH-001 Flag 3): see /opt/bing/scripts/vendor-api-snapshots/modal.json. Ticket: SEV-14.
 */
export const ModalClient = stub;
export const Sandbox = stub;
export const Image = stub;
export const App = stub;
export const Secret = stub;
export const Volume = stub;

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
/**
 * @rationale `= stub` Proxy (Rule B 9-site import-level adapter): Turbopack's `turbopack.resolveAlias` for `@daytonaio/sdk` static-rejects `import { Daytona } from '@daytonaio/sdk'` at compile-time without this declaration; Proxy preserves factory-call `Daytona({...})` AND constructor-call `new Daytona({...})` through apply+construct traps, matching the Headers/Request/Response precedent (Rule A zero-state — no replacement at the call boundary needed because the Proxy exports already handle the runtime shape). Each downstream export (Blob/File/FormData/URL/URLSearchParams/ReadableStream/Buffer/process) serves the same defensive role; the lib-side surface area is pre-declared so the next SDK-area consumer's static-reject is short-circuited without a new fix ticket.
 * Ticket: SEV-13. Removal trigger: re-shim per-package if `import type { ... }` fidelity is required.
 */
export const Daytona = stub;
export const Blob = stub;
export const File = stub;
export const FormData = stub;
export const URL = stub;
export const URLSearchParams = stub;
export const ReadableStream = stub;
export const Buffer = stub;
export const process = stub;

// SEV-15 (2026-06-18 proactive @daytonaio/sdk coverage expansion):
// last-verified-against: @daytonaio/sdk@0.175.0. ARCH-001 Flag 3 drift anchor:
// see /opt/bing/scripts/vendor-api-snapshots/@daytonaio_sdk.json for the pinned
// named-export set. On the next SDK bump: run
//   pnpm check:vendor-drift --check=vendor --update
//   (or: bash /opt/bing/scripts/preflight.sh)
// to refresh the snapshot; detected drift surfaces as a preflight FAIL.
// Pre-declares the next tier of commonly-used @daytonaio/sdk surface area
// via the same `stub` Proxy. None of these are statically referenced yet in
// any source file, but they short-circuit the next consumer's static-reject
// without requiring a new fix ticket. Rationale per symbol:
//   - FileSystem: returned by Sandbox.getFileSystem(); daytona-provider.ts
//     does not yet call it, but the dev-loop sandbox-shape probe will.
//   - Workspace:  high-level lifecycle container; sandbox.create({...})
//     accept-list includes `workspace: Workspace` in current SDK docs.
//   - DockerImage: an image-build input — daytona-builder.ts:20 already has
//     `import type { DockerImage as DockerImageType } from '@daytonaio/sdk'`
//     currently commented out; once uncommented it would re-trigger the
//     same rejection absent this declaration.
//   - Chart:      preset helper for chart-shaped agent runs (docs ref).
//   - ComputerUse: agent-loop primitive (not yet wired in
//     lib/computer/daytona-computer-use-workflow.ts).
//   - Snapshot:   state-snapshot type; auto-snapshot-service.ts already
//     references the SYNC layer but not this SDK-side primitive yet.
//
// Webpack-vs-Turbopack failure-mode note: a *missing* named export fails
// DIFFERENTLY per bundler. Turbopack static-rejects at module-eval with the
// SEV-10 message ("The export <X> was not found [...]"). Webpack 5.x is
// more permissive at static time and most often defers the failure to
// runtime as a `TypeError: <X> is not a function` — but ONLY on access
// patterns that bypass the proxy's callable shape, e.g.:
//   - Babel/AST-extracted destructured imports: `const { X } = await
//     import('pkg'); X()` strips the Proxy binding and yields non-callable.
//   - Strict-mode reflective-call: `Reflect.apply(client.foo, ...)` under
//     "use strict" surfaces the non-callable directly.
//   Ordinary chains (`client.foo()`, `client.foo.bar()`) collapse to
//   stub-internally via the get/apply/construct traps and do NOT throw.
// Both bundlers resolve through this stub via the NormalModuleReplacementPlugin
// in next.config.mjs, so the named-export list MUST stay in sync to avoid
// Turbopack's build-time error AND Webpack's narrow-runtime TypeError.
/**
 * @rationale `= stub` Proxy (preemptive SDK coverage): no current static consumer references these symbols, but the SDK's documented surface lists them; pre-declaring short-circuits future static-reject without a new SEV ticket. Pair with ARCH-001 Flag 3 vendor-drift guardrail. Drift anchor: `node_modules/@daytonaio/sdk@0.175.0`. Ticket: SEV-15.
 */
export const FileSystem = stub;
export const Workspace = stub;
export const DockerImage = stub;
export const Chart = stub;
export const ComputerUse = stub;
export const Snapshot = stub;

export default stub;
