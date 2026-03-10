# OpenCode V2 Engine + Nullclaw Integration Architecture

## Executive Summary

This document outlines the comprehensive architecture for **OpenCode V2 Engine** - a Dockerized CLI-based agentic system that combines:

1. **OpenCode CLI** - Primary coding agent with native bash, filesystem, and code generation capabilities
2. **Nullclaw** - Lightweight task assistant for non-coding agency (messaging, internet use, server automation)
3. **OpenSandbox** - Secure containerized execution environment with per-user isolation
4. **MCP Integration** - Dynamic tool discovery from configured MCP servers
5. **Daytona/E2B** - Cloud sandbox providers for "serverless" agent offshoots

This V2 architecture provides a powerful alternative to the V1 LLM API chat system, enabling complex multi-step tasks with persistent memory, full shell access, and native tool execution.

---

## Architecture Overview

### V1 vs V2 Comparison

| Feature | V1 (LLM API Chat) | V2 (OpenCode + Nullclaw) |
|---------|-------------------|--------------------------|
| **Reasoning** | LLM-dependent | Native agent reasoning |
| **Tool Execution** | Manual engineering | Auto-discovery + native |
| **Memory** | Per-request stateless | Persistent sessions |
| **Shell Access** | Limited via tools | Full bash access |
| **Filesystem** | VFS only | Direct + VFS sync |
| **Internet Use** | Via API calls | Native browser/curl |
| **Messaging** | API integrations | Discord/Telegram native |
| **Cloud Offload** | Manual | Daytona/E2B auto-spawn |
| **Skills** | API calls | Native execution |
| **MCP Tools** | Pre-configured | Dynamic discovery |

---

## Core Components

### 1. OpenCode Engine Service (Existing)

**File:** `lib/api/opencode-engine-service.ts`

**Current Capabilities:**
- ✅ Native bash command execution
- ✅ File system operations
- ✅ Code generation and refactoring
- ✅ Multi-step reasoning
- ✅ Tool calling with real execution
- ✅ Session management (30-min TTL)
- ✅ Streaming output

**Enhancement Opportunities:**
- [ ] Containerized execution (partially implemented in `opencode-containerized-provider.ts`)
- [ ] Per-user workspace isolation
- [ ] VFS ↔ Sandbox bidirectional sync
- [ ] Nullclaw integration for non-coding tasks

---

### 2. Nullclaw Task Assistant

**Source:** `docs/sdk/opensandbox/examples/nullclaw/main.py`

**Capabilities:**
- Discord/Telegram messaging
- Internet browsing and data extraction
- Server automation
- API integrations
- Scheduled tasks
- Event-driven triggers

**Integration Strategy:**

```typescript
// lib/agent/nullclaw-integration.ts
interface NullclawConfig {
  serverUrl: string;
  image: string; // 'ghcr.io/nullclaw/nullclaw:latest'
  timeout: number; // seconds
  allowedDomains: string[]; // Network policy
}

class NullclawIntegration {
  private sandbox: OpenSandboxHandle;
  
  async initialize(config: NullclawConfig): Promise<void> {
    // Create OpenSandbox instance for Nullclaw
    this.sandbox = await createOpenSandbox({
      image: config.image,
      timeout: config.timeout,
      networkPolicy: {
        defaultAction: 'deny',
        egress: config.allowedDomains.map(d => ({
          action: 'allow',
          target: d,
        })),
      },
    });
    
    // Wait for health check
    await this.waitForReady();
  }
  
  async executeTask(task: string): Promise<ToolResult> {
    // Send task to Nullclaw via HTTP API
    const response = await fetch(`${this.sandbox.getEndpoint(3000)}/api/execute`, {
      method: 'POST',
      body: JSON.stringify({ task }),
    });
    
    return response.json();
  }
  
  private async waitForReady(): Promise<void> {
    // Poll health endpoint (from nullclaw example)
    const endpoint = this.sandbox.getEndpoint(3000);
    const url = `http://${endpoint.endpoint}/health`;
    
    for (let i = 0; i < 150; i++) {
      try {
        const resp = await fetch(url, { timeout: 1000 });
        if (resp.status === 200) return;
      } catch {}
      await sleep(200);
    }
    throw new Error('Nullclaw health check timeout');
  }
}
```

---

### 3. OpenSandbox Containerized Provider (Existing)

**File:** `lib/sandbox/providers/opencode-containerized-provider.ts`

**Current Implementation:**
- ✅ Spawns OpenCode CLI in sandbox container
- ✅ Session-based isolation
- ✅ Resource limits (CPU, memory)
- ✅ Health check on startup

**Enhancement Needed:**
```typescript
// Enhanced per-user isolation
interface UserSandboxSession {
  userId: string;
  conversationId: string;
  sandboxHandle: OpenSandboxHandle;
  workspacePath: string; // `/workspace/users/${userId}/${conversationId}`
  nullclawEndpoint?: string;
  createdAt: Date;
  lastActive: Date;
}

class EnhancedOpencodeProvider {
  private userSessions = new Map<string, UserSandboxSession>();
  
  async getUserSession(userId: string, conversationId: string): Promise<UserSandboxSession> {
    const key = `${userId}:${conversationId}`;
    
    // Return existing or create new
    let session = this.userSessions.get(key);
    if (!session) {
      session = await this.createSession(userId, conversationId);
      this.userSessions.set(key, session);
    }
    
    return session;
  }
  
  private async createSession(userId: string, conversationId: string): Promise<UserSandboxSession> {
    const provider = await getSandboxProvider();
    
    // Create isolated sandbox
    const sandbox = await provider.createSandbox({
      envVars: {
        USER_ID: userId,
        CONVERSATION_ID: conversationId,
        WORKSPACE_DIR: `/workspace/users/${userId}/${conversationId}`,
      },
      labels: { userId, conversationId, mode: 'agent' },
    });
    
    // Initialize Nullclaw if enabled
    let nullclawEndpoint: string | undefined;
    if (process.env.NULLCLAW_ENABLED === 'true') {
      const nullclaw = new NullclawIntegration();
      await nullclaw.initialize({
        serverUrl: sandbox.getEndpoint(3000),
        image: 'ghcr.io/nullclaw/nullclaw:latest',
        timeout: 3600,
        allowedDomains: ['openrouter.ai', 'api.discord.com', 'api.telegram.org'],
      });
      nullclawEndpoint = nullclaw.getEndpoint();
    }
    
    return {
      userId,
      conversationId,
      sandboxHandle: sandbox,
      workspacePath: `/workspace/users/${userId}/${conversationId}`,
      nullclawEndpoint,
      createdAt: new Date(),
      lastActive: new Date(),
    };
  }
}
```

---

### 4. VFS ↔ Sandbox Bridge

**Purpose:** Sync Virtual Filesystem with sandbox working directory

```typescript
// lib/virtual-filesystem/agent-fs-bridge.ts
class AgentFSBridge {
  constructor(
    private vfs: VirtualFilesystemService,
    private sessionManager: AgentSessionManager,
  ) {}
  
  async syncToSandbox(userId: string, conversationId: string): Promise<void> {
    const session = await this.sessionManager.getUserSession(userId, conversationId);
    const vfsPath = `project/sessions/${conversationId}`;
    const sandboxPath = session.workspacePath;
    
    // Export VFS snapshot
    const snapshot = await this.vfs.exportWorkspace(userId);
    
    // Sync files to sandbox
    for (const file of snapshot.files) {
      const relativePath = file.path.replace('project/', '');
      await session.sandboxHandle.writeFile(
        `${sandboxPath}/${relativePath}`,
        file.content,
      );
    }
  }
  
  async syncFromSandbox(userId: string, conversationId: string): Promise<void> {
    const session = await this.sessionManager.getUserSession(userId, conversationId);
    
    // Get list of files in sandbox workspace
    const listResult = await session.sandboxHandle.executeCommand(
      `find ${session.workspacePath} -type f`,
    );
    
    // Sync changed files back to VFS
    const files = listResult.output.split('\n').filter(Boolean);
    for (const file of files) {
      const content = await session.sandboxHandle.readFile(file);
      const vfsPath = file.replace(`${session.workspacePath}/`, 'project/');
      await this.vfs.writeFile(userId, vfsPath, content.output);
    }
  }
  
  async watchAndSync(userId: string, conversationId: string): Promise<void> {
    // Watch for VFS changes and sync to sandbox
    // Watch for sandbox changes and sync to VFS
    // Bidirectional real-time sync
  }
}
```

---

### 5. MCP Integration for V2 (Existing Foundation)

**File:** `lib/mcp/architecture-integration.ts`

**Current Capabilities:**
- ✅ Unified MCP tool access for both architectures
- ✅ HTTP server for CLI agent tool discovery (`initializeMCPForArchitecture2`)
- ✅ Blaxel codegen tools integration
- ✅ Arcade service integration
- ✅ Tool caching and health checks

**V2 Enhancement:**
```typescript
// Enhanced OpenCode CLI config generation
export function generateOpenCodeCLIConfig(): string {
  const url = getMCPServerURL();
  const settings = getMCPSettings();
  
  return JSON.stringify({
    mcp: {
      enabled: true,
      serverUrl: url,
      autoDiscover: true,
      timeout: 60000,
      servers: settings.servers.map(s => ({
        name: s.name,
        url: s.url,
        enabled: true,
      })),
    },
    tools: {
      preferMCP: true,
      fallback: 'builtin',
      nullclaw: {
        enabled: process.env.NULLCLAW_ENABLED === 'true',
        endpoint: process.env.NULLCLAW_ENDPOINT,
      },
    },
    agent: {
      maxSteps: 20,
      timeout: 300000,
      workingDir: process.env.WORKSPACE_DIR || '/workspace',
    },
  }, null, 2);
}
```

---

### 6. Daytona/E2B Cloud Offload

**Purpose:** Spawn "serverless" OpenCode agent instances in cloud sandboxes

```typescript
// lib/agent/cloud-agent-offload.ts
interface CloudAgentConfig {
  provider: 'daytona' | 'e2b';
  image: string;
  resources: { cpu: number; memory: number };
  timeout: number; // seconds
}

class CloudAgentOffload {
  async spawnAgent(task: string, config: CloudAgentConfig): Promise<{
    sandboxId: string;
    statusUrl: string;
    resultUrl: string;
  }> {
    if (config.provider === 'daytona') {
      return this.spawnDaytonaAgent(task, config);
    } else {
      return this.spawnE2BAgent(task, config);
    }
  }
  
  private async spawnDaytonaAgent(task: string, config: CloudAgentConfig): Promise<any> {
    const daytona = new DaytonaProvider();
    
    const sandbox = await daytona.createSandbox({
      image: config.image,
      resources: config.resources,
      timeout: config.timeout,
      envVars: {
        TASK: task,
        OPENCODE_MODEL: process.env.OPENCODE_MODEL,
        MCP_SERVER_URL: getMCPServerURL(),
      },
      entrypoint: ['opencode', 'chat', '--json'],
    });
    
    return {
      sandboxId: sandbox.id,
      statusUrl: `/api/agent/cloud/${sandbox.id}/status`,
      resultUrl: `/api/agent/cloud/${sandbox.id}/result`,
    };
  }
  
  private async spawnE2BAgent(task: string, config: CloudAgentConfig): Promise<any> {
    const e2b = new E2BProvider();
    
    const sandbox = await e2b.createSandbox({
      template: config.image,
      resources: config.resources,
      timeout: config.timeout,
      envVars: {
        TASK: task,
        OPENCODE_MODEL: process.env.OPENCODE_MODEL,
      },
    });
    
    // Start OpenCode process
    await sandbox.process.start('opencode', ['chat', '--json']);
    
    return {
      sandboxId: sandbox.id,
      statusUrl: `/api/agent/cloud/${sandbox.id}/status`,
      resultUrl: `/api/agent/cloud/${sandbox.id}/result`,
    };
  }
}
```

---

## API Routes

### New Routes for V2

#### `POST /api/agent/v2/session`
Create or get V2 agent session

```typescript
// Request
{
  userId: string;
  conversationId: string;
  mode?: 'opencode' | 'nullclaw' | 'hybrid';
  enableCloudOffload?: boolean;
}

// Response
{
  sessionId: string;
  status: 'ready' | 'initializing';
  workspacePath: string;
  nullclawEndpoint?: string;
  mcpServerUrl: string;
}
```

#### `POST /api/agent/v2/execute`
Execute task in V2 agent session

```typescript
// Request
{
  sessionId: string;
  task: string;
  stream?: boolean;
}

// Response (streaming)
{
  type: 'chunk' | 'tool' | 'bash' | 'nullclaw' | 'complete' | 'error';
  data: any;
}
```

#### `POST /api/agent/v2/sync`
Sync VFS ↔ Sandbox

```typescript
// Request
{
  sessionId: string;
  direction: 'to-sandbox' | 'from-sandbox' | 'bidirectional';
}

// Response
{
  syncedFiles: string[];
  errors: string[];
}
```

#### `POST /api/agent/v2/cloud/offload`
Spawn cloud agent instance

```typescript
// Request
{
  sessionId: string;
  task: string;
  provider: 'daytona' | 'e2b';
  resources?: { cpu: number; memory: number };
}

// Response
{
  cloudAgentId: string;
  statusUrl: string;
  resultUrl: string;
  estimatedCost: number;
}
```

---

## Dockerfile Updates

### Production Dockerfile (V2 Support)

```dockerfile
# ===========================================
# Stage 3: Runner (V2 Enhanced)
# ===========================================
FROM node:20-alpine AS runner

RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    curl \
    jq \
    git \
    python3 \
    npm \
    openssh-client

WORKDIR /app

# ... existing user setup ...

# Install OpenCode agent binary
RUN npm install -g opencode
ENV PATH="/usr/local/lib/node_modules/opencode/bin:$PATH"

# Verify installation
RUN opencode --version

# Install Nullclaw (optional)
ENV NULLCLAW_ENABLED=${NULLCLAW_ENABLED:-false}
RUN if [ "$NULLCLAW_ENABLED" = "true" ]; then \
      pip install nullclaw-cli; \
    fi

# Create workspace directories
RUN mkdir -p /workspace/users && chown -R nextjs:nodejs /workspace

# Create MCP config directory
RUN mkdir -p /app/.mcp && chown -R nextjs:nodejs /app/.mcp

# Copy OpenCode V2 engine service
COPY --from=builder /app/lib/api/opencode-engine-service.ts ./lib/api/
COPY --from=builder /app/lib/agent/ ./lib/agent/

# ... rest of existing config ...
```

### Development Dockerfile (V2 Support)

```dockerfile
# ===========================================
# Development Dockerfile (V2 Enhanced)
# ===========================================
FROM node:20-alpine AS development

RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    curl \
    git \
    python3 \
    npm \
    openssh-client

WORKDIR /app

# ... existing setup ...

# Install OpenCode for development
RUN npm install -g opencode

# Install Nullclaw for development
ENV NULLCLAW_ENABLED=true
RUN pip install nullclaw-cli

# Set V2 environment variables
ENV OPENCODE_CONTAINERIZED=true
ENV OPENCODE_MODEL=claude-3-5-sonnet
ENV NULLCLAW_ENDPOINT=http://localhost:3001

# ... rest of existing config ...
```

---

## Environment Variables

```bash
# OpenCode V2 Configuration
OPENCODE_CONTAINERIZED=true
OPENCODE_BIN=/usr/local/bin/opencode
OPENCODE_MODEL=claude-3-5-sonnet
OPENCODE_SYSTEM_PROMPT="You are an expert software engineer with access to bash, file operations, and MCP tools."

# Nullclaw Configuration
NULLCLAW_ENABLED=true
NULLCLAW_IMAGE=ghcr.io/nullclaw/nullclaw:latest
NULLCLAW_TIMEOUT=3600
NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org

# OpenSandbox Configuration
OPEN_SANDBOX_BASE_URL=http://localhost:8080/v1
OPEN_SANDBOX_EXECD_BASE_URL=http://localhost:8080
OPEN_SANDBOX_API_KEY=your-api-key

# Cloud Offload Configuration
DAYTONA_API_KEY=your-daytona-key
E2B_API_KEY=your-e2b-key
CLOUD_OFFLOAD_ENABLED=true

# Feature Flags
V2_AGENT_ENABLED=true
V2_AUTO_ROUTING=true
V2_VFS_SYNC_ENABLED=true
V2_MCP_INTEGRATION=true
```

---

## UI Integration

### V2 Mode Selector

```tsx
// components/agent-v2-mode-selector.tsx
function AgentV2ModeSelector({ value, onChange, disabled }) {
  return (
    <div className="flex gap-2 p-2 bg-gray-100 rounded-lg">
      <button
        onClick={() => onChange('opencode')}
        disabled={disabled}
        className={`px-4 py-2 rounded ${
          value === 'opencode' ? 'bg-blue-600 text-white' : 'bg-white'
        }`}
      >
        💻 OpenCode (Coding)
      </button>
      <button
        onClick={() => onChange('nullclaw')}
        disabled={disabled}
        className={`px-4 py-2 rounded ${
          value === 'nullclaw' ? 'bg-purple-600 text-white' : 'bg-white'
        }`}
      >
        🤖 Nullclaw (Tasks)
      </button>
      <button
        onClick={() => onChange('hybrid')}
        disabled={disabled}
        className={`px-4 py-2 rounded ${
          value === 'hybrid' ? 'bg-green-600 text-white' : 'bg-white'
        }`}
      >
        🔄 Hybrid (Both)
      </button>
    </div>
  );
}
```

### Cloud Offload Status

```tsx
// components/cloud-agent-status.tsx
function CloudAgentStatus({ agentId, status }) {
  return (
    <div className="p-3 bg-gray-50 rounded border">
      <div className="flex items-center gap-2">
        <CloudIcon />
        <span>Cloud Agent: {agentId}</span>
        <span className={`status-${status}`}>{status}</span>
      </div>
      {status === 'running' && (
        <div className="mt-2">
          <ProgressBar />
          <p className="text-sm text-gray-600">Executing in cloud sandbox...</p>
        </div>
      )}
    </div>
  );
}
```

---

## Security Considerations

### 1. Sandbox Isolation
- Per-user workspaces: `/workspace/users/{userId}/{conversationId}`
- Network policies for Nullclaw (egress rules)
- Resource limits (CPU, memory, disk)
- Automatic cleanup after timeout

### 2. Command Sanitization
- All commands sanitized via `SandboxSecurityManager`
- Path traversal prevention
- Shell injection prevention
- Audit logging for all executions

### 3. MCP Server Access
- MCP servers configured per-session
- Access tokens scoped to user
- Audit logging for all MCP calls
- Network isolation for MCP connections

### 4. Cloud Offload Security
- Encrypted communication with Daytona/E2B
- Temporary credentials (short-lived)
- Cost limits and quotas
- Result validation before sync

---

## Migration Path

### Phase 1: Foundation (Week 1-2)
- [ ] Enhance `OpenCodeEngineService` with containerized support
- [ ] Implement per-user session manager
- [ ] Create VFS ↔ Sandbox bridge
- [ ] Update Dockerfiles with V2 support

### Phase 2: Nullclaw Integration (Week 3-4)
- [ ] Implement Nullclaw integration layer
- [ ] Add health check and endpoint management
- [ ] Create task routing logic (coding vs non-coding)
- [ ] Add Discord/Telegram configuration UI

### Phase 3: MCP Enhancement (Week 5-6)
- [ ] Update MCP config generation for CLI
- [ ] Add dynamic tool discovery
- [ ] Implement tool caching
- [ ] Add MCP health monitoring

### Phase 4: Cloud Offload (Week 7-8)
- [ ] Implement Daytona provider integration
- [ ] Implement E2B provider integration
- [ ] Create cloud agent status monitoring
- [ ] Add cost tracking and limits

### Phase 5: UI/UX (Week 9-10)
- [ ] Add V2 mode selector to UI
- [ ] Implement session status indicator
- [ ] Add cloud offload status display
- [ ] Create VFS sync visualization

### Phase 6: Testing & Optimization (Week 11-12)
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Security audit
- [ ] Documentation

---

## Benefits Summary

| Capability | V1 (LLM API) | V2 (OpenCode + Nullclaw) |
|------------|--------------|--------------------------|
| **Coding Tasks** | ✅ Via tools | ✅ Native + tools |
| **Shell Commands** | ⚠️ Limited | ✅ Full bash |
| **File Operations** | ⚠️ VFS only | ✅ Direct + VFS |
| **Internet Use** | ⚠️ API calls | ✅ Native browser |
| **Messaging** | ⚠️ API integrations | ✅ Discord/Telegram native |
| **Server Automation** | ⚠️ Manual | ✅ Native + scheduled |
| **Cloud Offload** | ❌ None | ✅ Daytona/E2B |
| **Persistent Memory** | ❌ None | ✅ Session-based |
| **MCP Tools** | ✅ Pre-configured | ✅ Dynamic discovery |
| **Multi-step Tasks** | ⚠️ Manual orchestration | ✅ Automatic |

---

## Conclusion

The V2 architecture with OpenCode Engine + Nullclaw integration provides:

1. **Native Agency** - Direct bash, filesystem, and internet access
2. **Task Versatility** - Coding via OpenCode, general tasks via Nullclaw
3. **Secure Isolation** - Per-user sandboxes with network policies
4. **Cloud Scalability** - Serverless agent offload to Daytona/E2B
5. **Dynamic Tools** - MCP integration with auto-discovery
6. **Persistent Memory** - Session-based conversations with state

This architecture maintains backward compatibility with V1 while providing a powerful upgrade path for complex multi-step tasks requiring genuine agency.
