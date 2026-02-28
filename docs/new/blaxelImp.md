# Advanced Features Implementation Guide

## Overview

This document covers the implementation of three advanced features for the Blaxel and Sprites sandbox providers:

1. **SSHFS Mount Helper** (Sprites) - Mount Sprite filesystem locally
2. **MCP Server Integration** (Blaxel) - Expose sandbox as MCP tools
3. **Rate Limiting** (Both) - Prevent abuse and manage resources

**Implementation Date:** 2026-02-27  
**Status:** ✅ Complete

---

## 1. SSHFS Mount Helper (Sprites)

### What It Does

The SSHFS Mount Helper allows you to mount a Sprite's filesystem locally using SSHFS (SSH File System). This provides:

- **Real-time sync** between local files and Sprite
- **Edit with local IDE** (VS Code, Vim, etc.)
- **Seamless workflow** without manual file transfers
- **Automatic SSH tunnel** management

### Installation Requirements

**Local Machine:**
```bash
# macOS
brew install macfuse sshfs

# Ubuntu/Debian
sudo apt-get install sshfs

# Fedora/RHEL
sudo dnf install fuse-sshfs
```

**On Sprite (auto-installed):**
- OpenSSH server
- SSHFS client (usually pre-installed)

### Usage

#### Basic Mount

```typescript
import { mountSpriteSSHFS } from '@/lib/sandbox/providers'

// Mount Sprite filesystem
const mount = await mountSpriteSSHFS({
  spriteName: 'my-dev-sprite',
  mountPoint: '/tmp/sprite-mount',
})

console.log(`Mounted at: ${mount.mountPoint}`)

// Edit files in /tmp/sprite-mount with your local IDE
// Changes sync to Sprite in real-time

// When done
await mount.unmount()
```

#### Advanced Configuration

```typescript
import { SpritesSSHFS } from '@/lib/sandbox/providers'

const sshfs = new SpritesSSHFS()

const result = await sshfs.mount({
  spriteName: 'my-dev-sprite',
  mountPoint: '/tmp/sprite-mount',
  localPort: 2000, // SSH tunnel port (default: 2000)
  autoInstallSSH: true, // Auto-install SSH server on Sprite
  tunnelTimeout: 15000, // Tunnel establishment timeout (ms)
  sshfsOptions: [
    'reconnect',
    'ServerAliveInterval=15',
    'ServerAliveCountMax=3',
    'follow_symlinks',
    'allow_other',
  ],
})

console.log(`SSH installed: ${result.sshInstalled}`)
console.log(`Mount point: ${result.mountPoint}`)

// Check if mounted
console.log(`Is mounted: ${result.isMounted()}`)

// Unmount when done
await result.unmount()
```

#### Programmatic Unmount

```typescript
import { unmountSpriteSSHFS } from '@/lib/sandbox/providers'

// Unmount by mount point
await unmountSpriteSSHFS('/tmp/sprite-mount')
```

### How It Works

1. **SSH Server Installation**: Automatically installs OpenSSH on Sprite if not present
2. **SSH Key Authorization**: Copies your local SSH public key to Sprite's `authorized_keys`
3. **SSH Tunnel**: Creates a local port forward to Sprite's SSH port (22)
4. **SSHFS Mount**: Mounts remote filesystem via SSH using `sshfs` command
5. **Cleanup**: Properly unmounts and kills processes on `unmount()`

### Architecture

```
┌─────────────────┐      SSH Tunnel      ┌─────────────────┐
│  Local Machine  │ ◄──────────────────► │     Sprite      │
│                 │      Port 2000:22    │                 │
│  /tmp/sprite-   │ ◄──── SSHFS ───────► │  /home/sprite/  │
│    mount/       │                      │                 │
└─────────────────┘                      └─────────────────┘
```

### Use Cases

#### 1. Development Workflow

```typescript
// Mount development Sprite
const mount = await mountSpriteSSHFS({
  spriteName: 'dev-environment',
  mountPoint: '/tmp/dev-sprite',
})

// Open in VS Code
// code /tmp/dev-sprite

// Edit files locally, they sync to Sprite
// Run commands in Sprite, see results locally
```

#### 2. Project Synchronization

```typescript
// Mount Sprite
const mount = await mountSpriteSSHFS({
  spriteName: 'project-sprite',
  mountPoint: '/tmp/project',
})

// Copy existing project
const { cp } = await import('fs/promises')
await cp('./my-project', '/tmp/project/my-project', { recursive: true })

// Files are now on Sprite, ready to run
```

#### 3. Long-Running Development

```typescript
// Mount for extended period
const sshfs = new SpritesSSHFS()
const mount = await sshfs.mount({
  spriteName: 'long-term-dev',
  mountPoint: '/tmp/long-term',
})

// Keep mounted for days/weeks
// Files always in sync

// Unmount when project complete
await sshfs.unmount()
```

### Error Handling

```typescript
try {
  const mount = await mountSpriteSSHFS({
    spriteName: 'my-sprite',
    mountPoint: '/tmp/sprite',
  })
} catch (error: any) {
  if (error.message.includes('SSHFS is not installed')) {
    console.error('Please install SSHFS first:')
    console.error('  macOS: brew install macfuse sshfs')
    console.error('  Linux: sudo apt-get install sshfs')
  } else if (error.message.includes('timed out')) {
    console.error('SSH tunnel timed out. Check Sprite is running.')
  } else {
    console.error('Mount failed:', error.message)
  }
}
```

### Best Practices

1. **Always unmount** when done to prevent resource leaks
2. **Use unique mount points** for different Sprites
3. **Monitor disk space** on both local and Sprite
4. **Handle process exit** to cleanup mounts

```typescript
// Cleanup on process exit
process.on('exit', async () => {
  if (mount.isMounted()) {
    await mount.unmount()
  }
})
```

---

## 2. MCP Server Integration (Blaxel)

### What It Does

The MCP (Model Context Protocol) Server Integration exposes Blaxel sandbox capabilities as standardized MCP tools. This allows AI assistants like Cursor, Claude Desktop, etc. to:

- **Execute commands** in the sandbox
- **Read/write files** remotely
- **List directories** and explore filesystem
- **Run batch jobs** for parallel processing
- **Execute asynchronously** for long-running tasks

### Installation Requirements

```bash
npm install @modelcontextprotocol/sdk
```

### Usage

#### Basic MCP Server (stdio)

```typescript
import { createBlaxelMcpServer } from '@/lib/sandbox/providers'

// Create sandbox
const handle = await blaxelProvider.createSandbox({})

// Start MCP server
await createBlaxelMcpServer(handle)
// Server runs on stdio for AI assistant integration
```

#### HTTP MCP Server

```typescript
import { createBlaxelMcpServer } from '@/lib/sandbox/providers'

const handle = await blaxelProvider.createSandbox({})

// Start HTTP MCP server
const url = await createBlaxelMcpServer(handle, 3000)
console.log(`MCP server running on: ${url}`)
// Connect with: http://localhost:3000/mcp
```

#### Manual Control

```typescript
import { BlaxelMcpServer } from '@/lib/sandbox/providers'

const handle = await blaxelProvider.createSandbox({})
const mcpServer = new BlaxelMcpServer(handle)

// Start stdio server
await mcpServer.start()

// Or HTTP server
const url = await mcpServer.deployHttpMcp(3000)

// Check connection
console.log(`Server connected: ${mcpServer.isConnected()}`)

// Close when done
await mcpServer.close()
```

### Available MCP Tools

When connected, AI assistants can use these tools:

#### 1. `execute_command`

Execute shell commands in the sandbox.

**Parameters:**
- `command` (required): Command to execute
- `cwd` (optional): Working directory
- `timeout` (optional): Timeout in ms

**Example:**
```json
{
  "name": "execute_command",
  "arguments": {
    "command": "npm install express",
    "cwd": "/workspace",
    "timeout": 120000
  }
}
```

#### 2. `write_file`

Write content to a file.

**Parameters:**
- `path` (required): File path
- `content` (required): File content

**Example:**
```json
{
  "name": "write_file",
  "arguments": {
    "path": "/workspace/index.ts",
    "content": "console.log('Hello!')"
  }
}
```

#### 3. `read_file`

Read file content.

**Parameters:**
- `path` (required): File path

**Example:**
```json
{
  "name": "read_file",
  "arguments": {
    "path": "/workspace/package.json"
  }
}
```

#### 4. `list_directory`

List directory contents.

**Parameters:**
- `path` (optional): Directory path (default: /workspace)

**Example:**
```json
{
  "name": "list_directory",
  "arguments": {
    "path": "/workspace/src"
  }
}
```

#### 5. `get_sandbox_info`

Get sandbox information.

**Parameters:** None

**Example:**
```json
{
  "name": "get_sandbox_info",
  "arguments": {}
}
```

#### 6. `run_batch_job` (if available)

Run parallel batch jobs.

**Parameters:**
- `tasks` (required): Array of tasks
- `maxConcurrentTasks` (optional): Max concurrent
- `timeout` (optional): Timeout per task (seconds)

**Example:**
```json
{
  "name": "run_batch_job",
  "arguments": {
    "tasks": [
      {"id": "1", "data": {"code": "print('hi')"}},
      {"id": "2", "data": {"code": "print('hello')"}}
    ],
    "maxConcurrentTasks": 5
  }
}
```

#### 7. `execute_async` (if available)

Execute long-running command asynchronously.

**Parameters:**
- `command` (required): Command to execute
- `callbackUrl` (optional): Webhook URL
- `timeout` (optional): Timeout in ms

**Example:**
```json
{
  "name": "execute_async",
  "arguments": {
    "command": "npm run build",
    "timeout": 900000
  }
}
```

### Integration with AI Assistants

#### Cursor IDE

Add to Cursor settings:

```json
{
  "mcp": {
    "servers": {
      "blaxel-sandbox": {
        "command": "node",
        "args": ["path/to/mcp-server.js"],
        "env": {
          "BLAXEL_API_KEY": "your-key",
          "BLAXEL_WORKSPACE": "your-workspace"
        }
      }
    }
  }
}
```

#### Claude Desktop

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "blaxel": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {
        "BLAXEL_API_KEY": "your-key"
      }
    }
  }
}
```

### Use Cases

#### 1. AI-Assisted Development

```typescript
// AI can now:
// - Create files
// - Run commands
// - Test code
// - Debug issues
// All through MCP tools
```

#### 2. Automated Code Review

```typescript
// AI agent can:
// 1. Read source files
// 2. Run linters
// 3. Execute tests
// 4. Report issues
```

#### 3. Interactive Learning

```typescript
// Students can:
// - Write code via AI
// - Execute and see results
// - Get immediate feedback
// - Safe sandboxed environment
```

---

## 3. Rate Limiting

### What It Does

The Rate Limiter provides protection against abuse and resource management for sandbox operations:

- **Per-user rate limits** - Limit operations per user
- **Per-IP rate limits** - Limit operations per IP
- **Per-operation limits** - Different limits for different operations
- **Sliding window** - Accurate rate limiting
- **Automatic cleanup** - Memory management

### Usage

#### Basic Rate Limiting

```typescript
import { createSandboxRateLimiter } from '@/lib/sandbox/providers'

// Create rate limiter with defaults
const rateLimiter = createSandboxRateLimiter()

// Check before operation
const result = await rateLimiter.check('user-123', 'commands')
if (!result.allowed) {
  throw new Error(result.message)
}

// Record operation
await rateLimiter.record('user-123', 'commands')
```

#### Atomic Check and Record

```typescript
import { createSandboxRateLimiter } from '@/lib/sandbox/providers'

const rateLimiter = createSandboxRateLimiter()

// Check and record in one operation
const result = await rateLimiter.checkAndRecord('user-123', 'commands')
if (!result.allowed) {
  return res.status(429).json({
    error: result.message,
    retryAfter: result.retryAfter,
  })
}

// Operation allowed and recorded
```

#### Custom Configuration

```typescript
import { SandboxRateLimiter } from '@/lib/sandbox/providers'

const rateLimiter = new SandboxRateLimiter({
  commands: {
    max: 100,
    windowMs: 60000, // 100 per minute
    message: 'Too many commands!',
  },
  fileOps: {
    max: 50,
    windowMs: 60000, // 50 per minute
  },
  batchJobs: {
    max: 10,
    windowMs: 60000, // 10 per minute
  },
})
```

#### Override Defaults

```typescript
import { createSandboxRateLimiter } from '@/lib/sandbox/providers'

const rateLimiter = createSandboxRateLimiter({
  commands: { max: 200 }, // Increase from 100 to 200
  fileOps: { max: 100, windowMs: 120000 }, // 100 per 2 minutes
})
```

### Express Middleware

```typescript
import { rateLimitMiddleware, createSandboxRateLimiter } from '@/lib/sandbox/providers'

const rateLimiter = createSandboxRateLimiter()

// Apply to route
app.post('/api/sandbox/execute',
  rateLimitMiddleware(rateLimiter, 'commands'),
  async (req, res) => {
    // Handle request
  }
)
```

### Per-IP Rate Limiting

```typescript
import { rateLimitMiddleware } from '@/lib/sandbox/providers'

// Use IP as identifier
app.use('/api/sandbox',
  rateLimitMiddleware(
    rateLimiter,
    'commands',
    (req) => req.ip || req.headers['x-forwarded-for'] as string || 'unknown'
  )
)
```

### Get Status

```typescript
const status = rateLimiter.getStatus('user-123', 'commands')
console.log(`Usage: ${status.count}/${status.max}`)
console.log(`Limited: ${status.limited}`)
console.log(`Reset in: ${status.resetIn}ms`)
```

### Reset Rate Limits

```typescript
// Reset for specific user and operation
rateLimiter.reset('user-123', 'commands')

// Reset all operations for user
rateLimiter.reset('user-123')
```

### Default Limits

| Operation | Limit | Window |
|-----------|-------|--------|
| `commands` | 100 | 1 minute |
| `fileOps` | 50 | 1 minute |
| `batchJobs` | 10 | 1 minute |
| `asyncExec` | 20 | 1 minute |
| `checkpoints` | 30 | 1 minute |
| `proxy` | 5 | 1 minute |

### Use Cases

#### 1. Prevent Abuse

```typescript
// Limit commands per user
const rateLimiter = createSandboxRateLimiter({
  commands: { max: 100, windowMs: 60000 },
})

// In API route
app.post('/api/execute', async (req, res) => {
  const result = await rateLimiter.checkAndRecord(req.user.id, 'commands')
  if (!result.allowed) {
    return res.status(429).json({ error: result.message })
  }
  
  // Execute command
})
```

#### 2. Resource Management

```typescript
// Limit batch jobs to prevent overload
const rateLimiter = createSandboxRateLimiter({
  batchJobs: { max: 5, windowMs: 60000 }, // 5 per minute
})
```

#### 3. Tiered Limits

```typescript
// Different limits for different user tiers
function getRateLimiter(userTier: string) {
  if (userTier === 'premium') {
    return createSandboxRateLimiter({
      commands: { max: 1000 },
      fileOps: { max: 500 },
    })
  }
  
  return createSandboxRateLimiter({
    commands: { max: 100 },
    fileOps: { max: 50 },
  })
}
```

---

## Integration Examples

### Complete Example: All Features

```typescript
import {
  getSandboxProvider,
  mountSpriteSSHFS,
  createBlaxelMcpServer,
  createSandboxRateLimiter,
} from '@/lib/sandbox/providers'

// Setup rate limiter
const rateLimiter = createSandboxRateLimiter()

// Use Sprites with SSHFS
async function setupDevEnvironment() {
  const sprites = getSandboxProvider('sprites')
  const handle = await sprites.createSandbox({})
  
  // Mount filesystem
  const mount = await mountSpriteSSHFS({
    spriteName: handle.id,
    mountPoint: '/tmp/dev',
  })
  
  console.log(`Mounted at: ${mount.mountPoint}`)
  
  return { handle, mount }
}

// Use Blaxel with MCP
async function setupMcpServer() {
  const blaxel = getSandboxProvider('blaxel')
  const handle = await blaxel.createSandbox({})
  
  // Check rate limit
  const result = await rateLimiter.checkAndRecord('system', 'commands')
  if (!result.allowed) {
    throw new Error(result.message!)
  }
  
  // Start MCP server
  await createBlaxelMcpServer(handle, 3000)
  
  console.log('MCP server running on http://localhost:3000/mcp')
}
```

---

## Troubleshooting

### SSHFS Mount Issues

**Problem:** "SSHFS is not installed"
```bash
# Install SSHFS
macOS: brew install macfuse sshfs
Linux: sudo apt-get install sshfs
```

**Problem:** "SSH tunnel timed out"
- Check Sprite is running: `sprite list`
- Verify SSH server installed: `sprite exec -s <name> "which sshd"`
- Check firewall settings

### MCP Server Issues

**Problem:** "Cannot find module '@modelcontextprotocol/sdk'"
```bash
npm install @modelcontextprotocol/sdk
```

**Problem:** "Server failed to start"
- Check port is available
- Verify Blaxel credentials
- Check sandbox is running

### Rate Limiting Issues

**Problem:** "Rate limit exceeded"
- Wait for window to reset
- Increase limits in configuration
- Check for memory leaks (not cleaning up)

---

## Best Practices

1. **Always cleanup resources** - Unmount SSHFS, close MCP servers
2. **Use appropriate rate limits** - Balance usability and protection
3. **Monitor usage** - Track rate limit hits
4. **Handle errors gracefully** - Inform users of limits
5. **Document limits** - Make users aware of restrictions

---

**Implementation Complete:** 2026-02-27  
**Status:** ✅ Production-Ready
