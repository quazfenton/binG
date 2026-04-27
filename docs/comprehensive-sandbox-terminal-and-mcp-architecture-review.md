---
id: comprehensive-sandbox-terminal-and-mcp-architecture-review
title: 'Comprehensive Sandbox, Terminal & MCP Architecture Review'
aliases:
  - SANDBOX_TERMINAL_MCP_REVIEW
  - SANDBOX_TERMINAL_MCP_REVIEW.md
  - comprehensive-sandbox-terminal-and-mcp-architecture-review
  - comprehensive-sandbox-terminal-and-mcp-architecture-review.md
tags:
  - terminal
  - review
  - architecture
layer: core
summary: "# Comprehensive Sandbox, Terminal & MCP Architecture Review\r\n\r\n**Date:** March 10, 2026  \r\n**Scope:** TerminalPanel UX, Sandboxed PTY Sessions, MCP Integration, Cloud Provider Offloading\r\n\r\n---\r\n\r\n## Executive Summary\r\n\r\nYour codebase has **extensive sandbox provider integrations** (10+ providers),"
anchors:
  - Executive Summary
  - 1. Current Architecture Overview
  - 1.1 Sandbox Providers (`lib/sandbox/providers/`)
  - 1.2 Terminal Architecture (`lib/sandbox/` + `components/terminal/`)
  - 1.3 MCP Integration (`lib/mcp/`)
  - 2. Critical Issues & Gaps
  - 2.1 TerminalPanel UX Flaws
  - 2.2 Sandbox Persistence Gaps
  - 2.3 MCP Deployment Issues
  - 2.4 Cloud Provider Offloading (Underutilized)
  - 2.5 Live Preview Offloading
  - 3. Recommendations & Implementation Plan
  - 3.1 TerminalPanel UX Improvements
  - 3.2 Sandbox Persistence Implementation
  - 3.3 MCP + LLM Service Integration
  - 3.4 Cloud Provider Offloading Strategy
  - 3.5 Live Preview Offloading
  - 4. Implementation Priority
  - 'Phase 1: Critical Fixes (Week 1-2)'
  - 'Phase 2: Provider Optimization (Week 3-4)'
  - 'Phase 3: Preview & MCP (Week 5-6)'
  - 'Phase 4: Advanced Features (Week 7-8)'
  - 5. Security Considerations
  - 6. Testing Strategy
  - 'Appendix: File Reference'
  - Key Files Reviewed
  - Documentation Files
---
# Comprehensive Sandbox, Terminal & MCP Architecture Review

**Date:** March 10, 2026  
**Scope:** TerminalPanel UX, Sandboxed PTY Sessions, MCP Integration, Cloud Provider Offloading

---

## Executive Summary

Your codebase has **extensive sandbox provider integrations** (10+ providers), a **multi-mode terminal system**, and **MCP tool integration** for two architectures. However, there are critical gaps in:

1. **TerminalPanel UX** - Flawed local shell simulation, incomplete PTY integration
2. **Sandbox persistence** - Per-user snapshotting not fully wired
3. **MCP deployment** - LLM service integration incomplete
4. **Cloud offloading** - E2B/Daytona advanced services underutilized
5. **Provider service maximization** - Batch execution, snapshots, previews not auto-prioritized

---

## 1. Current Architecture Overview

### 1.1 Sandbox Providers (`lib/sandbox/providers/`)

| Provider | Status | PTY | Snapshots | Batch Exec | Live Preview | VFS Sync |
|----------|--------|-----|-----------|------------|--------------|----------|
| **Daytona** | ✅ Full | ✅ | ❌ | ❌ | ✅ | ❌ |
| **E2B** | ✅ Full | ✅ | ❌ | ✅ (AMP/Codex) | ✅ | ❌ |
| **Sprites** | ✅ Full | ✅ | ✅ | ❌ | ✅ | ✅ (tar-pipe) |
| **CodeSandbox** | ✅ Full | ✅ | ✅ | ✅ | ✅ | ✅ (batchWrite) |
| **WebContainer** | ✅ Browser-only | ✅ | ❌ | ❌ | ✅ | ✅ |
| **WebContainer-Spawn** | ✅ Browser-only | ✅ | ❌ | ✅ (background) | ✅ | ❌ |
| **Blaxel** | ✅ Full | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Blaxel-MCP** | ✅ Full | ❌ | ❌ | ✅ | ❌ | ❌ |
| **OpenSandbox** | ✅ Full | ✅ | ❌ | ❌ | ✅ | ❌ |
| **OpenSandbox-CI** | ✅ Full | ✅ | ❌ | ❌ | ✅ | ❌ |
| **OpenSandbox-Agent** | ✅ Full | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Mistral** | ✅ Full | ❌ | ❌ | ❌ | ❌ | ❌ |
| **MicroSandbox** | ✅ Fallback | ❌ | ❌ | ❌ | ❌ | ❌ |
| **RunLoop** | ⚠️ Partial | ❌ | ❌ | ❌ | ❌ | ❌ |

**Key Finding:** Only **Sprites** and **CodeSandbox** have full snapshot/checkpoint support. **E2B** has unique AMP/Codex agent offloading.

### 1.2 Terminal Architecture (`lib/sandbox/` + `components/terminal/`)

**Current Modes:**
- `local` - Browser shell simulation (xterm.js + mock filesystem)
- `connecting` - Sandbox provisioning state
- `pty` - Full PTY via WebSocket to backend
- `sandbox-cmd` - Line-based command mode (fallback)
- `editor` - Nano/vim overlay

**TerminalManager Features:**
- Multi-provider resolution (fallback chain)
- Port detection (10+ patterns)
- Session persistence (SQLite/memory)
- Command-mode fallback for providers without PTY

**TerminalPanel Issues:**
```typescript
// CURRENT FLAW: Local shell simulates filesystem but doesn't sync properly
const localFileSystemRef = useRef<LocalFileSystem>({});
const [isVfsSynced, setIsVfsSynced] = useState(false);

// Complex polling logic with race conditions
useEffect(() => {
  if (!isOpen || sandboxStatus !== 'connected') return;
  const pollInterval = setInterval(async () => {
    const snapshot = await getVfsSnapshot();
    // ... complex merge logic
  }, 2000);
}, [isOpen, sandboxStatus, getVfsSnapshot]);
```

### 1.3 MCP Integration (`lib/mcp/`)

**Two Architectures Supported:**

**Architecture 1 (AI SDK - Main LLM):**
- Direct MCP tool registry integration
- Tools exposed to `useChat()` via `tools` parameter
- Servers: Stdio, SSE, WebSocket transports
- Additional: Blaxel codegen tools, Arcade API tools, mcporter

**Architecture 2 (OpenCode CLI Agent):**
- HTTP server (`mcp-cli-server.ts`) for CLI to call
- Config generation for OpenCode CLI
- Health check endpoints

**MCP Tool Sources:**
- Native MCP servers (user-configured via `mcp.config.json`)
- **Blaxel Codegen** (8 tools: search, file ops, edits)
- **Arcade API** (100+ third-party integrations)
- **mcporter** (custom tool proxy)

---

## 2. Critical Issues & Gaps

### 2.1 TerminalPanel UX Flaws

**Issue 1: Local Shell Simulation Conflicts with Sandbox**
```typescript
// Problem: Local mode has its own filesystem that conflicts with VFS
const localFileSystemRef = useRef<LocalFileSystem>({});

// When sandbox connects, local files are lost or duplicated
// No clear handoff mechanism between local → pty modes
```

**Issue 2: VFS Sync is Reactive, Not Proactive**
```typescript
// Current: Polls every 2s when sandbox connected
useEffect(() => {
  const pollInterval = setInterval(async () => {
    const snapshot = await getVfsSnapshot();
    const hasChanges = vfsFiles.some(f => !currentFiles.includes(f));
    if (hasChanges) { /* re-sync */ }
  }, 2000);
}, [isOpen, sandboxStatus, getVfsSnapshot]);

// Problem: Race conditions, missed updates, no conflict resolution
```

**Issue 3: No Per-User Session Isolation**
```typescript
// Current: Global terminal sessions shared across users
const activePtyConnections = new Map<string, PtyConnection>()

// Missing: User-scoped sessions with snapshot isolation
```

**Issue 4: Editor Mode is Fragile**
```typescript
// Nano/vim simulation in browser is incomplete
const editorSessionRef = useRef<Record<string, {
  type: 'nano' | 'vim' | 'vi';
  content: string;
  cursor: number;
  lines: string[];
  // ... incomplete implementation
} | null>>({});

// Should offload to real PTY-based editors instead
```

### 2.2 Sandbox Persistence Gaps

**Current State:**
- Sprites: Native checkpoint system (ext4 snapshots)
- CodeSandbox: Snapshot API (hibernation-based)
- E2B: No native snapshots (stateless by design)
- Daytona: No snapshot API (stateless)

**Missing:**
1. **Per-user snapshot isolation** - No user-scoped snapshot namespaces
2. **Automatic snapshot on disconnect** - Sessions don't auto-save state
3. **Snapshot sync to local** - No download/restore to local filesystem
4. **Cross-provider snapshot portability** - Sprites checkpoints can't migrate to Daytona

**Relevant Code (Sprites):**
```typescript
// lib/sandbox/providers/sprites-provider.ts
async createCheckpoint(name?: string): Promise<CheckpointInfo> {
  const checkpoint = await this.sprite.createCheckpoint(name);
  return { id: checkpoint.id, name, createdAt: new Date() };
}

// NOT wired to terminal session lifecycle
// Should auto-snapshot on:
// - User disconnect
// - Idle timeout
// - Before destructive operations
```

### 2.3 MCP Deployment Issues

**Issue 1: LLM Service Integration Incomplete**
```typescript
// lib/mcp/architecture-integration.ts
export async function getMCPToolsForAI_SDK() {
  const nativeTools = isMCPAvailable() ? mcpToolRegistry.getToolDefinitions() : [];
  const blaxelTools = process.env.BLAXEL_API_KEY ? getBlaxelCodegenToolDefinitions() : [];
  const arcadeTools = process.env.ARCADE_API_KEY ? await getArcadeToolDefinitions() : [];
  return [...nativeTools, ...cachedMCPorterTools, ...blaxelTools, ...arcadeTools];
}

// Problem: No auto-discovery of provider-specific tools
// E2B AMP/Codex, Daytona LSP/Computer Use NOT exposed as MCP tools
```

**Issue 2: No Health Monitoring**
```typescript
export function checkMCPHealth(): {
  available: boolean;
  toolCount: number;
  serverStatuses: Array<{ id: string; connected: boolean }>;
}

// Missing: Latency tracking, error rates, quota status per server
```

**Issue 3: CLI Server Not Production-Ready**
```typescript
// lib/mcp/mcp-cli-server.ts
export async function createMCPServerForCLI(port: number = 8888) {
  // Basic HTTP server, no auth, no rate limiting
  // Not suitable for multi-tenant deployment
}
```

### 2.4 Cloud Provider Offloading (Underutilized)

**E2B Advanced Services (NOT wired to LLM):**
```typescript
// lib/sandbox/providers/e2b-provider.ts
class E2BSandboxHandle {
  getAmpService(): E2BAmpService | null  // ✅ Implemented
  getCodexService(): E2BCodexService | null  // ✅ Implemented
  async executeAmp(config: AmpExecutionConfig): Promise<AmpExecutionResult>
  async executeCodex(config: CodexExecutionConfig): Promise<CodexExecutionResult>

  // ❌ NOT exposed as MCP tools
  // ❌ NOT auto-prioritized for agent tasks
}
```

**Daytona Advanced Services (NOT wired):**
```typescript
// lib/sandbox/providers/daytona-provider.ts
class DaytonaSandboxHandle {
  getComputerUseService(): ComputerUseService | null  // ✅ Implemented
  getLSPService(): LSPService | null  // ✅ Implemented
  getObjectStorageService(): ObjectStorageService | null  // ✅ Implemented

  async startRecording(options?: ScreenRecordingRequest): Promise<ToolResult>
  async takeRegionScreenshot(...): Promise<ToolResult>
  // LSP: completion, hover, definition, references
  // Object Storage: upload, download, list

  // ❌ NOT exposed as MCP tools
  // ❌ NOT auto-prioritized
}
```

**CodeSandbox Advanced (PARTIALLY wired):**
```typescript
// lib/sandbox/providers/codesandbox-provider.ts
class CodeSandboxHandle {
  async createSnapshot(label?: string): Promise<any>  // ✅ Via advanced integration
  async rollbackToSnapshot(snapshotId: string): Promise<void>
  async batchWrite(files: Array<{ path: string; content: string | Uint8Array }>): Promise<ToolResult>
  async executeCommandBackground(command: string, onOutput?: (data: string) => void): Promise<{ process: any; kill: () => Promise<void> }>
  async waitForPort(port: number, timeoutMs?: number): Promise<PreviewInfo>
  async runTask(taskName: string): Promise<{ success: boolean; port?: number; url?: string }>

  // ⚠️ Snapshot wired, but NOT auto-prioritized
  // ⚠️ Background execution NOT used for long-running tasks
}
```

### 2.5 Live Preview Offloading

**Current Implementation:**
```typescript
// components/code-preview-panel.tsx
import { Sandpack } from "@codesandbox/sandpack-react";

// Lightweight Sandpack preview - limited to frontend
// Cannot handle backend, databases, or full-stack apps
```

**Available but NOT Wired:**

**Daytona Preview URLs:**
```typescript
// lib/sandbox/providers/daytona-provider.ts
async getPreviewLink(port: number): Promise<PreviewInfo> {
  const preview = await this.sandbox.getPreviewLink(port);
  return { port, url: preview.url, token: preview.token };
}
// Full VM preview - supports backend, databases, etc.
```

**E2B Preview URLs:**
```typescript
// lib/sandbox/providers/e2b-provider.ts
async getPreviewLink(port: number): Promise<PreviewInfo> {
  const host = this.sandbox.getHost(port);
  return { port, url: host };
}
```

**CodeSandbox Preview URLs:**
```typescript
// lib/sandbox/providers/codesandbox-provider.ts
async getPreviewLink(port: number): Promise<PreviewInfo> {
  const url = this.client.hosts.getUrl(port);
  return { port, url };
}
// Also supports tasks with auto-wait for port:
async runTask(taskName: string): Promise<{ success: boolean; port?: number; url?: string }>
```

**Vercel/Other Providers:**
```typescript
// NOT integrated
// Could offload to:
// - Vercel Live Preview API
// - Netlify Dev
// - Cloudflare Pages Preview
```

---

## 3. Recommendations & Implementation Plan

### 3.1 TerminalPanel UX Improvements

**Recommendation 1: Unified PTY-First Architecture**

```typescript
// NEW: Remove local shell simulation, always use sandbox PTY
interface TerminalPanelProps {
  userId: string;  // Required for per-user isolation
  defaultProvider?: SandboxProviderType;
  autoConnect?: boolean;  // Auto-provision sandbox on mount
}

// Remove local mode entirely
type TerminalMode = 'provisioning' | 'pty' | 'command-mode' | 'disconnected';

// Benefits:
// - No filesystem sync conflicts
// - Real shell, not simulation
// - Consistent experience across users
```

**Recommendation 2: Per-User Session Isolation**

```typescript
// NEW: User-scoped session store
interface UserTerminalSession {
  sessionId: string;
  userId: string;  // Namespaced per user
  sandboxId: string;
  snapshotId?: string;  // Auto-snapshot on disconnect
  createdAt: number;
  lastActive: number;
  mode: 'pty' | 'command-mode';
}

// lib/sandbox/terminal-session-store.ts
export function getUserSessions(userId: string): UserTerminalSession[] {
  return getSessionsByUserId(userId);
}

export function createSessionForUser(userId: string, sandboxId: string): UserTerminalSession {
  // Auto-create snapshot if user has existing session
  const existing = getUserSessions(userId);
  if (existing.length > 0) {
    // Restore from snapshot or create new
  }
}
```

**Recommendation 3: Auto-Offload to Sandbox on Complexity**

```typescript
// NEW: Detect when local execution is insufficient
function shouldOffloadToSandbox(command: string, context: ExecutionContext): boolean {
  // Offload if:
  if (command.includes('npm install') || command.includes('pip install')) return true;  // Package installs
  if (command.includes('docker ') || command.includes('kubectl ')) return true;  // Container ops
  if (command.includes('sudo ') || command.includes('apt ')) return true;  // System ops
  if (context.fileCount > 50) return true;  // Large projects
  if (context.requiresBackend) return true;  // Backend dependencies
  return false;
}

// Auto-provision sandbox when threshold crossed
if (shouldOffloadToSandbox(command, context)) {
  await toggleSandboxConnection();  // Auto-connect
  toast.info('Auto-offloading to sandbox for full shell access');
}
```

**Recommendation 4: Real Editor Integration**

```typescript
// Remove nano/vim simulation
// Instead: Detect editor launch, auto-open in sandbox PTY

// TerminalPanel.tsx
useEffect(() => {
  const handleEditorRequest = (e: CustomEvent) => {
    const { filePath, editorType } = e.detail;
    if (sandboxStatus === 'connected') {
      // Send real editor command to PTY
      sendInput(`${editorType} ${filePath}\n`);
    } else {
      // Auto-connect sandbox first
      toggleSandboxConnection();
      toast.info('Connecting to sandbox for editor support');
    }
  };

  window.addEventListener('editor-request', handleEditorRequest);
  return () => window.removeEventListener('editor-request', handleEditorRequest);
}, [sandboxStatus]);
```

### 3.2 Sandbox Persistence Implementation

**Recommendation 1: Auto-Snapshot on Disconnect**

```typescript
// lib/sandbox/terminal-manager.ts
async disconnectTerminal(sessionId: string, options?: { createSnapshot?: boolean }): Promise<void> {
  const conn = activePtyConnections.get(sessionId);
  if (conn) {
    // Auto-snapshot before disconnect if provider supports it
    if (options?.createSnapshot !== false) {
      const provider = await getSandboxProvider(conn.providerType);
      const handle = await provider.getSandbox(conn.sandboxId);

      if (handle.createCheckpoint) {
        const snapshotId = await handle.createCheckpoint(`auto-${sessionId}-${Date.now()}`);
        // Store snapshot ID in session metadata
        updateTerminalSession(sessionId, { metadata: { lastSnapshotId: snapshotId } });
      }
    }

    await conn.ptyHandle.disconnect();
    activePtyConnections.delete(sessionId);
  }
}
```

**Recommendation 2: Per-User Snapshot Namespaces**

```typescript
// lib/sandbox/providers/sandbox-provider.ts
interface CheckpointInfo {
  id: string;
  userId: string;  // NEW: Owner
  name?: string;
  createdAt: string;
  sandboxId: string;
  metadata?: {
    autoSnapshot?: boolean;
    reason?: 'user_request' | 'auto_disconnect' | 'idle_timeout';
  };
}

// Sprites provider update
async createCheckpoint(userId: string, name?: string, metadata?: any): Promise<CheckpointInfo> {
  const checkpoint = await this.sprite.createCheckpoint(name);
  return {
    id: checkpoint.id,
    userId,
    name,
    createdAt: new Date().toISOString(),
    sandboxId: this.id,
    metadata,
  };
}
```

**Recommendation 3: Snapshot Sync to Local**

```typescript
// NEW: lib/sandbox/snapshot-sync.ts
export async function downloadSnapshotToLocal(
  snapshotId: string,
  providerType: SandboxProviderType,
  localPath: string
): Promise<{ success: boolean; filesSynced: number }> {
  const provider = await getSandboxProvider(providerType);
  const handle = await provider.getSandbox(snapshotId);

  if (handle.listCheckpoints) {
    const checkpoints = await handle.listCheckpoints();
    const latest = checkpoints[0];

    if (handle.restoreCheckpoint) {
      await handle.restoreCheckpoint(latest.id);
    }

    // Sync files to local
    const files = await handle.listDirectory('/workspace');
    // ... download each file
  }

  return { success: true, filesSynced: 0 };
}
```

### 3.3 MCP + LLM Service Integration

**Recommendation 1: Auto-Discover Provider Tools**

```typescript
// lib/mcp/architecture-integration.ts
export async function getMCPToolsForAI_SDK(userId?: string) {
  const nativeTools = isMCPAvailable() ? mcpToolRegistry.getToolDefinitions() : [];
  const blaxelTools = process.env.BLAXEL_API_KEY ? getBlaxelCodegenToolDefinitions() : [];
  const arcadeTools = process.env.ARCADE_API_KEY ? await getArcadeToolDefinitions() : [];

  // NEW: Auto-discover provider-specific tools
  const providerTools: Array<{ type: 'function'; function: any }> = [];

  // E2B AMP/Codex tools
  if (process.env.E2B_API_KEY && process.env.AMP_API_KEY) {
    providerTools.push(...getE2BAmpToolDefinitions());
  }
  if (process.env.E2B_API_KEY && process.env.CODEX_API_KEY) {
    providerTools.push(...getE2BCodexToolDefinitions());
  }

  // Daytona Computer Use / LSP tools
  if (process.env.DAYTONA_API_KEY) {
    providerTools.push(...getDaytonaComputerUseToolDefinitions());
    providerTools.push(...getDaytonaLSPToolDefinitions());
  }

  // CodeSandbox batch/task tools
  if (process.env.CSB_API_KEY) {
    providerTools.push(...getCodesandboxBatchToolDefinitions());
  }

  const tools = [...nativeTools, ...cachedMCPorterTools, ...blaxelTools, ...arcadeTools, ...providerTools];
  return tools;
}
```

**Recommendation 2: MCP Health Dashboard**

```typescript
// NEW: lib/mcp/health-monitor.ts
interface MCPServerHealth {
  serverId: string;
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  errorRate: number;
  quotaRemaining?: number;
  lastChecked: number;
}

export class MCPHealthMonitor {
  private healthMap = new Map<string, MCPServerHealth>();
  private checkInterval: NodeJS.Timeout;

  constructor(checkIntervalMs: number = 30000) {
    this.checkInterval = setInterval(() => this.checkAll(), checkIntervalMs);
  }

  async checkAll(): Promise<void> {
    const servers = mcpToolRegistry.getAllServerStatuses();
    for (const server of servers) {
      const start = Date.now();
      try {
        const client = mcpToolRegistry.getServerInfo(server.id);
        await client?.ping?.();
        this.healthMap.set(server.id, {
          serverId: server.id,
          name: server.name,
          status: 'healthy',
          latency: Date.now() - start,
          errorRate: 0,
          lastChecked: Date.now(),
        });
      } catch (error) {
        this.healthMap.set(server.id, {
          serverId: server.id,
          name: server.name,
          status: 'unhealthy',
          latency: Date.now() - start,
          errorRate: 1,
          lastChecked: Date.now(),
        });
      }
    }
  }

  getHealthDashboard(): MCPServerHealth[] {
    return Array.from(this.healthMap.values());
  }
}
```

**Recommendation 3: Production-Ready CLI Server**

```typescript
// lib/mcp/mcp-cli-server.ts
export async function createMCPServerForCLI(port: number = 8888, options?: {
  apiKey?: string;  // Require auth
  rateLimit?: number;  // Requests per minute
  allowedOrigins?: string[];
}) {
  const app = express();

  // Auth middleware
  if (options?.apiKey) {
    app.use((req, res, next) => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${options.apiKey}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });
  }

  // Rate limiting
  if (options?.rateLimit) {
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: options.rateLimit,
    });
    app.use(limiter);
  }

  // CORS
  if (options?.allowedOrigins) {
    app.use(cors({ origin: options.allowedOrigins }));
  }

  // ... rest of server
}
```

### 3.4 Cloud Provider Offloading Strategy

**Recommendation 1: Auto-Prioritize Provider by Task Type**

```typescript
// NEW: lib/sandbox/provider-router.ts
interface TaskContext {
  type: 'code-interpreter' | 'agent' | 'fullstack-app' | 'batch-job' | 'computer-use';
  requiresPersistence?: boolean;
  requiresBackend?: boolean;
  requiresGPU?: boolean;
  expectedDuration?: 'short' | 'medium' | 'long';
  fileCount?: number;
}

export function selectOptimalProvider(context: TaskContext): SandboxProviderType {
  // Code interpreter → E2B (optimized for Jupyter)
  if (context.type === 'code-interpreter') return 'e2b';

  // Agent tasks → E2B with AMP/Codex
  if (context.type === 'agent') {
    if (process.env.AMP_API_KEY) return 'e2b';
    if (process.env.CODEX_API_KEY) return 'e2b';
    return 'daytona';
  }

  // Full-stack apps → CodeSandbox or Daytona
  if (context.type === 'fullstack-app') {
    if (context.requiresBackend) return 'daytona';
    return 'codesandbox';
  }

  // Batch jobs → Blaxel or CodeSandbox
  if (context.type === 'batch-job') {
    if (process.env.BLAXEL_API_KEY) return 'blaxel';
    return 'codesandbox';
  }

  // Computer use → Daytona
  if (context.type === 'computer-use') return 'daytona';

  // Persistence required → Sprites
  if (context.requiresPersistence) return 'sprites';

  // Default fallback
  return 'daytona';
}
```

**Recommendation 2: Serverless Agent Offloading (E2B AMP/Codex)**

```typescript
// NEW: lib/sandbox/providers/e2b-agent-offload.ts
import { E2BProvider } from './e2b-provider';

export class E2BAgentOffload {
  private provider: E2BProvider;

  constructor() {
    this.provider = new E2BProvider();
  }

  /**
   * Offload agent task to E2B AMP (Anthropic)
   * Spawns cloud instance, runs agent, returns result
   */
  async runAMPAgent(prompt: string, options?: {
    workingDir?: string;
    streamJson?: boolean;
    model?: string;
  }): Promise<{ result: string; sandboxId: string; cost: number }> {
    const handle = await this.provider.createSandbox({});

    const ampService = handle.getAmpService();
    if (!ampService) {
      throw new Error('AMP_API_KEY not configured');
    }

    const result = await ampService.run({
      prompt,
      workingDir: options?.workingDir || '/home/user',
      streamJson: options?.streamJson ?? false,
      model: options?.model,
    });

    return {
      result: result.output,
      sandboxId: handle.id,
      cost: result.cost || 0,
    };
  }

  /**
   * Offload agent task to E2B Codex (OpenAI)
   */
  async runCodexAgent(prompt: string, options?: {
    workingDir?: string;
    fullAuto?: boolean;
    outputSchemaPath?: string;
  }): Promise<{ result: string; sandboxId: string; cost: number }> {
    const handle = await this.provider.createSandbox({});

    const codexService = handle.getCodexService();
    if (!codexService) {
      throw new Error('CODEX_API_KEY not configured');
    }

    const result = await codexService.run({
      prompt,
      workingDir: options?.workingDir || '/home/user',
      fullAuto: options?.fullAuto ?? false,
      outputSchemaPath: options?.outputSchemaPath,
    });

    return {
      result: result.output,
      sandboxId: handle.id,
      cost: result.cost || 0,
    };
  }
}
```

**Recommendation 3: Daytona Computer Use Integration**

```typescript
// NEW: lib/sandbox/providers/daytona-computer-use-integration.ts
import { DaytonaProvider } from './daytona-provider';

export class DaytonaComputerUseIntegration {
  private provider: DaytonaProvider;

  constructor() {
    this.provider = new DaytonaProvider();
  }

  /**
   * Take screenshot of sandbox desktop
   */
  async takeScreenshot(sandboxId: string): Promise<{ imageUrl: string }> {
    const handle = await this.provider.getSandbox(sandboxId);
    const service = handle.getComputerUseService();

    if (!service) {
      throw new Error('Computer Use Service not available');
    }

    const result = await service.takeRegion({ x: 0, y: 0, width: 1920, height: 1080 });
    return { imageUrl: result.image };
  }

  /**
   * Start screen recording
   */
  async startRecording(sandboxId: string): Promise<{ recordingId: string }> {
    const handle = await this.provider.getSandbox(sandboxId);
    const service = handle.getComputerUseService();

    const result = await service.startRecording();
    return { recordingId: result.recordingId };
  }

  /**
   * Stop recording and get video URL
   */
  async stopRecording(sandboxId: string, recordingId: string): Promise<{ videoUrl: string }> {
    const handle = await this.provider.getSandbox(sandboxId);
    const service = handle.getComputerUseService();

    const result = await service.stopRecording(recordingId);
    return { videoUrl: result.video };
  }
}
```

**Recommendation 4: CodeSandbox Batch Execution**

```typescript
// NEW: lib/sandbox/providers/codesandbox-batch.ts
import { CodeSandboxProvider } from './codesandbox-provider';

export class CodeSandboxBatchExecution {
  private provider: CodeSandboxProvider;

  constructor() {
    this.provider = new CodeSandboxProvider();
  }

  /**
   * Run batch job across multiple sandboxes
   */
  async runBatchJob(tasks: Array<{
    id: string;
    command: string;
    files?: Array<{ path: string; content: string }>;
  }>, options?: {
    maxConcurrent?: number;
    timeout?: number;
  }): Promise<{
    results: Array<{ taskId: string; success: boolean; output: string; error?: string }>;
    totalDuration: number;
  }> {
    const maxConcurrent = options?.maxConcurrent || 10;
    const timeout = options?.timeout || 300000;

    const results: Array<{ taskId: string; success: boolean; output: string; error?: string }> = [];
    const startTime = Date.now();

    // Run tasks in batches
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          try {
            const handle = await this.provider.createSandbox({});

            // Write files if provided
            if (task.files) {
              for (const file of task.files) {
                await handle.writeFile(file.path, file.content);
              }
            }

            // Execute command
            const result = await handle.executeCommand(task.command, undefined, timeout);

            await this.provider.destroySandbox(handle.id);

            return {
              taskId: task.id,
              success: result.success,
              output: result.output,
            };
          } catch (error: any) {
            return {
              taskId: task.id,
              success: false,
              output: '',
              error: error.message,
            };
          }
        })
      );

      results.push(...batchResults);
    }

    return {
      results,
      totalDuration: Date.now() - startTime,
    };
  }
}
```

### 3.5 Live Preview Offloading

**Recommendation 1: Auto-Select Preview Provider**

```typescript
// NEW: lib/sandbox/preview-router.ts
interface PreviewContext {
  port: number;
  framework?: 'react' | 'vue' | 'next' | 'nuxt' | 'svelte';
  hasBackend?: boolean;
  requiresDatabase?: boolean;
  isFullStack?: boolean;
}

export function selectPreviewProvider(context: PreviewContext): 'sandpack' | 'daytona' | 'codesandbox' | 'e2b' {
  // Full-stack or backend → Use provider preview URL
  if (context.hasBackend || context.requiresDatabase || context.isFullStack) {
    if (process.env.DAYTONA_API_KEY) return 'daytona';
    if (process.env.E2B_API_KEY) return 'e2b';
    if (process.env.CSB_API_KEY) return 'codesandbox';
  }

  // Frontend-only → Sandpack (lightweight)
  if (context.framework && !context.hasBackend) {
    return 'sandpack';
  }

  // Default to provider preview
  return 'daytona';
}
```

**Recommendation 2: Preview Component with Fallback**

```typescript
// NEW: components/preview/smart-preview.tsx
import { Sandpack } from "@codesandbox/sandpack-react";

interface SmartPreviewProps {
  sandboxId: string;
  port: number;
  previewContext: PreviewContext;
}

export function SmartPreview({ sandboxId, port, previewContext }: SmartPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [provider, setProvider] = useState<'sandpack' | 'external' | 'loading'>('loading');

  useEffect(() => {
    const selectedProvider = selectPreviewProvider(previewContext);

    if (selectedProvider === 'sandpack') {
      setProvider('sandpack');
    } else {
      // Fetch preview URL from provider
      getPreviewLink(sandboxId, port).then(url => {
        setPreviewUrl(url);
        setProvider('external');
      });
    }
  }, [sandboxId, port, previewContext]);

  if (provider === 'loading') {
    return <div>Loading preview...</div>;
  }

  if (provider === 'sandpack') {
    return (
      <Sandpack
        template="react"
        files={/* ... */}
        options={{ height: 600 }}
      />
    );
  }

  if (previewUrl) {
    return (
      <iframe
        src={previewUrl}
        className="w-full h-[600px] border-0"
        title="Preview"
      />
    );
  }

  return <div>Preview unavailable</div>;
}
```

---

## 4. Implementation Priority

### Phase 1: Critical Fixes (Week 1-2)
1. **TerminalPanel PTY-First Migration** - Remove local shell simulation
2. **Per-User Session Isolation** - Namespaced terminal sessions
3. **Auto-Snapshot on Disconnect** - Sprites/CodeSandbox integration
4. **Provider Tool Discovery** - E2B AMP/Codex, Daytona Computer Use as MCP tools

### Phase 2: Provider Optimization (Week 3-4)
1. **Provider Router** - Auto-select optimal provider by task type
2. **E2B Agent Offloading** - AMP/Codex serverless agents
3. **Daytona Computer Use** - Screenshot/recording integration
4. **CodeSandbox Batch Execution** - Parallel job runner

### Phase 3: Preview & MCP (Week 5-6)
1. **Smart Preview Component** - Auto-select Sandpack vs provider URLs
2. **MCP Health Dashboard** - Monitoring and alerting
3. **Production CLI Server** - Auth, rate limiting, CORS
4. **Snapshot Sync to Local** - Download/restore workflows

### Phase 4: Advanced Features (Week 7-8)
1. **Cross-Provider Snapshots** - Portability layer
2. **LSP Integration** - Daytona LSP for code intelligence
3. **Object Storage** - Daytona large file persistence
4. **GPU Task Routing** - Provider selection for ML workloads

---

## 5. Security Considerations

1. **Per-User Isolation** - Ensure snapshots/terminal sessions are user-namespaced
2. **API Key Management** - Provider keys should be user-scoped, not global
3. **Snapshot Encryption** - Sensitive data in snapshots should be encrypted
4. **Preview URL Auth** - Provider preview URLs may need token-based access
5. **MCP Tool Permissions** - Tools should have user-scoped access controls

---

## 6. Testing Strategy

1. **Unit Tests** - Provider selection logic, security validation
2. **Integration Tests** - PTY connections, snapshot creation/restoration
3. **E2E Tests** - Full workflow: local → sandbox → snapshot → restore
4. **Load Tests** - Concurrent sandbox provisioning, batch execution
5. **Security Tests** - Obfuscation detection, command validation bypass attempts

---

## Appendix: File Reference

### Key Files Reviewed
- `components/terminal/TerminalPanel.tsx` (4295 lines)
- `lib/sandbox/terminal-manager.ts`
- `lib/sandbox/terminal-session-store.ts`
- `lib/sandbox/core-sandbox-service.ts`
- `lib/sandbox/providers/sandbox-provider.ts`
- `lib/sandbox/providers/e2b-provider.ts` (1230 lines)
- `lib/sandbox/providers/daytona-provider.ts`
- `lib/sandbox/providers/codesandbox-provider.ts` (945 lines)
- `lib/sandbox/providers/sprites-provider.ts` (1335 lines)
- `lib/sandbox/providers/webcontainer-spawn-provider.ts`
- `lib/mcp/index.ts`
- `lib/mcp/architecture-integration.ts`
- `lib/mcp/tool-registry.ts`
- `lib/terminal/terminal-security.ts`
- `lib/virtual-filesystem/index.ts`

### Documentation Files
- `docs/MCP_INTEGRATION.md`
- `docs/WEBSOCKET_TERMINAL_INTEGRATION.md`
- `docs/sdk/TERMINAL_INTEGRATION_REVIEW.md`
- `docs/sdk/e2b/pty.md`
- `docs/sdk/e2b/computer-use.md`
- `docs/sdk/COMPUTER_USE.md`
