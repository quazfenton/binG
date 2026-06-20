// scripts/probe-loader-hooks.mjs
//
// Node Module loader hook consumed by /opt/bing/web/scripts/probe-chat-route.ts.
//
// Registered in-process by the probe via `register()` from node:module,
// BEFORE any module that would otherwise load the real collaborators.
// Intercepts the specifier paths listed in probe-stub-manifest.ts and
// substitutes synthetic ESM source containing the layer's primary-fn stub
// wrapped in a `taggedUpstream(...)` call — so ALS captures per-call
// timing tags emitted by the stub without invoking the real implementation.
//
// VERSION 4: module-hooks-driven real-stub loader. Per the thinker's
// recommendation: override `resolve()` to short-circuit intercepted
// specifiers to a sentinel URL, then override `load()` to return
// generated synthetic source keyed by the sentinel.

import { pathToFileURL, fileURLToPath } from 'node:url';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const PROBE_DIR = fileURLToPath(new URL('.', import.meta.url));
const CHAT_ROUTE_URL = pathToFileURL(`${PROBE_DIR}/probe-chat-route.ts`).href;
const MANIFEST_URL = pathToFileURL(`${PROBE_DIR}/probe-stub-manifest.ts`).href;

// Sentinel scheme so resolve() and load() agree on what to substitute.
// `?stub=SPEC` keeps the URL parser happy while staying short enough
// to recognize on a substring match.
const STUB_PREFIX = MANIFEST_URL + '?stub=';

// --------------------------------------------------------------------------
// Manifest cache — populated by initialize().
// --------------------------------------------------------------------------

let manifestCache = null;

async function loadManifest() {
  if (manifestCache) return manifestCache;
  const mod = await import(MANIFEST_URL);
  manifestCache = mod.stubManifest;
  return manifestCache;
}

// --------------------------------------------------------------------------
// Hook: initialize() — runs once when the loader is registered.
// --------------------------------------------------------------------------

export async function initialize() {
  await loadManifest();
  // Manifest keys are the specifiers interceptors will match on.
}

// --------------------------------------------------------------------------
// Hook: resolve(specifier, context, nextResolve).
//
// Intercepts:
//   - specifiers listed in stubManifest
//   - 'next/server' (replaced with synthetic Web Request shim)
//
// All other specifiers pass through to the default resolver (which lets
// tsx handle .ts and .tsx as usual).
// --------------------------------------------------------------------------

export async function resolve(specifier, context, nextResolve) {
  // Lazy-load the manifest on the first resolve call.
  if (!manifestCache) {
    try {
      await loadManifest();
    } catch (_e) {
      // Manifest load failed — fall through so we don't block standard resolution.
      return nextResolve(specifier, context);
    }
  }

  // Intercept next/server (Next.js framework import) — replace with shim.
  if (specifier === 'next/server') {
    return { url: STUB_PREFIX + 'next/server', shortCircuit: true };
  }

  // Intercept manifest specifiers.
  if (Object.prototype.hasOwnProperty.call(manifestCache, specifier)) {
    return { url: STUB_PREFIX + encodeURIComponent(specifier), shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

// --------------------------------------------------------------------------
// Hook: load(url, context, nextLoad).
//
// Generates synthetic ESM source for our stub URLs:
//   - <MANIFEST_URL>?stub=<specifier>    → stub source for that specifier
//   - <MANIFEST_URL>?stub=next/server    → next/server shim source
// --------------------------------------------------------------------------

export async function load(url, context, nextLoad) {
  if (url.startsWith(STUB_PREFIX)) {
    const spec = decodeURIComponent(url.slice(STUB_PREFIX.length));

    if (spec === 'next/server') {
      return {
        format: 'module',
        source: NEXT_SERVER_SHIM,
        shortCircuit: true,
      };
    }

    const entry = manifestCache[spec];
    if (!entry) {
      // Unknown stub spec — fall through to the real resolver path.
      return nextLoad(url, context);
    }
    return {
      format: 'module',
      source: generateStubSource(entry, spec),
      shortCircuit: true,
    };
  }

  return nextLoad(url, context);
}

// --------------------------------------------------------------------------
// Synthetic source generator
// --------------------------------------------------------------------------
//
// For each manifest entry, generate ESM source that:
//   1. Imports `taggedUpstream` from probe-chat-route.ts (real .ts file
//      which tsx evaluates normally).
//   2. Re-exports each stub function with `taggedUpstream(...)` wrapping.
//
// `taggedUpstream(layer, variant, latencyMs, payload)` itself awaits
// `setTimeout(latencyMs)` then returns `payload`. That setTimeout is what
// produces the synthetic per-call latency used to compare against the audit
// claim's per-upstream measurement.

function generateStubSource(entry, spec) {
  const lines = [];
  lines.push(`// AUTOMATIC STUB — generated by probe-loader-hooks.mjs`);
  lines.push(`// intercepts: ${spec}`);
  lines.push(`// layer: ${entry.layer} | K=${entry.parallelK} | primaryLatency=${entry.primaryFnLatency_ms}ms`);
  lines.push(`import { taggedUpstream } from ${JSON.stringify(CHAT_ROUTE_URL)};`);
  lines.push(``);
  for (const [name, stubFn] of Object.entries(entry.stubExports)) {
    // Emit: export const NAME = async (...args) => {
    //   return taggedUpstream(LAYER, 'parallel', LATENCY, await (STUB_BODY)(...args));
    // };
    const stubSource = stubFn.toString();
    lines.push(`export const ${name} = async (...args) => {`);
    lines.push(
      `  return taggedUpstream(${JSON.stringify(entry.layer)}, 'parallel', ${
        entry.primaryFnLatency_ms
      }, await (${stubSource})(...args));`,
    );
    lines.push(`};`);
    lines.push(``);
  }
  // Generic passthrough for any un-instrumented export of the real module.
  // The loader intentionally only emits the audited stubs; if route.ts
  // happens to use another export from the same module, that path will
  // throw `undefined is not a function`. Monitor the probe output for
  // this signal and extend the manifest accordingly.
  lines.push(`export default null;`);
  lines.push(``);
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// next/server shim — minimal Web Request/Response compatible shapes
// sufficient for route.ts's import-time evaluation and POST handler body.
// --------------------------------------------------------------------------
//
// route.ts destructures `NextRequest` (constructor used) and `NextResponse`
// (static `.json()` used). Cookies / headers accessed via `.cookies.get()`
// and `.headers.get()`. This shim keeps those APIs working without the
// Next.js runtime.

const NEXT_SERVER_SHIM = `
// AUTOMATIC SHIM — generated by probe-loader-hooks.mjs for next/server
class NextRequestShim {
  constructor(url, init) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    this._url = u;
    const h = (init && init.headers) || {};
    this.headers = new Headers(h);
    this._cookies = new Map();
    const cookieHeader = this.headers.get('cookie') || '';
    for (const pair of cookieHeader.split(/;\\s*/)) {
      if (!pair) continue;
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      this._cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  get url() { return this._url; }
  get cookies() { return this._cookies; }
  async json() { return {}; }
  async text() { return JSON.stringify({}); }
  async arrayBuffer() { return new ArrayBuffer(0); }
}
class NextResponseShim {
  constructor(body, init) {
    this._body = body ?? '';
    this.status = (init && init.status) || 200;
    this.headers = new Headers((init && init.headers) || {});
    this._cookies = new Map();
  }
  static json(body, init) {
    return new NextResponseShim(JSON.stringify(body), {
      ...(init || {}),
      headers: { 'content-type': 'application/json', ...((init && init.headers) || {}) },
    });
  }
  async json() {
    return typeof this._body === 'string' ? JSON.parse(this._body) : this._body;
  }
  async text() { return typeof this._body === 'string' ? this._body : JSON.stringify(this._body); }
  get cookies() { return this._cookies; }
}
export { NextRequestShim as NextRequest, NextResponseShim as NextResponse };
`;
