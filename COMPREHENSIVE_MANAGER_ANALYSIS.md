# 🔍 Comprehensive Manager/Registry/Bridge Analysis

**Generated:** March 2026  
**Scope:** All manager, registry, router, bridge, and service files in `lib/`

---

## 📊 Executive Summary

**Total Files Analyzed:** 89 singleton instances across 50+ files

### Key Findings:

1. **`sandbox-service-bridge.ts` IS the best integration pattern** - confirmed
2. **Found 11 router files** - several could be consolidated
3. **Found 8 registry files** - most are well-scoped, some overlap
4. **Found 33 manager files** - good separation of concerns overall
5. **Found 4 bridge files** - all follow good patterns

---

## 🏆 Best Patterns Found (Keep As-Is)

### 1. **Service Bridge Pattern** (`sandbox-service-bridge.ts`)
```typescript
class SandboxServiceBridge {
  private initialized = false;
  private async ensureInitialized() { ... }
  async createWorkspace() { ... }
  async executeCommand() { ... }
}
export const sandboxBridge = new SandboxServiceBridge();
```
**Why it's best:**
- Lifecycle management (`ensureInitialized`)
- Race condition prevention (`pendingCreations` map)
- Provider inference from sandbox ID
- VFS auto-mounting optimization
- Single responsibility (270 lines)

**Files using this pattern:**
- `lib/sandbox/sandbox-service-bridge.ts` ✅
- `lib/agent/agent-fs-bridge.ts` ✅
- `lib/mcp/nullclaw-mcp-bridge.ts` ✅

---

### 2. **Service with Getter Pattern**
```typescript
class AuthService { ... }
export const authService = new AuthService();
```

**Files using this pattern (all good):**
- `lib/auth/auth-service.ts` ✅
- `lib/auth/oauth-service.ts` ✅
- `lib/virtual-filesystem/virtual-filesystem-service.ts` ✅
- `lib/api/fast-agent-service.ts` ✅
- `lib/api/enhanced-llm-service.ts` ✅

---

### 3. **Registry with Event System** (`mcp/tool-registry.ts`)
```typescript
class MCPToolRegistry {
  private clients: Map<string, MCPClient>
  private tools: Map<string, MCPToolWrapper>
  private eventListeners: Set<...>
  
  registerServer(config) { ... }
  connectAll() { ... }
  emitEvent(event) { ... }
}
```

**Files using this pattern:**
- `lib/mcp/tool-registry.ts` ✅ (443 lines, well-organized)
- `lib/mcp/smithery-registry.ts` ✅
- `lib/tambo/tambo-tool-registry.ts` ✅

---

## ⚠️ Files That Could Be Consolidated

### 1. **Router Consolidation Opportunities**

**Current State (11 router files):**

| File | Lines | Purpose | Overlap |
|------|-------|---------|---------|
| `lib/tools/router.ts` | 1,577 | Capability → Provider routing | Low |
| `lib/agent/task-router.ts` | 411 | OpenCode vs Nullclaw routing | Medium |
| `lib/agent/tool-router/tool-router.ts` | 162 | Tool call routing | **HIGH** |
| `lib/sandbox/provider-router.ts` | 516 | Sandbox provider selection | Low |
| `lib/backend/preview-router.ts` | 203 | Preview URL routing | Low |
| `lib/api/priority-request-router.ts` | 1,286 | LLM request routing | Low |
| `lib/tool-integration/router.ts` | 130 | Tool provider fallback | **HIGH** |
| `lib/mastra/models/model-router.ts` | 150 | Model tier selection | Medium |
| `lib/crewai/runtime/model-router.ts` | 228 | Model selection | **HIGH** |
| `lib/stateful-agent/agents/model-router.ts` | 241 | Model selection | **HIGH** |
| `lib/ai-sdk/models/model-router.ts` | ??? | Model selection | **HIGH** |

**Consolidation Recommendations:**

#### A. **Model Router Consolidation** (5 files → 1-2 files)

**Problem:** 5 different model routers doing similar things:
- `lib/mastra/models/model-router.ts` - Mastra agents
- `lib/crewai/runtime/model-router.ts` - CrewAI models
- `lib/stateful-agent/agents/model-router.ts` - Stateful agent models
- `lib/ai-sdk/models/model-router.ts` - AI SDK models
- `lib/tools/router.ts` - Has some model routing logic

**Recommendation:**
```
lib/models/
├── index.ts (unified model router)
├── model-registry.ts (all model configs)
├── model-router.ts (selection logic)
└── recommendations.ts (use-case → model mapping)
```

**Migration:**
```typescript
// Old
import { modelRouter } from '@/lib/mastra/models/model-router';
const agent = getModel('reasoning');

// New
import { getModel } from '@/lib/models';
const agent = getModel('reasoning');
```

#### B. **Tool Router Consolidation** (3 files → 1 file)

**Problem:**
- `lib/agent/tool-router/tool-router.ts` (162 lines) - Tool prefix routing
- `lib/tool-integration/router.ts` (130 lines) - Provider fallback routing
- `lib/tools/router.ts` (1,577 lines) - Capability routing (different concern)

**Recommendation:**
- Keep `lib/tools/router.ts` (capability routing - different concern)
- Merge `lib/agent/tool-router/tool-router.ts` + `lib/tool-integration/router.ts` → `lib/tools/tool-router.ts`

---

### 2. **Registry Consolidation Opportunities**

**Current State (8 registry files):**

| File | Lines | Purpose | Keep? |
|------|-------|---------|-------|
| `lib/tools/registry.ts` | 460 | Tool provider registry | ✅ Keep (compatibility) |
| `lib/tool-integration/provider-registry.ts` | 17 | Simple provider map | ⚠️ Merge into tools/registry |
| `lib/mcp/tool-registry.ts` | 443 | MCP tools | ✅ Keep (separate concern) |
| `lib/mcp/smithery-registry.ts` | 572 | Smithery servers | ✅ Keep (separate concern) |
| `lib/tambo/tambo-tool-registry.ts` | 503 | Tambo tools | ✅ Keep (separate concern) |
| `lib/tambo/tambo-component-registry.tsx` | 371 | Tambo components | ✅ Keep (separate concern) |
| `lib/plugins/plugin-registry.ts` | 23 | Basic plugin array | ⚠️ Merge into enhanced |
| `lib/plugins/enhanced-plugin-registry.ts` | 249 | Enhanced plugins | ✅ Keep |

**Recommendation:**
- Merge `lib/tool-integration/provider-registry.ts` into `lib/tools/registry.ts`
- Merge `lib/plugins/plugin-registry.ts` into `lib/plugins/enhanced-plugin-registry.ts`

---

### 3. **Manager Consolidation Opportunities**

**Current State (33 manager files):**

**Terminal Managers (4 files - CONSOLIDATE):**
| File | Lines | Purpose |
|------|-------|---------|
| `lib/sandbox/terminal-manager.ts` | 834 | Basic terminal management |
| `lib/sandbox/enhanced-terminal-manager.ts` | 281 | Enhanced terminal (MCP/desktop) |
| `lib/sandbox/enhanced-pty-terminal.ts` | 619 | PTY terminal with WebSocket |
| `lib/sandbox/user-terminal-sessions.ts` | 607 | Per-user terminal sessions |

**Recommendation:**
```typescript
// Consolidate into single manager with options
class TerminalManager {
  constructor(options: {
    mode: 'basic' | 'enhanced' | 'pty';
    enableMCP: boolean;
    enableDesktop: boolean;
  }) { ... }
}

export function getTerminalManager(options?: TerminalManagerOptions): TerminalManager {
  if (!_instance) {
    _instance = new TerminalManager(options);
  }
  return _instance;
}
```

**Quota Managers (3 files - Keep Separate):**
| File | Lines | Purpose |
|------|-------|---------|
| `lib/services/quota-manager.ts` | 810 | Global quota tracking |
| `lib/email/email-quota-manager.ts` | 487 | Email-specific quotas |
| `lib/sandbox/providers/mistral/mistral-quota-manager.ts` | ??? | Mistral-specific |

**Recommendation:** Keep separate (different scopes)

**Session Managers (5 files - Keep Separate):**
| File | Lines | Purpose |
|------|-------|---------|
| `lib/agent/agent-session-manager.ts` | 480 | Agent sessions |
| `lib/api/opencode-v2-session-manager.ts` | 516 | OpenCode V2 sessions |
| `lib/api/opencode-engine-service.ts` | 126 | OpenCode engine sessions |
| `lib/sandbox/providers/e2b-session-manager.ts` | ??? | E2B-specific |
| `lib/sandbox/user-terminal-sessions.ts` | 607 | Terminal sessions |

**Recommendation:** Keep separate (different lifecycles)

---

## 📋 Complete File Inventory

### Bridge Files (4 total - All Good ✅)

| File | Lines | Instance | Pattern |
|------|-------|----------|---------|
| `lib/sandbox/sandbox-service-bridge.ts` | 270 | `sandboxBridge` | ✅ Best pattern |
| `lib/agent/agent-fs-bridge.ts` | 285 | `agentFSBridge` | ✅ Good pattern |
| `lib/mcp/nullclaw-mcp-bridge.ts` | 467 | `nullclawMCPBridge` | ✅ Good pattern |
| `lib/puter-auth-bridge.ts` | ??? | N/A | ⚠️ Review needed |

### Router Files (11 total - 5 need consolidation)

| File | Lines | Instance | Recommendation |
|------|-------|----------|----------------|
| `lib/tools/router.ts` | 1,577 | `CapabilityRouter` | ✅ Keep (capability routing) |
| `lib/agent/task-router.ts` | 411 | `taskRouter` | ✅ Keep (task type routing) |
| `lib/agent/tool-router/tool-router.ts` | 162 | `toolRouter` | ⚠️ Merge with tool-integration/router |
| `lib/sandbox/provider-router.ts` | 516 | `providerRouter` | ✅ Keep (provider selection) |
| `lib/backend/preview-router.ts` | 203 | `PreviewRegistry` | ✅ Keep (preview routing) |
| `lib/api/priority-request-router.ts` | 1,286 | `priorityRequestRouter` | ✅ Keep (LLM routing) |
| `lib/tool-integration/router.ts` | 130 | `ToolProviderRouter` | ⚠️ Merge with agent/tool-router |
| `lib/mastra/models/model-router.ts` | 150 | `modelRouter` | ⚠️ Consolidate model routers |
| `lib/crewai/runtime/model-router.ts` | 228 | N/A | ⚠️ Consolidate model routers |
| `lib/stateful-agent/agents/model-router.ts` | 241 | `modelRouter` | ⚠️ Consolidate model routers |
| `lib/ai-sdk/models/model-router.ts` | ??? | N/A | ⚠️ Consolidate model routers |

### Registry Files (8 total - 2 need consolidation)

| File | Lines | Instance | Recommendation |
|------|-------|----------|----------------|
| `lib/tools/registry.ts` | 460 | `UnifiedToolRegistry` | ✅ Keep (compatibility layer) |
| `lib/tool-integration/provider-registry.ts` | 17 | `ToolProviderRegistry` | ⚠️ Merge into tools/registry |
| `lib/mcp/tool-registry.ts` | 443 | `mcpToolRegistry` | ✅ Keep (MCP-specific) |
| `lib/mcp/smithery-registry.ts` | 572 | `smitheryRegistry` | ✅ Keep (Smithery-specific) |
| `lib/tambo/tambo-tool-registry.ts` | 503 | `tamboToolRegistry` | ✅ Keep (Tambo-specific) |
| `lib/tambo/tambo-component-registry.tsx` | 371 | `tamboComponentRegistry` | ✅ Keep (Tambo components) |
| `lib/plugins/plugin-registry.ts` | 23 | `pluginRegistry` | ⚠️ Merge into enhanced |
| `lib/plugins/enhanced-plugin-registry.ts` | 249 | `enhancedPluginRegistry` | ✅ Keep |

### Manager Files (33 total - 5 need consolidation)

**Terminal (4 → 1):**
- `lib/sandbox/terminal-manager.ts` (834 lines)
- `lib/sandbox/enhanced-terminal-manager.ts` (281 lines)
- `lib/sandbox/enhanced-pty-terminal.ts` (619 lines)
- `lib/sandbox/user-terminal-sessions.ts` (607 lines)

**Keep Separate (29 files):**
- All quota managers (different scopes)
- All session managers (different lifecycles)
- All auth managers (different concerns)
- Plugin managers (separate concerns)

---

## 🎯 Consolidation Priority Matrix

| Priority | Consolidation | Files Affected | Lines Reduced | Impact |
|----------|--------------|----------------|---------------|--------|
| 🔴 HIGH | Model Router Unification | 5 → 2 | ~500 | High (simpler model selection) |
| 🟡 MEDIUM | Terminal Manager Unification | 4 → 1 | ~800 | Medium (cleaner API) |
| 🟡 MEDIUM | Tool Router Unification | 2 → 1 | ~100 | Low (internal only) |
| 🟢 LOW | Registry Cleanup | 2 → 0 | ~40 | Low (minor cleanup) |

---

## 📝 Recommended Actions

### Phase 1: Model Router Consolidation (Week 1)

1. **Create `lib/models/` directory:**
```
lib/models/
├── index.ts
├── model-registry.ts
├── model-router.ts
└── recommendations.ts
```

2. **Migrate all model router logic:**
- Move `lib/mastra/models/model-router.ts` → `lib/models/model-router.ts`
- Merge CrewAI/stateful-agent/AI-SDK routers into `lib/models/model-registry.ts`
- Create unified `getModel()` function

3. **Update imports:**
```bash
grep -r "from.*model-router" lib/ app/ --include="*.ts" --include="*.tsx"
```

4. **Add deprecation notices:**
```typescript
// lib/mastra/models/model-router.ts
/**
 * @deprecated Use getModel() from lib/models instead
 */
export { getModel, modelRouter } from '../../models';
```

### Phase 2: Terminal Manager Consolidation (Week 2)

1. **Create unified `TerminalManager` class** with options:
```typescript
interface TerminalManagerOptions {
  mode: 'basic' | 'enhanced' | 'pty';
  enableMCP: boolean;
  enableDesktop: boolean;
  userId?: string;
}
```

2. **Merge functionality from 4 files into 1**

3. **Export getter function:**
```typescript
let _instance: TerminalManager | null = null;
export function getTerminalManager(options?: TerminalManagerOptions): TerminalManager {
  if (!_instance) {
    _instance = new TerminalManager(options);
  }
  return _instance;
}
```

### Phase 3: Tool Router & Registry Cleanup (Week 3)

1. **Merge tool routers:**
- `lib/agent/tool-router/tool-router.ts` + `lib/tool-integration/router.ts` → `lib/tools/tool-router.ts`

2. **Merge registries:**
- `lib/tool-integration/provider-registry.ts` → `lib/tools/registry.ts`
- `lib/plugins/plugin-registry.ts` → `lib/plugins/enhanced-plugin-registry.ts`

---

## ✅ Files That Should NOT Be Consolidated

**These are well-designed and serve distinct purposes:**

### Service Layer (Keep All):
- `lib/auth/auth-service.ts` ✅
- `lib/auth/oauth-service.ts` ✅
- `lib/api/fast-agent-service.ts` ✅
- `lib/api/enhanced-llm-service.ts` ✅
- `lib/virtual-filesystem/virtual-filesystem-service.ts` ✅

### Bridge Pattern (Keep All):
- `lib/sandbox/sandbox-service-bridge.ts` ✅ (BEST PATTERN)
- `lib/agent/agent-fs-bridge.ts` ✅
- `lib/mcp/nullclaw-mcp-bridge.ts` ✅

### Session Managers (Keep All - Different Lifecycles):
- `lib/agent/agent-session-manager.ts` ✅
- `lib/api/opencode-v2-session-manager.ts` ✅
- `lib/sandbox/user-terminal-sessions.ts` ✅

### Quota Managers (Keep All - Different Scopes):
- `lib/services/quota-manager.ts` ✅ (global)
- `lib/email/email-quota-manager.ts` ✅ (email-specific)
- `lib/sandbox/providers/mistral/mistral-quota-manager.ts` ✅ (provider-specific)

### MCP/Tambo Registries (Keep All - Separate Concerns):
- `lib/mcp/tool-registry.ts` ✅
- `lib/mcp/smithery-registry.ts` ✅
- `lib/tambo/tambo-tool-registry.ts` ✅
- `lib/tambo/tambo-component-registry.tsx` ✅

---

## 📊 Summary

**Total Consolidation Impact:**

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Router files | 11 | 7 | -36% |
| Registry files | 8 | 6 | -25% |
| Manager files | 33 | 30 | -9% |
| Total lines | ~15,000 | ~13,500 | -10% |

**Key Takeaways:**

1. **`sandbox-service-bridge.ts` is the BEST pattern** - should be documented as the recommended pattern
2. **Model routers need consolidation** - 5 files doing similar things
3. **Terminal managers can be unified** - with options for different modes
4. **Most services/registries are well-scoped** - don't over-consolidate
5. **Bridge pattern is consistently good** - keep as-is

---

*Generated: March 2026*  
*Analysis Scope: lib/ directory (89 singleton instances)*
