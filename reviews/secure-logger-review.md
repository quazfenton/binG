# Code Review: web/lib/utils/secure-logger

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## secure-logger.ts (196 lines)

This module is a deprecated wrapper around the unified `logger.ts`, maintained for backwards compatibility with older parts of the codebase.

### Good Practices

1. **Clean Deprecation Pattern** (line 4)
   Clearly indicates that it is deprecated and provides migration instructions to the new unified logger.

2. **Unified Foundation** (line 15)
   Instead of maintaining two separate logging logic paths, it simply wraps the new `Logger` class, ensuring that even legacy code benefits from current redaction and formatting improvements.

3. **Secure by Default** (line 47)
   Forces the `secure: true` flag in the underlying logger, maintaining the security guarantee expected by legacy callers.

### Issues

| Severity | Count |
|----------|-------|
| Low | 1 |

### LOW PRIORITY

1. **Inconsistent Naming** (line 43)
   It maps the old `prefix` config to the new `source` field. This is fine for compatibility but can be confusing in cross-service logs if not documented.

---

## Wiring

- **Used by:**
  - Older modules in `web/lib` that haven't been migrated to the unified `createLogger`.
  - Integration tests using the legacy API.

**Status:** ✅ Legacy wrapper, functional and safe.

---

## Summary

`secure-logger.ts` is a textbook example of how to handle module deprecation without breaking the system. By delegating all work to the new unified logger, it avoids code duplication while preserving the old API.

---

*End of Review*