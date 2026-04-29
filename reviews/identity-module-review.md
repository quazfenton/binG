# Code Review: web/lib/identity

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## identity/ Module (2 files)

This module manages the core identity concepts used throughout binG, specifically the "Composite Session ID" which links users to their active coding sessions.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| composite-session-id.ts | 304 | Parsing and building userId$sessionId strings |
| index.ts | 37 | Barrel exports |

### Good Practices

1. **Standardized Identity Format** (line 14)
   Using `${userId}$${sessionId}` as a project-wide convention simplifies cross-module communication (e.g., passing session context from the UI to an MCP tool).

2. **Scope Awareness** (line 31)
   The `CompositeSessionId` interface includes `scopePath`, ensuring that identity is directly tied to filesystem permissions.

3. **Fallback Logic** (line 47)
   Proper handling of "anon" users and default session IDs prevents crashes on malformed input.

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Low | 2 |

### HIGH PRIORITY

1. **Delimiter Collision Risk** (line 14)
   The use of `$` as a delimiter is simple but potentially dangerous if `userId` or `sessionId` can contain `$` (common in some ID generators or federated usernames like `domain$user`).
   
   **Recommendation:** Use a safer delimiter (like `|` or `:`, or a multi-character unique sequence) or strictly validate that input parts do not contain the delimiter.

### LOW PRIORITY

1. **Hardcoded default ID** (line 50)
   `000` as a default session ID might conflict with valid numeric session IDs.
2. **Sync implementation**
   Many parsing functions are synchronous; if session validation ever requires a DB lookup, this entire utility will need to become asynchronous.

---

## Wiring

- **Used by:**
  - `web/lib/virtual-filesystem/` for owner resolution.
  - `web/app/api/mcp/route.ts` for tool context.
  - `web/lib/shadow/` for temporary session commits.

**Status:** ✅ Mission critical and well-integrated.

---

## Summary

The identity module is the "glue" that binds users to sessions. Addressing the delimiter collision risk is important for system robustness as more ID providers are integrated.

---

*End of Review*