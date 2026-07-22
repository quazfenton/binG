# BUG2-CROSS-PROCESS-REAPER — ninerouter separate-process reap (DEFERRED 2026-07-22)

> **Ticket ID:** `BUG2-CROSS-PROCESS-REAPER`
> **Status:** 🟡 Open / deferred from Bug 2 closure (`BUG2-ZOMBIE-STREAM-REAPER.md`)
> **Opened:** 2026-07-22
> **Priority:** 🟡 P2 (production symptom already addressed; cross-process asymmetry is a follow-up)
> **Cross-ref:** `/opt/bing/.tickets/BUG2-ZOMBIE-STREAM-REAPER.md` → closure narrative item ⑥ ("Cross-process gap — ninerouter runs separate process — deferred to a separate ticket.")
> **Also:** `STALL-ROUTEINTEGRATION-FOLLOWUP.md` for the related stream-controller-level reachability gap

---

## Executive Summary

The Bug 2 zombie-stream reaper shipped in `BUG2-ZOMBIE-STREAM-REAPER.md` (CLOSED 2026-07-22) supervises the **Hono backend process only** via a module-level `__activeStreams__` globalThis Map. `ninerouter` runs as a separate Node.js process (different PID), which means:

- A zombie stream created by the Hono backend → reaped within ~6 min. ✅
- A zombie stream created by `ninerouter` → NOT reaped by the Hono backend's Map. ❌

Both processes serve `/v1/chat/completions` traffic. Run.log evidence shows zombies in BOTH processes (the 19+ min batches from `COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md` don't distinguish which process they came from).

---

## Why this is P2 not P1

- The Hono backend reaper still catches the majority of zombies (most streaming goes through Hono directly).
- The cross-process gap covers only the subset of requests that **ninerouter** proxies for the Hono backend.
- No observed cascade failure attributable to gap alone — but a separate-process zombie, once detected late, has the same 19+ min symptom.

---

## Implementation options

| Option | Description | Pros | Cons |
|---|---|---|---|
| (a) Shared store (Redis) | Both processes write to a shared Redis set; a leader-elected worker polls + reaps | Single source of truth across processes | Redis becomes single-point-of-failure; needs leader election |
| (b) Per-process reaper + cross-process heartbeat | Each process runs its own reaper; cross-process orphan detection via heartbeat + last-write timestamps | Simple; no single point of failure | Fragmented state; zombie declared only when both processes' timers expire |
| (c) Move the reaper into a dedicated worker | A standalone process with both lobby feeds | Clean separation; easy to test | New deployment topology; needs inter-process communication |

**Recommended for v1:** Option (b) — minimal deployment surface change; piggybacks on existing local reapers. The cross-process detection latency is at worst `MAX(REAP_THRESHOLD_MS_BOTH_PROCESS) ≈ 5 min × 1` (worst case one process reaps, the other doesn't, but the cross-process heartbeat catches the discrepancy).

**Recommended for v2:** Migrate to Option (a) with Redis-backed shared state. Standard pattern for multi-process supervision.

---

## Acceptance criteria

- `BUG2-CROSS-PROCESS-REAPER.md` is closed when either option (a), (b), or (c) lands AND vitest confirms reaper behavior for an ninerouter-style orphan stream.
- The Hono backend's Map remains the production-hot-path reaper (no regression in `__tests__/chat/zombie-stream-reaper.test.ts`).
- A new `__tests__/chat/zombie-stream-reaper-cross-process.test.ts` covers the cross-process heartbeat behavior (without requiring actual multi-process harness — uses a simulated inter-process message bus).

---

## Verification (after implementation)

```bash
cd /opt/bing/web
# Confirm existing reaper still passes
timeout 90 npx vitest run __tests__/chat/zombie-stream-reaper.test.ts
# Confirm new cross-process reaper test passes
timeout 90 npx vitest run __tests__/chat/zombie-stream-reaper-cross-process.test.ts
```

Expected post-fix state:
- Single-process reaper (Hono backend) still 18/18 PASS.
- Cross-process reaper test (new) covers: orphan registered in process A → process A's reaper runs + sends heartbeat → process B's reaper sees no heartbeat → emits cross-process reap signal; assertion: process A's stream is aborted within REAP_THRESHOLD.

**Stable anchor:** `#bug2-cross-process-reaper-2026-07-22`
