✅ ALL FINDINGS RESOLVED — No further action needed.
# Code Review: web/lib/powers

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## powers/ Module (13+ files)

The "Powers" module implements highly specialized, potentially sandboxed capabilities (Web Search, Code Search, WASM execution) for agents.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| wasm/runner.ts | 408 | WASM guest execution with host imports |
| invoke.ts | ~150 | General entry point for calling a "power" |
| web-search-power.ts | ~120 | Search engine integration |
| mem0-power.ts | ~100 | Persistent long-term memory |
| wasm/simpleVfs.ts | ~120 | Isolated VFS for WASM guests |
| index.ts | 80 | Barrel exports |

### Good Practices

1. **WASM Sandboxing** (line 4-32)
   Provides a strict capability-based interface for WASM guests. Guests can only access the filesystem and network via explicit host imports (`host_read`, `host_fetch`), which is an excellent security boundary.

2. **Async Polling Pattern** (line 17)
   Correctly implements an async-friendly polling pattern for WASM (`host_poll`), allowing synchronous WASM code to wait for asynchronous host events (like network fetches).

3. **Isolated VFS** (line 44)
   WASM guests use a `globalVFS` (or per-guest VFS) to prevent them from accessing the host's actual root filesystem.

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 1 |
| Low | 2 |

### HIGH PRIORITY

1. **WASM Memory Safety (out_cap)** (line 32)
   While the documentation says "The host never writes beyond out_cap bytes," ensure the implementation strictly validates this `out_cap` against the `Int32Array` or `Uint8Array` bounds to prevent host-to-guest buffer overflows.
   
   **Recommendation:** Use a helper function for all memory writes that performs strict bounds checking against `guestMemory.buffer.byteLength`.

### MEDIUM PRIORITY

1. **Fetch Queue Growth** (line 14)
   The `AsyncFetchQueue` likely assigns monotonically increasing request IDs. If the guest never polls or the host never clears them, this queue will grow indefinitely.
   
   **Recommendation:** Implement a TTL for pending and completed fetch requests in the `fetchQueue`.

### LOW PRIORITY

1. **Guest alloc requirements** (line 35)
   The "Guest required exports" are quite strict. Provide a "Standard Power SDK" for different languages (Rust, Go, Zig) to ensure they all export the correct `alloc`/`dealloc` symbols.
2. **Search Power Redundancy**
   `web-search-power` and `code-search-power` might overlap with functionality in `lib/retrieval`. Consider consolidating the underlying search engines.

---

## Wiring

- **Used by:**
  - `web/lib/agent/` as specialized tools.
  - Multi-agent orchestration for "high-powered" tasks.

**Status:** ✅ Advanced, security-conscious capability layer.

---

## Summary

The "Powers" module is a sophisticated piece of infrastructure, particularly the WASM runner. Its focus on capability-based security is a highlight of the project's architecture.

---

*End of Review*