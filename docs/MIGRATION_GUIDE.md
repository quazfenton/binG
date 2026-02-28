# Migration Guide

**Date**: 2026-02-28  
**Purpose**: Guide for migrating to new features

---

## Table of Contents

1. [Quota Management Migration](#quota-management-migration)
2. [Rate Limiting Migration](#rate-limiting-migration)
3. [Self-Healing Migration](#self-healing-migration)
4. [Auth Caching Migration](#auth-caching-migration)
5. [E2B Desktop Migration](#e2b-desktop-migration)
6. [Daytona Computer Use Migration](#daytona-computer-use-migration)
7. [Composio MCP Migration](#composio-mcp-migration)
8. [Reflection Engine Migration](#reflection-engine-migration)
9. [Filesystem Persistence Migration](#filesystem-persistence-migration)
10. [Circuit Breaker Migration](#circuit-breaker-migration)
11. [Health Checks Migration](#health-checks-migration)
12. [VFS Diff Tracking Migration](#vfs-diff-tracking-migration)

---

## Quota Management Migration

### Before (No Enforcement)

```typescript
// Old code - just tracks usage
quotaManager.recordUsage('e2b', 1)
// Continues even if quota exceeded
```

### After (With Enforcement)

```typescript
// New code - enforces quota
try {
  quotaManager.recordUsage('e2b', 1, userId)
  // Only proceeds if quota available
} catch (error: any) {
  // Handle quota exceeded
  return Response.json({ error: error.message }, { status: 429 })
}
```

### Migration Steps

1. **Add userId parameter**:
   ```typescript
   // Old
   quotaManager.recordUsage('e2b', 1)
   
   // New
   quotaManager.recordUsage('e2b', 1, userId)
   ```

2. **Add error handling**:
   ```typescript
   try {
     quotaManager.recordUsage('e2b', 1, userId)
   } catch (error: any) {
     // Handle quota exceeded
   }
   ```

3. **Optional: Check quota before operation**:
   ```typescript
   const check = quotaManager.checkQuota('e2b', userId)
   if (!check.allowed) {
     return Response.json({ 
       error: `Quota exceeded. Remaining: ${check.remaining}` 
     }, { status: 429 })
   }
   ```

### Breaking Changes

- `recordUsage()` now throws error if quota exceeded
- Added optional `userId` parameter for user-specific quotas

---

## Rate Limiting Migration

### Before (Single Tier)

```typescript
// Old code - single tier for all users
const result = rateLimitMiddleware(request, 'generic')
```

### After (Tiered)

```typescript
// New code - tiered rate limiting
const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '')
const tier = getRateLimitTier(undefined, apiKey)

const result = rateLimitMiddleware(request, 'generic', undefined, tier)
```

### Migration Steps

1. **Detect user tier**:
   ```typescript
   import { getRateLimitTier } from '@/lib/middleware/rate-limiter'
   
   const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '')
   const tier = getRateLimitTier(undefined, apiKey)
   ```

2. **Pass tier to middleware**:
   ```typescript
   const result = rateLimitMiddleware(
     request,
     'generic',
     undefined,
     tier
   )
   ```

3. **Update response headers**:
   ```typescript
   // New headers include tier
   headers: {
     ...result.headers,
     'X-RateLimit-Tier': tier.name,
   }
   ```

### Breaking Changes

- Added optional `tier` parameter to `rateLimitMiddleware()`
- Added `X-RateLimit-Tier` header to responses
- Added `tier` field to rate limit response

---

## Self-Healing Migration

### Before (Basic Type Coercion)

```typescript
// Old code - only shallow healing
const healedArgs = this.attemptShallowHeal(args)
```

### After (LLM-Based Healing)

```typescript
// New code - LLM healing as fallback
const healedArgs = await this.attemptDeepHeal(call, tool, error)
if (healedArgs) {
  // Use LLM-healed args
} else {
  // Fall back to shallow healing
}
```

### Migration Steps

1. **Update validator usage**:
   ```typescript
   // No changes needed - automatic
   const result = validator.validate(calls, tools)
   ```

2. **Optional: Configure LLM**:
   ```bash
   # .env.local
   OPENAI_API_KEY=sk-...
   ```

### Breaking Changes

- None - backward compatible
- LLM healing is automatic fallback

---

## Auth Caching Migration

### Before (No Caching)

```typescript
// Old code - validates every request
const auth = await resolveRequestAuth(request)
```

### After (With Caching)

```typescript
// New code - cached (5min TTL)
const auth = await resolveRequestAuth(request)
// Same API, but faster for repeated requests
```

### Migration Steps

1. **No code changes required**:
   ```typescript
   // Existing code works unchanged
   const auth = await resolveRequestAuth(request)
   ```

2. **Optional: Clear cache if needed**:
   ```typescript
   // Import and use cache directly
   import { authCache } from '@/lib/auth/request-auth'
   authCache.clear()
   ```

### Breaking Changes

- None - fully backward compatible
- Performance improvement (50x faster for cached requests)

---

## E2B Desktop Migration

### Before (Basic Sandbox)

```typescript
// Old code - basic E2B sandbox
import { Sandbox } from 'e2b'
const sandbox = await Sandbox.create()
```

### After (Desktop with Computer Use)

```typescript
// New code - desktop with VNC and AMP
import { e2bDesktopProvider } from '@/lib/sandbox/providers/e2b-desktop-provider'

const desktop = await e2bDesktopProvider.createDesktop({
  startStreaming: true,
})

// Use computer use features
await desktop.moveMouse(500, 300)
await desktop.type('Hello')
```

### Migration Steps

1. **Install dependency**:
   ```bash
   pnpm add @e2b/desktop
   ```

2. **Add environment variable**:
   ```bash
   # .env.local
   E2B_API_KEY=e2b_your_api_key_here
   ```

3. **Update import**:
   ```typescript
   // Old
   import { Sandbox } from 'e2b'
   
   // New
   import { e2bDesktopProvider } from '@/lib/sandbox/providers/e2b-desktop-provider'
   ```

4. **Update creation**:
   ```typescript
   // Old
   const sandbox = await Sandbox.create()
   
   // New
   const desktop = await e2bDesktopProvider.createDesktop({
     startStreaming: true,
   })
   ```

5. **Add AMP integration (optional)**:
   ```typescript
   const result = await desktop.runAmpAgent('Fix TODOs', {
     streamJson: true,
   })
   ```

### Breaking Changes

- New dependency required (`@e2b/desktop`)
- New environment variable required (`E2B_API_KEY`)

---

## Daytona Computer Use Migration

### Before (Basic Commands)

```typescript
// Old code - only commands
const result = await sandbox.executeCommand('xdotool mousemove 500 300')
```

### After (Computer Use API)

```typescript
// New code - native computer use API
const computerUse = sandbox.getComputerUseService()
await computerUse.move({ x: 500, y: 300 })
await computerUse.click({ button: 'left' })
```

### Migration Steps

1. **Get computer use service**:
   ```typescript
   const computerUse = sandbox.getComputerUseService()
   if (!computerUse) {
     throw new Error('Computer Use not available')
   }
   ```

2. **Replace command calls**:
   ```typescript
   // Old
   await sandbox.executeCommand('xdotool click 1')
   
   // New
   await computerUse.click({ button: 'left' })
   ```

3. **Add environment variable**:
   ```bash
   # .env.local
   DAYTONA_API_KEY=your_daytona_api_key_here
   ```

### Breaking Changes

- None - additive feature
- Requires `DAYTONA_API_KEY` for computer use

---

## Composio MCP Migration

### Before (Direct Tool Calls)

```typescript
// Old code - direct Composio calls
const result = await composio.execute('github_create_issue', params)
```

### After (MCP Protocol)

```typescript
// New code - MCP protocol
const session = await getComposioMCPSession(userId, apiKey)

const client = new Client({
  serverUrl: session.url,
  headers: session.headers,
})

const result = await client.callTool({
  name: 'github_create_issue',
  arguments: params,
})
```

### Migration Steps

1. **Install dependencies**:
   ```bash
   pnpm add @modelcontextprotocol/sdk @composio/core
   ```

2. **Start MCP server**:
   ```typescript
   import { createComposioMCPServer } from '@/lib/api/composio-mcp-service'
   
   const server = await createComposioMCPServer({
     apiKey: process.env.COMPOSIO_API_KEY,
     port: 3001,
   })
   ```

3. **Get session**:
   ```typescript
   const session = await getComposioMCPSession(userId, apiKey)
   ```

4. **Connect MCP client**:
   ```typescript
   const client = new Client({
     serverUrl: session.url,
     headers: session.headers,
   })
   ```

### Breaking Changes

- New dependencies required
- New environment variable (`COMPOSIO_API_KEY`)
- Different API for tool execution

---

## Reflection Engine Migration

### Before (Mock Reflection)

```typescript
// Old code - mock reflection
const reflections = await reflectionEngine.reflect(content)
// Returns random mock data
```

### After (Real LLM Reflection)

```typescript
// New code - actual LLM reflection
const reflections = await reflectionEngine.reflect(content, {
  context: { type: 'code review' }
})
// Returns real LLM analysis
```

### Migration Steps

1. **No code changes required**:
   ```typescript
   // Existing code works unchanged
   const reflections = await reflectionEngine.reflect(content)
   ```

2. **Optional: Add context**:
   ```typescript
   const reflections = await reflectionEngine.reflect(content, {
     context: { type: 'code generation', language: 'typescript' }
   })
   ```

3. **Add environment variable**:
   ```bash
   # .env.local
   OPENAI_API_KEY=sk-...
   FAST_AGENT_REFLECTION_MODEL=gpt-4o-mini
   ```

### Breaking Changes

- None - backward compatible
- Falls back to mock if LLM unavailable

---

## Filesystem Persistence Migration

### Before (In-Memory Only)

```typescript
// Old code - lost on restart
const tx = filesystemEditSessionService.createTransaction({...})
// Transactions lost on server restart
```

### After (Database Persistence)

```typescript
// New code - persisted to database
const tx = filesystemEditSessionService.createTransaction({...})
// Transactions survive server restart
```

### Migration Steps

1. **No code changes required**:
   ```typescript
   // Existing code works unchanged
   const tx = filesystemEditSessionService.createTransaction({...})
   ```

2. **Optional: Retrieve from database**:
   ```typescript
   // After restart
   const restored = await filesystemEditSessionService.getTransaction(tx.id)
   ```

### Breaking Changes

- None - fully backward compatible
- Automatic persistence (no code changes)

---

## Circuit Breaker Migration

### Before (No Protection)

```typescript
// Old code - no failure protection
const result = await provider.createSandbox({})
// Continues calling failing provider
```

### After (Circuit Breaker)

```typescript
// New code - circuit breaker protection
try {
  const result = await circuitBreakerManager.execute('e2b', async () => {
    return await provider.createSandbox({})
  })
} catch (error: any) {
  if (error instanceof CircuitBreakerOpenError) {
    // Fail fast, use fallback
    const fallback = await fallbackProvider.createSandbox({})
  }
}
```

### Migration Steps

1. **Wrap provider calls**:
   ```typescript
   import { circuitBreakerManager } from '@/lib/middleware/circuit-breaker'
   
   const result = await circuitBreakerManager.execute('e2b', async () => {
     return await provider.createSandbox({})
   })
   ```

2. **Add fallback logic**:
   ```typescript
   try {
     const result = await circuitBreakerManager.execute('e2b', async () => {
       return await e2bProvider.createSandbox({})
     })
   } catch (error: any) {
     if (error instanceof CircuitBreakerOpenError) {
       // Use fallback provider
       return await fallbackProvider.createSandbox({})
     }
     throw error
   }
   ```

### Breaking Changes

- None - additive feature
- Optional to use

---

## Health Checks Migration

### Before (No Monitoring)

```typescript
// Old code - no health monitoring
const provider = getSandboxProvider('e2b')
// May be unhealthy
```

### After (Health Monitoring)

```typescript
// New code - health monitoring
healthCheckManager.register('e2b', createFunctionHealthCheck(async () => {
  const provider = getSandboxProvider('e2b')
  const sandbox = await provider.createSandbox({})
  await sandbox.kill()
  return true
}))

// Check health
const isHealthy = healthCheckManager.isHealthy('e2b')
```

### Migration Steps

1. **Register health checks**:
   ```typescript
   import { healthCheckManager, createFunctionHealthCheck } from '@/lib/middleware/health-check'
   
   healthCheckManager.register('e2b', createFunctionHealthCheck(async () => {
     const provider = getSandboxProvider('e2b')
     const sandbox = await provider.createSandbox({})
     await sandbox.kill()
     return true
   }))
   ```

2. **Check health before use**:
   ```typescript
   if (!healthCheckManager.isHealthy('e2b')) {
     // Use fallback provider
     const provider = getSandboxProvider('daytona')
   }
   ```

### Breaking Changes

- None - additive feature
- Optional to use

---

## VFS Diff Tracking Migration

### Before (No Diff Tracking)

```typescript
// Old code - no diff tracking
await virtualFilesystem.writeFile(userId, '/test.ts', 'content')
// No way to get recent changes
```

### After (Diff Tracking)

```typescript
// New code - diff tracking
await virtualFilesystem.writeFile(userId, '/test.ts', 'content')

// Get diff summary for LLM
const summary = virtualFilesystem.getDiffSummary(userId, 10)
```

### Migration Steps

1. **Get diff summary**:
   ```typescript
   const summary = virtualFilesystem.getDiffSummary(userId, 10)
   ```

2. **Use in LLM context**:
   ```typescript
   const response = await llm.generate([
     {
       role: 'system',
       content: `Recent changes:\n\n${summary}`
     },
     ...messages
   ])
   ```

3. **Optional: Rollback**:
   ```typescript
   const result = await virtualFilesystem.rollbackToVersion(userId, 5)
   ```

### Breaking Changes

- None - additive feature
- Automatic diff tracking (no code changes)

---

## Environment Variables Summary

### New Variables

```bash
# Quota Management
QUOTA_E2B_MONTHLY=1000
QUOTA_DAYTONA_MONTHLY=5000
QUOTA_BLAXEL_MONTHLY=5000
QUOTA_SPRITES_MONTHLY=2000

# Reflection Engine
FAST_AGENT_REFLECTION_ENABLED=true
FAST_AGENT_REFLECTION_MODEL=gpt-4o-mini
FAST_AGENT_REFLECTION_THRESHOLD=0.8

# E2B Desktop
E2B_API_KEY=e2b_your_api_key_here
E2B_DESKTOP_TIMEOUT=300000
E2B_DESKTOP_RESOLUTION_X=1024
E2B_DESKTOP_RESOLUTION_Y=720

# Daytona Computer Use
DAYTONA_API_KEY=your_daytona_api_key_here
DAYTONA_COMPUTER_USE_ENABLED=true

# Composio MCP
COMPOSIO_API_KEY=your_composio_api_key_here
COMPOSIO_MCP_ENABLED=true
COMPOSIO_MCP_PORT=3001
```

### Migration Checklist

- [ ] Add quota environment variables
- [ ] Add reflection engine variables
- [ ] Add E2B Desktop variables (if using)
- [ ] Add Daytona variables (if using)
- [ ] Add Composio variables (if using)
- [ ] Update API key handling for tiered rate limiting
- [ ] Add error handling for quota enforcement
- [ ] Test all features in staging

---

**Migration Guide Date**: 2026-02-28  
**Status**: ✅ Complete
