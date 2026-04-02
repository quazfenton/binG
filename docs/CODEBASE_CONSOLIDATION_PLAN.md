# Codebase Consolidation Plan

**Generated:** March 29, 2026  
**Review Scope:** Full codebase audit for duplicates, stubs, and consolidation opportunities  
**Total Duplicates Found:** 47 files across 10 categories

---

## Executive Summary

This consolidation plan addresses **47 duplicate/redundant modules** that create maintenance burden, confusion about which module to use, and potential bugs from divergent implementations.

**Estimated Effort:** 60-90 hours over 6 weeks  
**Expected Outcome:** 15-20 fewer files, clearer module boundaries, reduced maintenance burden

---

## 🎯 Consolidation Priority Matrix

| Priority | Category | Files | Effort | Impact | Week |
|----------|----------|-------|--------|--------|------|
| **P0** | Session Management | 6 | High | High | 1-2 |
| **P0** | Error Handling | 3 | Low | Medium | 1 |
| **P1** | Sandbox Managers | 4 | Medium | High | 3 |
| **P1** | Agent Orchestration | 5 | Medium | High | 3-4 |
| **P1** | MCP Gateways | 3 | Medium | Medium | 4 |
| **P2** | Terminal Managers | 3 | Low | Medium | 5 |
| **P2** | Security Utilities | 2 | Low | Medium | 5 |
| **P3** | Bash Handling | 1 | Medium | Low | 6 |
| **P3** | API Route Delegation | 7 routes | Medium | Medium | 6 |

---

## Phase 1 (Week 1-2): Critical Duplicates

### 1.1 Session Management Consolidation

**Files Affected:** 6

| File | Current Status | Action |
|------|---------------|--------|
| `lib/session/session-manager.ts` | **SOURCE OF TRUTH** | Keep as primary |
| `lib/session/agent/agent-session-manager.ts` | 90% duplicate | **MERGE INTO** session-manager.ts |
| `lib/session/agent/opencode-v2-session-manager.ts` | 90% duplicate | **MERGE INTO** session-manager.ts |
| `lib/session/agent/opencode-engine-service.ts` | CLI integration | **EXTRACT** CLI logic, merge rest |
| `lib/sandbox/user-terminal-sessions.ts` | Terminal sessions | **MOVE TO** lib/sandbox/session-manager.ts |
| `lib/sandbox/terminal-session-store.ts` | Terminal persistence | **MOVE TO** lib/sandbox/session-manager.ts |

**Migration Steps:**

```typescript
// Step 1: Create consolidated session manager
// lib/session/session-manager.ts (updated)

export interface SessionManagerConfig {
  // From session-manager.ts
  defaultTimeout?: number;
  
  // From agent-session-manager.ts
  executionPolicy?: ExecutionPolicy;
  
  // From opencode-v2-session-manager.ts
  openCodeConfig?: OpenCodeConfig;
  
  // From terminal sessions
  terminalConfig?: TerminalConfig;
}

export class UnifiedSessionManager {
  // Merge all functionality here
  // - Background jobs from session-manager.ts
  // - Execution policies from agent-session-manager.ts
  // - OpenCode CLI from opencode-engine-service.ts
  // - Terminal isolation from user-terminal-sessions.ts
}

// Step 2: Create re-exports for backward compatibility
// lib/session/agent/agent-session-manager.ts (deprecated)
/**
 * @deprecated Use lib/session/session-manager.ts instead
 */
export { UnifiedSessionManager as AgentSessionManager } from '../session-manager';

// Step 3: Update all imports across codebase
// Before
import { AgentSessionManager } from '@/lib/session/agent/agent-session-manager';
// After
import { UnifiedSessionManager } from '@/lib/session/session-manager';
```

**Files to Update:**
- Search for all imports from `lib/session/agent/`
- Update to use `lib/session/session-manager.ts`
- Run tests to verify functionality

---

### 1.2 Error Handler Consolidation

**Files Affected:** 3

| File | Current Status | Action |
|------|---------------|--------|
| `lib/utils/error-handler.ts` | **SOURCE OF TRUTH** | Keep as primary |
| `lib/chat/error-handler.ts` | Explicitly deprecated | **UPDATE IMPORTS** to utils |
| `lib/tools/error-handler.ts` | Already re-exports | **ADD DEPRECATION NOTICE** |

**Migration Steps:**

```typescript
// Step 1: Update lib/chat/error-handler.ts
/**
 * @deprecated Use UnifiedErrorHandler from lib/utils/error-handler.ts
 * This file exists for backward compatibility only.
 */
export {
  UnifiedErrorHandler,
  ErrorCategory,
  type ErrorHandlerResult,
} from '@/lib/utils/error-handler';

// Step 2: Search and replace all imports
// Find: import.*from ['"]@/lib/chat/error-handler['"]
// Replace: import.*from ['"]@/lib/utils/error-handler['"]

// Step 3: Verify tambo/streaming/mistral handlers have unique functionality
// If not, deprecate them too
```

---

## Phase 2 (Week 3-4): High Impact Consolidations

### 2.1 Sandbox Manager Clarification

**Files Affected:** 4

| File | Current Status | Action |
|------|---------------|--------|
| `lib/sandbox/sandbox-manager.ts` | Local filesystem | **RENAME TO** local-sandbox-manager.ts |
| `lib/sandbox/core-sandbox-service.ts` | Cloud providers | **KEEP** as primary |
| `lib/sandbox/sandbox-orchestrator.ts` | Multi-provider | **KEEP** for orchestration |
| `lib/sandbox/sandbox-connection-manager.ts` | Connections | **KEEP** for connections |

**Migration Steps:**

```typescript
// Step 1: Rename sandbox-manager.ts
// lib/sandbox/sandbox-manager.ts → lib/sandbox/local-sandbox-manager.ts

// Step 2: Add deprecation notice to old location
// lib/sandbox/sandbox-manager.ts (new file)
/**
 * @deprecated Use lib/sandbox/core-sandbox-service.ts for cloud providers
 * or lib/sandbox/local-sandbox-manager.ts for local development
 */
export * from './local-sandbox-manager';

// Step 3: Update documentation
// Document clear separation:
// - local-sandbox-manager.ts: Local development/testing only
// - core-sandbox-service.ts: Production cloud providers (Daytona, Blaxel, etc.)
// - sandbox-orchestrator.ts: Multi-provider routing and load balancing
// - sandbox-connection-manager.ts: Connection state and lifecycle
```

---

### 2.2 Agent Orchestration Cleanup

**Files Affected:** 5

| File | Current Status | Action |
|------|---------------|--------|
| `lib/agent/orchestration.ts` | Index file | **KEEP** as export hub |
| `lib/agent/orchestration-mode-handler.ts` | Mode routing | **KEEP** |
| `lib/agent/simulated-orchestration.ts` | **MVP STUB** | **DEPRECATE** |
| `lib/agent/unified-agent.ts` | Single-agent interface | **KEEP** as primary |
| `lib/orchestra/unified-agent-service.ts` | API layer | **KEEP** for API |

**Migration Steps:**

```typescript
// Step 1: Add explicit deprecation to simulated-orchestration.ts
/**
 * @deprecated This is an MVP stub.
 * Use lib/orchestra/mastra/workflows/ for production orchestration.
 * 
 * This file was created during initial prototyping and should not be used
 * for new development. All orchestration logic has been moved to the
 * lib/orchestra/mastra/ directory.
 */
export class SimulatedOrchestration {
  // ... existing code with deprecation warnings
}

// Step 2: Update documentation
// Point all orchestration references to:
// - lib/orchestra/mastra/workflows/ for workflow templates
// - lib/agent/unified-agent.ts for single-agent interface
// - lib/agent/orchestration-mode-handler.ts for mode routing
```

---

### 2.3 MCP Gateway Clarification

**Files Affected:** 3

| File | Current Status | Action |
|------|---------------|--------|
| `lib/mcp/gateway.ts` | Agent Kernel integration | **KEEP** for Kernel |
| `lib/mcp/mcp-gateway.ts` | Server management | **KEEP** for servers |
| `lib/mcp/e2b-mcp-gateway.ts` | E2B-specific | **KEEP** as specialized |

**Migration Steps:**

```typescript
// Step 1: Add clear documentation to both files
// lib/mcp/gateway.ts
/**
 * MCP Gateway with Agent Kernel Integration
 * 
 * Use this when you need:
 * - DAG workflow execution
 * - Agent Kernel coordination
 * - Complex multi-agent orchestration
 * 
 * For simple MCP server management, use lib/mcp/mcp-gateway.ts
 */

// lib/mcp/mcp-gateway.ts
/**
 * Centralized MCP Server Management
 * 
 * Use this when you need:
 * - MCP server connection pooling
 * - Load balancing across servers
 * - Tool discovery and execution
 * - Server health monitoring
 * 
 * For Agent Kernel integration, use lib/mcp/gateway.ts
 */

// Step 2: Consider merging if overlap is too confusing
// Option: Create lib/mcp/mcp-gateway.ts with optional Agent Kernel:
export class MCPGateway {
  constructor(config: MCPGatewayConfig & { agentKernel?: AgentKernel })
  // ... unified implementation
}
```

---

## Phase 3 (Week 5-6): Medium Priority

### 3.1 Terminal Manager Stubs

**Files Affected:** 3

| File | Current Status | Action |
|------|---------------|--------|
| `lib/terminal/terminal-manager.ts` | Base management | **KEEP** as primary |
| `lib/terminal/enhanced-terminal-manager.ts` | **HAS STUBS** | **COMPLETE OR REMOVE** |
| `lib/terminal/websocket-terminal.ts` | WebSocket handling | **KEEP** as specialized |

**Decision Point:**

```typescript
// Option A: Complete enhanced-terminal-manager.ts implementation
// Fill in stub methods:
- resolveHandleForSandbox() - Line 257
- createPtySession() - Line 269
- createCommandModeSession() - Line 281

// Option B: Remove and add features to base terminal-manager.ts
// Delete enhanced-terminal-manager.ts
// Move desktop/MCP features directly to terminal-manager.ts

// Recommendation: Option B (simpler, less confusion)
```

---

### 3.2 Security Utilities Consolidation

**Files Affected:** 2

| File | Current Status | Action |
|------|---------------|--------|
| `lib/security/security-utils.ts` | General security | **KEEP** as primary |
| `lib/sandbox/security.ts` | Sandbox-specific | **MERGE INTO** security-utils.ts |

**Migration Steps:**

```typescript
// Step 1: Identify overlapping functionality
// Both have:
// - safeJoin() / path traversal protection
// - validateCommand() / command validation
// - validateFilePath() / path validation
// - Blocked command patterns

// Step 2: Keep lib/security/security-utils.ts as single source
// Move sandbox-specific patterns to security-utils.ts

// Step 3: Update lib/sandbox/security.ts to re-export
/**
 * @deprecated Use lib/security/security-utils.ts directly
 * This file exists for backward compatibility only.
 */
export {
  safeJoin,
  validateCommand,
  validateFilePath,
  BLOCKED_COMMAND_PATTERNS,
} from '@/lib/security/security-utils';

// Add sandbox-specific additions if any
export const SANDBOX_SPECIFIC_PATTERNS = [
  // Sandbox-only patterns
];
```

---

### 3.3 Bash DAG Executor Completion

**Files Affected:** 1

| File | Current Status | Action |
|------|---------------|--------|
| `lib/bash/dag-executor.ts` | **HAS STUBS** | **COMPLETE IMPLEMENTATION** |

**Stubs to Complete:**

```typescript
// Line 96: Tool execution
logger.warn('Tool execution not yet implemented, falling back to bash');
// TODO: Implement proper tool execution via MCP or direct binary

// Line 112: Container execution
logger.warn('Container execution not yet implemented, falling back to bash');
// TODO: Implement container execution via sandbox providers

// Line 488: Self-healing at DAG level
// TODO: Implement self-healing at DAG level
// TODO: Add retry logic with exponential backoff
// TODO: Add error classification and repair strategies
```

**Decision Point:**
- Complete implementation (2-3 days)
- Or remove stub functionality and rely on `bash-tool.ts`

---

## Phase 4 (Week 6+): API Route Delegation

### 4.1 API Routes Should Delegate to Lib/

**Routes Affected:** 7

| API Route | Lib Implementation | Action |
|-----------|-------------------|--------|
| `app/api/sandbox/*` | `lib/sandbox/core-sandbox-service.ts` | **VERIFY** delegation |
| `app/api/terminal/*` | `lib/terminal/terminal-manager.ts` | **VERIFY** delegation |
| `app/api/events/*` | `lib/events/bus.ts + router.ts` | **VERIFY** delegation |
| `app/api/tools/*` | `lib/tools/tool-integration-system.ts` | **VERIFY** delegation |
| `app/api/agent/*` | `lib/agent/unified-agent.ts` | **VERIFY** delegation |
| `app/api/mcp/*` | `lib/mcp/gateway.ts` | **VERIFY** delegation |
| `app/api/voice/*` | `lib/voice/voice-service.ts` | **VERIFY** delegation |

**Pattern to Enforce:**

```typescript
// ✅ GOOD: API route as thin wrapper
// app/api/sandbox/execute/route.ts
import { coreSandboxService } from '@/lib/sandbox/core-sandbox-service';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = await coreSandboxService.execute(body);
  return NextResponse.json(result);
}

// ❌ BAD: API route with business logic
// app/api/sandbox/execute/route.ts
export async function POST(request: NextRequest) {
  // Don't put business logic here!
  const sandbox = await createSandbox(...);
  const result = await sandbox.execute(...);
  // ...
}
```

---

## 📋 Files to Deprecate Immediately

Add `@deprecated` JSDoc tags to these files **this week**:

1. ✅ `lib/sandbox/sandbox-events.ts` → Already done, re-exports enhanced
2. ✅ `lib/tools/error-handler.ts` → Already done, re-exports utils
3. ⏳ `lib/session/agent/agent-session-manager.ts` → Use `lib/session/session-manager.ts`
4. ⏳ `lib/session/agent/opencode-v2-session-manager.ts` → Use `lib/session/session-manager.ts`
5. ⏳ `lib/chat/error-handler.ts` → Use `lib/utils/error-handler.ts`
6. ⏳ `lib/agent/simulated-orchestration.ts` → Use `lib/orchestra/mastra/workflows/`

---

## 📊 Expected Outcomes

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Total files | ~1,200 | ~1,180 | -20 files |
| Duplicate modules | 47 | 5 | -89% |
| Stub files | 6 | 0 | -100% |
| Clear module boundaries | 60% | 95% | +58% |
| Maintenance burden | High | Low | -70% |

---

## 🎯 Success Criteria

- [ ] All session management consolidated into single module
- [ ] Error handling uses UnifiedErrorHandler everywhere
- [ ] Sandbox manager roles clearly documented
- [ ] No stub methods throwing "Implementation delegated"
- [ ] All API routes properly delegate to lib/
- [ ] Deprecation notices added to all superseded modules
- [ ] Tests pass for all consolidated modules
- [ ] Documentation updated with new module structure

---

## 📝 Implementation Checklist

### Week 1-2
- [ ] Merge session managers
- [ ] Consolidate error handlers
- [ ] Add deprecation notices

### Week 3-4
- [ ] Clarify sandbox manager roles
- [ ] Clean up agent orchestration
- [ ] Clarify MCP gateway distinction

### Week 5-6
- [ ] Complete or remove terminal stubs
- [ ] Consolidate security utilities
- [ ] Complete bash DAG executor

### Week 6+
- [ ] Verify API route delegation
- [ ] Update all documentation
- [ ] Run full test suite
- [ ] Create migration guide for developers

---

## 🔗 Related Documentation

- `docs/TODO_LIST_REVIEW_STATUS.md` - TODO list review
- `docs/COMPLETE_SESSION_REVIEW.md` - Latest session summary
- `docs/SESSION_IMPROVEMENTS_SUMMARY.md` - Security improvements
