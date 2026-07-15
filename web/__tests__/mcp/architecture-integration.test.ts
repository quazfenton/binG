/**
 * Architecture-Integration MCP Tool Assembly — assignment-before-read invariant
 *
 * Regression lock for the audit 2026-07-03 Phase-1 conditional-guarded fold-in
 * (`web/lib/mcp/architecture-integration.ts:getMCPToolsForAI_SDK`):
 *
 *   const [providerToolDefs, vfsToolDefs, bashToolBundle, mem0Importer] =
 *     await Promise.all([
 *       import('./provider-advanced-tools'),
 *       import('./vfs-mcp-tools'),
 *       import('../bash/bash-tool'),
 *       import('../powers/mem0-power'),
 *       // 5th slot — REGRESSION-LOCKED below:
 *       mcporterIntegration.isEnabled()
 *         ? refreshMCPorterToolsCache()       // populates cachedMCPorterTools
 *         : Promise.resolve(undefined),       // no-op branch
 *     ]);
 *
 *   // ... later, downstream consumer reads `cachedMCPorterTools`:
 *   const tools = [...nativeTools, ...cachedMCPorterTools, ...blaxelTools, ...];
 *
 * The invariant: by the time the consumer-spread runs, the refresh either
 * has populated the cache (enabled path) or the Promise.resolve() branch
 * skipped it (disabled path → cachedMCPorterTools remains its prior state,
 * which is `[]` on a cold start).
 *
 * If a future refactor reverts the fold-in (re-orders the conditional slot
 * to run AFTER the consumer-spread), the consumer would read the
 * module-level initial `[]` (or whatever stale value a prior call left),
 * and the live mcporter tools would be missing from the assembled list.
 * These tests would fail because the sentinel mcporter tool would not
 * appear in the output.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Test-isolation design (CRITICAL):
 *
 * Two pieces of cross-test bleed must be neutralized:
 *
 * (a) `cachedMCPorterTools` is module-level state in architecture-integration.ts
 *     initialized to `[]` at module-load and mutated by refreshMCPorterToolsCache().
 *     Some paths (e.g. the Phase-1 PA `isEnabled() ? refresh... : Promise.resolve`
 *     slot) skip `refreshMCPorterToolsCache()` entirely when `isEnabled() === false`,
 *     so the disabled branch's `cachedMCPorterTools = []` wipe (inside refresh)
 *     does NOT fire — a populated cache from a prior test would leak through.
 *     → use `vi.resetModules()` so each test's `await import(...)` evaluates
 *     architecture-integration.ts afresh and re-runs `let cachedMCPorterTools = []`.
 *
 * (b) `vi.fn()` instances inside hoisted `vi.mock(..., factory)` calls are
 *     evaluated ONCE per test file (factories do not re-run on
 *     `vi.resetModules()` — vitest serves the same mocked object on every
 *     re-import). Without isolation, a `getMCPorterToolDefinitions` call
 *     recorded in Test 1 ENABLED would leak into Test 2 DISABLED's
 *     `not.toHaveBeenCalled()` assertion — the very failure this file
 *     worked around.
 *     → use `vi.clearAllMocks()` to wipe `vi.fn()` call histories between
 *     tests while preserving the `.mockReturnValue(...)` setups that each
 *     test re-applies anyway.
 *
 * Both are wired in `beforeEach` below.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Module mocks (hoisted ABOVE static imports by vitest) ─────────────────
//
// Mocks for ALL side-effect-prone modules touched by architecture-integration
// (static + dynamic imports). The hoisted vi.mock call auto-applies to
// every dynamic import below — both at file load and after vi.resetModules.
// Each test re-imports the mocked modules with `await import(...)` after
// resetModules, so the factories re-run and yield fresh vi.fn() instances.

vi.mock('@/lib/utils/logger', () => ({
  // architecture-integration.ts calls `createLogger('MCP:Integration')` at
  // module-load. Without a mock, pino (or another logger impl) initializes
  // a worker/transport that may not be hermetic under vitest.
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));
vi.mock('@/lib/mcp/health-check', () => ({
  startHealthMonitoring: vi.fn(),
}));
vi.mock('@/lib/mcp/mcporter-integration', () => ({
  mcporterIntegration: {
    isEnabled: vi.fn(),
  },
  getMCPorterToolDefinitions: vi.fn(),
  callMCPorterTool: vi.fn(),
}));
vi.mock('@/lib/mcp/registry', () => ({
  mcpToolRegistry: {
    getToolDefinitions: vi.fn(() => []),
    registerServer: vi.fn(),
    connectAll: vi.fn(),
    callTool: vi.fn(),
    getAllTools: vi.fn(() => []),
    getAllServerStatuses: vi.fn(() => []),
  },
}));
vi.mock('@/lib/mcp/config', () => ({
  isMCPAvailable: vi.fn(() => false),
  initializeMCP: vi.fn(async () => undefined),
  shutdownMCP: vi.fn(async () => undefined),
  getMCPSettings: vi.fn(() => ({})),
  parseMCPServerConfigs: vi.fn(() => []),
  getMCPToolCount: vi.fn(() => 0),
}));
vi.mock('@/lib/mcp/provider-advanced-tools', () => ({
  getAllProviderAdvancedTools: vi.fn(() => []),
  callProviderTool: vi.fn(),
}));
vi.mock('@/lib/mcp/vfs-mcp-tools', () => ({
  getVFSToolDefinitions: vi.fn(() => []),
  canonicalizeMcpToolName: vi.fn((s: string) => s),
  vfsTools: {},
  runWithToolContext: vi.fn(),
  getVFSTool: vi.fn(),
}));
vi.mock('@/lib/bash/bash-tool', () => ({
  registerVFSSyncHook: vi.fn(),
  createBashTool: vi.fn(() => ({})),
}));
vi.mock('@/lib/powers/mem0-power', () => ({
  isMem0Configured: vi.fn(() => false),
  buildMem0Tools: vi.fn(async () => ({})),
}));
vi.mock('@/lib/mcp/nullclaw-mcp-bridge', () => ({
  nullclawMCPBridge: {
    getToolDefinitions: vi.fn(() => []),
    executeTool: vi.fn(),
  },
}));
vi.mock('@/lib/integrations/arcade-service', () => ({
  ArcadeService: vi.fn(),
  getArcadeService: vi.fn(),
}));
vi.mock('@/lib/mcp/http-transport', () => ({
  createHTTPTransport: vi.fn(),
  isValidMCPURL: vi.fn(() => false),
  parseMCPURL: vi.fn(),
  HTTPTransport: vi.fn(),
  registerHTTPTransport: vi.fn(),
  getRemoteMCPTools: vi.fn(async () => []),
  callRemoteMCPTool: vi.fn(),
  hasRemoteMCPServers: vi.fn(() => false),
  getHTTPTransportNames: vi.fn(() => []),
}));

// ─── Helpers (pure functions; no module-level state) ──────────────────────

type MCPSchema = {
  type: 'function';
  function: { name: string; description?: string; parameters: any };
};

function mcporterTool(name: string): MCPSchema {
  return {
    type: 'function',
    function: { name, parameters: { type: 'object', properties: {} } },
  };
}

function isMcporterToolName(name: string | undefined): boolean {
  // architecture-integration's mcporter codepath emits `qualifiedName` as
  // `${server}:${tool}` (see mcporter-integration.ts:getMCPorterToolDefinitions),
  // so any ":" in the name also signals mcporter-origin. We also include the
  // `mcporter_` naming used by the test's own sentinel fixtures.
  return !!name && (name.includes(':') || name.startsWith('mcporter'));
}

// ─── The invariant test ───────────────────────────────────────────────────

describe('getMCPToolsForAI_SDK — cachedMCPorterTools assignment-before-read invariant', () => {
  beforeEach(() => {
    // (a) Wipe module evaluation cache so the next `await import(...)`
    // re-runs the module body — including `let cachedMCPorterTools = []`.
    vi.resetModules();
    // (b) Wipe call/return histories from prior tests on all vi.fn()
    // instances served by hoisted vi.mock factories (factories do NOT
    // re-run on re-import — vitest serves the same mocked object each
    // time). Preserves the mock-fn identity each test will reference
    // via `vi.mocked(mcporterMod.foo)`.
    vi.clearAllMocks();
  });

  /**
   * ENABLED PATH — proves the consumer-spread reads `cachedMCPorterTools`
   * AFTER `refreshMCPorterToolsCache()` was awaited in the Phase-1 PA.
   *
   * If a refactor reverts the fold-in (slot runs sequentially AFTER the
   * `[...nativeTools, ...cachedMCPorterTools, ...]` spread), the consumer
   * would read the module-level initial `cachedMCPorterTools = []`. The
   * sentinel-A would NOT appear in the returned tools list — this test
   * fails. Regression locked.
   */
  it('ENABLED: includes refreshed mcporter sentinel in assembled list — Phase-1 conditional slot fires BEFORE consumer reads cachedMCPorterTools', async () => {
    const sentinel = mcporterTool('mcporter_test_sentinel_A');

    // Dynamic imports AFTER resetModules get fresh module instances. The
    // hoisted vi.mock factories re-run, producing fresh vi.fn() instances
    // with no prior call history. This is what makes the per-test
    // mockReturnValue / mockResolvedValue scoping work cleanly.
    const mcporterMod = await import('@/lib/mcp/mcporter-integration');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    vi.mocked(mcporterMod.mcporterIntegration.isEnabled).mockReturnValue(true);
    vi.mocked(mcporterMod.getMCPorterToolDefinitions).mockResolvedValue([sentinel]);

    const tools = await getMCPToolsForAI_SDK('test-user', undefined);

    // Core invariant: sentinel-A must be present in the assembled list.
    expect(tools).toContainEqual(sentinel);

    // Mechanism check: the conditional-guarded slot actually fired the
    // refresh. Without this, a refactor that silently dropped the slot
    // could pass the previous assertion if the mocked refetch happens to
    // be a no-op.
    expect(mcporterMod.getMCPorterToolDefinitions).toHaveBeenCalledTimes(1);
  });

  /**
   * DISABLED PATH — proves the `Promise.resolve(undefined)` no-op branch
   * skips `refreshMCPorterToolsCache()` entirely.
   *
   * In the disabled case, the PA slot resolves to `Promise.resolve(undefined)`
   * and `refreshMCPorterToolsCache()` is never invoked. Consequently, the
   * `cachedMCPorterTools = []` wipe inside `refreshMCPorterToolsCache`
   * (intended to clear any prior-call stale state) is dead code in the
   * current fold-in path — the consumer reads whatever the module-level
   * state was at module-load. With `vi.resetModules()` per test, that
   * state is guaranteed to be `[]`. Without isolation, a sentinel from a
   * prior ENABLED test would leak — which is what the test isolation
   * design (see file-level comment) explicitly defends against.
   *
   * If a future refactor drops the `? : Promise.resolve(undefined)`
   * ternary and unconditionally calls refresh, the mocked refetch would
   * fire (the toHaveBeenCalled assertion fails) — regression locked.
   */
  it('DISABLED: omits mcporter tools AND skips refreshMCPorterToolsCache call — Promise.resolve() no-op branch held', async () => {
    const sentinelDisabled = mcporterTool('mcporter_test_sentinel_B_disabled');

    const mcporterMod = await import('@/lib/mcp/mcporter-integration');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    vi.mocked(mcporterMod.mcporterIntegration.isEnabled).mockReturnValue(false);
    // Even though disabled → refresh never called → sentinelDisabled
    // never surfaces, we still configure the mock so that IF a regression
    // causes the unconditional-refetch bug, the sentinel would appear in
    // the output and the next assertion would catch it loudly.
    vi.mocked(mcporterMod.getMCPorterToolDefinitions).mockResolvedValue([sentinelDisabled]);

    const tools = await getMCPToolsForAI_SDK('test-user', undefined);

    // Mechanism check: refresh was NOT called — the conditional slot's
    // `Promise.resolve(undefined)` branch was taken.
    expect(mcporterMod.getMCPorterToolDefinitions).not.toHaveBeenCalled();

    // Behavioral check: no mcporter-origin tools appear in the assembled
    // list. We filter by mcporter-naming convention (":" separator or
    // "mcporter_" prefix) — robust against additional tool sources that
    // a future refactor might add.
    const mcporterOriginTools = tools.filter((t) => isMcporterToolName(t?.function?.name));
    expect(mcporterOriginTools).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 partial-success-safe timeout isolation (P1 finding #5 from the prior
// review's remediation architecture).
//
// The legacy code wrapped all 4 Phase 2 dynamic fetches in one Promise.all
// then optional outer Promise.race against the route-level signal. When the
// route signal fired mid-Phase-2 (or a single source wedged beyond
// MCP_TOOLS_TIMEOUT_MS), the `.catch` returned [EMPTY, EMPTY, EMPTY, {}] for
// ALL 4 slots — erasing results from sources that already resolved.
//
// The fix wraps each of the 4 dynamic fetches in `fetchWithDeadline<T>(name,
// promise, fallback, timeoutMs, signal?)`. Each source races independently
// against (a) its own deadline and (b) the route-level signal; whichever
// wins, that slot returns either the resolved value (winner = promise) or
// the per-source `fallback` (winner = deadline or signal). The outer
// Promise.all reaps whatever resolved. A hung Arcade no longer wipes
// successfully-resolved Composio / Remote / Mem0 results.
//
// These tests are table-driven: each `it` varies one input dimension (which
// source hangs / throws / aborts) and asserts the per-slot outcome in the
// final tool list. The shutdown path does NOT need new mocks — the previous
// `vi.mock(...)` factories re-run on `vi.resetModules()`, so each test gets
// fresh vi.fn() instances and per-test .mockReturnValue scoping works as the
// existing invariant tests demonstrate.
// ─────────────────────────────────────────────────────────────────────────

// Module fixtures for the partial-success suite. The three Phase-2
// sources (Arcade / Remote MCP / Mem0) each apply a distinct
// name-mangling strategy in /opt/bing/web/lib/mcp/architecture-integration.ts:
//   - Arcade:    raw.name         → `arcade_${sanitizeToolName(raw.name)}`
//   - Remote MCP: forwards raw schema verbatim (no name mutation)
//   - Mem0:      map[key]         → `mem0_${key}`
//
// Each helper pair below produces the EXACT shape the mock must
// return from the SDK (`<src>Raw`), paired with the EXACT shape the
// production wrapper outputs (`<src>Expected`). Unique `description`
// markers (`__arcade_<assembledName>__`, etc.) carry the test's
// sentinel identity through both the input and output pipelines so
// multi-source tests cannot conflate sentinels.
//
// Usage:
//   // mock input — what the SDK should return
//   vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
//     getTools: vi.fn().mockResolvedValue([arcadeRaw('arcade_baseline_sens')]),
//   } as any);
//   // assertion target — what the assembled list should contain
//   expect(tools).toContainEqual(arcadeExpected('arcade_baseline_sens'));
function arcadeRaw(assembledName: string): any {
  // Strip the production-applied `arcade_` prefix so that the
  // production wrapper's `arcade_${sanitizeToolName(raw.name)}`
  // re-prepends it and lands on the FINAL assembled name passed in.
  // Production's Arcade wrapper reads `tool.inputSchema` to populate
  // `parameters` (NOT `tool.parameters`); only `inputSchema` needs to
  // be present in the mock-input shape.
  const rawName = assembledName.startsWith('arcade_')
    ? assembledName.slice('arcade_'.length)
    : assembledName;
  return {
    name: rawName,
    description: `__arcade_${assembledName}__`,
    inputSchema: { type: 'object', properties: {} },
  };
}
function arcadeExpected(assembledName: string): MCPSchema {
  return {
    type: 'function',
    function: {
      name: assembledName,
      description: `__arcade_${assembledName}__`,
      parameters: { type: 'object', properties: {} },
    },
  };
}
function remoteExpected(name: string): MCPSchema {
  return {
    type: 'function',
    function: {
      name,
      description: `__remote_${name}__`,
      parameters: { type: 'object', properties: {} },
    },
  };
}
function mem0Raw(assembledName: string): Record<string, any> {
  // `buildMem0Tools` returns `Record<string, toolDef>` keyed by tool
  // name. Production maps via
  //   Object.entries(map).map(([k, td]) => ({name: `mem0_${k}`, ...}))
  // so the assembled `name` is `mem0_<key>`. Strip the `mem0_` to
  // derive the raw map key the mock must return. Production's Mem0
  // wrapper reads `toolDef.parameters || toolDef.inputSchema || {}`
  // — `parameters` is read FIRST, so `inputSchema` is dead in the
  // fixture. Including only `parameters` keeps the fixture minimal
  // and explicit about which field production depends on.
  const key = assembledName.startsWith('mem0_')
    ? assembledName.slice('mem0_'.length)
    : assembledName;
  return {
    [key]: {
      description: `__mem0_${assembledName}__`,
      parameters: { type: 'object', properties: {} },
    },
  };
}
function mem0Expected(assembledName: string): MCPSchema {
  return {
    type: 'function',
    function: {
      name: assembledName,
      description: `__mem0_${assembledName}__`,
      parameters: { type: 'object', properties: {} },
    },
  };
}

describe('getMCPToolsForAI_SDK — Phase 2 partial-success-safe timeout isolation', () => {
  // Per-suite env var snapshot so beforeEach/afterEach can be paired and
  // not leak env mutations into other test files.
  let envSnapshot: Record<string, string | undefined> = {};
  const SUITE_ENV_KEYS = ['ARCADE_API_KEY', 'COMPOSIO_API_KEY', 'MCP_PHASE2_SOURCE_TIMEOUT_MS'];

  beforeEach(() => {
    envSnapshot = Object.fromEntries(SUITE_ENV_KEYS.map((k) => [k, process.env[k]]));
    // Set up the partial-success test surface: Arcade enabled to fire,
    // Remote+MCP+Mem0 mocked at the module-impl layer so their results
    // are deterministic, Composio disabled (Composio SDK requires a
    // heavier @composio/core mock for per-source partial-success testing
    // and is covered by the prior PR's wiring contract separately).
    process.env.ARCADE_API_KEY = 'test-arcade-key';
    delete process.env.COMPOSIO_API_KEY;
    process.env.MCP_PHASE2_SOURCE_TIMEOUT_MS = '100';
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const k of SUITE_ENV_KEYS) {
      const v = envSnapshot[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.useRealTimers();
  });

  // ── Test 1 — Baseline success: all sources fast-resolve ────────────────
  // Verifies the suite scaffolding: the per-source wrappers do NOT
  // regress the happy path. Each source's mock imperatively resolves;
  // the final aggregated tools list contains every source's sentinel.
  it('BASELINE: all 3 mocked sources (Arcade/Remote/Mem0) resolve fast — every source\'s tools appear in assembled list', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const httpMod = await import('@/lib/mcp/http-transport');
    const mem0Mod = await import('@/lib/powers/mem0-power');

    // Mock-input vs assembled-expected separation. arcadeRaw returns the
    // raw shape fed to `getArcadeService().getTools()`; the production
    // wrapper re-adds the `arcade_` prefix to land on the FINAL name.
    // arcadeExpected / remoteExpected / mem0Expected mirror the
    // post-assembly shape that the assembled list should contain.
    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      getTools: vi.fn().mockResolvedValue([arcadeRaw('arcade_baseline_sens')]),
    } as any);

    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockResolvedValue([
      remoteExpected('remote_baseline_sens'),
    ]);

    vi.mocked(mem0Mod.isMem0Configured).mockReturnValue(true);
    vi.mocked(mem0Mod.buildMem0Tools).mockResolvedValue(
      mem0Raw('mem0_baseline_sens_search'),
    );

    const tools = await getMCPToolsForAI_SDK('test-user', undefined);

    expect(tools).toContainEqual(arcadeExpected('arcade_baseline_sens'));
    expect(tools).toContainEqual(remoteExpected('remote_baseline_sens'));
    expect(tools).toContainEqual(mem0Expected('mem0_baseline_sens_search'));
  });

  // ── Test 2 — Isolated timeout: Arcade hangs, others fast ────────────────
  // The CORE partial-success contract. Arcade's source promise is a
  // never-resolving `new Promise(() => {})`; its source deadline (100ms
  // via env in beforeEach) fires, Arcade slot resolves to EMPTY; the
  // outer Promise.all reaps the Remote + Mem0 tools intact.
  //
  // Pre-fix behavior: Arcade's hung Promise contributed a STILL-PENDING
  // slot, the route-level signal or outer race would have wiped all 4
  // slots — Remote + Mem0 would NOT be present.
  // ── P1 finding #5: Phase 2 timeout is all-or-nothing (FIXED) ──
  it('ISOLATED TIMEOUT: Arcade hangs → Arcade slot is empty AND Remote + Mem0 tools preserved', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const httpMod = await import('@/lib/mcp/http-transport');
    const mem0Mod = await import('@/lib/powers/mem0-power');

    // Arcade hangs forever: getTools() returns a never-resolving promise.
    // We deliberately do NOT use vi.advanceTimersByTimeAsync here unless
    // the test needs to step the fake clock — vi.useFakeTimers() in
    // beforeEach is what makes the source-level setTimeout deadline
    // deterministic; the call below kicks off the wrapper synchronously
    // and Arcade's deadline is queued into the same fake clock.
    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      getTools: vi.fn(() => new Promise(() => {})),  // never resolves
    } as any);

    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockResolvedValue([
      remoteExpected('remote_partial_sens'),
    ]);

    vi.mocked(mem0Mod.isMem0Configured).mockReturnValue(true);
    vi.mocked(mem0Mod.buildMem0Tools).mockResolvedValue(
      mem0Raw('mem0_partial_sens_search'),
    );

    const promise = getMCPToolsForAI_SDK('test-user', undefined);
    // Advance fake clock past the 100ms PHASE2_SOURCE_TIMEOUT_MS — the
    // Arcade wrapper's setTimeout-rejected promise fires, race resolves
    // to EMPTY for that slot, outer PA reaps the survivors.
    await vi.advanceTimersByTimeAsync(150);
    const tools = await promise;

    // Arcade slot is empty (its sole source hung → wrapper caught timeout
    // and resolved to EMPTY).
    expect(
      tools.filter((t) => typeof t?.function?.name === 'string' && t.function.name.startsWith('arcade_')),
    ).toHaveLength(0);
    // Remote slot preserved.
    expect(tools).toContainEqual(remoteExpected('remote_partial_sens'));
    // Mem0 slot preserved.
    expect(tools).toContainEqual(mem0Expected('mem0_partial_sens_search'));
  });

  // ── Test 3 — Multiple hung sources: Arcade + Mem0 stuck, Remote fast ───
  // Two stalls in parallel: each hits its OWN deadline independently;
  // Remote still passes through.
  it('MULTIPLE HUNG: Arcade AND Mem0 hang → only Remote tools preserved', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const httpMod = await import('@/lib/mcp/http-transport');
    const mem0Mod = await import('@/lib/powers/mem0-power');

    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      getTools: vi.fn(() => new Promise(() => {})),
    } as any);
    vi.mocked(mem0Mod.isMem0Configured).mockReturnValue(true);
    vi.mocked(mem0Mod.buildMem0Tools).mockReturnValue(new Promise(() => {}) as any);

    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockResolvedValue([
      remoteExpected('remote_only_sens'),
    ]);

    const promise = getMCPToolsForAI_SDK('test-user', undefined);
    await vi.advanceTimersByTimeAsync(150);
    const tools = await promise;

    expect(tools.filter((t) => typeof t?.function?.name === 'string' && t.function.name.startsWith('arcade_'))).toHaveLength(0);
    expect(tools.filter((t) => typeof t?.function?.name === 'string' && t.function.name.startsWith('mem0_'))).toHaveLength(0);
    expect(tools).toContainEqual(remoteExpected('remote_only_sens'));
  });

  // ── Test 4 — Signal short-circuit mid-flight: already-resolved sources
  //         survive a client-disconnect abort; only the still-pending
  //         source is zeroed.
  // ── P1 finding #5 (continued): the route-level signal must also be
  //    partial-success-safe — it should NOT wipe resolved siblings.
  it('SIGNAL SHORT-CIRCUIT: controller.abort() mid-Phase-2 → resolved sources preserved, only still-pending slot zeroed', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const httpMod = await import('@/lib/mcp/http-transport');
    const mem0Mod = await import('@/lib/powers/mem0-power');

    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockResolvedValue([
      remoteExpected('remote_signal_sens'),
    ]);

    vi.mocked(mem0Mod.isMem0Configured).mockReturnValue(true);
    vi.mocked(mem0Mod.buildMem0Tools).mockResolvedValue(
      mem0Raw('mem0_signal_sens_search'),
    );

    // Controlled Arcade promise: resolved only when `releaseArcade` is
    // called. We trigger `releaseArcade` AFTER firing the abort to make
    // sure the abort fires first (mid-flight stall model).
    // Build the controlled Promise UPFRONT in the test's setup phase —
    // its executor runs synchronously, so `releaseArcade` is assigned
    // BEFORE `getMCPToolsForAI_SDK(...)` is even called. The Arcade mock
    // returns the same Promise on each call, so production's wrapper
    // observes our controllable pending Promise. This avoids the
    // microtask-ordering trap where `arcade.getTools()` is only called
    // after `await Promise.all([dynamic imports])` resolves inside
    // production — by the time the test reaches `releaseArcade([...])`,
    // the chain may not have advanced far enough to invoke Arcade yet.
    let releaseArcade!: (v: any) => void;
    const arcadePromise = new Promise<MCPSchema[]>((resolve) => { releaseArcade = resolve; });
    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      getTools: vi.fn(() => arcadePromise),
    } as any);

    const controller = new AbortController();
    const promise = getMCPToolsForAI_SDK('test-user', undefined, controller.signal);

    // Mid-flight abort.
    controller.abort();
    // Allow any synchronous microtask work to settle.
    await Promise.resolve();
    await Promise.resolve();
    // Now release Arcade — too late, abort was already propagated to
    // the Arcade wrapper and resolved its slot to EMPTY.
    releaseArcade([arcadeRaw('arcade_should_not_show')]);

    const tools = await promise;

    // Arcade slot is empty (race winner = abort → EMPTY).
    expect(
      tools.filter((t) => typeof t?.function?.name === 'string' && t.function.name.startsWith('arcade_')),
    ).toHaveLength(0);
    // Resolved siblings still present (Remote and Mem0 resolved BEFORE the abort).
    expect(tools).toContainEqual(remoteExpected('remote_signal_sens'));
    expect(tools).toContainEqual(mem0Expected('mem0_signal_sens_search'));
  });

  // ── Test 5 — Graceful per-source rejection isolation ────────────────────
  // A source throws synchronously (rare but possible — internal SDK
  // error path). The wrapper's catch returns fallback; siblings unaffected.
  it('GRACEFUL REJECTION: getRemoteMCPTools rejects → Remote slot is empty, Arcade + Mem0 tools preserved', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const httpMod = await import('@/lib/mcp/http-transport');
    const mem0Mod = await import('@/lib/powers/mem0-power');

    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      getTools: vi.fn().mockResolvedValue([arcadeRaw('arcade_reject_isolation_sens')]),
    } as any);

    // Remote throws — used to bubble up to the outer Promise.race in the
    // pre-fix code. Under the new wrappers, Remote's slot resolves to
    // EMPTY while Arcade + Mem0 carry on.
    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockRejectedValue(new Error('Remote MCP transport broke'));

    vi.mocked(mem0Mod.isMem0Configured).mockReturnValue(true);
    vi.mocked(mem0Mod.buildMem0Tools).mockResolvedValue(
      mem0Raw('mem0_reject_isolation_sens_search'),
    );

    const tools = await getMCPToolsForAI_SDK('test-user', undefined);

    // Remote slot empty.
    expect(
      tools.filter((t) => typeof t?.function?.name === 'string' && t.function.name.startsWith('remote_')),
    ).toHaveLength(0);
    // Arcade + Mem0 preserved despite Remote's rejection.
    expect(tools).toContainEqual(arcadeExpected('arcade_reject_isolation_sens'));
    expect(tools).toContainEqual(mem0Expected('mem0_reject_isolation_sens_search'));
  });

  // ── Test 6 — All sources dead on arrival: every slot is empty ──────────
  // Without partial-success-safe wrappers, this case still produces
  // `tools = []` (so the route's VFS fallback kicks in). Under the new
  // wrappers, EACH slot independently times out (no shared wipe).
  it('ALL HUNG: every source hangs → all slots empty, VFS fallback would apply at the route layer', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const httpMod = await import('@/lib/mcp/http-transport');
    const mem0Mod = await import('@/lib/powers/mem0-power');

    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      getTools: vi.fn(() => new Promise(() => {})),
    } as any);
    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockReturnValue(new Promise(() => {}));
    vi.mocked(mem0Mod.isMem0Configured).mockReturnValue(true);
    vi.mocked(mem0Mod.buildMem0Tools).mockReturnValue(new Promise(() => {}) as any);

    const promise = getMCPToolsForAI_SDK('test-user', undefined);
    await vi.advanceTimersByTimeAsync(150);
    const tools = await promise;

    expect(
      tools.filter((t) =>
        typeof t?.function?.name === 'string' &&
        (t.function.name.startsWith('arcade_') ||
          t.function.name.startsWith('remote_') ||
          t.function.name.startsWith('mem0_')),
      ),
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Audit step #5: normalize/dedup/cap pipeline tests
// (audit remediation step #5: "Normalize, deduplicate, score, and cap
// after availability filtering").
//
// Pipeline contract enforced here:
//   1. Source precedence (SOURCE_PRECEDENCE_ORDER) picks first-arrival
//      winners on `tool.function.name` collision. The loser's origin is
//      recorded in `rejectedByName`.
//   2. Hard cap (env MCP_TOOLS_MAX_TOTAL, default 25) drops lowest-
//      precedence non-exempt entries. Workflow companions (write_file,
//      bash_execute, web_search, etc.) are exempt — the unified-agent
//      execution loop is never stranded.
//   3. Structured `logger.info` ([MCP-Tools] Assembled …) surfaces
//      candidateCount, selectedCount, rejectedByNameCount, rejectedByBudgetCount.
// ─────────────────────────────────────────────────────────────────────────

describe('getMCPToolsForAI_SDK — normalize/dedup/cap pipeline (audit step #5)', () => {
  let envSnapshot: Record<string, string | undefined> = {};
  const SUITE_ENV_KEYS = ['MCP_TOOLS_MAX_TOTAL', 'ARCADE_API_KEY', 'COMPOSIO_API_KEY', 'SEARXNG_URL'];

  beforeEach(() => {
    envSnapshot = Object.fromEntries(SUITE_ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.ARCADE_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.SEARXNG_URL;
    vi.resetModules();
    // vi.resetAllMocks (NOT clearAllMocks) restores each vi.fn()'s
    // implementation to its factory default AND resets mockReturnValue.
    // Without this, prior tests' mocked return values (e.g.
    // createBashTool's `{bash_execute: ...}` from Test EXEMPT) leak into
    // subsequent tests, breaking the EMPTY suite's "no tools emitted"
    // contract. The existing invariant tests use `clearAllMocks` +
    // explicit per-test mockReturnValue which works because each test
    // sets up every relevant mock; this suite mirrors that style.
    vi.resetAllMocks();
  });

  afterEach(() => {
    for (const k of SUITE_ENV_KEYS) {
      const v = envSnapshot[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // ── Test 1 — Dedup precedence: native wins over remote on name collision ─
  it('DEDUP: native wins over remote on `read_file` collision — first-arrival precedence', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const configMod = await import('@/lib/mcp/config');
    const registryMod = await import('@/lib/mcp/registry');
    const httpMod = await import('@/lib/mcp/http-transport');

    // Native MCP registry emits read_file with high-priority metadata.
    vi.mocked(configMod.isMCPAvailable).mockReturnValue(true);
    vi.mocked(registryMod.mcpToolRegistry.getToolDefinitions).mockReturnValue([
      { type: 'function', function: { name: 'read_file', parameters: {} } } as MCPSchema,
    ]);

    // Remote MCP also emits read_file — should lose to native (native
    // precedes remote in SOURCE_PRECEDENCE_ORDER).
    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockResolvedValue([
      { type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: {} } } } as MCPSchema,
    ]);

    const tools = await getMCPToolsForAI_SDK('test-user', undefined);

    // Exactly one read_file in kept list (dedup'd).
    const readFiles = tools.filter((t) => t?.function?.name === 'read_file');
    expect(readFiles).toHaveLength(1);
  });

  // ── Test 2 — Workflow companions exempt from cap ────────────────────────
  it('EXEMPT: workflow companions (write_file/apply_diff/batch_write/read_file/bash_execute) survive even when budget = 5 and tools exceed', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const configMod = await import('@/lib/mcp/config');
    const registryMod = await import('@/lib/mcp/registry');
    const bashMod = await import('@/lib/bash/bash-tool');

    process.env.MCP_TOOLS_MAX_TOTAL = '5';

    // Native emits 4 workflow-companion tools (write/apply/batch/read).
    vi.mocked(configMod.isMCPAvailable).mockReturnValue(true);
    vi.mocked(registryMod.mcpToolRegistry.getToolDefinitions).mockReturnValue([
      { type: 'function', function: { name: 'write_file', parameters: {} } } as MCPSchema,
      { type: 'function', function: { name: 'apply_diff', parameters: {} } } as MCPSchema,
      { type: 'function', function: { name: 'batch_write', parameters: {} } } as MCPSchema,
      { type: 'function', function: { name: 'read_file', parameters: {} } } as MCPSchema,
    ]);

    // Bash emits 1 workflow-companion (bash_execute).
    vi.mocked(bashMod.createBashTool).mockReturnValue({
      bash_execute: { description: 'bash', parameters: {} },
    } as any);

    const tools = await getMCPToolsForAI_SDK('test-user', undefined);

    // All 5 workflow-companion names retained (exempt from cap).
    const names = tools.map((t) => t?.function?.name).sort();
    expect(names).toEqual(
      ['apply_diff', 'bash_execute', 'batch_write', 'read_file', 'write_file'].sort(),
    );
  });

  // ── Test 3 — Cap drops lowest-precedence non-exempt tools ───────────────
  it('CAP: maxBudget=3 with 3 exempt + 4 budgeted → 3 exempt + 0 budgeted (cap clamps non-exempt to 0)', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const configMod = await import('@/lib/mcp/config');
    const registryMod = await import('@/lib/mcp/registry');
    const httpMod = await import('@/lib/mcp/http-transport');

    process.env.MCP_TOOLS_MAX_TOTAL = '3';

    // Native emits 1 workflow-companion + 3 native-only high-precedence tools.
    vi.mocked(configMod.isMCPAvailable).mockReturnValue(true);
    vi.mocked(registryMod.mcpToolRegistry.getToolDefinitions).mockReturnValue([
      { type: 'function', function: { name: 'write_file', parameters: {} } } as MCPSchema,         // workflow-companion
      { type: 'function', function: { name: 'native_only_alpha', parameters: {} } } as MCPSchema,
      { type: 'function', function: { name: 'native_only_beta', parameters: {} } } as MCPSchema,
    ]);

    // Remote emits 2 lower-precedence tools that should be CAP-cut when
    // the budget runs out.
    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockResolvedValue([
      { type: 'function', function: { name: 'remote_low_priority', parameters: {} } } as MCPSchema,
    ]);

    const tools = await getMCPToolsForAI_SDK('test-user', undefined);

    // With maxBudget=3 and 1 exempt + 3 budgeted available:
    //   budgetForNonExempt = max(3 - 1, 0) = 2
    //   kept = 1 exempt + 2 budgeted (native_only_alpha, native_only_beta)
    //   dropped = remote_low_priority (4th budgeted hits the cap)
    const names = tools.map((t) => t?.function?.name).sort();
    expect(names).toEqual(['native_only_alpha', 'native_only_beta', 'write_file'].sort());
    expect(tools).toHaveLength(3);
  });

  // ── Test 4 — Empty bundles → tools = [] (precedence dedup never sees inputs)
  it('EMPTY: all sources return [] → getMCPToolsForAI_SDK returns []', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const tools = await getMCPToolsForAI_SDK('test-user', undefined);
    expect(tools).toEqual([]);
  });

  // ── Test 5 — Telemetry surfaces structured normalization fields ──────────
  it('TELEMETRY: logger.info receives [MCP-Tools] Assembled line with candidateCount, selectedCount, rejectedByNameCount, rejectedByBudgetCount fields', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const logMod = await import('@/lib/utils/logger');
    const configMod = await import('@/lib/mcp/config');
    const registryMod = await import('@/lib/mcp/registry');

    process.env.MCP_TOOLS_MAX_TOTAL = '2';

    // Native emits 3 high-precedence tools. With maxBudget=2 and no
    // workflow-companions in this fixture, only 2 are kept; 1 dropped
    // by budget. selectedCount=2 candidateCount=3 rejectedByBudgetCount=1.
    vi.mocked(configMod.isMCPAvailable).mockReturnValue(true);
    vi.mocked(registryMod.mcpToolRegistry.getToolDefinitions).mockReturnValue([
      { type: 'function', function: { name: 'native_alpha', parameters: {} } } as MCPSchema,
      { type: 'function', function: { name: 'native_beta', parameters: {} } } as MCPSchema,
      { type: 'function', function: { name: 'native_gamma', parameters: {} } } as MCPSchema,
    ]);

    await getMCPToolsForAI_SDK('test-user', undefined);

    // Robust logger capture: vi.resetAllMocks() resets mock.calls AND
    // mock.results, so `mock.results[0]` may not be the architecture-
    // integration's MCP:Integration createLogger call if any other
    // module loaded first (e.g., a non-mocked dynamic-import like
    // blaxel-provider also calls createLogger during Phase-1 module
    // cache warming — its tag would be e.g. 'Blaxel' or 'Provider').
    // Match by argument label ('MCP:Integration') instead of index.
    const createLoggerCalls = vi.mocked(logMod.createLogger).mock.calls;
    const createLoggerResults = vi.mocked(logMod.createLogger).mock.results;
    const archIndex = createLoggerCalls.findIndex(
      (call: unknown[]) => call[0] === 'MCP:Integration',
    );
    expect(archIndex).toBeGreaterThanOrEqual(0);
    const loggerInstance = createLoggerResults[archIndex]?.value as {
      info: { mock: { calls: unknown[][] } };
    };
    expect(loggerInstance).toBeDefined();
    const infoCalls = loggerInstance.info.mock.calls;
    const normalizationCall = infoCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('[MCP-Tools] Assembled'),
    );
    expect(normalizationCall).toBeDefined();
    const fields = normalizationCall![1] as Record<string, any>;
    expect(fields.selectedCount).toBe(2);
    expect(fields.candidateCount).toBe(3);
    expect(fields.rejectedByBudgetCount).toBe(1);
    expect(fields.rejectedByNameCount).toBe(0);
    expect(fields.selectedNamesSample).toBeDefined();
  });
});
