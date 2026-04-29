# Code Review: web/lib/utils/request-deduplicator

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## request-deduplicator.ts (255 lines)

This module prevents duplicate in-flight requests for the same data, reducing server load and preventing race conditions.

### Good Practices

1. **In-Flight Merging** (line 19)
   Correctly stores the `Promise` itself. Multiple callers receive the same Promise, ensuring they all resolve at the same time with the same data.

2. **TTL and MaxPending** (line 39-40)
   Includes safeguards to prevent the pending request map from growing indefinitely.

3. **Abort Signal Integration** (line 22)
   Tracks `AbortController`, which is useful for cleaning up network resources if a request is no longer needed.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 2 |

### MEDIUM PRIORITY

1. **JSON Stringify Key Collision** (line 50)
   ```typescript
   return `${method}:${endpoint}:${body ? JSON.stringify(body) : ''}`;
   ```
   If the `body` is extremely large (e.g., a multi-MB file write), `JSON.stringify` will be slow and the resulting key will be massive, consuming significant memory in the `pendingRequests` Map.
   
   **Recommendation:** Use a hash of the body (e.g., MD5 or SHA-256) instead of the raw stringified JSON for the key.

### LOW PRIORITY

1. **Serialization Order**
   `JSON.stringify` does not guarantee key order. `{a: 1, b: 2}` and `{b: 2, a: 1}` will produce different keys, failing to deduplicate identical requests with different key orders.
2. **Cleanup Frequency**
   The periodic cleanup should be carefully tuned to avoid overhead if the `maxPending` limit is rarely reached.

---

## Wiring

- **Used by:**
  - Client-side data fetching hooks.
  - VFS service to prevent double-reads.

**Status:** ✅ Solid optimization utility.

---

## Summary

The `request-deduplicator` is a valuable utility for reducing redundant work. Moving to hashed keys and ordered JSON serialization are the primary improvements needed for enterprise-scale usage.

---

*End of Review*