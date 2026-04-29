# Code Review: web/lib/zine-rss-auto-discovery

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## zine-rss-auto-discovery.ts (450 lines)

This module handles the discovery of RSS/Atom feeds from arbitrary URLs, including support for common platforms and HTML-based auto-detection.

### Good Practices

1. **Multi-Strategy Discovery** (line 5-7)
   Combines `<link>` tag detection, platform-specific URL mapping (`PLATFORM_FEEDS`), and brute-force path testing.

2. **Reliability Scoring** (line 25)
   Assigns a reliability score to discovered feeds, allowing the UI to surface high-confidence sources first.

3. **Validation Support** (line 28)
   Includes a `FeedValidation` interface to verify that a discovered URL actually contains valid, parseable feed items.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 3 |

### MEDIUM PRIORITY

1. **Blocking Network Calls** (line 35)
   If multiple discovery attempts are made in parallel for "heavy" sites (those with many redirects or large HTML payloads), the server's outgoing network bandwidth or concurrent request limit could be hit.
   
   **Recommendation:** Use a specialized fetching service with strict timeouts and concurrency limits (e.g., using `p-limit`).

### LOW PRIORITY

1. **Hardcoded Platform Feeds** (line 41)
   The `PLATFORM_FEEDS` mapping is static. If a platform changes its RSS URL (e.g., Substack or YouTube), it requires a code change. Consider moving this to a database or a remote config file.
2. **Regex-based Parsing**
   If regex is used to parse the HTML for `<link>` tags, it can be fragile against poorly formatted HTML. Use a proper DOM parser like `cheerio` or `linkedom`.
3. **Missing Proxy Support**
   Some RSS feeds are geoblocked or have strict bot detection. Support for an optional proxy would improve discovery reliability.

---

## Wiring

- **Used by:**
  - `web/lib/zine/zine-display-service.ts` for adding new sources.
  - Zine "Add Feed" UI component.

**Status:** ✅ Highly useful utility for the Zine feature.

---

## Summary

The RSS auto-discovery module is a well-engineered tool that simplifies the process of finding content sources. Moving to an external configuration for platform feeds and using a dedicated DOM parser would enhance its robustness.

---

*End of Review*