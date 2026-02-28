/**
 * Blaxel Provider Enhanced Tests
 *
 * Tests for Blaxel advanced features:
 * - Async execution with verified callbacks
 * - Log streaming
 * - Callback middleware
 */

// Mock Blaxel SDK - must be before imports
vi.mock('@blaxel/core', async () => {
  const actual = await vi.importActual('@blaxel/core');
  const mockClient = {
    sandboxes: {
      create: vi.fn().mockResolvedValue({ name: 'test-sandbox' }),
      get: vi.fn().mockResolvedValue({ name: 'test-sandbox' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
  
  return {
    ...(actual || {}),
    default: vi.fn().mockImplementation(() => mockClient),
    BlaxelClient: vi.fn().mockImplementation(() => mockClient),
  };
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { BlaxelProvider, verifyCallbackSignature, verifyCallbackMiddleware } from '../lib/sandbox/providers/blaxel-provider'

describe('Blaxel Provider - Enhanced Features', () => {
  let provider: BlaxelProvider
  let mockSandbox: any

  beforeEach(() => {
    vi.stubEnv('BLAXEL_API_KEY', 'test-api-key')
    vi.stubEnv('BLAXEL_WORKSPACE', 'test-workspace')
    vi.stubEnv('BLAXEL_CALLBACK_SECRET', 'test-secret')

    mockSandbox = {
      metadata: {
        name: 'test-sandbox',
        url: 'https://test-sandbox.blaxel.ai',
        region: 'us-pdx-1',
        status: 'DEPLOYED',
      },
      fs: {
        write: vi.fn(),
        read: vi.fn(),
      },
      run: vi.fn(),
      delete: vi.fn(),
    }

    provider = new BlaxelProvider()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  describe('executeAsyncWithVerifiedCallback', () => {
    it('should execute async with callback secret storage', async () => {
      // Mock fetch for async execution
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ executionId: 'exec-123' }),
      })

      const handle = await provider.createSandbox({})
      
      // Access the executeAsyncWithVerifiedCallback method
      if (handle.executeAsyncWithVerifiedCallback) {
        const result = await handle.executeAsyncWithVerifiedCallback({
          command: 'npm run build',
          callbackUrl: 'https://my-app.com/api/callback',
          callbackSecret: 'test-secret',
        })

        expect(result.executionId).toBe('exec-123')
        expect(result.verified).toBe(true)
      }
    })

    it('should execute async without verification if no secret provided', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ executionId: 'exec-456' }),
      })

      const handle = await provider.createSandbox({})
      
      if (handle.executeAsyncWithVerifiedCallback) {
        const result = await handle.executeAsyncWithVerifiedCallback({
          command: 'npm test',
          callbackUrl: 'https://my-app.com/api/callback',
        })

        expect(result.executionId).toBe('exec-456')
        expect(result.verified).toBe(false)
      }
    })
  })

  describe('streamLogs', () => {
    it('should create log stream iterator', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('2024-01-01T00:00:00.000Z Starting application\n'))
          controller.enqueue(new TextEncoder().encode('2024-01-01T00:00:01.000Z Application ready\n'))
          controller.close()
        },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      })

      const handle = await provider.createSandbox({})
      
      if (handle.streamLogs) {
        const logStream = await handle.streamLogs({ follow: false, tail: 100 })
        
        const logs: any[] = []
        for await (const log of logStream) {
          logs.push(log)
        }

        expect(logs.length).toBe(2)
        expect(logs[0].message).toContain('Starting application')
        expect(logs[1].message).toContain('Application ready')
      }
    })

    it('should handle log streaming errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
      })

      const handle = await provider.createSandbox({})
      
      if (handle.streamLogs) {
        await expect(handle.streamLogs()).rejects.toThrow('HTTP 401: Unauthorized')
      }
    })

    it('should use default options for log streaming', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      })

      const handle = await provider.createSandbox({})
      
      if (handle.streamLogs) {
        await handle.streamLogs()
        
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('follow=true&tail=100'),
          expect.any(Object)
        )
      }
    })
  })

  describe('verifyCallbackMiddleware', () => {
    it('should create middleware that verifies callback signature', async () => {
      // Mock verifyWebhookFromRequest
      vi.mock('@blaxel/core', () => ({
        verifyWebhookFromRequest: vi.fn().mockReturnValue(true),
      }))

      const { verifyCallbackMiddleware } = await import('../lib/sandbox/providers/blaxel-provider')
      
      const middleware = verifyCallbackMiddleware('test-secret')
      
      const mockReq = {
        body: JSON.stringify({ test: 'data' }),
        headers: {
          'x-blaxel-signature': 'sha256=test',
          'x-blaxel-timestamp': Date.now().toString(),
        },
      }
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      }
      
      const mockNext = vi.fn()

      await middleware(mockReq, mockRes, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockRes.status).not.toHaveBeenCalled()
    })

    it('should return 401 for invalid signature', async () => {
      vi.mock('@blaxel/core', () => ({
        verifyWebhookFromRequest: vi.fn().mockReturnValue(false),
      }))

      const mockReq = {
        body: JSON.stringify({ test: 'data' }),
        headers: {
          'x-blaxel-signature': 'sha256=invalid',
          'x-blaxel-timestamp': Date.now().toString(),
        },
      }
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      }
      
      const mockNext = vi.fn()

      const middleware = verifyCallbackMiddleware('test-secret')
      await middleware(mockReq, mockRes, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(401)
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid signature' })
      expect(mockNext).not.toHaveBeenCalled()
    })
  })

  describe('verifyCallbackSignature', () => {
    it('should verify callback signature using Blaxel SDK', async () => {
      vi.mock('@blaxel/core', () => ({
        verifyWebhookFromRequest: vi.fn().mockReturnValue(true),
      }))

      const mockRequest = {
        body: JSON.stringify({ test: 'data' }),
        headers: {
          'x-blaxel-signature': 'sha256=test',
          'x-blaxel-timestamp': Date.now().toString(),
        },
      }

      const isValid = await verifyCallbackSignature(mockRequest, 'test-secret')

      expect(isValid).toBe(true)
    })

    it('should return false for verification errors', async () => {
      vi.mock('@blaxel/core', () => ({
        verifyWebhookFromRequest: vi.fn().mockImplementation(() => {
          throw new Error('Verification failed')
        }),
      }))

      const mockRequest = {
        body: JSON.stringify({ test: 'data' }),
        headers: {},
      }

      const isValid = await verifyCallbackSignature(mockRequest, 'test-secret')

      expect(isValid).toBe(false)
    })
  })

  describe('LogEntry type', () => {
    it('should handle different log levels', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('2024-01-01T00:00:00.000Z INFO: Application started\n'))
          controller.enqueue(new TextEncoder().encode('2024-01-01T00:00:01.000Z ERROR: Something went wrong\n'))
          controller.enqueue(new TextEncoder().encode('2024-01-01T00:00:02.000Z WARN: Low memory\n'))
          controller.close()
        },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      })

      const handle = await provider.createSandbox({})
      
      if (handle.streamLogs) {
        const logStream = await handle.streamLogs({ follow: false })
        
        const logs: any[] = []
        for await (const log of logStream) {
          logs.push(log)
        }

        expect(logs[0].level).toBe('info')
        expect(logs[1].level).toBe('error')
        expect(logs[2].level).toBe('warn')
      }
    })

    it('should handle unformatted log lines', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('Unformatted log line\n'))
          controller.close()
        },
      })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      })

      const handle = await provider.createSandbox({})
      
      if (handle.streamLogs) {
        const logStream = await handle.streamLogs({ follow: false })
        
        const logs: any[] = []
        for await (const log of logStream) {
          logs.push(log)
        }

        expect(logs[0].message).toBe('Unformatted log line')
        expect(logs[0].level).toBe('info')
        expect(logs[0].timestamp).toBeDefined()
      }
    })
  })
})
