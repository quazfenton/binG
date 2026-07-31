# BUG2-CROSS-PROCESS-FC-CACHE — FC-GATE positive cache cross-process gap (DEFERRED 2026-07-22)

> **Ticket ID:** `BUG2-CROSS-PROCESS-FC-CACHE`
> **Status:** 🟡 Open / deferred from Bug 2 closure epic
> **Opened:** 2026-07-22
> **Priority:** 🟡 P2 (cross-process symptom already documented for the reaper; this is the symmetrical cold-start issue)
> **Sibling:** `/opt/bing/.tickets/BUG2-CROSS-PROCESS-REAPER.md` (cover zombie-stream reaping cross-process gap)
> **Cross-ref:** `/opt/bing/.tickets/BUG2-ZOMBIE-STREAM-REAPER.md` (closure narrative epic)

---

## Executive Summary

The Bug 2 zombie-stream reaper closure made the cross-process gap explicit for `__activeStreams__`. The **same globalThis-singleton pattern** appears at **two other sites**:

1. **FC-GATE positive cache** — `/opt/bing/web/lib/chat/vercel-ai-streaming.ts:L155`:
   ```ts
   declare global { var __fcGatePositiveCache__: Map<string, { confirmedAt: number; provider: string }> | undefined; }
   const fcGatePositiveCache = globalThis.__fcGatePositiveCache__ ?? (globalThis.__fcGatePositiveCache__ = _fcGatePositiveCache);
   ```
   Each process has its own cache; `ninerouter`'s positive-cache hits are invisible to the Hono backend's cache. A model confirmed FC-capable in `ninerouter` still triggers a 2-phase strategy in the Hono backend (the cold-start cost) on its first request.

2. **FC-GATE known-models sets** — `/opt/bing/web/lib/chat/vercel-ai-streaming.ts` (later sections of the same file) include `KNOWN_FC_CAPABLE_MODELS` and `KNOWN_FC_INCAPABLE_MODELS` as module-private Sets. These are process-scoped but acceptable — they're hardcoded constants with no drift surface. The positive cache IS the drift surface.

3. **fcGatePositiveCache** in `/opt/bing/web/lib/chat/enhanced-llm-service.ts` (CLI binary path) — a parallel cache for the Vercel-AI fallback. Same cross-process gap as the primary cache.

---

## Symptom vs. sibling ticket

| Ticket | Cross-process symptom | Severity | Visible impact |
|---|---|---|---|
| `BUG2-CROSS-PROCESS-REAPER.md` | Zombie streams in ninerouter never reaped by Hono backend | Latent — reaper doesn't catch zombies from ninerouter | 19+ min zombie events in proxy'd traffic |
| **`BUG2-CROSS-PROCESS-FC-CACHE.md`** (this) | FC-capability confirmation doesn't propagate across processes | Repeated cold-start cost | 2-phase strategy fires on every first-request per process |

---

## Shared root cause

Both tickets share the same architectural fix path:
- Migrate the singleton state from per-process globalThis to a cross-process store (Redis or similar)
- OR migrate to a per-process liveness heartbeat across processes
- OR centralize the supervision into a dedicated worker process

## Recommended implementation: SHARED-PHASE EPIC

Suggested approach: bundle `BUG2-CROSS-PROCESS-REAPER.md` + this ticket into a single Phase-2 cross-process epic. Both are symptoms of the same architectural gap (globalThis singletons for process-shared state not surviving process boundaries).

Suggested epic folder: `/opt/bing/.tickets/CROSS_PROCESS_GLOBALTHIS_EPIC.md` to track both workstreams.

---

## Acceptance criteria (after implementation)

- vitest confirms cross-process cache behavior via simulated message bus (no live-multi-process harness needed)
- Existing `__tests__/chat/zombie-stream-reaper.test.ts` (18 tests) remains green
- New `__tests__/chat/fc-gate-cache-cross-process.test.ts` covers: cache hit in process A → process B sees the hit via shared store on next request.

---

## Verification

```bash
cd /opt/bing/web
# Confirm existing reaper + fc-gate tests still pass
timeout 90 npx vitest run __tests__/chat/zombie-stream-reaper.test.ts
timeout 90 npx vitest run __tests__/chat/__fc-gate-cache__.test.ts  # whatever exists
# After implementation: confirm new cross-process cache test passes
timeout 90 npx vitest run __tests__/chat/fc-gate-cache-cross-process.test.ts
```

**Stable anchor:** `#bug2-cross-process-fc-cache-2026-07-22`
