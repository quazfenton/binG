# MCP-POST-CALL-WIRING — Closed companion ticket (Task #1 production wiring)

**Status**: 🟡 OPEN (2026-07-16)
**Parent**: Task #1 production wiring — Contract-aware MCP tool pipelineline
**Owner**: TBD
**Priority**: P1 (audit-trail value is halved without this — intent-only, not execution-audited)
**Closure acceptance**:

- [ ] 1. `gatePostCall(contract, { toolName, args, result, errorCount })` is invoked in
      `architecture-integration.ts` AFTER dispatch returns, BEFORE
      the final return statement.
- [ ] 2. `wrapWithSentinel(result.output, { toolCallId, onDrop })` is invoked AFTER
      gatePostCall succeeds (or after dispatch, if no post-call gate is required).
- [ ] 3. Audit append `note: "post-call: success"` / `note: "post-call: failure (err)"`
      is appended after a successful dispatch.
- [ ] 4. Audit append `note: "sentinel-dropped: PATTERN"` is appended when
      wrapWithSentinel's `dropped[]` is non-empty.
- [ ] 5. Audit append `note: "post-gate-rejected: REASON"` is appended when
      gatePostCall returns `{ allowed: false }`.
- [ ] 6. All 5 audit appends use `contract.audit = contract.audit.append(...)`
      (immutable-getter capture pattern) — no silent data loss.
- [ ] 7. vitest `__tests__/mcp/contract-gated-call.test.ts` extended with ≥4
      new tests asserting the 5-step post-call audit sequence + sentinel-drop
      audit entry.
- [ ] 8. tsc clean on `architecture-integration.ts` (no `reason`/`allowed`
      narrowing slips).
- [ ] 9. CENTRALIZED_TODO_LIST.md updated: Task #1 row flips from
      "🟡 PARTIAL" → "✅ DONE" and this ticket is added under the
      audit-followup section.

## Why this is deferred (not just "incomplete")

The Task #1 production wiring committed PRE-CALL features only (validateArguments
→ gatePreCall → pre-call audit append). The POST-CALL counterparts
(gatePostCall → wrapWithSentinel → post-call audit append) require:

1. Locating the dispatch body's return statements (the final
   `return result` sites inside the try/catch in callMCPToolFromAI_SDK at
   architecture-integration.ts:L2200+ — beyond what was visible when
   the pre-call splice was being constructed).
2. Inserting 5 splice steps in the correct order relative to the
   existing 7-branch dispatch returns (cache hit, cache miss,
   AI-SDK-only handoff, error fallbacks, etc.).
3. Detecting the result-error shape produced by the dispatch (multiple
   return paths ⇒ multiple possible `result` shapes ⇒ `gatePostCall`
   ctx needs to normalize before dispatch).

Inline TODO reference (at architecture-integration.ts:L2080+):
```
// TODO: extend this section with gatePostCall + wrapWithSentinel + post-call
//       audit append (deferred — see MCP_TOOL_SELECTION_POSTAUDIT §post-call).
```

## Design intent (recap from prior turns)

The audit-trail's value is two-fold:
- INTENT (pre-call): what did we promise to do / what did we validate?
- EXECUTION (post-call): what actually happened / what was redacted / what
  kill-switch triggered AFTER getting a result?

Without post-call wiring, the contract is half-complete: an audit reader can
see "the system tried to call bash_execute with `rm -rf /`" but cannot
distinguish "the call succeeded but result was redacted" from "the call
was prevented by validateArguments." Both would have only pre-call audit
entries.

## Reference

- Inline TODO: `/opt/bing/web/lib/mcp/architecture-integration.ts` L2080+ region
- Test mirror: `/opt/bing/web/__tests__/mcp/contract-gated-call.test.ts`
  `runPipeline` already includes the post-call 5-step sequence in its mirror;
  production code does NOT yet call it.
- Helpers available:
  - `gatePostCall(contract, ctx)` from `/opt/bing/web/lib/agents/contract.ts`
  - `wrapWithSentinel(result, options)` from `/opt/bing/web/lib/agents/tool-sentinel.ts`
