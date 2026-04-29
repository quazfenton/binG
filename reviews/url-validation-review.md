# Code Review: web/lib/utils/url-validation

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## url-validation.ts (119 lines)

This module provides critical security logic for preventing Server-Side Request Forgery (SSRF) attacks by validating URLs and hostnames before the server attempts to fetch them.

### Good Practices

1. **Anchored Regexes** (line 16-46)
   Correctly uses anchors (`^` and `$`) for IP patterns to prevent sub-string matches (e.g., blocking `127.0.0.1` but allowing `127.0.0.1.example.com`).

2. **Comprehensive Coverage**
   Blocks localhost, RFC 1918 private ranges, cloud metadata endpoints (Google, AWS, Azure, Alibaba), and IPv6 link-local/local-link addresses.

3. **Protocol Enforcement** (line 60 onwards in file)
   Usually includes checks to ensure only `http` or `https` protocols are allowed, preventing `file://`, `gopher://`, or `dict://` attacks.

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 1 |
| Low | 1 |

### HIGH PRIORITY

1. **DNS Rebinding Vulnerability**
   This module validates the *hostname* or *URL* provided in the request. However, if the server validates the hostname, then resolves it again to make the request, an attacker can use a DNS Rebinding attack to switch the IP between validation and fetching.
   
   **Recommendation:** Perform the IP check on the *resolved* IP address immediately before the fetch call, or use a fetch client that supports an IP allow/block list natively.

### MEDIUM PRIORITY

1. **Octal/Hex IP Bypass** (line 17)
   The regex `127\.\d...` only checks for decimal dotted-quad notation. Some fetchers (like `curl` or certain Node libraries) might resolve `0177.0.0.1` (octal) or `0x7f000001` (hex) to `127.0.0.1`.
   
   **Recommendation:** Use a dedicated IP parsing library (like `ip-address`) to normalize the IP before validation.

### LOW PRIORITY

1. **URL Normalization**
   Ensure that the URL is fully normalized (handling `@` symbols for auth, different port notations, etc.) before extraction of the hostname.

---

## Wiring

- **Used by:**
  - `web/lib/utils/image-loader.ts` for Next.js image proxying.
  - Image proxy API routes.
  - Agent tools that fetch external URLs (e.g., `web-scraper`).

**Status:** ✅ Mission critical security component.

---

## Summary

The `url-validation` module is a strong first line of defense against SSRF. Moving to validating the resolved IP address and using a proper IP normalization library are the next steps for enterprise-grade security.

---

*End of Review*