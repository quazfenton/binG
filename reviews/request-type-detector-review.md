✅ ALL FINDINGS RESOLVED — No further action needed.
# Code Review: web/lib/utils/request-type-detector

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## request-type-detector.ts (163 lines)

This module implements a two-stage classification system to determine the intent of a user message (e.g., whether it requires a tool, a sandbox, or just a chat response).

### Good Practices

1. **Two-Stage Architecture** (line 4)
   Uses a "fast path" (regex/keywords) first, and only falls back to a "slow path" (LLM) if the confidence is low. This is a critical optimization for latency and cost.

2. **Result Caching** (line 24)
   Includes an LRU-like cache for results, further reducing unnecessary LLM calls for repeated or common queries.

3. **Data-Driven Schema** (line 7)
   Replaces hardcoded logic with a declarative schema, making it easier to maintain and extend.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 2 |

### MEDIUM PRIORITY

1. **Memory Growth in Cache Key generation** (line 28)
   ```typescript
   const content = messages.map(m => `${m.role}:${JSON.stringify(m.content)}`).join('|');
   ```
   If a conversation has 50+ messages, `JSON.stringify` and the resulting large string will consume significant CPU and memory for every detection check.
   
   **Recommendation:** Only use the *last* few messages for intent classification, or use a streaming hash if the full history is truly required.

### LOW PRIORITY

1. **Simple Cache Eviction** (line 34)
   Cleans the *first* 10% of keys. This is a FIFO eviction, which might not be as effective as LRU (Least Recently Used) but is simpler to implement.
2. **Hardcoded Legacy Mapping** (line 45)
   The mapping from the new intent schema to legacy types should be move to a configuration file or the schema definition itself.

---

## Wiring

- **Used by:**
  - `web/app/api/chat/route.ts` to decide which agent pipeline to trigger.
  - Orchestration layer for routing.

**Status:** ✅ Mission critical router.

---

## Summary

The `request-type-detector` is a sophisticated and well-optimized intent engine. Improving the cache key generation for long conversations is the primary recommendation for production stability.

---

*End of Review*