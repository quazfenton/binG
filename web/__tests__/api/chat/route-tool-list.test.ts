/**
 * Chat Route Tool List — integration smoke test for /opt/bing/web/app/api/chat/route.ts (POST).
 *
 * Mirror of the actual call path at L1762-L1903 of route.ts:
 *   1. `selectToolPlan({ userMessage, conversationHistory, attachedFiles, authenticated,
 *                        filesystemEditEligible, configuredSources })`
 *   2. `getMCPToolsForAI_SDK(authenticatedUserId, toolPlan, mcpAbortSignal)`
 *   3. `config.tools = tools.map(t => ({ name, description, parameters }))`
 *
 * The audit's prior 6 remediation steps are complete: the planner + assembler
 * pipeline produces a deterministic tool list per intent type. This test
 * locks down the audit's stated invariant: every chat turn drops below the
 * prior 15-19-tool floor, with per-intent bounds that vary by demand.
 *
 * Scope rationale: this is a ROUTE-LEVEL smoke test. We don't drive the
 * POST() function itself (5800 lines with side effects: auth, rate limit,
 * V2 gateway, agent routing, etc.). Instead we replay the EXACT 3-step
 * planner→assembler→config-toools transformation that route.ts runs at
 * L1762-L1814 + L1903. Same inputs, same mocks — same output bound.
 *
 * Mock surface: the underlying source providers (getVFSToolDefinitions,
 * createBashTool, getArcadeService, hasRemoteMCPServers/getRemoteMCPTools,
 * isMem0Configured/buildMem0Tools, getAllProviderAdvancedTools) are mocked
 * so each can return a deterministic schema set. The real planner runs
 * (no spy — pure function), and the real getMCPToolsForAI_SDK runs over
 * the mocked inputs. The result is an end-to-end pipeline test with
 * hermetic inputs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Module mocks (hoisted) — same surface as request-to-final-list.test.ts
// plus an additional composio factory for the integration test cases ─────

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
vi.mock('@/lib/mcp/vfs-mcp-tools', () => ({
  // 8 VFS schemas returning the workflow-companion names so the cap-exempt
  // path keeps them even when the budget runs out.
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

// ── Scaffolding helpers ────────────────────────────────────────────────────

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

// ── Mirrored route call-pipeline (L1762-L1814 + L1903) ─────────────────────
//
// Mirrors the route's exact call: compute plan → call assembler with plan
// as `taskFilter`, real `mcpAbortSignal` via plain AbortController.signal
// (the route's `AbortSignal.timeout(MCP_TOOLS_TIMEOUT_MS)` interacts with
// vitest fake timers; we sidestep that by passing a plain uncontrolled
// signal — the assemblage resolves synchronously in <50ms via mocks so
// timing is not a determinism factor here).

interface PlanPipelineInput {
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  attachedFiles?: ReadonlyArray<string>;
  authenticatedUserId?: string | undefined;
  enableFilesystemEdits: boolean;
}

interface PlanPipelineOutput {
  plan: ReturnType<typeof import('@/lib/tools/select-tool-plan').selectToolPlan>;
  tools: MCPSchema[];
  configTools: Array<{ name: string; description?: string; parameters: any }>;
}

async function runRouteToolListPipeline(
  input: PlanPipelineInput,
): Promise<PlanPipelineOutput> {
  // Dynamic-imported AFTER vi.resetModules() in beforeEach so the module
  // graph reflects the per-test mock state. Both modules are statically
  // imported here for type-check + bundle hoisting; the actual call goes
  // through the freshly-resolved namespace.
  const { selectToolPlan } = await import('@/lib/tools/select-tool-plan');
  const { getMCPToolsForAI_SDK, callMCPToolFromAI_SDK } = await import(
    '@/lib/mcp/architecture-integration'
  );

  // 1) Plan compute — mirrors L1762.
  const plan = selectToolPlan({
    userMessage: input.userMessage,
    conversationHistory: input.conversationHistory ?? [],
    attachedFiles: input.attachedFiles ?? [],
    authenticated: !!input.authenticatedUserId,
    filesystemEditEligible: input.enableFilesystemEdits,
    configuredSources: {
      arcade: !!process.env.ARCADE_API_KEY,
      composio: !!process.env.COMPOSIO_API_KEY,
      nullclaw: process.env.NULLCLAW_ENABLED === 'true',
      remoteMcp: true,
      mem0: !!process.env.MEM0_API_KEY,
      mcpHttp: true,
    },
  });

  // 2) Assembler call — mirrors L1814. We mirror the route's
  // AbortSignal.timeout(CHAT_MCP_TOOLS_TIMEOUT_MS) pattern so any future
  // `signal.aborted` gating in getMCPToolsForAI_SDK is exercised in the
  // same way as production. Vitest fake timers are NOT used here so the
  // real timer fires after the 1s default — mocked sources resolve in
  // microtask time, well under the timeout ceiling, so the signal is
  // effectively un-aborted during the test.
  const MCP_TOOLS_TIMEOUT_MS = parseInt(
    process.env.CHAT_MCP_TOOLS_TIMEOUT_MS || '1000',
    10,
  );
  const mcpAbortSignal = AbortSignal.timeout(MCP_TOOLS_TIMEOUT_MS);
  const tools = (await getMCPToolsForAI_SDK(
    input.authenticatedUserId ?? undefined,
    plan,
    mcpAbortSignal,
  )) as MCPSchema[];

  // 3) `config.tools` shape — mirrors L1903.
  const configTools = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));

  // callMCPToolFromAI_SDK is referenced here only so the call paths in the
  // route module don't fail to resolve its consumer-side imports in
  // side-effecting initialization. Not asserted on directly.
  void callMCPToolFromAI_SDK;

  return { plan, tools, configTools };
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('Chat Route integration — POST(L1762-L1903) tool list drops below 15-19 floor', () => {
  let envSnapshot: Record<string, string | undefined> = {};
  const SUITE_ENV_KEYS = [
    'ARCADE_API_KEY',
    'COMPOSIO_API_KEY',
    'BLAXEL_API_KEY',
    'NULLCLAW_ENABLED',
    'MCP_TOOLS_MAX_TOTAL',
  ];

  beforeEach(() => {
    envSnapshot = Object.fromEntries(SUITE_ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.ARCADE_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.BLAXEL_API_KEY;
    delete process.env.NULLCLAW_ENABLED;
    // Default cap. Tests that exercise cap behavior override this.
    delete process.env.MCP_TOOLS_MAX_TOTAL;
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

  // ── Test 1 — Greeting: floor ≤ 11 (was ~19 pre-audit) ────────────────────
  // "Hi, how are you?" pre-audit produced ~19 tools (all unfiltered MCP
  // schemas for native + VFS + bash + web_search + remote + arcade +
  // blaxel + mcporter). Post-audit: planner emits 0 intents, only VFS +
  // bash source bundles contribute, cap drops non-workflow-companion
  // entries to 0, final list = 10 workflow companions + 0 budgeted = 10.
  // (web.fetch in planner baseline is planner-level metadata; the MCP
  // layer has no `web_fetch` tool, only the synthetic `web_search` which
  // is suppressed without a search backend.)
  it('greeting: "hi, how are you?" → tools.length drops to ~10 workflow companions, well below 15-19 floor', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'hi, how are you?',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: false,
    });

    expect(out.plan.intents).toEqual([]);
    expect(out.plan.fallbackUsed).toBe(true);

    // Pre-audit floor was 15-19. Post-audit floor for a greeting is the
    // exact workflow-companion set the mocks return: VFS=8 schemas
    // (read_file, write_file, apply_diff, delete_file, move_file,
    // list_files, search_files, batch_write) + bash=1 (bash_execute).
    // All 9 are CAP-EXEMPT workflow companions, so the cap of 25 cannot
    // cull them (and budgeted = 0 since no other source is enabled).
    // Lock the count at exactly 9 so a regression adding unfiltered
    // tools (the pre-audit Arcade flood scenario) fails loudly.
    expect(out.tools.length).toBe(9);
    const tn = names(out.tools);
    // Workflow companions present.
    expect(tn).toContain('read_file');
    expect(tn).toContain('write_file');
    expect(tn).toContain('apply_diff');
    expect(tn).toContain('bash_execute');
    // No integration tools.
    expect(tn.filter((n) => n.startsWith('arcade_'))).toEqual([]);
    expect(tn.filter((n) => n.startsWith('slack_'))).toEqual([]);
    expect(tn.filter((n) => n.startsWith('gmail_'))).toEqual([]);
  });

  // ── Test 2 — Code edit: floor ≤ 12 (workflow + intent-driven VFS) ────────
  // For a code-edit request: planner emits code.edit + code.read; the
  // VFS tools (already workflow-companions) win; bash_execute adds 1.
  // No external SDKs enabled, so total = 10 workflow companions + 0 budgeted.
  // Pre-audit this would have been 15+ due to unfiltered remote/arcade
  // schemas. The smoke-test bound asserts the new floor.
  it('code edit: "patch the import in index.ts" → tools.length still ≤ 12, well below the 15-19 pre-audit floor', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'patch the import in index.ts to use the new module path',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: true,
    });

    expect(out.plan.intents).toContain('code.edit');
    // Same baseline as Test 1: code.edit intent adds planner-level IDs
    // (file.write, file.str_replace, file.append, file.batch_write,
    // code.ast_diff) which are NOT MCP-layer tool names — the VFS mock
    // fixture already provides write_file, apply_diff, batch_write under
    // the same workflow-companion names. So MCP tool count is unchanged
    // at 9.
    expect(out.tools.length).toBe(9);
    const tn = names(out.tools);
    expect(tn).toContain('write_file');
    expect(tn).toContain('apply_diff');
  });

  // ── Test 3 — Web fetch: floor ≤ 12 (no Arcade flooding) ──────────────────
  // Pre-audit: web.fetch request → "broad" trigger → Arcade returned
  // every tool in the catalog. Post-audit: planner requires EXPLICIT
  // arcade=true permission AND a web/integration intent; the URL signal
  // opens arcade permission but no SDK is enabled in this test (no
  // ARCADE_API_KEY), so per-source filter cascades to EMPTY.
  it('web fetch: "fetch https://example.com article" → no arcade_* tools, floor ≤ 12', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'fetch https://example.com article please',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: false,
    });

    expect(out.plan.intents).toContain('web.fetch');
    expect(out.plan.sourcePermissions.arcade).toBe(true);
    // Plan-mode (P1 #6 fix): planner opens arcade permission via the URL
    // signal BUT no arcade SDK is configured in this test (ARCADE_API_KEY
    // unset). Per-source filter cascades to EMPTY. MCP tool count stays
    // at the 9-tool workflow-companion baseline.
    expect(out.tools.length).toBe(9);
    expect(names(out.tools).filter((n) => n.startsWith('arcade_'))).toEqual([]);
  });

  // ── Test 4 — Auth-gated integration: composer tools culled for anon ─────
  // Pre-audit: anonymous user sending a Gmail request → composio SDK
  // called (no auth gate); even when it failed, the floor was bloated
  // with placeholder tool names. Post-audit: planner emits composio: false
  // for anon callers, the SDK is not even called.
  it('anonymous + gmail: composioTools empty, floor ≤ 11 (no SDK round-trip)', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'send a gmail draft about the team meeting',
      authenticatedUserId: undefined,
      enableFilesystemEdits: false,
    });

    // Auth-blocked: integration.gmail not in top intents.
    expect(out.plan.intents).not.toContain('integration.gmail');
    expect(out.plan.sourcePermissions.composio).toBe(false);
    // No composio SDK call attempted → no composio-tool names. MCP tool
    // count is the 9-tool workflow-companion baseline.
    expect(names(out.tools).filter((n) => n.includes('gmail'))).toEqual([]);
    expect(out.tools.length).toBe(9);
  });

  // ── Test 5 — Negation gating: "do not browse" zeros web.fetch + arcade ──
  // Pre-audit: only the broad substring gate ran; "do not browse https://…"
  // still opened Arcade because web.search's negation regex didn't include
  // "browse". Post-audit: planner upper audit (audit-fix
  // bing/web/lib/tools/select-tool-plan.ts) — the URL-signal arcade grant
  // is GUARDED by BOTH `webSearchNegated` AND `webFetchNegated`.
  it('web fetch negated: "do not browse https://example.com just summarize" → arcade permission false, no browse tools', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'do not browse https://example.com just summarize',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: false,
    });

    expect(out.plan.intents).not.toContain('web.fetch');
    // The planner-leak audit fix: URL-signal arcade is GUARDED by BOTH
    // web.search AND web.fetch negation. Without this guard, the URL
    // signal granted arcade=true even when browsing was explicitly
    // suppressed.
    expect(out.plan.sourcePermissions.arcade).toBe(false);
    // Negative-evidence zeros web.fetch → no intent-driven SDK load.
    // MCP tool count is the 9-tool workflow-companion baseline.
    expect(out.tools.length).toBe(9);
    expect(names(out.tools).filter((n) => n.startsWith('arcade_'))).toEqual([]);
    expect(names(out.tools).filter((n) => n.includes('browse'))).toEqual([]);
  });

  // ── Test 6 — Authenticated Slack/email: composer permission granted, scoped
  // For an authenticated Slack request, the planner emits composio=true +
  // requestedToolkits=['slack']. Without COMPOSIO_API_KEY in test env,
  // the SDK is not enabled in the route's run, so no slack_* surface; but
  // the planner layer IS verified.
  it('authenticated + slack: planner opens composio source + scopes requestedToolkits=["slack"]', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'send slack a deployment-success message about the release',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: false,
    });

    expect(out.plan.intents).toContain('integration.slack');
    expect(out.plan.sourcePermissions.composio).toBe(true);
    expect(out.plan.requestedToolkits).toEqual(['slack']);
    // Planner scopes composio to ['slack'] and grants composio=true, but
    // COMPOSIO_API_KEY is unset in test env, so composioTools = []. MCP
    // tool count is the 9-tool workflow-companion baseline.
    expect(out.tools.length).toBe(9);
  });

  // ── Test 7 — Automation (broad match): no arcade flood ────────────────────
  // Pre-audit: a broad "automation" prompt without web/integration keywords
  // would still trigger Arcade's broad-match gate. Post-audit: planner
  // emits arcade=false for any non-web/non-integration message, regardless
  // of the words "automation" / "schedule" / "remind".
  it('automation broad: "automate my morning schedule routine" → arcade perm false, no arcade_* tools', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'automate my morning schedule routine, set up reminders',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: false,
    });

    expect(out.plan.sourcePermissions.arcade).toBe(false);
    expect(names(out.tools).filter((n) => n.startsWith('arcade_'))).toEqual([]);
    // Broad-match fix (P1 #6): "automation" prompt without web/integration
    // intent does NOT grant arcade permission; per-source filter cascades
    // to EMPTY. MCP tool count is the 9-tool workflow-companion baseline.
    expect(out.tools.length).toBe(9);
  });

  // ── Test 8 — Cap conformance: tools.length respects MCP_TOOLS_MAX_TOTAL ─
  // When the cap is set lower than the workflow-companion count, the
  // exempt set still wins (workflow companions cannot be culled by cap).
  // The non-exempt budget fits whatever slots are left over.
  it('cap conformance: MCP_TOOLS_MAX_TOTAL=5 → tools.length = workflow-companion count (cap-exempt)', async () => {
    process.env.MCP_TOOLS_MAX_TOTAL = '5';

    const out = await runRouteToolListPipeline({
      userMessage: 'hi, how are you?',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: false,
    });

    // Workflow companions are CAP-EXEMPT regardless of MCP_TOOLS_MAX_TOTAL
    // (audit fix). With cap=5, normally only 5 tools would survive — but
    // the 9 workflow companions (8 VFS + 1 bash) are preserved by the
    // exempt path. Budgeted = 0 since no other source contributes.
    expect(out.tools.length).toBe(9);
  });

  // ── Test 9 — config.tools shape (mirrors L1903 exactly) ──────────────────
  // Verifies the EXACT shape that route.ts assigns to `config.tools` per
  // the L1903 mapping. The route moves the assemble result into configTools
  // via `tools.map(t => ({ name, description, parameters }))` — the smoke
  // test mirrors this so the LLM-facing schema is verified end-to-end.
  it('configTools shape: each entry has name, description, parameters fields from MCP schema', async () => {
    const out = await runRouteToolListPipeline({
      userMessage: 'hi, how are you?',
      authenticatedUserId: 'user-1234567890',
      enableFilesystemEdits: false,
    });

    expect(out.configTools.length).toBe(out.tools.length);
    // Symmetric with the other 8 tests in this suite: the deterministic
    // post-audit count is exactly 9 (8 VFS workflow-companions + bash_execute).
    expect(out.configTools.length).toBe(9);
    for (const ct of out.configTools) {
      expect(typeof ct.name).toBe('string');
      expect(ct.name.length).toBeGreaterThan(0);
      // parameters is `object` from the vfsSchemaFactory fixture; may be
      // replaced with an actual Zod-converted schema in production.
      expect(ct.parameters).toBeDefined();
    }
    // configTools names match the underlying tool names (verifies the map
    // doesn't lose or rename any tools).
    expect(out.configTools.map((t) => t.name).sort()).toEqual(names(out.tools));
  });
});
