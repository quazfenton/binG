/**
 * role-reason-parser
 *
 * Tolerant parser for the `reason` free-text argument of `choose_role`.
 *
 * The system prompt (system-prompts-dynamic.ts CHOOSE_ROLE_DIRECTIVE v4)
 * asks the LLM to write:
 *   signal: <what fired in (a)/(b)/(c)>; expected: <what that role already does>
 *
 * But in production LLMs drift:
 *   - Drop keyword prefixes entirely
 *   - Swap colon for em-dash, hyphen, or whitespace separator
 *   - Replace `signal` / `expected` with synonyms like `trigger`, `because`, `will`
 *   - Or just write free-form English with a semicolon between two phrases
 *
 * Telemetry downstream needs structured `signal` / `expected` fields for
 * dashboards (a/b/c dimension frequency, role-pivot expectations).
 * Naive `reason.match(/signal[^\s]+\s+([^;]+)/)` fails on every variant
 * above — we'd lose most of the analytics signal.
 *
 * This parser aims for ALL of the following inputs to yield at least one
 * useful structured field:
 *
 * | Input                                                        | signal     | expected   | confidence |
 * |--------------------------------------------------------------|------------|------------|------------|
 * | "signal: x; expected: y"                                      | "x"        | "y"        | structured |
 * | "Signal — x; Expected — y"                                   | "x"        | "y"        | structured |
 * | "SIGNAL: x; EXPECTED: y"                                     | "x"        | "y"        | structured |
 * | "trigger: x; will: y"                                        | "x"        | "y"        | structured |
 * | "x; y"                                                       | "x"        | "y"        | partial    |
 * | "signal - x"                                                 | "x"        | null       | partial    |
 * | "expected: y" (no signal)                                    | null       | "y"        | partial    |
 * | "I need a debugger because of stack trace"                   | full text  | null       | freeform   |
 * | "" (empty input)                                             | null       | null       | freeform   |
 *
 * Confidence is a cheap field downstream dashboards can filter on
 * (`structured` rows are analytics-grade; `freeform` rows are fallbacks).
 */

export type RoleReasonConfidence = 'structured' | 'partial' | 'freeform';

export interface ParsedRoleReason {
  /** Trimmed original input. */
  raw: string;
  /**
   * Phrase 1: what fired in the (a) complexity / (b) domain / (c) recovery
   * dimensions. `null` only when the parser could not extract a phrase at
   * all (empty input or an expected-only input without separator context).
   */
  signal: string | null;
  /**
   * Phrase 2: what that role already does. `null` only when the input did
   * not contain a second phrase or expected-marker.
   */
  expected: string | null;
  /** True if the input contained a separator and was split into phrases. */
  wasSplit: boolean;
  /**
   * How confident the parser is in its structured extraction.
   * - `structured`: both keyword markers matched (case-insensitive, any separator).
   * - `partial`: at least one structured field extracted, but the schema is incomplete.
   * - `freeform`: no markers matched; whole input preserved on `signal`.
   */
  confidence: RoleReasonConfidence;
}

// ── Keyword sets ────────────────────────────────────────────────────────────

/**
 * Synonyms accepted as the "what fired" marker.
 * Lowercase only — matching is case-insensitive.
 */
const SIGNAL_KEYWORDS = [
  'signal',
  'trigger',
  'triggered',
  'because',
  'since',
  'reason',
  'fired',
  'why',
  'cause',
] as const;

/**
 * Synonyms accepted as the "what role does" marker.
 */
const EXPECTED_KEYWORDS = [
  'expected',
  'expectation',
  'expect',
  'will',
  'outcome',
  'should',
  'now',
  'goto', // escaped-class token, e.g. "goto: debugger" → expected
] as const;

// ── Separator regex atom ─────────────────────────────────────────────────────
//
// Supports: colon `:`, ASCII hyphen `-`, en-dash `–`, em-dash `—`,
// double-hyphen `--`, equals `=`, and a literal whitespace-then-dash
// variant like ` - ` / ` — `. Case-insensitive + unicode.

const SEP_ATOM =
  String.raw`(?:` +
  String.raw`:` +
  String.raw`|` +
  String.raw`\u2014` + // em-dash —
  String.raw`|` +
  String.raw`\u2013` + // en-dash –
  String.raw`|` +
  String.raw`-{1,2}` + // hyphen or double-hyphen
  String.raw`|` +
  String.raw`=` +
  String.raw`)`;

// `(?<![A-Za-z])` ensures we don't match a keyword inside another word
// (e.g. "signal" inside "signaled" is fine because we explicitly list
// the keyword, but "signaled" should not match as a `signal` prefix).

const KW_GROUP_S = `(?:${SIGNAL_KEYWORDS.join('|')})`;
const KW_GROUP_E = `(?:${EXPECTED_KEYWORDS.join('|')})`;

/**
 * Capture group 1 = phrase value AFTER the separator.
 * Anchored at the beginning of the string so the FIRST phrase's keyword
 * is consumed. Use `g` flag to find any subsequent matches.
 */
const SIGNAL_PREFIX_RE = new RegExp(
  String.raw`^\s*` + KW_GROUP_S + String.raw`\s*` + SEP_ATOM + String.raw`\s*(.+?)\s*$`,
  'iu',
);

/**
 * Capture group 1 = phrase value AFTER the separator. Loose (not anchored)
 * so it can match against any phrase within a multi-phrase input.
 */
const SIGNAL_LOOSE_RE = new RegExp(
  String.raw`(?<![A-Za-z])` + KW_GROUP_S + String.raw`\s*` + SEP_ATOM + String.raw`\s*(.+?)\s*$`,
  'iu',
);

const EXPECTED_LOOSE_RE = new RegExp(
  String.raw`(?<![A-Za-z])` + KW_GROUP_E + String.raw`\s*` + SEP_ATOM + String.raw`\s*(.+?)\s*$`,
  'iu',
);

/**
 * Separator that splits input into 2+ phrases when no keyword markers
 * are present. We intentionally do NOT split on every comma — many
 * reason strings are single comma-list sentences.
 */
const PHRASE_SPLIT_RE = /\s*[;\n]\s*/;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a free-text `reason` into structured `signal` and `expected`
 * fields plus a confidence label. Never throws — returns a sensible
 * `freeform` fallback for any input.
 */
export function parseRoleReason(raw: unknown): ParsedRoleReason {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      raw: '',
      signal: null,
      expected: null,
      wasSplit: false,
      confidence: 'freeform',
    };
  }

  // Detect implicit phrase boundary (semicolon / newline) even when no
  // keyword markers are present. Split into 2+ phrases when found.
  const phrases = trimmed.split(PHRASE_SPLIT_RE).filter((p) => p.length > 0);

  if (phrases.length >= 2) {
    // Multi-phrase input. Try to pair a marker on each phrase.
    const left = phrases[0];
    const right = phrases[1];
    // Bug #9 fix: surface the 3rd+ phrases that were being silently dropped.
    // Default: log a warning so operators can spot drift in production logs.
    // Tests / callers can suppress via `process.env.ROLE_REASON_SILENT_DROPS=true`.
    if (phrases.length > 2 && process.env.ROLE_REASON_SILENT_DROPS !== 'true') {
      console.warn(
        `[role-reason-parser] input has ${phrases.length} phrases; only first two are used for signal/expected. ` +
        `Extra phrase(s) (${phrases.length - 2}) appended to 'expected': ${phrases.slice(2).join(' | ')}`,
      );
    }

    const leftSignal = left.match(SIGNAL_PREFIX_RE) ?? left.match(SIGNAL_LOOSE_RE);
    const rightExpected = right.match(EXPECTED_LOOSE_RE);

    // STRUCTURED: both sides carry markers (this is the schema-compliant case).
    if (leftSignal && rightExpected) {
      return {
        raw: trimmed,
        signal: leftSignal[1].trim(),
        expected: rightExpected[1].trim(),
        wasSplit: true,
        confidence: 'structured',
      };
    }

    // PARTIAL-A: only signal marker — right phrase is the "expected" content
    // even though the marker is missing.
    if (leftSignal) {
      return {
        raw: trimmed,
        signal: leftSignal[1].trim(),
        expected: right.trim(),
        wasSplit: true,
        confidence: 'partial',
      };
    }

    // PARTIAL-B: only expected marker — left phrase is the "signal" content.
    if (rightExpected) {
      return {
        raw: trimmed,
        signal: left.trim(),
        expected: rightExpected[1].trim(),
        wasSplit: true,
        confidence: 'partial',
      };
    }

    // SEMI-SPLIT: no markers anywhere — assign by position. This is the
    // most common LLM drift: drops the keywords but keeps the semicolon.
    return {
      raw: trimmed,
      signal: left.trim(),
      expected: right.trim(),
      wasSplit: true,
      confidence: 'partial',
    };
  }

  // Single-phrase input. Look for a single marker.
  const singleSignal = trimmed.match(SIGNAL_PREFIX_RE) ?? trimmed.match(SIGNAL_LOOSE_RE);
  if (singleSignal) {
    return {
      raw: trimmed,
      signal: singleSignal[1].trim(),
      expected: null,
      wasSplit: false,
      confidence: 'partial',
    };
  }

  const singleExpected = trimmed.match(EXPECTED_LOOSE_RE);
  if (singleExpected) {
    return {
      raw: trimmed,
      signal: null,
      expected: singleExpected[1].trim(),
      wasSplit: false,
      confidence: 'partial',
    };
  }

  // FREEFORM: no markers, no separator. Preserve everything on `signal`
  // and leave `expected` null. Downstream dashboards filter confidence
  // 'freeform' rows separately so they don't pollute structured analytics.
  return {
    raw: trimmed,
    signal: trimmed,
    expected: null,
    wasSplit: false,
    confidence: 'freeform',
  };
}
