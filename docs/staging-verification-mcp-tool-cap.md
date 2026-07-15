# Staging verification — MCP tool-cap & VFS-fallback regression lock

**Audience:** operators running cold-start smoke tests against the staging
environment after the audit-remediation PRs are deployed.

**Goal:** confirm that the chat route's MCP tool-loading pipeline still
guarantees a non-empty VFS + bash baseline for end-users even when all
SDK-bound sources (Arcade, Composio, Remote MCP, Mem0, MCPorter) are
intentionally dead or unreachable. This is the "user always has at
least the core tool set" floor that the audit's chat-hang-fix and the
post-audit `normalizeAndCapTools` pipeline jointly guarantee.

The local test suite (`bing/web/__tests__/mcp/architecture-integration.test.ts`,
`bing/web/__tests__/mcp/request-to-final-list.test.ts`,
`bing/web/__tests__/api/chat/route-tool-list.test.ts`) covers the
**lambda-side correctness** of this contract. This page documents the
**fleet-side verification** — operator-runnable scripts and the
expected response shape.

---

## 1. Smoke-test command (cold-start sanity)

Run this against a cold staging env (5–10 cold starts across the
worker pod set):

```bash
curl -X POST "$STAGING_HOST/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "messages":[{"role":"user","content":"hi, how are you?"}],
    "provider":"mistral",
    "model":"mistral-large"
  }'
```

**Expected (parsed from the SSE stream):**

The response should include the chat completion tokens, but the
**MCP tool list shape** is what we're verifying. Inspect the
`config.tools` field in the `/api/chat` trace logs (or the
`[MCP-Tools] Assembled N/M candidates` line emitted by
`bing/web/lib/mcp/architecture-integration.ts:getMCPToolsForAI_SDK`).

For a non-codegen turn ("hi, how are you?"), expect:

- `selectedCount == 9` (8 VFS workflow companions + bash_execute)
- `candidateCount == 9` (no SDK contributions in this test config)
- `rejectedByNameCount == 0`
- `rejectedByBudgetCount == 0`
- The 9 workflow-companion names capitalized in `selectedNamesSample`:
  `apply_diff`, `bash_execute`, `batch_write`, `delete_file`,
  `list_files`, `move_file`, `read_file`, `search_files`,
  `write_file`.

For a code-edit turn: same 9 names + planner-level intent metadata
emitted to logs.

For a hard-to-test composio/arcade/remote turn (require env keys set
in staging), name counts vary; ensure no `slack_*` / `gmail_*` /
`arcade_*` overflow the cap (env `MCP_TOOLS_MAX_TOTAL`, default 25).

---

## 2. MCP_TOOLS_MAX_TOTAL cap conformance

To verify workflow-companion exemption under a tight cap:

```bash
# Re-deploy staging worker pod with env override:
kubectl set env deployment/chat-worker MCP_TOOLS_MAX_TOTAL=5

# Wait for rollout, then run the smoke command from §1.
curl -X POST "$STAGING_HOST/api/chat" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi, how are you?"}]}'
```

**Expected:** `config.tools` STILL contains all 9 workflow companions
even with `MCP_TOOLS_MAX_TOTAL=5`. The cap-exempt path in
`architecture-integration.ts:normalizeAndCapTools()` keeps
`write_file`, `read_file`, `list_files`, `apply_diff`, `delete_file`,
`move_file`, `search_files`, `batch_write`, `bash_execute` regardless
of the cap. Budgeted tools (none in this test) would be clamped to
`max(5 - 9, 0) = 0`.

A regression that empties the cap-exempt logic would surface here as
`<9 tools` for a non-codegen turn.

---

## 3. Dead-source VFS-fallback regression lock

To verify the chat-hang-fix VFS fallback still degrades cleanly when
all SDK sources hang:

```bash
# Block outbound to Composio + Arcade + Remote MCP + Mem0 endpoints:
# (test infra: firewall rule that drops egress to known SDK hosts)

# Cold-start a few chat requests and verify HTTP 200 (NOT 524/500).
for i in {1..5}; do
  curl -s -o /dev/null -w "request $i: HTTP %{http_code}\n" -X POST \
    "$STAGING_HOST/api/chat" -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"patch the README and run tests"}]}'
done
```

**Expected:**

- All 5 requests return **HTTP 200** (NOT 524 / 500 / 504).
- Log lines for each request contain:
  - `[CHAT-ROUTE] boundary: post-mcp-race` with `toolsOutcome` ∈
    `{success, empty, timed_out, aborted}` (one of these is fine).
  - When `toolsOutcome == 'timed_out'`: subsequent `fallbackTools`
    from `getVFSToolDefinitions()` are emitted (8 VFS workflow
    companions). The chat completion should succeed using the file
    tools, just with no external SDKs.
- The `MCP_TOOLS_TIMEOUT_MS` (default 1000ms) and `MCP_PHASE2_SOURCE_TIMEOUT_MS`
  (default 800ms) per-source deadlines should fire within ~1s; the
  per-source failure log line `[MCP-Tools] Phase 2 source $name
  degraded to empty: …` should be visible for each hung source.

**Failure modes that should NOT happen:**

- HTTP 524 from any request (route-level `Promise.race` ceiling firing).
- HTTP 500 with `Failed to load MCP tools` (assembler unhandled error).
- Empty `config.tools` (zero-tool floor) — would surface as model
  emitting tokens indefinitely without tool calls. Trigger the stall
  watchdog via a slow subsequent turn if this regresses.

---

## 4. Operator assertion-sheet

Run these checks in order. Each must pass before signing off the
deploy:

- [ ] **§1 cold-start smoke** — 5 cold starts → all HTTP 200, config.tools.length == 9 for greeting
- [ ] **§1 greeting** — `selectedNamesSample` contains all 9 workflow companions
- [ ] **§1 no codegen turn** — `rejectedByBudgetCount == 0`
- [ ] **§2 cap conformance** — `MCP_TOOLS_MAX_TOTAL=5` redeploy → 9 workflow companions still present
- [ ] **§2 cap exempted** — `selectedCount` ≥ 9 (no regression in cap-exempt logic)
- [ ] **§3 dead-source** — 5 requests with egress-blocked SDKs → all HTTP 200, no 524/500
- [ ] **§3 fallback log** — `[MCP-Tools] Phase 2 source $name degraded to empty` log line visible per hung source
- [ ] **§3 fallback tools** — `getVFSToolDefinitions().length >= 8` (fallback always non-empty)

If any check fails, page the audit-response team and DO NOT roll the
deploy forward.

---

## 5. References

- Local tests that verify the contract:
  - /opt/bing/web/__tests__/mcp/architecture-integration.test.ts
    (partial-success + normalize/dedup/cap + planner leak)
  - /opt/bing/web/__tests__/mcp/request-to-final-list.test.ts
    (8 audit-step-#6 end-to-end cases)
  - /opt/bing/web/__tests__/api/chat/route-tool-list.test.ts
    (9 chat-route integration smoke tests, count bound = exactly 9)
  - /opt/bing/web/__tests__/mcp/legacy-substring-contract.test.ts
    (8 LEGACY substring-mode contract cases)
- Audit summary: original 9-finding analysis routed through copilot
  elicitation; remediation architecture: planner → plan-mode wiring →
  partial-success Phase 2 → normalize/dedup/cap → telemetry → request-
  to-list tests → chat-route smoke → legacy migration + contract lock.
