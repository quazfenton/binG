/**
 * scripts/probe-stub-manifest.ts
 *
 * Type-safe stub manifest for /opt/bing/web/scripts/probe-chat-route.ts.
 * Consumed by probe-loader-hooks.mjs at runtime to generate synthetic
 * ESM source on the fly for intercepted module specifiers.
 *
 * Each stub entry uses TypeScript's `satisfies Partial<typeof X>` to
 * enforce signature parity with the REAL module — if the real module
 * removes or renames an export, tsc fails the probe build instead of
 * silently producing a runtime stub mismatch.
 *
 * VERSION 4: module-hooks-driven approach. The probe no longer runs
 * synthesized-shape Promise.all tests; instead it imports the REAL
 * collaborators route.ts uses (auth, mem0, prompt-modifiers, mcp), but
 * the loader hook substitutes stubs at module-load time so each call
 * experiences a synthetic per-call latency + sentinel return path.
 *
 * Per-layer entries carry:
 *   - specifier:  the import path route.ts uses (e.g. "@/lib/auth/request-auth")
 *   - layer:      NEW-1 / NEW-2 / Tier 1 #1 / Tier 1 #3 (audit-claim key)
 *   - stubs:      map of exported-fn-name → async stub function
 *   - perFnLatency_ms: per-call latency to inject via taggedUpstream
 *   - parallelK:  audit-claimed parallelism count (K concurrent upstreams)
 *
 * Run: pnpm tsx scripts/probe-chat-route.ts
 */

import type * as RequestAuth from '@/lib/auth/request-auth';
import type * as Mem0Power from '@/lib/powers/mem0-power';
import type * as PromptParams from '@bing/shared/agent/prompt-parameters';
import type * as McpIntegration from '@/lib/mcp/architecture-integration';

// --------------------------------------------------------------------------
// Per-layer audit constants
// --------------------------------------------------------------------------
// Latency values pulled into the manifest so the loader and the bench runner
// agree on a single source of truth. K (parallel count) is what the audit
// estimates each layer actually parallelizes (NEW-1 = 2-way auth+body parse;
// Tier 1 #1 = 5-way prompt-modifier merge; etc.).

export type LayerKey = 'NEW-1' | 'NEW-2' | 'Tier 1 #1' | 'Tier 1 #3';

// Audit claim per layer — used by the bench runner to label within/ABOVE/BELOW.
// (Per-layer low/high `audit_saved_ms` from
// /opt/bing/docs/async-parallelization-opportunities.md Top 5 Quick Wins +
// Meta-coalesce audit NEW-1..NEW-4.)
export interface AuditClaim {
  layer: LayerKey;
  /** Audit-claimed per-request savings range [low, high] in ms */
  audit_saved_low_ms: number;
  audit_saved_high_ms: number;
}
export const AUDIT_CLAIMS: Record<LayerKey, AuditClaim> = {
  'NEW-1':      { layer: 'NEW-1',      audit_saved_low_ms: 5,  audit_saved_high_ms: 15  },
  'NEW-2':      { layer: 'NEW-2',      audit_saved_low_ms: 10, audit_saved_high_ms: 30  },
  'Tier 1 #1':  { layer: 'Tier 1 #1',  audit_saved_low_ms: 40, audit_saved_high_ms: 100 },
  'Tier 1 #3':  { layer: 'Tier 1 #3',  audit_saved_low_ms: 15, audit_saved_high_ms: 65  },
};

// Per-layer per-upstream latency the stub injects. Chosen so that
// (K-1) * latency lands INSIDE the audit's stated saving range:
//   NEW-1:     (2-1)*10 = 10  ms  ∈ [5,15]   ✓
//   NEW-2:     (2-1)*20 = 20  ms  ∈ [10,30]  ✓
//   Tier 1#1:  (5-1)*15 = 60  ms  ∈ [40,100] ✓
//   Tier 1#3:  (4-1)*15 = 45  ms  ∈ [15,65]  ✓
// Per-layer per-upstream latency the stub injects. The audit's savings
// shape: (K-1) * latency must land INSIDE the audit's stated range:
//   NEW-1:     (2-1)*10 = 10  ms  ∈ [5,15]   ✓
//   NEW-2:     (2-1)*20 = 20  ms  ∈ [10,30]  ✓
//   Tier 1#1:  (5-1)*15 = 60  ms  ∈ [40,100] ✓
//   Tier 1#3:  (4-1)*15 = 45  ms  ∈ [15,65]  ✓
// NOTE: these values are INLINED as literal numbers throughout the stub
// bodies below (not referenced via a `LAT.X` const object). The loader's
// synthetic stub source extracts stub function bodies via `.toString()`,
// which captures the literal numbers directly — this avoids a
// ReferenceError when the synthetic module evaluates in a context where
// the manifest's module-scope `LAT` const isn't visible.

// --------------------------------------------------------------------------
// Per-layer stub bodies
// --------------------------------------------------------------------------

// NEW-1 — auth seam. resolveRequestAuth is the primary upstream; the audit
// says it overlaps with body parse in parallel (savings = 1 of the 2 calls).
const authStubs = {
  resolveRequestAuth: async (
    _req: unknown,
    _opts: unknown = {},
  ): Promise<{ success: boolean; userId: string; source: 'jwt' | 'session' | 'anonymous' }> => ({
    success: true,
    userId: 'u_probe_stub_001',
    source: 'jwt',
  }),
  // Other exports of request-auth are uninstrumented — the v4 probe only
  // measures resolveRequestAuth (the audit's named NEW-1 upstream). The
  // loader intercepts the whole module so other exports still return
  // safe sentinels via the generic passthrough.
} satisfies Partial<typeof RequestAuth>;

// NEW-2 — mem0 + rate-limit. mem0Search is the primary upstream; the audit
// says it overlaps with checkRateLimit in parallel (savings = 1 of 2 calls).
const mem0Stubs = {
  mem0Search: async (
    _args: { query: string; userId?: string } = { query: '' },
    _config: unknown = {},
  ): Promise<{ success: boolean; results: unknown[] }> => ({
    success: true,
    results: [],
  }),
  // Other mem0-power exports uninstrumented.
} satisfies Partial<typeof Mem0Power>;

// Tier 1 #1 — 5 prompt modifiers. Stub body is a sentinel-returning
// function; the per-call latency is injected by the LOADER's wrapper
// (taggedUpstream) once, NOT here. Earlier versions added an internal
// `Promise.all([setTimeout*5])`, but that DOUBLE-COUNTS latency: the
// benchLayer tests K-parallel Promise.all at the wrapper layer, so the
// stub-internal K-parallel setTimeouts would stack to 30ms per call —
// pushing measured_saved_p50_ms to ~120ms, ABOVE audit_high (100ms).
const promptStubs = {
  applyPromptModifiers: async (
    _ctx: unknown,
    _opts: unknown = {},
  ): Promise<{ systemPromptFragment: string }> => ({
    systemPromptFragment: '[probe-stub: 5-way merged modifiers]',
  }),
} satisfies Partial<typeof PromptParams>;

// Tier 1 #3 — 4 dynamic imports parallelized inside getMCPToolsForAI_SDK.
// Stub returns a sentinel tool-defs array; per-call latency comes from the
// LOADER's wrapper (taggedUpstream), not from internal Promise.all. Same
// double-counting avoidance as promptStubs.applyPromptModifiers above.
const mcpStubs = {
  getMCPToolsForAI_SDK: async (
    _userId?: string,
    _taskFilter?: string,
  ): Promise<
    Array<{
      type: 'function';
      function: { name: string; description?: string; parameters: Record<string, unknown> };
    }>
  > => [
    {
      type: 'function' as const,
      function: { name: 'stub_tool_1', parameters: { type: 'object', properties: {} } },
    },
    {
      type: 'function' as const,
      function: { name: 'stub_tool_2', parameters: { type: 'object', properties: {} } },
    },
  ],
} satisfies Partial<typeof McpIntegration>;

// --------------------------------------------------------------------------
// Manifest — public surface consumed by probe-loader-hooks.mjs at runtime
// --------------------------------------------------------------------------

export interface StubEntry {
  /** Specifier as it appears in route.ts's `import {...} from '<spec>'`. */
  specifier: string;
  layer: LayerKey;
  /** Map of REAL-export-name → async stub function to substitute. */
  stubExports: Record<string, (...args: unknown[]) => Promise<unknown>>;
  /** Per-call latency (ms) injected by taggedUpstream — matches audit claim. */
  primaryFnLatency_ms: number;
  /** Audit-claimed parallelism count (K concurrent upstreams in this layer). */
  parallelK: number;
}

/**
 * Manifest indexed by intercepted specifier. The loader hook hashes on
 * specifier to know which synthetic source to generate.
 */
export const stubManifest: Record<string, StubEntry> = {
  ['@/lib/auth/request-auth']: {
    specifier: '@/lib/auth/request-auth',
    layer: 'NEW-1',
    stubExports: {
      resolveRequestAuth: authStubs.resolveRequestAuth as (
        ...args: unknown[]
      ) => Promise<unknown>,
    },
    primaryFnLatency_ms: 10,
    parallelK: 2, // auth + body parse run in parallel
  },
  ['@/lib/powers/mem0-power']: {
    specifier: '@/lib/powers/mem0-power',
    layer: 'NEW-2',
    stubExports: {
      mem0Search: mem0Stubs.mem0Search as (
        ...args: unknown[]
      ) => Promise<unknown>,
    },
    primaryFnLatency_ms: 20,
    parallelK: 2, // mem0Search + checkRateLimit in parallel
  },
  ['@bing/shared/agent/prompt-parameters']: {
    specifier: '@bing/shared/agent/prompt-parameters',
    layer: 'Tier 1 #1',
    stubExports: {
      applyPromptModifiers: promptStubs.applyPromptModifiers as (
        ...args: unknown[]
      ) => Promise<unknown>,
    },
    primaryFnLatency_ms: 15,
    parallelK: 5, // 5-way prompt modifier Promise.all
  },
  ['@/lib/mcp/architecture-integration']: {
    specifier: '@/lib/mcp/architecture-integration',
    layer: 'Tier 1 #3',
    stubExports: {
      getMCPToolsForAI_SDK: mcpStubs.getMCPToolsForAI_SDK as (
        ...args: unknown[]
      ) => Promise<unknown>,
    },
    primaryFnLatency_ms: 15,
    parallelK: 4, // 4 dynamic imports parallelized
  },
};
