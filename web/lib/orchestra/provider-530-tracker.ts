/**
 * Provider 530 Tracker
 *
 * Tracks consecutive Cloudflare 530 (origin unreachable) errors per provider
 * at the process level. When a provider returns 2+ consecutive 530s, it's
 * blacklisted for the remainder of the process lifetime — skipping it in
 * fallback chains saves ~1-2s per attempt on a guaranteed-fail endpoint.
 *
 * 530 is Cloudflare's "origin unreachable" status code, which means the
 * upstream proxy/tunnel is dead or DNS resolution fails. Retrying the same
 * provider will always produce the same error until the tunnel is fixed.
 *
 * The tracker uses the TUNNEL_DNS_ERROR regex from failure-classifier.ts
 * to detect 530/1016/tunnel-DNS errors across error message, status code,
 * and status fields.
 *
 * Reset conditions:
 * - Any non-530 success or failure resets the counter for that provider
 * - This allows providers to be retried if the tunnel recovers
 */

import { TUNNEL_DNS_ERROR } from '../errors/failure-classifier';
import { createLogger } from '@/lib/utils/logger';
// PR-W -- cross-tracker import for the symmetric both-trackers reset helper.
// provider-server-error-tracker has no imports back to provider-530-tracker,
// so there is no circular-import risk.
import { maybeResetServerErrorOnSuccess } from './provider-server-error-tracker';

const log = createLogger('Provider530Tracker');

/** Maps provider name → consecutive 530 count */
const _consecutive530Count = new Map<string, number>();

/** Threshold before a provider is blacklisted */
const BLACKLIST_THRESHOLD = 2;

/**
 * Check if an error is a 530-style tunnel/DNS error.
 * Inspects error.message, error.status, and error.statusCode.
 */
function is530Error(error: any): boolean {
  // Check status code fields. Parity with provider-server-error-tracker's
  // isServerError -- guard against string-typed `status`/`statusCode`
  // slipping past strict equality. PR-H2 (Stage 2 follow-up).
  const status = error?.status || error?.statusCode || 0;
  if (typeof status === 'number' && status === 530) return true;

  // Check error message against the tunnel DNS error regex.
  // PR-H2: `String(... ?? '')` instead of `(error?.message || '').toString()`
  // so a `message: null` or `message: undefined` does not produce the
  // string `"null"` / `"undefined"` and accidentally match a future
  // wider regex.
  const msg = String(error?.message ?? '');
  if (TUNNEL_DNS_ERROR.test(msg)) return true;

  return false;
}

/**
 * Record a 530 error for a provider. Called when a provider attempt fails
 * with a 530/1016/tunnel-DNS error.
 */
export function record530Error(provider: string): void {
  const current = _consecutive530Count.get(provider) || 0;
  const next = current + 1;
  _consecutive530Count.set(provider, next);

  log.warn('[530-Tracker] Provider recorded 530', {
    provider,
    consecutiveCount: next,
    threshold: BLACKLIST_THRESHOLD,
    blacklisted: next >= BLACKLIST_THRESHOLD,
  });

  if (next >= BLACKLIST_THRESHOLD) {
    log.warn(`[530-Tracker] Provider ${provider} BLACKLISTED after ${next} consecutive 530s`);
  }
}
/**
 * PR-C — opt-in reset of the consecutive-530 counter on every success.
 *
 * When true (default OFF), the success paths in
 * `chat/enhanced-llm-service.ts`, `chat/vercel-ai-streaming.ts`,
 * `chat/llm-fallback-coordinator.ts`, and `unified-agent-service.ts` call
 * `maybeReset530OnSuccess(provider)` after a successful round-trip. This
 * lets a provider that has hit BLACKLIST_THRESHOLD consecutive 530s
 * recover immediately on the very next successful call, rather than
 * staying blacklisted until a subsequent non-530 error rolls the counter.
 *
 * Default OFF. Operators can enable with ENABLE_530_RESET_ON_SUCCESS=1.
 * The fix is purely a recovery-latency improvement; no observable
 * behavior change beyond faster recovery from transient 530 storms.
 */
export const ENABLE_530_RESET_ON_SUCCESS = process.env.ENABLE_530_RESET_ON_SUCCESS === '1';

/**
 * Helper wrapper exported so call sites don't need to re-check the flag
 * on every invocation. When the flag is OFF the call is a no-op
 * (TypeScript-compile-time cheap; runtime branch is predictable).
 */
export function maybeReset530OnSuccess(provider: string): void {
  if (ENABLE_530_RESET_ON_SUCCESS) {
    reset530Counter(provider);
  }
}


/**
 * PR-W -- symmetric success-side reset helper. Clears BOTH the 530 AND the
 * 5xx-blacklist counters for `provider` in a single call.
 *
 * Per-sub-call gating (each independently controlled by an env flag; default
 * OFF for both -- operator-conservative):
 *
 *   sub-call                         env flag (strict ==='1')                 resets
 *   -------------------------------  ----------------------------------------  --------------------------------------------------------
 *   maybeReset530OnSuccess(p)        ENABLE_530_RESET_ON_SUCCESS              provider-530-tracker counter (Cloudflare origin-unreachable)
 *   maybeResetServerErrorOnSuccess   ENABLE_SERVER_ERROR_RESET_ON_SUCCESS     provider-server-error-tracker counter (HTTP 5xx)
 *
 * This helper itself has NO outer flag. Operators enable per-tracker behavior
 * by setting the gate env var(s). On default-OFF config: the helper is a
 * behavioral no-op (both sub-calls short-circuit before reaching their
 * respective counter Maps).
 *
 * Replaces the manual pairing at 5 wire-up sites:
 *   - web/lib/chat/enhanced-llm-service.ts            (success-return path)
 *   - web/lib/chat/vercel-ai-streaming.ts             (~L1050 + ~L1080 success paths)
 *   - web/lib/orchestra/unified-agent-service.ts      (~L4924 + ~L5986 success-return paths)
 *
 * Naming note: "BothTrackers" rather than "Trackers" so adding a third
 * tracker (rate-limit, quota, etc.) does NOT require renaming this symbol --
 * the helper just grows by one extra maybeResetXxx(p) line.
 */
export function maybeResetBothTrackers(provider: string): void {
  maybeReset530OnSuccess(provider);
  maybeResetServerErrorOnSuccess(provider);
}


/**
 * Reset the consecutive 530 counter for a provider. Called when a provider
 * succeeds or fails with a non-530 error.
 */
export function reset530Counter(provider: string): void {
  const hadCount = _consecutive530Count.get(provider);
  if (hadCount) {
    log.info('[530-Tracker] Counter reset', {
      provider,
      previousCount: hadCount,
    });
    _consecutive530Count.delete(provider);
  }
}

/**
 * Check if a provider should be skipped because it has had 2+ consecutive
 * 530 errors. The counter persists across all requests in the process lifetime.
 */
export function is530Blacklisted(provider: string): boolean {
  const count = _consecutive530Count.get(provider) || 0;
  return count >= BLACKLIST_THRESHOLD;
}

/**
 * Get the current 530 count for a provider (for logging/debugging).
 */
export function get530Count(provider: string): number {
  return _consecutive530Count.get(provider) || 0;
}

/**
 * PR-H — PURE record-or-noop helper (replaces the prior combined
 * `handleProviderError`).
 *
 * Increments the consecutive 530-error counter for `provider` when
 * `error` is a 530 / 1016 / tunnel-DNS signature; otherwise no-ops.
 *
 * Cross-tracker-decouple rationale (PR-H): the previous combined
 * helper reset the 530 counter whenever the inspected error was NOT
 * a 530 — which meant a 5xx error from the parallel server-error
 * tracker would silently wipe accumulated 530 history. Symmetrically,
 * `record5xxErrorIfApplicable` in the server-error tracker would
 * wipe the 5xx counter on a 530 error. Either direction caused spurious
 * counter wipes; this PR-H fix decouples them.
 *
 * This helper is NOW strictly incremental: none of `is530Error`
 * return false → counter is untouched. The only documented ways to
 * decrement the 530 counter are:
 *   - The success-path helper `maybeReset530OnSuccess(provider)`
 *     (gated by `ENABLE_530_RESET_ON_SUCCESS=1`, default OFF).
 *   - The unconditional internal helper `reset530Counter(provider)`
 *     (not exported; reserved for the helper layer).
 *
 * For symmetry with `record5xxErrorIfApplicable` in the server-error
 * tracker, this function is also renamed to make its pure-record
 * contract unmistakable to callers reading the import site.
 *
 * Production call sites: `chat/enhanced-llm-service.ts:747`,
 * `orchestra/unified-agent-service.ts:4974+6016`. Each fires
 * IN PARALLEL with `record5xxErrorIfApplicable`; neither wipes the
 * other's counter.
 */
export function record530ErrorIfApplicable(provider: string, error: any): void {
  if (is530Error(error)) {
    record530Error(provider);
  }
  // PURE record-or-noop: non-530 inputs are a no-op for the 530
  // counter. Counter is decremented ONLY via the success-side helpers
  // above. This decoupling is the PR-H fix.
}
