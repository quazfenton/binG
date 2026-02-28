# Usage Examples - Complete Guide

**Date**: 2026-02-28  
**Purpose**: Practical usage examples for all implemented features

---

## Table of Contents

1. [Quota Management](#quota-management)
2. [Rate Limiting](#rate-limiting)
3. [Self-Healing Tool Calls](#self-healing-tool-calls)
4. [Auth Caching](#auth-caching)
5. [E2B Desktop](#e2b-desktop)
6. [Daytona Computer Use](#daytona-computer-use)
7. [Composio MCP](#composio-mcp)
8. [Reflection Engine](#reflection-engine)
9. [Filesystem Persistence](#filesystem-persistence)
10. [Circuit Breaker](#circuit-breaker)
11. [Health Checks](#health-checks)
12. [VFS Diff Tracking](#vfs-diff-tracking)

---

## Quota Management

### Basic Usage

```typescript
import { quotaManager } from '@/lib/services/quota-manager'

// Check quota before operation
const check = quotaManager.checkQuota('e2b', 'user-123')

if (!check.allowed) {
  throw new Error(`Quota exceeded. Remaining: ${check.remaining}`)
}

// Record usage (automatically enforces quota)
try {
  quotaManager.recordUsage('e2b', 1, 'user-123')
  // Proceed with operation
} catch (error: any) {
  console.error(error.message) // "Quota exceeded for e2b..."
}
```

### Get Quota Status

```typescript
// Get remaining calls
const remaining = quotaManager.getRemainingCalls('e2b')
console.log(`Remaining: ${remaining}`)

// Get usage percentage
const percent = quotaManager.getUsagePercent('e2b')
console.log(`Usage: ${percent.toFixed(1)}%`)

// Check if available
const isAvailable = quotaManager.isAvailable('e2b')
console.log(`Available: ${isAvailable}`)

// Get all quotas
const allQuotas = quotaManager.getAllQuotas()
for (const quota of allQuotas) {
  console.log(`${quota.provider}: ${quota.currentUsage}/${quota.monthlyLimit}`)
}
```

### Environment Configuration

```bash
# .env.local
QUOTA_E2B_MONTHLY=1000
QUOTA_DAYTONA_MONTHLY=5000
QUOTA_BLAXEL_MONTHLY=5000
QUOTA_SPRITES_MONTHLY=2000
```

---

## Rate Limiting

### Basic Usage

```typescript
import { 
  rateLimitMiddleware, 
  checkRateLimit,
  RATE_LIMIT_CONFIGS,
  getRateLimitTier,
  RATE_LIMIT_TIERS 
} from '@/lib/middleware/rate-limiter'

// In API route
export async function POST(request: Request) {
  // Get user's tier from API key
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '')
  const tier = getRateLimitTier(undefined, apiKey)
  
  // Apply rate limiting
  const result = rateLimitMiddleware(
    request,
    'generic',
    undefined,
    tier
  )
  
  if (!result.success) {
    return result.response // 429 Too Many Requests
  }
  
  // Proceed with request
  // Rate limit headers are in result.headers
}
```

### Manual Rate Limit Check

```typescript
// Check rate limit manually
const result = checkRateLimit(
  'user:123',
  RATE_LIMIT_CONFIGS.generic,
  RATE_LIMIT_TIERS.premium // 10x limits
)

if (!result.allowed) {
  return Response.json(
    { error: 'Rate limit exceeded', retryAfter: result.retryAfter },
    { status: 429 }
  )
}

console.log(`Remaining: ${result.remaining}`)
console.log(`Reset after: ${result.resetAfter}ms`)
console.log(`Tier: ${result.tier}`)
```

### Tier Detection

```typescript
// Free tier (default)
const freeTier = getRateLimitTier()
console.log(freeTier.multiplier) // 1

// Premium tier (API key starts with sk-pro-)
const premiumTier = getRateLimitTier(undefined, 'sk-pro-abc123')
console.log(premiumTier.multiplier) // 10

// Enterprise tier (API key starts with sk-ent-)
const enterpriseTier = getRateLimitTier(undefined, 'sk-ent-xyz789')
console.log(enterpriseTier.multiplier) // 100
```

### Custom Rate Limits

```typescript
// Custom configuration
const customConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 100,
  message: 'Too many requests',
}

const result = checkRateLimit(
  'user:123',
  customConfig,
  RATE_LIMIT_TIERS.free
)
```

---

## Self-Healing Tool Calls

### Basic Usage

```typescript
import { SelfHealingToolValidator } from '@/lib/tool-integration/parsers/self-healing'

const validator = new SelfHealingToolValidator()

// Validate tool calls
const result = validator.validate(
  [
    {
      name: 'exec_shell',
      arguments: { command: 123 } // Wrong type (should be string)
    }
  ],
  tools
)

console.log('Accepted:', result.accepted.length)
console.log('Rejected:', result.rejected.length)

// If rejected, check reason
if (result.rejected.length > 0) {
  console.log('Rejection reason:', result.rejected[0].reason)
}
```

### With LLM Healing

```typescript
// Self-healing automatically tries LLM if shallow healing fails
const validator = new SelfHealingToolValidator()

const result = await validator.validate(
  [
    {
      name: 'write_file',
      arguments: { 
        path: 123, // Wrong type
        content: 'hello'
      }
    }
  ],
  [
    {
      name: 'write_file',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
    }
  ]
)

// LLM will attempt to fix: { path: "123", content: "hello" }
console.log('Accepted after healing:', result.accepted.length)
```

---

## Auth Caching

### Basic Usage

```typescript
import { resolveRequestAuth } from '@/lib/auth/request-auth'

// First call - validates JWT/session
const auth1 = await resolveRequestAuth(request)
console.log(auth1.source) // 'jwt' or 'session'

// Second call with same auth header - returns cached result (5min TTL)
const auth2 = await resolveRequestAuth(request)
console.log(auth2.source) // Same as auth1, but from cache (faster)
```

### With Anonymous Mode

```typescript
const auth = await resolveRequestAuth(request, {
  allowAnonymous: true,
  anonymousHeaderName: 'x-anonymous-session-id',
})

if (auth.success) {
  if (auth.source === 'anonymous') {
    console.log('Anonymous user:', auth.userId) // 'anon:session-id'
  } else {
    console.log('Authenticated user:', auth.userId)
  }
}
```

---

## E2B Desktop

### Create Desktop with VNC

```typescript
import { e2bDesktopProvider } from '@/lib/sandbox/providers/e2b-desktop-provider'

// Create desktop sandbox
const desktop = await e2bDesktopProvider.createDesktop({
  resolution: [1024, 720],
  dpi: 96,
  timeoutMs: 300000,
  startStreaming: true,
})

console.log('View desktop at:', desktop.getStreamUrl())
```

### Mouse Operations

```typescript
// Move mouse
await desktop.moveMouse(500, 300)

// Click
await desktop.leftClick()
await desktop.leftClick(100, 200) // Specific position
await desktop.rightClick()
await desktop.doubleClick()

// Drag
await desktop.drag(0, 0, 100, 100)

// Scroll
await desktop.scroll('down', 3)
```

### Keyboard Operations

```typescript
// Type text
await desktop.type('Hello, World!')

// Press keys
await desktop.press('Enter')
await desktop.press(['Control_L', 'c']) // Ctrl+C
await desktop.hotkey('Alt', 'Tab')
```

### Screenshots

```typescript
// Take screenshot
const buffer = await desktop.screenshot()
console.log('Size:', buffer.length, 'bytes')

// As base64 (for LLM)
const base64 = await desktop.screenshotBase64()
console.log('Base64:', base64.slice(0, 100), '...')
```

### AMP Integration

```typescript
// Run AMP agent with streaming
const result = await desktop.runAmpAgent('Fix all TODOs in the codebase', {
  streamJson: true,
  onEvent: (event) => {
    if (event.type === 'assistant') {
      console.log('Tokens:', event.message.usage?.output_tokens)
    } else if (event.type === 'result') {
      console.log('Done in', event.message.duration_ms, 'ms')
    }
  },
})

console.log('Success:', result.success)
console.log('Events:', result.events?.length)
```

### Thread Management

```typescript
// List threads
const threads = await desktop.listAmpThreads()
console.log('Threads:', threads)

// Continue thread
if (threads.length > 0) {
  await desktop.continueAmpThread(
    threads[0].id,
    'Now add unit tests for the changes'
  )
}
```

---

## Daytona Computer Use

### Get Computer Use Service

```typescript
import { getSandboxProvider } from '@/lib/sandbox/providers'

const provider = getSandboxProvider('daytona')
const sandbox = await provider.createSandbox({})

// Get computer use service
const computerUse = sandbox.getComputerUseService()

if (!computerUse) {
  console.error('Computer Use not available (check DAYTONA_API_KEY)')
}
```

### Mouse Operations

```typescript
// Click
await computerUse.click({ x: 100, y: 200, button: 'left' })
await computerUse.click({ button: 'right' }) // Current position

// Move
await computerUse.move({ x: 300, y: 400 })

// Drag
await computerUse.drag({
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 100,
})

// Scroll
await computerUse.scroll({ direction: 'down', ticks: 3 })

// Get position
const pos = await computerUse.getPosition()
console.log('Mouse at:', pos.output) // "Mouse position: (300, 400)"
```

### Keyboard Operations

```typescript
// Type
await computerUse.type({ text: 'Hello World' })

// Press
await computerUse.press({ keys: 'Enter' })
await computerUse.press({ keys: ['Control_L', 'c'] })

// Hotkey
await computerUse.hotkey('Alt', 'Tab')
```

### Screenshots

```typescript
// Full screen
const screenshot = await computerUse.takeFullScreen()
console.log('Size:', screenshot.output)

// Region
const region = await computerUse.takeRegion({
  x: 0,
  y: 0,
  width: 100,
  height: 100,
})

// Compressed
const compressed = await computerUse.takeCompressed({ quality: 0.8 })
```

### Screen Recording

```typescript
// Start recording
const startResult = await computerUse.startRecording({
  path: '/recordings',
  duration: 60, // seconds
})
console.log('Recording ID:', startResult.data?.recordingId)

// Stop recording
await computerUse.stopRecording(startResult.data.recordingId)

// List recordings
const list = await computerUse.listRecordings()
console.log('Recordings:', list.output)

// Download
const download = await computerUse.downloadRecording(recordingId)
console.log('Downloaded:', download.output, 'bytes')
```

### Display Operations

```typescript
// Get display info
const display = await computerUse.getDisplayInfo()
console.log('Display:', display.output) // "Display: 1920x1080"

// Get windows
const windows = await computerUse.getWindows()
console.log('Windows:', windows.output)
```

---

## Composio MCP

### Start MCP Server

```typescript
import { createComposioMCPServer } from '@/lib/api/composio-mcp-service'

// Start server
const server = await createComposioMCPServer({
  apiKey: process.env.COMPOSIO_API_KEY,
  serverName: 'composio-tools',
  port: 3001,
})

console.log('MCP server started on http://localhost:3001/mcp')
```

### Create Session

```typescript
import { getComposioMCPSession } from '@/lib/api/composio-mcp-service'

// Get session for user
const session = await getComposioMCPSession(
  'user-123',
  process.env.COMPOSIO_API_KEY
)

console.log('MCP URL:', session.url)
console.log('MCP Headers:', session.headers)
console.log('Available tools:', session.tools.length)
```

### Connect MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

// Connect to Composio MCP
const client = new Client({
  serverUrl: session.url,
  headers: session.headers,
})

await client.connect()

// List tools
const tools = await client.listTools()
console.log('Tools:', tools.tools.length)

// Call tool
const result = await client.callTool({
  name: 'github_create_issue',
  arguments: {
    title: 'Bug report',
    body: 'Found a bug...',
    repo: 'owner/repo',
  },
})

console.log('Result:', result.content)
```

---

## Reflection Engine

### Basic Reflection

```typescript
import { reflectionEngine } from '@/lib/api/reflection-engine'

// Reflect on AI response
const reflections = await reflectionEngine.reflect(
  'AI response content here',
  { context: { type: 'code generation', language: 'typescript' } }
)

console.log('Perspectives:', reflections.length)
for (const r of reflections) {
  console.log(`${r.perspective}: ${r.improvements.length} improvements`)
}
```

### Synthesize Feedback

```typescript
const summary = reflectionEngine.synthesizeReflections(reflections)

console.log('Overall Score:', summary.overallScore)
console.log('Top Improvements:', summary.prioritizedImprovements)
console.log('Confidence:', summary.confidenceLevel)
```

### Quality Check

```typescript
// Check if reflection is needed
if (reflectionEngine.shouldReflect(qualityScore)) {
  const reflections = await reflectionEngine.reflect(response)
  const summary = reflectionEngine.synthesizeReflections(reflections)
  
  if (summary.overallScore < 0.7) {
    // Regenerate or improve response
    console.log('Quality too low, regenerating...')
  }
}
```

---

## Filesystem Persistence

### Transaction Persistence

```typescript
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service'

// Create transaction (automatically persisted)
const tx = filesystemEditSessionService.createTransaction({
  ownerId: 'user-123',
  conversationId: 'conv-456',
  requestId: 'req-789',
})

// Add operations
tx.operations.push({
  path: '/test/file.ts',
  operation: 'write',
  newVersion: 1,
  previousVersion: null,
  previousContent: null,
  existedBefore: false,
})

// Accept (persists to database)
filesystemEditSessionService.acceptTransaction(tx.id)

// Later: retrieve from database
const restored = await filesystemEditSessionService.getTransaction(tx.id)
console.log('Restored:', restored?.id)
```

### Denial History

```typescript
// Deny transaction
await filesystemEditSessionService.denyTransaction({
  transactionId: tx.id,
  reason: 'User rejected changes',
})

// Get denial history
const denials = filesystemEditSessionService.getRecentDenials('conv-456')
console.log('Denials:', denials.length)
for (const denial of denials) {
  console.log(`- ${denial.reason}`)
}
```

---

## Circuit Breaker

### Basic Usage

```typescript
import { circuitBreakerManager } from '@/lib/middleware/circuit-breaker'

// Execute with circuit breaker protection
try {
  const result = await circuitBreakerManager.execute('e2b', async () => {
    return await e2bProvider.createSandbox({})
  })
  console.log('Success:', result)
} catch (error: any) {
  if (error instanceof CircuitBreakerOpenError) {
    console.log('Circuit open, retry after:', error.getRetryAfter(), 'ms')
    // Fallback to alternative provider
  } else {
    throw error
  }
}
```

### Custom Configuration

```typescript
import { CircuitBreaker } from '@/lib/middleware/circuit-breaker'

const breaker = new CircuitBreaker('my-provider', {
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 3,      // Close after 3 successes
  timeout: 30000,           // Try recovery after 30s
  halfOpenMaxRequests: 3,   // Allow 3 test requests
})
```

### State Monitoring

```typescript
const stats = circuitBreakerManager.getBreaker('e2b').getStats()

console.log('State:', stats.state) // CLOSED, OPEN, or HALF-OPEN
console.log('Total Requests:', stats.totalRequests)
console.log('Successful:', stats.successfulRequests)
console.log('Failed:', stats.failedRequests)
console.log('Rejected:', stats.rejectedRequests)
```

### State Change Callbacks

```typescript
const breaker = circuitBreakerManager.getBreaker('e2b')

const unsubscribe = breaker.onStateChange((state) => {
  console.log('State changed to:', state)
  
  if (state === 'OPEN') {
    // Alert operations team
    sendAlert('E2B circuit breaker opened!')
  }
})

// Later: unsubscribe
unsubscribe()
```

---

## Health Checks

### Register Health Check

```typescript
import { 
  healthCheckManager, 
  createHttpHealthCheck,
  createFunctionHealthCheck 
} from '@/lib/middleware/health-check'

// HTTP health check
healthCheckManager.register('e2b', createHttpHealthCheck(
  'https://api.e2b.dev/health',
  { timeout: 5000, expectedStatus: 200 }
))

// Function health check
healthCheckManager.register('daytona', createFunctionHealthCheck(async () => {
  const provider = getSandboxProvider('daytona')
  const sandbox = await provider.createSandbox({})
  await sandbox.kill()
  return true
}))
```

### Check Provider Health

```typescript
// Check if healthy
const isHealthy = healthCheckManager.isHealthy('e2b')
console.log('E2B healthy:', isHealthy)

// Get detailed health
const health = healthCheckManager.getHealth('e2b')
console.log('Status:', health?.status)
console.log('Avg Latency:', health?.averageLatency, 'ms')
console.log('Consecutive Failures:', health?.consecutiveFailures)
```

### Get All Providers

```typescript
// Get healthy providers
const healthy = healthCheckManager.getHealthyProviders()
console.log('Healthy:', healthy)

// Get unhealthy providers
const unhealthy = healthCheckManager.getUnhealthyProviders()
console.log('Unhealthy:', unhealthy)

// Get all health
const allHealth = healthCheckManager.getAllHealth()
for (const [providerId, health] of allHealth.entries()) {
  console.log(`${providerId}: ${health.status}`)
}
```

---

## VFS Diff Tracking

### Get Diff Summary

```typescript
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service'

// Get summary for LLM context
const summary = virtualFilesystem.getDiffSummary('user-123', 10)

console.log(summary)
// Output:
// ## File Changes Summary (2 files modified)
//
// ### 📄 Created: /test/new-file.ts
// Version: 1 | Timestamp: 2026-02-28T03:25:51.304Z
//
// **Changes:**
// ```diff
// +export const hello = "world";
// ```
```

### Use in LLM Prompt

```typescript
const recentChanges = virtualFilesystem.getDiffSummary(userId, 5)

const response = await llm.generate([
  {
    role: 'system',
    content: `You are a coding assistant. Recent file changes:\n\n${recentChanges}`
  },
  ...messages
])
```

### Rollback to Version

```typescript
// Rollback to version 5
const result = await virtualFilesystem.rollbackToVersion('user-123', 5)

if (result.success) {
  console.log(`Restored ${result.restoredFiles} files`)
  console.log(`Deleted ${result.deletedFiles} files`)
} else {
  console.error('Rollback errors:', result.errors)
}
```

### Get Files at Version

```typescript
// Get all files at version 3
const files = virtualFilesystem.getFilesAtVersion('user-123', 3)

for (const [path, content] of files.entries()) {
  console.log(`${path}: ${content.slice(0, 100)}...`)
}
```

### Get Diff Tracker

```typescript
// Get diff tracker for advanced operations
const tracker = virtualFilesystem.getDiffTracker()

// Get history for specific file
const history = tracker.getHistory('/test/file.ts')
console.log('Versions:', history?.currentVersion)
console.log('Diffs:', history?.diffs.length)

// Get latest diff
const latestDiff = tracker.getLatestDiff('/test/file.ts')
console.log('Latest change:', latestDiff?.changeType)
```

---

## Environment Configuration

```bash
# .env.local

# Quota Management
QUOTA_E2B_MONTHLY=1000
QUOTA_DAYTONA_MONTHLY=5000
QUOTA_BLAXEL_MONTHLY=5000
QUOTA_SPRITES_MONTHLY=2000

# Rate Limiting
# (API keys: sk-pro-* for premium, sk-ent-* for enterprise)

# Reflection Engine
FAST_AGENT_REFLECTION_ENABLED=true
FAST_AGENT_REFLECTION_MODEL=gpt-4o-mini
FAST_AGENT_REFLECTION_THRESHOLD=0.8
FAST_AGENT_REFLECTION_TIMEOUT=15000

# E2B Desktop
E2B_API_KEY=e2b_your_api_key_here
E2B_DESKTOP_TIMEOUT=300000
E2B_DESKTOP_RESOLUTION_X=1024
E2B_DESKTOP_RESOLUTION_Y=720
E2B_DESKTOP_DPI=96

# Daytona Computer Use
DAYTONA_API_KEY=your_daytona_api_key_here
DAYTONA_COMPUTER_USE_ENABLED=true
DAYTONA_COMPUTER_USE_API_BASE=https://app.daytona.io/api

# Composio MCP
COMPOSIO_API_KEY=your_composio_api_key_here
COMPOSIO_MCP_ENABLED=true
COMPOSIO_MCP_PORT=3001
COMPOSIO_MCP_SERVER_NAME=composio-tools
COMPOSIO_MCP_SERVER_VERSION=1.0.0
```

---

**Documentation Date**: 2026-02-28  
**Status**: ✅ Complete
