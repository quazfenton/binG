/**
 * Tool-result sentinel — Layer 3 boundary sanitization.
 *
 * Wraps every `callMCPToolFromAI_SDK` return value in an explicit
 * `<|tool|>{...}</|tool|>` boundary sentinel before handing it back to
 * the LLM's next turn. Content matching common injection patterns is
 * STRIPPED inside the sentinel and the drop is logged with the
 * `(tool-call-id, matched-pattern)` pair for forensics.
 *
 * Design rationale:
 *   - The sentinel is a Layer 3 boundary (downstream of Layer 1 schema
 *     validation + Layer 2 orchestrator unwrap); it does NOT modify
 *     the existing return shape, only adds an outer wrapper. Callers'
 *     typed contracts are preserved.
 *   - Strips are conservative: a DROP is safer than a malformed
 *     `<|tool|>...</|tool|>` block leaking to the model.
 *   - Drops are LOGGED, never thrown — the LLM still gets a sentinel
 *     block (with a `_dropped: true` envelope flag) so downstream turns
 *     can observe the sanitization happened.
 */

import { randomUUID } from 'crypto';
import { stableStringify } from '@/lib/utils/canonical-json';

// ───── Sentinel shape constants ──────────────────────────────────────────────

export const TOOL_RESULT_SENTINEL_OPEN = '<|tool|>';
export const TOOL_RESULT_SENTINEL_CLOSE = '</|tool|>';

// ───── Injection-pattern registry ─────────────────────────────────────────────

/**
 * Patterns matched against the stringified tool result. Conservative:
 * covers the common prompt-injection families a malicious MCP tool
 * result can attempt to plant for the next LLM turn.
 *
 * Each pattern compiles once at module load. The names are the
 * forensics-log keys investigators search by.
 */
const INJECTION_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: 'ignore-previous-instructions', regex: /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|earlier|system|earlier)\s+(?:instructions?|prompts?|directives?|rules?)/i },
  { name: 'you-are-now', regex: /(?:you\s+are\s+now|from\s+now\s+on\s+you\s+(?:are|must)|act\s+as\s+if\s+you\s+are)/i },
  { name: 'system-role-marker', regex: /(?:system|assistant|user|tool)\s*:/i },
  { name: 'markdown-role-emulator', regex: /(?:```\s*(?:system|assistant|user|chat|conversation)|<\|\s*(?:im_start|im_end|endoftext|pad|ref|system)\s*\|>)/i },
  { name: 'system-prompt-leak', regex: /(?:my\s+(?:system|initial)\s+(?:prompt|instructions?)\s+(?:is|says|reads)|reveal\s+(?:your|the)\s+(?:system|initial)\s+(?:prompt|instructions?))/i },
];

// ───── Sentinel envelope ─────────────────────────────────────────────────────

/** Output wrapper returned by `wrapWithSentinel()`. */
export interface SentinelEnvelope<T = unknown> {
  /** The sentinel-marked container. */
  readonly raw: string;
  /** Sanitized inner result (with injection-pattern chars stripped). */
  readonly sanitized: T;
  /** Whether any drops happened during sanitization. */
  readonly dropped: boolean;
  /** Tool-call id (echoed back for cross-correlation). */
  readonly toolCallId: string;
  /** Forensics: list of (pattern-name, excerpt) pairs for every drop. */
  readonly drops: ReadonlyArray<{ pattern: string; excerpt: string }>;
}

// ───── Dropper ────────────────────────────────────────────────────────────────

/**
 * Replace every match of each registered pattern with a `[REDACTED:pattern]`
 * marker. Returned string is safe to embed in the sentinel envelope.
 *
 * Returns the drop list + the scrubbed string so the caller can log the
 * pattern matches for forensics.
 */
export function scrubInjectionPatterns(text: string): {
  scrubbed: string;
  drops: ReadonlyArray<{ pattern: string; excerpt: string }>;
} {
  const drops: Array<{ pattern: string; excerpt: string }> = [];
  let scrubbed = text;
  for (const { name, regex } of INJECTION_PATTERNS) {
    scrubbed = scrubbed.replace(regex, (match) => {
      // Keep a short excerpt for forensics — truncate to 80 chars to keep
      // the drop-line cheap to log.
      const excerpt = match.length > 80 ? match.slice(0, 77) + '...' : match;
      drops.push({ pattern: name, excerpt });
      return `[REDACTED:${name}]`;
    });
  }
  return { scrubbed, drops };
}

// ───── Public API ─────────────────────────────────────────────────────────────

/**
 * Wrap an MCP tool-result in `<|tool|>...</|tool|>` sentinel + scrub
 * injection patterns out of the stringified body. The returned
 * `SentinelEnvelope` carries the drops for forensics.
 *
 * String body: a stable JSON serialization of the tool result. The
 * sentinel markers themselves are NOT scrubbed — `scrubInjectionPatterns`
 * operates only on the inner body content.
 */
export function wrapWithSentinel(
  result: unknown,
  options?: {
    /** Optional caller-supplied tool-call id (default: synthetic UUID). */
    toolCallId?: string;
    /** Optional logger hook called once per drop for forensics. */
    onDrop?: (drop: { toolCallId: string; pattern: string; excerpt: string }) => void;
  },
): SentinelEnvelope {
  const toolCallId = options?.toolCallId ?? randomUUID();

  // 1. Stringify — stable JSON so the model sees a deterministic shape.
  //    stableStringify returns string | undefined (matches JSON.stringify
  //    for top-level undefined); coerce to '' as the sentinel body must
  //    be a string. The actual tool-result paths return objects/arrays,
  //    so the coalesce is a type-system guard, not a runtime fallback.
  const body = stableStringify(result) ?? '';
  // 2. Scrub injection patterns out of the body.
  const { scrubbed, drops } = scrubInjectionPatterns(body);

  // 3. Log every drop for forensics via the (optional) hook.
  if (options?.onDrop) {
    for (const drop of drops) {
      try {
        options.onDrop({ toolCallId, ...drop });
      } catch {
        // Logger errors must NOT break the sentinel wrap.
      }
    }
  }

  // 4. Compose the sentinel envelope.
  const raw = `${TOOL_RESULT_SENTINEL_OPEN}${scrubbed}${TOOL_RESULT_SENTINEL_CLOSE}`;
  return {
    raw,
    sanitized: safeParse(scrubbed),
    dropped: drops.length > 0,
    toolCallId,
    drops,
  };
}

// ───── Helpers ────────────────────────────────────────────────────────────────
// stableStringify is imported from @/lib/utils/canonical-json (single source
// of truth; mirrors JSON.stringify semantics for undefined/functions/Symbols).

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Sentinel-wrap is on a JSON.stringify output; if round-trip parsing
    // fails the body was a string (e.g. a tool returned a plain string).
    // Return the raw scrubbed string in that case so callers can observe
    // the body content.
    return text;
  }
}

// ───── Exported registry (for test introspection + future expansion) ─────────

export const REGISTERED_INJECTION_PATTERNS = INJECTION_PATTERNS.map((p) => p.name);
