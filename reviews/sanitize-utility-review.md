# Code Review: web/lib/utils/sanitize

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## sanitize.ts (67 lines)

This module provides basic input sanitization utilities, primarily focused on removing control characters and null bytes from user-provided strings and URLs.

### Good Practices

1. **Control Character Blocking** (line 16)
   Strictly rejects URLs containing non-printable control characters, which are often used in obfuscation and injection attacks.

2. **Decoding Check** (line 24)
   Correctly decodes URLs *before* checking for blocked characters, preventing bypasses where the malicious character is URL-encoded.

3. **ASCII-only Fallback** (line 33)
   If decoding fails, it falls back to a strict ASCII-only check for non-decodable strings.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 1 |

### MEDIUM PRIORITY

1. **Weak Decoding Check** (line 21)
   ```typescript
   const decoded = decodeURI(raw);
   ```
   `decodeURI` does not decode many common characters used in exploits (like `#`, `?`, `/`, `&`). An attacker could encode a malicious character that `decodeURI` misses but the final fetcher library decodes.
   
   **Recommendation:** Use `decodeURIComponent` for strict character checking, or normalize the entire URL using the `URL` constructor before validation.

### LOW PRIORITY

1. **Partial Sanitization** (line 46)
   The `replace` pattern only removes a subset of control characters. It misses several others (like `\x7f` DEL).

---

## Wiring

- **Used by:**
  - `web/lib/utils/url-validation.ts`.
  - API routes handling user-provided URLs or search terms.

**Status:** ✅ Mission critical security layer.

---

## Summary

The `sanitize` module provides essential protection against low-level injection. Moving to a more comprehensive decoding and normalization strategy would improve its defensive posture.

---

*End of Review*