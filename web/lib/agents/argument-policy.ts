/**
 * Tool argument RBAC — per-tool argument validation BEFORE runtime execution.
 *
 * Distinct from tool-name RBAC (which I did not implement; this module does
 * not gate `toolName === ...` — that's the tool-name RBAC layer). The
 * argument-policy layer gates the ARGUMENTS the LLM passes to the
 * approved tool name.
 *
 * Hard-reject semantics: when a policy rule fails, `validateArguments()`
 * returns `{ ok: false, reason }` and the runtime MUST NOT proceed. The
 * reason is returned to the orchestrator (NOT the model) — the LLM never
 * sees the hard-rejected attempt in a position where it can retry, since
 * the orchestrator surfaces the rejection as a `failure` tool-result that
 * the structured-error unwrap path (F1) translates into an actionable
 * ORCHESTRATOR-UNWRAP hint.
 *
 * Per-role override: a role name (e.g. 'admin', 'owner') may explicitly
 * DISABLE specific policy rules for tools whose semantics change for
 * trusted callers. The override map is consulted AFTER the default
 * policy — a missing override falls through to the default.
 */

// ───── Policy kinds (tagged union) ────────────────────────────────────────────

export type ArgumentPolicy =
  | {
      readonly kind: 'regex-block';
      readonly argName: string;
      /** Regex that, when matched against `args[argName]`, fails the gate. */
      readonly pattern: string;
      readonly reason: string;
      readonly compiled?: RegExp;
    }
  | {
      readonly kind: 'regex-allow';
      readonly argName: string;
      /** Regex that MUST match against `args[argName]`, else fail. */
      readonly pattern: string;
      readonly reason: string;
      readonly compiled?: RegExp;
    }
  | {
      readonly kind: 'format';
      readonly argName: string;
      /** E.g. 'https-url', 'absolute-path', 'email', 'semver'. */
      readonly format: 'https-url' | 'http-url' | 'absolute-path' | 'semver' | 'email';
      readonly reason: string;
    }
  | {
      readonly kind: 'range';
      readonly argName: string;
      readonly min?: number;
      readonly max?: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'length';
      readonly argName: string;
      readonly minChars?: number;
      readonly maxChars?: number;
      readonly reason: string;
    };

/**
 * A per-tool list of `ArgumentPolicy` rules. The runtime consults each rule
 * in order; first failure short-circuits.
 */
export interface ToolArgumentPolicy {
  readonly toolName: string;
  readonly policies: ReadonlyArray<ArgumentPolicy>;
}

/** A per-role override: disable a specific policy rule by stable id. */
export interface ArgumentPolicyOverride {
  readonly toolName: string;
  /** Stable id of the policy rule being overridden. Auto-derived if omitted. */
  readonly policyId?: string;
  readonly roleName: string;
  /** When `true`, the matched policy is SKIPPED for this role. */
  readonly disabled: boolean;
}

// ───── Default policy map — keyed by tool name ────────────────────────────────

function buildDefaultPolicies(): Map<string, ReadonlyArray<ArgumentPolicy>> {
  const m = new Map<string, ReadonlyArray<ArgumentPolicy>>();

  // bash_execute — block the obvious destructive / exfil patterns the user
  // listed explicitly. The patterns are intentionally permissive on shell
  // syntax but strict on the dangerous substrings.
  m.set('bash_execute', [
    {
      kind: 'regex-block',
      argName: 'command',
      pattern: '(?i)rm\\s+-rf',
      reason: 'bash_execute refuses recursive-force rm — use the dedicated file-delete tool for scoped removal.',
      compiled: /rm\s+-rf/i,
    },
    {
      kind: 'regex-block',
      argName: 'command',
      pattern: '(?i)curl[^|]*[|]',
      reason: 'bash_execute refuses curl piped to shell — fetch URLs via the dedicated fetch tool.',
      compiled: /curl[^|]*\|/i,
    },
    {
      kind: 'regex-block',
      argName: 'command',
      pattern: '(?i)wget\\s+.*-O-',
      reason: 'bash_execute refuses wget piped via -O- — fetch URLs via the dedicated fetch tool.',
      compiled: /wget\s+.*-O-/i,
    },
    {
      kind: 'length',
      argName: 'command',
      maxChars: 4096,
      reason: 'bash_execute command length capped at 4096 chars; route-long scripts through the file-write + apply_diff flow.',
    },
  ]);

  return m;
}

const DEFAULT_POLICIES: ReadonlyMap<string, ReadonlyArray<ArgumentPolicy>> =
  buildDefaultPolicies();

/**
 * Read-only registry accessor. Exported so tests + future admin UIs can
 * inspect the current default policy set without copy-pasting the above.
 */
export function getDefaultToolArgumentPolicies(): ReadonlyMap<
  string,
  ReadonlyArray<ArgumentPolicy>
> {
  return DEFAULT_POLICIES;
}

// ───── Per-role override registry ────────────────────────────────────────────

const ROLE_OVERRIDES: Map<string, ReadonlyArray<ArgumentPolicyOverride>> = new Map();

/**
 * Register a per-role override. The runtime reads this once at module
 * load; mutations mid-session are not supported (intentionally — RBAC
 * changes should be auditable via code-review, not runtime API).
 */
export function registerRoleOverride(override: ArgumentPolicyOverride): void {
  const list = ROLE_OVERRIDES.get(override.roleName) ?? [];
  ROLE_OVERRIDES.set(override.roleName, [...list, override]);
}

export function getRoleOverrides(roleName: string): ReadonlyArray<ArgumentPolicyOverride> {
  return ROLE_OVERRIDES.get(roleName) ?? [];
}

// ───── Validator — the runtime-enforced gate ────────────────────────────────

export type GateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly ruleIndex: number; readonly ruleKind: ArgumentPolicy['kind']; readonly argName: string };

/**
 * Validate `args` for `toolName` against the role-aware policy set.
 *
 * Returns `{ ok: true }` if every rule passes (or a rule was disabled by
 * the role's override). Returns `{ ok: false, reason }` on the first
 * failure — the runtime MUST NOT proceed.
 *
 * Pure: does not throw. Does not touch the network or filesystem.
 */
export function validateArguments(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  options?: { roleName?: string },
): GateResult {
  // Normalize known arg aliases so policies cannot be bypassed via alternate
  // parameter names. Comment #56: bash_execute accepts `code` as an alias for
  // `command`; without this normalization, `{ code: 'rm -rf /' }` evades every
  // rule keyed on `argName: 'command'`.
  let effectiveArgs = args;
  if (toolName === 'bash_execute' && args.code !== undefined && args.command === undefined) {
    effectiveArgs = { ...args, command: args.code };
  }

  const policies = DEFAULT_POLICIES.get(toolName);
  if (!policies || policies.length === 0) return { ok: true };

  const overrides = options?.roleName ? getRoleOverrides(options.roleName) : [];
  // Build a quick lookup: toolName × policyIndex → disabled?
  const disabledByIndex = new Set<number>();
  for (const o of overrides) {
    if (o.toolName !== toolName || !o.disabled) continue;
    // Match by stable id when supplied, else fall back to index-based
    // resolve: the caller's override MUST use index-based resolution
    // unless they explicitly copy the policy id.
    const idx = o.policyId
      ? policies.findIndex((p) => stablePolicyId(toolName, p) === o.policyId)
      : -1;
    if (idx >= 0) disabledByIndex.add(idx);
  }

  for (let i = 0; i < policies.length; i++) {
    if (disabledByIndex.has(i)) continue;
    const policy = policies[i];
    const argValue = effectiveArgs[policy.argName];
    const verdict = checkOne(policy, argValue);
    if (!verdict.ok) {
      const failureMsg = (verdict as Extract<ReturnType<typeof checkOne>, { ok: false }>).message;
      return {
        ok: false,
        reason: `${failureMsg} [tool=${toolName} arg=${policy.argName} rule=${policy.kind}]`,
        ruleIndex: i,
        ruleKind: policy.kind,
        argName: policy.argName,
      };
    }
  }
  return { ok: true };
}

function checkOne(
  policy: ArgumentPolicy,
  argValue: unknown,
): { ok: true } | { ok: false; message: string } {
  if (policy.kind === 'regex-block') {
    const text = stringifyForRegex(argValue);
    const regex = policy.compiled ?? new RegExp(policy.pattern);
    if (text && regex.test(text)) {
      return { ok: false, message: policy.reason };
    }
    return { ok: true };
  }
  if (policy.kind === 'regex-allow') {
    const text = stringifyForRegex(argValue);
    const regex = policy.compiled ?? new RegExp(policy.pattern);
    if (!text || !regex.test(text)) {
      return { ok: false, message: policy.reason };
    }
    return { ok: true };
  }
  if (policy.kind === 'format') {
    const text = stringifyForFormat(argValue);
    if (!text) return { ok: false, message: policy.reason };
    const ok = matchesFormat(policy.format, text);
    if (!ok) return { ok: false, message: policy.reason };
    return { ok: true };
  }
  if (policy.kind === 'range') {
    const rp = policy as Extract<ArgumentPolicy, { kind: 'range' }>;
    const n = typeof argValue === 'number' ? argValue : Number(argValue);
    if (!Number.isFinite(n)) return { ok: false, message: rp.reason };
    if (rp.min !== undefined && n < rp.min) return { ok: false, message: rp.reason };
    if (rp.max !== undefined && n > rp.max) return { ok: false, message: rp.reason };
    return { ok: true };
  }
  if (policy.kind === 'length') {
    const lp = policy as Extract<ArgumentPolicy, { kind: 'length' }>;
    const text = stringifyForRegex(argValue);
    const n = text ? text.length : 0;
    if (lp.minChars !== undefined && n < lp.minChars) {
      return { ok: false, message: lp.reason };
    }
    if (lp.maxChars !== undefined && n > lp.maxChars) {
      return { ok: false, message: lp.reason };
    }
    return { ok: true };
  }
  return { ok: true };
}

// ───── Format matchers (pure) ────────────────────────────────────────────────

function matchesFormat(
  format: 'https-url' | 'http-url' | 'absolute-path' | 'semver' | 'email',
  value: string,
): boolean {
  switch (format) {
    case 'https-url':
      return /^https:\/\/[\w.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value);
    case 'http-url':
      return /^https?:\/\/[\w.-]+(?::\d+)?(?:\/[^\s]*)?$/i.test(value);
    case 'absolute-path':
      return /^(\/|[A-Za-z]:\\|\~\/)/.test(value);
    case 'semver':
      return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}

function stringifyForRegex(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function stringifyForFormat(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

export function stablePolicyId(toolName: string, policy: ArgumentPolicy): string {
  // Switch on `policy.kind` so TS control-flow narrows the discriminated
  // union correctly. A chained `'prop' in policy` ternary does NOT narrow
  // across multiple `?:` branches in the project's tsc, so we explicitly
  // branch per variant and read only its own fields.
  let tail: string;
  switch (policy.kind) {
    case 'regex-block':
    case 'regex-allow':
      tail = `${policy.kind}|${policy.argName}|${policy.pattern}`;
      break;
    case 'format':
      tail = `${policy.kind}|${policy.argName}|${policy.format}`;
      break;
    case 'range':
      tail = `${policy.kind}|${policy.argName}|${policy.min ?? ''}-${policy.max ?? ''}`;
      break;
    case 'length':
      tail = `${policy.kind}|${policy.argName}|${policy.minChars ?? ''}-${policy.maxChars ?? ''}`;
      break;
  }
  return `${toolName}::${tail}`;
}
