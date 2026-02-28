# Blaxel & Fly.io Sprites Integration - Complete Guide

## Executive Summary

**Status:** ✅ **PRODUCTION-READY**  
**Implementation Date:** 2026-02-27  
**Last Updated:** 2026-02-27

This document provides the complete technical architecture, implementation details, and usage guide for Blaxel and Fly.io Sprites sandbox provider integration.

---

## Table of Contents

1. [Provider Overview](#provider-overview)
2. [Architecture](#architecture)
3. [Implementation](#implementation)
4. [Advanced Features](#advanced-features)
5. [Usage Guide](#usage-guide)
6. [Environment Configuration](#environment-configuration)
7. [Troubleshooting](#troubleshooting)

---

## Provider Overview

### Blaxel Sandboxes

**Core Strengths:**
- **Ultra-fast resume**: <25ms from standby with full memory state preservation
- **Auto scale-to-zero**: No cost when idle, instant deployment
- **Persistent volumes**: Mount persistent storage for stateful workloads
- **VPC integration**: Private networking with egress gateways
- **Lifecycle policies**: TTL-based idle detection with configurable actions
- **Batch jobs**: Parallel task execution with configurable concurrency
- **Async execution**: Long-running tasks (up to 15 min) with webhook callbacks
- **Agent handoffs**: Multi-agent orchestration via `blAgent().run()`

**Best Use Cases:**
- AI code execution with fast iteration cycles
- Stateless batch processing with quick turnaround
- Development/testing environments needing rapid spin-up
- Workloads requiring VPC isolation
- Long-running background jobs with callbacks

**API Characteristics:**
- REST API: `POST https://api.blaxel.ai/v0/sandboxes`
- Authentication: OAuth2 JWT or API Key via `Authorization: Bearer <token>`
- SDK: `@blaxel/sdk`, `@blaxel/core`

### Fly.io Sprites

**Core Strengths:**
- **True persistence**: ext4 filesystem persists indefinitely between sessions
- **Hardware isolation**: Dedicated microVM with hardware-level security
- **Checkpoint system**: Snapshot filesystem state for rollbacks
- **Auto-hibernation**: Sleeps after 30s inactivity, wakes on HTTP/command in <500ms
- **Full Linux environment**: Install any packages, full apt access
- **Public URLs**: Every Sprite gets `https://<name>.sprites.app`
- **Session management**: Detachable TTY sessions that survive disconnects
- **Services**: Auto-restart processes on wake (perfect for dev servers)
- **SSHFS mounting**: Mount Sprite filesystem locally for IDE integration
- **Port forwarding**: Access Sprite services from local machine

**Best Use Cases:**
- Long-lived development environments
- AI agents working on same codebase over days
- CI/CD runners with warm caches
- Stateful services that auto-suspend
- Computer use agents needing persistent GUI state
- Local IDE integration with remote filesystem

**SDK Characteristics:**
- Package: `@fly/sprites` (zero dependencies, Node.js 24+)
- Authentication: Token from `sprites.dev/account` or `sprite org auth`
- API: Promise-based with streaming support via `spawn()`
- Three execution modes: `exec()` (promise), `execFile()` (direct), `spawn()` (streaming)

### Strategic Positioning in Fallback Chain

**Updated Fallback Chain:**
```
daytona → runloop → blaxel → sprites → microsandbox → e2b → mistral
```

**Rationale:**
- **Blaxel** positioned after runloop: Cloud-native, fast, good for production workloads
- **Sprites** positioned after blaxel: Persistent, ideal for stateful/long-running tasks
- Both providers offer unique capabilities not available in existing providers

---

## Architecture

### Provider Abstraction

Both providers implement the `SandboxProvider` interface with extended capabilities:

```typescript
export interface SandboxHandle {
  // Core methods
  executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult>
  writeFile(filePath: string, content: string): Promise<ToolResult>
  readFile(filePath: string): Promise<ToolResult>
  listDirectory(dirPath: string): Promise<ToolResult>
  getPreviewLink?(port: number): Promise<PreviewInfo>
  
  // Extended capabilities (provider-specific)
  getProviderInfo?(): Promise<ProviderInfo>
  createCheckpoint?(name?: string): Promise<CheckpointInfo>
  restoreCheckpoint?(checkpointId: string): Promise<void>
  listCheckpoints?(): Promise<CheckpointInfo[]>
  createService?(config: ServiceConfig): Promise<ServiceInfo>
  listServices?(): Promise<ServiceInfo[]>
  listSessions?(): Promise<SessionInfo[]>
  attachSession?(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle>
  
  // Blaxel-specific
  runBatchJob?(tasks: BatchTask[], config?: BatchJobConfig): Promise<BatchJobResult>
  scheduleJob?(schedule: string, tasks?: BatchTask[]): Promise<{ scheduleId: string }>
  executeAsync?(config: AsyncExecutionConfig): Promise<AsyncExecutionResult>
  callAgent?(config: { targetAgent: string; input: any }): Promise<any>
  
  // Sprites-specific
  createProxy?(config: ProxyConfig): Promise<{ pid: number; url: string }>
  getPublicUrl?(): Promise<string>
  updateUrlAuth?(mode: 'public' | 'default'): Promise<void>
  createEnvService?(config: EnvServiceConfig): Promise<ServiceInfo>
  listEnvServices?(): Promise<ServiceInfo[]>
  removeEnvService?(name: string): Promise<void>
  upgrade?(): Promise<void>
  killSession?(sessionId: string): Promise<void>
}
```

### Integration Points

1. **Provider Registry** - `lib/sandbox/providers/index.ts`
2. **Quota Manager** - `lib/services/quota-manager.ts`
3. **Core Sandbox Service** - `lib/sandbox/core-sandbox-service.ts`
4. **Environment Variables** - `env.example`

---

## Implementation

### Installation

```bash
npm install @blaxel/sdk @blaxel/core @fly/sprites
```

**Note:** Sprites SDK requires Node.js 24.0.0+.

### Provider Implementations

- **Blaxel:** `lib/sandbox/providers/blaxel-provider.ts`
- **Sprites:** `lib/sandbox/providers/sprites-provider.ts`
- **SSHFS Helper:** `lib/sandbox/providers/sprites-sshfs.ts`
- **MCP Server:** `lib/sandbox/providers/blaxel-mcp-server.ts`
- **Rate Limiter:** `lib/sandbox/providers/rate-limiter.ts`

### Quota Management

Default quotas (configurable via env vars):

| Provider | Monthly Quota | Unit |
|----------|---------------|------|
| Blaxel | 5,000 | sessions |
| Sprites | 2,000 | hours |

Override in `.env.local`:
```bash
QUOTA_BLAXEL_MONTHLY=10000
QUOTA_SPRITES_MONTHLY=5000
```

---

## Advanced Features

### 1. SSHFS Mount Helper (Sprites)

Mount Sprite filesystem locally for seamless IDE integration.

**Requirements:**
- SSHFS installed: `brew install macfuse sshfs` (macOS) or `apt-get install sshfs` (Linux)

**Usage:**
```typescript
import { mountSpriteSSHFS } from '@/lib/sandbox/providers'

const mount = await mountSpriteSSHFS({
  spriteName: 'my-dev-sprite',
  mountPoint: '/tmp/sprite-mount',
  autoInstallSSH: true,
})

// Edit files in /tmp/sprite-mount with local IDE
// Changes sync to Sprite in real-time

await mount.unmount()
```

**Features:**
- Automatic SSH server installation on Sprite
- SSH key authorization
- SSH tunnel management
- Proper cleanup on unmount

### 2. MCP Server Integration (Blaxel)

Expose Blaxel sandbox as MCP tools for AI assistants (Cursor, Claude Desktop).

**Requirements:**
- `npm install @modelcontextprotocol/sdk`

**Usage:**
```typescript
import { createBlaxelMcpServer } from '@/lib/sandbox/providers'

const handle = await blaxelProvider.createSandbox({})

// Start stdio MCP server (for AI assistants)
await createBlaxelMcpServer(handle)

// Or HTTP MCP server
const url = await createBlaxelMcpServer(handle, 3000)
// Connect: http://localhost:3000/mcp
```

**Available Tools:**
1. `execute_command` - Run shell commands
2. `write_file` - Write files
3. `read_file` - Read files
4. `list_directory` - List directories
5. `get_sandbox_info` - Get sandbox info
6. `run_batch_job` - Parallel batch execution
7. `execute_async` - Async long-running execution

### 3. Rate Limiting

Prevent abuse and manage resource usage.

**Usage:**
```typescript
import { createSandboxRateLimiter } from '@/lib/sandbox/providers'

const rateLimiter = createSandboxRateLimiter()

// Check and record
const result = await rateLimiter.checkAndRecord('user-123', 'commands')
if (!result.allowed) {
  throw new Error(result.message!)
}

// Or use Express middleware
app.post('/api/execute',
  rateLimitMiddleware(rateLimiter, 'commands'),
  handleRequest
)
```

**Default Limits:**
| Operation | Limit | Window |
|-----------|-------|--------|
| `commands` | 100 | 1 minute |
| `fileOps` | 50 | 1 minute |
| `batchJobs` | 10 | 1 minute |
| `asyncExec` | 20 | 1 minute |
| `checkpoints` | 30 | 1 minute |
| `proxy` | 5 | 1 minute |

---

## Usage Guide

### Basic Usage

```typescript
import { getSandboxProvider } from '@/lib/sandbox/providers'

// Use Blaxel
const blaxel = getSandboxProvider('blaxel')
const blaxelHandle = await blaxel.createSandbox({})
await blaxelHandle.executeCommand('npm install express')

// Use Sprites
const sprites = getSandboxProvider('sprites')
const spritesHandle = await sprites.createSandbox({})
await spritesHandle.executeCommand('npm install -g typescript')

// Automatic fallback (recommended)
const session = await sandboxBridge.getOrCreateSession(userId)
// Automatically tries: daytona → runloop → blaxel → sprites → ...
```

### Blaxel: Batch Processing

```typescript
const handle = await blaxelProvider.createSandbox({})

const results = await handle.runBatchJob([
  { id: 'task1', data: { code: 'print("hello")', language: 'python' } },
  { id: 'task2', data: { code: 'print("world")', language: 'python' } },
], {
  runtime: { maxConcurrentTasks: 5 }
})

console.log(`Completed: ${results.completedTasks}/${results.totalTasks}`)
```

### Blaxel: Async Execution

```typescript
const result = await handle.executeAsync({
  command: 'npm run build && npm test',
  callbackUrl: 'https://my-app.com/api/build-callback',
  timeout: 900000, // 15 minutes
})

// Webhook handler
app.post('/api/build-callback', async (req, res) => {
  const isValid = await BlaxelSandboxHandle.verifyCallbackSignature(
    req, process.env.BLAXEL_CALLBACK_SECRET!
  )
  if (!isValid) return res.status(401).json({ error: 'Invalid signature' })
  console.log('Build completed:', req.body)
  res.json({ received: true })
})
```

### Sprites: Checkpoints

```typescript
const handle = await spritesProvider.createSandbox({})

// Create checkpoint before risky changes
const checkpoint = await handle.createCheckpoint('before-refactor')

// Make changes
await handle.executeCommand('rm -rf node_modules && npm install')

// Something went wrong? Restore!
await handle.restoreCheckpoint(checkpoint.id)
```

### Sprites: Port Forwarding

```typescript
const handle = await spritesProvider.createSandbox({})

// Start PostgreSQL in Sprite
await handle.executeCommand('docker run -d -p 5432:5432 postgres')

// Forward to local port
const proxy = await handle.createProxy({
  localPort: 15432,
  remotePort: 5432,
})

console.log(`Database accessible at: ${proxy.url}`)
// Now connect to localhost:15432 from your local machine
```

### Sprites: Env Services

```typescript
const handle = await spritesProvider.createSandbox({})

// Create auto-restart dev server
await handle.createEnvService({
  name: 'dev-server',
  command: 'npm',
  args: ['run', 'dev'],
  workingDir: '/home/sprite/project',
  autoStart: true,
})

// Service auto-restarts when Sprite wakes from hibernation
```

---

## Environment Configuration

Add to `.env.local`:

```bash
# ===========================================
# BLAXEL SANDBOX PROVIDER
# ===========================================
BLAXEL_API_KEY=your_blaxel_api_key_here
BLAXEL_WORKSPACE=your_workspace_slug
BLAXEL_DEFAULT_REGION=us-pdx-1
BLAXEL_DEFAULT_MEMORY=4096
BLAXEL_DEFAULT_TTL=24h
QUOTA_BLAXEL_MONTHLY=5000

# Advanced Features
BLAXEL_MCP_ENABLED=true
BLAXEL_MCP_DEFAULT_PORT=3000
BLAXEL_CALLBACK_SECRET=your-64-char-secret-here

# ===========================================
# FLY.IO SPRITES PROVIDER
# ===========================================
SPRITES_TOKEN=your_sprites_api_token_here
SPRITES_DEFAULT_REGION=iad
SPRITES_DEFAULT_PLAN=standard-1
SPRITES_ENABLE_CHECKPOINTS=true
SPRITES_AUTO_SERVICES=false
QUOTA_SPRITES_MONTHLY=2000

# SSHFS Mount
SPRITES_SSHFS_ENABLED=true
SPRITES_SSHFS_AUTO_INSTALL_SSH=true

# ===========================================
# RATE LIMITING
# ===========================================
SANDBOX_RATE_LIMITING_ENABLED=true
SANDBOX_RATE_LIMIT_COMMANDS_MAX=100
SANDBOX_RATE_LIMIT_FILE_OPS_MAX=50
SANDBOX_RATE_LIMIT_BATCH_JOBS_MAX=10
```

See `docs/ENV_VARIABLES_ADVANCED_QUICK_REF.md` for complete list.

---

## Troubleshooting

### Blaxel Issues

**Error: "BLAXEL_API_KEY not configured"**
```bash
# Verify environment variable
echo $BLAXEL_API_KEY

# Add to .env.local if missing
BLAXEL_API_KEY=your_key_here
```

**Error: "Quota exceeded"**
```bash
# Check usage
# In code: quotaManager.getUsagePercent('blaxel')

# Wait for monthly reset or increase quota
export QUOTA_BLAXEL_MONTHLY=10000
```

### Sprites Issues

**Error: "SPRITES_TOKEN not configured"**
```bash
# Verify environment variable
echo $SPRITES_TOKEN

# Re-authenticate if needed
sprite org auth
```

**Error: "Node.js 24+ required"**
```bash
# Check Node version
node --version

# Upgrade Node.js if needed
# https://nodejs.org/en/download/
```

**SSHFS Mount Issues**
```bash
# Check if SSHFS is installed
sshfs --version

# Install if needed
# macOS: brew install macfuse sshfs
# Linux: sudo apt-get install sshfs
```

### Rate Limiting Issues

**Error: "Rate limit exceeded"**
```bash
# Wait for window to reset
# Or increase limits in .env.local
SANDBOX_RATE_LIMIT_COMMANDS_MAX=200
```

---

## Additional Resources

- **Advanced Features Guide:** `docs/ADVANCED_FEATURES_IMPLEMENTATION.md`
- **Environment Variables:** `docs/ENV_VARIABLES_ADVANCED_QUICK_REF.md`
- **Usage Guide:** `docs/sdk/BLAXEL_SPRITES_USAGE_GUIDE.md`
- **Blaxel Docs:** https://docs.blaxel.ai/
- **Sprites Docs:** https://docs.sprites.dev/

---

**Document Version:** 2.0 (Consolidated)  
**Last Updated:** 2026-02-27  
**Status:** ✅ Production-Ready

---

## 2. Architecture & Integration Points

### 2.1 Provider Abstraction Extensions

The existing `SandboxHandle` interface needs extensions for provider-specific capabilities:

```typescript
// Add to lib/sandbox/providers/sandbox-provider.ts

export interface SandboxHandle {
  // ... existing methods ...
  
  // NEW: Provider-specific capabilities
  getProviderInfo?(): Promise<ProviderInfo>
  createCheckpoint?(name?: string): Promise<CheckpointInfo>
  restoreCheckpoint?(checkpointId: string): Promise<void>
  listCheckpoints?(): Promise<CheckpointInfo[]>
  
  // NEW: Service management (Sprites-specific)
  createService?(config: ServiceConfig): Promise<ServiceInfo>
  listServices?(): Promise<ServiceInfo[]>
  
  // NEW: Session management (Sprites-specific)
  listSessions?(): Promise<SessionInfo[]>
  attachSession?(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle>
}

export interface ProviderInfo {
  provider: string
  region?: string
  status: 'running' | 'stopped' | 'hibernating' | 'failed'
  url?: string
  createdAt: string
  lastUsedAt?: string
  expiresIn?: number // seconds until auto-deletion
}

export interface CheckpointInfo {
  id: string
  name?: string
  createdAt: string
  size?: number // bytes
  comment?: string
}

export interface ServiceConfig {
  name: string
  command: string
  args?: string[]
  port?: number
  autoStart?: boolean
}

export interface ServiceInfo {
  id: string
  name: string
  status: 'running' | 'stopped'
  port?: number
  url?: string
}

export interface SessionInfo {
  id: string
  command: string
  createdAt: string
  isAttached: boolean
}
```

### 2.2 Quota Manager Integration

Add new providers to `lib/services/quota-manager.ts`:

```typescript
const DEFAULT_QUOTAS: Record<string, number> = {
  // ... existing ...
  blaxel: 5000,      // Sandbox sessions/month
  sprites: 2000,     // Sprite hours/month (adjust based on pricing)
}
```

Environment variables for quota overrides:
- `QUOTA_BLAXEL_MONTHLY` (default: 5000)
- `QUOTA_SPRITES_MONTHLY` (default: 2000)

### 2.3 Environment Variables

Add to `env.example`:

```bash
# ===========================================
# BLAXEL SANDBOX PROVIDER
# ===========================================
# Blaxel API credentials for sandbox provider
# Get API key from: https://console.blaxel.ai/settings/api-keys
# Documentation: https://docs.blaxel.ai/api-reference/compute/create-sandbox

BLAXEL_API_KEY=your_blaxel_api_key_here
BLAXEL_WORKSPACE=your_workspace_slug

# Optional: Default region for sandbox deployment
BLAXEL_DEFAULT_REGION=us-pdx-1

# Optional: Default runtime image
BLAXEL_DEFAULT_IMAGE=blaxel/base-image:latest

# Optional: Default memory in MB
BLAXEL_DEFAULT_MEMORY=4096

# Optional: TTL for sandboxes (e.g., "24h", "7d")
BLAXEL_DEFAULT_TTL=24h

# Optional: Enable VPC networking
BLAXEL_VPC_NAME=your-vpc-name
BLAXEL_EGRESS_GATEWAY_NAME=your-egress-gateway

# ===========================================
# FLY.IO SPRITES PROVIDER
# ===========================================
# Sprites API token for sandbox provider
# Generate token at: https://sprites.dev/account
# Or use CLI: sprite org auth

SPRITES_TOKEN=your_sprites_api_token_here

# Optional: Default organization
SPRITES_ORG=personal

# Optional: Default region for Sprite deployment
SPRITES_DEFAULT_REGION=iad

# Optional: Default plan (standard-1, standard-2, performance-1, etc.)
SPRITES_DEFAULT_PLAN=standard-1

# Optional: Enable checkpointing for stateful workloads
SPRITES_ENABLE_CHECKPOINTS=true

# Optional: Auto-create services for common ports
SPRITES_AUTO_SERVICES=false

# Optional: Mount filesystem locally via SSHFS (advanced)
SPRITES_ENABLE_SSHFS=false
```

---

## 3. Implementation Details

### 3.1 File Structure

```
lib/sandbox/providers/
├── sandbox-provider.ts       # Core interfaces (extend these)
├── microsandbox-provider.ts  # Existing provider (reference)
├── blaxel-provider.ts        # NEW: Blaxel implementation
└── sprites-provider.ts       # NEW: Fly.io Sprites implementation

lib/sandbox/
├── providers/
├── core-sandbox-service.ts   # Update fallback chain
└── ...

data/
└── provider-quotas.json      # Auto-updated with new providers
```

### 3.2 Key Implementation Patterns

Both providers should follow these patterns from the existing architecture:

1. **Lazy SDK loading**: Dynamic imports to avoid build errors when deps aren't installed
2. **Instance caching**: Map-based handle caching with TTL cleanup
3. **Command sanitization**: Security validation before execution
4. **Path resolution**: Prevent path traversal attacks
5. **Quota tracking**: Record usage on sandbox creation
6. **Error handling**: Graceful degradation with informative messages

### 3.3 Blaxel-Specific Considerations

- **API-first approach**: All operations via REST API calls
- **No PTY support**: Blaxel sandboxes don't support interactive terminals
- **Volume mounting**: Use persistent volumes for stateful data
- **Lifecycle policies**: Configure TTL-based auto-cleanup
- **VPC networking**: Optional private networking for enterprise use

### 3.4 Sprites-Specific Considerations

- **Persistence model**: Sprites persist indefinitely; handles are ephemeral
- **Reconnection logic**: `getSandbox()` should reconnect to existing Sprites
- **Checkpoint system**: Implement filesystem snapshots for rollbacks
- **Service management**: Auto-start dev servers on wake
- **Session detach/attach**: Support long-running TTY sessions

---

## 4. Integration Checklist

### 4.1 Provider Registration

Update `lib/sandbox/providers/index.ts` (create if doesn't exist):

```typescript
export { MicrosandboxProvider } from './microsandbox-provider'
export { BlaxelProvider } from './blaxel-provider'
export { SpritesProvider } from './sprites-provider'
// ... other providers

export type SandboxProviderType = 
  | 'daytona' 
  | 'runloop' 
  | 'microsandbox' 
  | 'e2b' 
  | 'mistral'
  | 'blaxel'      // NEW
  | 'sprites'     // NEW

export function getSandboxProvider(type: SandboxProviderType): SandboxProvider {
  switch (type) {
    case 'blaxel':
      return new BlaxelProvider()
    case 'sprites':
      return new SpritesProvider()
    // ... existing cases
  }
}
```

### 4.2 Core Service Updates

Update `lib/sandbox/core-sandbox-service.ts`:

```typescript
// Update getCandidateProviderTypes to include new providers
private getCandidateProviderTypes(primary: SandboxProviderType): SandboxProviderType[] {
  const quotaChain = quotaManager.getSandboxProviderChain(primary) as SandboxProviderType[];
  const preferred = Array.from(new Set(quotaChain.length ? quotaChain : [primary]));
  const supported: SandboxProviderType[] = [];

  for (const providerType of preferred) {
    try {
      getSandboxProvider(providerType);
      supported.push(providerType);
    } catch {
      // Provider not integrated in this build, skip.
    }
  }

  return supported.length ? supported : [primary];
}

// Update resolveProviderForSandbox to handle new provider ID patterns
private inferProviderFromSandboxId(sandboxId: string): SandboxProviderType | null {
  if (sandboxId.startsWith('mistral-')) return 'mistral'
  if (sandboxId.startsWith('blaxel-')) return 'blaxel'      // NEW
  if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites' // NEW
  return null
}

// Update all configured providers list
const allProviderTypes: SandboxProviderType[] = [
  'daytona', 
  'runloop', 
  'blaxel',      // NEW
  'sprites',     // NEW
  'microsandbox', 
  'e2b', 
  'mistral'
]
```

### 4.3 Quota Manager Updates

Update `lib/services/quota-manager.ts`:

```typescript
const DEFAULT_QUOTAS: Record<string, number> = {
  composio: 20000,
  arcade: 10000,
  nango: 10000,
  daytona: 5000,
  runloop: 5000,
  microsandbox: 10000,
  e2b: 1000,
  mistral: 2000,
  blaxel: 5000,      // NEW
  sprites: 2000,     // NEW
};

// Update getSandboxProviderChain
getSandboxProviderChain(primary: string): string[] {
  const explicitChains: Record<string, string[]> = {
    daytona: ['daytona', 'runloop', 'blaxel', 'sprites', 'microsandbox', 'e2b', 'mistral'],
    runloop: ['runloop', 'blaxel', 'sprites', 'daytona', 'microsandbox', 'e2b', 'mistral'],
    blaxel: ['blaxel', 'sprites', 'runloop', 'daytona', 'microsandbox', 'e2b', 'mistral'], // NEW
    sprites: ['sprites', 'blaxel', 'runloop', 'daytona', 'microsandbox', 'e2b', 'mistral'], // NEW
    microsandbox: ['microsandbox', 'runloop', 'blaxel', 'sprites', 'daytona', 'e2b', 'mistral'],
    e2b: ['e2b', 'daytona', 'runloop', 'blaxel', 'sprites', 'microsandbox', 'mistral'],
    mistral: ['mistral', 'microsandbox', 'blaxel', 'sprites', 'runloop', 'daytona', 'e2b'],
  };
  // ... rest of method
}
```

---

## 5. Advanced Features & Future Enhancements

### 5.1 Blaxel Advanced Features

#### 5.1.1 Asynchronous Triggers
Blaxel supports async execution with callbacks for long-running tasks:

```typescript
// Create async trigger for 15-minute executions
const asyncSandbox = await client.sandboxes.create({
  metadata: { name: 'async-worker' },
  spec: {
    // ... config
    lifecycle: {
      expirationPolicies: [{
        type: 'ttl-idle',
        action: 'delete',
        value: '15m'
      }]
    }
  }
});

// Set up callback webhook
const result = await fetch(`${asyncSandbox.metadata.url}/callback`, {
  method: 'POST',
  body: JSON.stringify({ command: 'long-running-task' })
});
```

#### 5.1.2 MCP Server Integration
Blaxel can wrap sandboxes as MCP (Model Context Protocol) servers:

```bash
# Initialize MCP server
bl new mcp
bl deploy
# Endpoint: https://run.blaxel.ai/{workspace}/functions/{name}/mcp
```

#### 5.1.3 Virtual Filesystem Sync
Bootstrap pattern for syncing VFS to Blaxel:

```typescript
async function syncFilesystemToBlaxel(sandbox: any, files: Array<{path: string, content: string}>) {
  for (const file of files) {
    await sandbox.fs.write(file.path, file.content);
  }
}
```

### 5.2 Sprites Advanced Features

#### 5.2.1 Checkpoint System
Save and restore filesystem state:

```typescript
// Create checkpoint before risky operation
const checkpoint = await sprite.createCheckpoint('pre-refactor');
console.log(`Checkpoint ID: ${checkpoint.id}`);

// Restore if needed
await sprite.restore(checkpoint.id);

// List checkpoints
const checkpoints = await sprite.listCheckpoints();
```

#### 5.2.2 Services for Auto-Resume
Configure services that auto-start on wake:

```typescript
// Create service for dev server
await sprite.services.create('dev-server', {
  command: 'npm',
  args: ['run', 'dev'],
  port: 3000,
  autoStart: true
});

// Service auto-restarts when Sprite wakes from hibernation
```

#### 5.2.3 Detachable Sessions
Long-running TTY sessions:

```typescript
// Create detachable session
const session = await sprite.createSession('bash', ['-c', 'npm run dev']);
const sessionId = session.id;

// Disconnect (session keeps running)
await session.disconnect();

// Later, reattach
const reattached = await sprite.attachSession(sessionId);
```

#### 5.2.4 Tar-Pipe VFS Sync
Efficient bulk file sync:

```typescript
import archiver from 'archiver';
import { PassThrough } from 'stream';

async function syncVfsToSprite(sprite: any, files: Array<{path: string, content: string}>) {
  const archive = archiver('tar', { gzip: true });
  const stream = new PassThrough();
  archive.pipe(stream);

  files.forEach(file => {
    archive.append(file.content, { name: file.path });
  });
  archive.finalize();

  await sprite.exec('mkdir -p /workspace && tar -xz -C /workspace', {
    stdin: stream
  });
}
```

#### 5.2.5 SSHFS Mount (Advanced)
Mount Sprite filesystem locally:

```bash
# Install SSH server on Sprite
sprite exec sudo apt install -y openssh-server
sprite-env services create sshd --cmd /usr/sbin/sshd

# Local SSHFS mount (see docs for full setup)
sshfs -o reconnect sprite@localhost:/home/sprite /tmp/sprite-mount -p 2000
```

### 5.3 Modular Optional Features

Both providers support optional features that can be enabled via configuration:

| Feature | Blaxel | Sprites | Use Case |
|---------|--------|---------|----------|
| Persistent Storage | ✓ (Volumes) | ✓ (Native) | Stateful workloads |
| Checkpoints | ✗ | ✓ | Rollback safety |
| Auto-hibernation | ✓ | ✓ | Cost optimization |
| VPC Networking | ✓ | ✗ | Enterprise isolation |
| Public URLs | ✓ | ✓ | Webhook testing |
| PTY Sessions | ✗ | ✓ | Interactive dev |
| MCP Integration | ✓ | ✗ | AI tool servers |
| Async Triggers | ✓ | ✗ | Long-running tasks |

---

## 6. Testing Strategy

### 6.1 Unit Tests

```typescript
// __tests__/blaxel-provider.test.ts
describe('BlaxelProvider', () => {
  it('should create sandbox with correct config', async () => {
    const provider = new BlaxelProvider();
    const handle = await provider.createSandbox({
      language: 'typescript',
      envVars: { NODE_ENV: 'test' }
    });
    expect(handle.id).toMatch(/^sandbox-/);
  });

  it('should execute command in sandbox', async () => {
    const result = await handle.executeCommand('echo "hello"');
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });
});

// __tests__/sprites-provider.test.ts
describe('SpritesProvider', () => {
  it('should create persistent Sprite', async () => {
    const provider = new SpritesProvider();
    const handle = await provider.createSandbox({});
    expect(handle.id).toMatch(/^bing-/);
  });

  it('should support checkpoints', async () => {
    const checkpoint = await handle.createCheckpoint('test');
    expect(checkpoint.id).toBeDefined();
  });
});
```

### 6.2 Integration Tests

```typescript
// __tests__/sandbox-fallback.test.ts
describe('Sandbox Fallback Chain', () => {
  it('should fallback to blaxel when daytona fails', async () => {
    // Mock daytona to fail
    // Verify blaxel is tried next
  });

  it('should fallback to sprites when blaxel quota hit', async () => {
    // Mock blaxel quota exceeded
    // Verify sprites is tried next
  });
});
```

### 6.3 E2E Tests

```typescript
// __tests__/e2e/sandbox-e2e.test.ts
describe('E2E Sandbox Workflow', () => {
  it('should complete full coding agent workflow with blaxel', async () => {
    // Create workspace
    // Execute code
    // Verify output
    // Cleanup
  });

  it('should persist state across sessions with sprites', async () => {
    // Create Sprite
    // Install packages
    // Disconnect
    // Reconnect
    // Verify packages still installed
  });
});
```

---

## 7. Deployment & Operations

### 7.1 Prerequisites

```bash
# Install dependencies
npm install @blaxel/sdk @fly/sprites

# Set environment variables
export BLAXEL_API_KEY=your_key_here
export BLAXEL_WORKSPACE=your_workspace
export SPRITES_TOKEN=your_token_here

# Verify Blaxel authentication
curl -H "Authorization: Bearer $BLAXEL_API_KEY" \
  https://api.blaxel.ai/v0/sandboxes

# Verify Sprites authentication
npx sprite list
```

### 7.2 Monitoring & Observability

Add logging hooks for debugging:

```typescript
// Add to both providers
console.log(`[${provider}] Operation: ${operation}, Sandbox: ${sandboxId}, Duration: ${duration}ms`);

// Track quota usage
const remaining = quotaManager.getRemainingCalls('blaxel');
console.log(`[Quota] Blaxel: ${remaining} calls remaining this month`);
```

### 7.3 Error Handling & Recovery

Common error scenarios:

| Error | Cause | Recovery |
|-------|-------|----------|
| `BLAXEL_API_KEY not configured` | Missing env var | Set `BLAXEL_API_KEY` |
| `Sprites SDK not available` | Dep not installed | `npm install @fly/sprites` |
| `Quota exceeded` | Monthly limit hit | Wait for reset or upgrade plan |
| `Timeout` | Command too slow | Increase timeout or optimize command |
| `Path traversal detected` | Security violation | Review file paths in request |

---

## 8. Performance Optimization

### 8.1 Blaxel Optimizations

- **Warm sandboxes**: Keep sandboxes warm for frequently used workloads
- **Batch operations**: Use Blaxel's batch API for multiple file operations
- **VPC peering**: Reduce latency with VPC networking for enterprise deployments

### 8.2 Sprites Optimizations

- **Checkpoint caching**: Use checkpoints to skip repetitive setup
- **Service preloading**: Auto-start common services on wake
- **Tar-pipe sync**: Bulk file operations via tar streaming

### 8.3 General Optimizations

- **Handle caching**: Reuse sandbox handles across requests
- **Lazy initialization**: Only initialize SDK when first used
- **Graceful degradation**: Fallback to local execution if all providers fail

---

## 9. Security Considerations

### 9.1 Command Injection Prevention

Both providers implement command sanitization:

```typescript
private sanitizeCommand(command: string): string {
  const dangerousChars = /[;`$(){}[\]!#~\\]/;
  if (dangerousChars.test(command)) {
    throw new Error('Command contains disallowed characters');
  }
  return command;
}
```

### 9.2 Path Traversal Prevention

```typescript
private resolvePath(filePath: string): string {
  if (filePath.includes('..')) {
    throw new Error('Path traversal detected');
  }
  // Additional validation...
}
```

### 9.3 Secret Management

- **Blaxel**: Mark env vars as `secret: true` for secure storage
- **Sprites**: Use environment variables (persist in Sprite config)
- **Both**: Never log sensitive values

### 9.4 Network Security

- **Blaxel**: Optional VPC isolation for enterprise deployments
- **Sprites**: Private by default, public URLs require explicit opt-in
- **Both**: TLS encryption for all API communications

---

## 10. Cost Management

### 10.1 Blaxel Pricing Model

- **Pay-per-use**: Billed per second of execution
- **Free tier**: Check current Blaxel free tier limits
- **Auto-scale-to-zero**: No cost when idle

### 10.2 Sprites Pricing Model

- **Per-second billing**: Compute time billed per second
- **Free when idle**: No compute charges during hibernation
- **Storage costs**: Persistent filesystem stored in object storage

### 10.3 Quota Management

Set appropriate quotas in `env.example`:

```bash
QUOTA_BLAXEL_MONTHLY=5000      # Adjust based on budget
QUOTA_SPRITES_MONTHLY=2000     # Adjust based on budget
```

Monitor usage:

```typescript
const blaxelUsage = quotaManager.getUsagePercent('blaxel');
console.log(`Blaxel quota usage: ${blaxelUsage}%`);
```

---

## 11. Migration Guide

### 11.1 From Existing Providers

Migrating from Daytona/Runloop to Blaxel:

```typescript
// Before
const provider = getSandboxProvider('daytona');

// After
const provider = getSandboxProvider('blaxel');
// Or use automatic fallback chain
```

Migrating to Sprites for persistent workloads:

```typescript
// Enable checkpointing
process.env.SPRITES_ENABLE_CHECKPOINTS = 'true';

// Create checkpoint before risky operations
await handle.createCheckpoint('pre-change');
```

### 11.2 Backward Compatibility

Both providers are designed to be drop-in replacements:

- Same `SandboxProvider` interface
- Same `SandboxHandle` methods
- Automatic fallback chain integration
- No breaking changes to existing code

---

## 12. Troubleshooting

### 12.1 Common Issues

**Blaxel: "Cannot connect to API"**
```bash
# Verify API key
curl -H "Authorization: Bearer $BLAXEL_API_KEY" \
  https://api.blaxel.ai/v0/sandboxes

# Check workspace
echo $BLAXEL_WORKSPACE
```

**Sprites: "Authentication failed"**
```bash
# Re-authenticate
npx sprite org auth

# Verify token
npx sprite list
```

**Both: "Quota exceeded"**
```bash
# Check usage
# In code: quotaManager.getUsagePercent('blaxel')

# Wait for monthly reset or increase quota
export QUOTA_BLAXEL_MONTHLY=10000
```

### 12.2 Debug Mode

Enable verbose logging:

```bash
export DEBUG=blaxel*,sprites*
export LOG_LEVEL=debug
```

---

## 13. Future Roadmap

### Phase 1 (Current)
- [x] Core provider implementations
- [x] Quota manager integration
- [x] Fallback chain integration
- [ ] Unit tests
- [ ] Documentation

### Phase 2 (Next)
- [ ] Advanced features (checkpoints, services, async triggers)
- [ ] Performance optimizations
- [ ] Monitoring dashboards
- [ ] E2E tests

### Phase 3 (Future)
- [ ] Additional providers (CodeSandbox, Replit, etc.)
- [ ] Hybrid local/cloud execution
- [ ] Advanced networking (VPC peering, private links)
- [ ] Enterprise features (SSO, audit logs, compliance)

---

## Appendix A: API Reference Summary

### Blaxel API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v0/sandboxes` | POST | Create sandbox |
| `/v0/sandboxes/{name}` | GET | Get sandbox details |
| `/v0/sandboxes/{name}` | DELETE | Delete sandbox |
| `/v0/sandboxes/{name}/run` | POST | Execute command |
| `/v0/sandboxes/{name}/fs` | POST | File operations |

### Sprites SDK Methods

| Method | Description |
|--------|-------------|
| `client.createSprite(name)` | Create new Sprite |
| `client.getSprite(name)` | Get existing Sprite |
| `sprite.execFile(cmd, args)` | Execute command |
| `sprite.spawn(cmd, args)` | Stream command output |
| `sprite.fs.write(path, content)` | Write file |
| `sprite.createCheckpoint(name)` | Create checkpoint |
| `sprite.services.create(name, config)` | Create service |

---

## Appendix B: Complete Code Examples

See the following files for complete implementations:
- `lib/sandbox/providers/blaxel-provider.ts`
- `lib/sandbox/providers/sprites-provider.ts`
- `lib/sandbox/core-sandbox-service.ts` (updated)
- `lib/services/quota-manager.ts` (updated)

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-27  
**Author:** binG Development Team
