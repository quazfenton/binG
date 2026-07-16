/**
 * Contract type — typed SOW (Statement of Work) frame for a tool-execution round.
 *
 * Each Contract is built once at the start of a turn (or sub-task), hash-pinned
 * via sha256, and used as the SURROUNDING FRAME for selectToolPlan + MCP
 * execution. Every tool call emits an immutable audit line; invariants run
 * pre- AND post-tool-call; kill-switches are RUNTIME-ENFORCED via the
 * `isKillSwitchTriggered()` helper.
 *
 * Field set mirrors the user-supplied SOW sketch:
 *   - intent              : prose user intent (string)
 *   - scope               : { paths: string[]; exclude: string[] }
 *   - capabilities        : string[] of capability IDs (from selectToolPlan)
 *   - budget              : { tokens: number; ms: number; ops: number }
 *   - invariants          : Array<{ preToolCall?: Check; postToolCall?: Check }>
 *   - acceptanceCriteria  : Assertion[]
 *   - killSwitches        : TimestampTrigger | RegexTrigger | ErrorCountTrigger (tagged union)
 *   - escalationGraph     : { onToolFailure?: ...; onStall?: ...; onBudgetExceeded?: ... }
 *   - contractHash        : sha256 hex of (intent+scope+capabilities+budget+invariants+
 *                            acceptanceCriteria+killSwitches+escalationGraph) — NOT audit
 *   - audit               : append-only log of AuditLine (immutable push only)
 */

import { createHash, randomUUID } from 'crypto';

// ───── Types ─────────────────────────────────────────────────────────────────

export interface ContractScope {
  /** Allowed filesystem paths. */
  paths: ReadonlyArray<string>;
  /** Forbidden subpaths (substring match). */
  exclude: ReadonlyArray<string>;
}

export interface ContractBudget {
  /** Cumulative tokens allowed across all tool calls in this round. */
  tokens: number;
  /** Wall-clock milliseconds allowed across all tool calls. */
  ms: number;
  /** Cumulative tool-call count allowed. */
  ops: number;
}

export interface ContractInvariantCheck {
  /** Human-readable name (e.g. "file-size-ok"). */
  readonly name: string;
  /**
   * Pure predicate. Receives the tool-call descriptor (name + args + result
   * for post-call). MUST be referentially transparent; no I/O.
   */
  readonly predicate: (ctx: {
    readonly toolName: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly result?: unknown;
    readonly previousCalls: ReadonlyArray<AuditLine>;
  }) => boolean;
  /** Failure-mode error message returned when predicate returns false. */
  readonly failureMessage: string;
}

export interface ContractInvariant {
  /** Optional: runs before the tool call. */
  readonly preToolCall?: ContractInvariantCheck;
  /** Optional: runs after the tool call. */
  readonly postToolCall?: ContractInvariantCheck;
}

export interface ContractAssertion {
  readonly id: string;
  readonly description: string;
  /** Evaluated against the post-round audit log; returns true on success. */
  readonly evaluate: (audit: ReadonlyArray<AuditLine>) => boolean;
}

// ───── Kill-switches (tagged union, runtime-enforced) ───────────────────────

export type KillSwitch =
  | {
      readonly kind: 'timestamp';
      readonly id: string;
      /**
       * Absolute Unix-ms deadline. When `Date.now() >= expiresAt`, the
       * runtime MUST abort the in-flight tool call + escalate per
       * `escalationGraph.onBudgetExceeded`.
       */
      readonly expiresAt: number;
    }
  | {
      readonly kind: 'regex';
      readonly id: string;
      readonly pattern: string;
      /**
       * The flag's compiled source for matching against the TOOL CALL's
       * concatenated `name + JSON(args) + JSON(result)` string. A match
       * triggers an immediate stop + escalate per the matched failure
       * branch in `escalationGraph.onToolFailure`.
       */
      readonly compiled: RegExp;
    }
  | {
      readonly kind: 'error-count';
      readonly id: string;
      /** Fail when >= this many tool errors have accumulated since contract start. */
      readonly maxErrors: number;
    };

// ───── Escalation graph ──────────────────────────────────────────────────────

export type EscalationAction =
  | { readonly kind: 'abort'; readonly reason: string }
  | { readonly kind: 'retry'; readonly maxRetries: number }
  | { readonly kind: 'escalate-to-human'; readonly message: string }
  | { readonly kind: 'switch-provider'; readonly fallbackProvider: string };

export interface ContractEscalationGraph {
  readonly onToolFailure?: EscalationAction;
  readonly onStall?: EscalationAction;
  readonly onBudgetExceeded?: EscalationAction;
}

// ───── Audit append-only log ─────────────────────────────────────────────────

export interface AuditLine {
  /** Monotonically-increasing per-contract index (0, 1, 2, ...). */
  readonly seq: number;
  /** Wall-clock ms at append time. */
  readonly at: number;
  /** The tool name that was dispatched. */
  readonly toolName: string;
  /** Tool call id (caller-supplied UUID for cross-correlation). */
  readonly toolCallId: string;
  /** Optional result hash (sha256 of result JSON) — keeps audit cheap. */
  readonly resultHash?: string;
  /** Notes: invariant pass/fail, kill-switch trigger, sentinel drop, RBAC reject. */
  readonly note?: string;
  /** Cached flag: did the run-time enforce a kill-switch on this call? */
  readonly halted?: boolean;
}

export interface AuditLog {
  readonly lines: ReadonlyArray<AuditLine>;
  /**
   * PURE append — returns a NEW AuditLog with `line` added at the end.
   * The underlying array is treated as immutable; never mutate in place.
   */
  append(line: Omit<AuditLine, 'seq' | 'at'>): AuditLog;
}

// ───── Contract — top-level value ────────────────────────────────────────────

export interface Contract {
  /** Stable per-contract UUID (independent of hash). */
  readonly id: string;
  readonly intent: string;
  readonly scope: ContractScope;
  readonly capabilities: ReadonlyArray<string>;
  readonly budget: ContractBudget;
  readonly invariants: ReadonlyArray<ContractInvariant>;
  readonly acceptanceCriteria: ReadonlyArray<ContractAssertion>;
  readonly killSwitches: ReadonlyArray<KillSwitch>;
  readonly escalationGraph: ContractEscalationGraph;
  readonly contractHash: string;
  readonly audit: AuditLog;
}

// ───── sha256 contractHash (canonical JSON, sorted keys, no audit) ────────────

/** Stable JSON serializer: sorts keys at every depth. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}

/**
 * Compute the sha256 hex of the contract payload — but EXCLUDE the audit log
 * (audit mutates per tool call; including it would invalidate the hash on
 * every append and the would-be invariant detector).
 */
export function computeContractHash(
  payload: Omit<Contract, 'id' | 'contractHash' | 'audit'>,
): string {
  const material = {
    intent: payload.intent,
    scope: payload.scope,
    capabilities: [...payload.capabilities].sort(),
    budget: payload.budget,
    invariants: payload.invariants,
    acceptanceCriteria: payload.acceptanceCriteria,
    killSwitches: payload.killSwitches,
    escalationGraph: payload.escalationGraph,
  };
  return createHash('sha256').update(stableStringify(material)).digest('hex');
}

// ───── Audit log factory ──────────────────────────────────────────────────────

export function createAuditLog(): AuditLog {
  const lines: AuditLine[] = [];
  return {
    get lines() {
      return lines;
    },
    append(line) {
      const next: AuditLine = {
        seq: lines.length,
        at: Date.now(),
        toolName: line.toolName,
        toolCallId: line.toolCallId,
        resultHash: line.resultHash,
        note: line.note,
        halted: line.halted,
      };
      return createAuditLogWith([...lines, next]);
    },
  };
}

function createAuditLogWith(initial: ReadonlyArray<AuditLine>): AuditLog {
  const lines = [...initial];
  return {
    get lines() {
      return lines;
    },
    append(line) {
      const next: AuditLine = {
        seq: lines.length,
        at: Date.now(),
        toolName: line.toolName,
        toolCallId: line.toolCallId,
        resultHash: line.resultHash,
        note: line.note,
        halted: line.halted,
      };
      return createAuditLogWith([...lines, next]);
    },
  };
}

// ───── createContract — the constructor ───────────────────────────────────────

export interface ContractInit
  extends Omit<Contract, 'id' | 'contractHash' | 'audit'> {
  /** Optional pre-set id (e.g. for replay determinism in tests). */
  id?: string;
}

export function createContract(init: ContractInit): Contract {
  const id = init.id ?? randomUUID();
  const audit = createAuditLog();
  const contractHash = computeContractHash({
    intent: init.intent,
    scope: init.scope,
    capabilities: init.capabilities,
    budget: init.budget,
    invariants: init.invariants,
    acceptanceCriteria: init.acceptanceCriteria,
    killSwitches: init.killSwitches,
    escalationGraph: init.escalationGraph,
  });
  return {
    id,
    intent: init.intent,
    scope: init.scope,
    capabilities: init.capabilities,
    budget: init.budget,
    invariants: init.invariants,
    acceptanceCriteria: init.acceptanceCriteria,
    killSwitches: init.killSwitches,
    escalationGraph: init.escalationGraph,
    contractHash,
    audit,
  };
}

// ───── Invariant runner ──────────────────────────────────────────────────────

export type InvariantRunResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failedCheckName: string; readonly message: string };

/**
 * Run pre- or post-tool-call invariants. Returns the first failing check
 * (subsequent checks are skipped — fail-fast contract).
 */
export function runInvariants(
  contract: Contract,
  phase: 'pre' | 'post',
  ctx: {
    readonly toolName: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly result?: unknown;
  },
): InvariantRunResult {
  for (const inv of contract.invariants) {
    const check = phase === 'pre' ? inv.preToolCall : inv.postToolCall;
    if (!check) continue;
    const ok = check.predicate({
      toolName: ctx.toolName,
      args: ctx.args,
      result: ctx.result,
      previousCalls: contract.audit.lines,
    });
    if (!ok) {
      return { ok: false, failedCheckName: check.name, message: check.failureMessage };
    }
  }
  return { ok: true };
}

// ───── Kill-switch runtime check ─────────────────────────────────────────────

export type KillSwitchTrigger =
  | { readonly id: string; readonly kind: 'timestamp'; readonly firedAt: number }
  | { readonly id: string; readonly kind: 'regex'; readonly matched: string }
  | { readonly id: string; readonly kind: 'error-count'; readonly errorCount: number };

/**
 * Runtime-enforced kill-switch check. Returns the FIRST triggered switch.
 * The runtime MUST call this BEFORE dispatching every tool call + again
 * AFTER every tool result.
 */
export function isKillSwitchTriggered(
  contract: Contract,
  ctx: {
    /** For regex switches: the string to match against (e.g. tool call + result). */
    readonly matchString?: string;
    /** For error-count switches: the current accumulated error count. */
    readonly errorCount: number;
  },
): KillSwitchTrigger | null {
  const now = Date.now();
  for (const ks of contract.killSwitches) {
    if (ks.kind === 'timestamp') {
      if (now >= ks.expiresAt) {
        return { id: ks.id, kind: 'timestamp', firedAt: now };
      }
    } else if (ks.kind === 'regex') {
      const target = ctx.matchString ?? '';
      if (ks.compiled.test(target)) {
        return { id: ks.id, kind: 'regex', matched: target };
      }
    } else if (ks.kind === 'error-count') {
      if (ctx.errorCount >= ks.maxErrors) {
        return { id: ks.id, kind: 'error-count', errorCount: ctx.errorCount };
      }
    }
  }
  return null;
}

// ───── Escalation resolver ───────────────────────────────────────────────────

export function resolveEscalation(
  contract: Contract,
  trigger: KillSwitchTrigger,
  failureKind: 'tool-failure' | 'stall' | 'budget',
): EscalationAction {
  const branch =
    failureKind === 'tool-failure'
      ? contract.escalationGraph.onToolFailure
      : failureKind === 'stall'
      ? contract.escalationGraph.onStall
      : contract.escalationGraph.onBudgetExceeded;
  if (branch) return branch;
  return { kind: 'abort', reason: `kill-switch ${trigger.id} fired (${failureKind})` };
}

// ───── Convenience: validate + run a single tool call inside a contract ──────

export interface GateResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly trigger?: KillSwitchTrigger;
}

/**
 * Combine pre-tool-call invariants + kill-switch check. The runtime should
 * call `gate()` BEFORE dispatch; if `allowed === false`, the runtime must
 * NOT call the tool — instead append an audit line + invoke `resolveEscalation`.
 */
export function gatePreCall(
  contract: Contract,
  ctx: { readonly toolName: string; readonly args: Readonly<Record<string, unknown>>; readonly errorCount: number },
): GateResult {
  const invariant = runInvariants(contract, 'pre', ctx);
  if (!invariant.ok) {
    const failure = invariant as Extract<InvariantRunResult, { ok: false }>;
    return { allowed: false, reason: `pre-invariant failed: ${failure.message}` };
  }
  const ks = isKillSwitchTriggered(contract, {
    matchString: JSON.stringify({ name: ctx.toolName, args: ctx.args }),
    errorCount: ctx.errorCount,
  });
  if (ks) {
    return { allowed: false, reason: `kill-switch ${ks.id} pre-call`, trigger: ks };
  }
  return { allowed: true };
}

export function gatePostCall(
  contract: Contract,
  ctx: {
    readonly toolName: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly result: unknown;
    readonly errorCount: number;
  },
): GateResult {
  const invariant = runInvariants(contract, 'post', ctx);
  if (!invariant.ok) {
    const failure = invariant as Extract<InvariantRunResult, { ok: false }>;
    return { allowed: false, reason: `post-invariant failed: ${failure.message}` };
  }
  const ks = isKillSwitchTriggered(contract, {
    matchString: JSON.stringify({ name: ctx.toolName, args: ctx.args, result: ctx.result }),
    errorCount: ctx.errorCount,
  });
  if (ks) {
    return { allowed: false, reason: `kill-switch ${ks.id} post-call`, trigger: ks };
  }
  return { allowed: true };
}
