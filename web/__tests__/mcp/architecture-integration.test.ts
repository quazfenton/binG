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
