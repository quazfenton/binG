✅ ALL FINDINGS RESOLVED — No further action needed.
# Code Review: web/lib/utils/image-loader

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## image-loader.ts (227 lines)

This module provides a custom Next.js `ImageLoader` that incorporates runtime SSRF protection, ensuring that the application doesn't accidentally proxy malicious or internal image URLs.

### Good Practices

1. **Integrated SSRF Protection** (line 18-48)
   Duplication of the SSRF blocklist from `url-validation.ts` (or direct reuse) ensures that even if the main validation is bypassed, the image loader provides a second layer of defense.

2. **Credential Injection Blocking** (line 12)
   Explicitly checks for and blocks URLs containing credentials (e.g., `http://user:pass@example.com`), which are a common attack vector for certain fetchers.

3. **Whitelist Support** (line 50)
   Includes an `ALLOWED_PATTERNS` list (inferred) to restrict image sources to trusted CDNs.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 2 |

### MEDIUM PRIORITY

1. **Code Duplication with `url-validation.ts`**
   The `BLOCKED_PATTERNS` array is identical to the one in `url-validation.ts`. If one is updated (e.g., to add a new cloud provider metadata endpoint) and the other is not, the application will have a security inconsistency.
   
   **Recommendation:** Centralize the SSRF blocklist and validation logic into a single shared utility in `lib/security` or `lib/utils` and import it into both the image loader and the URL validator.

### LOW PRIORITY

1. **Regex Performance**
   Like the `file-access-blocker`, running 20+ regex checks on every image load can be optimized.
2. **Missing JSDoc on Allowed Sources**
   Document the process for adding new trusted image CDNs for other developers.

---

## Wiring

- **Used by:**
  - `next.config.js` or directly in `Image` components as a `loader` prop.
  - Generative UI components that display external images.

**Status:** ✅ Mission critical security component.

---

## Summary

The `image-loader` is a vital security component. Centralizing the SSRF logic to avoid duplication and ensure consistency is the main architectural recommendation.

---

*End of Review*