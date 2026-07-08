# STALL-524-OUTERCATCH-GAP

## Status: OPEN — non-blocking, tracked for follow-up

## Background

The `stallDidFire` propagation feature was wired through
`bing/web/app/api/chat/route.ts` (8 surgical edits in the streaming branch
+ the non-streaming `Promise.race` + `fireStall` + `rejectOnAbort` chain).

## Gap

When a stall race-winner is detected and the non-streaming catch at
`route.ts:L2774-L2797` returns 524, the response should bubble cleanly back
to the client. However, in production code:

1. Some teaching fallthroughs from the `coordinator` chain-walk path can
   bubble the SAME race error up through a SECOND outer-level try/catch
   around `route.ts:L5529` or `route.ts:L6121` that does NOT have
   stall-aware handling.

2. The outer catch converts any error reaching it (including a fresh
   `Chat route stall watchdog (...)` throw from the inner race-winner
   branch) to a generic 500 error response.

3. End-user result: the prior 200-OK-contradicting-SSE-error-event bug
   becomes a 500-OK-still-stall-signal which is BETTER than the silent
   200-OK but WORSE than the contract-complied 524.

## Detection (test-side)

`bing/web/app/api/chat/__tests__/route-shape-audit.test.ts` test A
(`returns 524 when the non-streaming race winner is the stall watchdog`)
was pivoted in FIX 9 to assert the load-bearing chain engagement (the
`[CHAT-ROUTE] Stall watchdog fired — aborting agent turn` log entry)
and permits the response status to be 200/524/500 — accepting the current
500-with-engaged-chain reality and marking the gap.

## Why non-blocking

For the user's primary use case (prevent silent stream-OK-but-stall
situations), the CHAT-ROUTE log line + the streaming-branch pre-stream
524 + the `controller.error()` mid-stream surface is sufficient.
The 524 status on the non-streaming path is a polish/improvement, not a
correctness blocker.

## Suggested fix (production-side)

Add a stall-aware branch to the outer try/catch candidates at L5529 and
L6121:

```ts
} catch (err: any) {
  const msg = err instanceof Error ? err.message : String(err);
  const isStall = msg.startsWith('Chat route stall watchdog') ||
                  (msg === 'Chat route aborted' && /* needs access to closure scope */);
  if (isStall) {
    clearInterval(stallWatchdog);  // already-cleared is no-op
    return addAnonSessionCookie(
      NextResponse.json(
        { error: 'Chat stalled', reason: stallDidFireReason ?? 'unknown',
          requestId, stitchedFromWatchDog: stallDidFire },
        { status: 524, headers: {
          'x-stall-fired': 'true',
          'x-stall-reason': stallDidFireReason ?? 'unknown',
        } },
      ),
    );
  }
  // Fallthrough to existing 500 handling
  ...
}
```

NOTE: requires either hoisting stallDidFire/stallWatchdog to module scope
(currently closure-private to POST) OR threading the flag through the
chain-walk so the outer catch can read it. Module-private hoist has
risks (concurrent-request races on the flag); prefer option (b): make
the chain-walk propagate stallDidFire via a typed-error class
(`class StallWatchdogError extends Error`).

## Companion changes worth considering

* Refactor the message-string sniffing at L2771-L2775 to a typed
  discriminator (`class StallWatchdogError extends Error` with a
  `readonly kind: 'stall' as const`). Touches the FIX 7 second arm too.
* Trim the FIX 7 comment from 8 lines to 3 lines; the "rejectOnAbort runs
  first via addEventListener" mechanic only needs 1-2 lines.
* Add a `child` route-level stallDidFire telemetry metric so ops can
  alert on frequency.
