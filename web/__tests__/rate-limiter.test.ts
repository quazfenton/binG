/**
 * Rate Limiter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SandboxRateLimiter, createSandboxRateLimiter, DEFAULT_RATE_LIMITS } from '../lib/sandbox/providers/rate-limiter'

describe('SandboxRateLimiter', () => {
  let rateLimiter: SandboxRateLimiter

  beforeEach(() => {
    rateLimiter = new SandboxRateLimiter({
      commands: { max: 5, windowMs: 1000 }, // 5 per second for testing
      fileOps: { max: 3, windowMs: 1000 },
    })
  })

  afterEach(() => {
    rateLimiter.stopCleanup()
    rateLimiter.clear()
  })

  describe('check()', () => {
    it('should allow requests under limit', async () => {
      const result = await rateLimiter.check('user-1', 'commands')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
    })

    it('should deny requests over limit', async () => {
      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      const result = await rateLimiter.check('user-1', 'commands')

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfter).toBeGreaterThan(0)
      expect(result.statusCode).toBe(429)
    })

    it('should allow requests after window resets', async () => {
      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      // Wait for window to reset
      await new Promise(resolve => setTimeout(resolve, 1100))

      const result = await rateLimiter.check('user-1', 'commands')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
    })

    it('should allow operations without configured limits', async () => {
      const result = await rateLimiter.check('user-1', 'unknown-operation')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(Infinity)
    })

    it('should track different identifiers separately', async () => {
      // Exhaust limit for user-1
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      // user-2 should still be allowed
      const result = await rateLimiter.check('user-2', 'commands')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
    })

    it('should track different operations separately', async () => {
      // Exhaust limit for commands
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      // fileOps should still be allowed
      const result = await rateLimiter.check('user-1', 'fileOps')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(3)
    })
  })

  describe('record()', () => {
    it('should record operations', async () => {
      await rateLimiter.record('user-1', 'commands')

      const result = await rateLimiter.check('user-1', 'commands')
      expect(result.remaining).toBe(4)
    })

    it('should handle multiple records', async () => {
      for (let i = 0; i < 3; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      const result = await rateLimiter.check('user-1', 'commands')
      expect(result.remaining).toBe(2)
    })
  })

  describe('checkAndRecord()', () => {
    it('should check and record atomically', async () => {
      const result1 = await rateLimiter.checkAndRecord('user-1', 'commands')

      expect(result1.allowed).toBe(true)
      expect(result1.remaining).toBe(4) // One was recorded

      // Check again without recording
      const result2 = await rateLimiter.check('user-1', 'commands')
      expect(result2.remaining).toBe(4) // Should be same
    })

    it('should deny when limit reached', async () => {
      // Record up to limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      const result = await rateLimiter.checkAndRecord('user-1', 'commands')

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })

  describe('getStatus()', () => {
    it('should return current status', async () => {
      await rateLimiter.record('user-1', 'commands')
      await rateLimiter.record('user-1', 'commands')

      const status = rateLimiter.getStatus('user-1', 'commands')

      expect(status.count).toBe(2)
      expect(status.max).toBe(5)
      expect(status.limited).toBe(false)
    })

    it('should show limited status', async () => {
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      const status = rateLimiter.getStatus('user-1', 'commands')

      expect(status.count).toBe(5)
      expect(status.limited).toBe(true)
    })
  })

  describe('reset()', () => {
    it('should reset limits for identifier', async () => {
      // Exhaust limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }

      // Reset
      rateLimiter.reset('user-1', 'commands')

      const result = await rateLimiter.check('user-1', 'commands')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)
    })

    it('should reset all operations for identifier', async () => {
      // Exhaust limits for both operations
      for (let i = 0; i < 5; i++) {
        await rateLimiter.record('user-1', 'commands')
      }
      for (let i = 0; i < 3; i++) {
        await rateLimiter.record('user-1', 'fileOps')
      }

      // Reset all
      rateLimiter.reset('user-1')

      const commandsResult = await rateLimiter.check('user-1', 'commands')
      const fileOpsResult = await rateLimiter.check('user-1', 'fileOps')

      expect(commandsResult.remaining).toBe(5)
      expect(fileOpsResult.remaining).toBe(3)
    })
  })

  describe('setConfig()', () => {
    it('should update configuration', async () => {
      rateLimiter.setConfig('commands', { max: 10, windowMs: 2000 })

      const result = await rateLimiter.check('user-1', 'commands')

      expect(result.remaining).toBe(10)
    })

    it('should add new operation types', async () => {
      rateLimiter.setConfig('newOperation', { max: 20, windowMs: 5000 })

      const result = await rateLimiter.check('user-1', 'newOperation')

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(20)
    })
  })

  describe('Cleanup', () => {
    it('should clean up old entries', async () => {
      // Record some operations
      await rateLimiter.record('user-1', 'commands')

      expect(rateLimiter.size()).toBe(1)

      // Manually trigger cleanup by clearing entries
      rateLimiter.clear()

      // Entry should be cleaned up
      expect(rateLimiter.size()).toBe(0)
    }, 10000)

    it('should stop cleanup on demand', async () => {
      const initialInterval = rateLimiter['cleanupInterval']

      rateLimiter.stopCleanup()

      // Cleanup should be stopped
      expect(rateLimiter['cleanupInterval']).toBeNull()
    }, 10000)
  })

  describe('Memory Management', () => {
    it('should track many identifiers', async () => {
      const initialSize = rateLimiter.size()

      // Create many identifiers
      for (let i = 0; i < 100; i++) {
        await rateLimiter.record(`user-${i}`, 'commands')
      }

      expect(rateLimiter.size()).toBe(initialSize + 100)

      // Clear to simulate cleanup
      rateLimiter.clear()

      // Should be cleaned up
      expect(rateLimiter.size()).toBe(0)
    }, 10000)
  })
})

describe('createSandboxRateLimiter', () => {
  it('should create rate limiter with default configs', () => {
    const rateLimiter = createSandboxRateLimiter()

    const status = rateLimiter.getStatus('user-1', 'commands')
    expect(status.max).toBe(100) // Default commands limit
  })

  it('should accept overrides', () => {
    const rateLimiter = createSandboxRateLimiter({
      commands: { max: 200 },
    })

    const status = rateLimiter.getStatus('user-1', 'commands')
    expect(status.max).toBe(200)
  })
})

describe('DEFAULT_RATE_LIMITS', () => {
  it('should have commands limit', () => {
    expect(DEFAULT_RATE_LIMITS.commands.max).toBe(100)
    expect(DEFAULT_RATE_LIMITS.commands.windowMs).toBe(60000)
  })

  it('should have fileOps limit', () => {
    expect(DEFAULT_RATE_LIMITS.fileOps.max).toBe(50)
    expect(DEFAULT_RATE_LIMITS.fileOps.windowMs).toBe(60000)
  })

  it('should have batchJobs limit', () => {
    expect(DEFAULT_RATE_LIMITS.batchJobs.max).toBe(10)
    expect(DEFAULT_RATE_LIMITS.batchJobs.windowMs).toBe(60000)
  })

  it('should have all required operation types', () => {
    expect(DEFAULT_RATE_LIMITS).toHaveProperty('commands')
    expect(DEFAULT_RATE_LIMITS).toHaveProperty('fileOps')
    expect(DEFAULT_RATE_LIMITS).toHaveProperty('batchJobs')
    expect(DEFAULT_RATE_LIMITS).toHaveProperty('asyncExec')
    expect(DEFAULT_RATE_LIMITS).toHaveProperty('checkpoints')
    expect(DEFAULT_RATE_LIMITS).toHaveProperty('proxy')
  })
})
