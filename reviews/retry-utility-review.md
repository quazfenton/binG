# Code Review: web/lib/utils/retry

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## retry.ts (330 lines)

This utility provides a robust implementation of the exponential backoff pattern for retrying asynchronous operations, including built-in support for HTTP status codes and jitter.

### Good Practices

1. **Jitter Support** (line 23)
   Includes jitter to prevent the "thundering herd" problem, where multiple clients retry at the exact same time, further overwhelming the server.

2. **Smart Default Retryable Codes** (line 44)
   Correctly identifies standard retryable HTTP errors (`408`, `429`, `500`, `502`, `503`, `504`).

3. **Flexible Options**
   Allows overriding maximum attempts, delays, and specific error types per call.

### Issues

| Severity | Count |
|----------|-------|
| Low | 2 |

### LOW PRIORITY

1. **Error Type Checking** (line 50)
   Checking `error.message` for specific strings can be fragile if the upstream library changes its error messages. Using `error.code` or `instanceof` checks is safer.
2. **Synchronous Sleep**
   The `sleep` function uses `setTimeout`. In extremely high-concurrency environments, thousands of pending timeouts can impact the Node.js timer queue.

---

## Wiring

- **Used by:**
  - `web/lib/vector-memory/` for API retries.
  - `web/lib/auth/` for token refresh.
  - `web/lib/image-generation/`.

**Status:** ✅ Mission critical reliability utility.

---

## Summary

The `retry` utility is a textbook implementation of a necessary cloud-native pattern. Its inclusion of jitter and sensible HTTP defaults makes it a very strong utility.

---

*End of Review*