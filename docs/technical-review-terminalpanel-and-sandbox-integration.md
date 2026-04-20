---
id: technical-review-terminalpanel-and-sandbox-integration
title: 'Technical Review: TerminalPanel & Sandbox Integration'
aliases:
  - REVIEW_2026-02-26daytona
  - REVIEW_2026-02-26daytona.md
  - technical-review-terminalpanel-and-sandbox-integration
  - technical-review-terminalpanel-and-sandbox-integration.md
tags:
  - terminal
  - review
layer: core
summary: "# Technical Review: TerminalPanel & Sandbox Integration\r\n\r\n**Date:** 2026-02-26\r\n**Scope:** `components/terminal/TerminalPanel.tsx`, sandbox providers, terminal streaming, tool calling integration\r\n\r\n---\r\n\r\n## Executive Summary\r\n\r\nThe TerminalPanel and sandbox integration has significant architectur"
anchors:
  - Executive Summary
  - Critical Issues
  - '1. Session Creation Race Condition (TerminalPanel.tsx:509-535)'
  - 2. Provider Resolution Fragmentation
  - '3. E2B PTY Session Mapping Leak (e2b-provider.ts:316-328)'
  - Major Issues
  - 4. Tool Calling Integration Disconnected
  - 5. Missing Reconnection Logic
  - '6. EventSource Cleanup Not Guaranteed (TerminalPanel.tsx:68-75)'
  - Moderate Issues
  - 7. Daytona Provider Missing PTY Session Persistence
  - 8. Quota Manager Not Integrated with Terminal Flow
  - '9. Connection Token Security Issue (stream/route.ts:48-67)'
  - 10. Inconsistent Error Handling
  - Architecture Recommendations
  - 1. Unified Session Manager
  - 2. Replace EventSource with WebSocket
  - 3. Add Health Monitoring
  - Quick Wins (Can Fix Immediately)
  - Testing Recommendations
  - 'Deep Dive: Virtual Filesystem Implementation'
  - >-
    6. Filesystem State Synchronization Issue (interaction-panel.tsx +
    use-virtual-filesystem.ts)
  - '7. VirtualFilesystemService: Missing Versioning for Concurrent Edits'
  - 'Deep Dive: Tool Integration Architecture'
  - 8. Multiple Tool Execution Paths with No Unification
  - 9. Tool Schema Definitions Are Static and Incomplete
  - 10. Tool Intent Parsing is Fragile
  - 'Deep Dive: Composio Integration'
  - 11. Composio SDK Version Detection is Chaotic
  - 12. Composio Auth Flow Has Multiple Fallback Paths
  - 13. Composio Execution Has No Retry Logic
  - 'Deep Dive: Enhanced Code Orchestrator'
  - 14. Orchestrator Never Connects to Terminal
  - 15. Zod Schemas are Over-Engineered
  - 'Deep Dive: Priority Request Router'
  - 16. Router Fallback Logic is Opaque
  - 17. Tool Detection Before Auth Check
  - Summary of Architectural Issues
  - Recommended Fix Priority
  - Phase 1 (Immediate - Critical)
  - Phase 2 (This Week - Major)
  - Phase 3 (This Month - Moderate)
---
# Technical Review: TerminalPanel & Sandbox Integration

**Date:** 2026-02-26
**Scope:** `components/terminal/TerminalPanel.tsx`, sandbox providers, terminal streaming, tool calling integration

---

## Executive Summary

The TerminalPanel and sandbox integration has significant architectural issues that prevent reliable operation:

1. **Critical:** Session lifecycle race conditions cause PTY connections to fail
2. **Critical:** Provider resolution logic is fragmented across multiple files with inconsistent behavior
3. **Major:** Tool calling integration is disconnected from the terminal subsystem
4. **Major:** Missing error recovery and reconnection logic
5. **Moderate:** Resource leaks from improper EventSource cleanup

---

## Critical Issues

### 1. Session Creation Race Condition (TerminalPanel.tsx:509-535)

**Location:** `connectTerminal()` function

**Problem:** The session creation flow has a TOCTOU (time-of-check-time-of-use) race:

```typescript
// Step 1: POST to /api/sandbox/terminal creates session
const sessionRes = await fetch('/api/sandbox/terminal', { method: 'POST', ... });
const { sessionId, sandboxId } = await sessionRes.json();

// Step 2: POST to get connection token
const tokenRes = await fetch('/api/sandbox/terminal/stream', {
  method: 'POST',
  body: JSON.stringify({ sessionId, sandboxId }),  // Uses values from step 1
});

// Step 3: SSE connection
const streamUrl = `/api/sandbox/terminal/stream?sessionId=${sessionId}&sandboxId=${sandboxId}...`;
```

**Root Cause:** Between step 1 and step 3, the sandbox may:
- Fail to initialize (provider quota exceeded)
- Timeout during PTY creation
- Get destroyed by another request

**Impact:** The terminal shows "Sandbox ready!" but the PTY never actually connects because the sandbox failed during the async gap.

**Fix:**
```typescript
// Recommended: Single endpoint that handles everything
const connectTerminal = async (terminalId: string) => {
  // Use a single SSE endpoint that handles session creation internally
  const eventSource = new EventSource('/api/sandbox/terminal/connect');
  // Server creates session, sandbox, PTY in sequence before sending 'connected'
};
```

---

### 2. Provider Resolution Fragmentation

**Locations:**
- `terminal-manager.ts:32-67` — `resolveHandleForSandbox()`
- `core-sandbox-service.ts:54-96` — `resolveProviderForSandbox()`
- `providers/index.ts:15-38` — `getSandboxProvider()`

**Problem:** Three different files attempt to resolve which provider owns a sandbox:

```typescript
// terminal-manager.ts
async resolveHandleForSandbox(sandboxId: string) {
  // Tries all providers in hardcoded order
  const allProviders = ['daytona', 'runloop', 'microsandbox', 'e2b', 'mistral']
  for (const providerType of allProviders) { ... }
}

// core-sandbox-service.ts
async resolveProviderForSandbox(sandboxId: string) {
  // Same logic but different implementation
  const allProviderTypes = ['daytona', 'runloop', 'microsandbox', 'e2b', 'mistral']
  // ...
}
```

**Impact:**
- Race conditions when both files try different providers simultaneously
- `sandboxProviderById` Map in `core-sandbox-service.ts` is not shared with `terminal-manager.ts`
- Provider may be tried multiple times unnecessarily

**Fix:** Consolidate into a single `ProviderRegistry` class:

```typescript
// lib/sandbox/provider-registry.ts
class ProviderRegistry {
  private providerBySandboxId = new Map<string, SandboxProvider>();
  
  async resolveProvider(sandboxId: string): Promise<SandboxProvider> {
    if (this.providerBySandboxId.has(sandboxId)) {
      return this.providerBySandboxId.get(sandboxId)!;
    }
    // Single resolution path
    for (const type of this.configuredProviders) {
      try {
        const provider = getSandboxProvider(type);
        await provider.getSandbox(sandboxId);
        this.providerBySandboxId.set(sandboxId, provider);
        return provider;
      } catch {}
    }
    throw new Error(`Sandbox not found`);
  }
}
```

---

### 3. E2B PTY Session Mapping Leak (e2b-provider.ts:316-328)

**Problem:** The `E2BSandboxHandle` stores PTY sessions in an instance-level Map:

```typescript
class E2BSandboxHandle {
  private ptySessions = new Map<string, { pid: number; handle: any }>();
  
  async createPty(options: PtyOptions): Promise<PtyHandle> {
    this.ptySessions.set(sessionId, { pid: ptyHandle.pid, handle: ptyHandle });
  }
}
```

**Issues:**
1. The `sessionId` key uses the frontend-generated ID, not the E2B `pid`
2. If the sandbox is reconnected via `getSandbox()`, a NEW `E2BSandboxHandle` instance is created with an empty `ptySessions` Map
3. Existing PTY sessions become orphaned — can never reconnect

**Fix:** Store session mapping at the provider level or use E2B's pid directly:

```typescript
class E2BProvider {
  private ptySessionsBySandbox = new Map<string, Map<string, number>>();
  
  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    const sandboxSessions = this.ptySessionsBySandbox.get(sandboxId);
    const pid = sandboxSessions?.get(sessionId);
    if (!pid) throw new Error(`Session ${sessionId} not found`);
    // Use pid to reconnect
  }
}
```

---

## Major Issues

### 4. Tool Calling Integration Disconnected

**Problem:** The tool integration system (`tool-integration-system.ts`) exists but has no connection to the terminal:

```typescript
// TerminalPanel.tsx handles these events:
case 'agent:tool_start':
  currentTerm.terminal.writeln(`🤖 Agent → ${msg.data.toolName}`);
case 'agent:tool_result':
  // Shows result

// But sandbox-events.ts defines:
type SandboxEventType = 'agent:tool_start' | 'agent:tool_result' | ...

// And NOTHING emits these events!
```

The `sandboxEvents` emitter has no subscribers except the terminal stream, but no code actually calls `sandboxEvents.emit()`.

**Root Cause:** The tool execution flow is:
1. Chat API receives tool call from LLM
2. `tool-integration-system.ts` executes via Arcade/Nango
3. Result returns to chat

But there's no bridge to:
- Notify the terminal panel
- Execute tools inside the sandbox (e.g., `exec_shell`)

**Fix:** Create a tool execution bridge:

```typescript
// lib/sandbox/tool-bridge.ts
export async function executeToolInSandbox(
  sandboxId: string,
  toolName: string,
  args: Record<string, any>
): Promise<ToolResult> {
  // Emit event for terminal UI
  sandboxEvents.emit(sandboxId, 'agent:tool_start', { toolName, args });
  
  let result;
  if (toolName === 'exec_shell') {
    const handle = await terminalManager.getHandle(sandboxId);
    result = await handle.executeCommand(args.command);
  } else {
    result = await toolIntegration.executeTool(toolName, args, context);
  }
  
  sandboxEvents.emit(sandboxId, 'agent:tool_result', { result });
  return result;
}
```

---

### 5. Missing Reconnection Logic

**Location:** `TerminalPanel.tsx:80-100`

**Problem:** When the panel closes, it saves session info but never attempts reconnection:

```typescript
useEffect(() => {
  if (!isOpen && terminals.length > 0) {
    terminals.forEach(t => {
      t.eventSource?.close();  // Closes SSE
      saveTerminalSession({ ...t.sandboxInfo, status: 'none' });  // Saves for later
    });
  }
}, [isOpen]);
```

When panel reopens:
```typescript
useEffect(() => {
  if (isOpen && terminals.length === 0) {
    const savedSessions = getTerminalSessions();
    if (savedSessions.length > 0) {
      createTerminal(session.name, session.sandboxInfo);  // Creates terminal...
      // But sandboxInfo.status is 'none', so it creates a NEW sandbox!
    }
  }
}, [isOpen]);
```

**Impact:** Every time the panel is closed and reopened, a new sandbox is created (and quota consumed).

**Fix:** Properly reconnect to existing sandbox:

```typescript
if (savedSessions.length > 0) {
  const session = savedSessions[0];
  const terminal = createTerminal(session.name, session.sandboxInfo);
  
  if (session.sandboxInfo.sandboxId) {
    // Attempt to reconnect to existing sandbox
    try {
      await fetch(`/api/sandbox/${session.sandboxInfo.sandboxId}/reconnect`, {
        method: 'POST',
      });
      connectTerminal(terminal.id);
    } catch {
      // Sandbox expired, create new
      createTerminal(session.name);
    }
  }
}
```

---

### 6. EventSource Cleanup Not Guaranteed (TerminalPanel.tsx:68-75)

**Problem:** EventSource cleanup relies on React useEffect, which doesn't run during:
- Browser crash
- Page navigation without unmounting
- Fast tab switching

```typescript
useEffect(() => {
  return () => {
    terminalsRef.current.forEach(t => {
      t.eventSource?.close();
      t.terminal?.dispose();
    });
  };
}, []);  // Empty deps = only runs on unmount
```

**Impact:** Orphaned SSE connections consume server resources until timeout.

**Fix:** Use `beforeunload` event + visibility API:

```typescript
useEffect(() => {
  const handleUnload = () => {
    terminalsRef.current.forEach(t => t.eventSource?.close());
  };
  
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      // Pause reconnection attempts
      terminalsRef.current.forEach(t => {
        reconnectCooldownUntilRef.current[t.id] = Date.now() + 30000;
      });
    }
  };
  
  window.addEventListener('beforeunload', handleUnload);
  document.addEventListener('visibilitychange', handleVisibility);
  
  return () => {
    window.removeEventListener('beforeunload', handleUnload);
    document.removeEventListener('visibilitychange', handleVisibility);
    // ... existing cleanup
  };
}, []);
```

---

## Moderate Issues

### 7. Daytona Provider Missing PTY Session Persistence

**Location:** `daytona-provider.ts:101-118`

**Problem:** Daytona's `createPty` uses a generated `id` but there's no way to look up existing sessions:

```typescript
async createPty(options: PtyOptions): Promise<PtyHandle> {
  const ptyHandle = await this.sandbox.process.createPty({
    id: options.id,  // Frontend-provided ID
    // ...
  });
  return new DaytonaPtyHandle(options.id, ptyHandle);
}
```

The `DaytonaSandboxHandle` doesn't track which sessions exist. If the connection drops, `connectPty` has no way to find the session.

---

### 8. Quota Manager Not Integrated with Terminal Flow

**Location:** `core-sandbox-service.ts:127-150`

**Problem:** Quota checking happens during `createWorkspace()` but not during terminal reconnection:

```typescript
// In createWorkspace:
if (!quotaManager.isAvailable('e2b')) {
  throw new Error(`E2B quota exceeded`);
}

// But in terminal-manager resolveHandleForSandbox:
// No quota check — just tries providers blindly
```

**Impact:** Terminal can create sandboxes even when quota is exhausted, then fail mysteriously.

---

### 9. Connection Token Security Issue (stream/route.ts:48-67)

**Problem:** Connection tokens are single-use but not bound to a specific connection:

```typescript
connectionTokens.set(connectionToken, {
  userId, sandboxId, sessionId, expiresAt,
});

// Later, on first use:
connectionTokens.delete(connectionToken);
```

If an attacker intercepts the token URL, they can:
1. Use it before the legitimate user
2. The legitimate user then gets "token expired"

**Fix:** Bind token to IP or user-agent:

```typescript
connectionTokens.set(connectionToken, {
  userId, sandboxId, sessionId, expiresAt,
  boundIp: req.headers.get('x-forwarded-for') || req.ip,
  boundUserAgent: req.headers.get('user-agent'),
});
```

---

### 10. Inconsistent Error Handling

**Problem:** Terminal errors are silently swallowed in multiple places:

```typescript
// TerminalPanel.tsx:475-477
const sendInput = async (sessionId: string, data: string) => {
  try {
    await fetch('/api/sandbox/terminal/input', { ... });
  } catch {
    // Silently ignore individual input failures
  }
};

// stream/route.ts:132-136
const setupPty = async () => {
  try { ... }
  catch (err) {
    send({ type: 'error', data: msg });
    // But doesn't update terminal state — terminal stays "creating" forever
  }
};
```

**Impact:** Users see a stuck terminal with no feedback.

---

## Architecture Recommendations

### 1. Unified Session Manager

Create a single source of truth for session state:

```
┌─────────────────────────────────────────────┐
│           SessionManager (singleton)         │
│  - Owns all session state                   │
│  - Single provider resolution path          │
│  - PTY lifecycle management                 │
│  - Event emission                           │
└─────────────────────────────────────────────┘
         │              │              │
    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
    │Terminal │    │ Chat    │    │ Tools   │
    │ Panel   │    │ API     │    │ Bridge  │
    └─────────┘    └─────────┘    └─────────┘
```

### 2. Replace EventSource with WebSocket

EventSource has limitations:
- Unidirectional (server → client only)
- No binary support
- Reconnection logic is opaque

WebSocket would enable:
- Bidirectional communication (input + output on same socket)
- Better error handling
- Heartbeat for connection health

### 3. Add Health Monitoring

```typescript
interface TerminalHealth {
  lastPong: number;
  reconnectAttempts: number;
  sandboxStatus: 'healthy' | 'degraded' | 'dead';
}

// Ping/pong every 15 seconds
// Automatic reconnection with exponential backoff
// Graceful degradation to command-mode if PTY fails
```

---

## Quick Wins (Can Fix Immediately)

1. **Fix the reconnection logic** — Save `sandboxId` and attempt reconnect before creating new sandbox
2. **Emit tool events** — Add `sandboxEvents.emit()` calls to `tool-integration-system.ts`
3. **Add timeout to sandbox creation** — Fail fast instead of hanging at "Preparing your sandbox..."
4. **Show error state in UI** — When `msg.type === 'error'`, update `sandboxInfo.status = 'error'`
5. **Add reconnection cooldown** — Already exists in `reconnectCooldownUntilRef` but never used

---

## Testing Recommendations

1. **Unit tests for provider resolution** — Ensure same sandboxId returns same provider
2. **Integration tests for terminal lifecycle** — Open/close/reopen without creating duplicate sandboxes
3. **Chaos testing** — Kill sandbox mid-session, verify terminal recovers gracefully
4. **Load testing** — 100 concurrent terminals, verify no resource leaks

---

## Deep Dive: Virtual Filesystem Implementation

### 6. Filesystem State Synchronization Issue (interaction-panel.tsx + use-virtual-filesystem.ts)

**Location:** `interaction-panel.tsx:900-1000`, `use-virtual-filesystem.ts`

**Problem:** The virtual filesystem has a disconnect between UI state and backend state:

```typescript
// interaction-panel.tsx - UI maintains its own view
const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);

// use-virtual-filesystem.ts - Hook maintains separate state
const [nodes, setNodes] = useState<VirtualFilesystemNode[]>([]);
const [attachedFiles, setAttachedFiles] = useState<Record<string, AttachedVirtualFile>>({});

// But when files are modified via chat, the filesystem tab doesn't update!
```

**Root Cause:** No subscription mechanism for filesystem changes:

```typescript
// use-virtual-filesystem.ts - Only fetches on mount
useEffect(() => {
  void listDirectory(initialPath);
}, [initialPath, listDirectory]);
// ^^ Missing: subscription to filesystem changes from other sources
```

**Impact:** 
- User attaches file in chat
- Filesystem tab shows stale state
- User must manually refresh to see changes

**Fix:** Add filesystem change subscription:

```typescript
// In use-virtual-filesystem.ts
const [changeVersion, setChangeVersion] = useState(0);

// Subscribe to filesystem changes (via SSE or polling)
useEffect(() => {
  const eventSource = new EventSource('/api/filesystem/changes');
  eventSource.onmessage = () => {
    setChangeVersion(v => v + 1); // Trigger refresh
  };
  return () => eventSource.close();
}, []);

// Re-fetch on change
useEffect(() => {
  void listDirectory(currentPath);
}, [changeVersion, currentPath]);
```

---

### 7. VirtualFilesystemService: Missing Versioning for Concurrent Edits

**Location:** `virtual-filesystem-service.ts:45-80`

**Problem:** No optimistic locking or version conflict detection:

```typescript
async writeFile(ownerId: string, filePath: string, content: string): Promise<VirtualFile> {
  const workspace = await this.ensureWorkspace(ownerId);
  const normalizedPath = this.normalizePath(filePath);
  const previous = workspace.files.get(normalizedPath);
  
  // Creates new version but doesn't check if previous version matches expected
  const file: VirtualFile = {
    version: (previous?.version || 0) + 1,
    // ...
  };
}
```

**Impact:** Two concurrent writes to the same file will silently overwrite each other.

**Fix:** Add expected version parameter:

```typescript
async writeFile(
  ownerId: string, 
  filePath: string, 
  content: string,
  options?: { expectedVersion?: number }
): Promise<VirtualFile> {
  const previous = workspace.files.get(normalizedPath);
  
  if (options?.expectedVersion !== undefined && previous?.version !== options.expectedVersion) {
    throw new Error(`Version conflict: expected ${options.expectedVersion}, current is ${previous?.version}`);
  }
  // ...
}
```

---

## Deep Dive: Tool Integration Architecture

### 8. Multiple Tool Execution Paths with No Unification

**Locations:**
- `lib/tools/tool-integration-system.ts` — Arcade/Nango integration
- `lib/api/composio-service.ts` — Composio integration  
- `lib/composio-adapter.ts` — Composio client wrapper
- `lib/composio-client.ts` — Another Composio client layer
- `lib/api/priority-request-router.ts` — Tool routing

**Problem:** Four different entry points for tool execution with overlapping responsibilities:

```
User request → detectRequestType() → 'tool'
       ↓
priority-request-router.ts
       ↓
   ┌───┴───┐
   ↓       ↓
composio  tool-execution (Arcade/Nango)
   ↓           ↓
composio-service.ts  tool-integration-system.ts
   ↓
composio-adapter.ts ←── NEVER USED
   ↓
composio-client.ts ←── ANOTHER LAYER
```

**Issues:**
1. `composio-adapter.ts` is imported nowhere (dead code)
2. `composio-client.ts` uses `window` globals for SSR-incompatible fallbacks
3. Both `composio-service.ts` and `tool-integration-system.ts` handle tool auth
4. No shared tool result caching

**Impact:** Tools may execute twice, or not at all, depending on routing.

**Fix:** Consolidate to single tool execution path:

```typescript
// lib/tools/unified-tool-executor.ts
export class UnifiedToolExecutor {
  private providers: Map<string, ToolProvider> = new Map();
  
  async execute(toolName: string, args: any, context: ToolContext): Promise<ToolResult> {
    const provider = this.resolveProvider(toolName);
    return provider.execute(toolName, args, context);
  }
  
  private resolveProvider(toolName: string): ToolProvider {
    // Priority: Composio → Arcade → Nango → Local fallback
    if (this.providers.has('composio') && toolName in COMPOSIO_TOOLS) {
      return this.providers.get('composio')!;
    }
    // ...
  }
}
```

---

### 9. Tool Schema Definitions Are Static and Incomplete

**Location:** `tool-integration-system.ts:50-250`

**Problem:** Tool schemas are hardcoded with no dynamic discovery:

```typescript
export const TOOL_REGISTRY: Record<string, ToolConfig> = {
  "gmail.send": {
    provider: "arcade",
    toolName: "Gmail.SendEmail",
    description: "Send an email via Gmail",
    category: "email",
    requiresAuth: true,
    // Missing: inputSchema for validation!
  },
  // ...
};
```

**Compare with Composio:** `composio-service.ts` dynamically loads tool definitions:

```typescript
const tools = await loadToolsForRequest(composio, request.userId, effectiveToolkits);
// tools[].parameters contains the actual JSON schema
```

**Impact:** 
- No input validation before sending to provider
- No schema versioning when APIs change
- No way to discover new tools without code changes

**Fix:** Add input schema validation:

```typescript
interface ToolConfig {
  provider: IntegrationProvider;
  toolName: string;
  description: string;
  category: string;
  requiresAuth: boolean;
  inputSchema?: z.ZodSchema;  // ← Add validation
  outputSchema?: z.ZodSchema;
}

// In executeTool:
const validated = toolConfig.inputSchema?.parse(input) ?? input;
```

---

### 10. Tool Intent Parsing is Fragile

**Location:** `request-type-detector.ts:40-70`

**Problem:** Intent detection relies on simple regex patterns with no confidence scoring:

```typescript
const TOOL_PATTERNS = [
  /\b(use|using)\s+(a\s+)?tools?\b/i,
  /\b(tool|function)\s*(call|use|execution)?\b/i,
  /\b(send|draft|compose)\s+(an?\s+)?email\b/i,
  // ...
];

if (TOOL_PATTERNS.some(p => p.test(lowerText))) return 'tool';
```

**Issues:**
1. "How do I use tools?" → Detected as 'tool' (should be 'chat')
2. "Send me the documentation" → Detected as 'tool' (should be 'chat')
3. No way to express "use gmail specifically" vs "use any email tool"

**Partial mitigation exists:**
```typescript
const KNOWLEDGE_PATTERNS = [
  /^\s*(how|what|why|when|where|can|could|would|should|is|are|do|does)\b/i,
  // ...
];
const explicitlyActionable = ACTION_PATTERNS.some((p) => p.test(lowerText));
if (looksLikeKnowledgeRequest && !explicitlyActionable) {
  return 'chat';
}
```

But this is fragile and misses edge cases.

**Fix:** Use LLM-based intent classification:

```typescript
async function classifyIntent(text: string): Promise<{ type: string; confidence: number; toolkit?: string }> {
  // Use a small, fast model for classification
  const result = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'system',
      content: `Classify the user intent. Return JSON: { type: "tool"|"sandbox"|"chat", confidence: 0-1, toolkit?: "gmail"|"github"|... }`
    }, {
      role: 'user',
      content: text
    }],
    response_format: { type: 'json_object' }
  });
  return JSON.parse(result.choices[0].message.content);
}
```

---

## Deep Dive: Composio Integration

### 11. Composio SDK Version Detection is Chaotic

**Location:** `composio-service.ts:160-230`

**Problem:** The code tries 4 different SDK API shapes to find tools:

```typescript
async function loadToolsForRequest(composio: any, userId: string, requestedToolkits?: string[]) {
  // Try 1: composio.tools.get(userId, filters)
  if (typeof composio?.tools?.get === 'function') { ... }
  
  // Try 2: composio.tools.list(params)
  if (typeof composio?.tools?.list === 'function') { ... }
  
  // Try 3: composio.create(userId).then(session => session.tools())
  if (typeof composio?.create === 'function') { ... }
  
  // Try 4: composio.tools.getRawComposioTools({ ... })
  if (typeof composio?.tools?.getRawComposioTools === 'function') { ... }
  
  return [];  // Fallback: no tools
}
```

**Impact:** 
- Different behavior depending on SDK version
- Silent failures when SDK updates
- No way to know which code path executed

**Fix:** Pin SDK version and use single API path:

```typescript
// package.json
"@composio/core": "0.4.12"  // Pin to tested version

// composio-service.ts
const COMPOSIO_SDK_VERSION = '0.4.12';

async function loadToolsForRequest(composio: any, userId: string) {
  // Single, version-specific implementation
  return composio.tools.get(userId, { limit: 300 });
}
```

---

### 12. Composio Auth Flow Has Multiple Fallback Paths

**Location:** `composio-service.ts:90-110`

**Problem:** Three different auth URL generation strategies:

```typescript
const buildFallbackAuthUrl = (toolkit?: string): string => {
  const provider = inferProviderFromToolkit(toolkit);
  
  // Strategy 1: Arcade auth
  if (arcadeProviders.includes(provider)) {
    return `${appBase}/api/auth/arcade/authorize?provider=${provider}`;
  }
  
  // Strategy 2: Nango auth  
  if (nangoProviders.includes(provider)) {
    return `${appBase}/api/auth/nango/authorize?provider=${provider}`;
  }
  
  // Strategy 3: Generic OAuth
  return `${appBase}/api/auth/oauth/initiate?provider=${provider}`;
};
```

But also:

```typescript
async getAuthUrl(toolkit: string, userId: string): Promise<string> {
  // Strategy 4: Direct Composio connection init
  const connectionRequest = await composio.connectedAccounts.initiate({
    userId: userId,
    integrationSlug: toolkit.toLowerCase(),
  });
  return connectionRequest?.redirectUrl || buildFallbackAuthUrl(toolkit);
}
```

**Impact:** User may see different auth flows for the same tool depending on code path.

**Fix:** Single auth flow with explicit provider routing:

```typescript
async getAuthUrl(toolkit: string, userId: string): Promise<string> {
  // 1. Try Composio native first
  try {
    return await composio.connectedAccounts.initiate({ userId, integrationSlug: toolkit });
  } catch {}
  
  // 2. Fallback to local OAuth handlers
  return `/api/auth/${getAuthProvider(toolkit)}?toolkit=${toolkit}`;
}
```

---

### 13. Composio Execution Has No Retry Logic

**Location:** `composio-service.ts:370-420`

**Problem:** Tool execution failures are not retried:

```typescript
result = await composio.tools.execute(toolSlug, {
  userId: request.userId,
  toolParams: toolArgs,
  dangerouslySkipVersionCheck: true,
});
// If this fails, the entire request fails with no retry
```

**Compare with Arcade:** Has `waitForAuthorization` but no execution retry.

**Fix:** Add exponential backoff for transient failures:

```typescript
async function executeWithRetry(toolSlug: string, params: any, maxRetries = 3) {
  let lastError: Error;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await composio.tools.execute(toolSlug, params);
    } catch (error) {
      lastError = error;
      if (isTransientError(error)) {
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
```

---

## Deep Dive: Enhanced Code Orchestrator

### 14. Orchestrator Never Connects to Terminal

**Location:** `enhanced-code-orchestrator.ts`

**Problem:** The orchestrator has rich file management but never uses the sandbox terminal:

```typescript
// Orchestrator has:
- AdvancedFileManager
- EnhancedStreamingManager
- AgenticFrameworkManager

// But NO integration with:
- terminal-manager.ts
- sandbox-service-bridge.ts
- sandbox-events.ts
```

**Impact:** Code generation happens in isolation from the terminal where it would be executed.

**Fix:** Bridge orchestrator to terminal:

```typescript
class EnhancedCodeOrchestrator {
  private terminalManager: TerminalManager;
  
  async executeCode(code: string, language: string): Promise<ToolResult> {
    const session = await this.terminalManager.getOrCreateSession(this.userId);
    return session.executeCommand(`run_${language} ${code}`);
  }
}
```

---

### 15. Zod Schemas are Over-Engineered

**Location:** `enhanced-code-orchestrator.ts:60-150`

**Problem:** Complex nested schemas that provide little runtime value:

```typescript
const OrchestratorConfigSchema = z.object({
  mode: z.enum(["streaming", "agentic", "hybrid", "standard"]).default("hybrid"),
  enableStreaming: z.boolean().default(true),
  // ... 15 more fields with defaults
  promptEngineering: z.object({
    depthLevel: z.number().min(1).max(10).default(8),
    verbosityLevel: z.enum(["minimal", "standard", "verbose", "exhaustive"]).default("verbose"),
    // ...
  }).default({}),
  streamingConfig: z.object({
    chunkSize: z.number().default(1000),
    // ...
  }).optional(),
  // ...
});
```

**Issues:**
1. All fields have defaults, so validation never fails
2. No runtime checks use these schemas
3. TypeScript types already provide compile-time safety

**Fix:** Use simpler TypeScript types with targeted validation:

```typescript
interface OrchestratorConfig {
  mode: 'streaming' | 'agentic' | 'hybrid' | 'standard';
  enableStreaming: boolean;
  // ... other config
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  mode: 'hybrid',
  enableStreaming: true,
  // ...
};

// Only validate what matters
function validateConfig(config: Partial<OrchestratorConfig>): OrchestratorConfig {
  if (config.maxConcurrentSessions && config.maxConcurrentSessions > 10) {
    throw new Error('maxConcurrentSessions must be <= 10');
  }
  return { ...DEFAULT_CONFIG, ...config };
}
```

---

## Deep Dive: Priority Request Router

### 16. Router Fallback Logic is Opaque

**Location:** `priority-request-router.ts:200-300`

**Problem:** The fallback chain is determined dynamically but not visible:

```typescript
async route(request: RouterRequest): Promise<RouterResponse> {
  const errors: Array<{ endpoint: string; error: Error }> = [];
  const fallbackChain: string[] = [];
  
  for (const endpoint of this.endpoints) {
    try {
      if (await endpoint.canHandle(request)) {
        fallbackChain.push(endpoint.name);
        const result = await endpoint.processRequest(request);
        // ...
      }
    } catch (error) {
      errors.push({ endpoint: endpoint.name, error });
      continue; // Try next endpoint
    }
  }
}
```

**Issues:**
1. `canHandle()` may return true but `processRequest()` may fail silently
2. Errors are collected but only logged, not surfaced to user
3. No way to know which endpoints were tried

**Fix:** Add observability:

```typescript
interface RoutingTrace {
  endpointsTried: string[];
  errorsByEndpoint: Record<string, string>;
  selectedEndpoint: string;
  duration: number;
}

async route(request: RouterRequest): Promise<RouterResponse & { trace: RoutingTrace }> {
  const trace: RoutingTrace = {
    endpointsTried: [],
    errorsByEndpoint: {},
    selectedEndpoint: '',
    duration: Date.now(),
  };
  
  for (const endpoint of this.endpoints) {
    trace.endpointsTried.push(endpoint.name);
    
    if (!await endpoint.canHandle(request)) {
      trace.errorsByEndpoint[endpoint.name] = 'cannot_handle';
      continue;
    }
    
    try {
      const result = await endpoint.processRequest(request);
      trace.selectedEndpoint = endpoint.name;
      trace.duration = Date.now() - trace.duration;
      return { ...result, trace };
    } catch (error) {
      trace.errorsByEndpoint[endpoint.name] = error.message;
    }
  }
  
  // All endpoints failed
  return {
    success: false,
    content: 'All endpoints failed',
    source: 'router',
    priority: -1,
    trace,
  };
}
```

---

### 17. Tool Detection Before Auth Check

**Location:** `priority-request-router.ts:170-185`

**Problem:** Tool endpoint is selected before checking if user has authorized:

```typescript
// canHandle for composio-tools:
canHandle: (req) => {
  return !!this.composioService && !!req.userId && req.enableComposio !== false
    && detectRequestType(req.messages) === 'tool'
    && quotaManager.isAvailable('composio');
  // ^^^ Missing: check if user has connected accounts for the required toolkit
}
```

**Impact:** Request routes to Composio, then fails with auth_required error.

**Fix:** Check connected accounts before routing:

```typescript
canHandle: async (req) => {
  const requestType = detectRequestType(req.messages);
  if (requestType !== 'tool') return false;
  
  const inferredToolkit = inferToolkitFromMessage(req.messages);
  if (!inferredToolkit) return false;
  
  const accounts = await this.composioService.getConnectedAccounts(req.userId);
  const hasConnection = accounts.some(a => a.toolkit === inferredToolkit);
  
  return hasConnection && quotaManager.isAvailable('composio');
}
```

---

## Summary of Architectural Issues

| Category | Critical | Major | Moderate |
|----------|----------|-------|----------|
| Terminal/Sandbox | 2 | 2 | 1 |
| Virtual Filesystem | 1 | 1 | 0 |
| Tool Integration | 1 | 2 | 1 |
| Composio | 0 | 2 | 1 |
| Orchestrator | 0 | 1 | 1 |
| Router | 0 | 1 | 1 |
| **Total** | **3** | **11** | **5** |

## Recommended Fix Priority

### Phase 1 (Immediate - Critical)
1. Fix session creation race condition (Issue #1)
2. Consolidate provider resolution logic (Issue #2)
3. Connect tool events to sandbox events (Issue #4)

### Phase 2 (This Week - Major)
1. Add filesystem change subscription (Issue #6)
2. Unify tool execution paths (Issue #8)
3. Fix Composio SDK version detection (Issue #11)
4. Add router observability (Issue #16)

### Phase 3 (This Month - Moderate)
1. Add versioning for filesystem edits (Issue #7)
2. Add tool schema validation (Issue #9)
3. Improve intent detection (Issue #10)
4. Add execution retry logic (Issue #13)
