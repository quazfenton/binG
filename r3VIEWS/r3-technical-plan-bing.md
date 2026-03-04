# Technical Implementation Plan - binG Codebase

**Created:** March 3, 2026  
**Based on:** Comprehensive Codebase Review (docs/review-results.md)  
**Status:** READY FOR IMPLEMENTATION  
**Total Estimated Effort:** 84 hours (10.5 days)

---

## Executive Summary

This technical plan addresses **9 critical issues** and **12 high-priority improvements** identified during the exhaustive codebase review. Implementation is organized into **3 phases** over **3 weeks**.

### Critical Issues (P0 - Block Production)

1. Provider factory pattern broken - providers never initialized
2. Mock snapshot data returned instead of real storage operations
3. Agent capabilities (terminal, desktop, MCP, git) never initialized
4. No health checks on any of 8 sandbox providers
5. No fallback chain for provider failures
6. Path traversal protection not applied to all providers
7. Anonymous access allowed on sensitive endpoints
8. No retry logic for provider initialization
9. Storage backend not wired to snapshot manager

### High Priority Issues (P1 - Week 2)

1. Missing SDK documentation for 8 providers
2. No circuit breaker pattern for failing providers
3. Rate limiting not applied to all endpoints
4. Input validation missing on many API routes
5. Metrics counters not incremented on operations
6. WebSocket terminal not connected from frontend
7. Email alerts not implemented for failures
8. Quality scoring returns dummy values
9. Database integration incomplete (in-memory only)
10. No audit logging for security events
11. Missing MFA support
12. No account lockout for brute force protection

---

## Phase 1: Critical Security & Functionality (Week 1)

**Goal:** Fix all P0 issues that block production deployment  
**Estimated Time:** 32 hours  
**Risk Level:** LOW (isolated changes, backward compatible)

### Task 1.1: Fix Provider Initialization with Retry (4 hours)

**File:** `lib/sandbox/providers/index.ts`  
**Severity:** CRITICAL  
**Complexity:** MEDIUM

**Problem:**
Providers registered with factory functions but never properly initialized. `available` flag stays false on error with no retry.

**Implementation Steps:**

1. Add `healthy`, `initializing`, `initPromise`, `failureCount` fields to `ProviderEntry` interface
2. Rewrite `getSandboxProvider()` with:
   - Race condition prevention (check `initializing` flag)
   - Retry logic with exponential backoff (3 attempts)
   - Health check execution after initialization
   - Proper error messages

3. Add `getSandboxProviderWithFallback()` function for automatic failover

**Code Diff:** See `docs/review-results.md` - Issue 1.1

**Tests:**
- `__tests__/sandbox/providers/index.test.ts` - Provider initialization
- `__tests__/sandbox/providers/fallback.test.ts` - Fallback chain

**Rollback Plan:**
- Revert to previous `getSandboxProvider()` implementation
- No breaking changes to existing API

**Acceptance Criteria:**
- [ ] Provider initializes on first call
- [ ] Retries 3 times on failure
- [ ] Prevents race conditions
- [ ] Tracks health separately from availability
- [ ] Falls back to next provider on failure

---

### Task 1.2: Add Health Checks to All Providers (8 hours)

**Files:** All provider files in `lib/sandbox/providers/`  
**Severity:** HIGH  
**Complexity:** MEDIUM

**Problem:**
No provider has `healthCheck()` method. Cannot detect unhealthy providers.

**Implementation Steps:**

For each provider (Daytona, E2B, Runloop, Blaxel, Sprites, CodeSandbox, Microsandbox, Mistral):

1. Add `healthCheck()` method to provider class
2. Implement provider-specific health check logic
3. Update provider registry to call health checks during initialization
4. Add periodic health check interval (every 30 seconds)

**Example (Daytona):**
```typescript
async healthCheck(): Promise<{ healthy: boolean; latency?: number }> {
  const startTime = Date.now();
  try {
    await this.client.list();  // API call as health check
    return { healthy: true, latency: Date.now() - startTime };
  } catch (error: any) {
    return { healthy: false, latency: Date.now() - startTime };
  }
}
```

**Tests:**
- `__tests__/sandbox/providers/daytona-provider.test.ts`
- `__tests__/sandbox/providers/e2b-provider.test.ts`
- (Repeat for each provider)

**Rollback Plan:**
- Health checks are additive - no rollback needed

**Acceptance Criteria:**
- [ ] All 8 providers have `healthCheck()` method
- [ ] Health checks run during initialization
- [ ] Periodic health checks every 30 seconds
- [ ] Unhealthy providers marked in registry

---

### Task 1.3: Implement Fallback Chain (4 hours)

**File:** `lib/sandbox/providers/index.ts`, `lib/sandbox/core-sandbox-service.ts`  
**Severity:** HIGH  
**Complexity:** LOW

**Problem:**
No automatic fallback when primary provider fails.

**Implementation Steps:**

1. Add `getSandboxProviderWithFallback()` function
2. Update `core-sandbox-service.ts` to use fallback chain
3. Log provider failures for monitoring

**Code Diff:** See `docs/review-results.md` - Issue 1.3

**Tests:**
- `__tests__/sandbox/providers/fallback.test.ts`

**Rollback Plan:**
- Wrap fallback logic in feature flag
- Default to single provider if flag disabled

**Acceptance Criteria:**
- [ ] Automatically tries next provider on failure
- [ ] Logs all provider failures
- [ ] Returns error only when all providers fail
- [ ] Respects provider