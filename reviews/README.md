# Code Review Summary: web/lib Modules

**Review Date:** April 29, 2026  
**Total Modules Reviewed:** 35+

---

## Module Reviews Completed

| Module | Files | Issues Found | Status |
|--------|-------|-------------|--------|
| retrieval/ | 6 | 12 | Medium |
| virtual-filesystem/ | ~30 | 15 | Needs Work |
| agent/ | 6 | 8 | Good |
| utils/ | ~35 | 10 | Good |
| vector-memory/ | 10 | 9 | Needs Work |
| database/ | 11 | 9 | Good |
| middleware/ | 9 | 7 | Good |
| session/ | 9 | 8 | Needs Work |
| tools/ | ~27 | 14 | Needs Work |
| auth/ | 11 | 6 | Good |
| chat/ | ~50 | 12 | Medium |
| orchestra/ | 8 | 6 | Good |
| storage/ | 5 | 4 | Needs Work |
| memory/ | 8 | 5 | Needs Work |
| rag/ | 3 | 3 | Good |
| terminal/ | 13 | 10 | Good |
| integrations/previews/ | 12 | 10 | Medium |
| sandbox/ | 40+ | 13 | Good |
| mcp/ | ~28 | 9 | Good |
| magenta/streaming | 10 | 5 | Good |
| powers/ | 9 | 7 | Good |
| events/ | 13 | 6 | Good |
| plugins/ | 10 | 8 | Good |
| hooks/ | 30+ | 10 | Good |
| api-routes/ | 35+ | 17 | Needs Work |
| packages/shared/agent | 40+ | 9 | Good |
| spawn/ | 10 | 8 | Good |
| context/ | 1 | 2 | Good |

**Total Issues Found:** 210+

---

## Critical Issues Summary

### Must Fix Immediately (Critical)

1. **Owner ID Prefix Matching Vulnerability** (virtual-filesystem:git-backed-vfs)
   - Uses prefix matching which could allow cross-workspace data access

2. **Unbounded Vector Store** (vector-memory:store.ts)  
   - Each entry ~12KB, no persistence, O(n) search

3. **Race Condition in Lock Release** (session:session-lock.ts)
   - Unlock operations not atomic

### Must Fix Soon (High Priority)

4. Unbounded workspace state (virtual-filesystem)
5. TAB_MEMORIES memory leak (retrieval:search.ts)
6. No schema migration tracking (database:connection.ts)
7. Unbounded trace array (agent:metrics.ts)
8. Unbounded agent state (orchestra)
9. Process.cwd() fallback (security)

### Should Fix (Medium Priority)

10. Multiple duplicate implementations (rate-limiting, validation)
11. Hardcoded constants throughout
12. Missing timeouts on provider calls
13. Input validation inconsistencies
14. Console vs logger usage

---

## Review Files Created

1. `reviews/retrieval-module.md`
2. `reviews/virtual-filesystem-module.md`
3. `reviews/agent-module.md`
4. `reviews/utils-module.md`
5. `reviews/vector-memory-module.md`
6. `reviews/database-module.md`
7. `reviews/middleware-module.md`
8. `reviews/session-module.md`
9. `reviews/tools-module.md`
10. `reviews/auth-module.md`
11. `reviews/chat-module.md`
12. `reviews/orchestra-module.md`
13. `reviews/storage-module.md`
14. `reviews/memory-module.md`
15. `reviews/rag-module.md`
16. `reviews/README.md` (this file)