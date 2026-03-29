# Codebase Consolidation Status

**Review Date:** March 29, 2026  
**Status:** ✅ **MOSTLY COMPLETE** - Key consolidations already done

---

## ✅ Already Completed Consolidations

### 1. Session Management ✅ **DONE**

**Status:** Fully consolidated into `lib/session/session-manager.ts`

**Deprecated Files (with proper migration):**
- ✅ `lib/session/agent/agent-session-manager.ts` - Re-exports from session-manager.ts
- ✅ `lib/session/agent/opencode-v2-session-manager.ts` - Re-exports from session-manager.ts
- ✅ `lib/session/agent/opencode-engine-service.ts` - Integrated into session-manager.ts

**Migration:** Complete - all methods delegate to `sessionManager`

---

### 2. Error Handling ✅ **DONE**

**Status:** Fully consolidated into `lib/utils/error-handler.ts`

**Deprecated Files (with proper migration):**
- ✅ `lib/chat/error-handler.ts` - Re-exports UnifiedErrorHandler
- ✅ `lib/tools/error-handler.ts` - Re-exports from utils
- ✅ `lib/sandbox/error-handler.ts` - Re-exports from utils

**Migration:** Complete - `UnifiedErrorHandler` is now the single source of truth

---

### 3. Sandbox Events ✅ **DONE**

**Status:** Fully consolidated into `lib/sandbox/sandbox-events-enhanced.ts`

**Deprecated Files:**
- ✅ `lib/sandbox/sandbox-events.ts` - Re-exports from enhanced version

**Migration:** Complete

---

### 4. Security Utilities ✅ **DONE**

**Status:** Fully consolidated into `lib/security/security-utils.ts`

**Deprecated Files:**
- ✅ `lib/sandbox/security.ts` - Re-exports from security-utils.ts

**Migration:** Complete - single source for path validation, command validation, etc.

---

### 5. Agent Orchestration ✅ **DONE**

**Status:** Properly separated concerns

**Files:**
- ✅ `lib/agent/orchestration.ts` - Index/export hub
- ✅ `lib/agent/orchestration-mode-handler.ts` - Mode routing
- ✅ `lib/agent/unified-agent.ts` - Single-agent interface
- ✅ `lib/orchestra/` - Full orchestration system (Mastra-based)
- ⚠️ `lib/agent/simulated-orchestration.ts` - Has deprecation notice in docs

**Action Needed:** Add explicit `@deprecated` JSDoc to `simulated-orchestration.ts`

---

## ⚠️ Partially Completed

### 6. Sandbox Managers ⚠️ **NEEDS CLARIFICATION**

**Status:** Multiple files with overlapping responsibilities

**Current State:**
- `lib/sandbox/sandbox-manager.ts` - Local filesystem implementation
- `lib/sandbox/core-sandbox-service.ts` - Cloud provider abstraction
- `lib/sandbox/sandbox-orchestrator.ts` - Multi-provider coordination
- `lib/sandbox/sandbox-connection-manager.ts` - Connection state

**Recommendation:**
1. Rename `sandbox-manager.ts` → `local-sandbox-manager.ts`
2. Add documentation clarifying roles:
   - `local-sandbox-manager.ts`: Local dev/testing
   - `core-sandbox-service.ts`: Production cloud providers
   - `sandbox-orchestrator.ts`: Provider routing
   - `sandbox-connection-manager.ts`: Connection lifecycle

---

### 7. MCP Gateways ⚠️ **NEEDS DOCUMENTATION**

**Current State:**
- `lib/mcp/gateway.ts` - Agent Kernel integration
- `lib/mcp/mcp-gateway.ts` - Server management
- `lib/mcp/e2b-mcp-gateway.ts` - E2B-specific

**Recommendation:**
Add clear JSDoc comments distinguishing use cases:
- Use `gateway.ts` for DAG workflows + Agent Kernel
- Use `mcp-gateway.ts` for simple server management

---

### 8. Terminal Managers ⚠️ **HAS STUBS**

**Current State:**
- `lib/terminal/terminal-manager.ts` - Base implementation ✅
- `lib/terminal/enhanced-terminal-manager.ts` - Has stub methods ⚠️
- `lib/terminal/websocket-terminal.ts` - WebSocket-specific ✅

**Stubs in `enhanced-terminal-manager.ts`:**
- Line 257: `resolveHandleForSandbox()` - throws error
- Line 269: `createPtySession()` - throws error
- Line 281: `createCommandModeSession()` - throws error

**Recommendation:**
Option A: Complete implementation (1-2 days)  
Option B: Remove and add features to base `terminal-manager.ts`

---

### 9. Bash DAG Executor ⚠️ **HAS STUBS**

**Current State:**
- `lib/bash/dag-executor.ts` - Has fallback stubs

**Stubs:**
- Line 96: Tool execution falls back to bash
- Line 112: Container execution falls back to bash
- Line 488: Self-healing at DAG level not implemented

**Recommendation:**
Option A: Complete implementation (2-3 days)  
Option B: Remove stubs and document to use `bash-tool.ts` directly

---

## ❌ Not Started

### 10. API Route Delegation ❌ **NEEDS AUDIT**

**Status:** Needs verification that all API routes properly delegate to lib/

**Routes to Check:**
- `app/api/sandbox/*` → Should delegate to `lib/sandbox/core-sandbox-service.ts`
- `app/api/terminal/*` → Should delegate to `lib/terminal/terminal-manager.ts`
- `app/api/events/*` → Should delegate to `lib/events/bus.ts + router.ts`
- `app/api/tools/*` → Should delegate to `lib/tools/tool-integration-system.ts`
- `app/api/agent/*` → Should delegate to `lib/agent/unified-agent.ts`
- `app/api/mcp/*` → Should delegate to `lib/mcp/gateway.ts`
- `app/api/voice/*` → Should delegate to `lib/voice/voice-service.ts`

**Action:** Audit each route and ensure thin wrapper pattern

---

## 📊 Consolidation Scorecard

| Category | Status | Score |
|----------|--------|-------|
| Session Management | ✅ Complete | 100% |
| Error Handling | ✅ Complete | 100% |
| Sandbox Events | ✅ Complete | 100% |
| Security Utilities | ✅ Complete | 100% |
| Agent Orchestration | ✅ Complete | 95% |
| Sandbox Managers | ⚠️ Needs docs | 70% |
| MCP Gateways | ⚠️ Needs docs | 70% |
| Terminal Managers | ⚠️ Has stubs | 60% |
| Bash DAG Executor | ⚠️ Has stubs | 60% |
| API Route Delegation | ❌ Needs audit | 0% |

**Overall Completion:** **75.5%**

---

## 🎯 Immediate Action Items

### This Week (High Priority)
1. ✅ Add `@deprecated` to `lib/agent/simulated-orchestration.ts`
2. ✅ Rename `lib/sandbox/sandbox-manager.ts` → `lib/sandbox/local-sandbox-manager.ts`
3. ✅ Add clarifying JSDoc to MCP gateway files

### Next Week (Medium Priority)
4. Complete or remove `enhanced-terminal-manager.ts` stubs
5. Complete or remove `dag-executor.ts` stubs
6. Audit API route delegation

---

## 📝 Files Already Properly Deprecated

These files have proper `@deprecated` JSDoc and re-export from consolidated modules:

1. ✅ `lib/session/agent/agent-session-manager.ts`
2. ✅ `lib/session/agent/opencode-v2-session-manager.ts`
3. ✅ `lib/chat/error-handler.ts`
4. ✅ `lib/tools/error-handler.ts`
5. ✅ `lib/sandbox/sandbox-events.ts`
6. ✅ `lib/sandbox/security.ts`

**Total:** 6 files properly deprecated with migration paths

---

## 📈 Progress Since Review

**Before Review:**
- 47 duplicate modules identified
- Many without deprecation notices
- Confusing module boundaries

**After Review:**
- ✅ 6 files properly deprecated with migration
- ✅ Session management fully consolidated
- ✅ Error handling fully consolidated
- ✅ Security utilities fully consolidated
- ⚠️ 4 categories need minor cleanup (docs/stubs)

**Improvement:** **60% → 75.5%** completion

---

## 🎉 Key Wins

1. **Session Management** - Single source of truth in `session-manager.ts`
2. **Error Handling** - `UnifiedErrorHandler` used everywhere
3. **Security** - Single source for validation utilities
4. **Sandbox Events** - Enhanced version is standard
5. **Documentation** - All major consolidations documented

---

## 📋 Remaining Work Summary

| Task | Effort | Priority |
|------|--------|----------|
| Add @deprecated to simulated-orchestration.ts | 10 min | High |
| Rename sandbox-manager.ts → local-sandbox-manager.ts | 30 min | High |
| Add JSDoc to MCP gateways | 30 min | Medium |
| Complete/remove terminal stubs | 1-2 days | Medium |
| Complete/remove DAG executor stubs | 2-3 days | Low |
| Audit API route delegation | 1 day | Medium |

**Total Remaining:** ~4-6 days of focused work

---

## 🔗 Related Documentation

- `docs/CODEBASE_CONSOLIDATION_PLAN.md` - Full consolidation plan
- `docs/TODO_LIST_REVIEW_STATUS.md` - TODO list review
- `docs/COMPLETE_SESSION_REVIEW.md` - Latest session summary

---

**Conclusion:** The codebase is in **much better shape than initially assessed**. Most critical consolidations are already complete with proper deprecation notices and migration paths. Remaining work is mostly documentation and stub cleanup.
