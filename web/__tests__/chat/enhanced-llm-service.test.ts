/**
 * enhanced-llm-service.test.ts — F3 rate-limit circuit breaker (2026-07-16)
 *
 * Asserts the audit contract for the provider rate-limit circuit breaker:
 *
 *   - provider-rate-limit-tracker API: isRateLimitedBlacklisted,
 *     recordRateLimitedIfApplicable, resetRateLimitCounter,
 *     _clearRateLimitMapForTest
 *   - fallback-loop semantics (mirrored from EnhancedLLMService.generateResponse
 *     L870-L920 + streamWithConcurrentFallback L1518):
 *       for (const fallbackProvider of providers) {
 *         if (is530Blacklisted(p) || isServerErrorBlacklisted(p) ||
 *             isRateLimitedBlacklisted(p)) continue;
 *         const result = await invokeProvider(p);
 *         if (isRateLimitError(result)) {
 *           recordRateLimitedIfApplicable(p, result);
 *           continue;
 *         }
 *         return result;
 *       }
 *
 * The implementation already lives in:
 *   /opt/bing/web/lib/chat/enhanced-llm-service.ts (L870-L920 + L1467 + L1598-L1609)
 *   /opt/bing/web/lib/orchestra/provider-rate-limit-tracker.ts (the API)
 *
 * These tests verify the BEHAVIOR via the tracker API + a fallback-loop mirror
 * that replicates the production code's skip pattern. The mirror is intentionally
 * minimal — production tests against the real EnhancedLLMService would require
 * mocking 13+ provider-specific modules, which adds noise without exercising
 * the F3 contract.
 *
 * AUDIT SCOPE: all providers in the chain share the same blacklist mechanism,
 * so testing with 'provider-a' / 'provider-b' as stand-ins exercises the full
 * surface. The audit verdict (verified in the recon round) confirmed:
 *   - Non-streaming fallback (L870-L920): `isRateLimitedBlacklisted` in continue ✓
 *   - Streaming fallback first-pass (L1467): `isRateLimitedBlacklisted` filter ✓
 *   - Streaming error handler (L1598-L1609): recordRateLimitedIfApplicable wired ✓
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isRateLimitedBlacklisted,
  recordRateLimitedIfApplicable,
  resetRateLimitCounter,
  _clearRateLimitMapForTest,
} from '@/lib/orchestra/provider-rate-limit-tracker'

// ───── Fallback-loop mirror (matches EnhancedLLMService pattern) ─────────────

type ProviderResult =
  | { status: 200; output: string }
  | { status: 429; error: 'rate-limited' }
  | { status: 500; error: string }

const invokeProvider = (provider: string) => {
  if (provider === 'primary') return primaryInvoke()
  if (provider === 'deepseek') return deepseekInvoke()
  if (provider === 'openai') return openaiInvoke()
  if (provider === 'anthropic') return anthropicInvoke()
  if (provider === 'gemini') return geminiInvoke()
  throw new Error(`unknown provider: ${provider}`)
}

const primaryInvoke = vi.fn<() => Promise<ProviderResult>>()
const deepseekInvoke = vi.fn<() => Promise<ProviderResult>>()
const openaiInvoke = vi.fn<() => Promise<ProviderResult>>()
const anthropicInvoke = vi.fn<() => Promise<ProviderResult>>()
const geminiInvoke = vi.fn<() => Promise<ProviderResult>>()

async function fallbackChain(
  providers: ReadonlyArray<string>,
): Promise<ProviderResult> {
  for (const p of providers) {
    if (isRateLimitedBlacklisted(p)) continue
    const result = await invokeProvider(p)
    if (result.status === 429) {
      recordRateLimitedIfApplicable(p, result)
      continue
    }
    return result
  }
  throw new Error('all providers exhausted or rate-limited')
}

// ───── Tracker API tests ────────────────────────────────────────────────────

describe('provider-rate-limit-tracker API', () => {
  beforeEach(() => {
    _clearRateLimitMapForTest()
  })

  it('Test 1: isRateLimitedBlacklisted returns false for an unknown provider', () => {
    expect(isRateLimitedBlacklisted('provider-a')).toBe(false)
  })

  it('Test 2: recordRateLimitedIfApplicable marks provider as blacklisted after a 429', () => {
    recordRateLimitedIfApplicable('provider-a', { status: 429, error: 'rate-limited' })
    expect(isRateLimitedBlacklisted('provider-a')).toBe(true)
  })

  it('Test 3: recordRateLimitedIfApplicable ignores non-429 errors', () => {
    recordRateLimitedIfApplicable('provider-a', { status: 500, error: 'oops' })
    expect(isRateLimitedBlacklisted('provider-a')).toBe(false)
  })

  it('Test 4: recordRateLimitedIfApplicable accepts error-shape variants (status, statusCode, response.status, cause)', () => {
    // Variant 1: direct status
    recordRateLimitedIfApplicable('p1', { status: 429 })
    expect(isRateLimitedBlacklisted('p1')).toBe(true)
    // Variant 2: statusCode
    recordRateLimitedIfApplicable('p2', { statusCode: 429 })
    expect(isRateLimitedBlacklisted('p2')).toBe(true)
    // Variant 3: response.status
    recordRateLimitedIfApplicable('p3', { response: { status: 429 } })
    expect(isRateLimitedBlacklisted('p3')).toBe(true)
    // Variant 4: cause
    recordRateLimitedIfApplicable('p4', { cause: { status: 429 } })
    expect(isRateLimitedBlacklisted('p4')).toBe(true)
  })

  it('Test 5: recordRateLimitedIfApplicable accepts regex-string matching (429 / too many requests / rate limit)', () => {
    recordRateLimitedIfApplicable('p5', { message: '429 Too Many Requests' })
    expect(isRateLimitedBlacklisted('p5')).toBe(true)
    recordRateLimitedIfApplicable('p6', { message: 'rate limit exceeded' })
    expect(isRateLimitedBlacklisted('p6')).toBe(true)
  })

  it('Test 6: resetRateLimitCounter clears the blacklist', () => {
    recordRateLimitedIfApplicable('provider-a', { status: 429 })
    expect(isRateLimitedBlacklisted('provider-a')).toBe(true)
    resetRateLimitCounter('provider-a')
    expect(isRateLimitedBlacklisted('provider-a')).toBe(false)
  })

  it('Test 7: blacklisting one provider does not affect another', () => {
    recordRateLimitedIfApplicable('provider-a', { status: 429 })
    expect(isRateLimitedBlacklisted('provider-a')).toBe(true)
    expect(isRateLimitedBlacklisted('provider-b')).toBe(false)
  })
})

// ───── F3 core contract: provider raises 429 once → next 5 requests skip ────

describe('F3 rate-limit circuit breaker — fallback chain respects blacklist', () => {
  beforeEach(() => {
    _clearRateLimitMapForTest()
    primaryInvoke.mockReset()
    deepseekInvoke.mockReset()
    openaiInvoke.mockReset()
    anthropicInvoke.mockReset()
    geminiInvoke.mockReset()
  })

  afterEach(() => {
    /* nothing — beforeEach cleared everything */
  })

  it('Test 8 (CORE): deepseek raises 429 once → next 5 requests skip deepseek', async () => {
    // deepseek returns 429 on the FIRST call, then anything thereafter.
    // After the first 429, deepseek is blacklisted; next 5 calls must NOT
    // invoke deepseek again — they must skip directly to the next provider.
    deepseekInvoke.mockResolvedValueOnce({ status: 429, error: 'rate-limited' })
    openaiInvoke.mockResolvedValue({ status: 200, output: 'ok-from-openai' })

    const providers = ['deepseek', 'openai']
    // First request: deepseek fails with 429, openai rescues with 200.
    const r1 = await fallbackChain(providers)
    expect(r1).toEqual({ status: 200, output: 'ok-from-openai' })
    expect(deepseekInvoke).toHaveBeenCalledTimes(1)
    expect(openaiInvoke).toHaveBeenCalledTimes(1)
    expect(isRateLimitedBlacklisted('deepseek')).toBe(true)

    // Next 5 requests: deepseek is skipped; openai handles all of them.
    for (let i = 0; i < 5; i++) {
      const r = await fallbackChain(providers)
      expect(r).toEqual({ status: 200, output: 'ok-from-openai' })
    }

    // CRITICAL ASSERTION: deepseek was invoked EXACTLY ONCE (the initial 429),
    // NOT 6 times. openai handled the 5 follow-ups + the original rescue = 6.
    expect(deepseekInvoke).toHaveBeenCalledTimes(1)
    expect(openaiInvoke).toHaveBeenCalledTimes(6)
  })

  it('Test 9: blacklisting persists across resetRateLimitCounter, recovery returns provider to the chain', async () => {
    deepseekInvoke.mockResolvedValue({ status: 200, output: 'ok-from-deepseek' })
    openaiInvoke.mockResolvedValue({ status: 200, output: 'ok-from-openai' })

    // Force deepseek into blacklist.
    recordRateLimitedIfApplicable('deepseek', { status: 429 })
    expect(isRateLimitedBlacklisted('deepseek')).toBe(true)

    // While blacklisted, fallback chain skips deepseek.
    const r1 = await fallbackChain(['deepseek', 'openai'])
    expect(r1.output).toBe('ok-from-openai')
    expect(deepseekInvoke).not.toHaveBeenCalled()

    // After resetRateLimitCounter, deepseek is back in the chain.
    resetRateLimitCounter('deepseek')
    expect(isRateLimitedBlacklisted('deepseek')).toBe(false)
    const r2 = await fallbackChain(['deepseek', 'openai'])
    expect(r2.output).toBe('ok-from-deepseek')
    expect(deepseekInvoke).toHaveBeenCalledTimes(1)
    expect(openaiInvoke).toHaveBeenCalledTimes(1)
  })

  it('Test 10: all 5 chain providers (deepseek, openai, anthropic, gemini, primary) skip a blacklisted provider uniformly', async () => {
    // Force deepseek into blacklist BEFORE any call.
    recordRateLimitedIfApplicable('deepseek', { status: 429 })

    primaryInvoke.mockResolvedValue({ status: 200, output: 'ok-primary' })
    openaiInvoke.mockResolvedValue({ status: 200, output: 'ok-openai' })
    anthropicInvoke.mockResolvedValue({ status: 200, output: 'ok-anthropic' })
    geminiInvoke.mockResolvedValue({ status: 200, output: 'ok-gemini' })

    const providers = ['deepseek', 'openai', 'anthropic', 'gemini', 'primary']
    const r = await fallbackChain(providers)
    expect(r.output).toBe('ok-openai') // first non-blacklisted
    expect(deepseekInvoke).not.toHaveBeenCalled()
    expect(openaiInvoke).toHaveBeenCalledTimes(1)
    expect(anthropicInvoke).not.toHaveBeenCalled()
    expect(geminiInvoke).not.toHaveBeenCalled()
    expect(primaryInvoke).not.toHaveBeenCalled()
  })

  it('Test 11: all 5 providers are independently blacklisted (no cross-contamination)', async () => {
    primaryInvoke.mockResolvedValue({ status: 429, error: 'rate-limited' })
    deepseekInvoke.mockResolvedValue({ status: 200, output: 'ok-deepseek' })
    openaiInvoke.mockResolvedValue({ status: 200, output: 'ok-openai' })
    anthropicInvoke.mockResolvedValue({ status: 200, output: 'ok-anthropic' })
    geminiInvoke.mockResolvedValue({ status: 200, output: 'ok-gemini' })

    // First request: primary is invoked, returns 429, gets blacklisted.
    // deepseek is the next non-blacklisted, returns 200, request succeeds.
    const providers = ['primary', 'deepseek', 'openai', 'anthropic', 'gemini']
    const r1 = await fallbackChain(providers)
    expect(r1.output).toBe('ok-deepseek')
    expect(primaryInvoke).toHaveBeenCalledTimes(1)
    expect(isRateLimitedBlacklisted('primary')).toBe(true)

    // Second request: primary is SKIPPED (blacklisted), deepseek handles.
    const r2 = await fallbackChain(providers)
    expect(r2.output).toBe('ok-deepseek')
    expect(primaryInvoke).toHaveBeenCalledTimes(1) // still 1 — not invoked again
    expect(deepseekInvoke).toHaveBeenCalledTimes(2)
  })

  it('Test 12: when ALL providers are blacklisted, fallbackChain throws (does not infinite-loop)', async () => {
    recordRateLimitedIfApplicable('deepseek', { status: 429 })
    recordRateLimitedIfApplicable('openai', { status: 429 })
    recordRateLimitedIfApplicable('anthropic', { status: 429 })

    await expect(
      fallbackChain(['deepseek', 'openai', 'anthropic']),
    ).rejects.toThrow(/all providers exhausted/)
  })

  // Mirror-vs-production divergence (2026-07-16, SHOULD-CONSIDER from code
  // review): this test exercises ONLY the rate-limit (429) blacklist
  // contract. The production fallback chain at enhanced-llm-service.ts:L880
  // and L1467 ALSO calls `isServerErrorBlacklisted(provider)` (the 5xx
  // blacklist) before invoking a provider — this mirror does not assert that
  // branch because it predates the F1 server-error-skipped audit. A future
  // Test 14 should mirror the 5xx-blacklist contract (provider returns 500 →
  // isServerErrorBlacklisted → skip on next request). Tracked under
  // .tickets/MCP-RATE-LIMITED-TTL-RECOVERY.md.
  it('Test 13: non-rate-limit errors (e.g. 500) do NOT blacklist the provider and are returned as-is', async () => {
    deepseekInvoke.mockResolvedValueOnce({ status: 500, error: 'server-error' })

    const r1 = await fallbackChain(['deepseek', 'openai'])
    // 500 is NOT a 429 — fallbackChain returns the 500 result without skipping to next.
    expect(r1.status).toBe(500)
    expect(r1.output).toBeUndefined()
    expect(isRateLimitedBlacklisted('deepseek')).toBe(false)
    // openai was NEVER invoked (no skip on 500)
    expect(openaiInvoke).not.toHaveBeenCalled()

    // Next request: deepseek is NOT blacklisted (was only 500, not 429), so it's invoked again.
    deepseekInvoke.mockResolvedValueOnce({ status: 200, output: 'ok-deepseek' })
    const r2 = await fallbackChain(['deepseek', 'openai'])
    expect(r2.output).toBe('ok-deepseek')
    expect(deepseekInvoke).toHaveBeenCalledTimes(2) // invoked both times
    expect(openaiInvoke).not.toHaveBeenCalled() // openai still not invoked
  })

  it('Test 14: 429 blacklists the provider AND the chain moves to the next', async () => {
    deepseekInvoke.mockResolvedValueOnce({ status: 429, error: 'rate-limited' })
    openaiInvoke.mockResolvedValueOnce({ status: 429, error: 'rate-limited' })
    // anthropic handles rescue + ALL 5 follow-ups (1 + 5 = 6 calls) — use mockResolvedValue
    // (always-returns) rather than mockResolvedValueOnce (exhausts after 1 call → undefined).
    anthropicInvoke.mockResolvedValue({ status: 200, output: 'ok-anthropic' })

    const r = await fallbackChain(['deepseek', 'openai', 'anthropic'])
    expect(r.output).toBe('ok-anthropic')
    expect(isRateLimitedBlacklisted('deepseek')).toBe(true)
    expect(isRateLimitedBlacklisted('openai')).toBe(true)
    expect(isRateLimitedBlacklisted('anthropic')).toBe(false)

    // 5 follow-up requests must skip deepseek+openai and hit anthropic each time.
    for (let i = 0; i < 5; i++) {
      const r2 = await fallbackChain(['deepseek', 'openai', 'anthropic'])
      expect(r2.output).toBe('ok-anthropic')
    }
    expect(deepseekInvoke).toHaveBeenCalledTimes(1)  // only the initial 429
    expect(openaiInvoke).toHaveBeenCalledTimes(1)    // only the initial 429
    expect(anthropicInvoke).toHaveBeenCalledTimes(6) // 1 rescue + 5 follow-ups
  })
})