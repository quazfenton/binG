/**
 * Legacy substring contract — `view.kind === 'string'` regression lock.
 *
 * The function signature at /opt/bing/web/lib/mcp/architecture-integration.ts
 * L1061-L1064 is `taskFilter?: string | SelectToolPlanResult`. The active
 * /api/chat route (L1747-L1814) wires `selectToolPlan` → plan-mode. Legacy
 * callers (vercel-ai-tools.ts L162-L188, and the indirect legacy paths
 * through unified-agent-service / enhanced-llm-service that ultimately
 * dispatch via vercel-ai-tools) still pass a RAW STRING taskFilter —
 * falling into `view.kind === 'string'` and preserving the pre-audit
 * substring-gate behavior VERBATIM.
 *
 * This test file locks down that substring contract in TWO LAYERS:
 *
 *   - E2E assembly tests (Tests 1, 2, 8): drive `getMCPToolsForAI_SDK`
 *     end-to-end with a string taskFilter and confirm the assembled tool
 *     list FLOOR / negative shapes. SDK env keys are unset, so per-source
 *     substrings/plan filters operate on the closed-system mocks — no
 *     `cached*` state, no `mockReturnValue` overrides required (mock-
 *     factory defaults are sufficient for these negative-shape paths).
 *
 *   - Per-source filter PREDICATE tests (Tests 3-7): invoke the PURE
 *     exported filter helpers (filterArcadeToolsByView,
 *     filterComposioToolsByView, filterBlaxelToolsByView,
 *     filterNullclawToolsByView, filterProviderToolsByView) directly
 *     with known inputs. This bypasses the vitest SDK-mock module-cache
 *     fragility observed across E2E mock-pattern rewrites and locks
 *     down the substring predicate logic verbatim.
 *
 * The legacy substring differences vs plan-mode (selectToolPlan) are
 * pinned at the per-source filter layer:
 *
 *   - Per-source Arcade substring gate:
 *       `needsWebAutomation || name.includes('browse') || name.includes('web')`
 *     When needsWebAutomation is true (substring `browse`/`web`/`automation`
 *     appears in the prompt) every Arcade tool is kept. Otherwise only
 *     tools whose name contains `browse`/`web` survive.
 *   - Per-source Composio substring gate has `return true` legacy
 *     fall-through for tools that don't match any of the 5 recognized
 *     family names (gmail/slack/drive/github/notion). Plan-mode rejects
 *     those (P1 #7 fix).
 *   - Provider-tools substring gate has `return true` fall-through for
 *     unrecognized names (legacy fail-open). Plan-mode gates on intents.
 *   - No negation logic at the URL-signal level (substring ignores
 *     negation entirely).
 *   - Blaxel substring: `search`/`find`/`codebase` triggers grep/search
 *     tools; `generate`/`create`/`implement` triggers apply/reapply
 *     tools. Otherwise filter returns false.
 *   - Nullclaw substring: `send`/`message`/`discord`/`telegram`
 *     triggers messaging tools; `browse`/`web_automation` triggers
 *     browse/automate tools. Otherwise filter returns false.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TaskFilterView } from '@/lib/mcp/architecture-integration';
import {
  filterArcadeToolsByView,
  filterComposioToolsByView,
  filterBlaxelToolsByView,
  filterNullclawToolsByView,
  filterProviderToolsByView,
} from '@/lib/mcp/architecture-integration';

// ── Module mocks (hoisted) — needed for E2E Tests 1, 2, 8 ─────────────────
//
// Each vi.mock factory returns deterministic, small data sets so the
// E2E-floor assertions can pin specific tool names. Tests 3-7 do NOT
// route through these mocks — they invoke the pure filter helpers
// directly with hard-coded inputs. The mocking surface stays narrow
// so per-source substring gates remain visible.

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
  // 4 explicit-name tools covering all 4 supported substring gates
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

function stringView(task: string): TaskFilterView {
  return { kind: 'string', taskLower: task.toLowerCase() };
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('legacy substring contract — view.kind === "string" branch', () => {
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

  // ════════════════════════════════════════════════════════════════════════
  // E2E assembly tests — exercise `getMCPToolsForAI_SDK` end-to-end with
  // string taskFilters. SDK env keys are deleted in beforeEach, so all
  // per-source SDK calls bail to empty by factory default. Assembled
  // tool list FLOOR is verifiable.
  // ════════════════════════════════════════════════════════════════════════

  // ── Test 1 — Greeting ────────────────────────────────────────────────────
  it('greeting: "hi, how are you?" → 9 workflow companions; no source-specific tools', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const tools = (await getMCPToolsForAI_SDK(
      'user-1234567890',
      'hi, how are you?',
      AbortSignal.timeout(parseInt(process.env.CHAT_MCP_TOOLS_TIMEOUT_MS || '1000', 10)),
    )) as MCPSchema[];
    const toolNames = names(tools);
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('bash_execute');
    // Provider-tools substring-mode gates: NONE of the 4 mocked provider
    // name prefixes (daytona_/e2b_/codesandbox_/sprites_) match the
    // greeting's trigger words (screenshot/agent/sandbox/checkpoint) →
    // all 4 are gated out. → 9 workflow companions, no providers.
    expect(toolNames).not.toContain('daytona_computer_use_zoom');
    expect(toolNames).not.toContain('e2b_run_python');
    expect(toolNames).not.toContain('codesandbox_create_sandbox');
    expect(toolNames).not.toContain('sprites_create_checkpoint');
    expect(toolNames.filter((n) => n.startsWith('arcade_'))).toEqual([]);
    expect(toolNames.filter((n) => n.startsWith('slack_'))).toEqual([]);
    expect(toolNames.length).toBe(9);
  });

  // ── Test 2 — Code edit ───────────────────────────────────────────────────
  it('code-edit: "modify the README.md import statement" → write_file + apply_diff, no providers', async () => {
    const { getMCPToolsForAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const tools = (await getMCPToolsForAI_SDK(
      'user-1234567890',
      'modify the import statement in README.md',
      AbortSignal.timeout(parseInt(process.env.CHAT_MCP_TOOLS_TIMEOUT_MS || '1000', 10)),
    )) as MCPSchema[];
    const toolNames = names(tools);
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('apply_diff');
    expect(toolNames).not.toContain('daytona_computer_use_zoom');
    expect(toolNames.length).toBe(9);
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
  // Per-source filter PREDICATE tests — invoke the PURE exported helpers
  // directly with known inputs / known taskLower. Bypasses SDK mock
  // module-cache fragility (the legacy E2E mocks repeatedly exhibited
  // propagation failures across alias-vs-relative path resolution).
  // ════════════════════════════════════════════════════════════════════════

  // ── Test 3 — Arcade substring broad-match ─────────────────────────────
  // Production filter (filterArcadeToolsByView, 'string' branch):
  //   needsWebAutomation = taskLower.includes('browse') || 'web' || 'automation';
  //   kept: needsWebAutomation || name.includes('browse') || name.includes('web');
  // When prompt contains 'browse'/'web'/'automation' substring, EVERY
  // Arcade tool is kept (broad match). Otherwise only tools with
  // 'browse'/'web' in their name survive.
  it('Arcade substring broad: prompt with "browse" → all 3 mocked Arcade tools KEPT (legacy flood)', () => {
    const allArcadeTools = [
      vfsSchemaFactory('arcade_web_search'),     // has 'web' → KEPT
      vfsSchemaFactory('arcade_browse_fetch'),   // has 'browse' → KEPT
      vfsSchemaFactory('arcade_gmail_send'),     // no web/browse → only KEPT because needsWebAutomation=true
    ];
    const filtered = filterArcadeToolsByView(allArcadeTools, stringView('fetch and browse https://example.com article'));
    const kept = names(filtered);
    expect(kept).toContain('arcade_web_search');
    expect(kept).toContain('arcade_browse_fetch');
    expect(kept).toContain('arcade_gmail_send');
    expect(kept.length).toBe(3);
  });

  it('Arcade substring narrow: prompt without "browse/web/automation" → only name-gated tools KEPT', () => {
    const allArcadeTools = [
      vfsSchemaFactory('arcade_web_search'),     // has 'web' → KEPT
      vfsSchemaFactory('arcade_browse_fetch'),   // has 'browse' → KEPT
      vfsSchemaFactory('arcade_gmail_send'),     // no web/browse → DROPPED
    ];
    const filtered = filterArcadeToolsByView(allArcadeTools, stringView('fetch https://example.com article'));
    const kept = names(filtered);
    expect(kept).toContain('arcade_web_search');
    expect(kept).toContain('arcade_browse_fetch');
    expect(kept).not.toContain('arcade_gmail_send');
    expect(kept.length).toBe(2);
  });

  // ── Test 4 — Composio substring match + legacy fail-open ─────────────
  // Production filter (filterComposioToolsByView, 'string' branch):
  //   recognized families → gated by predicate family
  //   unrecognized family → LEGACY `return true` fall-through (P1 #7 is
  //     the plan-mode fail-closed counterpart — substring preserves
  //     verbatim).
  it('Composio substring: prompt "send gmail a draft" → gmail_send_draft KEPT, random_widget KEPT via LEGACY "return true"', () => {
    const sdks = [
      { ...vfsSchemaFactory('gmail_send_draft') } as any,
      { ...vfsSchemaFactory('random_widget') } as any,
    ];
    const filtered = filterComposioToolsByView(sdks, stringView('send gmail a draft about the team meeting'));
    const kept = names(filtered);
    expect(kept).toContain('gmail_send_draft');
    // random_widget has no recognized family substring (gmail/slack/
    // drive/github/notion). LEGACY `return true` substring-mode
    // fall-through keeps it; plan-mode would reject (P1 #7).
    expect(kept).toContain('random_widget');
    expect(kept.length).toBe(2);
  });

  // ── Test 5 — Composio Slack substring match ───────────────────────────
  it('Composio substring: prompt "post a message in slack" → slack_post_message KEPT', () => {
    const sdks = [
      { ...vfsSchemaFactory('slack_post_message') } as any,
    ];
    const filtered = filterComposioToolsByView(sdks, stringView('post a message in slack about the release'));
    const kept = names(filtered);
    expect(kept).toContain('slack_post_message');
    expect(kept.length).toBe(1);
  });

  // ── Test 6 — Negation fail-open: substring ignores negation ─────────────
  // Plan-mode uses negative-evidence scoring. Substring-mode LEGACY does
  // NOT — "do not browse https://…" still contains 'browse' so Arcade's
  // substring broad-match fires.
  it('Arcade negation fail-open: prompt "do not browse https://example.com" → Arcade tools STILL kept (substring ignores negation)', () => {
    const allArcadeTools = [
      vfsSchemaFactory('arcade_web_fetch'),
      vfsSchemaFactory('arcade_browse_navigate'),
    ];
    const filtered = filterArcadeToolsByView(allArcadeTools, stringView('do not browse https://example.com just summarize'));
    const kept = names(filtered);
    expect(kept).toContain('arcade_web_fetch');
    expect(kept).toContain('arcade_browse_navigate');
    expect(kept.length).toBe(2);
  });

  // ── Test 7 — Automation broad substring-mode Arcade flood ─────────────
  // Production filter: needsWebAutomation = ... 'automation'. Prompt MUST
  // contain the literal substring 'automation' (NOT 'automate' which is
  // 9 chars vs the 10-char 'automation' trigger). All Arcade tools kept.
  it('Arcade substring automation broad: prompt with "automation" → all 3 mocked Arcade tools KEPT (LEGACY flood)', () => {
    const allArcadeTools = [
      vfsSchemaFactory('arcade_web_search'),
      vfsSchemaFactory('arcade_browse_fetch'),
      vfsSchemaFactory('arcade_gmail_send'),
    ];
    const filtered = filterArcadeToolsByView(allArcadeTools, stringView('I want automation for my morning routine and post reminders'));
    const kept = names(filtered);
    expect(kept).toContain('arcade_web_search');
    expect(kept).toContain('arcade_browse_fetch');
    expect(kept).toContain('arcade_gmail_send');
    expect(kept.length).toBe(3);
  });

  // ── Exhaustive Blaxel + Provider + Nullclaw substring coverage ──────────
  // The test suite covers the primary substring-mode distinctions. The
  // remaining per-source substring predicates are smaller and locked
  // down below as direct-predicate tests so future regressions in any
  // view branch surface immediately.

  it('Blaxel substring: prompt "search the codebase for foo" → search/grep tools KEPT, apply tools DROPPED', () => {
    const allBlaxel = [
      vfsSchemaFactory('blaxel_codegenGrepSearch'),     // has 'search'/'grep' → KEPT
      vfsSchemaFactory('blaxel_codegenCodebaseSearch'), // has 'search'/'grep' → KEPT
      vfsSchemaFactory('blaxel_codegenParallelApply'),  // has 'apply' → DROPPED (no `generate`)
      vfsSchemaFactory('blaxel_codegenReapply'),        // has 'reapply' → DROPPED
    ];
    const filtered = filterBlaxelToolsByView(allBlaxel, stringView('search the codebase for foo'));
    const kept = names(filtered);
    expect(kept).toContain('blaxel_codegenGrepSearch');
    expect(kept).toContain('blaxel_codegenCodebaseSearch');
    expect(kept).not.toContain('blaxel_codegenParallelApply');
    expect(kept).not.toContain('blaxel_codegenReapply');
  });

  it('Blaxel substring: prompt "generate a new component" → apply/reapply tools KEPT, search tools DROPPED', () => {
    const allBlaxel = [
      vfsSchemaFactory('blaxel_codegenGrepSearch'),     // has 'search'/'grep' → DROPPED
      vfsSchemaFactory('blaxel_codegenCodebaseSearch'),
      vfsSchemaFactory('blaxel_codegenParallelApply'),  // has 'apply' → KEPT
      vfsSchemaFactory('blaxel_codegenReapply'),        // has 'reapply' → KEPT
    ];
    const filtered = filterBlaxelToolsByView(allBlaxel, stringView('generate a new component implementation'));
    const kept = names(filtered);
    expect(kept).toContain('blaxel_codegenParallelApply');
    expect(kept).toContain('blaxel_codegenReapply');
    expect(kept).not.toContain('blaxel_codegenGrepSearch');
    expect(kept).not.toContain('blaxel_codegenCodebaseSearch');
  });

  it('Nullclaw substring: prompt "send a slack message" → messaging tools KEPT, nullclaw_status sentinel STRIPPED', () => {
    const allNullclaw = [
      vfsSchemaFactory('nullclaw_discord_send'),
      vfsSchemaFactory('nullclaw_browse_navigate'),
      vfsSchemaFactory('nullclaw_bash_run'),
      // EXACT name 'nullclaw_status' (no colon) — production strips this
      // via `tool.function?.name !== 'nullclaw_status'` filter at the top
      // of `filterNullclawToolsByView`. Using a colon variant here would
      // INCIDENTALLY pass the assertion via the secondary filter's `return
      // false` clause, masking future regressions that loosen the strip
      // invariant.
      vfsSchemaFactory('nullclaw_status'),
    ];
    const filtered = filterNullclawToolsByView(allNullclaw, stringView('send a slack message to the team'));
    const kept = names(filtered);
    expect(kept).toContain('nullclaw_discord_send');
    expect(kept).not.toContain('nullclaw_browse_navigate');
    expect(kept).not.toContain('nullclaw_bash_run');
    expect(kept).not.toContain('nullclaw_status');
  });

  it('Provider substring: prompt "take a screenshot" → daytona tools KEPT, others DROPPED', () => {
    const allProvider = [
      vfsSchemaFactory('daytona_computer_use_zoom'),  // daytona_ + needsComputerUse → KEPT
      vfsSchemaFactory('e2b_run_python'),             // e2b_ but no needsAgentOffload → DROPPED
      vfsSchemaFactory('codesandbox_create_sandbox'),
      vfsSchemaFactory('sprites_create_checkpoint'),
    ];
    const filtered = filterProviderToolsByView(allProvider, stringView('take a screenshot of the desktop'));
    const kept = names(filtered);
    expect(kept).toContain('daytona_computer_use_zoom');
    expect(kept).not.toContain('e2b_run_python');
    expect(kept).not.toContain('codesandbox_create_sandbox');
    expect(kept).not.toContain('sprites_create_checkpoint');
  });

  it('Provider substring unrecognized prefix: prompt without triggers → LEGACY "return true" fall-through KEPS unknown-named tools', () => {
    const allProvider = [
      vfsSchemaFactory('mystery_unknown_tool'),  // starts with neither prefix → LEGACY fall-through → KEPT
    ];
    const filtered = filterProviderToolsByView(allProvider, stringView('hello world'));
    const kept = names(filtered);
    expect(kept).toContain('mystery_unknown_tool');
  });
});
