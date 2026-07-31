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
 * TTL recovery (2026-07-23, TO-NU-INTERACTIVE-INJECT): blacklist entries
 * auto-evict after RATE_LIMIT_BLACKLIST_TTL_MS (default 5 min) via a
 * periodic clear at RATE_LIMIT_CLEAR_INTERVAL_MS (default 1 min).
 * When the upstream sends a Retry-After header and
 * RATE_LIMIT_USE_RETRY_AFTER=true (default), the entry uses
 * retryAfterMs instead of the global TTL for precise recovery.
 * The clear-interval handle is .unref()-ed so it doesn't keep the
 * event loop alive in tests or dev mode.
 *
 * Audit reference: F3 (MCP-TOOL-SELECTION-POSTAUDIT remediation step).
 * TTL follow-up: /opt/bing/.tickets/MCP-RATE-LIMITED-TTL-RECOVERY.md
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('ProviderRateLimitTracker');

// ─── Types ─────────────────────────────────────────────────────────────────

interface BlacklistEntry {
  readonly blacklistedAt: number;
  readonly retryAfterMs?: number;
}

// ─── State ─────────────────────────────────────────────────────────────────

let _clearIntervalHandle: ReturnType<typeof setInterval> | null = null;

const _blacklist = new Map<string, BlacklistEntry>();

// ─── Configuration helpers (env-driven) ────────────────────────────────────

function getBlacklistTtl(): number {
  return parseInt(process.env.RATE_LIMIT_BLACKLIST_TTL_MS || '300000', 10);
}

function getClearInterval(): number {
  return parseInt(process.env.RATE_LIMIT_CLEAR_INTERVAL_MS || '60000', 10);
}

function shouldUseRetryAfter(): boolean {
  return process.env.RATE_LIMIT_USE_RETRY_AFTER !== 'false';
}

// ─── Periodic clear (started once at first usage) ──────────────────────────

function ensureClearIntervalStarted(): void {
  if (_clearIntervalHandle) return;
  _clearIntervalHandle = setInterval(() => {
    const now = Date.now();
    for (const [provider, entry] of _blacklist) {
      const effectiveTtl = shouldUseRetryAfter() && entry.retryAfterMs
        ? entry.retryAfterMs
        : getBlacklistTtl();
      if (now - entry.blacklistedAt >= effectiveTtl) {
        _blacklist.delete(provider);
        log.info(`[RateLimitTracker] TTL cleared blacklist for ${provider} after ${effectiveTtl}ms`);
      }
    }
  }, getClearInterval());
  if (typeof _clearIntervalHandle.unref === 'function') {
    _clearIntervalHandle.unref();
  }
}

// ─── Error shape detection ─────────────────────────────────────────────────

function isRateLimitError(error: any): boolean {
  if (typeof error === 'object' && error === null) return false;
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

// ─── Core functions ────────────────────────────────────────────────────────

/**
 * Record a rate-limit event for a provider.
 *
 * Extended in the TTL recovery (2026-07-23) to accept an optional
 * `retryAfterMs` parameter captured from the upstream `Retry-After`
 * response header. When `RATE_LIMIT_USE_RETRY_AFTER=true` (default)
 * and `retryAfterMs` is provided, the blacklist entry uses the
 * per-provider Retry-After duration instead of the global
 * `RATE_LIMIT_BLACKLIST_TTL_MS` for precise recovery timing.
 *
 * @param provider    The provider string (e.g. 'openai', 'anthropic').
 * @param error       The error object to inspect for 429 status.
 * @param retryAfterMs Optional Retry-After duration in ms captured from the
 *                     upstream HTTP response header. Ignored when
 *                     `RATE_LIMIT_USE_RETRY_AFTER` is `false`.
 */
export function recordRateLimitedIfApplicable(
  provider: string,
  error: unknown,
  retryAfterMs?: number,
): void {
  if (!isRateLimitError(error)) return;
  ensureClearIntervalStarted();
  _blacklist.set(provider, {
    blacklistedAt: Date.now(),
    retryAfterMs: shouldUseRetryAfter() ? retryAfterMs : undefined,
  });
  log.warn(`[RateLimitTracker] Provider ${provider} blacklisted (TTL: ${retryAfterMs ?? getBlacklistTtl()}ms)`);
}

/**
 * Check whether a provider is currently blacklisted.
 *
 * Boolean contract preserved from the original counter-based implementation.
 * Callers skip the provider when this returns `true`.
 */
export function isRateLimitedBlacklisted(provider: string): boolean {
  return _blacklist.has(provider);
}

/**
 * Manually reset the rate-limit blacklist for a provider.
 *
 * Use after a positive health-check probe confirms the upstream rate
 * limit has cleared (e.g. after a manual health endpoint returns 200).
 * This is a MANUAL recovery path — NOT for re-trying a 429 in the same
 * call. The TTL-based periodic clear (every RATE_LIMIT_CLEAR_INTERVAL_MS)
 * is the automatic recovery path.
 */
export function resetRateLimitCounter(provider: string): void {
  _blacklist.delete(provider);
  log.info(`[RateLimitTracker] Manual reset for ${provider}`);
}

// Test-only export (used by vitest scenarios in __tests__/chat/).
// NOT for production use — clears the whole in-process blacklist map
// AND clears the periodic interval handle (so each test starts fresh).
export function _clearRateLimitMapForTest(): void {
  _blacklist.clear();
  if (_clearIntervalHandle) {
    clearInterval(_clearIntervalHandle);
    _clearIntervalHandle = null;
  }
}
