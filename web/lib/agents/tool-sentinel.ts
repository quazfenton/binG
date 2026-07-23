// Task #1 (production wiring) — tool-sentinel.ts
// Wraps MCP tool results in <|tool|><|/tool|> sentinels before returning
// to the LLM context. Drops known prompt-injection patterns via regex
// audit (log every drop with toolCallId + matched pattern for forensics).
//
// Sentinel format:
//
//   <|tool|>...result content...\n// <|/tool|>
//
// Pattern matches cover:
//   - direct instruction-injection: "ignore previous instructions"
//   - role-marker prefix emulation: "system:", "assistant:", "human:"
//   - chat-template role tags: <|im_start|>, <|im_end|>
//   - markdown role-emulator: **Role:** system
//
// Every contract-driven call uses stableStringify (lib/utils/canonical-json.ts)
// to canonicalize the result before sentinel-wrapping, so audit-log entries
// are byte-comparable across runs.

import { stableStringify } from '@/lib/utils/canonical-json';

export const TOOL_SENTINEL_OPEN = '<|tool|>';
export const TOOL_SENTINEL_CLOSE = '<|/tool|>';

/**
 * Pattern set: drop matches return the matched pattern source to the audit log
 * via the onDrop callback. Each pattern is anchored or explicit so false
 * positives on legitimate "system" / "assistant" prose in tool output are
 * minimized.
 */
export const DROP_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?)/i,
  /^\s*disregard\b/i,
  /^\s*forget\s+(everything|all|the\s+previous)/i,
  /^\s*(you\s+are\s+now|act\s+as)\b/i,
  /^\s*(new\s+instructions|new\s+system\s+prompt)\s*:/im,
  /^system\s*:\s/im,
  /^assistant\s*:\s/im,
  /^human\s*:\s/im,
  /^user\s*:\s/im,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /BEGIN\s+SYSTEM\s+PROMPT/i,
  /END\s+SYSTEM\s+PROMPT/i,
  /^\s*\*\*Role:\*\*\s*(system|assistant|human)\b/im,
];

export interface SentinelDrop {
  /** The matched pattern source (.source from RegExp) */
  readonly pattern: string;
  /** A short excerpt (max 80 chars) of the matched content for forensics */
  readonly excerpt: string;
}

export interface SentinelWrapOptions {
  /** Stable identifier for this tool call — propagated to audit entries */
  readonly toolCallId: string;
  /** Called once per dropped pattern. Receives the pattern source, full content, toolCallId */
  readonly onDrop?: (pattern: string, content: string, toolCallId: string) => void;
}

export interface SentinelWrapResult {
  /** The sentinel-wrapped content (or sentinel-only if input was empty) */
  readonly wrapped: string;
  /** Patterns that fired (audit-trail evidence for the drop decision) */
  readonly dropped: ReadonlyArray<SentinelDrop>;
}

/**
 * Wrap a tool result in <|tool|>...<|/tool|> sentinel + drop patterns.
 *
 * @param result  The tool's raw result. Strings are passed through verbatim;
 *                other shapes are stableStringify'd for canonical representation.
 * @param options Sentinel configuration + drop callback
 */
export function wrapWithSentinel(
  result: unknown,
  options: SentinelWrapOptions,
): SentinelWrapResult {
  // Canonicalize non-string shapes for byte-comparable audit entries.
  const raw =
    typeof result === 'string'
      ? result
      : result === undefined
        ? ''
        : stableStringify(result);

  // Empty result → emit bare sentinel (LLM knows nothing came back).
  if (!raw) {
    return { wrapped: `${TOOL_SENTINEL_OPEN}${TOOL_SENTINEL_CLOSE}`, dropped: [] };
  }

  const dropped: SentinelDrop[] = [];
  let cleaned = raw;

  for (const pattern of DROP_PATTERNS) {
    if (pattern.test(cleaned)) {
      const excerpt = cleaned.length > 80 ? cleaned.slice(0, 80) + '...' : cleaned;
      dropped.push({ pattern: pattern.source, excerpt });
      // Notify audit chain (Contract audit log appends the drop event).
      options.onDrop?.(pattern.source, cleaned, options.toolCallId);
    }
  }

  // Replace dropped-pattern matches with [REDACTED] in the wrapped output —
  // preserves the rest of the content for legitimate tool data that just
  // happened to mention a system role inline.
  for (const pattern of DROP_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    cleaned = cleaned.replace(globalPattern, '[REDACTED]');
  }

  cleaned = cleaned.split(TOOL_SENTINEL_OPEN).join('[ESCAPED-TOOL-OPEN]')
    .split(TOOL_SENTINEL_CLOSE).join('[ESCAPED-TOOL-CLOSE]');

  return {
    wrapped: `${TOOL_SENTINEL_OPEN}${cleaned}${TOOL_SENTINEL_CLOSE}`,
    dropped,
  };
}

/**
 * Drop-passthrough helper for callers that only need a wrapped string (no
 * audit-driven onDrop hook). Equivalent to wrapWithSentinel(result, { toolCallId: '<inline>' }).
 */
export function wrapPlain(result: unknown): string {
  return wrapWithSentinel(result, { toolCallId: '<inline>' }).wrapped;
}
