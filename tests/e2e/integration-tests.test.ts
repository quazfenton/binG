/**
 * E2E Integration Tests - Comprehensive Test Suite
 * 
 * Tests for all major modules and integrations:
 * - E2B Desktop Provider
 * - Daytona Provider (LSP, Object Storage, Computer Use)
 * - Sprites Provider
 * - Blaxel Provider
 * - Composio Integration
 * - Virtual Filesystem
 * - Rate Limiter
 * - Circuit Breaker
 * - Health Checks
 * 
 * Run with: pnpm vitest run tests/e2e/integration-tests.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'

// ============================================
// E2B Desktop Provider Tests
// ============================================

describe('E2B Desktop Provider E2E', () => {
  let desktopHandle: any
  let sessionId: string

  beforeEach(() => {
    sessionId = `test-${randomUUID()}`
  })

  afterEach(async () => {
    if (desktopHandle) {
      await desktopHandle.kill().catch(console.error)
    }
  })

  it('should create desktop with VNC streaming', async () => {
    const { e2bDesktopProvider } = await import('@/lib/sandbox/providers/e2b-desktop-provider-enhanced')
    
    desktopHandle = await e2bDesktopProvider.createDesktop({
      startStreaming: true,
    })

    expect(desktopHandle.id).toBeDefined()
    expect(desktopHandle.getStreamUrl()).toBeDefined()
    expect(desktopHandle.getStreamUrl()).toContain('e2b.dev')
  })

  it('should execute mouse operations', async () => {
    const { e2bDesktopProvider } = await import('@/lib/sandbox/providers/e2b-desktop-provider-enhanced')
    
    desktopHandle = await e2bDesktopProvider.createDesktop()

    // Move mouse
    const moveResult = await desktopHandle.moveMouse(500, 300)
    expect(moveResult.success).toBe(true)

    // Click
    const clickResult = await desktopHandle.leftClick()
    expect(clickResult.success).toBe(true)

    // Drag
    const dragResult = await desktopHandle.drag(0, 0, 100, 100)
    expect(dragResult.success).toBe(true)
  })

  it('should execute keyboard operations', async () => {
    const { e2bDesktopProvider } = await import('@/lib/sandbox/providers/e2b-desktop-provider-enhanced')
    
    desktopHandle = await e2bDesktopProvider.createDesktop()

    // Type text
    const typeResult = await desktopHandle.type('Hello World')
    expect(typeResult.success).toBe(true)

    // Press key
    const pressResult = await desktopHandle.press('Enter')
    expect(pressResult.success).toBe(true)

    // Hotkey
    const hotkeyResult = await desktopHandle.hotkey('Control_L', 'c')
    expect(hotkeyResult.success).toBe(true)
  })

  it('should capture screenshots', async () => {
    const { e2bDesktopProvider } = await import('@/lib/sandbox/providers/e2b-desktop-provider-enhanced')
    
    desktopHandle = await e2bDesktopProvider.createDesktop()

    // Screenshot
    const screenshot = await desktopHandle.screenshot()
    expect(screenshot).toBeDefined()
    expect(screenshot.length).toBeGreaterThan(0)

    // Screenshot base64
    const base64 = await desktopHandle.screenshotBase64()
    expect(base64).toBeDefined()
    expect(base64.length).toBeGreaterThan(100)
  })

  it('should run AMP agent with session persistence', async () => {
    const { e2bDesktopProvider } = await import('@/lib/sandbox/providers/e2b-desktop-provider-enhanced')
    
    desktopHandle = await e2bDesktopProvider.createDesktop()

    // Run AMP with session
    const result1 = await desktopHandle.runAmpAgent('Analyze this codebase', {
      streamJson: true,
      systemPrompt: 'You are a helpful coding assistant.',
    })

    expect(result1.success).toBe(true)
    expect(result1.sessionId).toBeDefined()

    // Continue session
    const result2 = await desktopHandle.runAmpAgent('Now implement step 1', {
      sessionId: result1.sessionId,
    })

    expect(result2.success).toBe(true)

    // List sessions
    const sessions = desktopHandle.listAmpSessions()
    expect(sessions.length).toBeGreaterThan(0)
  })

  it('should setup MCP tools', async () => {
    const { e2bDesktopProvider } = await import('@/lib/sandbox/providers/e2b-desktop-provider-enhanced')
    
    desktopHandle = await e2bDesktopProvider.createDesktop()

    // Get MCP info
    const mcpUrl = await desktopHandle.getMcpUrl()
    expect(mcpUrl).toBeDefined()
    expect(mcpUrl).toContain('mcp.')

    const mcpToken = await desktopHandle.getMcpToken()
    expect(mcpToken).toBeDefined()
    expect(mcpToken.length).toBeGreaterThan(0)

    // Setup MCP (will fail without actual API keys, but tests the flow)
    const result = await desktopHandle.setupMCP({
      browserbase: {
        apiKey: 'test-key',
        projectId: 'test-project',
      },
    })

    // Should complete without throwing
    expect(result).toBeDefined()
  })

  it('should run AMP with schema-validated output', async () => {
    const { e2bDesktopProvider } = await import('@/lib/sandbox/providers/e2b-desktop-provider-enhanced')
    
    desktopHandle = await e2bDesktopProvider.createDesktop()

    const schema = {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              severity: { enum: ['low', 'medium', 'high'] },
            },
          },
        },
      },
    }

    const result = await desktopHandle.runAmpAgent('Find security issues', {
      outputSchema: schema,
    })

    expect(result).toBeDefined()
    expect(result.success).toBe(true)
  })
})

// ============================================
// Daytona Provider Tests
// ============================================

describe('Daytona Provider E2E', () => {
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

  it('should create sandbox and get Computer Use service', async () => {
    const { getSandboxProvider } = await import('@/lib/sandbox/providers')
    
    const provider = getSandboxProvider('daytona')
    sandboxHandle = await provider.createSandbox({})

    const computerUse = sandboxHandle.getComputerUseService()
    
    if (process.env.DAYTONA_API_KEY) {
      expect(computerUse).toBeDefined()
    } else {
      expect(computerUse).toBeNull()
    }
  })

  it('should get LSP service', async () => {
    const { getSandboxProvider } = await import('@/lib/sandbox/providers')
    
    const provider = getSandboxProvider('daytona')
    sandboxHandle = await provider.createSandbox({})

    const lsp = sandboxHandle.getLSPService()
    
    if (process.env.DAYTONA_API_KEY) {
      expect(lsp).toBeDefined()
    } else {
      expect(lsp).toBeNull()
    }
  })

  it('should get Object Storage service', async () => {
    const { getSandboxProvider } = await import('@/lib/sandbox/providers')
    
    const provider = getSandboxProvider('daytona')
    sandboxHandle = await provider.createSandbox({})

    const storage = sandboxHandle.getObjectStorageService()
    
    if (process.env.DAYTONA_API_KEY) {
      expect(storage).toBeDefined()
    } else {
      expect(storage).toBeNull()
    }
  })

  it('should use LSP service for completions', async () => {
    const { getSandboxProvider } = await import('@/lib/sandbox/providers')
    
    const provider = getSandboxProvider('daytona')
    sandboxHandle = await provider.createSandbox({})

    const lsp = sandboxHandle.getLSPService()
    
    if (!lsp || !process.env.DAYTONA_API_KEY) {
      return // Skip if no API key
    }

    // Create LSP server
    const createResult = await lsp.create({ language: 'typescript' })
    expect(createResult).toBeDefined()

    // Start LSP server
    const startResult = await lsp.start('typescript')
    expect(startResult).toBeDefined()

    // Get completions
    const completions = await lsp.completions({
      file: '/test.ts',
      line: 10,
      column: 5,
    })

    expect(completions).toBeDefined()
  })

  it('should use Object Storage for file upload/download', async () => {
    const { getSandboxProvider } = await import('@/lib/sandbox/providers')
    
    const provider = getSandboxProvider('daytona')
    sandboxHandle = await provider.createSandbox({})

    const storage = sandboxHandle.getObjectStorageService()
    
    if (!storage || !process.env.DAYTONA_API_KEY) {
      return // Skip if no API key
    }

    // Upload file
    const uploadResult = await storage.upload({
      key: 'test/file.txt',
      content: 'Hello World',
      contentType: 'text/plain',
    })

    expect(uploadResult.success).toBe(true)

    // Download file
    const downloadResult = await storage.download({
      key: 'test/file.txt',
    })

    expect(downloadResult.success).toBe(true)
    expect(downloadResult.data?.content).toBe('Hello World')

    // List objects
    const listResult = await storage.list({ prefix: 'test/' })
    expect(listResult.success).toBe(true)
    expect(listResult.data?.objects.length).toBeGreaterThan(0)

    // Delete object
    const deleteResult = await storage.delete('test/file.txt')
    expect(deleteResult.success).toBe(true)
  })

  it('should use Computer Use service', async () => {
    const { getSandboxProvider } = await import('@/lib/sandbox/providers')
    
    const provider = getSandboxProvider('daytona')
    sandboxHandle = await provider.createSandbox({})

    const computerUse = sandboxHandle.getComputerUseService()
    
    if (!computerUse || !process.env.DAYTONA_API_KEY) {
      return // Skip if no API key
    }

    // Mouse operations
    const clickResult = await computerUse.click({ x: 100, y: 200, button: 'left' })
    expect(clickResult).toBeDefined()

    const moveResult = await computerUse.move({ x: 300, y: 400 })
    expect(moveResult).toBeDefined()

    // Keyboard operations
    const typeResult = await computerUse.type({ text: 'Hello' })
    expect(typeResult).toBeDefined()

    const pressResult = await computerUse.press({ keys: 'Enter' })
    expect(pressResult).toBeDefined()

    // Screenshot
    const screenshotResult = await computerUse.takeFullScreen()
    expect(screenshotResult).toBeDefined()
  })
})

// ============================================
// Security Tests
// ============================================

describe('Security E2E', () => {
  it('should block path traversal attacks', async () => {
    const { resolvePath } = await import('@/lib/sandbox/sandbox-tools')

    // Normal path
    const normal = resolvePath('test/file.txt')
    expect(normal.valid).toBe(true)

    // Path traversal
    const traversal = resolvePath('../etc/passwd')
    expect(traversal.valid).toBe(false)
    expect(traversal.reason).toContain('traversal')

    // Double-encoded path traversal
    const doubleEncoded = resolvePath('%252e%252e%252fetc/passwd')
    expect(doubleEncoded.valid).toBe(false)

    // Unicode homoglyph
    const unicode = resolvePath('/home/%D0%B0%D0%B4%D0%BC%D0%B8%D0%BD/.ssh/id_rsa')
    expect(unicode.valid).toBe(false)
    expect(unicode.reason).toContain('homoglyph')
  })

  it('should block command injection via Unicode', async () => {
    const { validateCommand } = await import('@/lib/sandbox/sandbox-tools')

    // Normal command
    const normal = validateCommand('ls -la')
    expect(normal.valid).toBe(true)

    // Unicode homoglyph attack (Cyrillic 'а' instead of Latin 'a')
    const unicode = validateCommand('cаt /etc/passwd')
    expect(unicode.valid).toBe(false)
    expect(unicode.reason).toContain('homoglyph')

    // Dangerous command
    const dangerous = validateCommand('rm -rf /')
    expect(dangerous.valid).toBe(false)
    expect(dangerous.reason).toContain('dangerous')
  })
})

// ============================================
// Rate Limiter Tests
// ============================================

describe('Rate Limiter E2E', () => {
  it('should enforce rate limits', async () => {
    const { checkRateLimit, RATE_LIMIT_CONFIGS, RATE_LIMIT_TIERS } = await import('@/lib/middleware/rate-limiter')

    const identifier = `test-${randomUUID()}`
    const config = RATE_LIMIT_CONFIGS.generic

    // First request should be allowed
    const result1 = checkRateLimit(identifier, config, RATE_LIMIT_TIERS.free)
    expect(result1.allowed).toBe(true)
    expect(result1.remaining).toBeGreaterThan(0)

    // Exceed limit
    for (let i = 0; i < config.maxRequests + 5; i++) {
      checkRateLimit(identifier, config, RATE_LIMIT_TIERS.free)
    }

    // Should be rate limited
    const resultExceeded = checkRateLimit(identifier, config, RATE_LIMIT_TIERS.free)
    expect(resultExceeded.allowed).toBe(false)
    expect(resultExceeded.remaining).toBe(0)
    expect(resultExceeded.retryAfter).toBeGreaterThan(0)
  })

  it('should apply tier multipliers', async () => {
    const { checkRateLimit, RATE_LIMIT_CONFIGS, RATE_LIMIT_TIERS } = await import('@/lib/middleware/rate-limiter')

    const freeId = `free-${randomUUID()}`
    const premiumId = `premium-${randomUUID()}`
    const config = RATE_LIMIT_CONFIGS.generic

    // Free tier
    const freeResult = checkRateLimit(freeId, config, RATE_LIMIT_TIERS.free)
    expect(freeResult.allowed).toBe(true)

    // Premium tier (10x limit)
    const premiumResult = checkRateLimit(premiumId, config, RATE_LIMIT_TIERS.premium)
    expect(premiumResult.allowed).toBe(true)
    expect(premiumResult.remaining).toBeGreaterThan(freeResult.remaining)
  })

  it('should include Retry-After header', async () => {
    const { rateLimitMiddleware, RATE_LIMIT_CONFIGS, RATE_LIMIT_TIERS } = await import('@/lib/middleware/rate-limiter')

    const identifier = `test-${randomUUID()}`
    const config = RATE_LIMIT_CONFIGS.generic

    // Create mock request
    const mockRequest = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '127.0.0.1',
      },
    })

    // Exceed limit
    for (let i = 0; i < config.maxRequests + 5; i++) {
      rateLimitMiddleware(mockRequest, 'generic', identifier, RATE_LIMIT_TIERS.free)
    }

    // Should get 429 with Retry-After
    const result = rateLimitMiddleware(mockRequest, 'generic', identifier, RATE_LIMIT_TIERS.free)
    expect(result.success).toBe(false)
    
    if (!result.success) {
      const headers = result.response.headers
      expect(headers.get('Retry-After')).toBeDefined()
      expect(parseInt(headers.get('Retry-After') || '0')).toBeGreaterThan(0)
      expect(headers.get('X-RateLimit-Tier')).toBe('free')
    }
  })
})

// ============================================
// Virtual Filesystem Tests
// ============================================

describe('Virtual Filesystem E2E', () => {
  const testOwnerId = `test-${randomUUID()}`

  it('should create and read files', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service')

    // Write file
    const writeResult = await virtualFilesystem.writeFile(testOwnerId, 'test.txt', 'Hello World')
    expect(writeResult.path).toBe('test.txt')
    expect(writeResult.content).toBe('Hello World')

    // Read file
    const readResult = await virtualFilesystem.readFile(testOwnerId, 'test.txt')
    expect(readResult.content).toBe('Hello World')
  })

  it('should track diffs', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service')

    // Create file
    await virtualFilesystem.writeFile(testOwnerId, 'diff-test.txt', 'Version 1')

    // Update file
    await virtualFilesystem.writeFile(testOwnerId, 'diff-test.txt', 'Version 2')

    // Get diff summary
    const summary = virtualFilesystem.getDiffSummary(testOwnerId)
    expect(summary).toBeDefined()
    expect(summary).toContain('diff-test.txt')
  })

  it('should rollback to previous version', async () => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service')

    // Create version 1
    await virtualFilesystem.writeFile(testOwnerId, 'rollback.txt', 'Version 1')

    // Create version 2
    await virtualFilesystem.writeFile(testOwnerId, 'rollback.txt', 'Version 2')

    // Rollback to version 1
    const rollbackResult = await virtualFilesystem.rollbackToVersion(testOwnerId, 1)
    expect(rollbackResult.success).toBe(true)

    // Verify content
    const file = await virtualFilesystem.readFile(testOwnerId, 'rollback.txt')
    expect(file.content).toBe('Version 1')
  })

  it('should persist transactions to database', async () => {
    const { filesystemEditSessionService } = await import('@/lib/virtual-filesystem/filesystem-edit-session-service')

    // Create transaction
    const tx = filesystemEditSessionService.createTransaction({
      ownerId: testOwnerId,
      conversationId: `conv-${randomUUID()}`,
      requestId: `req-${randomUUID()}`,
    })

    tx.operations.push({
      path: '/test/persist.txt',
      operation: 'write',
      newVersion: 1,
      previousVersion: null,
      previousContent: null,
      existedBefore: false,
    })

    // Accept (persists to database)
    filesystemEditSessionService.acceptTransaction(tx.id)

    // Wait for async persistence
    await new Promise(resolve => setTimeout(resolve, 100))

    // Retrieve from database
    const restored = await filesystemEditSessionService.getTransaction(tx.id)
    expect(restored).toBeDefined()
    expect(restored?.id).toBe(tx.id)
  })
})

// ============================================
// Circuit Breaker Tests
// ============================================

describe('Circuit Breaker E2E', () => {
  it('should open circuit after failures', async () => {
    const { circuitBreakerManager, CircuitBreakerOpenError } = await import('@/lib/middleware/circuit-breaker')

    const providerId = `test-${randomUUID()}`

    // Fail multiple times
    for (let i = 0; i < 5; i++) {
      try {
        await circuitBreakerManager.execute(providerId, async () => {
          throw new Error('Test failure')
        })
      } catch (error) {
        // Expected
      }
    }

    // Circuit should be open
    const breaker = circuitBreakerManager.getBreaker(providerId)
    expect(breaker.getState()).toBe('OPEN')

    // Should reject immediately
    await expect(
      circuitBreakerManager.execute(providerId, async () => 'success')
    ).rejects.toThrow(CircuitBreakerOpenError)
  })

  it('should recover after timeout', async () => {
    const { circuitBreakerManager } = await import('@/lib/middleware/circuit-breaker')

    const providerId = `test-${randomUUID()}`
    const breaker = circuitBreakerManager.getBreaker(providerId, {
      failureThreshold: 2,
      timeout: 100, // 100ms timeout
    })

    // Fail to open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('Test failure')
        })
      } catch (error) {
        // Expected
      }
    }

    expect(breaker.getState()).toBe('OPEN')

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150))

    // Should be half-open
    expect(breaker.getState()).toBe('HALF-OPEN')

    // Succeed to close circuit
    await breaker.execute(async () => 'success')
    await breaker.execute(async () => 'success')

    expect(breaker.getState()).toBe('CLOSED')
  })
})

// ============================================
// Health Check Tests
// ============================================

describe('Health Check E2E', () => {
  it('should monitor provider health', async () => {
    const { healthCheckManager, createFunctionHealthCheck } = await import('@/lib/middleware/health-check')

    const providerId = `test-${randomUUID()}`
    let isHealthy = true

    // Register health check
    healthCheckManager.register(providerId, createFunctionHealthCheck(async () => {
      return isHealthy
    }))

    // Wait for check
    await new Promise(resolve => setTimeout(resolve, 150))

    // Should be healthy
    expect(healthCheckManager.isHealthy(providerId)).toBe(true)

    // Make unhealthy
    isHealthy = false

    // Wait for multiple checks
    await new Promise(resolve => setTimeout(resolve, 500))

    // Should be unhealthy
    expect(healthCheckManager.isHealthy(providerId)).toBe(false)
  })

  it('should detect provider recovery', async () => {
    const { healthCheckManager, createFunctionHealthCheck } = await import('@/lib/middleware/health-check')

    const providerId = `test-${randomUUID()}`
    let isHealthy = false

    // Register health check
    healthCheckManager.register(providerId, createFunctionHealthCheck(async () => {
      return isHealthy
    }))

    // Wait for failures
    await new Promise(resolve => setTimeout(resolve, 500))

    expect(healthCheckManager.isHealthy(providerId)).toBe(false)

    // Recover
    isHealthy = true

    // Wait for recovery
    await new Promise(resolve => setTimeout(resolve, 500))

    expect(healthCheckManager.isHealthy(providerId)).toBe(true)
  })
})

// ============================================
// Integration Tests
// ============================================

describe('Module Integration E2E', () => {
  it('should integrate rate limiter with circuit breaker', async () => {
    const { rateLimitMiddleware, RATE_LIMIT_CONFIGS } = await import('@/lib/middleware/rate-limiter')
    const { circuitBreakerManager } = await import('@/lib/middleware/circuit-breaker')

    const providerId = `test-${randomUUID()}`
    const identifier = `user-${randomUUID()}`

    // Create mock request
    const mockRequest = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '127.0.0.1',
      },
    })

    // Rate limit should allow first requests
    const rateLimitResult = rateLimitMiddleware(mockRequest, 'generic', identifier)
    expect(rateLimitResult.success).toBe(true)

    // Circuit breaker should allow requests
    const result = await circuitBreakerManager.execute(providerId, async () => 'success')
    expect(result).toBe('success')
  })

  it('should integrate health checks with circuit breaker', async () => {
    const { healthCheckManager, createFunctionHealthCheck } = await import('@/lib/middleware/health-check')
    const { circuitBreakerManager } = await import('@/lib/middleware/circuit-breaker')

    const providerId = `test-${randomUUID()}`

    // Register health check
    healthCheckManager.register(providerId, createFunctionHealthCheck(async () => {
      return true
    }))

    // Wait for health check
    await new Promise(resolve => setTimeout(resolve, 150))

    // Only execute if healthy
    if (healthCheckManager.isHealthy(providerId)) {
      const result = await circuitBreakerManager.execute(providerId, async () => 'success')
      expect(result).toBe('success')
    }
  })
})
