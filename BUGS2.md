
 Source: Latest web/logs/run.log — 5 user requests over ~45 min, 8 distinct LLM turn completions.
Root Cause: V1-API-WITH-TOOLS path has NO continuation loop
The #1 systemic bug. Every single request follows the same pattern:
1. v1-agent-loop (PlanActVerify) always fails → falls back to v1-api
2. v1-api does ONE streaming call → model emits 0–1 tool calls then finishReason: stop
3. Stream completes. Turn ends. Dead.
The shouldAutoContinue logic in llm-continuation.ts only fires in the chat/route.ts SSE streaming path. The runV1ApiWithTools path in unified-agent-service.ts returns after one stream and never checks if the task is incomplete. It fired once out of 5 turns (line 12012, for empty_tool_args_detected), but only because that turn happened to go through the chat route path.
Fix: After runV1ApiWithTools completes, check completion signals (planSteps remaining, single-write-then-stop, role-select continue=true) and re-invoke the LLM with a continuation prompt. The existing shouldAutoContinue helper already has all the detection logic — it just needs a call site in the v1-api completion path.
Bug #2: RoleSelect.continue = false despite planSteps=3
Line 1602: [RoleSelect] Parsed routing {classification: "code", role: "coder", continue: false, planSteps: 3, willAutoContinue: false}. The LLM outlined a 3-step plan, wrote 3 files in step 1, then stopped. The RoleSelect parser saw 3 plan steps but set continue: false. The DEFAULT_ROUTING.continue defaults to false, so the multi-step plan signal is silently dropped.
Fix: Plan steps ≥ 2 should force continue: true.
Bug #3: 
All 28 LLM calls across 5 turns show [FC-GATE] Function calling ability UNKNOWN and Every call uses the two-phase strategy (Phase 1: tools; Phase 2: text-mode fallback. This is intentional). Ensure This doesnt cause text-mode extraction to always runs as a fallback, causing duplicate writes (Bug #48 already tracked) and 92s wasted streams.
Fix: Use model-ranker for past successful tool-use models as fall?ack or or cache positive FC-GATE results per model after first successful tool call. Clear on 429/provider rotation.
Bug #4: VFS path out-of-scope — 31 rejections, writes proceed anyway. I believe the root of this was that userID @as still anon... after I had logged in. Also in other places it incorrectly logs the sessionID / folderpath like 000 as the userID
Lines 2569–2580: After text-mode extraction, VFS logs [mismatch] [VFS normalizePath] path rejected: out of scope for src/agent.js, src/ui.js, package.json, etc. — but then immediately calls writeFile and the write succeeds. The "rejection" is a warn log, but the write path doesn't gate on it. Files land at paths like workspace/sessions/002/src/agent.js (the scopePath is prepended client-side), so data isn't lost — but the warn is misleading, and the LLM is never steered to use canonical workspace/sessions/... paths.
Fix: userID should update when user logs in and the files / VFS generated before should update their owner as well. Also fix incor$wct uses of sessionID as ownerID/userID. And Either (a) auto-prepend scopePath server-side and don't warn, or (b) steer the LLM with [STEER] Use paths relative to the session root, not bare filenames.
Bug #5: mistral-large 429 on every first attempt
Turns 1, 3: mistral-large-latest gets 429 immediately (within 500ms). The fallback chain rotates to google/gemini-3-flash-lite-preview or minimax-m2.7, which are weaker models that write less code or produce text-mode output. The user's configured default model is effectively never used.
Fix: circuit breaker should be wired in to skip recently 429 providers temporarily. Consider pre-checking quota before dispatch.
Bug #6: web_search always fails — "No Nullclaw container available"
3 web_search calls in Turn 1 all fail in <21ms. The Nullclaw provider is registered (score 105) but has no container. This wastes 3 tool-call slots and contributes to orchestrator failure. The model gets 3 success: false results that pollute the context.
Fix: Guard at tool registration: if Nullclaw has no container, don't register web.search as available. Emit [WARN] web.search unavailable (Nullclaw: no container) at bootstrap so the model never selects it.
Bug #7: WORKSPACE_NOT_READY spam — 188 occurrences
The snapshot gateway returns WORKSPACE_NOT_READY on every polling request for anonymous users. The UI is polling every ~30s but getting rejected each time indefinitely. The eager-init cooldown fires but no actual workspace initialization happens, creating a permanent 404 loop.
Fix: Fix the userID/ownerID being incorrect iss&es but also trace wother causes for this error. Is IndexedDB correctly used aa fal\back? Either auto-initialize the workspace on first WORKSPACE_NOT_READY, or tell the client to stop polling and instead send a "create workspace" action.
Bug #8: 251 duplicate VFS/SessionStore/Sandbox initializations
Next.js hot-reload re-initializes VFS, SessionFileTracker, SessionStore, and all 11 sandbox providers on every recompile. 251 VFS Startup Fingerprints in one run. This causes: memory growth (each init leaks the old handle), EPIPE on stale Redis connections, and brief windows where getCurrentVersionSync is missing.
Fix: The globalThis.__dbSessionStore__ singleton pattern (Bug #35 fix) needs to be extended to all singleton services: VFS, SessionFileTracker, every sandbox provider. One hot-reload should not create 251 new instances.
Bug #9: coding-agent-tui written as empty file (0 bytes)
After the batch_write tool successfully wrote 3 files (index.js, src/agent.js, src/ui.js), the text-mode parser also extracted a path called coding-agent-tui from the prose (likely the LLM's project title). This was written as a 0-byte file to workspace/sessions/001/coding-agent-tui. The path is not a file the user asked for — it's a project name hallucinated into a file path.
Fix: Text-mode extraction should skip paths that look like project names (no extension, no / separator, not in the LLM's explicit tool calls). Or: skip text-mode extraction entirely when structured tool calls already wrote files this turn (Bug #48 fix covers this).
Bug #10: STEER only fires on orchestration_fallback — 8 times, all same kind
All 8 STEER injections are orchestration_fallback. Zero steers fire for: empty completion, finishReason=stop with 0 tool calls, invalid paths, stall, incomplete response. The wireFinishReasonSteer, wireInvalidPathSteer, wireCapabilityNotFoundSteer helpers exist but are not called in the v1-api-with-tools path.
Fix: Wire all [STEER] helpers into the v1-api streaming completion handler, same as the chat route.
Bug #11: Single batch_write then stop — the "writes 3 files and dies" pattern
The user asked to "code a coding agent CLI tool with a TUI." Turn 1: gemini-3-flash called batch_write with only 3 skeleton files (index.js, src/agent.js, src/ui.js), then stopped. No package.json, no .env, no README, no tests, no proper project structure. The user had to manually reprompt "build upon further" to get more files. The model wrote step 1 of 3 and died.
Fix: After a batch_write, check: did the write cover the full scope of the user's request? If planSteps > 1 and only 1 tool call was made, auto-continue with [AUTO-CONTINUE] You completed step 1 of N. Continue with the remaining steps.
Bug #12: run it / continue — short reprompts get weak models
The user's follow-ups were desperately short ("run it", "continue", "ru:n the program") — evidence of forced manual reprompting after abrupt stops. These short messages (6–18 chars) still get routed to v1-agent-loop (correctly via contextual_followup_with_rich_tooling), but the weak fallback models (minimax-m2.7, gemini-3-flash-lite) can't complete the task. The primary model (mistral-large) is rate-limited, so every continuation degrades.
Fix: Auto-continuation should reuse the same model+provider that started the conversation or fallback, not re-run the full provider selection (which hits the 429'd primary every time). Cache the last-working provider for the session.

Bug #13: 92-second blocked stream on mistral-small-latest
Turn 2 (line 2562 (web/logs/run.log:2562)): mistral-small-latest produced 26,180 chars of text with 0 tool calls. The two-phase strategy then ran a second full streaming pass (Phase 2 text-mode fallback) which took the total to 91960ms (92 seconds) of wall time. The user waited 1.5 minutes for a single response. Phase 2 re-sends the entire 26KB text back through the parser — no timeout, no abort.
Fix: Phase 2 should have a strict timeout (e.g. 15s). If Phase 1 produced >10K chars of text (likely a full answer in prose), Phase 2 should extract edits and return immediately, not re-stream.
Bug #14: Orchestrator always fails — 100% fallback rate
All 8 turns that entered v1-agent-loop mode fell back to v1-api with orchestration_failed. The PlanActVerify orchestrator never once completed successfully. Root cause chain: it tries web_search 3× → all fail (Nullclaw) → 3-consecutive-failures → "Rate limit exceeded" → orchestration_failed. The orchestrator's first move is always a web search (per its plan step), and web search is always broken, so it always dies on step 1.
Fix: (a) Don't attempt web_search if Nullclaw has no container (Bug #6). And Nullclaw shpuldnt be the  the default path / isnt required for web_search (b) The orchestrator's plan should not require web search as prerequisite for code tasks — it should fall through to file operations when search fails, not abort the entire plan.
Bug #15: Duplicate text-mode writes — 15 edits from 8 unique files
Line 2600: After mistral-small-latest text-mode extraction, the parser found writesFound: 15 from only 8 unique file paths. 7 files were written twice — once from the initial text-mode parse, and again from the forceExtract pass on the full response. The second write overwrites the first with potentially different (truncated) content. This is a variant of Bug #48.
Fix: Deduplicate text-mode edits by path — first-write wins, subsequent same-path edits are assumed to be diffs? added to the pending edits implementation? im not sure but should  also be logged.
Bug #16: INCOMPLETE-RESPONSE-FEEDBACK reprompt sent as user message content
Line 7788: [V1-API-WITH-TOOLS] │ messagePreview: "[INCOMPLETE-RESPONSE-FEEDBACK] Your response appears to be incomplete...". The incomplete-response feedback was injected as the visible user message rather than as a system/assistant turn. The LLM sees this as the user saying "your response was truncated" — confusing the conversation context and making the LLM apologize/re-state rather than continue working.
Fix: Incomplete-response feedback should be injected as a system role message or a [STEER] prefix on the next user message, not as the user message body.
Bug #17: STALL-STEER fires at 39s but stream doesn't recover
Line 8379: [STALL-STEER] Model silent for >30s; injecting stall steer {silenceMs: 39272, lastActivityType: "text"}. The stall steer was injected ~40s into a mistral-large stream that was producing text (not actually stalled — just slow). The steer interrupted legitimate ongoing output. After the steer, the stream completed at 8674 with toolInvocations: 1 — but the injected steer may have corrupted the LLM's context mid-generation.
Fix: Stall-steer should only fire when lastActivityType is none (no tokens at all), not when it's text (model is actively writing, just slowly). The 30s threshold needs to be higher for active text generation (maybe 60s).
Bug #18: choose_role in default tool list but never invoked by any model. Also , all non-default tools ssem to never get filtered/triggered to be suggested/weighted/matched to add into context of available tools 
choose_role  The tool is supposed to enable role specialization (coder, architect, reviewer, etc.) to extend the chat, but no model ever selects it. It consumes context window space for no value.
Fix: Either make choose_role more prominent in the system prompt (with concrete examples: "If the task is complex, call choose_role with role='architect' to get architecture guidance") or some other idea
Bug #19: Parser extracts coding-agent-tui as a file path from tool-result JSON
Line 1606: The parser's forceExtract pass ran over the streaming content buffer which contained raw web_search failure JSON ({"type":"tool_result","tool":"web_search","success":false,...}). This JSON was not a file write — it's a tool failure notification embedded in the stream. The parser extracted coding-agent-tui as a write path from this JSON (likely matching on a field value), creating an empty 0-byte file.
Fix: The text-mode parser should skip JSON blocks that have "success": false or "type": "tool_result" — these are tool result notifications, not file-write instructions.
Bug #20: No session-cross contamination guard — Turn 2 writes to session 002 via session 001 paths. And subsequent file generations/edits in the same project/thread but a subsequent prompt/turn seem to go to new session folders in each turn within same intended project being edited
Line 2606: The text-mode parser resolved paths with scopePath: "workspace/sessions/002" (correct for the new session), but the earlier batch_write in Turn 1 resolved to workspace/sessions/001. The LLM's context from the previous turn included session-001 file paths. If the LLM reuses those paths without the scope prefix, files could land in the wrong session.
Fix: Validate that the resolved scopePath matches the current conversation's session, not a previous turn's session. Emit [STEER] on cross-session path attempts.
Bug #21: 91960ms response for a skeleton — cost/latency explosion, And the concurdent model request as fallback after no model tokens received seems to not be firing at all in some or all cases but ad logger to see
Turn 2 took 92 seconds to produce 39,469 characters of text output that yielded only 8 file writes (via text-mode extraction). The same task on a tool-call-capable model would take ~6 seconds (as shown by Turn 1's gemini-3-flash). The 15× latency multiplier is caused by: (a) text-mode fallback re-encoding the entire response, (b) Phase 2 re-parsing, and (c) the model writing the full file contents as prose rather than sending structured tool calls.
Fix: Time-budget the v1-api path. If Phase 1 takes >30s and produces >5K chars of text with 0 tool calls, abort Phase 1 early, extract what's available, and return. Don't wait 92s for a model that's clearly writing everything in prose.
Bug #22: Disabled V2 mode makes the richer orchestration path unreachable
DISABLE_V2_MODE: true (which is intentiona) appears in every request fingerprint. The v2-api path (which supports multi-step agent loops, auto-continuation, and richer tool orchestration) is permanently disabled. All requests are forced through v1-api, which does exactly one streaming call and stops. This is the architectural root cause of the "stops after 1 tool call" problem.
Fix:  port v2's multi-step loop into v1-api-with-tools. The single-call-then-stop architecture of v1-api cannot serve agentic tasks without a continuation wrapper.

That's the full set — 22 new OPEN bugs from this run.log trace, with #1 (no continuation loop in v1-api), #14 (100% orchestrator failure), and #22 (v2 disabled) being the architectural root causes of the "LLM always stops after step 1" and other problems of LLM failure to complete most tasks.
      
      
      
      
      
      
