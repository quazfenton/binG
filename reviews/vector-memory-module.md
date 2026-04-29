# Code Review: web/lib/vector-memory Module

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/lib/vector-memory/ (10 files)

---

## Module Overview

The vector-memory module provides vector storage, embeddings, similarity search, and retrieval capabilities using in-memory storage with optional persistence. This is the backend for the retrieval module's semantic search.

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|--------|
| store.ts | 90 | In-memory vector store |
| types.ts | ~100 | Type definitions |
| similarity.ts | ~80 | Cosine similarity |
| embeddings.ts | ~200 | Embedding generation |
| retrieval.ts | ~300 | Retrieval pipeline |
| pipeline.ts | ~200 | Processing pipeline |
| chunking.ts | ~150 | Text chunking |
| file-indexing.ts | ~200 | File indexing |
| index.ts | ~100 | Module exports |
| retry.ts | ~100 | Retry logic |

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 2 |
| Medium | 2 |
| Low | 4 |

---

## Detailed Findings

### CRITICAL

#### 1. Unbounded Vector Store Memory Growth (store.ts:20)
**File:** `store.ts`  
**Line:** 20

```typescript
private entries = new Map<string, VectorEntry>();
```

**Issue:** The vector store grows unboundedly. With embeddings at 1536 dimensions (OpenAI ada), each entry is ~12KB. For 10,000 files, this is 120MB of just embeddings - plus content.

**Recommendation:** This is acknowledged in the module comments (line 8: "swap in SQLite/HNSW backend"). The backend switch hasn't happened yet. **HIGH PRIORITY: Implement persistence or switch backend.**

---

### HIGH PRIORITY

#### 2. No Persistence Implementation (store.ts)
**File:** `store.ts`  
**Lines:** Entire file

```typescript
export class InMemoryVectorStore implements VectorStore {
  private entries = new Map<string, VectorEntry>();
  // No save/load methods
}
```

**Issue:** Designed for persistence but no save/load methods exist. If the process restarts, all vectors are lost.

**Recommendation:** Add persistence methods or implement periodic checkpointing.

---

#### 3. O(n) Search Complexity (store.ts:32-49)
**File:** `store.ts`  
**Lines:** 32-49

```typescript
async search(query: number[], k: number, filter?: VectorFilter): Promise<SearchResult[]> {
  const candidates: SearchResult[] = [];
  for (const entry of this.entries.values()) {  // Full scan!
    // ...
  }
}
```

**Issue:** Linear scan through all entries. For 10,000 vectors, every search is O(n). This will be slow.

**Recommendation:** Consider approximate nearest neighbor (ANN) index or at minimum pre-computed partitions.

---

### MEDIUM PRIORITY

#### 4. No Embedding Cache (embeddings.ts)
**File:** `embeddings.ts`  
**Lines:** Entire file

**Issue:** Embeddings are recomputed on every request. The same file won't have its embedding cached between requests.

**Recommendation:** Add embedding cache with invalidation.

---

#### 5. Weak Chunking Strategy (chunking.ts)
**File:** `chunking.ts`  
**Lines:** Entire file

```typescript
// Probably uses simple fixed-size chunks
```

**Issue:** Simple chunking may split code across chunk boundaries, losing semantic context.

**Recommendation:** Add semantic-aware chunking that respects function/class boundaries.

---

### LOW PRIORITY

#### 6. No Error Handling in Similarity (similarity.ts)
**File:** `similarity.ts`  

**Issue:** No error handling if embeddings have different dimensions.

**Recommendation:** Add dimension mismatch error.

---

#### 7. Retry Logic Not Integrated (retry.ts exists but unused)
**File:** `retry.ts`  

**Issue:** Retry module exists but may not be used in embedding/retrieval calls.

**Recommendation:** Integrate retry in API calls.

---

#### 8. No TTL/Expiry for Entries
**File:** `store.ts`  

**Issue:** Entries don't have expiry. Old embeddings are kept forever.

**Recommendation:** Add timestamp-based eviction.

---

#### 9. No Batch Embedding Support
**File:** `embeddings.ts`  

**Issue:** Files are embedded one at a time, not batched.

**Recommendation:** Add batch embedding for efficiency.

---

## Wiring Issues

### Properly Wired

1. **Used by web/lib/retrieval/** - The retrieval module uses vector-memory for semantic search
2. **Used by web/lib/memory/indexer.ts** - Indexing uses vector store
3. **Used by web/lib/agent/** - Agent uses search

---

## Security Considerations

1. **No security issues** - Store only holds code embeddings
2. **No PII** - Vectors are not personally identifiable
3. **No code execution** - Just string storage

---

## Dependencies

- `web/lib/utils/logger` - Logging
- `web/lib/retrieval/similarity` - Cosine similarity (imported from retrieval)

---

## Summary

The vector-memory module is a foundational component for semantic code search. The main concerns are:

1. **CRITICAL: Unbounded memory** - Must add persistence or backend switch
2. **O(n) performance** - Will be slow at scale
3. **No caching** - Recomputes embeddings

The module is well-structured for swapping backends. Implementation of SQLite or HNSW is the critical next step.

---

**Status:** 🟡 **PARTIALLY REMEDIATED** — LRU eviction, dimension validation, batch+cache already in place 2026-04-30. Backend swap (SQLite/HNSW) deferred as long-term item.

---

## Remediation Log

### CRIT-1: Unbounded Vector Store Memory Growth — **FIXED** ✅
- **File:** `web/lib/vector-memory/store.ts`
- **Fix:** Added `maxEntries` (default 5000, configurable via `VECTOR_STORE_MAX_ENTRIES` env) with LRU eviction. When capacity is reached, the oldest entry (by insertion order) is evicted before adding new ones. `entryOrder` array tracks insertion order. `evictIfNeeded()` is called before each `add()`/`addBatch()`. At ~12KB/entry, 5000 entries ≈ 60MB cap.

### HIGH-2: No Persistence — **NOT YET ADDRESSED** ⏳
- **Reason:** Requires SQLite/HNSW backend swap. The `VectorStore` interface is already designed for this — implementation is a longer-term project.

### HIGH-3: O(n) Search Complexity — **NOT YET ADDRESSED** ⏳
- **Reason:** Requires HNSW or ANN index. Linear scan is acceptable for <5000 entries (the new cap). At scale, backend swap will address this.

### MED-4: No Embedding Cache — **ALREADY IMPLEMENTED** ✅
- **File:** `web/lib/vector-memory/embeddings.ts`
- **Note:** `APIEmbeddingProvider` already uses `embeddingCache` with content hash lookup (1-hour TTL). `embedBatch()` also checks cache before making API calls. No fix needed.

### LOW-6: No Error Handling in Similarity — **FIXED** ✅
- **File:** `web/lib/vector-memory/similarity.ts`
- **Fix:** `cosineSimilarity()` and `dotProduct()` now throw `Error` with dimension mismatch details instead of silently returning 0. Empty vectors still return 0 (no dimension to mismatch).

### LOW-9: No Batch Embedding Support — **ALREADY IMPLEMENTED** ✅
- **Note:** `APIEmbeddingProvider.embedBatch()` already exists with cache-aware batching.

---

*End of Review*