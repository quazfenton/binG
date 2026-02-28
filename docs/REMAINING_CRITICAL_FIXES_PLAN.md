# Remaining Critical Fixes - Implementation Plan

**Date**: 2026-02-28  
**Status**: 📋 **PLANNED**  
**Priority**: HIGH

---

## Completed Fixes (7/47)

### ✅ E2B Desktop Provider (4/4)
- [x] Session ID support for AMP conversations
- [x] MCP integration for 200+ Docker tools
- [x] Schema-validated output
- [x] Custom system prompts (CLAUDE.md)

**Files**:
- `lib/sandbox/providers/e2b-desktop-provider-enhanced.ts` (NEW - 550 lines)

### ✅ Security Fixes (3/3)
- [x] Path traversal double-encoding protection
- [x] Unicode homoglyph detection in commands
- [x] Unicode homoglyph detection in paths

**Files**:
- `lib/sandbox/sandbox-tools.ts` (MODIFIED - +60 lines)

### ✅ Daytona Services (2/2)
- [x] LSP Service for code intelligence
- [x] Object Storage for large files

**Files**:
- `lib/sandbox/providers/daytona-lsp-service.ts` (NEW - 300 lines)
- `lib/sandbox/providers/daytona-object-storage-service.ts` (NEW - 350 lines)
- `lib/sandbox/providers/daytona-provider.ts` (MODIFIED - +50 lines)

---

## Pending Critical Fixes (40/47)

### Sprites Provider (3 issues)

#### 1. Auto-Suspend with Memory State Preservation
**File**: `lib/sandbox/providers/sprites-provider.ts`

**Required Changes**:
```typescript
interface SpriteService {
  name: string
  command: string
  args?: string[]
  port?: number
  autoStart: boolean
  autoStop: 'suspend' | 'stop'  // CRITICAL: 'suspend' preserves memory
}

class SpritesSandboxHandle {
  async configureService(config: SpriteService): Promise<ServiceInfo> {
    // Use sprite-env CLI to create service with auto-suspend
    const result = await this.sprite.execFile('sprite-env', [
      'services',
      'create',
      config.name,
      '--cmd',
      config.command,
      ...(config.args ? ['--args', ...config.args] : []),
      ...(config.port ? ['--port', config.port.toString()] : []),
      '--auto-start',
      config.autoStop === 'suspend' ? '--auto-suspend' : '--auto-stop',
    ])
    
    return {
      id: config.name,
      name: config.name,
      status: 'running',
      port: config.port,
    }
  }
  
  async getServiceStatus(serviceName: string): Promise<{
    status: 'running' | 'stopped' | 'suspended' | 'unknown'
    port?: number
    url?: string
    lastStarted?: string
    restartCount?: number
  }> {
    const result = await this.sprite.execFile('sprite-env', [
      'services',
      'status',
      serviceName,
    ])
    
    return JSON.parse(result.stdout)
  }
  
  async restartService(serviceName: string): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      await this.sprite.execFile('sprite-env', [
        'services',
        'restart',
        serviceName,
      ])
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
```

**Documentation Reference**: `sprites-llms-full.txt` lines 200-250

---

#### 2. HTTP Service Configuration
**File**: `lib/sandbox/providers/sprites-provider.ts`

**Required Changes**:
```typescript
class SpritesSandboxHandle {
  async configureHttpService(port?: number): Promise<{
    success: boolean
    url: string
    message?: string
  }> {
    try {
      // Auto-detect port if not specified
      const result = await this.sprite.execFile('sprite-env', [
        'http',
        'configure',
        ...(port ? [port.toString()] : ['--auto-detect']),
      ])
      
      const config = JSON.parse(result.stdout)
      return {
        success: true,
        url: config.url,
        message: config.message,
      }
    } catch (error: any) {
      return {
        success: false,
        url: '',
        message: error.message,
      }
    }
  }
}
```

**Documentation Reference**: `sprites-llms-full.txt` lines 300-350

---

#### 3. Checkpoint Manager Metadata/Tags
**File**: `lib/sandbox/providers/sprites-checkpoint-manager.ts`

**Required Changes**:
```typescript
interface CheckpointMetadata {
  tags?: string[]
  comment?: string
  gitSha?: string
  environment?: string
  createdAt: string
  createdBy?: string
}

class SpritesCheckpointManager {
  async createCheckpoint(
    name?: string,
    options: {
      tags?: string[]
      comment?: string
      metadata?: CheckpointMetadata
    } = {}
  ): Promise<CheckpointInfo> {
    const checkpoint = await this.sprite.checkpoint.create(name)
    
    // Add metadata/tags
    if (options.tags || options.comment || options.metadata) {
      await this.sprite.execFile('sprite-checkpoint', [
        'update',
        checkpoint.id,
        ...(options.tags ? ['--tags', options.tags.join(',')] : []),
        ...(options.comment ? ['--comment', options.comment] : []),
        ...(options.metadata ? ['--metadata', JSON.stringify(options.metadata)] : []),
      ])
    }
    
    return checkpoint
  }
  
  async listCheckpoints(filters?: {
    tags?: string[]
    limit?: number
    sortBy?: 'createdAt' | 'name'
    order?: 'asc' | 'desc'
  }): Promise<CheckpointInfo[]> {
    const args = ['checkpoint', 'list']
    
    if (filters?.tags) {
      args.push('--tags', filters.tags.join(','))
    }
    if (filters?.limit) {
      args.push('--limit', filters.limit.toString())
    }
    if (filters?.sortBy) {
      args.push('--sort', filters.sortBy)
    }
    if (filters?.order) {
      args.push('--order', filters.order)
    }
    
    const result = await this.sprite.execFile('sprite', args)
    return JSON.parse(result.stdout)
  }
  
  async getStorageStats(): Promise<{
    usedBytes: number
    totalBytes: number
    checkpointCount: number
    oldestCheckpoint?: string
    newestCheckpoint?: string
  }> {
    const result = await this.sprite.execFile('sprite', [
      'checkpoint',
      'stats',
    ])
    return JSON.parse(result.stdout)
  }
}
```

**Documentation Reference**: `sprites-llms-full.txt` lines 400-500

---

### Blaxel Provider (3 issues)

#### 4. Agent-to-Agent Calls
**File**: `lib/sandbox/providers/blaxel-provider.ts`

**Required Changes**:
```typescript
class BlaxelProvider {
  async callAgent(config: {
    targetAgent: string
    input: any
    waitForCompletion?: boolean
  }): Promise<any> {
    const client = await this.ensureClient()
    
    const response = await client.agents.call({
      name: config.targetAgent,
      input: config.input,
      waitForCompletion: config.waitForCompletion ?? true,
    })
    
    return response.output
  }
}
```

**Documentation Reference**: `blaxel-llms-full.txt` lines 600-650

---

#### 5. Scheduled Jobs
**File**: `lib/sandbox/providers/blaxel-provider.ts`

**Required Changes**:
```typescript
class BlaxelProvider {
  async scheduleJob(
    schedule: string, // Cron expression
    tasks?: BatchTask[]
  ): Promise<{ scheduleId: string }> {
    const client = await this.ensureClient()
    
    const response = await client.jobs.schedule({
      schedule,
      tasks: tasks || [],
    })
    
    return { scheduleId: response.id }
  }
  
  async cancelSchedule(scheduleId: string): Promise<void> {
    const client = await this.ensureClient()
    await client.jobs.cancelSchedule(scheduleId)
  }
}
```

**Documentation Reference**: `blaxel-llms-full.txt` lines 700-750

---

#### 6. Log Streaming
**File**: `lib/sandbox/providers/blaxel-provider.ts`

**Required Changes**:
```typescript
class BlaxelProvider {
  async streamLogs(options?: {
    follow?: boolean
    tail?: number
    since?: string
  }): Promise<AsyncIterableIterator<LogEntry>> {
    const client = await this.ensureClient()
    
    const stream = await client.logs.stream({
      follow: options?.follow ?? false,
      tail: options?.tail,
      since: options?.since,
    })
    
    return stream
  }
}
```

**Documentation Reference**: `blaxel-llms-full.txt` lines 800-850

---

### Composio Integration (1 issue)

#### 7. Session-Based Workflow
**File**: `lib/api/composio-service.ts`

**Required Changes**:
```typescript
class ComposioService {
  private sessions: Map<string, any> = new Map()
  
  async createSession(userId: string): Promise<any> {
    const session = await this.composio.create(userId)
    this.sessions.set(userId, session)
    return session
  }
  
  async getSession(userId: string): Promise<any> {
    return this.sessions.get(userId)
  }
  
  async getTools(userId: string): Promise<any[]> {
    const session = await this.getSession(userId)
    if (!session) {
      throw new Error('Session not created for user')
    }
    return session.tools()
  }
  
  async executeTool(userId: string, toolName: string, params: any): Promise<any> {
    const session = await this.getSession(userId)
    if (!session) {
      throw new Error('Session not created for user')
    }
    return session.execute(toolName, params)
  }
  
  async getMCPConfig(userId: string): Promise<{
    url: string
    headers: Record<string, string>
  }> {
    const session = await this.getSession(userId)
    if (!session) {
      throw new Error('Session not created for user')
    }
    return {
      url: session.mcp.url,
      headers: session.mcp.headers,
    }
  }
}
```

**Documentation Reference**: `composio-llms-full.txt` lines 200-300

---

## Implementation Timeline

### Week 1 (Critical Features)
- [ ] Sprites auto-suspend (1 day)
- [ ] Sprites HTTP service (1 day)
- [ ] Sprites checkpoint metadata (1 day)
- [ ] Blaxel agent-to-agent (1 day)
- [ ] Blaxel scheduled jobs (1 day)
- [ ] Blaxel log streaming (1 day)
- [ ] Composio session workflow (1 day)

### Week 2 (Security & Error Handling)
- [ ] Auth token invalidation
- [ ] Computer Use auth logging
- [ ] MCP token exposure prevention
- [ ] Sandbox escape detection
- [ ] Credential leakage prevention
- [ ] Error handling improvements (7 issues)

### Week 3-4 (Architecture & Performance)
- [ ] Provider code duplication
- [ ] Health check interface
- [ ] Connection pooling
- [ ] Response caching
- [ ] Documentation updates

---

## Testing Plan

### Sprites Testing
```typescript
// Test auto-suspend
const service = await sprite.configureService({
  name: 'test-server',
  command: 'node',
  args: ['server.js'],
  port: 3000,
  autoStart: true,
  autoStop: 'suspend', // Should preserve memory
})

const status = await sprite.getServiceStatus('test-server')
expect(status.status).toBe('suspended')

// Test HTTP service
const httpConfig = await sprite.configureHttpService(8080)
expect(httpConfig.url).toContain('.sprites.app')

// Test checkpoint metadata
const checkpoint = await checkpointManager.createCheckpoint('test', {
  tags: ['test', 'critical'],
  comment: 'Test checkpoint',
  metadata: { gitSha: 'abc123' },
})

const checkpoints = await checkpointManager.listCheckpoints({
  tags: ['test'],
  limit: 5,
})
expect(checkpoints.length).toBeGreaterThan(0)
```

### Blaxel Testing
```typescript
// Test agent-to-agent
const response1 = await blaxel.callAgent({
  targetAgent: 'research-agent',
  input: 'Research AI trends',
  waitForCompletion: true,
})

const response2 = await blaxel.callAgent({
  targetAgent: 'writing-agent',
  input: response1,
  waitForCompletion: true,
})

// Test scheduled jobs
const schedule = await blaxel.scheduleJob('0 9 * * *', [
  { id: 'daily-report', data: { type: 'daily' } },
])
expect(schedule.scheduleId).toBeDefined()

// Test log streaming
const logStream = await blaxel.streamLogs({
  follow: true,
  tail: 100,
})

for await (const log of logStream) {
  console.log(`[${log.timestamp}] ${log.level}: ${log.message}`)
}
```

### Composio Testing
```typescript
// Test session workflow
const session = await composioService.createSession('user-123')
const tools = await composioService.getTools('user-123')
expect(tools.length).toBeGreaterThan(0)

const result = await composioService.executeTool(
  'user-123',
  'github_create_issue',
  { title: 'Bug', body: 'Found bug...' }
)

const mcpConfig = await composioService.getMCPConfig('user-123')
expect(mcpConfig.url).toBeDefined()
expect(mcpConfig.headers).toBeDefined()
```

---

## Success Criteria

### Sprites
- ✅ Services auto-suspend with memory preservation
- ✅ HTTP service configuration works
- ✅ Checkpoints support metadata/tags/filters

### Blaxel
- ✅ Agent-to-agent calls work
- ✅ Scheduled jobs can be created/cancelled
- ✅ Log streaming works in real-time

### Composio
- ✅ Session-based tool discovery
- ✅ Session-based tool execution
- ✅ MCP config retrieval

---

**Next Steps**: Begin Sprites implementation (3 issues, 3 days)  
**Estimated Completion**: 2 weeks for all critical fixes
