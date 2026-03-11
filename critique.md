Here’s a focused critique beyond “security” and beyond the issues you already listed. These are implementation/architecture flaws, missing wiring, and improvement opportunities that stood out from the codebase:





13. Hard‑coded heuristics drive critical routing


“Code vs non‑code” detection and V2 auto‑routing are based on keyword regex. This causes false positives/negatives.
Improvement: explicit user intent flags or model‑classified request type cached per session.
14. Excessive coupling between UI and backend formats


UI hooks parse SSE event types and metadata fields that vary by backend branch.
Improvement: unify server streaming into one canonical event schema.
15. Duplicate feature stacks instead of modularized adapters


Multiple LLM agent stacks (tool loop, unified agent, opencode engine) duplicate logic.
Improvement: a thin adapter layer so the UI talks to one pipeline; provider/engine differences handled inside.
16. State management fragmentation


Several places store critical state in localStorage, sessionStorage, and in-memory React state with no reconciliation.
Improvement: a single store with persistence strategy and a versioned schema.
17. Preview uses “best effort” inference


Detecting framework/bundler from files is error‑prone.
Improvement: store explicit metadata from agents (framework, entry, bundler) when files are written.
18. VFS snapshot is heavy for frequent refresh


exportWorkspace and full snapshot in preview refresh can be expensive.
Improvement: incremental change API (diffs or file change events) and a client‑side cache.
19. Tooling lacks deterministic replay


There is no consistent “task replay” or “execution log” that can rebuild state.
Improvement: append‑only action log per session.
20. Minimal observability for multi‑agent flows


Workforce or subagents write to STATE.yaml but no real UI/UX surface.
Improvement: lightweight task dashboard, streaming status updates into chat metadata.
21. Error handling inconsistent across pipeline layers


Some layers return success: false, others throw; UI interprets inconsistently.
Improvement: normalize error contract so UI can render and retry reliably.
22. Tests are broad but missing critical integration coverage


Many tests exist, but few prove “file attach → edit → preview” flows.
Improvement: add a small end‑to‑end test that exercises real user actions.
23. “Context pack” doesn’t align to active scope


Current logic uses scopePath but doesn’t validate that the scope matches attached files.
Improvement: attach files should implicitly set active scope.
24. Command/diff rendering is UI‑only until now


You already had separate commandsByFile and diff parsing, but they didn’t modify VFS.
The architecture should treat diffs as a first‑class artifact, not a UI‑only addon.
25. Preview panel depends on many side effects


It listens to filesystem-updated, reads snapshots, and updates internal state.
Improvement: create a lightweight VFS subscription API to push updates instead.
26. Background jobs / long‑running tasks are uncoordinated


Several systems spawn work without a job scheduler or cancellation policy.
Improvement: a single job manager with timeouts and visibility.
27. Excessive UI “features” degrade stability


The preview panel and interaction panel both contain a huge set of features.
Improvement: split into modular sub‑components with strict props and test coverage.
If you want, I’ll map these into a prioritized list with expected effort and impact, but I’ll keep it short.





More:


28. Sandbox/terminal session lifecycle isn’t deterministic


Sessions are created in multiple places with different IDs; cleanup is ad‑hoc.
Improvement: one session registry with TTL, explicit start/stop, and ref‑counted attachment to UI components.
29. Agent tool calls are not versioned or schema‑validated at boundary


Tool invocations are passed through without strict schema enforcement in streaming.
Improvement: enforce schema at tool dispatch and serialize consistent tool results.
30. “Contextual messages” are over‑assembled


System prompt + context pack + attached files + denial context gets concatenated without strong size governance.
Improvement: token budgeting at assembly time with explicit priority ordering.
31. “Attached files” are not guaranteed to be fresh


Attach reads file once and never refreshes; no stale detection.
Improvement: add version tracking and warn when attached versions are older than current VFS.
32. No explicit compatibility between VFS and MCP tools


MCP tools likely read/write a different FS path mapping than the VFS.
Improvement: standardize file path mapping across VFS and MCP, or provide an adapter.
33. Workflows around diff application are inconsistent


Some diffs are applied by chat backend, others by UI.
Improvement: a single diff‑apply service used by both UI and backend.
34. Lack of “project root” canonicalization


The system decides scope from conversation ID, sometimes from UI, sometimes from defaults.
Improvement: on session creation, store canonical scope and reuse everywhere.
35. “Preview” and “Editor” are not transactionally consistent


Visual editor updates VFS via broadcast; preview refresh is asynchronous.
Improvement: two‑phase updates (write → ack → refresh) to avoid preview showing stale data.
36. Unclear performance boundaries


Some operations can walk the entire workspace for every change.
Improvement: indexing and incremental updates; avoid full snapshot for UI update.
37. Environment flags scatter critical behavior


Multiple env vars change core routing behavior without a single central config object.
Improvement: consolidated config and explicit logging of effective mode.
38. Command execution vs file edits isn’t bounded by policy


It’s unclear what’s allowed when user is anonymous vs authenticated, or in v2 mode.
Improvement: explicit policy layer with consistent enforcement.
39. Too much “magic” for preview file mapping


Files are guessed, sometimes default App.jsx is injected.
Improvement: only inject when no files exist; otherwise respect file system contents.
40. Chat response parsing is still a core pathway


Parsing diffs from assistant messages is fragile and will fail on model formatting changes.
Improvement: enforce tool‑based edits as primary; parse only for backward compatibility.
