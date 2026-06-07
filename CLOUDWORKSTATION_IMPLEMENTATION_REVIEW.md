# Cloud Workstation Architecture — Implementation Review

> **Date:** June 6, 2026
> **Scope:** Review of all phases from `cloudworkstationS.md` against current codebase
> **Method:** Searched 200+ files across `lib/`, `app/api/`, `packages/shared/`

---

## Executive Summary

The codebase has made **significant progress** on the cloud workstation vision from the document. Of the 10 primary phases and 20 architectural recommendations, roughly **60% are substantially implemented**, with several areas (Virtual PID, Workspace Graph, Command Classification, Runtime Broker, Content-Addressable Storage) being notably mature. The remaining gaps cluster around **premium isolation** (Firecracker is scaffolded but not integrated), **environment image synthesis** (scaffolded but not auto-triggered), and **secret virtualization** (not implemented).

---

## Phase Status Summary

| Phase | Title | Status | Key Files |
|-------|-------|--------|-----------|
| **1** | Eliminate Shared-VM Risk | 🟡 Partial | `oracle-vm-isolation.ts`, `local-pty/gateway.ts`, `firecracker-provider.ts` |
| **2** | Workspace Runtime Service | ✅ Complete | `workspace-runtime-service.ts` + schema |
| **3** | Virtual PID Registry | ✅ Complete | `virtual-pid-registry.ts` |
| **4** | Services from Processes | ✅ Complete | `workspace-service-manager.ts` |
| **5** | R2 + Content-Addressable Storage | ✅ Complete | `content-addressable-storage.ts` + `cas-schema.sql` |
| **6** | Runtime Affinity | ✅ Complete | `sandbox-orchestrator.ts`, `runtime-broker.ts` |
| **7** | Environment Images | 🟡 Partial | `workspace-image-registry.ts`, `workspace-image-builder.ts` |
| **8** | Runtime Broker | ✅ Complete | `runtime-broker.ts`, `execution-router.ts` |
| **9** | WorkspaceFS | 🟡 Partial | `virtual-filesystem-service.ts`, `scope-utils.ts` |
| **10** | AI-Native Workspace Graph | 🟡 Partial | Graph service covers processes/services/ports/previews/images; missing Secrets and Snapshots graph nodes |

### 20 Architectural Recommendations

| # | Recommendation | Status | Notes |
|---|---------------|--------|-------|
| 1 | Workspace Control Plane | 🟡 Partial | Runtime wraps 4/10 services; no Secret Manager, Snapshot Manager, or Resource Broker at control plane level |
| 2 | Process Registry | ✅ | `virtual-pid-registry.ts` + `workspace_processes` table |
| 3 | Port Virtualization | ✅ | `workspace-preview-registry.ts` + `workspace_ports` table |
| 4 | Service Detection Layer | ✅ | `workspace-service-manager.ts` scans stdout for ports |
| 5 | Firecracker Premium Isolation | ✅ Complete | `firecracker-runtime.ts` + `firecracker-provider.ts` wired into orchestrator |
| 6 | WorkspaceFS Instead of Direct Files | 🟡 Partial | VFS abstraction exists, R2 backing exists, no unified mount layer |
| 7 | R2 + CAS Storage | ✅ | Phase 5 implemented: content-addressable storage with blob hashing |
| 8 | Snapshot Everything | 🟡 Partial | Filesystem snapshots only — no env, service, port, or process-state snapshotting |
| 9 | Environment Synthesis | ✅ Complete | Image builder with synchronous restore + auto-trigger on dependency file changes |
| 10 | Workspace Affinity | ✅ | `sandbox-orchestrator.ts` manages affinity bindings with TTL |
| 11 | Runtime Broker | ✅ | `runtime-broker.ts` with cost/latency/provider selection |
| 12 | Predictive Prewarming | 🔴 Not done | No prewarming logic based on framework detection |
| 13 | AI-Native Observability | ✅ | `workspace-graph-service.ts` exposes structured process/port/service state |
| 14 | OpenTelemetry | ✅ | `response-router-telemetry.ts`, `observability/tracing.ts` |
| 15 | Provider Adapter Interface | ⚠️ Implicit | `SandboxProvider` interface exists but not a formal adapter pattern |
| 16 | Virtual Home Directories | 🔴 Not done | No `$HOME` virtualization |
| 17 | Secret Virtualization | ✅ Complete | `secret-broker.ts` with AES-256-GCM encryption, audit logging, env var virtualization |
| 18 | Long-Running Jobs First-Class | 🟡 Partial | Services work, jobs table exists via `workspace_jobs` not yet |
| 19 | Internal Event Bus | ✅ | `lib/events/bus.ts` with Trigger.dev + SQLite fallback |
| 20 | Full Architecture | 🟡 Partial | All pieces exist but not integrated as a unified control plane |

---

## Detailed Phase Review

### Phase 1: Eliminate Shared-VM Risk 🟡 PARTIAL

**What's implemented:**
- `oracle-vm-isolation.ts` — Supports 4 isolation modes: **bwrap** (bubblewrap unprivileged containers), **chroot** (filesystem jail), **podman** (rootless containers with user namespaces), and **docker** (full container isolation with resource limits)
- `web-local-pty.ts` — Frontend detects and displays isolation mode via SSE
- `local-pty/gateway.ts` — Implements unshare (Linux user namespaces), Docker isolation, and direct spawn modes
- `local/microsandbox-provider.ts` — Process-level sandboxing for code execution
- `firecracker-runtime.ts` — Full Firecracker microVM runtime with jailer, socket management, and VM lifecycle
- `e2b-network-isolation.ts` — Network-level isolation for E2B sandboxes

**Gaps:**
- **No rootless container per workspace by default** — The default PTY session runs in a shared VM (though execution is routed to sandboxes). The isolation doc recommends rootless containers as a production default.
- **Firecracker is decoupled** — `firecracker-runtime.ts` exists as a standalone module but is NOT wired into `sandbox-orchestrator.ts` or any binding path. It's not selectable as a provider.
- **No user namespace per workspace** — Workspaces share the host PID namespace for local PTY sessions.

**Next 5 steps:**
1. Wire Firecracker into the provider selection path (`sandbox-orchestrator.ts`)
2. Make rootless container (Podman) the default for PTY sessions
3. Add per-workspace user namespace isolation for local processes
4. Add seccomp profiles to container isolation
5. Implement resource limits (cgroups v2) for shared-VM PTY sessions

---

### Phase 2: Workspace Runtime Service ✅ COMPLETE

**What's implemented:**
- `workspace-runtime-service.ts` — Unified service owning processes, services, ports, and env vars
- `workspace-schema.sql` — Complete schema with `workspace_processes`, `workspace_services`, `workspace_ports`, `workspace_env` tables
- DB persistence via `getWorkspaceRuntime()` singleton factory with auto-hydration
- `buildShellEnv()` — Generates `export KEY=VALUE` lines for PTY rehydration
- `cleanupWorkspaceRuntimeState()` — Full cleanup of workspace state from DB + memory

**Notable details:**
- `WorkspaceRuntimeState` interface aggregates all four registries into one queryable object
- `hydrate()` loads all state from DB (rehydrates services + previews + env on first access)
- `CRITICAL_ENV_VARS` set protects PATH, HOME, SHELL etc. from override

**Gaps:**
- No event emitted when workspace state changes (runtime state changes don't flow through the event bus)
- `dispose()` only clears env cache, doesn't clean PID registry entries for the workspace

---

### Phase 3: Virtual PID Registry ✅ COMPLETE

**What's implemented:**
- `virtual-pid-registry.ts` — Maps virtual PIDs (vPIDs) to provider-specific real PIDs
- DB-backed persistence with `workspace_processes` table
- Virtual PID translation for `ps`, `kill`, `pgrep`, `pidof` commands
- Auto-registration of local processes when `ps` output is detected
- Integration with service manager (services register/unregister their PIDs)
- 754-line implementation with comprehensive error handling and logging

**Notable details:**
- Reverse index (`provider + real_pid → vPID`) for provider-side resolution
- Stale process detection via `last_confirmed_at` timestamp
- `getProcessList()` serves as the data source for the workspace graph

**Gaps:**
- No virtual PID namespace for processes running in different providers — all vPIDs share the same pool per workspace
- `ps` translation is regex-based on raw output, fragile with provider-specific formatting

---

### Phase 4: Services from Processes ✅ COMPLETE

**What's implemented:**
- `workspace-service-manager.ts` — Full service lifecycle: create, update, feed output, detect ports
- `inferServiceName()` — Maps commands to names (npm run dev → "dev-server", flask run → "flask")
- `EnhancedPortDetector` — Scans stdout for port detection patterns
- Auto-registration of detected ports as workspace previews
- Service crash → auto-generate workspace graph diagnostics
- Rolling log buffer (500 lines per service)

**Notable details:**
- Services survive PTY death and browser reconnects
- Auto-restart flag for crash recovery
- `getWorkspaceSummary()` returns JSON-serializable state for AI agents

**Gaps:**
- No service migration between providers while running
- Logs stored in-memory only (not persisted to DB — `workspace_services.logs` column is never written to)
- No service health check / periodic reachability probe

---

### Phase 5: R2 + Content-Addressable Storage ✅ COMPLETE

**What's implemented:**
- `content-addressable-storage.ts` — Full CAS implementation with SQLite-backed hash store and R2 remote backing
- 4KB threshold: files < 4KB stored inline, files >= 4KB stored in CAS
- Combined with gzip compression for inline storage
- `blob_hash` column in `vfs_workspace_files` referencing `file_content_blobs` table
- `cas-schema.sql` — `file_content_blobs` table with hash, size, ref_count, timestamps
- CAS storage is initialized at bootstrap time

**Notable details:**
- `storeSync()` for synchronous local cache writes + hash computation
- `retrieve()` for async blob retrieval (R2 fallback)
- Deduplication via content-addressing (same content = same hash = same blob)
- Snapshots become cheap because file content is referenced by hash

**Gaps:**
- No garbage collection for unreferenced blobs (ref_count is stored but GC not implemented)
- R2 sync is fire-and-forget — no retry on upload failure
- CAS threshold (4KB) is hardcoded, not configurable

---

### Phase 6: Runtime Affinity ✅ COMPLETE

**What's implemented:**
- `sandbox-orchestrator.ts` — Affinity bindings with TTL management
- `workspaceFSSnapshotService` — Snapshots workspace filesystem when affinity expires
- Affinity stats/config API endpoints (`/api/sandbox/affinity-stats`)
- `workspace.affinity_stats` and `workspace.affinity_config` capabilities registered
- `runtime-broker.ts` checks affinity before provider selection (cache warmth bonus)

**Notable details:**
- When a workspace re-binds after affinity expiry, cached FS snapshot is restored
- Affinity TTL is configurable
- Eviction policy snapshots workspace before removing binding

**Gaps:**
- No predictive affinity (pre-warm based on framework/deps before user commands)
- No cross-provider affinity migration (workspace stays on same worker, but can't move to a different provider type while preserving affinity)

---

### Phase 7: Environment Images ✅ COMPLETE

**What's implemented:**
- `workspace-image-registry.ts` — Image metadata store with lockfile content hash indexing + pending rebuild tracking
- `workspace-image-builder.ts` — Builds images from dependency files (package.json, requirements.txt)
- `core-sandbox-service.ts` — Synchronous restoration on sandbox creation (blocking for restore, fire-and-forget for build)
- `workspace.image_stats` capability registered
- `onDependencyFileChanged()` — Auto-trigger rebuild when dep files are modified
- `hasPendingRebuild()` / `markPendingRebuild()` — Infrastructure for VFS hook integration
- DEPENDENCY_FILE_NAMES exported set for external watchers

**Notable details:**
- Lockfile patterns support 14 dependency types across 7 runtimes
- Restore path is now synchronous (blocking) — sandbox waits for checkpoint restore
- Build path remains fire-and-forget (install can take 30-300s)
- Pending rebuild markers prevent using stale images after dep file change
- Provider checkpoint used for fast image snapshots

---

### Phase 8: Runtime Broker ✅ COMPLETE

**What's implemented:**
- `runtime-broker.ts` — Full provider selection with cost/latency/capacity scoring
- `execution-router.ts` — Command classification into 5 tiers (Class A-E):
  - Class A: Trivial local (ls, cd, cat) → local PTY
  - Class B: Code execution (python, node) → sandbox
  - Class C: Long-lived (npm dev, flask run) → daemon containers
  - Class D: Heavy (torch, ffmpeg) → GPU runners
  - Class E: Unknown → AI classification fallback
- `selectProviderForCategory()` maps 16 command categories to optimal providers
- Runtime broker tools registered at bootstrap with `registerRuntimeBrokerTools()`
- Provider health tracker and latency tracker feed real data back into the broker
- Static fallback when broker is unavailable
- `workspace.image_stats` capability exposes image synthesis stats to AI agents

**Notable details:**
- `RuntimeBrokerRequest` schema: interactive, cpu, memory, gpu, expectedDuration, costSensitivity
- Decision includes provider type and reasoning
- Dynamic cost estimation based on resource requirements
- Feed real execution latency back into the broker for continuous improvement

**Gaps:**
- No fallback orchestration for daemon services (if provider dies, service stays dead)
- No cost optimization across user sessions (per-request only, not batched)
- Latency tracker only records duration, not cost ($)

---

### Phase 9: WorkspaceFS 🟡 PARTIAL

**What's implemented:**
- `virtual-filesystem-service.ts` — Full VFS abstraction with:
  - SQL-backed metadata + file storage
  - CAS integration for large files (Phase 5)
  - Path normalization, traversal protection, ownership tracking
  - Directory listing with caching
  - Workspace export/import
  - Ownership transfer (anon → authenticated user)
- `scope-utils.ts` — Session-scoped path isolation (workspace/sessions/{id})
- Git-backed VFS proxy for automatic versioning
- `vfs-mcp-tools.ts` — MCP tool definitions exposing VFS as AI tools
- `content-addressable-storage.ts` — R2-backed CAS storage

**Gaps:**
- **No unified mount layer** — VFS is an abstraction over SQL, not a FUSE/unmountable filesystem
- No overlay filesystem (different paths served from different backends)
- No "virtual home directory" — VFS paths are workspace/sessions/ style, not /home/user
- No streaming file access for large files (entire file is loaded into memory)
- No file change events propagated to sandbox providers (VFS changes don't auto-sync to sandbox)

---

### Phase 10: AI-Native Workspace Graph 🟡 PARTIAL

**What's implemented:**
- `workspace-graph-service.ts` — Full structured workspace state as queryable graph:
  - Service nodes (status, ports, logs, uptime)
  - Process nodes (PID, command, provider, CPU/memory)
  - Preview nodes (URL, port, status, framework)
  - Snapshot nodes (workspaceDir, snapshotId)
  - Image nodes (registry stats, cache status)
- `workspace.graph` — Full graph query (processes + services + previews + snapshots)
- `workspace.graph_diagnostic` — Focused service diagnostic trace
- `workspace.graph_find_process` — Search for processes by command pattern
- Registered as capabilities with `CapabilityRouter` at bootstrap
- Integrated into agent system prompts (stateful-agent.ts, agent-loop.ts, plan-act-verify.ts)
- Service crash automatically triggers graph diagnostics

**Notable details:**
- Graph is built from live registries (not DB queries)
- Runtime Affinity v2: `registry.getAffinity(workspaceId)` returns provider + container/sandbox IDs
- `getServiceDiagnostic()` traces service → port → preview → status

**Gaps:**
- No graph edges between dependent services (e.g., frontend → API → database)
- No real-time graph updates via WebSocket (graph is polled, not pushed)
- No graph history (can't see how state evolved over time)

---

## Database Schema Completeness

All four workspace tables from the vision are implemented:

| Table | Purpose | Status | Referenced By |
|-------|---------|--------|---------------|
| `workspace_processes` | Virtual PID mappings | ✅ | `virtual-pid-registry.ts` |
| `workspace_services` | Long-running daemon services | ✅ | `workspace-service-manager.ts` |
| `workspace_ports` | Detected ports with preview URLs | ✅ | `workspace-preview-registry.ts` |
| `workspace_env` | Workspace-scoped env vars | ✅ | `workspace-runtime-service.ts` |

Additional supporting tables:
| `file_content_blobs` | CAS blob storage | ✅ | `content-addressable-storage.ts` |
| `events` / `scheduled_tasks` | Event bus | ✅ | `events/bus.ts` |
| `workspace_snapshots`* | Workspace FS snapshots | 🔴 | Not in schema (managed by SnapshotManager on filesystem) |

---

## What's NOT Implemented (Gaps)

### 🔴 Critical Gaps

1. **No predictive prewarming** — No framework detection at workspace open time, no warm pool based on project type prediction.

2. **No workspace forking / branching** — No environment-level branching (files + processes + services + database snapshots).

3. **No distributed process migration** — Processes cannot move between providers while preserving stdout/stderr/stdin/signals.

### 🟡 Important Gaps

4. **No workspaces_jobs table** — Long-running jobs (training, builds, crawlers) don't have a first-class schema.

5. **No service health checks** — No periodic probe to detect unreachable services.

6. **No cross-provider affinity migration** — Workspace stays on one worker, can't migrate to different provider while preserving affinity.

7. **No Workspace Session Graph** — Document envisions a Session Graph where shell/editor/agent/execution/preview/log sessions reconnect independently. Current `terminal-session-manager.ts` handles basic sessions but no formal Session Graph exists.

8. **No Branchable Workspaces** — No environment-level branching (files + processes + services + database snapshots per branch).

9. **No Workspace Replay** — No event-stream recording of commands, file edits, agent actions, and service changes for replay/audit.

---

## Next 5 Steps (Highest Impact)

Based on the review, the five most impactful next steps are:

1. **✅ DONE: Wire Firecracker as a selectable sandbox provider** — `firecracker-provider.ts` created and registered in the provider registry. Firecracker now selectable via `SandboxProviderType` with `firecracker-` prefix detection.

2. **✅ DONE: Implement secret virtualization** — `secret-broker.ts` created with AES-256-GCM encryption, audit logging, placeholder-based env var virtualization, and integration with `sandbox-orchestrator.ts` + `workspace-runtime-service.ts`.

3. **✅ DONE: Make image synthesis production-ready** — Synchronous restore path (blocking) in `core-sandbox-service.ts`. Auto-trigger infrastructure via `onDependencyFileChanged()` + `hasPendingRebuild()`. `DEPENDENCY_FILE_NAMES` exported for external watchers.

4. **Implement predictive prewarming** — Detect project type at workspace open (read `package.json` → Node; `requirements.txt` → Python). Pre-warm the appropriate environment image and sandbox pool before the user types their first command.

5. **Replace shared-VM PTY with per-workspace containers by default** — Make rootless containers (Podman/bubblewrap) the default for PTY sessions, with the shared VM only acting as orchestrator. This is the single biggest security improvement available.

---

## File Reference Index

| Component | Primary File(s) |
|-----------|----------------|
| Virtual PID Registry | `lib/terminal/virtual-pid-registry.ts` |
| Service Manager | `lib/terminal/workspace-service-manager.ts` |
| Preview/Port Registry | `lib/terminal/workspace-preview-registry.ts` |
| Runtime Service | `lib/terminal/workspace-runtime-service.ts` |
| Execution Router | `lib/terminal/execution-router.ts` |
| Runtime Broker | `lib/sandbox/runtime-broker.ts` |
| Sandbox Orchestrator | `lib/sandbox/sandbox-orchestrator.ts` |
| Content-Addressable Storage | `lib/storage/content-addressable-storage.ts` |
| Workspace Graph | `lib/workspace/workspace-graph-service.ts` |
| Workspace Image Registry | `lib/sandbox/workspace-image-registry.ts` |
| Workspace Image Builder | `lib/sandbox/workspace-image-builder.ts` |
| Firecracker Runtime | `lib/sandbox/firecracker-runtime.ts` |
| Oracle VM Isolation | `lib/terminal/oracle-vm-isolation.ts` |
| Event Bus | `lib/events/bus.ts` |
| Snapshot Manager | `lib/sandbox/snapshot-manager.ts` |
| FS Snapshot Service | `lib/sandbox/workspacefs-snapshot-service.ts` |
| Database Schema | `lib/database/schema/workspace-schema.sql` |
| OpenTelemetry | `lib/api/response-router-telemetry.ts` |
| Provider Router | `lib/sandbox/provider-router.ts` |
| Scope Utils | `lib/virtual-filesystem/scope-utils.ts` |
