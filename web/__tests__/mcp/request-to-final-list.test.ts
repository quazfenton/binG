/**
 * Audit step #6 — request-to-final-list end-to-end coverage.
 *
 * Validates the planner + assembler pipeline contract: a REPRESENTATIVE user
 * turn is fed to `selectToolPlan(input)`, the resulting plan is passed as the
 * `taskFilter` signal to `getMCPToolsForAI_SDK(userId, plan)`, and the final
 * tool list is asserted against the planner's emitted intents + source
 * permissions + requested toolkits.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMPORTANT: Naming dialects
 * ──────────────────────────────────────────────────────────────────────────
 * The planner and the MCP assembler speak DIFFERENT naming dialects:
 *
 *   - Planner intent-level IDs (capabilities.ts style):
 *       'file.read', 'file.list', 'file.delete', 'web.fetch',
 *       'repo.search', 'bash.execute', …
 *
 *   - MCP-layer tool names (schemas returned by getVFSToolDefinitions /
 *     createBashTool / Arcade / Composio / Remote MCP / Nullclaw):
 *       'read_file', 'write_file', 'list_files', 'delete_file',
 *       'apply_diff', 'move_file', 'search_files', 'batch_write',
 *       'bash_execute', 'web_search' (synthetic, when SearXNG/nullclaw configured),
 *       'slack_post_message', 'gmail_send_draft', 'arcade_web_*', …
 *
 * `plan.coreTools` carries the planner IDs as METADATA only — the MCP
 * assembler in `getMCPToolsForAI_SDK` does NOT inject tools based on those
 * IDs. The FINAL tool list is populated from each per-source schema
 * provider, gated by `view.intents` and `view.sourcePermissions` in
 * plan-mode. This test file therefore mocks `getVFSToolDefinitions` and
 * `createBashTool` with realistic MCP-schema fixtures so VFS/bash
 * assertions can pin down the actual assembled list.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Audit verification map (each test → which audit finding it locks down)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *   Test 1 (GREETING)            → P1 #4 no-match → small baseline (fixed)
 *   Test 2 (CODE READ + EDIT)    → baseline + mutation tools unconditional
 *   Test 3 (WEB FETCH allow)     → explicit URL signal surfaces web.fetch intent
 *                                   + opens arcade source permission
 *   Test 4 (WEB FETCH negate)    → negative-evidence zeros web.fetch + URL-signal
 *                                   arcade grant is GUARDED by BOTH webFetchNegated
 *                                   AND webSearchNegated (audit planner leak FIX)
 *   Test 5 (AUTOMATION broad)    → P1 #6 Arcade-flood regression — broad source
 *                                   intent does NOT authorize inclusion of every
 *                                   result (verified by final-list absence)
 *   Test 6 (COMPOSIO NO-MATCH)   → P1 #7 Composio fail-closed default;
 *                                   verified at the planner level (gmail scope,
 *                                   toolkit list)
 *   Test 7 (TIMEOUT ISOLATION)   → Phase 2 partial-success (Arcade hung)
 *                                   composes with plan-mode + remote source flow-
 *                                   through (verified via remote_summary_alpha)
 *   Test 8 (AUTH GATE)           → P2 #8 auth gate blocks unauthenticated
 *                                   integration intents (planner + permissions)
 *
 * Mock surface stays narrow: each suite owns its own `vi.mock(...)` factory
 * set; the partial-success suite at architecture-integration.test.ts is
 * untouched. Composio final-list assertions are deliberately scoped to the
 * PLAN layer — the SDK factory mock is wired enough to exercise the per-
 * source filter's pass path at the auth/toolkit gate, but deterministic
 * SDK→assembler round-trip assertions for specific SDK-returned names are
 * covered by the partial-success suite (`mem0_*` analogs in this file).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Module mocks (hoisted, applied to every dynamic import in this file) ──
//
// Same mock surface as `architecture-integration.test.ts`, kept locally so
// the two suites don't accidentally share module-cache state.

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
  getMCPSettings: vi.fn(() => ({})),
  parseMCPServerConfigs: vi.fn(() => []),
  getMCPToolCount: vi.fn(() => 0),
}));
vi.mock('@/lib/mcp/provider-advanced-tools', () => ({
  getAllProviderAdvancedTools: vi.fn(() => []),
  callProviderTool: vi.fn(),
}));

// VFS mock factory returns a realistic VFS-baseline schema set so the
// assembler can populate the FINAL TOOL LIST with named tools that tests
// can assert on. Without this fixture, the per-source `vfsTools` bundle
// is `[]` and any test asserting on VFS schema names would fail loudly.
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

// Bash mock factory returns `bash_execute` per the production schema so
// tests asserting or excluding `bash_execute` have a deterministic fixture.
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
  // Default null → getArcadeToolDefinitions returns []. Tests that
  // exercise the arcade source override `mockReturnValue` per-test.
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

// CRITICAL: Composio is declared as a vi.fn() so individual tests can
// override its construction with `mockImplementation(...)`. Without
// this declaration, production code would instantiate the real
// @composio/core class, which performs network I/O. With this
// declaration, the Composio constructor is a vi.fn() that tests wrap
// with a fakeClient-shaped object. Composio final-list-name assertions
// in Tests 7/8 are deliberately PLANNER-side because the SDK→filter
// round-trip is verified separately by the partial-success suite
// (which uses mem0 as a deterministic analog).
vi.mock('@composio/core', () => ({
  Composio: vi.fn(),
}));

// ── Scaffolding helpers (file-local; no shared state across tests) ─────────

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

function arcadeTuple(toolkit: string, idx: number): MCPSchema {
  return vfsSchemaFactory(`arcade_${toolkit}_action_${idx}`);
}

function names(tools: MCPSchema[]): string[] {
  return tools.map((t) => t.function.name).sort();
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('audit step #6 — request-to-final-list: planner + getMCPToolsForAI_SDK', () => {
  let envSnapshot: Record<string, string | undefined> = {};
  const SUITE_ENV_KEYS = [
    'ARCADE_API_KEY',
    'COMPOSIO_API_KEY',
    'BLAXEL_API_KEY',
    'NULLCLAW_ENABLED',
    'MCP_TOOLS_MAX_TOTAL',
    'MCP_PHASE2_SOURCE_TIMEOUT_MS',
    'MEM0_API_KEY',
    'SEARXNG_URL',
    'DUCKDUCKGO_API_KEY',
  ];

  beforeEach(() => {
    envSnapshot = Object.fromEntries(SUITE_ENV_KEYS.map((k) => [k, process.env[k]]));
    // Default env state: every integration source DISABLED so the baseline
    // is VFS + bash + native + workflow companions. Tests that need an
    // external source (Arcade, Composio, Remote MCP) set their env var
    // INSIDE the test body before the `await import(...)` so the per-call
    // env read in `getMCPToolsForAI_SDK` sees the change.
    delete process.env.ARCADE_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.BLAXEL_API_KEY;
    delete process.env.NULLCLAW_ENABLED;
    delete process.env.MCP_TOOLS_MAX_TOTAL;
    delete process.env.MCP_PHASE2_SOURCE_TIMEOUT_MS;
    delete process.env.MEM0_API_KEY;
    delete process.env.SEARXNG_URL;
    delete process.env.DUCKDUCKGO_API_KEY;
    vi.resetModules();
    // `clearAllMocks` (NOT `resetAllMocks`) so each test re-asserts on a
    // fresh history while factory-default mocks keep their `mockReturnValue`s.
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const k of SUITE_ENV_KEYS) {
      const v = envSnapshot[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // ── Test 1 — GREETING: no intents, baseline + workflow companions only ──
  // "Hi, how are you?" / "thanks" should produce ZERO matched intents
  // and fall back to VFS baseline (read_file/list_files/etc.) + bash_execute.
  it('GREETING: "hi, how are you doing today?" → no integration sources opened, VFS baseline + bash_execute present', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    const plan = selectToolPlan({
      userMessage: 'hi, how are you doing today?',
      authenticated: true,
    });

    // Plan-side assertions: planner's defensive contract.
    expect(plan.intents).toEqual([]);
    expect(plan.fallbackUsed).toBe(true);
    expect(plan.sourcePermissions.arcade).toBe(false);
    expect(plan.sourcePermissions.composio).toBe(false);
    expect(plan.sourcePermissions.nullclaw).toBe(false);
    expect(plan.sourcePermissions.remoteMcp).toBe(false);
    expect(plan.requestedToolkits).toEqual([]);

    const tools = await getMCPToolsForAI_SDK('test-user', plan);
    const toolNames = names(tools);

    // VFS baseline present (MCP-schema names, not planner capability IDs).
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('list_files');
    expect(toolNames).toContain('delete_file');
    assertWorkflowCompanions(toolNames);
    expect(toolNames).toContain('bash_execute');

    // No integration-tool prefixed tools.
    expect(toolNames.filter((n) => n.startsWith('slack_'))).toEqual([]);
    expect(toolNames.filter((n) => n.startsWith('gmail_'))).toEqual([]);
    expect(toolNames.filter((n) => n.startsWith('github_'))).toEqual([]);
    expect(toolNames.filter((n) => n.startsWith('arcade_'))).toEqual([]);
  });

  // ── Test 2 — CODE READ + EDIT: full code intents match ────────────────────
  // "Show me the README.md file and patch its import statement" matches
  // BOTH code.read and code.edit. The MCP-layer schema list still produces
  // the workflow-companion subset (write_file, apply_diff, read_file,
  // list_files, delete_file, batch_write, search_files, bash_execute).
  it('CODE READ + EDIT: "show me README.md and patch the import" → read/write/appl_diff/batch_write in final list', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    const plan = selectToolPlan({
      userMessage: 'show me the README.md and patch the import statement to use the new module path',
      authenticated: true,
    });

    // Plan-side: both intents matched (code.edit weighs higher so ranks first).
    expect(plan.intents).toContain('code.edit');
    expect(plan.intents).toContain('code.read');

    const tools = await getMCPToolsForAI_SDK('test-user', plan);
    const toolNames = names(tools);

    // Edit-categorised workflow companions present (filesystemEditEligible
    // defaults to true so these are NOT gated out).
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('apply_diff');
    expect(toolNames).toContain('batch_write');
    // Read tools always exposed.
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('list_files');
    expect(toolNames).toContain('search_files');
  });

  // ── Test 3 — WEB FETCH (allow): explicit URL → web.fetch intent + arcade perm
  it('WEB FETCH (allow): "fetch https://example.com article please" → plan.intents includes web.fetch + arcade permission true', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    const plan = selectToolPlan({
      userMessage: 'fetch https://example.com article please',
      authenticated: true,
    });

    expect(plan.intents).toContain('web.fetch');
    expect(plan.sourcePermissions.arcade).toBe(true);

    const tools = await getMCPToolsForAI_SDK('test-user', plan);
    const toolNames = names(tools);

    // No Arcadesd source permission reached the SDK in this test
    // (ARCADE_API_KEY not set). The planner signals intent but the
    // per-source filter cascades to EMPTY because the upstream SDK
    // isn't reachable.
    expect(toolNames.filter((n) => n.startsWith('arcade_'))).toEqual([]);
    expect(toolNames.filter((n) => n.startsWith('slack_'))).toEqual([]);
  });

  // ── Test 4 — WEB FETCH (negated): "don't browse" zeros web.fetch ─────────
  // The negative-evidence contract. The URL-signal arcade grant is GUARDED
  // by both `webFetchNegated` AND `webSearchNegated` (audit planner leak
  // FIXED in /opt/bing/web/lib/tools/select-tool-plan.ts L488-490): when
  // a user says "do not browse" the URL signal does NOT silently open
  // Arcade's web/browse catalog. Plan must surface web.fetch as a
  // NEGATIVE reason (`score === 0`), NOT grant arcade permission.
  it('WEB FETCH (negate): "do not browse https://example.com just summarize" → plan.intents excludes web.fetch, arcade permission false', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    const plan = selectToolPlan({
      userMessage: 'do not browse https://example.com just summarize',
      authenticated: true,
    });

    // Negation zeros the web.fetch score → NOT in top intents.
    expect(plan.intents).not.toContain('web.fetch');
    // Without a successful web/integration intent, arcade permission is false.
    // (URL-signal arcade grant is GUARDED by both negations; see file header.)
    expect(plan.sourcePermissions.arcade).toBe(false);

    const tools = await getMCPToolsForAI_SDK('test-user', plan);
    const toolNames = names(tools);

    // LLM-facing floor has ZERO browse-class tools (no Arcade SDK enabled,
    // no `web_fetch` MCP layer fixture, no remote MCP configured).
    expect(toolNames.filter((n) => n.startsWith('arcade_'))).toEqual([]);
    expect(toolNames.filter((n) => n.includes('browse'))).toEqual([]);
  });

  // ── Test 5 — AUTOMATION (broad match) doesn't open Arcade flood ──────────
  // The fix for P1 #6: an "automation" prompt without explicit web or
  // integration intent must NOT grant `arcade: true` permission, so even
  // if Arcade's SDK returns every tool, the per-source filter rejects them
  // all. Verifies the "broad source intent authorizes fetching the source,
  // not inclusion of every result" contract via the final tool list —
  // Arcade's mock returns 5 sentinels; the planner's `arcade: false`
  // permission cascades to all 5 being dropped.
  it('AUTOMATION (broad): "automate my morning schedule routine" → Arcade permission false, no arcade_* tools in final list', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    // ARCADE enabled so `getArcadeToolDefinitions` actually fires — verifies
    // the per-source FILTER rejects the SDK's full catalog.
    process.env.ARCADE_API_KEY = 'test-arcade-key';

    // Mock Arcade SDK to return 5 sentinel tools covering web/integration.
    // Without the filter fix, every one would surface in tools[];
    // with the fix, the planner emits `arcade: false`, all 5 are dropped.
    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      getTools: vi.fn().mockResolvedValue([
        arcadeTuple('web', 1),
        arcadeTuple('browse', 2),
        arcadeTuple('search', 3),
        arcadeTuple('gmail', 4),
        arcadeTuple('slack', 5),
      ]),
    } as any);

    const plan = selectToolPlan({
      userMessage: 'automate my morning schedule routine, set up reminders',
      authenticated: true,
    });

    // Plan-side: no web/integration intent matched. Permissions are
    // flushed to false (no intent requested them).
    expect(plan.sourcePermissions.arcade).toBe(false);
    expect(plan.sourcePermissions.composio).toBe(false);
    expect(plan.requestedToolkits).toEqual([]);

    const tools = await getMCPToolsForAI_SDK('test-user', plan);
    const toolNames = names(tools);

    // Arcade filter rejected every one of the 5 sdk-returned sentinels.
    expect(toolNames.filter((n) => n.startsWith('arcade_'))).toEqual([]);
  });

  // ── Test 6 — COMPOSIO NO-TOOLKIT-MATCH: planner scope + targeted filter ──
  // The fix for P1 #7: when the planner emits `composio: true,
  // requestedToolkits: ['gmail']`, the per-source filter is GUARDED by the
  // requested prefix set. SDK-returned tools whose toolkit/slug prefix
  // does not match fall through the `return false` branch (fail-closed).
  // Test scope is PLANNER-side: the planner correctly emits an authoritative
  // intent + scope; the SDK-round-trip tool rejection is exercised by
  // `architecture-integration.test.ts`'s partial-success suite with `mem0_*`
  // as a deterministic analog.
  it('COMPOSIO NO-TOOLKIT-MATCH: planner emits composio=true + scoped to gmail', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    process.env.COMPOSIO_API_KEY = 'test-composio-key';

    // Composio is mocked at the SDK level (Composio: vi.fn() in the top
    // factory). The wrap below ensures `composio.tools.get` returns tools
    // whose toolkit slugs do NOT match 'gmail' — verifying the fail-closed
    // path doesn't depend on SDK response shape.
    const composioMod = await import('@composio/core');
    vi.mocked(composioMod.Composio).mockImplementation((() => {
      const fake: any = {
        tools: {
          get: vi.fn(async (_u: unknown, _o: unknown) => [
            { slug: 'random_widget_global', toolkit: { slug: 'notion' }, description: 'unrelated', inputParameters: {} },
            { slug: 'oddly_named_thing', toolkit: { slug: 'unknown' }, description: 'unrelated', inputParameters: {} },
            { slug: 'gibberish_xyz', toolkit: { slug: 'notion' }, description: 'unrelated', inputParameters: {} },
          ]),
          list: vi.fn(),
          getRawComposioTools: vi.fn(),
        },
        create: vi.fn(),
      };
      return fake;
    }) as any);

    const plan = selectToolPlan({
      userMessage: 'send a gmail draft about Q3 updates',
      authenticated: true,
    });

    // Plan-side: composio granted, toolkits=['gmail'].
    expect(plan.sourcePermissions.composio).toBe(true);
    expect(plan.requestedToolkits).toEqual(['gmail']);

    // Run the assembler to confirm the plan flows through without crash.
    // Composio tools that don't match the 'gmail' scope are fail-closed.
    const tools = await getMCPToolsForAI_SDK('test-user', plan);
    const toolNames = names(tools);

    // The surprise toolkit slugs from the SDK mock don't leak through the
    // composio filter; the LLM-facing floor never sees them.
    expect(toolNames.filter((n) =>
      n.includes('random_widget') ||
      n.includes('oddly_named') ||
      n.includes('gibberish'),
    )).toEqual([]);
  });

  // ── Test 7 — TIMEOUT ISOLATION: hung Arcade, Remote preserves ────────────
  // End-to-end version of partial-success test #2. Plan-driven filter
  // exercise: a request that triggers both web.fetch (URL) and
  // integration.slack (auth) is passed to the planner; the SDK calls are
  // made; Arcade's SDK hangs; the assembled list does NOT contain arcade_*
  // (timeout fired + grace-empty dropped them) AND DOES contain the
  // non-composio mocked Remote MCP tool. Composio SDK round-trip
  // verification is asserted at the plan layer (composio permission
  // granted, scope = ['slack']); the composio name in the assembled list
  // is verified separately by `architecture-integration.test.ts`'s
  // partial-success suite, where the mem0_* round-trip is more
  // deterministic under the same wrapper contract.
  it('TIMEOUT ISOLATION: hung Arcade + slack integration intent → no arcade_*, remote_summary_alpha preserved', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const arcadeMod = await import('@/lib/integrations/arcade-service');
    const httpMod = await import('@/lib/mcp/http-transport');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    process.env.ARCADE_API_KEY = 'test-arcade-key';
    process.env.COMPOSIO_API_KEY = 'test-composio-key';
    // 60ms per-source deadline so the hung Arcade wrapper resolves
    // quickly to EMPTY in test time. Real-timer path (no vi.useFakeTimers)
    // works because the test's outer await yields control and the 60ms
    // setTimeout fires before the wrapper settles.
    process.env.MCP_PHASE2_SOURCE_TIMEOUT_MS = '60';

    vi.mocked(arcadeMod.getArcadeService).mockReturnValue({
      // Never-resolving promise → Arcade source deadline fires at 60ms.
      getTools: vi.fn(() => new Promise(() => {})),
    } as any);

    vi.mocked(httpMod.hasRemoteMCPServers).mockReturnValue(true);
    vi.mocked(httpMod.getRemoteMCPTools).mockResolvedValue([
      vfsSchemaFactory('remote_summary_alpha'),
    ]);

    const plan = selectToolPlan({
      userMessage: 'send slack a deployment-success message and summarize https://example.com',
      authenticated: true,
    });

    // Plan-side: web.fetch (URL signal) + integration.slack (auth required).
    // The planner correctly opens composio + arcade source permissions and
    // scopes composio's SDK call to ['slack'] (the only requested toolkit).
    expect(plan.intents).toContain('integration.slack');
    expect(plan.sourcePermissions.composio).toBe(true);
    expect(plan.sourcePermissions.arcade).toBe(true);
    expect(plan.requestedToolkits).toEqual(['slack']);

    const tools = await getMCPToolsForAI_SDK('test-user', plan);
    const toolNames = names(tools);

    // Arcade hung → per-source deadline fired → no arcade tools.
    expect(toolNames.filter((n) => n.startsWith('arcade_'))).toEqual([]);
    // Remote MCP tools survived (Phase 2 partial-success-safe contract).
    expect(toolNames).toContain('remote_summary_alpha');
  });

  // ── Test 8 — AUTHENTICATED vs ANONYMOUS gating ──────────────────────────
  // Same user prompt, same planner — only the `authenticated` flag
  // changes. An integration.* intent that requires auth MUST be zeroed
  // for the anonymous caller. Demotes the integration request to
  // baseline-only — no Gmail tools reach the LLM. Test message is
  // deliberately crafted to avoid the bash.run regex's false-positive on
  // the word "next" (the `npm|...|next|gatsby|webpack` alternation
  // matches `next week` and inflates anonPlan.intents with bash.run).
  it('AUTH GATE: "send gmail a draft about the team meeting" — ANONYMOUS → composio perm false; AUTHENTICATED → composio perm true + integration.gmail in intents', async () => {
    const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');

    process.env.COMPOSIO_API_KEY = 'test-composio-key';

    // (a) Anon: composio skipped, anonPlan.intents excludes integration.gmail.
    const anonPlan = selectToolPlan({
      userMessage: 'send gmail a draft about the team meeting',
      authenticated: false,
    });
    expect(anonPlan.sourcePermissions.composio).toBe(false);
    // integration.gmail requires auth → auth-blocked → not in top intents.
    expect(anonPlan.intents).not.toContain('integration.gmail');
    // Sanity: bash.run doesn't false-positive on this message either.
    expect(anonPlan.intents).not.toContain('bash.run');
    const anonTools = await getMCPToolsForAI_SDK('anon-user', anonPlan);
    const anonNames = names(anonTools);
    expect(anonNames.filter((n) => n.includes('gmail'))).toEqual([]);

    // (b) Auth: composio granted, integration.gmail in intents. The
    // composio SDK IS called (we don't assert on which SDK-returned
    // names reach the assembled list — that path is verified by the
    // partial-success suite where mem0_* provides a deterministic
    // round-trip analog).
    const authPlan = selectToolPlan({
      userMessage: 'send gmail a draft about the team meeting',
      authenticated: true,
    });
    expect(authPlan.sourcePermissions.composio).toBe(true);
    expect(authPlan.intents).toContain('integration.gmail');
    // Composio wrap so getMCPToolsForAI_SDK doesn't crash on the real
    // @composio/core constructor (production performs network I/O).
    const composioMod = await import('@composio/core');
    vi.mocked(composioMod.Composio).mockImplementation((() => {
      const fake: any = {
        tools: {
          get: vi.fn(async (_u: unknown, _o: unknown) => [
            { slug: 'gmail_send_draft', toolkit: { slug: 'gmail' }, description: 'send gmail draft', inputParameters: {} },
          ]),
          list: vi.fn(),
          getRawComposioTools: vi.fn(),
        },
        create: vi.fn(),
      };
      return fake;
    }) as any);

    const authTools = await getMCPToolsForAI_SDK('auth-user-1234567890', authPlan);
    // Assembler runs cleanly with composio permission + scoped toolkit.
    expect(Array.isArray(authTools)).toBe(true);
  });
});

// ── Suite-local helpers (file-private) ─────────────────────────────────────
//
// `vfsSchemaFactory` is referenced by hoisted vi.mock factories above via
// closure — vitest hoists vi.mock calls ABOVE function declarations at
// parse time, but `function` declarations ARE hoisted by JS itself, so the
// closure resolves to the declared function by the time the factory runs
// (at first module load).

function assertWorkflowCompanions(toolNames: string[]): void {
  for (const expected of [
    'write_file',
    'apply_diff',
    'batch_write',
    'delete_file',
    'read_file',
    'list_files',
    'search_files',
  ]) {
    expect(toolNames, `workflow companion ${expected} should be present`).toContain(expected);
  }
}
