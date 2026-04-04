# Session Management & State Handling Consolidation Plan

## Executive Summary

Analysis of **15+ session/state management implementations** across the codebase reveals **significant overlap** with opportunities for consolidation while maintaining distinct purposes.

---

## Current Implementations (Categorized)

### A. Session Managers (6 implementations)

| File | Purpose | Status | Overlap |
|------|---------|--------|---------|
| `lib/api/opencode-v2-session-manager.ts` | OpenCode V2 per-user sessions | ✅ Production | High |
| `lib/agent/agent-session-manager.ts` | Agent sessions with execution policies | ✅ Production | **Duplicates V2** |
| `lib/sandbox/terminal-session-store.ts` | Terminal session persistence | ✅ Production | Medium |
| `lib/sandbox/user-terminal-sessions.ts` | User terminal session manager | ✅ Production | **Duplicates terminal-store** |
| `lib/sandbox/session-store.ts` | Sandbox session SQLite store | ✅ Production | Medium |
| `lib/database/session-store.ts` | Database session store | ⚠️ Legacy | Low |

### B. State Management (4 implementations)

| File | Purpose | Status | Overlap |
|------|---------|--------|---------|
| `lib/stateful-agent/agents/stateful-agent.ts` | Stateful agent with VFS + planning | ✅ Production | High |
| `lib/agent/unified-agent.ts` | Unified agent state | ✅ Production | Medium |
| `lib/agent/use-agent.ts` | React hook state | ✅ Production | Low (UI-specific) |
| `lib/backend/agent-workspace.ts` | Workspace state | ⚠️ MVP | Medium |

### C. Response/Request Handling (3 implementations)

| File | Purpose | Status | Overlap |
|------|---------|--------|---------|
| `lib/api/unified-response-handler.ts` | Unified response format | ✅ Production | Low |
| `lib/api/priority-request-router.ts` | Priority-based routing | ✅ Production | Low |
| `lib/agent/task-router.ts` | Task routing (OpenCode vs Nullclaw) | ✅ Production | Medium |

---

## Detailed Analysis

### A1. Session Manager Duplication (CRITICAL)

**Problem:** `opencode-v2-session-manager.ts` and `agent-session-manager.ts` have **90% overlap**

#### opencode-v2-session-manager.ts
```typescript
class OpenCodeV2SessionManager {
  sessions: Map<string, OpenCodeV2Session>
  userSessions: Map<string, Set<string>>
  
  async createSession(config)
  getSession(sessionId)
  findSessionByConversation(userId, conversationId)
  updateActivity(sessionId)
  updateState(sessionId, status)
  recordMetrics(sessionId, ...)
  checkQuota(sessionId)
  stopSession(sessionId)
}
```

#### agent-session-manager.ts
```typescript
class AgentSessionManager {
  sessions: Map<string, AgentSession>
  sessionsById: Map<string, AgentSession>
  
  async getOrCreateSession(userId, conversationId, config)
  getSession(userId, conversationId)
  getSessionById(sessionId)
  updateActivity(userId, conversationId)  // Delegates to V2!
  setSessionState(userId, conversationId, state)  // Delegates to V2!
  destroySession(userId, conversationId)  // Delegates to V2!
}
```

**Key Finding:** `agent-session-manager.ts` already **delegates to V2 session manager** for:
- State updates
- Activity tracking
- Session destruction
- Quota management

**Recommendation:** **MERGE** `agent-session-manager.ts` INTO `opencode-v2-session-manager.ts`

---

### A2. Terminal Session Duplication (HIGH)

**Problem:** Three files manage terminal sessions with overlapping functionality

#### terminal-session-store.ts
```typescript
// In-memory + SQLite store
export function saveTerminalSession(session)
export function getTerminalSession(sessionId)
export function deleteTerminalSession(sessionId)
export function getAllSessions()
```

#### user-terminal-sessions.ts
```typescript
class UserTerminalSessionManager {
  getUserSessions(userId)
  createSession(userId, sandboxId)
  updateSession(sessionId, updates)
  deleteSession(sessionId)
  exportSessions()
  importSessions(json)
}
```

#### session-store.ts
```typescript
// SQLite + memory fallback
export function saveSession(session)
export function getSession(sessionId)
export function getSessionByUserId(userId)
export function deleteSession(sessionId)
export function clearUserSessions(userId)
```

**Recommendation:** **Consolidate into single `lib/sandbox/session-manager.ts`**

---

### B1. Stateful Agent vs Unified Agent (MEDIUM)

#### stateful-agent.ts
```typescript
class StatefulAgent {
  vfs: Record<string, string>
  transactionLog: Array<...>
  currentPlan: any
  
  async run(userMessage)
  async runDiscoveryPhase()
  async runPlanningPhase()
  async runEditingPhase()
  async runVerificationPhase()
  async runSelfHealingPhase()
}
```

#### unified-agent.ts
```typescript
class UnifiedAgent {
  session: AgentSession
  terminalOutput: TerminalOutput[]
  desktopHandle: DesktopHandle
  
  async initialize()
  async terminalSend(input)
  async desktopScreenshot()
  async mcpCall(toolName, args)
  async codeExecute(language, code)
  async cleanup()
}
```

**Analysis:**
- `stateful-agent.ts`: **Plan-Act-Verify** workflow with VFS
- `unified-agent.ts`: **Capability interface** (terminal, desktop, MCP, code)

**Recommendation:** **KEEP BOTH** - Different purposes
- `stateful-agent.ts` → Workflow engine
- `unified-agent.ts` → Capability interface

---

### B2. Workspace State (MEDIUM)

#### agent-workspace.ts
```typescript
class WorkspaceManager {
  workspaces: Map<string, AgentWorkspace>
  shares: Map<string, Map<string, Permission>>
  marketplace: Map<string, WorkerListing>
  
  async createWorkspace(agentId, name)
  async shareWorkspace(workspaceId, agentIds, permission)
  async checkAccess(workspaceId, agentId)
  async publishWorker(author, request)
  async searchMarketplace(query, tags)
}
```

**Analysis:** This is **multi-agent workspace sharing** + **marketplace** - distinct from session management.

**Recommendation:** **KEEP** but rename to `workspace-sharing-manager.ts` for clarity

---

### C1. Response/Request Handlers (LOW OVERLAP)

#### unified-response-handler.ts
```typescript
class UnifiedResponseHandler {
  processResponse(response): UnifiedResponse
  extractContent(response): string
  extractToolInvocations(response): ToolInvocation[]
  createStreamingEvents(response, requestId): string[]
}
```

#### priority-request-router.ts
```typescript
class PriorityRequestRouter {
  endpoints: EndpointConfig[]
  circuitBreaker: CircuitBreaker
  
  async route(request): Promise<RouterResponse>
  getCircuitBreakerStats()
}
```

#### task-router.ts
```typescript
class TaskRouter {
  analyzeTask(task): TaskRoutingResult
  executeTask(request): Promise<any>
  executeWithOpenCode(request)
  executeWithNullclaw(request)
}
```

**Analysis:**
- `unified-response-handler.ts`: Response **formatting/unification**
- `priority-request-router.ts`: LLM provider **routing with circuit breaker**
- `task-router.ts`: Agent **task routing** (OpenCode vs Nullclaw)

**Recommendation:** **KEEP ALL THREE** - Different layers
- Response handler → Output formatting
- Priority router → LLM provider selection
- Task router → Agent selection

---

## Consolidation Recommendations

### Phase 1: Critical (Week 1-2)

#### 1. Merge Session Managers
**Files:** `opencode-v2-session-manager.ts` + `agent-session-manager.ts`

**New Structure:**
```typescript
// lib/session/session-manager.ts
export class SessionManager {
  // Combined functionality
  async createSession(config: V2SessionConfig & AgentSessionConfig)
  getSession(sessionId)
  getSessionByConversation(userId, conversationId)
  updateActivity(sessionId)
  updateState(sessionId, status)
  recordMetrics(sessionId, metrics)
  checkQuota(sessionId)
  stopSession(sessionId)
  getUserSessions(userId)
  getStats()
}
```

**Migration:**
- Keep `openCodeV2SessionManager` export for backward compatibility
- Deprecate `agentSessionManager` → redirect to `SessionManager`

---

#### 2. Consolidate Terminal Sessions
**Files:** `terminal-session-store.ts` + `user-terminal-sessions.ts` + `session-store.ts`

**New Structure:**
```typescript
// lib/sandbox/session-manager.ts
export class SandboxSessionManager {
  // Unified session storage + retrieval
  save(session)
  get(sessionId)
  getByUserId(userId)
  delete(sessionId)
  exportAll()
  importAll(json)
  clearExpired()
}

export const sandboxSessionManager = new SandboxSessionManager()

// Keep backward-compatible exports
export const saveTerminalSession = sandboxSessionManager.save.bind(sandboxSessionManager)
export const getTerminalSession = sandboxSessionManager.get.bind(sandboxSessionManager)
```

---

### Phase 2: Important (Week 3-4)

#### 3. Create Unified State Interface
**Files:** `stateful-agent.ts` + `unified-agent.ts`

**New Structure:**
```typescript
// lib/agent/agent-state.ts
export interface AgentState {
  // From stateful-agent
  vfs?: Record<string, string>
  transactionLog?: Array<...>
  currentPlan?: any
  
  // From unified-agent
  session?: AgentSession
  terminalOutput?: TerminalOutput[]
  capabilities?: Set<AgentCapability>
  
  // Common
  status: 'idle' | 'working' | 'waiting' | 'completed'
  errors: Array<Error>
  metrics: AgentMetrics
}

export class AgentStateManager {
  getState(agentId): AgentState
  updateState(agentId, updates)
  persistState(agentId)
  restoreState(agentId)
}
```

**Note:** Don't merge the agents themselves - keep `StatefulAgent` and `UnifiedAgent` separate, just unify their **state representation**.

---

#### 4. Create Session/State Bridge
**New File:** `lib/session/state-bridge.ts`

```typescript
// Bridges session manager with state management
export class SessionStateBridge {
  // Sync session state with agent state
  async syncSessionWithAgentState(sessionId, agentId)
  
  // Persist agent state to session storage
  async persistAgentState(sessionId, agentState)
  
  // Restore agent state from session
  async restoreAgentState(sessionId)
}
```

---

### Phase 3: Optimization (Week 5-6)

#### 5. Response Handler Consolidation
**Files:** `unified-response-handler.ts` + `priority-request-router.ts`

**Keep separate but add integration:**
```typescript
// lib/api/response-router.ts
import { unifiedResponseHandler } from './unified-response-handler'
import { priorityRequestRouter } from './priority-request-router'

export class ResponseRouter {
  async routeAndFormat(request) {
    const routerResult = await priorityRequestRouter.route(request)
    const unifiedResponse = unifiedResponseHandler.processResponse(routerResult)
    return unifiedResponse
  }
}
```

---

## Files to Deprecate (After Migration)

| File | Deprecate When | Migration Target |
|------|----------------|------------------|
| `lib/agent/agent-session-manager.ts` | Phase 1 complete | `lib/session/session-manager.ts` |
| `lib/sandbox/terminal-session-store.ts` | Phase 1 complete | `lib/sandbox/session-manager.ts` |
| `lib/sandbox/user-terminal-sessions.ts` | Phase 1 complete | `lib/sandbox/session-manager.ts` |
| `lib/sandbox/session-store.ts` | Phase 1 complete | `lib/sandbox/session-manager.ts` |
| `lib/database/session-store.ts` | Already legacy | N/A |

---

## Files to Keep (Distinct Purposes)

| File | Reason |
|------|--------|
| `lib/api/opencode-v2-session-manager.ts` | Base for merged session manager |
| `lib/stateful-agent/agents/stateful-agent.ts` | Plan-Act-Verify workflow |
| `lib/agent/unified-agent.ts` | Capability interface |
| `lib/agent/use-agent.ts` | React hook (UI-specific) |
| `lib/backend/agent-workspace.ts` | Multi-agent workspace sharing |
| `lib/api/unified-response-handler.ts` | Response formatting |
| `lib/api/priority-request-router.ts` | LLM provider routing |
| `lib/agent/task-router.ts` | Agent task routing |

---

## Architecture After Consolidation

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Request                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              lib/session/session-manager.ts                     │
│         (Merged: V2 Session + Agent Session Managers)           │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  lib/sandbox/    │ │  lib/agent/      │ │  lib/agent/      │
│  session-manager │ │  agent-state.ts  │ │  task-router.ts  │
│  (Terminal sess) │ │  (State interface│ │  (Agent select)  │
│                  │ │   + manager)     │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              lib/api/response-router.ts                         │
│    (unified-response-handler + priority-request-router)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Checklist

### Phase 1
- [ ] Create `lib/session/session-manager.ts` (merged V2 + Agent)
- [ ] Create `lib/sandbox/session-manager.ts` (terminal sessions)
- [ ] Update all imports to use new managers
- [ ] Add deprecation warnings to old managers
- [ ] Test all session flows
- [ ] Remove old files

### Phase 2
- [ ] Create `lib/agent/agent-state.ts` (unified state interface)
- [ ] Create `lib/session/state-bridge.ts` (session ↔ state bridge)
- [ ] Update `StatefulAgent` to use new state interface
- [ ] Update `UnifiedAgent` to use new state interface
- [ ] Test state persistence/restoration

### Phase 3
- [ ] Create `lib/api/response-router.ts` (integrates response + router)
- [ ] Update API routes to use new router
- [ ] Add comprehensive logging/telemetry
- [ ] Performance testing

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session data loss during migration | HIGH | Backup all sessions before migration |
| Breaking changes to existing APIs | MEDIUM | Keep backward-compatible exports |
| State divergence between managers | MEDIUM | Single source of truth (V2 manager) |
| Performance regression | LOW | Benchmark before/after |

---

## Conclusion

**Current State:** 15+ overlapping session/state implementations
**Target State:** 6 consolidated modules with clear responsibilities

**Estimated Effort:** 3 phases × 2 weeks = **6 weeks**
**Risk Level:** MEDIUM (mitigated by backward-compatible exports)
**Benefit:** 
- 60% reduction in code duplication
- Clearer architecture
- Easier maintenance
- Better state consistency
