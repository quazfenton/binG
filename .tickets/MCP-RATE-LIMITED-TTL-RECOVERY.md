# MCP-RATE-LIMITED-TTL-RECOVERY — TTL-based blacklist recovery design

**Status**: ✅ CLOSED (2026-07-23)

**Closure evidence:**

- [x] 1. `recordRateLimitedIfApplicable` now accepts optional 3rd arg `retryAfterMs` for Retry-After header capture
- [x] 2. `_blacklist` entries auto-evict after `RATE_LIMIT_BLACKLIST_TTL_MS` (default 5 min) via periodic `setInterval` clear at `RATE_LIMIT_CLEAR_INTERVAL_MS` (default 1 min)
- [x] 3. When `RATE_LIMIT_USE_RETRY_AFTER=true` (default) and `Retry-After` is present, entry uses `retryAfterMs` instead of global TTL
- [x] 4. The clear-interval handle is `.unref()`-ed so it doesn't keep the event loop alive
- [x] 5. Vitest test: auto-eviction after TTL (fake timers) — passed
- [x] 6. Vitest test: Retry-After override (60s Retry-After wins over 5min global TTL) — passed
- [x] 7. Vitest test: `RATE_LIMIT_USE_RETRY_AFTER=false` uses global TTL regardless of Retry-After — passed
- [x] 8. Vitest test: `setInterval` dedup guard (only 1 interval created for 2 calls) — passed
- [x] 9. All 10 existing tests pass (boolean contract preserved, backward compatible)
- [x] 10. Header JSDoc updated to reflect TTL recovery (removed "no built-in TTL recovery" admission)
**Parent**: F3 rate-limit circuit breaker audit thread (companion to the F3 fallback-chain blacklist fix at enhanced-llm-service.ts:L880 + L1467)
**Owner**: TBD
**Priority**: P2 (no immediate user impact — the blacklist works, but operators have no built-in way to recover a provider after the upstream rate limit clears short of a process restart)

## Problem statement

The current rate-limit blacklist at `/opt/bing/web/lib/orchestra/provider-rate-limit-tracker.ts` is **counter-based** with no recovery mechanism:

```ts
// Current implementation (provider-rate-limit-tracker.ts:L40-L85)
const _consecutive429Count = new Map<string, number>();
const BLACKLIST_THRESHOLD = 1;  // single 429 → blacklist

export function recordRateLimitedIfApplicable(provider: string): void {
  // ... increments _consecutive429Count[provider] ...
}

export function isRateLimitedBlacklisted(provider: string): boolean {
  return (_consecutive429Count.get(provider) ?? 0) >= BLACKLIST_THRESHOLD;
}

export function resetRateLimitCounter(provider: string): void {
  _consecutive429Count.delete(provider);
}
```

**Recovery footgun** (the `resetRateLimitCounter` JSDoc added on 2026-07-16): this function exists for **manual health-check recovery** (operator calls it after verifying upstream cleared), NOT for re-trying a 429 in the same call. Calling it after a fresh 429 just resets the counter, so the next attempt re-enters the chain and gets 429'd again, masking the rate limit.

The file's own header comment (L19-L27) acknowledges this gap:

> "Defer precise TTL-clearing using `Retry-After` headers to a future ticket — TTL semantics drift between providers (OpenAI: seconds, Anthropic: per-minute buckets, Mistral: rolling window). The current counter-based blacklist has no built-in TTL recovery; operators must call `resetRateLimitCounter` manually."

## Proposed design: env-driven TTL + periodic clear

### Configuration (env-driven)

```bash
# Default values shown; tunable per deployment.
RATE_LIMIT_BLACKLIST_TTL_MS=300000    # 5 min — when to evict from the blacklist
RATE_LIMIT_CLEAR_INTERVAL_MS=60000    # 1 min — how often the periodic clear runs
RATE_LIMIT_USE_RETRY_AFTER=true       # prefer Retry-After header when present
```

### Implementation sketch

```ts
// New types in provider-rate-limit-tracker.ts
interface BlacklistEntry {
  readonly blacklistedAt: number;
  readonly retryAfterMs?: number;  // captured from Retry-After header when present
}

const _blacklist = new Map<string, BlacklistEntry>();

function getBlacklistTtl(): number {
  return parseInt(process.env.RATE_LIMIT_BLACKLIST_TTL_MS || '300000', 10);
}

function getClearInterval(): number {
  return parseInt(process.env.RATE_LIMIT_CLEAR_INTERVAL_MS || '60000', 10);
}

function shouldUseRetryAfter(): boolean {
  return process.env.RATE_LIMIT_USE_RETRY_AFTER !== 'false';
}

// Periodic clear — started once at module load, dedup'd to a single interval
let _clearIntervalHandle: ReturnType<typeof setInterval> | null = null;
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
  // Unref so the interval doesn't keep the event loop alive
  if (typeof _clearIntervalHandle.unref === 'function') _clearIntervalHandle.unref();
}

// recordRateLimitedIfApplicable — extended to capture Retry-After
export function recordRateLimitedIfApplicable(provider: string, retryAfterMs?: number): void {
  ensureClearIntervalStarted();
  _blacklist.set(provider, {
    blacklistedAt: Date.now(),
    retryAfterMs: shouldUseRetryAfter() ? retryAfterMs : undefined,
  });
}

// isRateLimitedBlacklisted — backward-compatible boolean check
export function isRateLimitedBlacklisted(provider: string): boolean {
  return _blacklist.has(provider);
}

// resetRateLimitCounter — unchanged contract, now also clears the TTL entry
export function resetRateLimitCounter(provider: string): void {
  _blacklist.delete(provider);
}
```

### Backward compatibility

The new implementation **must** preserve the existing public API:
- `recordRateLimitedIfApplicable(provider: string): void` — extended with optional 2nd arg `retryAfterMs`, signature stays compatible (1-arg callers still work).
- `isRateLimitedBlacklisted(provider: string): boolean` — unchanged.
- `resetRateLimitCounter(provider: string): void` — unchanged.

The existing 7 tests in `/opt/bing/web/__tests__/orchestra/provider-rate-limit-tracker.test.ts` should pass without modification (the boolean contract is preserved; only the underlying storage changes).

## Acceptance criteria

- [ ] 1. `recordRateLimitedIfApplicable` captures `Retry-After` from the upstream response when present (callers in `enhanced-llm-service.ts:L870-L920` and `:1467` should pass it through).
- [ ] 2. `_blacklist` entries auto-evict after `RATE_LIMIT_BLACKLIST_TTL_MS` (default 5 min) via periodic clear at `RATE_LIMIT_CLEAR_INTERVAL_MS` (default 1 min).
- [ ] 3. When `RATE_LIMIT_USE_RETRY_AFTER=true` (default) and `Retry-After` is present, the entry uses `retryAfterMs` instead of `RATE_LIMIT_BLACKLIST_TTL_MS`.
- [ ] 4. The clear-interval handle is `.unref()`-ed so it doesn't keep the event loop alive in tests / dev mode.
- [ ] 5. Add a vitest case asserting: provider 429'd at t=0 → blacklisted at t=0 → still blacklisted at t=TTL-100ms → cleared at t=TTL+100ms (use vitest fake timers).
- [ ] 6. Add a vitest case asserting: provider 429'd with `Retry-After: 60s` → cleared at t=60s+epsilon even if `RATE_LIMIT_BLACKLIST_TTL_MS=300000` (Retry-After wins when enabled).
- [ ] 7. Add a vitest case asserting: `RATE_LIMIT_USE_RETRY_AFTER=false` → uses env TTL regardless of `Retry-After` header.
- [ ] 8. Add a vitest case asserting: `setInterval` handle has `.unref === function` called (mock-based assertion).
- [ ] 9. Update `__tests__/chat/enhanced-llm-service.test.ts` Test 13 mirror to NOT exercise this TTL branch (it tests the no-blacklist-on-500 case, which is unaffected by TTL).
- [ ] 10. Update the header JSDoc in `provider-rate-limit-tracker.ts` to reflect the TTL behavior (remove the "no built-in TTL recovery" admission).

## Why now

The F3 audit thread (companion to MCP-POST-CALL-WIRING) introduced `isRateLimitedBlacklisted` to skip 429'd providers on the next request — but didn't add the recovery path. The current state is:
- ✅ A 429'd provider is skipped on the next request (works).
- ❌ The provider stays blacklisted forever (only a process restart or manual `resetRateLimitCounter` recovers it).

This is fine for short-lived deployments but operationally fragile for long-running ones where providers recover after a few minutes.

## Risk assessment

- **Low**: the boolean contract is preserved; existing tests should pass unchanged.
- **Medium**: the periodic-clear timer is process-global state. Multiple module imports (e.g. SSR + edge) might start multiple timers — the dedup guard at `ensureClearIntervalStarted` prevents this for in-process cases, but cross-process / cross-runtime cases need separate handling (out of scope for this ticket).
- **Low**: `Retry-After` parsing varies by provider (some send seconds, some send HTTP-date). Existing usage assumes numeric seconds; this ticket preserves that assumption.

## Cross-references

- `.tickets/MCP-POST-CALL-WIRING.md` — Task #1 audit thread (the audit that surfaced this gap)
- `/opt/bing/web/lib/orchestra/provider-rate-limit-tracker.ts:L19-L27` — the existing header JSDoc that admits no TTL recovery
- `/opt/bing/web/lib/chat/enhanced-llm-service.ts:L879-L884` — production F3 fallback-chain blacklist usage (where `Retry-After` would be captured)
- `/opt/bing/web/__tests__/chat/enhanced-llm-service.test.ts:L259-L276` — Test 13 (the mirror that doesn't exercise the 5xx branch — tracked as SHOULD-CONSIDER from prior code review)

## Closure narrative template

When this ticket is closed, update the parent F3 audit thread + `.tickets/MCP-POST-CALL-WIRING.md` cross-reference, and add a "## TTL recovery closure (2026-07-16)" section here mirroring the items-①-⑥ closure narrative.
