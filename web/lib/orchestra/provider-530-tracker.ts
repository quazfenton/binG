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
  // Check status code fields
  const status = error?.status || error?.statusCode || 0;
  if (status === 530) return true;

  // Check error message against the tunnel DNS error regex
  const msg = (error?.message || '').toString();
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
 * Handle an error from a provider attempt — record 530 if applicable,
 * reset otherwise.
 */
export function handleProviderError(provider: string, error: any): void {
  if (is530Error(error)) {
    record530Error(provider);
  } else {
    reset530Counter(provider);
  }
}
