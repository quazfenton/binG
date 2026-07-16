/**
 * Provider Rate Limit Tracker
 *
 * Tracks 429 Too Many Requests per provider at the process level.
 * On a single 429 response, the provider is added to the blacklist
 * so the chain's fallback iteration skips it on subsequent requests
 * (no need to retry a provider that just told us to back off).
 *
 * Mirrors the structure of provider-530-tracker.ts and
 * provider-server-error-tracker.ts so the three trackers can co-exist
 * without cross-wiping each other's counters.
 *
 * Threshold: BLACKLIST_THRESHOLD = 1 — a single 429 is definitive
 * enough to warrant immediate blacklist, unlike 530/5xx which can be
 * transient infrastructure issues that warrant a 2-strike tolerance.
 *
 * Audit reference: F3 (MCP-TOOL-SELECTION-POSTAUDIT remediation step).
 *
 * SHOULD-CONSIDER (#1 in code-review): once HTTP-level telemetry is
 * available, capture the `Retry-After` response header so the tracker
 * can TTL-clear the blacklist precisely when the provider's quota
 * bucket refills (eliminates need for a guess-based timer sweep).
 * Deferred to a separate ticket — TTL semantics drift between
 * providers (openrouter: 60s, anthropic: variable, etc.) and keeping
 * the F3 fix minimal coherent matches the audit's "smallest
 * remediation" tone.
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('ProviderRateLimitTracker');
const _consecutive429Count = new Map<string, number>();
// BLACKLIST_THRESHOLD=1 is intentional: a single 429 is more
// definitive than a transient 5xx/530 (which tolerates threshold=2).
const BLACKLIST_THRESHOLD = 1;

function isRateLimitError(error: any): boolean {
  if (typeof error === 'object' && error === null) return false;
  // Multi-shape detection. The production wire shape from
  // enhanced-api-client.ts:createAPIError writes `error.status = status`
  // at the top level — the primary path. AxiosError-shaped wrappers
  // (defense-in-depth for future migrations) expose the status at
  // `error.response.status`. Both are valid HTTP-error invariants; both
  // are checked so a future API-client refactor does NOT silently
  // bypass the rate-limit tracker.
  // Production wire shape from enhanced-api-client.ts:createAPIError writes
  // `error.status = status` at the top level (PRIMARY). AxiosError-shape wraps
  // the status at `error.response.status`. Native fetch rejections (Node 19+)
  // attach a wrapping Error with a `.cause` property, and many production
  // HTTP libraries bury the status one wrapping deeper. ALL of these
  // candidates are checked so a future API-client refactor does NOT silently
  // bypass the rate-limit tracker.
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
    error?.cause?.statusCode,
    error?.cause?.response?.status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && c === 429) return true;
  }
  const msg =
    typeof error === 'object' && error !== null && typeof error?.message === 'string'
      ? error.message
      : String(error ?? '');
  return /(?:429\b|too many requests\b|rate limit\b)/i.test(msg);
}

function recordRateLimitError(provider: string): void {
  const next = (_consecutive429Count.get(provider) ?? 0) + 1;
  _consecutive429Count.set(provider, next);
  if (next >= BLACKLIST_THRESHOLD) {
    log.warn(`[RateLimitTracker] Provider ${provider} blacklisted after ${next} rate-limit response(s)`);
  }
}

export function resetRateLimitCounter(provider: string): void {
  _consecutive429Count.delete(provider);
}

export function isRateLimitedBlacklisted(provider: string): boolean {
  return (_consecutive429Count.get(provider) ?? 0) >= BLACKLIST_THRESHOLD;
}

export function recordRateLimitedIfApplicable(
  provider: string,
  error: unknown,
): void {
  if (isRateLimitError(error)) {
    recordRateLimitError(provider);
  }
}

// Test-only export (used by vitest scenarios in __tests__/chat/).
// NOT for production use — clears the whole in-process rate-limit map.
export function _clearRateLimitMapForTest(): void {
  _consecutive429Count.clear();
}
