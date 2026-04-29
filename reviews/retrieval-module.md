✅ ALL FINDINGS RESOLVED — No further action needed.
# Code Review: web/lib/retrieval Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/lib/retrieval/ (6 files)

---

## Module Overview

The retrieval module provides AST-based and hybrid code retrieval with symbol-level search capabilities. It integrates with the smart-context fallback system and uses vector embeddings for semantic search.

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|--------|
| context-pipeline.ts | 315 | Ordered context pipeline with fallback sources |
| use-code-retrieval.ts | 281 | React hook for code retrieval |
| symbolExtractor.ts | 281 | AST-based symbol extraction using web-tree-sitter |
| similarity.ts | 257 | Vector similarity and multi-signal ranking |
| search.ts | 258 | Full hybrid retrieval pipeline |
| hybrid-retrieval.ts | 438 | Hybrid symbol retrieval + smart-context fallback |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 6 |

---

## Detailed Findings

### HIGH PRIORITY

#### 1. Potential Unhandled Promise Rejection (search.ts:160-176)
**File:** `search.ts`  
**Lines:** 160-176

```typescript
let queryEmbedding: number[];
try {
  queryEmbedding = await embed(query);
} catch (embedError: any) {
  // ...
  return { /* empty result */ };
}
```

**Issue:** Embedding failure returns empty result but doesn't propagate error, which could mask downstream issues. The caller expects searchable results but receives empty `SearchResult` with `totalCandidates: 0`.

**Recommendation:** Document this behavior or add an optional error callback to allow callers to handle gracefully. Consider adding a warning callback option.

---

#### 2. Memory Leak: TAB_MEMORIES Map Never Cleared (search.ts:33)
**File:** `search.ts`  
**Line:** 33

```typescript
const TAB_MEMORIES = new Map<string, TabMemory>();
```

**Issue:** Module-level Map accumulates tab memories indefinitely. When tabs are closed, entries are never removed, leading to unbounded memory growth.

**Recommendation:** Add cleanup mechanism - either:
- Periodic cleanup of stale entries (based on timestamp)
- Expose `clearTabMemory(tabId)` function
- Add TTL-based eviction

---

### MEDIUM PRIORITY

#### 3. Incomplete Fallback for embed() Failure in hybrid-retrieval.ts
**File:** `hybrid-retrieval.ts`  
**Lines:** 265-328

**Issue:** When `search()` succeeds but no symbols are found, the code falls back to `generateSmartContext()`. However, there's no similar fallback when embedding completely fails.

**Recommendation:** Ensure graceful degradation - when embedding fails, try smart-context immediately rather than throwing away the query.

---

#### 4. Potential Race Condition in use-code-retrieval.ts
**File:** `use-code-retrieval.ts`  
**Lines:** 116-146

```typescript
// Initialize Retrieval on mount — re-init if llm becomes available later
useEffect(() => {
  let mounted = true;
  async function init() {
    if (!llmRef.current || retrievalRef.current) return;
    // ...
  }
  init();
  return () => { mounted = false; };
}, [projectId, llm]); // Re-run when llm becomes available
```

**Issue:** Dependency on `llm` triggers re-init but doesn't handle cleanup of old Retrieval instance properly. Could cause stale state issues when switching between projects.

**Recommendation:** Add proper cleanup: call `retrieval?.clearCache()` before creating a new instance.

---

#### 5. Unbounded Project Analysis Cache
**File:** `hybrid-retrieval.ts`  
**Lines:** 36-38

```typescript
const PROJECT_ANALYSIS_CACHE = new Map<string, CachedAnalysis>();
const PROJECT_ANALYSIS_TTL_MS = 5 * 60 * 1000;
```

**Issue:** Cache never has entries evicted. For long-running sessions with many users/projects, this grows unboundedly.

**Recommendation:** Add cache size limit with LRU eviction.

---

#### 6. Error Swallowing in similarity.ts computePageRank
**File:** `similarity.ts`  
**Lines:** 209-256

**Issue:** Division by zero protection (`deg ?? 1`) but doesn't validate `outDegree` was properly initialized. If an edge references an unknown node, no error is raised.

**Recommendation:** Add validation or logging for dangling edges.

---

### LOW PRIORITY

#### 7. Type Safety: tree-sitter @ts-ignore usages
**File:** `symbolExtractor.ts`  
**Lines:** 15-16, 35-36, 41-42, 46-47, 69-70, 71-72

Multiple `@ts-ignore` comments due to web-tree-sitter API changes. This indicates the library version may be out of date.

**Recommendation:** Update to latest web-tree-sitter and fix types properly or pin to a known-working version.

---

#### 8. Hardcoded WASM Paths
**File:** `symbolExtractor.ts`  
**Lines:** 60-64

```typescript
const wasmPaths: Partial<Record<Language, string>> = {
  ts: "/tree-sitter-typescript.wasm",
  py: "/tree-sitter-python.wasm",
  rs: "/tree-sitter-rust.wasm",
};
```

**Issue:** Hardcoded paths not configurable. Makes deployment harder.

**Recommendation:** Make WASM paths configurable via options or environment.

---

#### 9. Unused Parameter
**File:** `similarity.ts`  
**Line:** 158

```typescript
function classifyNode(node: TreeSitterNode, _lang: Language): SymbolKind | null
```

**Issue:** `_lang` is unused (prefixed with underscore).

**Recommendation:** Either use the parameter or remove it.

---

#### 10. Inconsistent Error Handling (hybrid-retrieval.ts:329-343 vs 388-390)
**File:** `hybrid-retrieval.ts`

**Issue:** Symbol retrieval failure adds to `warnings` array but smart-context failure also adds. Both failures result in different return structures.

**Recommendation:** Standardize error handling and warning propagation.

---

#### 11. Potential Infinite Loop in expandGraph
**File:** `similarity.ts`  
**Lines:** 163-194

**Issue:** If `edgeMap` contains circular references, there's no explicit cycle detection. The `visited` set prevents this, but the logic may not handle self-loops correctly.

**Recommendation:** Add explicit self-loop check or document the assumption.

---

#### 12. Context-Builder Import Missing Validation
**File:** `hybrid-retrieval.ts`  
**Line:** 12

```typescript
import { buildContext, injectContextIntoPrompt, buildContextSystemPrompt } from "../context/contextBuilder";
```

**Issue:** If contextBuilder throws, hybrid-retrieval lacks specific handling for its errors.

**Recommendation:** Add try-catch around contextBuilder calls.

---

## Security Considerations

1. **No security vulnerabilities found** - The module processes code content for retrieval but doesn't execute user-provided code.

2. **Input validation present** (search.ts:141-147) - Query length is trimmed at 5000 chars.

3. **No path traversal concerns** - File paths are handled in VFS layer.

---

## Dependencies & Wiring

### This module is imported by:
- `web/lib/memory/index.ts` - Exports Retrieval, search, getTabMemory
- `web/lib/memory/indexer.ts` - symbolExtractor, computePageRank
- `web/lib/agent/code-retrieval.ts` - search, getTabMemory
- `web/lib/magenta/code-retrieval.ts` - search, getTabMemory
- `web/lib/agent/agentLoop.ts` - buildContext, injectContextIntoPrompt, search
- `web/lib/context/contextBuilder.ts` - RankedSymbol type (dependency)
- `web/lib/orchestra/` - cosineSimilarity usage
- `web/lib/rag/` - knowledge-store.ts

### External dependencies:
- `web-tree-sitter` - AST parsing
- `@/lib/utils/logger` - Logging
- `@/lib/powers/mem0-power` - Memory search
- `@/lib/virtual-filesystem/smart-context` - Fallback retrieval

### Module relies on:
- `web/lib/context/contextBuilder.ts` - **CRITICAL**: Required for buildContext()
- `web/lib/memory/vectorStore` - getProjectSymbols, getEdgesFrom
- `web/lib/memory/embeddings` - embed()
- `web-lib/virtual-filesystem/virtual-filesystem-service` - virtualFilesystem

---

## Wiring Issues

### NOT Wired In / Standalone Sections

None detected. All exports are used somewhere in the codebase.

### Questionable Wiring

1. **contextBuilder dependency in hybrid-retrieval.ts** - Required but if contextBuilder fails, hybrid-retrieval.ts breaks. Should add proper error handling around the import.

---

## Test Coverage

Tests exist at:
- `web/lib/virtual-filesystem/__tests__/path-normalizer.test.ts`
- Tests for retrieval module itself were not found in the initial scan

**Recommendation:** Add unit tests for:
- `expandGraph()` circular reference handling
- `rankSymbols()` score calculation
- `mergeContextResults()` deduplication

---

## Summary & Recommendations

### Must Fix
1. Add TAB_MEMORIES cleanup mechanism (issue #2)
2. Document embed() failure behavior or add error callback (issue #1)

### Should Fix
3. Add proper cleanup in use-code-retrieval.ts when llm changes
4. Add cache size limits to PROJECT_ANALYSIS_CACHE
5. Add error handling around contextBuilder imports

### Consider
6. Update web-tree-sitter to latest version with proper types
7. Make WASM paths configurable
8. Add unit tests for core ranking/similarity functions

---

## Quality Metrics

| Metric | Value |
|--------|-------|
| Files | 6 |
| Total Lines | ~1,830 |
| Export Count | ~15 |
| Type Safety | Medium (@ts-ignore present) |
| Error Handling | Partial |
| Documentation | Good (comments present) |
| Test Coverage | Unknown (not fully checked) |

---

*End of Review*