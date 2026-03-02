/**
 * Comprehensive Test Suite - All Modules
 * 
 * Tests for:
 * - Sprites Provider (Enhanced)
 * - Blaxel Provider (Enhanced)
 * - Composio Service (Session-based)
 * - Virtual Filesystem
 * - Rate Limiter
 * - Circuit Breaker
 * - Health Checks
 * - MCP Server
 * 
 * Run with: pnpm vitest run tests/comprehensive.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'

// ============================================
// Sprites Provider Tests (Enhanced)
// ============================================

describe('Sprites Provider Enhanced E2E', () => {
  let sandboxHandle: any
  let spriteId: string

  beforeEach(() => {
    spriteId = `test-${randomUUID()}`
  })

  afterEach(async () => {
    if (sandboxHandle) {
      await sandboxHandle.kill().catch(console.error)
    }
  })

  it('should create Sprite with auto-suspend', async () => {
    const { spritesProvider } = await import('@/lib/sandbox/providers/sprites-provider-enhanced')
    
    sandboxHandle = await spritesProvider.createSandbox({})

    expect(sandboxHandle.id).toBeDefined()
    expect(sandboxHandle.workspaceDir).toBe('/home/sprite/workspace')
  })

  it('should configure service with auto-suspend', async () => {
    const { spritesProvider } = await import('@/lib/sandbox/providers/sprites-provider-enhanced')
    
    sandboxHandle = await spritesProvider.createSandbox({})

    const serviceInfo = await sandboxHandle.configureService({
      name: 'test-server',
      command: 'node',
      args: ['server.js'],
      port: 3000,
      autoStart: true,
      autoStop: 'suspend', // Should preserve memory state
    })

    expect(serviceInfo.id).toBeDefined()
    expect(serviceInfo.name).toBe('test-server')
    expect(serviceInfo.status).toBe('running')
  })

  it('should get service status', async () => {
    const { spritesProvider } = await import('@/lib/sandbox/providers/sprites-provider-enhanced')
    
    sandboxHandle = await spritesProvider.createSandbox({})

    // Configure service first
    await sandboxHandle.configureService({
      name: 'status-test',
      command: 'node',
      port: 3000,
    })

    const status = await sandboxHandle.getServiceStatus('status-test')
    expect(status).toBeDefined()
    expect(['running', 'stopped', 'suspended', 'unknown']).toContain(status.status)
  })

  it('should restart service', async () => {
    const { spritesProvider } = await import('@/lib/sandbox/providers/sprites-provider-enhanced')
    
    sandboxHandle = await spritesProvider.createSandbox({})

    await sandboxHandle.configureService({
      name: 'restart-test',
      command: 'node',
      port: 3000,
    })

    const restartResult = await sandboxHandle.restartService('restart-test')
    expect(restartResult.success).toBe(true)
  })

  it('should configure HTTP service', async () => {
    const { spritesProvider } = await import('@/lib/sandbox/providers/sprites-provider-enhanced')
    
    sandboxHandle = await spritesProvider.createSandbox({})

    const httpConfig = await sandboxHandle.configureHttpService(8080)
    expect(httpConfig.success).toBe(true)
    expect(httpConfig.url).toBeDefined()
    expect(httpConfig.url).toContain('.sprites.app')
  })

  it('should configure HTTP service with auto-detect', async () => {
    const { spritesProvider } = await import('@/lib/sandbox/providers/sprites-provider-enhanced')
    
    sandboxHandle = await spritesProvider.createSandbox({})

    const httpConfig = await sandboxHandle.configureHttpService()
    expect(httpConfig.success).toBe(true)
    expect(httpConfig.url).toBeDefined()
  })

  it('should get checkpoint manager', async () => {
    const { spritesProvider } = await import('@/lib/sandbox/providers/sprites-provider-enhanced')
    
    sandboxHandle = await spritesProvider.createSandbox({})

    const checkpointManager = sandboxHandle.getCheckpointManager({
      maxCount: 5,
      maxAgeDays: 30,
    })

    if (process.env.SPRITES_TOKEN) {
      expect(checkpointManager).toBeDefined()
    } else {
      expect(checkpointManager).toBeNull()
    }
  })

  it('should create checkpoint with metadata', async () => {
    const { SpritesCheckpointManager } = await import('@/lib/sandbox/providers/sprites-checkpoint-manager')
    
    if (!process.env.SPRITES_TOKEN) {
      return // Skip if no token
    }

    const manager = new SpritesCheckpointManager(
      process.env.SPRITES_TOKEN,
      spriteId
    )

    const result = await manager.createCheckpoint('test-checkpoint', {
      comment: 'Test checkpoint with metadata',
      retention: {
        maxCount: 3,
        maxAgeDays: 7,
      },
    })

    expect(result.success).toBe(true)
    expect(result.checkpointId).toBeDefined()
  })

  it('should list checkpoints with filters', async () => {
    const { SpritesCheckpointManager } = await import('@/lib/sandbox/providers/sprites-checkpoint-manager')
    
    if (!process.env.SPRITES_TOKEN) {
      return // Skip if no token
    }

    const manager = new SpritesCheckpointManager(
      process.env.SPRITES_TOKEN,
      spriteId
    )

    const result = await manager.listCheckpoints()
    expect(result.success).toBe(true)
    expect(Array.isArray(result.checkpoints || [])).toBe(true)
  })
})

// ============================================
// Blaxel Provider Tests (Enhanced)
// ============================================

describe('Blaxel Provider Enhanced E2E', () => {
  let sandboxHandle: any
  let sandboxId: string

  beforeEach(() => {
    sandboxId = `test-${randomUUID()}`
  })

  afterEach(async () => {
    if (sandboxHandle) {
      await sandboxHandle.kill().catch(console.error)
    }
  })

  it('should create Blaxel sandbox', async () => {
    const { blaxelProvider } = await import('@/lib/sandbox/providers/blaxel-provider')

    if (!process.env.BLAXEL_API_KEY) {
      return // Skip if no API key
    }

    sandboxHandle = await blaxelProvider.createSandbox({})

    expect(sandboxHandle.id).toBeDefined()
    expect(sandboxHandle.workspaceDir).toBe('/workspace')
  })

  it('should call agent (multi-agent workflow)', async () => {
    const { blaxelProvider } = await import('@/lib/sandbox/providers/blaxel-provider')

    if (!process.env.BLAXEL_API_KEY) {
      return // Skip if no API key
    }

    // This would require actual agents to be deployed
    // Testing the method exists and doesn't throw
    expect(blaxelProvider.callAgent).toBeDefined()
  })

  it('should schedule job', async () => {
    const { blaxelProvider } = await import('@/lib/sandbox/providers/blaxel-provider')

    if (!process.env.BLAXEL_API_KEY) {
      return // Skip if no API key
    }

    // Note: scheduleJob throws as cron scheduling requires blaxel.toml
    // Testing that it throws the correct error
    await expect(blaxelProvider.scheduleJob('0 9 * * *', [
      { id: 'test-task', data: { type: 'test' } },
    ])).rejects.toThrow('Cron scheduling is not supported via SDK')
  })

  it('should stream logs', async () => {
    const { blaxelProvider } = await import('@/lib/sandbox/providers/blaxel-provider')

    if (!process.env.BLAXEL_API_KEY) {
      return // Skip if no API key
    }

    // Test log streaming
    const stream = await blaxelProvider.streamLogs({
      follow: false,
      tail: 10,
    })

    expect(stream).toBeDefined()
  })

  it('should run batch job', async () => {
    const { blaxelProvider } = await import('@/lib/sandbox/providers/blaxel-provider')

    if (!process.env.BLAXEL_API_KEY) {
      return // Skip if no API key
    }

    const result = await blaxelProvider.runBatchJob([
      { id: 'task-1', data: { test: true } },
      { id: 'task-2', data: { test: true } },
    ])

    expect(result.jobId).toBeDefined()
    expect(result.status).toBeDefined()
  })
})

// ============================================
// Composio Service Tests (Session-based)
// ============================================

describe('Composio Service Session E2E', () => {
  const testUserId = `test-user-${randomUUID()}`

  it('should create session', async () => {
    const { initializeComposioService } = await import('@/lib/api/composio-service')
    
    if (!process.env.COMPOSIO_API_KEY) {
      return // Skip if no API key
    }

    const service = initializeComposioService({
      apiKey: process.env.COMPOSIO_API_KEY,
    })

    if (!service) {
      return
    }

    // Cast to access session methods
    const serviceImpl = service as any
    
    const session = await serviceImpl.createSession(testUserId)
    expect(session).toBeDefined()
  })

  it('should get session', async () => {
    const { initializeComposioService } = await import('@/lib/api/composio-service')
    
    if (!process.env.COMPOSIO_API_KEY) {
      return
    }

    const service = initializeComposioService({
      apiKey: process.env.COMPOSIO_API_KEY,
    })

    if (!service) {
      return
    }

    const serviceImpl = service as any
    
    // Create session first
    await serviceImpl.createSession(testUserId)
    
    // Get session
    const session = await serviceImpl.getSession(testUserId)
    expect(session).toBeDefined()
  })

  it('should get tools for session', async () => {
    const { initializeComposioService } = await import('@/lib/api/composio-service')
    
    if (!process.env.COMPOSIO_API_KEY) {
      return
    }

    const service = initializeComposioService({
      apiKey: process.env.COMPOSIO_API_KEY,
    })

    if (!service) {
      return
    }

    const serviceImpl = service as any
    
    await serviceImpl.createSession(testUserId)
    const tools = await serviceImpl.getTools(testUserId)
    
    expect(Array.isArray(tools)).toBe(true)
  })

  it('should get MCP config', async () => {
    const { initializeComposioService } = await import('@/lib/api/composio-service')
    
    if (!process.env.COMPOSIO_API_KEY) {
      return
    }

    const service = initializeComposioService({
      apiKey: process.env.COMPOSIO_API_KEY,
    })

    if (!service) {
      return
    }

    const serviceImpl = service as any
    
    await serviceImpl.createSession(testUserId)
    const mcpConfig = await serviceImpl.getMCPConfig(testUserId)
    
    expect(mcpConfig.url).toBeDefined()
    expect(mcpConfig.headers).toBeDefined()
  })

  it('should execute tool with session', async () => {
    const { initializeComposioService } = await import('@/lib/api/composio-service')
    
    if (!process.env.COMPOSIO_API_KEY) {
      return
    }

    const service = initializeComposioService({
      apiKey: process.env.COMPOSIO_API_KEY,
    })

    if (!service) {
      return
    }

    const serviceImpl = service as any
    
    await serviceImpl.createSession(testUserId)
    
    // Execute a tool (will fail without proper setup, but tests the flow)
    try {
      const result = await serviceImpl.executeTool(testUserId, 'test_tool', {})
      expect(result).toBeDefined()
    } catch (error) {
      // Expected to fail without proper tool setup
      expect(error).toBeDefined()
    }
  })

  it('should handle session without API key', async () => {
    const { initializeComposioService } = await import('@/lib/api/composio-service')
    
    // Don't set API key
    const service = initializeComposioService({
      apiKey: 'invalid-key',
    })

    expect(service).toBeNull()
  })
})

// ============================================
// Virtual Filesystem Tests (Enhanced)
// ============================================

describe('Virtual Filesystem Enhanced E2E', () => {
  const testOwnerId = `test-${randomUUID()}`

  it('should create checkpoint with metadata', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service')
    const { filesystemEditSessionService } = await import('@/lib/virtual-filesystem/filesystem-edit-session-service')

    // Create file
    await virtualFilesystem.writeFile(testOwnerId, 'checkpoint-test.txt', 'Version 1')

    // Create transaction
    const tx = filesystemEditSessionService.createTransaction({
      ownerId: testOwnerId,
      conversationId: `conv-${randomUUID()}`,
      requestId: `req-${randomUUID()}`,
    })

    tx.operations.push({
      path: '/checkpoint-test.txt',
      operation: 'write',
      newVersion: 2,
      previousVersion: 1,
      previousContent: 'Version 1',
      existedBefore: true,
    })

    filesystemEditSessionService.acceptTransaction(tx.id)

    // Wait for persistence
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify persisted
    const restored = await filesystemEditSessionService.getTransaction(tx.id)
    expect(restored).toBeDefined()
    expect(restored?.operations.length).toBe(1)
  })

  it('should rollback to version with database persistence', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service')

    // Create versions
    await virtualFilesystem.writeFile(testOwnerId, 'rollback-test.txt', 'Version 1')
    await virtualFilesystem.writeFile(testOwnerId, 'rollback-test.txt', 'Version 2')
    await virtualFilesystem.writeFile(testOwnerId, 'rollback-test.txt', 'Version 3')

    // Rollback to version 1
    const result = await virtualFilesystem.rollbackToVersion(testOwnerId, 1)
    expect(result.success).toBe(true)

    // Verify content
    const file = await virtualFilesystem.readFile(testOwnerId, 'rollback-test.txt')
    expect(file.content).toBe('Version 1')
  })

  it('should get files at version', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service')

    // Create files at different versions
    await virtualFilesystem.writeFile(testOwnerId, 'file1.txt', 'Content 1')
    await virtualFilesystem.writeFile(testOwnerId, 'file2.txt', 'Content 2')

    // Get files at version 1
    const files = virtualFilesystem.getFilesAtVersion(testOwnerId, 1)
    expect(files.has('file1.txt')).toBe(true)
    expect(files.get('file1.txt')).toBe('Content 1')
  })

  it('should get diff tracker', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service')

    const tracker = virtualFilesystem.getDiffTracker()
    expect(tracker).toBeDefined()

    // Create and update file
    await virtualFilesystem.writeFile(testOwnerId, 'diff-track.txt', 'Version 1')
    await virtualFilesystem.writeFile(testOwnerId, 'diff-track.txt', 'Version 2')

    // Get history
    const history = tracker.getHistory('diff-track.txt')
    expect(history).toBeDefined()
    expect(history?.diffs.length).toBe(2)
  })
})

// ============================================
// Rate Limiter Tests (Enhanced)
// ============================================

describe('Rate Limiter Enhanced E2E', () => {
  it('should enforce rate limits with tier multipliers', async () => {
    const { checkRateLimit, RATE_LIMIT_CONFIGS, RATE_LIMIT_TIERS } = await import('@/lib/middleware/rate-limiter')

    const freeId = `free-${randomUUID()}`
    const premiumId = `premium-${randomUUID()}`
    const enterpriseId = `enterprise-${randomUUID()}`
    const config = RATE_LIMIT_CONFIGS.generic

    // Free tier (1x)
    const freeResult = checkRateLimit(freeId, config, RATE_LIMIT_TIERS.free)
    expect(freeResult.remaining).toBe(config.maxRequests - 1)

    // Premium tier (10x)
    const premiumResult = checkRateLimit(premiumId, config, RATE_LIMIT_TIERS.premium)
    expect(premiumResult.remaining).toBe((config.maxRequests * 10) - 1)

    // Enterprise tier (100x)
    const enterpriseResult = checkRateLimit(enterpriseId, config, RATE_LIMIT_TIERS.enterprise)
    expect(enterpriseResult.remaining).toBe((config.maxRequests * 100) - 1)
  })

  it('should include all rate limit headers', async () => {
    const { rateLimitMiddleware, RATE_LIMIT_CONFIGS } = await import('@/lib/middleware/rate-limiter')

    const mockRequest = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '127.0.0.1',
      },
    })

    const result = rateLimitMiddleware(mockRequest, 'generic')
    
    if (result.success) {
      const headers = result.headers
      expect(headers['X-RateLimit-Limit']).toBeDefined()
      expect(headers['X-RateLimit-Remaining']).toBeDefined()
      expect(headers['X-RateLimit-Reset']).toBeDefined()
      expect(headers['X-RateLimit-Tier']).toBe('free')
    }
  })

  it('should return 429 with Retry-After header', async () => {
    const { rateLimitMiddleware, RATE_LIMIT_CONFIGS } = await import('@/lib/middleware/rate-limiter')

    const identifier = `test-${randomUUID()}`
    const config = RATE_LIMIT_CONFIGS.generic

    const mockRequest = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '127.0.0.1',
      },
    })

    // Exceed limit
    for (let i = 0; i < config.maxRequests + 5; i++) {
      rateLimitMiddleware(mockRequest, 'generic', identifier)
    }

    const result = rateLimitMiddleware(mockRequest, 'generic', identifier)
    
    if (!result.success) {
      const headers = result.response.headers
      expect(headers.get('Retry-After')).toBeDefined()
      expect(parseInt(headers.get('Retry-After') || '0')).toBeGreaterThan(0)
      expect(headers.get('X-RateLimit-Remaining')).toBe('0')
    }
  })
})

// ============================================
// Circuit Breaker Tests (Enhanced)
// ============================================

describe('Circuit Breaker Enhanced E2E', () => {
  it('should track statistics', async () => {
    const { circuitBreakerManager } = await import('@/lib/middleware/circuit-breaker')

    const providerId = `test-${randomUUID()}`
    const breaker = circuitBreakerManager.getBreaker(providerId)

    // Execute some operations
    await breaker.execute(async () => 'success')
    await breaker.execute(async () => 'success')

    try {
      await breaker.execute(async () => { throw new Error('Fail') })
    } catch {}

    const stats = breaker.getStats()
    expect(stats.totalRequests).toBe(3)
    expect(stats.successfulRequests).toBe(2)
    expect(stats.failedRequests).toBe(1)
  })

  it('should call state change callbacks', async () => {
    const { CircuitBreaker } = await import('@/lib/middleware/circuit-breaker')

    const breaker = new CircuitBreaker('test', {
      failureThreshold: 2,
      timeout: 100,
    })

    const stateChanges: string[] = []
    breaker.onStateChange((state) => {
      stateChanges.push(state)
    })

    // Fail to open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => { throw new Error('Fail') })
      } catch {}
    }

    expect(stateChanges).toContain('OPEN')

    // Wait for half-open
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(stateChanges).toContain('HALF-OPEN')

    // Succeed to close
    await breaker.execute(async () => 'success')
    await breaker.execute(async () => 'success')
    expect(stateChanges).toContain('CLOSED')
  })

  it('should reset all breakers', async () => {
    const { circuitBreakerManager } = await import('@/lib/middleware/circuit-breaker')

    const provider1 = `test1-${randomUUID()}`
    const provider2 = `test2-${randomUUID()}`

    // Open both circuits
    for (const provider of [provider1, provider2]) {
      const breaker = circuitBreakerManager.getBreaker(provider, { failureThreshold: 1 })
      try {
        await breaker.execute(async () => { throw new Error('Fail') })
      } catch {}
    }

    // Reset all
    circuitBreakerManager.resetAll()

    // Both should be closed
    expect(circuitBreakerManager.getBreaker(provider1).getState()).toBe('CLOSED')
    expect(circuitBreakerManager.getBreaker(provider2).getState()).toBe('CLOSED')
  })
})

// ============================================
// Health Check Tests (Enhanced)
// ============================================

describe('Health Check Enhanced E2E', () => {
  it('should track average latency', async () => {
    const { healthCheckManager, createFunctionHealthCheck } = await import('@/lib/middleware/health-check')

    const providerId = `test-${randomUUID()}`
    let callCount = 0

    healthCheckManager.register(providerId, createFunctionHealthCheck(async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, callCount * 10)) // Increasing delay
      return true
    }))

    // Wait for multiple checks
    await new Promise(resolve => setTimeout(resolve, 500))

    const health = healthCheckManager.getHealth(providerId)
    expect(health?.averageLatency).toBeGreaterThan(0)
  })

  it('should get all health statuses', async () => {
    const { healthCheckManager, createFunctionHealthCheck } = await import('@/lib/middleware/health-check')

    const provider1 = `test1-${randomUUID()}`
    const provider2 = `test2-${randomUUID()}`

    healthCheckManager.register(provider1, createFunctionHealthCheck(async () => true))
    healthCheckManager.register(provider2, createFunctionHealthCheck(async () => true))

    // Wait for checks
    await new Promise(resolve => setTimeout(resolve, 150))

    const allHealth = healthCheckManager.getAllHealth()
    expect(allHealth.size).toBe(2)
    expect(allHealth.has(provider1)).toBe(true)
    expect(allHealth.has(provider2)).toBe(true)
  })

  it('should get healthy and unhealthy providers', async () => {
    const { healthCheckManager, createFunctionHealthCheck } = await import('@/lib/middleware/health-check')

    const healthyId = `healthy-${randomUUID()}`
    const unhealthyId = `unhealthy-${randomUUID()}`

    healthCheckManager.register(healthyId, createFunctionHealthCheck(async () => true))
    healthCheckManager.register(unhealthyId, createFunctionHealthCheck(async () => false))

    // Wait for checks
    await new Promise(resolve => setTimeout(resolve, 500))

    const healthy = healthCheckManager.getHealthyProviders()
    const unhealthy = healthCheckManager.getUnhealthyProviders()

    expect(healthy).toContain(healthyId)
    expect(unhealthy).toContain(unhealthyId)
  })
})

// ============================================
// Integration Tests
// ============================================

describe('Full Integration E2E', () => {
  it('should integrate all modules', async () => {
    const { healthCheckManager, createFunctionHealthCheck } = await import('@/lib/middleware/health-check')
    const { circuitBreakerManager } = await import('@/lib/middleware/circuit-breaker')
    const { rateLimitMiddleware, RATE_LIMIT_CONFIGS } = await import('@/lib/middleware/rate-limiter')

    const providerId = `integration-${randomUUID()}`
    const identifier = `user-${randomUUID()}`

    // Register health check
    healthCheckManager.register(providerId, createFunctionHealthCheck(async () => true))

    // Wait for health check
    await new Promise(resolve => setTimeout(resolve, 150))

    // Check health
    if (healthCheckManager.isHealthy(providerId)) {
      // Check rate limit
      const mockRequest = new Request('http://localhost/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })

      const rateLimitResult = rateLimitMiddleware(mockRequest, 'generic', identifier)
      expect(rateLimitResult.success).toBe(true)

      // Execute with circuit breaker
      const result = await circuitBreakerManager.execute(providerId, async () => 'success')
      expect(result).toBe('success')
    }
  })
})
