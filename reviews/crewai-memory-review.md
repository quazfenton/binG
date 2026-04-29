# Code Review: web/lib/crewai/agents/memory

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## memory.ts (303 lines)

This module implements the multi-tiered memory architecture for CrewAI agents, covering short-term conversational context, long-term persistence, and entity recognition.

### Good Practices

1. **Multi-Tiered Memory** (line 22)
   Separates memory into `shortTerm`, `longTerm`, and `entity`, allowing for different retrieval strategies for each.

2. **Sliding Window Short-term Memory** (line 39)
   `ShortTermMemory` uses a bounded array with a `maxEntries` limit, preventing context window overflow and memory bloat.

3. **Metadata Support** (line 12)
   Allows attaching structured metadata to memory entries, useful for tracing tool usage or agent reasoning.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 2 |
| Low | 2 |

### MEDIUM PRIORITY

1. **In-Memory Volatility** (line 39)
   The `ShortTermMemory` is strictly in-memory. If a long-running multi-agent session crashes or the server restarts, all short-term context is lost.
   
   **Recommendation:** Optionally back `ShortTermMemory` with Redis or the local `session` store for persistence.

2. **Entity Memory Bloom** (line 15)
   `EntityMemory` stores observations as a string array without deduplication or summarization. If an agent repeatedly observes the same thing, the memory will bloat with redundant text.
   
   **Recommendation:** Use an LLM-based "compaction" step for entity observations periodically.

### LOW PRIORITY

1. **Non-Cryptographic IDs** (line 47)
   `Math.random()` based IDs are fine for local memory but should be avoided if memory IDs are ever exposed in public APIs.
2. **Missing Search for Short-term Memory**
   `ShortTermMemory` is likely retrieved as a full list. Adding a keyword or semantic search would improve efficiency for long histories.

---

## Wiring

- **Used by:**
  - `web/lib/crewai/agents/role-agent.ts` for each agent instance.
  - `web/lib/crewai/index.ts`.

**Status:** ✅ Solid implementation of agent memory.

---

## Summary

The memory system is well-structured and follows industry best practices for agentic memory. Adding persistence to the short-term tier would significantly improve the robustness of long-running sessions.

---

*End of Review*