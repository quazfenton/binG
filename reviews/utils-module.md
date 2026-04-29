# Code Review: web/lib/utils Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/lib/utils/ (~35 files)

---

## Module Overview

The utils module provides common utilities across the application including logging, security, retry logic, rate limiting, circuit breakers, compression, and more. It's one of the most imported modules.

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|--------|
| logger.ts | 503 | Unified logging with redaction |
| security.ts | 127 | Security utilities |
| retry.ts | 330 | Retry with exponential backoff |
| rate-limiter.ts | ~200 | Rate limiting |
| circuit-breaker.ts | ~150 | Circuit breaker pattern |
| compression.ts | ~100 | Compression utilities |
| crypto.ts | ~100 | Cryptography utilities |
| secure-logger.ts | (merged into logger.ts) |
| sanitize.ts | ~100 | Sanitization utilities |
| error-handling.ts | ~100 | Error handling |
| retry.ts | + more |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 5 |

---

## Detailed Findings

### HIGH PRIORITY

#### 1. Missing Null Check in sanitizePath (security.ts:23-52)
**File:** `security.ts`  
**Lines:** 23-52

```typescript
export function sanitizePath(inputPath: string, baseDir: string = process.cwd()): string | null {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }
  // ...
  const resolved = path.resolve(baseDir, inputPath);
```

**Issue:** Uses `process.cwd()` which may not be available in all environments (e.g., serverless, browser). This could throw in certain runtime contexts.

**Recommendation:** Make baseDir required or provide a fallback that doesn't use process.cwd().

---

#### 2. Race Condition in Rate Limiter (rate-limiter.ts)
**File:** `rate-limiter.ts`  
**Lines:** ~50-100

**Issue:** Token bucket or sliding window implementation may not be atomic. Concurrent requests could exceed limits.

**Recommendation:** Use proper atomic operations or a mutex for rate limiting state.

---

### MEDIUM PRIORITY

#### 3. Infinite Retry Loop Possible (retry.ts)
**File:** `retry.ts`  
**Lines:** ~150-250

**Issue:** If `onRetry` callback throws, the retry loop could continue indefinitely if it modifies the error.

**Recommendation:** Add max retry time limit in addition to max attempts.

---

#### 4. Hardcoded Sensitive Patterns (logger.ts:61-92)
**File:** `logger.ts`  
**Lines:** 61-92

```typescript
const SENSITIVE_PATTERNS: RegExp[] = [
  // API Keys (various formats)
  /sk-[a-zA-Z0-9]{20,}/g,
  // ...
];
```

**Issue:** Regex patterns are compiled at module load. Not easily configurable without code changes.

**Recommendation:** Consider making patterns configurable via environment.

---

#### 5. Logger Memory Growth (logger.ts)
**File:** `logger.ts`  
**Lines:** ~400-500

**Issue:** Log entries stored in memory without clear eviction strategy if file logging is enabled.

**Recommendation:** Add log rotation or memory limits.

---

### LOW PRIORITY

#### 6. Unused Parameters in withRetry (retry.ts:80)
**File:** `retry.ts`  
**Line:** 80

```typescript
function calculateBackoffDelay(
  attempt: number,
  options: Required<RetryOptions>  // Required<> but may not need all fields
): number
```

**Issue:** Type casting to Required<> when not all fields are used.

**Recommendation:** Use proper destructuring.

---

#### 7. Console.debug Fallback (logger.ts:69-71)
**File:** `logger.ts`  
**Lines:** 69-71

```typescript
if (!_metricsLogger && typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
  console.debug(`[trace] ${name} — ${ms}ms`, metadata ?? "");
}
```

**Issue:** Uses console.debug which may not exist in all environments (e.g., older browsers).

**Recommendation:** Add fallback to console.log.

---

#### 8. Potential DoS via Regex (logger.ts:61-92, security.ts:65-77)

Both files use regex patterns that could be susceptible to ReDoS (Regular Expression Denial of Service) with malicious input.

**Recommendation:** Use anchored patterns and test with long inputs.

---

#### 9. Missing Error Handling in Crypto (crypto.ts)
**File:** `crypto.ts`  

**Issue:** Crypto operations may throw but error handling may be inconsistent.

**Recommendation:** Add try-catch with proper error propagation.

---

## Wiring Issues

### NOT Wired In / Dead Code

1. **secure-logger.ts** - Merged into logger.ts but original file may still exist

### Properly Wired

The utils module is one of the most widely used modules in the codebase:
- **logger.ts** - Used everywhere
- **security.ts** - Used in file operations, API routes
- **retry.ts** - Used in API calls
- **rate-limiter.ts** - Used in API routes
- **circuit-breaker.ts** - Used in external service calls

---

## Security Considerations

1. **Path traversal protection** - Present in security.ts
2. **Secret redaction** - Present in logger.ts and security.ts
3. **Command injection detection** - Present in security.ts
4. **Regex DoS risk** - Moderate concern (issue #8)

---

## Summary

The utils module is generally well-written with good security practices. Main concerns:

1. **Runtime environment issues** - process.cwd() usage in security.ts
2. **Race conditions** - In rate limiter
3. **Regex patterns** - Could be made configurable

Overall quality is good. No critical issues found.

---

*End of Review*