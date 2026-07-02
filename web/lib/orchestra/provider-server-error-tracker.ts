
/**
 * Provider Server Error Tracker (PR-D)
 *
 * Tracks consecutive `5xx` HTTP server-side errors — specifically
 * 500 (Internal Server Error), 502 (Bad Gateway), 503 (Service
 * Unavailable), and 504 (Gateway Timeout) — per provider at the
 * process level. When a provider hits `SERVER_ERROR_BLACKLIST_THRESHOLD`
 * consecutive server errors (default 2, tunable via env), it is
 * blacklisted for the remainder of the process lifetime.
 *
 * This tracker is **parallel to** (not a replacement for)
 * `provider-530-tracker.ts`. The 530 tracker continues to count only
 * Cloudflare 530 / 1016 / tunnel-DNS errors, which are *origin
 * unreachable* signatures distinct from generic 5xx. Wiring both
 * trackers side-by-side at every provider call site lets the system
 * skip a provider whether it is dead on the tunnel side (530) or
 * returning generic 5xx (500/502/503/504) — without conflating the
 * two failure modes in a single counter.
 *
 * Reset conditions:
 *   - PR-D opt-in success reset: when
 *     `ENABLE_SERVER_ERROR_RESET_ON_SUCCESS=1` is set, a successful
 *     round-trip calls `maybeResetServerErrorOnSuccess(provider)`,
 *     clearing the counter immediately on the next successful call
 *     rather than waiting for a subsequent non-server-error to roll it.
 *
 * PR-H — decouple cross-tracker contamination: `record5xxErrorIfApplicable`
 * is now PURE record-or-noop. The previous combined helper
 * `recordServerErrorIfApplicable` reset the 5xx counter when probed with a
 * 530 error, which spuriously cleared 5xx history whenever a 530 storm
 * raced the producer's 404/4xx error path. The helper is now symmetric
 * with `record530ErrorIfApplicable` in the 530 tracker — both recorders
 * increment-or-noop, neither cross-wipes the other's Map. Explicit resets
 * live on the SUCCESS side (`maybeResetServerErrorOnSuccess` /
 * `maybeReset530OnSuccess`) and on the operator-only non-server-error
 * path (call `resetServerErrorCounter` directly if you need that).
 *
 * @see provider-530-tracker.ts for the parallel implementation that
 *      tracks Cloudflare origin-unreachable failures.
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('ProviderServerErrorTracker');

/** Maps provider name → consecutive 5xx server-error count. */
const _consecutiveServerErrorCount = new Map<string, number>();

/**
 * Default blacklist threshold (2), overridable via env var
 * `SERVER_ERROR_BLACKLIST_THRESHOLD`. Values are coerced to int and
 * clamped to >= 1 — a 0 / NaN / negative value is treated as 1 to
 * keep the tracker always meaningful.
 */
function readBlacklistThreshold(): number {
  const raw = process.env.SERVER_ERROR_BLACKLIST_THRESHOLD;
  if (!raw) return 2;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return parsed;
}

/** Threshold before a provider is blacklisted for generic 5xx. */
const SERVER_ERROR_BLACKLIST_THRESHOLD = readBlacklistThreshold();

/**
 * Exported for test introspection. Reading the runtime threshold lets
 * the T-D3 test confirm that `SERVER_ERROR_BLACKLIST_THRESHOLD=N` env
 * overrides take effect after `vi.resetModules()` + re-import.
 */
export function getServerErrorBlacklistThreshold(): number {
  return SERVER_ERROR_BLACKLIST_THRESHOLD;
}

/**
 * Set of status codes counted as "server errors" by this tracker.
 *
 * EXPLICITLY EXCLUDED:
 *   - `530` is NOT a generic 5xx server error — it is Cloudflare's
 *     "origin unreachable" code, which is tracked separately by
 *     `provider-530-tracker.ts`.
 *   - `501` (Not Implemented) is not counted — it indicates the
 *     provider does not support a feature, not an infrastructure fault.
 *   - `505+` (HTTP Version Not Supported, etc.) are exotic but we
 *     deliberately keep this small fixed set so the threshold remains
 *     meaningful: a hard outage should trip the blacklist at threshold=2.
 */
const SERVER_ERROR_STATUS_CODES = new Set([500, 502, 503, 504]);

/**
 * Regex matched against the error's `.message` field as a fallback
 * when statusCode fields are missing. Conservatively matches the
 * the four codes plus their canonical phrases. Anchored loosely so
 * strings like `"Bad Gateway 502"` and `"HTTP 503 Service Unavailable"`
 * both match, while avoiding the Cloudflare 530 false-positive case
 * (530's signature is handled by the dedicated 530 tracker, not here).
 */
const SERVER_ERROR_MESSAGE_PATTERN =
  /\b(?:500|internal server error\b)|(?:502|bad gateway\b)|(?:503|service unavailable\b)|(?:504|gateway timeout\b)/i;

/**
 * Check if an error qualifies as a tracked server error.
 * Inspects `error.status`, `error.statusCode`, and `error.message` —
 * the same surface area used by `is530Error` in the 530 tracker, so
 * the two detectors don't disagree on what "the status of this error"
 * means.
 */
function isServerError(error: any): boolean {
  const status = error?.status || error?.statusCode || 0;
  if (typeof status === 'number' && SERVER_ERROR_STATUS_CODES.has(status)) {
    return true;
  }
  const msg = (error?.message || '').toString();
  if (msg && SERVER_ERROR_MESSAGE_PATTERN.test(msg)) {
    return true;
  }
  return false;
}

/**
 * Record a server-error event for a provider. Increments the
 * consecutive-count Map and emits a logger warning when the provider
 * crosses the blacklist threshold.
 */
export function recordServerError(provider: string): void {
  const current = _consecutiveServerErrorCount.get(provider) || 0;
  const next = current + 1;
  _consecutiveServerErrorCount.set(provider, next);

  log.warn('[ServerErrorTracker] Provider recorded 5xx', {
    provider,
    consecutiveCount: next,
    threshold: SERVER_ERROR_BLACKLIST_THRESHOLD,
    blacklisted: next >= SERVER_ERROR_BLACKLIST_THRESHOLD,
  });

  if (next >= SERVER_ERROR_BLACKLIST_THRESHOLD) {
    log.warn(
      `[ServerErrorTracker] Provider ${provider} BLACKLISTED after ${next} consecutive 5xx`,
    );
  }
}

/**
 * PR-D — opt-in reset of the consecutive-server-error counter on
 * every success.
 *
 * When true (default OFF), the success paths in
 * `chat/enhanced-llm-service.ts`, `chat/vercel-ai-streaming.ts`,
 * `chat/llm-fallback-coordinator.ts`, and `unified-agent-service.ts`
 * call `maybeResetServerErrorOnSuccess(provider)` after a successful
 * round-trip. This lets a provider that has hit
 * `SERVER_ERROR_BLACKLIST_THRESHOLD` consecutive 5xx recover
 * immediately on the very next successful call, rather than staying
 * blacklisted until a subsequent non-server-error rolls the counter.
 *
 * Default OFF. Operators can enable with
 * `ENABLE_SERVER_ERROR_RESET_ON_SUCCESS=1`. The flag's strict
 * equality contract is identical to `ENABLE_530_RESET_ON_SUCCESS`.
 */
export const ENABLE_SERVER_ERROR_RESET_ON_SUCCESS =
  process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS === '1';

/**
 * Helper wrapper exported so call sites don't need to re-check the
 * flag on every invocation. When the flag is OFF the call is a
 * no-op (TypeScript-compile-time cheap; runtime branch is
 * predictable).
 */
export function maybeResetServerErrorOnSuccess(provider: string): void {
  if (ENABLE_SERVER_ERROR_RESET_ON_SUCCESS) {
    resetServerErrorCounter(provider);
  }
}

/**
 * Reset the consecutive server-error counter for a provider.
 * Called when a provider succeeds or fails with a non-server-error.
 */
export function resetServerErrorCounter(provider: string): void {
  const hadCount = _consecutiveServerErrorCount.get(provider);
  if (hadCount) {
    log.info('[ServerErrorTracker] Counter reset', {
      provider,
      previousCount: hadCount,
    });
    _consecutiveServerErrorCount.delete(provider);
  }
}

/**
 * Check if a provider should be skipped because it has hit
 * `SERVER_ERROR_BLACKLIST_THRESHOLD` consecutive server errors.
 * The counter persists across all requests in the process
 * lifetime.
 */
export function isServerErrorBlacklisted(provider: string): boolean {
  const count = _consecutiveServerErrorCount.get(provider) || 0;
  return count >= SERVER_ERROR_BLACKLIST_THRESHOLD;
}

/**
 * Get the current server-error count for a provider (logging /
 * debugging).
 */
export function getServerErrorCount(provider: string): number {
  return _consecutiveServerErrorCount.get(provider) || 0;
}

/**
 * PR-H — PURE record-or-noop helper (replaces the prior
 * `recordServerErrorIfApplicable` combined helper).
 *
 * Increments the consecutive 5xx-server-error counter for `provider`
 * when `error` qualifies as a server error (500/502/503/504);
 * otherwise no-ops.
 *
 * Cross-tracker-decouple rationale (PR-H): the previous combined
 * helper reset the 5xx counter whenever the inspected error was NOT
 * a server error — which meant a 530 error from the parallel tunnel
 * tracker would silently wipe accumulated 5xx history. Symmetrically,
 * the 530 tracker's combined helper reset the 530 counter on a 5xx
 * error. Either direction caused spurious counter wipes and let
 * unhealthy providers slip past the blacklist threshold.
 *
 * This helper is NOW strictly incremental: none of `isServerError`
 * return false → counter is untouched. The only documented ways to
 * decrement the counter are:
 *   - The success-path helper `maybeResetServerErrorOnSuccess(provider)`
 *     (gated by `ENABLE_SERVER_ERROR_RESET_ON_SUCCESS=1`, default OFF).
 *   - The unconditional internal helper `resetServerErrorCounter(provider)`
 *     (not exported; reserved for the helper layer).
 *
 * For symmetry with `record530ErrorIfApplicable` in the 530 tracker,
 * this function is also renamed to make its pure-record contract
 * unmistakable to callers reading the import site.
 *
 * Production call sites: `chat/enhanced-llm-service.ts:746`,
 * `orchestra/unified-agent-service.ts:4973+6015`. Each fires
 * IN PARALLEL with `record530ErrorIfApplicable`; neither wipes the
 * other's counter.
 */
export function record5xxErrorIfApplicable(
  provider: string,
  error: any,
): void {
  if (isServerError(error)) {
    recordServerError(provider);
  }
  // PURE record-or-noop: non-server-error inputs are a no-op for the
  // 5xx counter. Counter is decremented ONLY via the success-side
  // helpers above. This decoupling is the PR-H fix.
}
