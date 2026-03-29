# binG - Centralized Master To-Do List

**Generated:** March 29, 2026
**Source:** Analysis of 94 .md files in root directory
**Priority System:** P0 (Critical) → P1 (High) → P2 (Medium) → P3 (Low)

---

## 🔴 P0 - Critical (Do Today/This Week)

### 1. MCP Server Registration - 9 DAYS OVERDUE
**Source:** REVIEW_2026-03-27.md
**Status:** ❌ NOT STARTED
**Effort:** 4 hours
**Impact:** Competitive liability - MCP code is 8/10 quality but 0/10 discoverability

**Tasks:**
- [ ] Submit to Smithery Registry
- [ ] Add stdio transport for Claude Desktop
- [ ] Create npm package @bing/mcp-server
- [ ] Submit to MCP Atlas (GitHub issue)
- [ ] Create mcp.json for npm/PyPI
- [ ] Write MCP integration documentation

**Files to Create/Modify:**
- `lib/mcp/transports.ts` - Add stdio transport
- `package.json` - Add bin field for MCP CLI
- `mcp.json` - MCP manifest

---

### 2. Event Store + Durable Execution System
**Source:** PHASE_4_UPDATED_IMPLEMENTATION_PLAN.md, PHASE_4_DURABLE_EVENTS_IMPLEMENTATION_PLAN.md
**Status:** ❌ NOT STARTED
**Effort:** 1 week
**Impact:** Enables retry/replay, dynamic scheduling, self-healing

**Tasks:**
- [ ] Create `/lib/events/schema.ts` (Zod event schemas)
- [ ] Create `/lib/events/store.ts` (SQLite persistence)
- [ ] Create `/lib/events/bus.ts` (Event emission API)
- [ ] Create `/app/api/events/route.ts` (API endpoint)
- [ ] Create database migration for events table
- [ ] Create `/lib/events/scheduler.ts` (Dynamic cron poller)
- [ ] Create `/lib/events/router.ts` (Switch-based dispatch)
- [ ] Create sample handlers (HN daily, research, email)

**Integration Points:**
- Update `lib/agent/task-router.ts` to emit events
- Update `lib/agent/orchestration/agent-orchestrator.ts` for phase events
- Update `lib/agent/workflow-templates.ts` for workflow events

---

### 3. Fix MCP Server Registration (Smithery + JFrog)
**Source:** REVIEW_2026-03-27.md, CODE_REVIEW_FIX_N8N_SECURITY.md
**Status:** ❌ NOT STARTED
**Effort:** 2 hours

**Tasks:**
- [ ] Install Smithery CLI: `npx smithery publish`
- [ ] Submit to JFrog Universal MCP Registry
- [ ] Add MCP server metadata to package.json
- [ ] Create README for MCP server usage

---

## 🟠 P1 - High Priority (This Week)

### 4. Warm Pool Manager for Sandboxes
**Source:** 000.md, ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 2-3 days
**Impact:** 10s → 300ms sandbox startup

**Tasks:**
- [ ] Create `/lib/sandbox/warm-pool-manager.ts`
- [ ] Implement pre-warming for common templates (node, python, base)
- [ ] Add automatic refill on usage
- [ ] Add health checking
- [ ] Integrate with `lib/sandbox/provider-router.ts`
- [ ] Add capacity handling with cooldown

**Files to Create:**
- `lib/sandbox/warm-pool-manager.ts`
- `__tests__/sandbox/warm-pool.test.ts`

---

### 5. Self-Healing Bash with Diff-Based Repair
**Source:** bash.md, trigger.md
**Status:** ❌ NOT STARTED
**Effort:** 3-4 days
**Impact:** Autonomous command repair, fewer failures

**Tasks:**
- [ ] Create `/lib/bash/execute-with-healing.ts`
- [ ] Create `/lib/bash/diff-repair.ts` (minimal patches)
- [ ] Create `/lib/bash/repair-memory.ts` (reinforcement learning)
- [ ] Create `/lib/bash/safety-check.ts` (dangerous command blocking)
- [ ] Integrate with AgentFS just-bash
- [ ] Add error classification (missing_binary, missing_file, permissions)
- [ ] Add LLM-based repair with confidence scoring

**Files to Create:**
- `lib/bash/execute-with-healing.ts`
- `lib/bash/diff-repair.ts`
- `lib/bash/repair-memory.ts`
- `lib/bash/safety-check.ts`

---

### 6. DAG Compiler from Bash Pipelines
**Source:** bash.md, trigger.md
**Status:** ❌ NOT STARTED
**Effort:** 3-4 days
**Impact:** Convert `curl | jq | grep` → durable workflows

**Tasks:**
- [ ] Create `/lib/dag/schema.ts` (DAG node types)
- [ ] Create `/lib/dag/parse.ts` (bash → AST)
- [ ] Create `/lib/dag/compiler.ts` (pipeline → DAG)
- [ ] Create `/lib/dag/executor.ts` (parallel execution)
- [ ] Create `/lib/events/handlers/dag-execution.ts`
- [ ] Add pipe semantics (stdout → stdin simulation)
- [ ] Add hybrid compilation (bash → tool upgrade)
- [ ] Add LLM-assisted compilation

**Files to Create:**
- `lib/dag/schema.ts`
- `lib/dag/parse.ts`
- `lib/dag/compiler.ts`
- `lib/dag/executor.ts`

---

### 7. Timeout Escalation Strategy
**Source:** ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 1 day
**Impact:** Better timeout handling, graceful degradation

**Tasks:**
- [ ] Create `/lib/agent/timeout-escalation.ts`
- [ ] Implement staged timeouts (10s → 30s → 60s)
- [ ] Add warn/terminate/migrate stages
- [ ] Integrate with StatefulAgent
- [ ] Add metrics for timeout tracking

**Files to Create:**
- `lib/agent/timeout-escalation.ts`

---

### 8. Provider Health Prediction
**Source:** ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 1-2 days
**Impact:** Predict failures before they happen

**Tasks:**
- [ ] Create `/lib/sandbox/provider-health.ts`
- [ ] Track failure rates per provider
- [ ] Implement health scoring (0-100)
- [ ] Add deprioritization for unhealthy providers
- [ ] Add latency spike detection
- [ ] Integrate with provider-router

**Files to Create:**
- `lib/sandbox/provider-health.ts`

---

## 🟡 P2 - Medium Priority (Next 2 Weeks)

### 9. Observability/Tracing (OpenTelemetry)
**Source:** ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 2-3 days
**Impact:** Full request tracing, bottleneck identification

**Tasks:**
- [ ] Add @opentelemetry/api to package.json
- [ ] Create `/lib/observability/tracing.ts`
- [ ] Add spans for: agent-execution, tool-calls, sandbox-creation
- [ ] Create `/lib/observability/metrics.ts`
- [ ] Add Prometheus/Grafana integration
- [ ] Create dashboard for key metrics

**Files to Create:**
- `lib/observability/tracing.ts`
- `lib/observability/metrics.ts`

---

### 10. Repo Index / Code Search
**Source:** ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 3-5 days
**Impact:** Faster code search, semantic understanding

**Tasks:**
- [ ] Create `/lib/repo-index/indexer.ts`
- [ ] Choose storage: SQLite vs Qdrant
- [ ] Implement code parsing (AST generation)
- [ ] Add semantic search (embeddings)
- [ ] Add keyword search
- [ ] Integrate with agent discovery

**Files to Create:**
- `lib/repo-index/indexer.ts`
- `lib/repo-index/search.ts`

---

### 11. Snapshot System
**Source:** ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 2-3 days
**Impact:** 60s → 5s startup for configured sandboxes

**Tasks:**
- [ ] Create `/lib/sandbox/snapshot-manager.ts`
- [ ] Implement snapshot creation
- [ ] Implement snapshot restore
- [ ] Add snapshot listing
- [ ] Add pre-configured environments (node, python, rust)
- [ ] Integrate with warm pool

**Files to Create:**
- `lib/sandbox/snapshot-manager.ts`

---

### 12. Multi-Agent Orchestration MCP
**Source:** REVIEW_2026-03-27.md
**Status:** ❌ NOT STARTED
**Effort:** 2 weeks
**Impact:** Unique differentiator - no other MCP offers this

**Tasks:**
- [ ] Add MCP tools: CREATE_AGENT_SESSION, LIST_AGENTS, COORDINATE_AGENTS
- [ ] Create `/lib/mcp/multi-agent-tools.ts`
- [ ] Implement agent coordination protocol
- [ ] Add result aggregation
- [ ] Integrate with StatefulAgent

**Files to Create:**
- `lib/mcp/multi-agent-tools.ts`

---

### 13. Vercel Sandbox Integration
**Source:** REVIEW_2026-03-27.md
**Status:** ❌ NOT STARTED
**Effort:** 1 week
**Impact:** Deploy on Vercel with Firecracker isolation

**Tasks:**
- [ ] Add @vercel/sandbox to package.json
- [ ] Create `/lib/sandbox/providers/vercel-provider.ts`
- [ ] Implement create/start/stop/destroy
- [ ] Add Vercel-specific execution policies
- [ ] Test with mcp-handler adapter

**Files to Create:**
- `lib/sandbox/providers/vercel-provider.ts`

---

### 14. WebMCP Native Support
**Source:** REVIEW_2026-03-27.md
**Status:** ❌ NOT STARTED
**Effort:** 1 week
**Impact:** 98% success rate for AI agent interactions

**Tasks:**
- [ ] Create `/app/.well-known/webmcp/route.ts`
- [ ] Add WebMCP manifest
- [ ] Implement WebMCP tool definitions
- [ ] Add Chrome 146+ compatibility
- [ ] Test with AI agents

**Files to Create:**
- `app/.well-known/webmcp/route.ts`

---

### 15. Bash → Event System Integration
**Source:** bash.md
**Status:** ❌ NOT STARTED
**Effort:** 2-3 days
**Impact:** Durable bash execution with replay

**Tasks:**
- [ ] Create BashEvent schema
- [ ] Update bash tool to emit events
- [ ] Create `/lib/events/handlers/bash-execution.ts`
- [ ] Integrate with AgentFS just-bash
- [ ] Add hybrid escalation (bash → container)

**Files to Create:**
- `lib/events/handlers/bash-execution.ts`

---

## 🟢 P3 - Low Priority (Next Month)

### 16. Planner/Executor Pattern
**Source:** ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 3-5 days
**Impact:** Multi-agent orchestration

**Tasks:**
- [ ] Create `/lib/agent/planner-agent.ts`
- [ ] Implement task decomposition
- [ ] Create executor pool
- [ ] Add result aggregation
- [ ] Integrate with CrewAI

---

### 17. Mode-Specific Configuration
**Source:** ORCHESTRATION_MODE_COMPLETE.md
**Status:** ❌ NOT STARTED
**Effort:** 2 days
**Impact:** Better UX for orchestration modes

**Tasks:**
- [ ] Add configuration UI per mode
- [ ] Add mode parameter validation
- [ ] Add mode presets
- [ ] Add configuration persistence

---

### 18. Mode Testing Framework
**Source:** ORCHESTRATION_MODE_COMPLETE.md
**Status:** ❌ NOT STARTED
**Effort:** 3-4 days
**Impact:** Quality assurance for modes

**Tasks:**
- [ ] Implement test button functionality
- [ ] Add mode comparison UI
- [ ] Add performance benchmarking
- [ ] Add success rate tracking

---

### 19. Analytics Dashboard
**Source:** ORCHESTRATION_MODE_COMPLETE.md, ARCHITECTURE_IMPROVEMENTS_STATUS.md
**Status:** ❌ NOT STARTED
**Effort:** 1 week
**Impact:** Visibility into system performance

**Tasks:**
- [ ] Create analytics API endpoints
- [ ] Add mode usage tracking
- [ ] Add success rate dashboard
- [ ] Add performance metrics visualization
- [ ] Add error tracking dashboard

---

### 20. Commit Message Quality
**Source:** REVIEW_2026-03-27.md
**Status:** ❌ NOT STARTED
**Effort:** Ongoing
**Impact:** Better audit trail, easier debugging

**Tasks:**
- [ ] Adopt conventional commits
- [ ] Add commit message template
- [ ] Add pre-commit hook for validation
- [ ] Document commit message format

---

## ✅ Recently Completed (Reference)

### From TODO_IMPLEMENTATION_SUMMARY.md
- [x] Rollback endpoint with 3 modes + partial rollback
- [x] MCP provider tools (E2B with git repos)
- [x] Partial rollback support
- [x] Zero TypeScript errors

### From ORCHESTRATION_MODE_COMPLETE.md
- [x] All 5 orchestration modes wired
- [x] UI component with mode selector
- [x] React context for state management
- [x] Backend handler for routing
- [x] localStorage persistence

### From CODE_REVIEW_FIXES.md
- [x] Error handling in orchestration-tab.tsx
- [x] Request timeouts (5s)
- [x] Error differentiation (5xx vs 404)
- [x] User feedback via toast
- [x] Comprehensive logging

### From ARCHITECTURE_IMPROVEMENTS_STATUS.md
- [x] Warm pool system
- [x] Sandbox orchestrator
- [x] Execution policy engine
- [x] NDJSON parser
- [x] Execution graph
- [x] Agent workers
- [x] StatefulAgent
- [x] Template flows
- [x] Loop detection
- [x] Enhanced logging

---

## 📊 Statistics

| Priority | Count | Estimated Effort |
|----------|-------|------------------|
| P0 (Critical) | 3 | 2 weeks |
| P1 (High) | 5 | 2-3 weeks |
| P2 (Medium) | 7 | 3-4 weeks |
| P3 (Low) | 5 | 2-3 weeks |
| **Total** | **20** | **9-12 weeks** |

---

## 🎯 Recommended Next Steps

### Week 1 (Critical)
1. **MCP Server Registration** (4 hours) - COMPETITIVE LIABILITY
2. **Event Store Foundation** (3 days) - Enables durable execution
3. **Warm Pool Manager** (2 days) - 10s → 300ms startup

### Week 2 (High Impact)
4. **Self-Healing Bash** (3 days) - Autonomous repair
5. **DAG Compiler** (3 days) - Bash → workflows
6. **Timeout Escalation** (1 day) - Better error handling

### Week 3-4 (Medium Impact)
7. **Observability** (2 days) - Full tracing
8. **Provider Health** (1 day) - Failure prediction
9. **Repo Index** (3 days) - Code search

---

## 📝 Notes

- **MCP Registration is blocking competitive positioning** - 9 days overdue per REVIEW_2026-03-27.md
- **Event System is foundational** - enables retry/replay, scheduling, self-healing
- **Warm Pool has highest ROI** - 10s → 300ms is game-changing for UX
- **Bash → DAG is unique differentiator** - no other platform has this
- **Commit messages need improvement** - "unoMAS", "crAsh" are not descriptive

---

## 🔗 Source Documents

- REVIEW_2026-03-27.md - Strategic review with MCP registration urgency
- PHASE_4_UPDATED_IMPLEMENTATION_PLAN.md - Event system architecture
- PHASE_4_DURABLE_EVENTS_IMPLEMENTATION_PLAN.md - Durable execution plan
- ARCHITECTURE_IMPROVEMENTS_STATUS.md - Feature status tracking
- bash.md, trigger.md - Bash integration patterns
- ORCHESTRATION_MODE_COMPLETE.md - Mode selector completion
- CODE_REVIEW_FIXES.md - Error handling improvements
- TODO_IMPLEMENTATION_SUMMARY.md - Completed TODOs
- 000.md - Architecture analysis
- NEXT_STEPS_IMPLEMENTATION.md - Integration tests, templates
