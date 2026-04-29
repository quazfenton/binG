✅ ALL FINDINGS RESOLVED — No further action needed.
# Code Review: web/lib/crewai/knowledge

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## knowledge/index.ts (335 lines)

This module provides the RAG (Retrieval-Augmented Generation) capabilities for CrewAI agents, allowing them to search across PDFs, websites, and local directories.

### Good Practices

1. **Pluggable Embedders** (line 40)
   Uses an `EmbeddingProvider` interface, allowing easy switching between OpenAI and local/custom embedding models.

2. **Source Diversity** (line 12)
   Supports a wide range of input types (`pdf`, `website`, `directory`, `text`).

3. **Structured Chunking** (line 17)
   Includes `chunkIndex` and `metadata` in document chunks, which is essential for preserving context during retrieval.

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 2 |
| Low | 2 |

### HIGH PRIORITY

1. **Missing Vector Store Integration**
   The current implementation appears to handle embeddings but doesn't explicitly show integration with a persistent vector store (like the `lib/vector-memory` module). If it recalculates embeddings on every search or stores them in-memory, it will be extremely slow and expensive for large knowledge bases.
   
   **Recommendation:** Strictly integrate with `lib/vector-memory` or a dedicated DB for persistent storage of knowledge embeddings.

### MEDIUM PRIORITY

1. **Website Scraping Brittleness** (line 12)
   Scraping websites directly during agent execution is prone to failures (timeouts, bot detection, dynamic content).
   
   **Recommendation:** Use the `lib/web-scraper` module (which handles these edge cases) instead of a custom implementation.

2. **Recursive Directory Reading**
   Reading entire directories into knowledge without exclusion patterns (like `.git` or `node_modules`) can lead to massive token bloat and performance degradation.

### LOW PRIORITY

1. **Hardcoded OpenAI Defaults** (line 50)
   The `text-embedding-3-small` model is hardcoded as a default.
2. **Chunking Logic**
   The chunking logic (further down in the file) should ideally use the `lib/vector-memory/chunking` utilities for consistency across the project.

---

## Wiring

- **Used by:**
  - `web/lib/crewai/crew/crew.ts` to provide context to agents.

**Status:** ✅ Functional but could benefit from deeper integration with the project's specialized RAG/Scraping modules.

---

## Summary

The `knowledge` module provides essential context to agents. Its biggest improvement area is moving from ad-hoc embedding management to using the centralized `vector-memory` and `web-scraper` infrastructure already available in the project.

---

*End of Review*