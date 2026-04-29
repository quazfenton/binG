# Code Review: web/lib/validation

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## validation/schemas.ts (358 lines)

This module provides the central validation logic for the entire application using Zod.

### Good Practices

1. **Anti-Traversal Protection** (lines 26-29)
   ```typescript
   .refine(
     (path) => !path.includes('..'),
     'Path cannot contain directory traversal (..)'
   )
   ```
   Essential for filesystem security.

2. **Null Byte Check** (lines 30-33)
   Prevents common exploit patterns.

3. **Strict Session ID Schemas**
   Uses UUID/ULID patterns for session IDs.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 2 |

### MEDIUM PRIORITY

1. **Path Traversal Bypass Risk** (line 27)
   ```typescript
   !path.includes('..')
   ```
   While effective for many cases, this doesn't account for URL-encoded traversal (`%2e%2e`) or alternate encodings if the consumer decodes them later.
   
   **Recommendation:** Use a normalization helper before validation or add checks for encoded traversal patterns.

### LOW PRIORITY

1. **Double Slash Restriction** (line 35)
   `path.includes('//')` might block valid network paths or double-slashed protocols if they ever appear in this schema context.
2. **Path Length** (line 25)
   Max 500 characters might be too restrictive for deeply nested enterprise projects.

---

## Wiring

- **Used by:**
  - Most API routes for request body validation.
  - Virtual Filesystem for path sanitization.

**Status:** ✅ Mission critical and properly wired.

---

## Summary

The validation module is a robust foundation for security. Strengthening the traversal check against encoding bypasses is the main recommendation.

---

*End of Review*