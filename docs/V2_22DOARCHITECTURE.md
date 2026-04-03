# OpenSandbox V2 Agent Mode Integration Architecture

## Executive Summary

This document outlines the architecture for integrating **OpenSandbox V2 Agent Mode** - a Dockerized CLI-based agent binary that provides "engine-like" capabilities including:
- Extended code execution
- Interactive sessions  
- Direct filesystem manipulation
- Memory/state persistence
- Native MCP server integration
- Shell command execution
- Skills system compatibility

This V2 architecture complements the existing V1 LLM API chat system, providing a more powerful "agent mode" for complex multi-step tasks.

---

## Current Architecture (V1)

### V1: LLM API Chat Mode
```
User Input → /api/chat → LLM Provider (OpenAI, Anthropic, etc.)
                    ↓
            Tool Detection → Sandbox Execution
                    ↓
            Response Streaming → UI
```

**Characteristics:**
- Direct LLM API calls
- Manual tool engineering
- Per-request stateless execution
- Limited to pre-defined tools
- No persistent agent memory

---

## Target Architecture (V1 + V2 Hybrid)

### V2: OpenSandbox Agent Mode
```
User Input → Agent Router → OpenSandbox Docker Container
                           ↓
                    OpenCode Binary (Agent)
                           ↓
            ┌──────────────┼──────────────┐
            ↓              ↓              ↓
      MCP Servers    Shell Commands   Filesystem
            ↓              ↓              ↓
            └──────────────┼──────────────┘
                           ↓
                    Agent Memory/State
                           ↓
                    Response → UI
```

**Characteristics:**
- Agent binary handles reasoning + execution
- Persistent sessions with memory
- Native MCP tool discovery
- Full shell access
- Filesystem operations
- Skills system integration

---

## Architecture Components

### 1. Agent Router (`lib/agent/agent-router.ts`)

**Purpose:** Route requests between V1 (LLM API) and V2 (OpenSandbox Agent) modes

```typescript
interface AgentRouterConfig {
  mode: 'v1-chat' | 'v2-agent' | 'auto';
  userId: string;
  conversationId: string;
}

class AgentRouter {
  async route(request: AgentRequest): Promise<AgentResponse> {
    // Auto-detect based on request complexity
    if (this.config.mode === 'auto') {
      if (request.requiresComplexReasoning || request.requiresMultiStep) {
        return this.routeToV2(request);
      }
      return this.routeToV1(request);
    }
    
    if (this.config.mode === 'v2-agent') {
      return this.routeToV2(request);
    }
    
    return this.routeToV1(request);
  }
}
```

**Integration Points:**
- `/api/chat` route updates to check router
- Terminal panel can switch modes
- UI indicator for active mode

---

### 2. Per-User Session Manager (`lib/sandbox/agent-session-manager.ts`)

**Purpose:** Manage isolated OpenSandbox instances per user/conversation

```typescript
interface AgentSession {
  id: string;
  userId: string;
  conversationId: string;
  sandboxHandle: OpenSandboxAgentSandboxHandle;
  createdAt: Date;
  lastActiveAt: Date;
  state: 'initializing' | 'ready' | 'busy' | 'idle';
}

class AgentSessionManager {
  private sessions = new Map<string, AgentSession>();
  
  async getOrCreateSession(userId: string, conversationId: string): Promise<AgentSession> {
    const key = `${userId}:${conversationId}`;
    
    // Return existing session if available
    const existing = this.sessions.get(key);
    if (existing && existing.state !== 'initializing') {
      return existing;
    }
    
    // Create new sandbox session
    const sandbox = await openSandboxProvider.createSandbox({
      envVars: {
        USER_ID: userId,
        CONVERSATION_ID: conversationId,
        WORKSPACE_DIR: `/workspace/users/${userId}/${conversationId}`,
      },
      labels: {
        userId,
        conversationId,
        mode: 'agent',
      },
    });
    
    const session: AgentSession = {
      id: key,
      userId,
      conversationId,
      sandboxHandle: sandbox,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      state: 'ready',
    };
    
    this.sessions.set(key, session);
    return session;
  }
  
  async cleanupIdleSessions(): Promise<void> {
    // Cleanup sessions idle for > 10 minutes
  }
}
```

**Isolation Strategy:**
- Each user gets isolated workspace: `/workspace/users/{userId}/{conversationId}`
- Separate sandbox instances prevent cross-user contamination
- Session cleanup prevents resource leaks

---

### 3. Filesystem Integration (`lib/virtual-filesystem/agent-fs-bridge.ts`)

**Purpose:** Bridge between Virtual Filesystem (VFS) and OpenSandbox filesystem

```typescript
class AgentFSBridge {
  constructor(
    private vfs: VirtualFilesystemService,
    private sessionManager: AgentSessionManager,
  ) {}
  
  async syncToSandbox(userId: string, conversationId: string): Promise<void> {
    const session = await this.sessionManager.getOrCreateSession(userId, conversationId);
    const vfsPath = `project/sessions/${conversationId}`;
    const sandboxPath = `/workspace/users/${userId}/${conversationId}`;
    
    // Export VFS snapshot
    const snapshot = await this.vfs.exportWorkspace(userId);
    
    // Sync files to sandbox
    for (const file of snapshot.files) {
      await session.sandboxHandle.writeFile(
        file.path.replace('project/', ''),
        file.content,
      );
    }
  }
  
  async syncFromSandbox(userId: string, conversationId: string): Promise<void> {
    const session = await this.sessionManager.getOrCreateSession(userId, conversationId);
    
    // Get list of files in sandbox
    const listResult = await session.sandboxHandle.executeCommand(
      'find /workspace -type f',
    );
    
    // Sync changed files back to VFS
    const files = listResult.output.split('\n').filter(Boolean);
    for (const file of files) {
      const content = await session.sandboxHandle.readFile(file);
      await this.vfs.writeFile(
        userId,
        file.replace('/workspace/', 'project/'),
        content.output,
      );
    }
  }
}
```

**Sync Strategy:**
- Bidirectional sync on session start/end
- VFS is source of truth for persistence
- Sandbox is working directory for agent

---

### 4. MCP Integration (`lib/mcp/agent-mcp-bridge.ts`)

**Purpose:** Connect OpenSandbox agent to existing MCP servers

```typescript
class AgentMCPBridge {
  constructor(
    private mcpClient: MCPClient,
    private sessionManager: AgentSessionManager,
  ) {}
  
  async configureMCPForSession(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    
    // Get configured MCP servers from lib/mcp/config
    const mcpConfig = await loadMCPConfig();
    
    // Configure agent with MCP connection details
    const mcpEnvVars = {
      MCP_CONFIG_PATH: '/workspace/.mcp-config.json',
      ...mcpConfig.servers.reduce((acc, server) => ({
        ...acc,
        [`MCP_${server.name.toUpperCase()}_URL`]: server.url,
      }), {}),
    };
    
    // Write MCP config to sandbox
    await session.sandboxHandle.writeFile(
      '/workspace/.mcp-config.json',
      JSON.stringify(mcpConfig, null, 2),
    );
  }
  
  async callMCPServer(
    sessionId: string,
    serverName: string,
    toolName: string,
    args: any,
  ): Promise<ToolResult> {
    const session = await this.sessionManager.getSession(sessionId);
    
    // Use MCP client to call server
    const result = await this.mcpClient.callTool(serverName, toolName, args);
    
    return {
      success: true,
      output: JSON.stringify(result),
    };
  }
}
```

**MCP Integration:**
- Reuse existing `lib/mcp/*` infrastructure
- Agent can discover and call MCP tools
- Config persisted per-session

---

### 5. Agent CLI Wrapper (`lib/agent/opencode-wrapper.ts`)

**Purpose:** Wrap OpenCode binary execution in sandbox

```typescript
interface OpenCodeExecutionOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  timeout?: number;
}

class OpenCodeWrapper {
  constructor(private sessionManager: AgentSessionManager) {}
  
  async execute(sessionId: string, options: OpenCodeExecutionOptions): Promise<ToolResult> {
    const session = await this.sessionManager.getSession(sessionId);
    
    // Build opencode command
    const cmd = [
      'opencode',
      ...options.args,
      '--cwd', options.cwd,
      '--output-format', 'json',
    ].join(' ');
    
    // Execute in sandbox
    return session.sandboxHandle.executeCommand(cmd, options.cwd);
  }
  
  async runInteractive(sessionId: string, commands: string[]): Promise<ToolResult[]> {
    const session = await this.sessionManager.getSession(sessionId);
    const results: ToolResult[] = [];
    
    for (const command of commands) {
      const result = await session.sandboxHandle.executeCommand(command);
      results.push(result);
    }
    
    return results;
  }
}
```

---

### 6. Skills System Integration (`lib/skills/agent-skills.ts`)

**Purpose:** Enable agent to use existing Skills system

```typescript
class AgentSkillsIntegration {
  constructor(
    private skillsRegistry: SkillsRegistry,
    private sessionManager: AgentSessionManager,
  ) {}
  
  async loadSkillsForSession(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    const skills = await this.skillsRegistry.getAllSkills();
    
    // Write skills config to sandbox
    await session.sandboxHandle.writeFile(
      '/workspace/.skills-config.json',
      JSON.stringify({ skills }, null, 2),
    );
  }
  
  async executeSkill(
    sessionId: string,
    skillName: string,
    params: any,
  ): Promise<ToolResult> {
    const skill = await this.skillsRegistry.getSkill(skillName);
    
    if (!skill) {
      return { success: false, output: `Skill ${skillName} not found` };
    }
    
    // Execute skill commands in sandbox
    const session = await this.sessionManager.getSession(sessionId);
    const results: ToolResult[] = [];
    
    for (const step of skill.steps) {
      const result = await session.sandboxHandle.executeCommand(
        this.interpolateParams(step.command, params),
      );
      results.push(result);
    }
    
    return {
      success: results.every(r => r.success),
      output: results.map(r => r.output).join('\n'),
    };
  }
}
```

---

## API Routes

### New Routes

#### `POST /api/agent/session`
Create or get agent session for user/conversation

```typescript
// Request
{
  userId: string;
  conversationId: string;
  mode?: 'agent' | 'chat';
}

// Response
{
  sessionId: string;
  status: 'ready' | 'initializing';
  workspacePath: string;
}
```

#### `POST /api/agent/execute`
Execute command in agent session

```typescript
// Request
{
  sessionId: string;
  command: string;
  args?: string[];
  cwd?: string;
}

// Response
{
  output: string;
  exitCode: number;
  success: boolean;
}
```

#### `POST /api/agent/mcp/call`
Call MCP server tool via agent

```typescript
// Request
{
  sessionId: string;
  serverName: string;
  toolName: string;
  args: Record<string, any>;
}

// Response
{
  result: any;
  success: boolean;
}
```

#### `POST /api/agent/sync`
Sync VFS ↔ Sandbox filesystem

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

---

## Dockerfile Updates

Add OpenCode binary to runner stage:

```dockerfile
# ===========================================
# Stage 3: Runner (Updated)
# ===========================================
FROM node:20-alpine AS runner

RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    curl \
    jq \
    git \
    python3 \
    npm

WORKDIR /app

# ... existing user setup ...

# Install OpenCode agent binary
RUN curl -fsSL https://opencode.ai/install.sh | sh
ENV PATH="/root/.opencode/bin:$PATH"

# Verify installation
RUN opencode --version

# Create MCP config directory
RUN mkdir -p /workspace/.mcp && chown -R nextjs:nodejs /workspace

# ... rest of existing config ...
```

---

## Environment Variables

```bash
# OpenSandbox Configuration
OPEN_SANDBOX_BASE_URL=http://localhost:8080/v1
OPEN_SANDBOX_EXECD_BASE_URL=http://localhost:8080
OPEN_SANDBOX_API_KEY=your-api-key
OPEN_SANDBOX_EXECD_ACCESS_TOKEN=your-access-token

# Agent Mode Configuration
OPEN_SANDBOX_AGENT_IMAGE=ubuntu:22.04
OPEN_SANDBOX_AGENT_ENTRYPOINT=/bin/sh,-lc,sleep infinity
OPEN_SANDBOX_AGENT_POOL_REF=agent-pool-1
OPEN_SANDBOX_AGENT_HEALTH_CHECK=true

# Feature Flags
AGENT_MODE_ENABLED=true
AGENT_MODE_AUTO_ROUTING=true
AGENT_MODE_DEFAULT_TIMEOUT=600
```

---

## UI Integration

### Mode Selector Component

```tsx
// components/agent-mode-selector.tsx
function AgentModeSelector({ value, onChange }) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onChange('chat')}
        className={value === 'chat' ? 'active' : ''}
      >
        💬 Chat Mode
      </button>
      <button
        onClick={() => onChange('agent')}
        className={value === 'agent' ? 'active' : ''}
      >
        🤖 Agent Mode
      </button>
    </div>
  );
}
```

### Session Status Indicator

```tsx
// components/agent-session-status.tsx
function AgentSessionStatus({ sessionId, status }) {
  return (
    <div className="agent-status">
      {status === 'initializing' && <Spinner />}
      {status === 'ready' && <CheckIcon />}
      {status === 'busy' && <BusyIcon />}
      <span>{status}</span>
    </div>
  );
}
```

---

## Migration Path

### Phase 1: Infrastructure (Week 1-2)
- [ ] Update Dockerfile with OpenCode binary
- [ ] Implement AgentSessionManager
- [ ] Create agent router
- [ ] Add API routes

### Phase 2: Integration (Week 3-4)
- [ ] Implement VFS ↔ Sandbox bridge
- [ ] Connect MCP integration
- [ ] Add Skills system support
- [ ] Create CLI wrapper

### Phase 3: UI/UX (Week 5-6)
- [ ] Add mode selector to UI
- [ ] Implement session status indicator
- [ ] Add agent output streaming
- [ ] Create session management UI

### Phase 4: Testing & Optimization (Week 7-8)
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Security audit
- [ ] Documentation

---

## Security Considerations

1. **Sandbox Isolation**
   - Per-user workspaces
   - No cross-user file access
   - Resource limits (CPU, memory, disk)

2. **Command Sanitization**
   - All commands sanitized via `SandboxSecurityManager`
   - Path traversal prevention
   - Command injection prevention

3. **MCP Server Access**
   - MCP servers configured per-session
   - Access tokens scoped to user
   - Audit logging for all MCP calls

4. **Session Cleanup**
   - Automatic cleanup after timeout
   - Resource reclamation
   - Data purge on session destroy

---

## Benefits Over V1

| Feature | V1 (LLM API) | V2 (OpenSandbox Agent) |
|---------|--------------|------------------------|
| Reasoning | LLM-dependent | Native agent reasoning |
| Multi-step | Manual orchestration | Automatic |
| Memory | Per-request | Persistent session |
| Tools | Pre-defined only | Dynamic MCP discovery |
| Shell Access | Limited | Full access |
| Filesystem | VFS only | Direct + VFS sync |
| Skills | API calls | Native execution |
| Interactive | No | Yes |
| State | Stateless | Stateful |

---

## Conclusion

The V2 Agent Mode integration provides a powerful complement to the existing V1 LLM API system, enabling:
- More complex multi-step tasks
- Persistent agent memory
- Native tool discovery via MCP
- Full shell and filesystem access
- Skills system integration

The hybrid architecture allows gradual migration and mode selection based on task complexity.
