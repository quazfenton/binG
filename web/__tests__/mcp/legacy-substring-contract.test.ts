/**
 * TaskFilterView branch contract and requireFullCatalog sentinel tests.
 *
 * The function `computeTaskFilterView` in architecture-integration.ts
 * converts a `SelectToolPlanResult | undefined` into a `TaskFilterView`
 * discriminant used by the 5 per-source filter helpers.
 *
 * This test file locks down:
 *
 *   - E2E assembly test (Test 8): drives `getMCPToolsForAI_SDK` with
 *     `undefined` taskFilter → `view.kind === 'none'` → all source tools
 *     flow through unfiltered (no SDK env keys set, mock defaults).
 *
 *   - requireFullCatalog sentinel contract (Tests 9-12): the sentinel
 *     forces `view.kind === 'none'` regardless of `taskFilter`, giving
 *     tools-only helpers the FULL MCP catalog for fuzzy name matching.
 *
 *   - Per-source `kind: 'none'` contract: each filter helper returns
 *     `[...all]` verbatim (Nullclaw strips its status sentinel).
 *
 *   - isStructuredMcpError type-guard contract and
 *     unwrapStructuredToolError format-lock contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeTaskFilterView,
  filterArcadeToolsByView,
  filterComposioToolsByView,
  filterBlaxelToolsByView,
  filterNullclawToolsByView,
  filterProviderToolsByView,
  isStructuredMcpError,
  type TaskFilterView,
} from '@/lib/mcp/architecture-integration';
import { unwrapStructuredToolError } from '@/lib/mcp/orchestrator-error-unwrap';
import type { SelectToolPlanResult } from '@/lib/tools/select-tool-plan';

// ── Module mocks (hoisted) — needed for E2E Test 8 ────────────────────────
//
// Each vi.mock factory returns deterministic, small data sets so the
// E2E-floor assertions can pin specific tool names. The mocking surface
// stays narrow so per-source filter behavior remains visible.

vi.mock('@/lib/utils/logger', () => ({
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
  mcporterIntegration: { isEnabled: vi.fn(() => false) },
  getMCPorterToolDefinitions: vi.fn(async () => []),
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
  getMCPSettings: vi.fn(() => ({}) ),
  parseMCPServerConfigs: vi.fn(() => []),
  getMCPToolCount: vi.fn(() => 0),
}));
vi.mock('@/lib/mcp/provider-advanced-tools', () => ({
  // 4 explicit-name tools covering all 4 provider name prefix gates
  // (daytona_ / e2b_ / codesandbox_ / sprites_). Tests 1/2 verify NONE
  // reach the final list (no trigger words in greeting/code-edit), Test
  // 8 verifies ALL 4 reach the final list ('none' view bypasses filter).
  getAllProviderAdvancedTools: vi.fn(() => [
    vfsSchemaFactory('daytona_computer_use_zoom'),
    vfsSchemaFactory('e2b_run_python'),
    vfsSchemaFactory('codesandbox_create_sandbox'),
    vfsSchemaFactory('sprites_create_checkpoint'),
  ]),
  callProviderTool: vi.fn(),
}));
vi.mock('@/lib/mcp/vfs-mcp-tools', () => ({
  getVFSToolDefinitions: vi.fn(() => [
    vfsSchemaFactory('read_file'),
    vfsSchemaFactory('write_file'),
    vfsSchemaFactory('apply_diff'),
    vfsSchemaFactory('delete_file'),
    vfsSchemaFactory('move_file'),
    vfsSchemaFactory('list_files'),
    vfsSchemaFactory('search_files'),
    vfsSchemaFactory('batch_write'),
  ]),
  canonicalizeMcpToolName: vi.fn((s: string) => s),
  vfsTools: {},
  runWithToolContext: vi.fn(),
  getVFSTool: vi.fn(),
}));
vi.mock('@/lib/bash/bash-tool', () => ({
  registerVFSSyncHook: vi.fn(),
  createBashTool: vi.fn(() => ({
    bash_execute: {
      description: 'Execute a shell command',
      parameters: { type: 'object', properties: {} },
    },
  })),
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
  // Default null → getArcadeService returns null → getArcadeToolDefinitions
  // bails early → all Arcadetools = []. E2E Tests 1, 2, 8 (env unset) never
  // hit Arcade; Tests 3/6/7 invoke `filterArcadeToolsByView` directly.
  getArcadeService: vi.fn(() => null),
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
vi.mock('@composio/core', () => ({
  Composio: vi.fn(),
}));

// ── Scaffolding helpers ─────────────────────────────────────────────────────

type MCPSchema = {
  type: 'function';
  function: { name: string; description?: string; parameters: any };
};

function vfsSchemaFactory(name: string): MCPSchema {
  return {
    type: 'function',
    function: { name, parameters: { type: 'object', properties: {} } },
  };
}

function names(tools: MCPSchema[]): string[] {
  return tools.map((t) => t.function.name).sort();
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('view.branch and requireFullCatalog sentinel contract', () => {
  let envSnapshot: Record<string, string | undefined> = {};
  const SUITE_ENV_KEYS = [
    'ARCADE_API_KEY',
    'COMPOSIO_API_KEY',
    'BLAXEL_API_KEY',
    'NULLCLAW_ENABLED',
    'MCP_TOOLS_MAX_TOTAL',
    'MCP_PHASE2_SOURCE_TIMEOUT_MS',
  ];

  beforeEach(() => {
    envSnapshot = Object.fromEntries(SUITE_ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.ARCADE_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.BLAXEL_API_KEY;
    delete process.env.NULLCLAW_ENABLED;
    delete process.env.MCP_TOOLS_MAX_TOTAL;
    delete process.env.MCP_PHASE2_SOURCE_TIMEOUT_MS;
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const k of SUITE_ENV_KEYS) {
      const v = envSnapshot[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // ── Test 8 — Empty/undefined taskFilter: view.kind === 'none' ───────────
  // When taskFilter is undefined (the "first request before any user
  // message" path referenced in vercel-ai-tools.ts comments), view.kind
  // === 'none'. Per-source filters are BYPASSED — mocked provider tools
  // flow through unfiltered. Final count = 9 workflow companions (VFS=8 +
  // bash=1, all cap-exempt) + 4 mocked provider tools (daytona_/e2b_/
  // codesandbox_/sprites_). Total = 13.
  it('empty / undefined taskFilter: view.kind === "none" → 9 workflow companions + 4 mocked providers = 13', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const tools = (await getMCPToolsForAI_SDK(
      'user-1234567890',
      undefined,
      AbortSignal.timeout(parseInt(process.env.CHAT_MCP_TOOLS_TIMEOUT_MS || '1000', 10)),
    )) as MCPSchema[];
    const toolNames = names(tools);
    // Tightened from `>= 9` (loose) to `=== 13` (exact). Pre-fix the loose
    // assertion passed even when the floor regressed to 9 alone OR
    // ballooned to 50+; the exact count locks the 'none' branch floor.
    expect(toolNames.length).toBe(13);
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('bash_execute');
    // 'none' branch: NO per-source filter applied → mocked providers flow through.
    expect(toolNames).toContain('daytona_computer_use_zoom');
    expect(toolNames).toContain('e2b_run_python');
    expect(toolNames).toContain('codesandbox_create_sandbox');
    expect(toolNames).toContain('sprites_create_checkpoint');
    // No SDK tools: ARCADE/COMPOSIO env keys unset in beforeEach — mock
    // factories' default null instance bails Arcade/Composio to empty.
    expect(toolNames.filter((n) => n.startsWith('arcade_'))).toEqual([]);
    expect(toolNames.filter((n) => n.startsWith('slack_'))).toEqual([]);
  });

  // ════════════════════════════════════════════════════════════════════════
  // requireFullCatalog sentinel contract (MCP-CAPBYPASS ticket, 2026-07-16)
  //
  // The sentinel forces `view.kind === 'none'` regardless of `taskFilter`
  // so the 5 per-source filter helpers return `[...all]` — i.e. the
  // UNFILTERED upstream tool catalog. This in turn allows
  // `getMCPToolsForAI_SDK` to thread `maxBudget: Number.POSITIVE_INFINITY`
  // through `normalizeAndCapTools` (L1666-L1668a), giving tools-only
  // helpers (`resolveMCPToolName`, `extractToolCallsFromLLMResponse`) the
  // FULL MCP catalog for fuzzy name matching and JSON-Schema lookup.
  //
  // These tests codify the contract so future regressions surface in CI.
  // ════════════════════════════════════════════════════════════════════════

  // ── Test 9 — Sentinel short-circuits view.kind to 'none' for ALL 3 inputs

  it('requireFullCatalog: plan-shaped taskFilter + sentinel → kind: "none" (sentinel wins)', () => {
    // The duck-type guard in `isSelectToolPlan` (architecture-integration.ts)
    // only requires `intents: Array<string>` + `sourcePermissions: object`,
    // but we populate the full SelectToolPlanResult shape (matching what
    // `selectToolPlan()` returns at runtime on the active /api/chat route)
    // so a future operator reading the fixture can verify the contract
    // against a realistic planner output. `reasons[]` is non-empty to
    // demonstrate the planner's telemetry surface; the sentinel test
    // assertion is on `view.kind` regardless of content.
    const plan: SelectToolPlanResult = {
      intents: ['web.fetch', 'web.search'],
      coreTools: ['web.fetch', 'web.search'],
      candidateToolIds: ['web.fetch', 'web.search'],
      requestedToolkits: ['gmail', 'slack'],
      sourcePermissions: {
        arcade: true,
        composio: true,
        mem0: true,
        nullclaw: true,
        remoteMcp: true,
        mcpHttp: true,
      },
      maxBudget: 20,
      reasons: [
        {
          intent: 'web.fetch',
          score: 18,
          matchedSignals: ['current-turn'],
          negatedSignals: [],
          weight: 18,
        },
        {
          intent: 'web.search',
          score: 14,
          matchedSignals: ['current-turn'],
          negatedSignals: [],
          weight: 14,
        },
      ],
      fallbackUsed: false,
      matchCount: 2,
    };
    const view = computeTaskFilterView(plan, { requireFullCatalog: true });
    expect(view.kind).toBe('none');
  });

  it('requireFullCatalog: undefined taskFilter + sentinel → kind: "none" (also fall-through)', () => {
    const view = computeTaskFilterView(undefined, { requireFullCatalog: true });
    expect(view.kind).toBe('none');
  });

  // Regression: WITHOUT the sentinel, undefined taskFilter still falls to
  // kind: 'none' (the existing legacy fall-through at L787 of
  // architecture-integration.ts). This test pins that contract so the
  // sentinel short-circuit at L772 doesn't accidentally SILENCE that path.
  it('no sentinel: undefined taskFilter → kind: "none" (legacy fall-through preserved)', () => {
    const view = computeTaskFilterView(undefined, {});
    expect(view.kind).toBe('none');
  });

  // Regression: WITHOUT the sentinel, the plan branch takes its normal
  // shape — proves the sentinel ONLY changes the 'none' short-circuit,
  // not the 'plan' discriminator.
  it('no sentinel: plan-shaped taskFilter → kind: "plan" (not short-circuited)', () => {
    const plan: SelectToolPlanResult = {
      intents: ['web.fetch'],
      coreTools: ['web.fetch'],
      candidateToolIds: ['web.fetch'],
      requestedToolkits: [],
      sourcePermissions: {
        arcade: true,
        composio: false,
        mem0: false,
        nullclaw: false,
        remoteMcp: false,
        mcpHttp: false,
      },
      maxBudget: 20,
      reasons: [],
      fallbackUsed: false,
      matchCount: 1,
    };
    const view = computeTaskFilterView(plan, {});
    expect(view.kind).toBe('plan');
    if (view.kind === 'plan') {
      expect(view.intents.has('web.fetch')).toBe(true);
    }
  });

  // ── Test 10 — 5 per-source filter helpers return `[...all]` on view.kind === 'none'
  //
  // Locks the downstream behavior of the sentinel: when the sentinel
  // short-circuits the view, each of the 5 per-source filter helpers
  // must return the unfiltered upstream tool catalog. This is what
  // makes the cap-bypass at L1666-L1668a meaningful — if any helper
  // broke the [...all] contract, the tools-only consumer would still
  // miss tools even with sentinel on.
  it('filterBlaxelToolsByView: view.kind === "none" → returns [...all] verbatim (sentinel path)', () => {
    const allBlaxel = [
      vfsSchemaFactory('blaxel_codegenGrepSearch'),
      vfsSchemaFactory('blaxel_codegenParallelApply'),
      vfsSchemaFactory('blaxel_codegenReapply'),
    ];
    const view: TaskFilterView = { kind: 'none' };
    const filtered = filterBlaxelToolsByView(allBlaxel, view);
    expect(names(filtered)).toEqual(names(allBlaxel));
  });

  it('filterNullclawToolsByView: view.kind === "none" → returns [...all] minus nullclaw_status sentinel (existing strip preserved)', () => {
    const allNullclaw = [
      vfsSchemaFactory('nullclaw_discord_send'),
      vfsSchemaFactory('nullclaw_browse_navigate'),
      vfsSchemaFactory('nullclaw_status'),  // Always stripped
    ];
    const view: TaskFilterView = { kind: 'none' };
    const filtered = filterNullclawToolsByView(allNullclaw, view);
    const kept = names(filtered);
    expect(kept).toContain('nullclaw_discord_send');
    expect(kept).toContain('nullclaw_browse_navigate');
    expect(kept).not.toContain('nullclaw_status');
  });

  it('filterArcadeToolsByView: view.kind === "none" → returns [...all] verbatim (sentinel path)', () => {
    const allArcade = [
      vfsSchemaFactory('arcade_web_search'),
      vfsSchemaFactory('arcade_gmail_send'),
      vfsSchemaFactory('arcade_github_create_issue'),
    ];
    const view: TaskFilterView = { kind: 'none' };
    const filtered = filterArcadeToolsByView(allArcade, view);
    expect(names(filtered)).toEqual(names(allArcade));
  });

  it('filterComposioToolsByView: view.kind === "none" → returns [...all] verbatim (sentinel path)', () => {
    const allComposio = [
      { ...vfsSchemaFactory('gmail_send_draft'), toolkit: 'gmail' } as any,
      { ...vfsSchemaFactory('slack_post_message'), toolkit: 'slack' } as any,
      { ...vfsSchemaFactory('mystery_widget'), toolkit: 'unknown' } as any,
    ];
    const view: TaskFilterView = { kind: 'none' };
    const filtered = filterComposioToolsByView(allComposio, view);
    expect(names(filtered)).toEqual(names(allComposio));
  });

  it('filterProviderToolsByView: view.kind === "none" → returns [...all] verbatim (sentinel path)', () => {
    const allProvider = [
      vfsSchemaFactory('daytona_computer_use_zoom'),
      vfsSchemaFactory('e2b_run_python'),
      vfsSchemaFactory('codesandbox_create_sandbox'),
      vfsSchemaFactory('sprites_create_checkpoint'),
    ];
    const view: TaskFilterView = { kind: 'none' };
    const filtered = filterProviderToolsByView(allProvider, view);
    expect(names(filtered)).toEqual(names(allProvider));
  });

  // ════════════════════════════════════════════════════════════════════════
  // isStructuredMcpError type-guard contract (F1 SHOULD-CONSIDER fix,
  // 2026-07-16)
  //
  // The guard at /opt/bing/web/lib/mcp/architecture-integration.ts:L740+
  // narrows `unknown → { message: string; code?: string; retryable?: boolean;
  // correctedExample?: string }`. These tests pin the runtime predicate
  // behavior so future edits that loosen or tighten the guard regress in
  // CI rather than at the orchestrator call site.
  //
  // Cases 1-2 cover positive paths (with + without optional fields) and
  // confirm the TS-narrowed type lets callers read `e.message` directly.
  // Cases 3-5 cover the fail-closed negatives: null, missing-message,
  // empty-message-string — all must return false so the orchestrator
  // (route.ts:L1968) does NOT silently treat a corrupt error blob as
  // a structured error and produce a misleading ORCHESTRATOR-UNWRAP
  // hint string.
  // ════════════════════════════════════════════════════════════════════════

  it('isStructuredMcpError: minimal valid { message } returns true and narrows type', () => {
    const candidate = { message: 'something failed' };
    expect(isStructuredMcpError(candidate)).toBe(true);
    if (isStructuredMcpError(candidate)) {
      // Compile-time narrowed access — type system flags any typo here
      // as a TS error if the guard's predicate shape changes.
      expect(candidate.message).toBe('something failed');
    }
  });

  it('isStructuredMcpError: full { message, code, retryable, correctedExample } → true + all optional fields present', () => {
    const candidate = {
      message: 'tool execution failed',
      code: 'INVALID_CONTENT',
      retryable: true,
      correctedExample: 'retry with {"foo": "bar"}',
    };
    expect(isStructuredMcpError(candidate)).toBe(true);
    if (isStructuredMcpError(candidate)) {
      expect(candidate.code).toBe('INVALID_CONTENT');
      expect(candidate.retryable).toBe(true);
      expect(candidate.correctedExample).toBe('retry with {"foo": "bar"}');
    }
  });

  it('isStructuredMcpError: null → false (orchestrator falls through to generic WARN path)', () => {
    expect(isStructuredMcpError(null)).toBe(false);
  });

  it('isStructuredMcpError: object without message field → false (avoids corrupt error-blob false-positive)', () => {
    expect(isStructuredMcpError({ code: 'X', retryable: true })).toBe(false);
    expect(isStructuredMcpError({})).toBe(false);
  });

  it('isStructuredMcpError: object with empty-string message → false (avoids empty-orchestratorHint false-positive)', () => {
    expect(isStructuredMcpError({ message: '' })).toBe(false);
  });

  // Typeof-guard early-return coverage (code-reviewer SHOULD-CONSIDER #1):
  // Pins the `value === null || typeof value !== 'object'` early-return
  // branch so a regression that drops the typeof check surfaces in CI.
  // Cases 4 and 5 above already use real objects (which pass the typeof
  // check), so without these primitive/function cases a regression that
  // drops the early-return would still pass the 5 existing tests.
  it('isStructuredMcpError: primitives (number, string) and function return false (typeof-guard early-return)', () => {
    expect(isStructuredMcpError(42)).toBe(false);
    expect(isStructuredMcpError('a string')).toBe(false);
    expect(isStructuredMcpError(true)).toBe(false);
    expect(isStructuredMcpError(undefined)).toBe(false);
    expect(isStructuredMcpError(() => ({ message: 'fake' }))).toBe(false);
  });

  // ════════════════════════════════════════════════════════════════════════
  // unwrapStructuredToolError format-lock contract (code-reviewer
  // SHOULD-CONSIDER follow-up)
  //
  // The helper at /opt/bing/web/lib/mcp/orchestrator-error-unwrap.ts
  // composes the LLM-facing `[ORCHESTRATOR-UNWRAP]: ...` block. Its
  // string template is the single source of truth that downstream LLM
  // tool-result consumers depend on. Locking the EXACT format string
  // means a future engineer changing the `UNKNOWN` literal, the `\n`
  // newline, or the `→` arrow surfaces in CI rather than at LLM time.
  // ════════════════════════════════════════════════════════════════════════

  it('unwrapStructuredToolError: full shape asserts EXACT formatted string', () => {
    const result = unwrapStructuredToolError({
      message: 'tool execution failed',
      code: 'INVALID_CONTENT',
      retryable: true,
      correctedExample: 'retry with {"foo": "bar"}',
    });
    expect(result).toBe(
      '[ORCHESTRATOR-UNWRAP]: tool execution failed\n[error.code=INVALID_CONTENT] [retryable=true]\n→ retry with {"foo": "bar"}',
    );
  });

  it('unwrapStructuredToolError: minimal { message } asserts default code + retryable + no arrow line', () => {
    const result = unwrapStructuredToolError({ message: 'x' });
    expect(result).toBe(
      '[ORCHESTRATOR-UNWRAP]: x\n[error.code=UNKNOWN] [retryable=false]',
    );
  });

  it('unwrapStructuredToolError: null input → null (passes through to caller WARN path)', () => {
    expect(unwrapStructuredToolError(null)).toBe(null);
    expect(unwrapStructuredToolError(undefined)).toBe(null);
    expect(unwrapStructuredToolError({})).toBe(null);
    expect(unwrapStructuredToolError({ message: '' })).toBe(null);
  });
});
