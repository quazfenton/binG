/**
 * Pure tool-selection planner.
 *
 * `selectToolPlan(input, options)` consumes the current user turn plus
 * explicit context (attached files, filesystem-edit eligibility,
 * authentication, configured sources) and returns a deterministic plan:
 *
 *   - matched semantic intents (e.g. 'web.fetch', 'code.edit', 'bash.run')
 *   - explicit core tool IDs to always include
 *   - requested integration toolkits (Composio/Arcade scopes)
 *   - source fetch permissions (which external sources may be probed)
 *   - a maximum tool budget
 *   - matched candidate tool IDs (for downstream dedup / fan-in)
 *   - per-intent reasons (for telemetry + debugging)
 *
 * The function is PURE: no I/O, no env reads, no Date.now / Math.random.
 * It does not import `vercel-ai-tools.ts`, `architecture-integration.ts`,
 * or any AI SDK module — its output is plain data consumed by the route.
 *
 * Design choices (see docs in this file):
 *   - Word-boundary regex matching against the user's CURRENT turn
 *     (current turn weighted heavier than history).
 *   - Explicit URL / attached-file / file-path signals carry fixed high weight.
 *   - Negative evidence ("don't browse", "explain only", "no changes")
 *     zeros an intent's score — the user explicitly opted out.
 *   - No-match behaviour is an EXPLICIT SMALL BASELINE (file.read + write +
 *     list + delete + str_replace + web.fetch). NEVER "all capabilities".
 *
 * This module does not touch the active chat route. Wire-up happens in a
 * later change; tests cover the planner independently.
 */

// ============================================================================
// Public types
// ============================================================================

/**
 * Source permissions returned by the planner — bit-matrix the caller uses
 * to decide which MCP sources to query. Unauthenticated callers get
 * composio=false even if the intent wants it.
 */
export interface SourcePermissions {
  arcade: boolean;
  composio: boolean;
  nullclaw: boolean;
  remoteMcp: boolean;
  mem0: boolean;
  mcpHttp: boolean;
}

/**
 * What the assistant currently knows about the request. Everything is
 * explicit: there are no implicit env reads or singleton fetches.
 */
export interface SelectToolPlanInput {
  /** Current user turn. Used as the highest-weight signal. */
  userMessage: string;
  /**
   * Long-lived agent's standing task (e.g. unified-agent's `config.task`).
   * Weighted between current turn and history — used so legacy callers
   * that don't yet expose a `getCurrentUserTurn()` accessor can still
   * surface their agent-level intent without confusing the planner's
   * turn-vs-history weighting. Empty when no agent standing-task is
   * available (e.g. direct chat route, which passes the live turn).
   */
  agentTask?: string;
  /**
   * Prior turns in chronological order (oldest first). Weighted lower
   * than the current turn — used only to disambiguate "search" when the
   * surrounding history is unambiguously code-search.
   */
  conversationHistory?: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** Explicit file paths attached to the request (e.g. @-mentions). */
  attachedFiles?: ReadonlyArray<string>;
  /** Whether the route has accepted filesystem-edit eligibility. */
  filesystemEditEligible?: boolean;
  /** Whether the request is authenticated (vs anonymous). */
  authenticated?: boolean;
  /** Which MCP/integration backends are configured at the process level. */
  configuredSources?: Partial<SourcePermissions>;
}

/**
 * Tunables. Defaults are tuned for the active chat route's token budget.
 * All overrides are clamped to non-negative numbers.
 */
export interface SelectToolPlanOptions {
  /** Maximum total tools allowed in the final list. Default: 20. */
  maxBudget?: number;
  /** Tool IDs to include on no-match. Default: BASELINE_CORE_TOOL_IDS. */
  baselineCoreToolIds?: ReadonlyArray<string>;
  /** Weight multiplier on current-turn matches. Default: 1.0. */
  currentTurnWeight?: number;
  /** Weight multiplier on history matches. Default: 0.4. */
  historyWeight?: number;
  /** Weight multiplier on agentTask matches. Default: 0.6. */
  agentTaskWeight?: number;
  /**
   * Item ⑤: When true, URLs / file paths detected inside `agentTask`
   * will promote the corresponding `web.fetch` / file intents via the
   * explicit-signal boost — even when `currentTurn` is empty. Default:
   * `false`. The audit-cited defect was that agent-purpose URLs bled
   * into every turn's web-automation intent. Closing by default keeps
   * current call sites safe; opt in per-site when a standing task
   * explicitly drives a fetch.
   */
  agentTaskUrlReadsEnabled?: boolean;
  /**
   * Multiplier applied to an intent's score when its negative regex matches
   * the current turn. Default: 0 (hard exclude). Set to e.g. 0.25 for
   * "soft negation" if you want to keep the intent on standby.
   */
  negativeMultiplier?: number;
  /** Explicit hard cap on intents returned (after dedup). Default: 8. */
  maxIntents?: number;
}

/** Per-intent reason for telemetry + assertion in tests. */
export interface IntentReason {
  intent: string;
  score: number;
  matchedSignals: string[];
  negatedSignals: string[];
  weight: number;
}

export interface SelectToolPlanResult {
  /** Ordered intent IDs that scored above zero. */
  intents: string[];
  /** Ordered tool IDs that every response includes (baseline ∪ matched). */
  coreTools: string[];
  /** Candidate tool IDs for downstream dedup / runtime filtering. */
  candidateToolIds: string[];
  /** Composio / Arcade toolkit scopes to ask the source for. */
  requestedToolkits: string[];
  /** Source fetch permissions derived from matched intents + auth gate. */
  sourcePermissions: SourcePermissions;
  /** Hard cap on the final merged list. */
  maxBudget: number;
  /** Per-intent breakdown for observability + tests. */
  reasons: IntentReason[];
  /** True when no intent scored > 0 and the baseline was used. */
  fallbackUsed: boolean;
  /** Total raw positive-intent matches before any trimming. */
  matchCount: number;
}

// ============================================================================
// Default baseline (NEVER "all capabilities")
// ============================================================================

/**
 * The minimum useful tool set for an arbitrary turn. Always present in
 * `coreTools` so the LLM is never stranded — but still small (4 tools),
 * not the full 91-capability catalogue. Read-only / low-cost tools only;
 * mutating tools (`file.write`, `file.str_replace`, …) are surface-gated
 * behind the `code.edit` intent so the LLM is not handed file-mutation
 * power on every turn. Maps to ALL_CAPABILITIES IDs in
 * `bing/web/lib/tools/capabilities.ts`.
 */
export const BASELINE_CORE_TOOL_IDS: ReadonlyArray<string> = [
  'file.read',
  'file.list',
  'file.delete',
  'web.fetch',
];

const DEFAULT_MAX_BUDGET = 20;
const DEFAULT_MAX_INTENTS = 8;
const EMPTY_PERMISSIONS: SourcePermissions = {
  arcade: false,
  composio: false,
  nullclaw: false,
  remoteMcp: false,
  mem0: false,
  mcpHttp: false,
};

// ============================================================================
// Intent rule table
// ============================================================================

interface IntentRule {
  /** Stable ID surfaced in `intents[]` + `reasons[]`. */
  id: string;
  /** Coarse category — influences ordering and grouping only. */
  category:
    | 'file'
    | 'web'
    | 'repo'
    | 'sandbox'
    | 'shell'
    | 'integration'
    | 'memory'
    | 'meta'
    | 'computer';
  /**
   * Single combined regex tested against the user's CURRENT turn AND each
   * history turn. Word boundaries (`\b`) required so 'a' doesn't match
   * 'aaa'. Case-insensitive (`/i`).
   */
  keywordsRegExp: RegExp;
  /**
   * Single combined regex tested against the current turn only. Match ⇒
   * score × `negativeMultiplier`. History is excluded from negation so a
   * past "don't browse" doesn't suppress a current explicit fetch request.
   */
  negativeRegExp: RegExp | null;
  /** Capability/tool IDs to add when this intent matches. */
  coreToolIds: ReadonlyArray<string>;
  /** Composio/Arcade toolkit scopes to request when this intent matches. */
  requestedToolkits: ReadonlyArray<string>;
  /** Permissions to flip on when this intent matches. */
  sourcePermissions: Partial<SourcePermissions>;
  /** Baseline score (multiplied by signal weights). Higher = ranks first. */
  weight: number;
  /** Whether the matched intent needs an authenticated user. */
  requiresAuth: boolean;
}

/**
 * Concrete intent table — 14 intents covering greeting, code work, web,
 * Git, running code, integration scopes, and meta inputs. Internal to
 * this module so the planner is the only test surface.
 */
const INTENT_RULES: ReadonlyArray<IntentRule> = [
  // Note: an explicit `chat.greeting` intent is INTENTIONALLY OMITTED.
  // A greeting-only turn ("hi", "thanks") should map to the baseline:
  // no extra core tools, no requested toolkits, no source permissions.
  // A `chat.greeting` intent that surfaced with `intents[] = ["chat.greeting"]`
  // would just be telemetry noise — it adds nothing to the plan. The
  // baseline already gives the model everything it needs to respond
  // conversationally.

  // ── Code reading ───────────────────────────────────────────────────────────
  {
    id: 'code.read',
    category: 'file',
    keywordsRegExp: /\b(?:show|read|open|view|cat|inspect|examine|review)\b[^.!?\n]{0,40}\b(?:file|code|src|module|class|function|method|component|.+\.[a-z0-9]{1,5})\b/i,
    negativeRegExp: null,
    coreToolIds: ['file.read', 'file.list', 'repo.search'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 10,
    requiresAuth: false,
  },

  // ── Code writing / editing ─────────────────────────────────────────────────
  {
    id: 'code.edit',
    category: 'file',
    keywordsRegExp: /\b(?:edit|modify|update|change|rewrite|refactor|patch|fix|implement|create|write|add|build|scaffold|rename)\b[^.!?\n]{0,60}\b(?:file|code|function|class|method|component|module|route|api|test|spec|.+\.[a-z0-9]{1,5})\b/i,
    negativeRegExp: /(?:^|\s)(?:don'?t|do\s+not|never|without|no)\s+(?:edit|modify|change|rewrite|update|refactor)\b/i,
    coreToolIds: ['file.write', 'file.str_replace', 'file.append', 'file.batch_write', 'code.ast_diff'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 12,
    requiresAuth: false,
  },

  // ── Code search ────────────────────────────────────────────────────────────
  {
    id: 'code.search',
    category: 'repo',
    keywordsRegExp: /\b(?:grep|search|find|locate|lookup|where\s+is|where\s+are|which)\b[^.!?\n]{0,60}\b(?:function|class|method|file|import|symbol|line|usage|definition|reference|codebase)\b|(?:^|\s)(?:grep|rg|ripgrep)\b/i,
    negativeRegExp: null,
    coreToolIds: ['repo.search', 'file.read', 'file.list', 'code.syntax_check'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 10,
    requiresAuth: false,
  },

  // ── Bash / shell ───────────────────────────────────────────────────────────
  {
    id: 'bash.run',
    category: 'shell',
    keywordsRegExp: /\b(?:bash|shell|command|cmd|exec(?:ute)?|run|script|cli|terminal|sh\s+-c|heredoc|cat\s+|ls\s+|cd\s+|mkdir\s+|rm\s+|chmod\s+)\b|(?:^|\s)(?:npm|pnpm|yarn|node|python3?|pip|poetry|cargo|go|java|gradle|mvn|make|cmake|eslint|tsc|vite|next|gatsby|webpack)[\s.][^\n.!?]*$/i,
    negativeRegExp: /(?:^|\s)(?:don'?t|do\s+not|never|without)\s+(?:run|execute|bash|shell|command)\b/i,
    coreToolIds: ['bash.execute', 'terminal.create_session', 'terminal.start_process'],
    requestedToolkits: [],
    sourcePermissions: { nullclaw: true },
    weight: 11,
    requiresAuth: false,
  },

  // ── Package install ────────────────────────────────────────────────────────
  {
    id: 'pkg.install',
    category: 'shell',
    keywordsRegExp: /\b(?:install|add|update|upgrade)\b[^.!?\n]{0,30}\b(?:package|dependency|library|module|pkg)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|update)\b|\bpip3?\s+install\b|\bpoetry\s+add\b/i,
    negativeRegExp: null,
    coreToolIds: ['bash.execute', 'sandbox.execute'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 13,
    requiresAuth: false,
  },

  // ── Tests / builds ─────────────────────────────────────────────────────────
  {
    id: 'build.test',
    category: 'sandbox',
    keywordsRegExp: /\b(?:run|execute|fire)\b[^.!?\n]{0,30}\b(?:tests?|spec|suite|build|pipeline|ci|lint)\b|\b(?:pytest|vitest|jest|mocha|playwright|cypress|rspec|minitest|cargo\s+test|go\s+test)\b|\b(?:tsc|webpack|esbuild|rollup|vite\s+build|next\s+build)\b/i,
    negativeRegExp: null,
    coreToolIds: ['bash.execute', 'sandbox.execute', 'terminal.start_process'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 11,
    requiresAuth: false,
  },

  // ── Git ops ────────────────────────────────────────────────────────────────
  {
    id: 'git.ops',
    category: 'repo',
    keywordsRegExp: /\b(?:git|commit|push|pull|merge|rebase|clone|checkout|branch|stash|stage|unstage|cherry-pick|blame)\b/i,
    negativeRegExp: null,
    coreToolIds: ['bash.execute', 'repo.git', 'file.read'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 10,
    requiresAuth: false,
  },

  // ── Container ops ──────────────────────────────────────────────────────────
  {
    id: 'container.ops',
    category: 'sandbox',
    keywordsRegExp: /\b(?:docker|podman|container|kubernetes|k8s|compose|dockerfile|kubectl)\b/i,
    negativeRegExp: null,
    coreToolIds: ['bash.execute', 'sandbox.session', 'sandbox.execute'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 11,
    requiresAuth: false,
  },

  // ── Web fetch / browse ─────────────────────────────────────────────────────
  {
    id: 'web.fetch',
    category: 'web',
    keywordsRegExp: /https?:\/\/[^\s)}\]]+|\b(?:fetch|scrape|crawl|retrieve|download|get|open|visit|browse|navigate\s+to)\b[^.!?\n]{0,40}\b(?:url|website|site|page|article|post|blog|doc|documentation|markdown|html|content|link)\b|\b(?:url|website|site|page|article|post|blog|doc|documentation|link)\b[^.!?\n]{0,40}\b(?:fetch|scrape|crawl|read|get|retrieve|visit)\b/i,
    negativeRegExp: /(?:^|\s)(?:don'?t|do\s+not|never|without|no)\s+(?:fetch|scrape|crawl|browse|visit|navigate|open)\b/i,
    coreToolIds: ['web.fetch', 'web.browse'],
    requestedToolkits: [],
    sourcePermissions: { arcade: true, nullclaw: true },
    weight: 18,
    requiresAuth: false,
  },

  // ── Web search ─────────────────────────────────────────────────────────────
  {
    id: 'web.search',
    category: 'web',
    keywordsRegExp: /\b(?:search|google|bing|ddg|duckduckgo|look\s*up|find\s+out)\b[^.!?\n]{0,40}\b(?:web|internet|online|google|bing|duckduckgo)\b|\b(?:web|google|bing|duckduckgo|internet)\s+(?:search|results)\b/i,
    negativeRegExp: /(?:^|\s)(?:don'?t|do\s+not|never|without)\s+(?:search|google|bing|look\s*up)\b/i,
    coreToolIds: ['web.search', 'web.fetch'],
    requestedToolkits: [],
    sourcePermissions: { arcade: true, nullclaw: true },
    weight: 14,
    requiresAuth: false,
  },

  // ── Explanation only (negative intent — explain / describe / read-only) ────
  {
    id: 'meta.explain',
    category: 'meta',
    keywordsRegExp: /\b(?:explain|describe|what\s+(?:is|are|does|do)|how\s+does|why\s+(?:is|does|are)|summarize|summary|overview|tell\s+me\s+about)\b/i,
    negativeRegExp: null,
    coreToolIds: ['file.read'],
    requestedToolkits: [],
    sourcePermissions: {},
    weight: 7,
    requiresAuth: false,
  },

  // ── Gmail (auth-gated integration) ─────────────────────────────────────────
  {
    id: 'integration.gmail',
    category: 'integration',
    keywordsRegExp: /\b(?:gmail|google\s+mail|email|e-?mail|send\s+(?:an?\s+)?(?:email|mail|message))\b|\b(?:inbox|inbox\s+of|messages?\s+from)\b/i,
    negativeRegExp: null,
    coreToolIds: [],
    requestedToolkits: ['gmail'],
    sourcePermissions: { composio: true, arcade: true },
    weight: 16,
    requiresAuth: true,
  },

  // ── Slack (auth-gated integration) ─────────────────────────────────────────
  {
    id: 'integration.slack',
    category: 'integration',
    keywordsRegExp: /\b(?:slack|post\s+to\s+slack|message\s+(?:a|the|my)?\s*(?:channel|workspace))\b/i,
    negativeRegExp: null,
    coreToolIds: [],
    requestedToolkits: ['slack'],
    sourcePermissions: { composio: true, arcade: true },
    weight: 16,
    requiresAuth: true,
  },

  // ── GitHub PR / issues (auth-gated integration) ────────────────────────────
  {
    id: 'integration.github',
    category: 'integration',
    keywordsRegExp: /\b(?:github|git\s*hub)\b[^.!?\n]{0,40}\b(?:pr|pull\s+request|issue|repository|repo|branch|review)\b|\b(?:open|create|comment\s+on|review)\b[^.!?\n]{0,20}\b(?:pr|pull\s+request|issue)\b/i,
    negativeRegExp: null,
    coreToolIds: [],
    requestedToolkits: ['github'],
    sourcePermissions: { composio: true, arcade: true },
    weight: 17,
    requiresAuth: true,
  },

  // ── Memory recall ──────────────────────────────────────────────────────────
  {
    id: 'memory.recall',
    category: 'memory',
    keywordsRegExp: /\b(?:remember|recall|earlier|previously|before|last\s+time|you\s+said|you\s+told\s+me|store\s+this|save\s+this)\b/i,
    negativeRegExp: null,
    coreToolIds: [],
    requestedToolkits: [],
    sourcePermissions: { mem0: true },
    weight: 9,
    requiresAuth: false,
  },

  // ── Computer-use (click / screenshot / desktop) ────────────────────────────
  {
    id: 'computer.use',
    category: 'computer',
    keywordsRegExp: /\b(?:click|screenshot|snapshot\s+(?:of|the\s+screen)|screen\s+(?:capture|shot)|press\s+(?:the\s+)?key|keyboard|clipboard|launch\s+(?:the\s+)?app|open\s+(?:the\s+)?app|window\s+list|list\s+apps|list\s+windows)\b/i,
    negativeRegExp: null,
    coreToolIds: [],
    requestedToolkits: [],
    sourcePermissions: { nullclaw: true },
    weight: 12,
    requiresAuth: false,
  },
];

// ============================================================================
// Scoring
// ============================================================================

interface IntentMatchResult {
  intent: string;
  score: number;
  weight: number;
  matchedSignals: string[];
  negatedSignals: string[];
}

function safeMatches(re: RegExp, text: string): RegExpMatchArray | null {
  // Reset lastIndex defensively — RegExp instances with /g would carry
  // state across calls when reused.
  re.lastIndex = 0;
  return re.test(text) ? re.exec(text) : null;
}

function scoreIntent(
  rule: IntentRule,
  currentTurn: string,
  historyTurns: ReadonlyArray<string>,
  agentTask: string,
  opts: Required<Omit<SelectToolPlanOptions, 'baselineCoreToolIds'>>,
): IntentMatchResult {
  let score = 0;
  const matchedSignals: string[] = [];
  const negatedSignals: string[] = [];

  // Current-turn positive match — full weight times rule baseline
  const currentHit = safeMatches(rule.keywordsRegExp, currentTurn);
  if (currentHit) {
    score += rule.weight * opts.currentTurnWeight;
    matchedSignals.push('current-turn');
  }

  // History positive matches — discounted
  for (let i = 0; i < historyTurns.length; i++) {
    if (safeMatches(rule.keywordsRegExp, historyTurns[i])) {
      score += rule.weight * opts.historyWeight;
      matchedSignals.push(`history[${i}]`);
    }
  }

  // Agent-task positive match — intermediate weight (between current
  // turn and history). Only meaningful for legacy callers that don't
  // yet expose a current-turn accessor; the active chat route does
  // NOT pass agentTask and continues to consume only currentTurn +
  // history as before.
  //
  // Item ② guard: agentTask scoring is strictly gated to fire ONLY when
  // the current turn is empty (or whitespace-only). This prevents a
  // unified-agent standing task ("review PRs daily") from bleeding into
  // every user turn ("write a function") and inflating the tool list
  // with artefacts the user did not ask for. When currentTurn is
  // non-empty, currentTurn + history carry the full signal — agentTask
  // is silently ignored.
  if (currentTurn.trim() === '' && agentTask && safeMatches(rule.keywordsRegExp, agentTask)) {
    score += rule.weight * opts.agentTaskWeight;
    matchedSignals.push('agent-task');
  }

  // Negative evidence — current turn only, applied to current score
  if (rule.negativeRegExp && safeMatches(rule.negativeRegExp, currentTurn)) {
    score *= opts.negativeMultiplier;
    negatedSignals.push('current-turn');
    // Capture match group for telemetry
    const m = rule.negativeRegExp.exec(currentTurn);
    if (m && m[0]) negatedSignals.push(`phrase:${m[0].trim().slice(0, 40)}`);
  }

  // Hard requirements (e.g. authenticated-only integrations)
  // Auth gate keeps score at 0 even on match.
  // We don't have direct access to input from inside scorer, so it's
  // applied in the outer scorer — see `applyAuthGate`.

  return {
    intent: rule.id,
    score,
    weight: rule.weight,
    matchedSignals,
    negatedSignals,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function extractHistoryTexts(
  history: SelectToolPlanInput['conversationHistory'],
): string[] {
  if (!history || history.length === 0) return [];
  const out: string[] = [];
  for (const turn of history) {
    if (!turn || typeof turn.content !== 'string') continue;
    // Trim + filter empty so weight noise doesn't accumulate
    const text = turn.content.trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

function isStringOrEmpty(input: string | undefined | null): string {
  if (typeof input !== 'string') return '';
  return input;
}

function uniqueOrdered<T>(items: Iterable<T>, key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function mergePermissions(parts: Array<Partial<SourcePermissions> | undefined>): SourcePermissions {
  const merged: SourcePermissions = { ...EMPTY_PERMISSIONS };
  for (const p of parts) {
    if (!p) continue;
    for (const k of Object.keys(p) as Array<keyof SourcePermissions>) {
      if (p[k]) merged[k] = true;
    }
  }
  return merged;
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Pure deterministic planner. See module header for design notes.
 */
export function selectToolPlan(
  input: SelectToolPlanInput,
  options: SelectToolPlanOptions = {},
): SelectToolPlanResult {
  const userMessage = isStringOrEmpty(input.userMessage);
  const agentTask = isStringOrEmpty(input.agentTask);
  const historyTurns = extractHistoryTexts(input.conversationHistory);

  const opts = {
    maxBudget: Math.max(1, options.maxBudget ?? DEFAULT_MAX_BUDGET),
    baselineCoreToolIds: options.baselineCoreToolIds ?? BASELINE_CORE_TOOL_IDS,
    currentTurnWeight: Math.max(0, options.currentTurnWeight ?? 1.0),
    historyWeight: Math.max(0, options.historyWeight ?? 0.4),
    agentTaskWeight: Math.max(0, options.agentTaskWeight ?? 0.6),
    // Item ⑤: default OFF so a future default-flip is a deliberate
    // migration, not a silent regression. Opt-in per call site.
    agentTaskUrlReadsEnabled: options.agentTaskUrlReadsEnabled ?? false,
    negativeMultiplier: clamp01(options.negativeMultiplier ?? 0),
    maxIntents: Math.max(1, options.maxIntents ?? DEFAULT_MAX_INTENTS),
  };

  // ── Per-intent scoring ────────────────────────────────────────────────────
  const scored: IntentMatchResult[] = [];
  for (const rule of INTENT_RULES) {
    const result = scoreIntent(rule, userMessage, historyTurns, agentTask, opts);
    scored.push(result);
  }

  // ── Auth gate ─────────────────────────────────────────────────────────────
  // Two-stage: (1) zero scores for rules that require auth so they cannot
  // match; (2) force `composio` permission off for unauthenticated callers
  // even when `configuredSources.composio === true` (Composio is always
  // auth-gated at the source-adapter layer, regardless of intent match).
  const authed = !!input.authenticated;
  const authBlocked: string[] = [];
  if (!authed) {
    for (let i = 0; i < scored.length; i++) {
      const rule = INTENT_RULES[i];
      if (rule.requiresAuth && scored[i].score > 0) {
        scored[i].score = 0;
        scored[i].matchedSignals.push('blocked:unauthenticated');
        authBlocked.push(rule.id);
      }
    }
  }

  // ── Sort + trim ───────────────────────────────────────────────────────────
  scored.sort((a, b) => {
    // Higher score first; tie-break on weight, then id (deterministic).
    if (b.score !== a.score) return b.score - a.score;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.intent.localeCompare(b.intent);
  });

  const topIntents = scored
    .filter((s) => s.score > 0)
    .slice(0, opts.maxIntents);

  const matchedRules = topIntents
    .map((s) => INTENT_RULES.find((r) => r.id === s.intent))
    .filter((r): r is IntentRule => Boolean(r));

  // ── Explicit signals boost core tools ─────────────────────────────────────
  // - A bare URL in the current turn strongly hints at web.fetch — but
  //   only when the web.fetch intent was NOT negatively-evidenced this
  //   turn. "do not browse https://x" should NOT add web.fetch.
  // Item ⑤: the agentTask halves of these explicit-signal detectors are
  // gated on `opts.agentTaskUrlReadsEnabled`. With the flag at its
  // default `false`, an agent-purpose URL (`agentTask` only) is ignored
  // and the explicit-signal boost fires only off `userMessage`. This
  // closes the audit-found "agent-purpose URLs bleeding into every
  // turn" leak. Setting the flag to `true` re-engages the agentTask
  // halves for callers that explicitly opt in.
  const urlMatch =
    /(https?:\/\/[^\s)}\]]+)/i.test(userMessage) ||
    (opts.agentTaskUrlReadsEnabled && !!agentTask && /(https?:\/\/[^\s)}\]]+)/i.test(agentTask));
  const explicitFileMatch =
    /[^\s]+\.[a-z0-9]{1,5}\b/i.test(userMessage) ||
    (opts.agentTaskUrlReadsEnabled && !!agentTask && /[^\s]+\.[a-z0-9]{1,5}\b/i.test(agentTask));
  const hasAttachedFile = !!(input.attachedFiles && input.attachedFiles.length > 0);
  // Detect negation before aggregating so we don't override it later.
  const webFetchNegated = (
    INTENT_RULES.find((r) => r.id === 'web.fetch')?.negativeRegExp ?? null
  )?.test(userMessage) ?? false;
  const webSearchNegated = (
    INTENT_RULES.find((r) => r.id === 'web.search')?.negativeRegExp ?? null
  )?.test(userMessage) ?? false;

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const allCoreIds = new Set<string>(opts.baselineCoreToolIds as string[]);
  const requestedToolkits = new Set<string>();
  const allCandidateIds = new Set<string>(opts.baselineCoreToolIds as string[]);
  // Seed source permissions from `configuredSources` — then enforce
  // auth-two-stage gate below so unauthenticated callers cannot pass
  // composio=true just because they listed it as configured.
  const allPermissions = mergePermissions([input.configuredSources]);
  if (!authed) {
    allPermissions.composio = false;
  }

  for (const rule of matchedRules) {
    for (const id of rule.coreToolIds) {
      allCoreIds.add(id);
      allCandidateIds.add(id);
    }
    for (const kit of rule.requestedToolkits) {
      requestedToolkits.add(kit);
    }
    allPermissions.arcade = allPermissions.arcade || !!rule.sourcePermissions.arcade;
    allPermissions.composio =
      (allPermissions.composio || !!rule.sourcePermissions.composio) && authed;
    allPermissions.nullclaw =
      allPermissions.nullclaw || !!rule.sourcePermissions.nullclaw;
    allPermissions.remoteMcp =
      allPermissions.remoteMcp || !!rule.sourcePermissions.remoteMcp;
    allPermissions.mem0 = allPermissions.mem0 || !!rule.sourcePermissions.mem0;
    allPermissions.mcpHttp =
      allPermissions.mcpHttp || !!rule.sourcePermissions.mcpHttp;
  }

  // Explicit-signal boosts. NOTE: each boost first checks whether the
  // corresponding intent was negatively-evidenced this turn. A bare URL
  // does not override "do not browse"; an explicit .tsx path does not
  // override "read only".
  if (urlMatch && !webFetchNegated) {
    allCoreIds.add('web.fetch');
    allCandidateIds.add('web.fetch');
    allPermissions.nullclaw = true;
  }
  // URL-signal arcade grant is GUARDED by BOTH web.search AND web.fetch
  // negation. Without the webFetchNegated check, "do not browse
  // https://..." would still open Arcade's web/browse catalog because
  // web.search's negation regex doesn't include "browse". Audit
  // finding: P0 planner leak on URL signal — fixed.
  if (urlMatch && !webSearchNegated && !webFetchNegated) {
    allPermissions.arcade = allPermissions.arcade || true;
  }
  if (hasAttachedFile || explicitFileMatch) {
    allCoreIds.add('file.read');
    allCandidateIds.add('file.read');
  }

  // Command-eligibility gate: only runs when caller explicitly sets
  // `filesystemEditEligible: false`. Default is "edits allowed" so the
  // baseline tool set is preserved when the caller does not opt in.
  // Strip mutating file tools but keep file.delete (destructive but
  // useful for cleanup) and the baseline read tools.
  if (input.filesystemEditEligible === false) {
    const STRIPPED = new Set([
      'file.write',
      'file.append',
      'file.str_replace',
      'file.batch_write',
      'code.ast_diff',
    ]);
    for (const id of [...allCoreIds]) {
      if (STRIPPED.has(id)) allCoreIds.delete(id);
    }
    for (const id of [...allCandidateIds]) {
      if (STRIPPED.has(id)) allCandidateIds.delete(id);
    }
  }

  // ── Deterministic ordering ────────────────────────────────────────────────
  const intents = matchedRules.map((r) => r.id);
  const coreTools = [...allCoreIds].sort();
  const candidateToolIds = [...allCandidateIds].sort();
  const requestedToolkitsOut = [...requestedToolkits].sort();

  // ── Reasons (for telemetry + tests) ───────────────────────────────────────
  const reasons: IntentReason[] = topIntents.map((s) => ({
    intent: s.intent,
    score: roundTo(s.score, 2),
    matchedSignals: s.matchedSignals.slice(),
    negatedSignals: s.negatedSignals.slice(),
    weight: s.weight,
  }));

  // If auth blocked some matches and the caller wants visibility, surface
  // them in `reasons` so dashboards can chart the gate effect.
  if (authBlocked.length > 0) {
    for (const blocked of authBlocked) {
      reasons.push({
        intent: blocked,
        score: 0,
        matchedSignals: ['blocked:unauthenticated'],
        negatedSignals: [],
        weight: INTENT_RULES.find((r) => r.id === blocked)?.weight ?? 0,
      });
    }
  }

  const matchCount = scored.filter((s) => s.score > 0).length;
  const fallbackUsed = matchCount === 0 && !urlMatch && !hasAttachedFile && !explicitFileMatch;

  return {
    intents,
    coreTools,
    candidateToolIds,
    requestedToolkits: requestedToolkitsOut,
    sourcePermissions: allPermissions,
    maxBudget: opts.maxBudget,
    reasons,
    fallbackUsed,
    matchCount,
  };
}

// ============================================================================
// Helpers (private)
// ============================================================================

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function roundTo(n: number, places: number): number {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

// ============================================================================
// Internal-only export — used by the test file to assert rule identities
// without leaking to the public package surface. Keep narrow.
// ============================================================================

/** @internal */
export const __INTERNAL_INTENT_RULE_IDS__ = INTENT_RULES.map((r) => r.id);
