# BUG2-ZOMBIE-STREAM-REAPER — Hybrid Reaper Architecture (CLOSED 2026-07-22)

> **Ticket ID:** `BUG2-ZOMBIE-STREAM-REAPER`
> **Status:** 🟢 Closed (architecture + minimal fix landed 2026-07-22)
> **Opened:** 2026-07-22
> **Closed:** 2026-07-22
> **Priority:** 🔴 P1 (production — streams persist 19+ min, abort signal does not reach consumer)
> **Cross-ref:** `/opt/bing/.tickets/COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md` → "New Bug 3 — Zombie Streams: 19+ Minute Silence After bash_execute (CRITICAL)" + "Behavioral 6 — THINK-PING Hallucinating stale state"
> **Related fix:** `STALL-524-OUTERCATCH-GAP.md` (per-stream `setTimeout`-TIEMOUT at vercel-ai-streaming.ts:L2005 emits `stallWatchdogEnvelope` but did NOT fire for the 19+ min orphans) + the cross-bug unification envelope threading landed in this same turn

---

## Executive Summary

Add a process-scoped reaper that catches streams which escape per-stream `setTimeout`-TIMEOUT enforcement. The reaper is the empirical backstop: it sweeps a global registry of `ActiveStream` entries every 60s; any stream whose `lastActivityTime` is older than 5 min is force-aborted with a `stallWatchdogEnvelope` emission and an unregistration.

**Why a reaper and not (a) snapshot-on-hibernate or (c) hybrid:**
- (a) Snapshot-on-hibernate assumes the LLM-side state can be frozen and reloaded — false. After 19+ min silence, the model's server-side context is long-gone; resumability is infeasible. The stream is dead, period.
- (c) Hybrid (per-stream + reaper + snapshot) adds snapshot complexity for a non-recoverable symptom.
- **(b) Reaper-only** is the right call: minimal surface, catches escapees, no false hope of recovery.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          /opt/bing/web/lib/chat                              │
│                                                                             │
│  vercel-ai-streaming.ts                              zombie-stream-reaper.ts│
│  ┌─────────────────────────┐                          ┌──────────────────┐  │
│  │ streamWithVercelAI()    │                          │ registerStream() │  │
│  │   ↓                     │       on entry           │ unregisterStream()│  │
│  │ timeoutController = new │  ───────────────────────▶│ updateActivity() │  │
│  │ setTimeout(75s) + L120s │                          │ forceReap()      │  │
│  │   ↓                     │       on milestone       │ sweepOnce()      │  │
│  │ resetIdleTimeout()      │  ───────────────────────▶│ getActiveCount() │  │
│  │ ╔══════════════╗        │                          │                  │  │
│  │ ║ emit envelope ║       │                          │ ┌──────────────┐ │  │
│  │ ╚══════════════╝        │                          │ │ setInterval  │ │  │
│  │   ↓                     │                          │ │  every 60s   │ │  │
│  │ finally { unregister }  │  ───────────────────────▶│ │ sweepOnce()  │ │  │
│  └─────────────────────────┘                          │ └──────────────┘ │  │
│                                                        └──────────────────┘  │
│                                                                             │
│  ┌─ globalThis.__activeStreams__ ────────────────────────────────────────┐  │
│  │ Map<string, ActiveStream> {                                          │  │
│  │   {streamId, abortController, lastActivityTime, lastActivityType,   │  │
│  │    provider, modelName, registeredAt}                               │  │
│  │ }                                                                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Thresholds

| Constant | Value | Env-var override | Rationale |
|---|---|---|---|
| `REAP_THRESHOLD_MS` | 300_000 (5 min) | `ZOMBIE_STREAM_THRESHOLD_MS` | > 120s `CHAT_ROUTE_STALL_TIMEOUT_MS` × 2.5 — gives per-stream setTimeout a wide grace period before reaper intervenes. Just below the 19+ min observed symptom so the bug-2 symptom is caught at ~6 min worst case. |
| `SWEEP_INTERVAL_MS` | 60_000 (1 min) | `ZOMBIE_STREAM_SWEEP_INTERVAL_MS` | 1/5 of REAP_THRESHOLD — worst-case orphan reaped at REAP_THRESHOLD + SWEEP_INTERVAL = 6 min, well below 19+ min symptom. |
| `MAX_ACTIVE_STREAMS` | 1000 | (compile-time) | Defensive cap. If the registry grows past this, evict oldest. Catches `registerStream()` callers that forgot to `unregisterStream()` — bounded damage. |

---

## Exported API

```ts
// /opt/bing/web/lib/chat/zombie-stream-reaper.ts

export interface ActiveStream {
  streamId: string;
  abortController: AbortController;
  lastActivityTime: number;
  lastActivityType: 'init' | 'text' | 'tool-call' | 'tool-result';
  provider: string;
  modelName: string;
  registeredAt: number;
}

export function registerStream(meta: Omit<ActiveStream, 'registeredAt'>): void;
export function updateStreamActivity(streamId: string, activityType: ActiveStream['lastActivityType']): void;
export function unregisterStream(streamId: string): void;
export function forceReap(streamId: string, reason: string): void;     // emits envelope + aborts + unregisters
export function sweepOnce(): number;                                     // returns reap count (for tests)
export function getActiveStreamCount(): number;                          // (debug/health)
export function _setReaperIntervalForTests(intervalMs: number): void;    // not exported (underscore prefix)
```

---

## Hot-reload safety

Mirrors the FC-GATE pattern (vercel-ai-streaming.ts:L155-L156):
```ts
declare global { var __activeStreams__: Map<string, ActiveStream> | undefined; }
declare global { var __zombieReaperIntervalId__: NodeJS.Timeout | undefined; }
```

This survives Next.js dev hot-reload — without it, every hot-reload would create a NEW setInterval handle, leaking timers.

---

## Cross-process gap (deferred)

`ninerouter` runs in a separate process from the Hono backend. Each process has its own `__activeStreams__` Map. A stream that goes zombie in ninerouter would NOT be reaped by the Hono backend's reaper.

**Defer to a separate ticket.** The local-process reaper covers the most common case (Hono backend streaming). Cross-process reap would require either:
- A shared store (Redis) that both processes poll, OR
- Each process running its own reaper (works but state is fragmented).

---

## Files changed

| File | Change |
|---|---|
| `/opt/bing/web/lib/chat/zombie-stream-reaper.ts` | NEW — 4 exported functions + globalThis Map + setInterval sweeper + process SIGTERM/beforeExit cleanup |
| `/opt/bing/web/lib/chat/vercel-ai-streaming.ts` | Add `import { registerStream, updateStreamActivity, unregisterStream }` + hook at `streamWithVercelAI()` generator entry/exit + hook at `resetIdleTimeout()` closure for `updateStreamActivity` |
| `/opt/bing/web/__tests__/chat/zombie-stream-reaper.test.ts` | NEW — 4 describe blocks (reap / preserve / singleton hot-reload / Map cap) |

---

## Verification

```bash
cd /opt/bing/web
# Build clean
timeout 180 npx tsc --noEmit -p tsconfig.json
# Target: 0 new errors at zombie-stream-reaper.ts + vercel-ai-streaming.ts

# vitest on the new test file (4 describe blocks, ~12 cases)
timeout 90 npx vitest run __tests__/chat/zombie-stream-reaper.test.ts

# Regression: pre-existing test files in __tests__/chat/ remain green
timeout 180 npx vitest run __tests__/chat/stream-with-auto-continue.test.ts __tests__/chat/auto-continue-*.test.ts
```

Expected post-fix state:
- Zombie streams surviving > 5 min are reaped within 60s + envelope emitted to chatLogger + recordDegradation metric bumped + unregisterStream called.
- Per-stream setTimeout-TIMEOUT still fires for ~75-120s silent windows (unchanged). The reaper is the backstop, NOT a replacement.
- No creep in tsc errors at the affected files.
- The hot-reload singleton survived → Next.js dev mode doesn't accumulate setInterval handles.

---

## Closure narrative

Mirrors items ①-⑥ from `/opt/bing/.tickets/STALL-524-OUTERCATCH-GAP.md`:

① Per-stream `setTimeout`-TIMEOUT (`stallWatchdogEnvelope` emission) at vercel-ai-streaming.ts:L2005 — already in place, did NOT fire for the 19+ min zombie batches (root cause: per-stream timer attachment bug — needs separate investigation).

② New process-scoped reaper at `zombie-stream-reaper.ts` — catches per-stream escapes by sweeping `__activeStreams__` Map every 60s and reaping anything whose `lastActivityTime` is older than 5 min.

③ Wire sites: (a) `registerStream` at the entry to `streamWithVercelAI()` generator; (b) `updateStreamActivity` in the `resetIdleTimeout()` closure (so any "I just did something" event updates `lastActivityTime`); (c) `unregisterStream` in the `finally{}` block of the generator.

④ 4 exported functions (`registerStream` / `updateStreamActivity` / `unregisterStream` / `forceReap`) + 2 internal (`sweepOnce` / `getActiveStreamCount`) — minimal API surface.

⑤ globalThis singleton pattern (mirrors FC-GATE at vercel-ai-streaming.ts:L155) prevents Next.js dev hot-reload from leaking setInterval handles.

⑥ Cross-process gap (ninerouter runs separate process) — deferred to a separate ticket.

**Stable anchor:** `#bug2-zombie-reaper-closure-2026-07-22`
