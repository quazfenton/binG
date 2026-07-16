/**
 * prompt-orchestrator/marker-scanner.ts
 *
 * Scans a target string for existing `[PO-INJECT ...]...[/PO-INJECT]` markers
 * and formats new markers. The scanner is the foundation of idempotency:
 * re-running a script on a target that already has matching markers is a
 * no-op.
 *
 * Marker format (byte-exact):
 *   Opening:  [PO-INJECT promptId="<id>" step="<step>" sha="<sha>" ts="<ts>" mode="<mode>"]
 *   Body:     <payload, may contain newlines and quotes>
 *   Closing:  [/PO-INJECT]
 *
 * Field values are quoted with `"` so they can contain spaces and most
 * special chars safely. The body is matched non-greedy until the next
 * `[/PO-INJECT]` closing tag.
 */
import type { InjectedMarker } from './types';

/**
 * Global regex with the `g` flag so we can iterate via `exec` in a loop.
 * Capture groups:
 *   1: promptId
 *   2: step
 *   3: sha
 *   4: ts
 *   5: mode
 *   6: body ([\s\S]*? non-greedy match)
 */
const PO_REGEX = /\[PO-INJECT promptId="([^"]+)" step="([^"]+)" sha="([^"]+)" ts="([^"]+)" mode="([^"]+)"\]([\s\S]*?)\[\/PO-INJECT\]/g;

/**
 * Scan `target` for all PO-INJECT markers. Returns markers in document order.
 * The scanner is purely read-only — it does not mutate the input.
 */
export function scanMarkers(target: string): InjectedMarker[] {
  const elements: InjectedMarker[] = [];
  if (!target) return elements;

  // Reset lastIndex (defensive — the `g` flag retains state across calls).
  PO_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PO_REGEX.exec(target)) !== null) {
    elements.push({
      promptId: match[1],
      step: match[2],
      sha: match[3],
      ts: match[4],
      mode: match[5],
      // Strip the leading/trailing newlines that formatMarker adds around the
      // payload (for human readability of the serialized marker block). The
      // captured `content` should be just the payload, not the newlines.
      content: match[6].replace(/^\n+|\n+$/g, ''),
      startIndex: match.index,
      endIndex: PO_REGEX.lastIndex,
    });
  }
  return elements;
}

/**
 * Format a single PO-INJECT marker block. The `ts` is generated at call time
 * (audit field, not part of the idempotency key). The caller is responsible
 * for computing `sha` (typically a SHA-256 of the payload) and passing it in.
 */
export function formatMarker(
  promptId: string,
  step: string,
  sha: string,
  mode: string,
  payload: string,
): string {
  // Guard: a payload containing the literal `[/PO-INJECT]` substring would
  // cause the scanner's non-greedy regex to close the marker early, splitting
  // one marker into two. Reject loudly rather than silently corrupting the
  // marker stream. Callers can split the payload into multiple steps or
  // remove the substring.
  if (payload.includes('[/PO-INJECT]')) {
    throw new Error(
      `[PromptOrchestrator] formatMarker: payload contains the literal substring '[/PO-INJECT]' which would split the marker. Remove the substring (or replace it with a different sentinel).`,
    );
  }
  const ts = Date.now().toString();
  return `[PO-INJECT promptId="${promptId}" step="${step}" sha="${sha}" ts="${ts}" mode="${mode}"]\n${payload}\n[/PO-INJECT]`;
}

/**
 * Build the idempotency key from a (promptId, step, sha) tuple. Used both
 * to scan existing markers and to skip already-injected steps.
 */
export function idempotencyKey(promptId: string, step: string, sha: string): string {
  return `${promptId}:${step}:${sha}`;
}
