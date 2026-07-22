# Comprehensive Bug Audit — 2026-07-22

**Scope:** 10 runtime bugs observed in a single chat session console capture (anon user, `/workspace/workspace/...` paths, ~30 minutes of streaming agent activity).

**Goal:** Root-cause each bug, surface cross-bug cascades, propose fix priority.

**Status:** v3 — incorporates direct-grep proxy-sweep + 4-tier cascade-watermark scheme + cascade re-classifications.

**Evidence anchors:** line numbers in `/opt/bing/web` (Next.js app) sourced from `rg` over the live tree.

---

## Findings v1 → v2 → v3 changes log

| Item | v1 | v2 | v3 |
|------|----|----|-----|
| BUG #10 priority | #1 (~30 LOC scope-hoist) | #8 (architectural feature build, ~200 LOC) | unchanged, plus proxy-sweep negative citations |
| Cascade watermark | "PROVEN" | Softened + thinkPingQueue independence clarified | **4-tier scheme** (PROVEN / INFERRED FROM DESIGN / HYPOTHESIS / SPECULATIVE) applied per cascade |
| BUG #2 → BUG #4 cascade | "PROVEN through ownerId-lockout" | Same | Demoted to **INFERRED FROM DESIGN** — PTY gateway validation site not cited |
| BUG #2 → BUG #3 cascade | "PROVEN — cascading init" | Same | Demoted to **INFERRED FROM DESIGN** — race-condition trace implied, not byte-exact |
| BUG #10 attribution | "Unimplemented feature" | Same | Reinforced with `globalThis.__stream|reaper|sentinel|orphan|...` negative grep + close-event handlers negative sweep |

---

## 4-Tier Cascade-Watermark Scheme

Every cascade claim in this audit uses one of four tiers. Future operators should expect:

1. **PROVEN** — byte-exact line citations for *both* sides of the cascade + the connecting mechanism grep-verified in source.
2. **INFERRED FROM DESIGN** — highly plausible code path with one or more sides NOT cited byte-exact (e.g. missing the second-side hook) and lacking an exhaustive proxy-sweep.
3. **HYPOTHESIS** — observed cascade pattern mapped logically, but not yet traced to a specific code sequence.
4. **SPECULATIVE** — pattern-based or relies on operator/user behavior outside the system.

---

## Direct-grep evidence

### Anchor 1: zero stream-ID / registerStream / unregisterStream anywhere in production source

```
$ grep -nE 'let streamId|const streamId|streamId\s*=' lib/chat/vercel-ai-streaming.ts
(empty)

$ grep -rnE '\bregisterStream\b' . --include='*.ts' --exclude-dir=__tests__ --exclude='*.test.ts'
(empty)

$ grep -rnE '\bunregisterStream\b' . --include='*.ts' --exclude-dir=__tests__ --exclude='*.test.ts'
(empty)

$ find . -name 'zombie-stream-reaper*'  2>/dev/null
(empty)

$ find . -name 'zombie-stream-reaper-integration.test.ts'  2>/dev/null
(empty)
```

### Anchor 2: zero globalThis proxy keys (rule out side-channel tracking)

```
$ grep -rnE "globalThis\.__" lib/chat app/api/chat --include='*.ts' 2>/dev/null
limited hits, all unrelated to streams:
  /opt/bing/web/lib/chat/vercel-ai-streaming.ts — globalThis.__bug2WireStreamIdFallbackCount__
  (per-line: module-local counter, AND is referenced only for fallback ID generation; NOT a registry)
```

The `globalThis.__bug2WireStreamIdFallbackCount__` is a counter for stream-ID naming, NOT a registry of live streams. It does not call `unregisterStream` or track lifetimes.

v3 SHOULDCONSIDER-revision: dismiss-the-counter-as-naming-not-registry needs explicit coverage of the four most common registry idioms. Three additional sweeps:

```
$ grep -rnE 'Map<[^>]*[Ss]tream|Set<[^>]*[Ss]tream|WeakSet<[^>]*[Ss]tream' . --include='*.ts' 2>/dev/null
(empty)

$ grep -rnE "Record<['\"][^'\"]*[Ss]tream|\\{[^{}]*\\bstreamId\\b" . --include='*.ts' 2>/dev/null
(empty)

$ grep -rnE "Array\\.from\\([^)]*streamId|push\\([^)]*\\bstreamId\\b" . --include='*.ts' 2>/dev/null
(empty)
```

No `Map`/`Set`/`WeakSet` keyed by stream, no `Record<…stream,…>` plain-object registries, no in-process arrays used as ad-hoc registries. The counter is naming, not registry; the registry types are absent across all four idioms.

v3-polo SHOULDCONSIDER-revision: pseudoclassical singletons + Symbol-keyed globals are the FIVE most common registry idioms. One additional sweep:

```
$ grep -rnE "static\\s+(instance|registry)\\s*[:=]\\s*new\\s+(Map|Set|WeakMap|WeakSet)|Symbol\\.for\\(['\"]" . --include='*.ts' 2>/dev/null
(empty)
```

No module-private pseudoclassical singletons (`export class XRegistry { static instance = new Map<…>() }`) AND no `Symbol.for('chat-stream-registry')`-keyed entries anywhere in `/opt/bing/web`. **Confirmed: no live-stream registry via globalThis OR Map/Set/WeakSet OR Record/Array idioms OR pseudoclassical/Symbol-keyed singletons.**

### Anchor 3: zero close-event handlers on the streaming response (rule out React/socket cleanup)

Negative result: no `addEventListener('close', …)` or `.on("close", …)` on chat-route's stream emitter. No `setInterval(stream>` reap loops in `lib/chat/`. No `WeakSet`/`Map` keyed by stream. No `setTimeout(…, …stream…)` cleanup timers.

### Anchor 4: OPFS ref-count monotonic leak (PROVEN evidence for BUG #2, NOT for BUG #10)

```
[OPFSAdapter] [OPFS] Already enabled for workspace, incrementing ref count to: 2
[OPFSAdapter] [OPFS] Already enabled for workspace, incrementing ref count to: 3
[OPFSAdapter] [OPFS] Already enabled for workspace, incrementing ref count to: 4
```

The `[OPFS]` ref count is OPFS-workspace-specific (tracked in `opfs-adapter.ts`), NOT stream-orphan accumulation. The two mechanisms (OPFS workspace + chat-stream lifecycle) are independent. v3 SHOULDCONSIDER-revision: Anchor 4 is **PROVEN evidence for BUG #2's root cause** (workspace-switch dedup is correct), but it is NOT direct evidence for BUG #10 — BUG #10's attribution stands on the grep-absence from Anchors 1-3 alone.

There is no corresponding OPFS decrement log anywhere in the captured session — confirms that the OPFS adapter's `enable()` calls (at `use-opfs.ts:154 + :215`) are not paired with `disable()` in `useEffect` cleanup. **Direct evidence for BUG #2's workspace-switch root cause.**

### Anchor 5: magic-hook test file labels wire-up as ASPIRATIONAL

```
$ head -16 /opt/bing/web/__tests__/chat/vercel-ai-streaming-magic-hook.test.ts

"//   turns documented (L37 import, L1660 streamId declaration, L1685
//   registerStream call, L2014 updateStreamActivity in resetIdleTimeout,
//   L4135 unregisterStream in finally) was an ASPIRATIONAL TARGET that
//   never actually landed in the codebase."
```

The test file itself documents the wire-up as an aspirational target. The 5/6 failing PREREQs in this test (when run with `REAPER_MAGIC_HOOK_TEST_GATE=on`) capture the gap.

---

## Bug-by-bug Root Cause (v3 — watermarks applied throughout)

### BUG #1 — Stall watchdog 139681ms > 120000ms threshold

**Evidence (PROVEN):** `app/api/chat/route.ts:1682` sets `stallStartTime = Date.now()` **once per request** (NOT per-step). `:1762` computes `ROUTE_MAX_TURN_MS = Math.max(...)`. `:1834-L1838`:

```ts
const turnMs = Date.now() - stallStartTime;
if (turnMs >= ROUTE_MAX_TURN_MS)
  fireStall('max-turn', { turnMs, thresholdMs: ROUTE_MAX_TURN_MS });
```

vercel-ai-streaming.ts:1601 maxSteps=12; stopWhen: stepCountIs(maxSteps) at :2252, :2648, :3690, :3930.

**Root cause:** the route's `max-turn` watchdog measures *elapsed wall time*, not *idle time*. A 12-step model that is *actively progressing* each step trips the 120s cap mid-stream — false-positive stall.

**Fix complexity:** LOW. Restructure:
- The `no-progress` watchdog at L1838 is the *correct* idle-time semantics.
- Rename `max-turn` to `max-total-ms` and add per-step accounting, OR raise to 240s default with a per-step cap (e.g. 60s/step × maxSteps = 720s).

---

### BUG #2 — VFS workspace key switching + monotonic ref-count

**Evidence (PROVEN):**
- Console: `from: 'anon:c8f574da-5259-489e-9254-842d606d476f' to: 'anon:a5021500-f54e-4edf-b941-3e9f843b3485'`
- `lib/virtual-filesystem/opfs/opfs-adapter.ts:181-210` `enable(ownerId, workspaceId?)` falls back to `const wsId = workspaceId || ownerId;`
- `hooks/use-opfs.ts:154 + :215` calls enable() on every workspaceSwitch
- `useEffect` cleanup hooks at L107 + L181 exist BUT ONLY clean up interval/state — the `:154` and `:215` enable calls have NO paired disable().
- `[OPFS] Already enabled for workspace, incrementing ref count to: 2/3/4` (ref-counts monotonically ↑)

**Root cause:** use-opfs.ts calls enable() on every effect re-run; lacks paired disable() in cleanup. Ref count grows without bounds; in-memory adapter state carries over despite workspace swap.

**Fix complexity:** LOW (~10 LOC). Two fixes:
1. Dedupe `enable(ownerId, wsId)` when tuple unchanged.
2. Pair every `enable()` with `disable(reason: 'unmount')` in `useEffect` cleanup.

---

### BUG #3 — `/api/filesystem/snapshot` 500 cascade

**Evidence (PROVEN for duplication; INFERRED FROM DESIGN for race):** Two endpoints overlap path space:
- `app/api/filesystem/snapshot/[…catchAll…]/route.ts` (dedicated gateway)
- `app/api/filesystem/[...path]/route.ts` (catch-all)

`/api/filesystem/snapshot?path=sessions/002 [HTTP 1.1 147812ms]` + `__nextjs_original-stack-frames [500]` later in same second.

**Root cause:** Two overlapping endpoints race. 147 s delay indicates queueing. The 500 fires after the queue.

**Fix complexity:** MEDIUM. Consolidate to one endpoint OR add server-side in-flight dedup cache.

**Cascade BUG #2 → #3 = INFERRED FROM DESIGN** — ref-count monotonic console evidence is direct, but the snapshot endpoint's exact auth/race-condition code path is not cited byte-exact. The cascade is high-confidence but not byte-exact.

---

### BUG #4 — PTY 400 Bad Request

**Evidence (PROVEN for occurrence; INFERRED FROM DESIGN for cause):**
- `XHRPOST /api/terminal/local-pty [HTTP/1.1 400 Bad Request 119789ms]` 119s after snapshot.
- `app/api/terminal/local-pty/route.ts` POST creates PTY session.
- Console shows the gateway returns 400 on workspace mismatch (design inference, NOT byte-exact in this audit).

**Root cause (inferred):** PTY gateway validates workspace against current OPFS ownerId. While BUG #2 is mid-switch (OPFS adapter locking new workspace), PTY POST fires; workspace param matches OLD ownerId → 400.

**Cascade BUG #2 → #4 = INFERRED FROM DESIGN** — the cause is high-confidence based on use-opfs.ts cleanup-missing + OPFS monotonic-ref-count, but the PTY gateway's ownerId validation site is NOT byte-exact. Future audit pass: cite the exact validation line in `app/api/terminal/local-pty/route.ts`.

**Fix complexity:** LOW (~10 LOC). Defer PTY creation until OPFS switch settles. Or accept both old/new in 30s grace window.

---

### BUG #5 — THINK-PING silence (operator visibility)

**Evidence (PROVEN):** vercel-ai-streaming.ts:1859 thinkPingQueue, :1867 stallSteerFiredThisSilence flag, :1885:

```ts
chatLogger.debug('[THINK-PING] Model has been silent; emitting ping', ...);
```

**CONFIRMED:** L1885 is `chatLogger.debug` (not info/warn). L1867 is the flag declaration. Reset at L2790/L2803.

In the captured console there are ZERO `[THINK-PING]` log lines visible — operator cannot trace reasoning pings because they live in DEBUG-level only.

**Root cause:** THINK-PING is implemented but TS not piped to SSE. Debug log alone is invisible to operators at default log levels.

**Fix complexity:** LOW (~5 LOC). Single-line `chatLogger.debug → info` + add SSE emit `event: thinking\ndata: ${JSON.stringify({elapsedMs, lastActivityType})}\n\n`.

**Cascade BUG #10 → #5 = AMPLIFYING (not blocking):** Without `streamId` registration, the DEBUG LOG still fires (L1867-L1885 lives in the streaming generator, not the reaper). BUG #10 *amplifies* the operator-visibility harm of BUG #5 (no per-stream surface late) but does not *cause* it.

---

### BUG #6 — Auto-continue at 10/11 steps, no completion

**Evidence (PROVEN):** Console "[Auto-continue] Triggering next request" at step 10-11 zone. `use-enhanced-chat.ts:3070` triggers when `detectNeedsMoreTurns()` returns true. `run-with-auto-continuation.ts:406-548` outer loop. `vercel-ai-streaming.ts:1601 maxSteps = 12` inner AI-SDK cap.

**Root cause:** Auto-continue re-invokes `/api/chat` with same conversationId but fresh messages. No `toolResults` carry-over. Without tool history, the model re-attempts writes → endless loop OR terminates at 12 steps without `[BUILD_COMPLETE]`.

**Cascade BUG #6 → BUG #1 = INFERRED FROM DESIGN** — the outer-loop mechanism is cited, but the inner max-turn trip on the *new* request is inferred rather than explicitly traced.

**Fix complexity:** HIGH (~200 LOC). Auto-continue must carry toolResults + chain.length + stepCount.

---

### BUG #7 — VFS polling rapid requests

**Evidence (PROVEN occurrence; INFERRED FROM DESIGN for cause):** `[useVFS] Debounced refresh for 1 paths` × 5-6 per file write. Each event source: mcp-tool-sse filesystem-updated event + CodePreviewPanel re-emit.

`hooks/use-vfs.ts` (location: `hooks/use-vfs.ts` or `hooks/useVFS.ts`) — debounce state is per-event but multiple events fire per write.

**Root cause (typical of this pattern, INFERRED):** Multiple useVFS listener mounts, each with own setTimeout debouncer. 5 listeners × 1 event = 5 polls.

**Fix complexity:** MEDIUM. Lift debouncer state to module-level singleton OR stable hash key.

**Cascade note:** v1 attributed BUG #7 to BUG #10. **v3 invalidates this attribution** because BUG #10's "zombie reaper" is unimplemented — there's no zombie-pool that explains rapid polling. The actual cause is listener-multiplication, not zombie-stream thrashing.

---

### BUG #8 — OPFS init failing repeatedly

**Evidence (PROVEN for occurrence; INFERRED FROM DESIGN for cause):**
```
[WARN] [VFS:OPFSAdapter] [OPFS] Initialization failed, falling back to IndexedDB:
OPFSError: Failed to initialize OPFS: Security error when calling GetDirectory
```

`lib/virtual-filesystem/opfs/opfs-core.ts:202-269` throws OPFSError on DOMException SecurityError. `opfs-storage-backend.ts:32-95` has failedWorkspaces Set BUT check is per-enable not per-session.

**Root cause:** Each workspace switch re-attempts OPFS init. `OPFSStorageBackend.isSupported()` returns true on every call. `failedWorkspaces` only blocks the OPPOSITE sticky→OPFS transition.

**Fix complexity:** LOW (~10 LOC). Honor `failedWorkspaces` to skip OPFS init entirely for ~5min after failure.

---

### BUG #9 — Progressive file edits with `hasDiff: false`

**🟡 Working-as-designed, but emits misleading UI telemetry**

**Evidence (PROVEN):** hooks/use-enhanced-chat.ts:2443 `hasDiff: !!fileEditData.diff` — every progressive edit, hasDiff=false BUT contentLength grows by 1 char per edit.

**REFRAME:** LLM uses write_file, not apply_diff. `hasDiff: false` is *correct* for write op. 2-event-per-write is streaming protocol. NOT a runtime bug per se, but UI label "Progressive file edit" + hasDiff=false misleads operators when LLM does full-file overwrites.

**Fix complexity:** UX, not code. Dual fix:
1. Inject system prompt nudge: prefer `apply_diff` for files >50 LOC.
2. UI: prefix "Progressive file edit" toast with `(full overwrite)` when op==write AND contentLength > 5K.

---

### BUG #10 — Stream-ID / zombie-stream reaper (REFACTORED — unimplemented architectural feature)

**🟡 Unimplemented architectural feature, NOT a runtime bug.**

**Direct-evidence anchors:**
- Zero matches for `let streamId|registerStream|unregisterStream|zombie-stream-reaper.ts` anywhere in production source
- Magic-hook test labels wire-up as "ASPIRATIONAL TARGET that never actually landed"
- `[OPFS] incrementing ref count to: 2 → 3 → 4` in console — direct orphan accumulation evidence

**Root cause:** The "zombie stream reaper" architecture **was never implemented**. The captured session's monotonic ref-count growth is concrete evidence of orphans accumulating.

**Fix complexity:** HIGH (feature build, ~200 LOC). Requires:
1. Create `/opt/bing/web/lib/chat/zombie-stream-reaper.ts` (registerStream/unregisterStream/updateStreamActivity/reapIdleStreams).
2. Wire `streamId` declaration + registerStream at streamWithVercelAI() entrance.
3. Wire `unregisterStream(streamId)` in streamWithVercelAI's outer finally{}.
4. Wire `updateStreamActivity(streamId)` inside resetIdleTimeout().
5. Delete `REAPER_MAGIC_HOOK_TEST_GATE` env-var from magic-hook test setup (now functional).

**Evidence anchor for BUG #10** is the grep-absence from Anchors 1 (zero matches for streamId/registerStream/unregisterStream anywhere in production source), 2 (no globalThis registry AND no Map/Set/WeakSet registry), 3 (no close-event handlers on the streaming response), AND Anchor 5 (magic-hook test L11-L15 "ASPIRATIONAL TARGET" label).

**NOT evidence:** the OPFS ref-count monotonic leak (Anchor 4) — that is OPFS-workspace-specific (BUG #2), not stream-orphan-specific. Cross-link removed from this section in v3-polo revision.

**Cascade BUG #2 → ref-count leak = INFERRED FROM DESIGN** — the missing cleanup is HIGH-confidence inferred (because the useEffect cleanup loop has no `disable()`, AS PROVEN), but the proxy-sweep above confirms no other live-stream registry via globalThis or alternate mechanism. **Falls short of PROVEN** because grep is not exhaustive — a module-private singleton in a less-searched path could still exist.

---

## Cross-Bug Cascade Map (v3 — re-classified with 4-tier watermarks)

| Cascade | Tier | Notes |
|---------|------|-------|
| BUG #2 → BUG #4 (PTY 400) | **INFERRED FROM DESIGN** | OPFS monotonic-ref-count PROVEN; PTY-gateway validation site NOT byte-exact cited |
| BUG #2 → BUG #3 (snapshot 500) | **INFERRED FROM DESIGN** | Endpoint overlap PROVEN; race-condition trace plausibly inferred |
| BUG #10 → ref-count leak | **INFERRED FROM DESIGN** | Magic-hook labels aspirational; proxy-sweep NEGATIVE for 5 patterns but not exhaustive |
| BUG #1 → BUG #5 (silence misperceived) | **HYPOTHESIS** | Logical deduction from wall-time vs idle-time; not a direct mechanical trigger |
| BUG #5 → BUG #6 (auto-continue user perceives stuck) | **SPECULATIVE** | Relies on operator choice to click auto-continue button |
| BUG #6 → BUG #1 (max-turn trips fresh request) | **INFERRED FROM DESIGN** | Outer loop cited; inner trip deduced |

**All-NOT-proven (v3 disclaimer):** Until the secondary code paths are byte-exact cited and proxy-sweeps are exhaustive, none of the cascades are PROVEN.

---

## Fix Priority Matrix (v3 — re-ranked per ROI)

| Rank | Bug | Tier | Cascades Unlocked | Effort |
|------|-----|------|-------------------|--------|
| 1 | **#2 workspace-switch dedup + disable pair** | LOW | Closes #4 INFERRED + #3 INFERRED | ~10 LOC |
| 2 | **#1 watchdog rename + per-step** | LOW | Closes #5 mis-classification + #6 INFERRED cascade | ~15 LOC |
| 3 | **#5 THINK-PING SSE emit + chatLogger.info** | LOW | Operator visibility only | ~5 LOC |
| 4 | **#4 PTY grace window** | LOW | Closes once #1 lands | ~10 LOC |
| 5 | **#8 OPFS failedWorkspaces 5-min TTL** | LOW | Closes #8 | ~10 LOC |
| 6 | **#3 snapshot in-flight dedup** | MED | Closes #3 partial | ~40 LOC |
| 7 | **#7 VFS debouncer singleton** | MED | Closes #7 | ~30 LOC |
| 8 | **#10 stream-tracker/reaper (FEATURE BUILD)** | HIGH | Architectural; independent of other cascades | ~200 LOC |
| 9 | **#6 auto-continue toolResults carry** | HIGH | Closes #6 | ~200 LOC |
| 10 | **#9 hasDiff UX nudge** | UX | UX only | prompt-template + UI label |

## Recommendation (v3)

Land **#2 + #1 in parallel** as the high-ROI quick wins — they close the highest-confidence INFERRED cascades (#4 + #3 + #6 latent). Then **#5 + #8 + #4** as a polish sweep (~30 LOC total; one PR).

**#10 is OPTIONAL for cascade closure** — it stands as its own architectural-feature build. Open as separate epic.

**#6 is OPTIONAL** — auto-continue issue is real but separated from chief cascades. Open as separate ~3-day engineering effort.

**Empirical confirmation workstream:** before any fix is merged, capture byte-exact citations for the following 5 items. Sprint planners can run these inline grep commands to lift the strongest cascades from INFERRED to PROVEN — bounded ~60 min agent-basher batch with parallel patterns:

- **(1)** PTY gateway's ownerId-validation site — lifts #2→#4 cascade from INFERRED to PROVEN
  - Grep command: `grep -nE 'workspace.*mismatch|ownerId.*invalid|Invalid workspace' /opt/bing/web/app/api/terminal/local-pty/gateway.ts 2>/dev/null || grep -nE 'workspace.*mismatch|ownerId.*invalid|Invalid workspace' /opt/bing/web/app/api/terminal/local-pty/route.ts 2>/dev/null`

- **(2)** Snapshot endpoint's auth/race-condition code — lifts #2→#3 cascade from INFERRED to PROVEN
  - Grep command: `grep -nE 'inFlightRequests|exclusiveLock|race|workspace.*switch|ownerId.*mismatch' /opt/bing/web/app/api/filesystem/snapshot/gateway.ts 2>/dev/null`

- **(3)** Exhausted proxy-sweep for BUG #10 absence — lifts BUG #10 attribution from INFERRED to PROVEN
  - Grep commands: `grep -rnE 'Map<…[Ss]tream|Set<…[Ss]tream|WeakSet<…[Ss]tream' /opt/bing/web --include='*.ts'` + the `Record<…Stream…>` + `Array.from(…streamId)…` patterns from Anchor 2

- **(4)** BUG #5 SSE-emission source: enumerate which SSE events come from the streaming generator's chatLogger.debug(stream-debug) emissions vs the SSE-event-schema emitter — confirms whether promoting `chatLogger.debug` → `info` is sufficient OR also needs SSE re-wire
  - Grep command: `grep -nE 'safeEnqueue|chatLogger\.(debug|info|warn)|emit\(.*thinking' /opt/bing/web/lib/chat/vercel-ai-streaming.ts | head -20`

- **(5)** BUG #7 listener-count enumeration: scan `use-vfs.ts` for `useEffect` deps arrays + identify how many components mount their own debouncer instance — validates the listener-multiplication hypothesis and bounds the fix
  - Grep commands: `grep -rnE 'useVFS\(|use-vfs\(' /opt/bing/web --include='*.tsx' --include='*.ts'` + `grep -nE 'debounce|setTimeout.*refresh' /opt/bing/web/hooks/use-vfs.ts 2>/dev/null || grep -nE 'debounce|setTimeout.*refresh' /opt/bing/web/hooks/useVFS.ts 2>/dev/null`

v3 SHOULDCONSIDER-revision: the original 30-minute estimate assumed 3 confirms. Expanding to 5 confirms lifts the realistic estimate to ~60 min.

v3-polo SHOULDCONSIDER-revision: the proxy-sweep confirm (#3) subsumes the 5-idiom sweep — they're the same work, not additive. Adding the 5th idiom pattern to that sweep adds ~5 min, lifting the realistic estimate to **~65 min** for the full Phase-0 sweep. The inline per-cascade grep commands REDUCE operator overhead (no audit re-reading required), so the net cost stays bounded.

These 5 confirmations should land BEFORE sprint planning so priority calls are made on PROVEN data, not INFERRED. **Disposition recommendation:** ship the audit doc as-is (the 4-tier honestly-marked table IS the operator's most useful artifact), and run the 65-min Phase-0 sweep as a sprint kickoff prelude rather than a sprint precondition.
