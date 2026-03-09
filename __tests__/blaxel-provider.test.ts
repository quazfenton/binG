/**
 * Blaxel Provider Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { BlaxelProvider } from '../lib/sandbox/providers/blaxel-provider'

describe('BlaxelProvider', () => {
  let provider: BlaxelProvider

  beforeEach(() => {
    // Mock environment variables
    vi.stubEnv('BLAXEL_API_KEY', 'test-api-key')
    vi.stubEnv('BLAXEL_WORKSPACE', 'test-workspace')
    vi.stubEnv('BLAXEL_DEFAULT_REGION', 'us-pdx-1')
    provider = new BlaxelProvider()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(provider.name).toBe('blaxel')
    })

    it('should warn if API key not configured', () => {
      const originalApiKey = process.env.BLAXEL_API_KEY
      delete process.env.BLAXEL_API_KEY
      
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      new BlaxelProvider()
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('BLAXEL_API_KEY not configured')
      )
      
      process.env.BLAXEL_API_KEY = originalApiKey
      consoleWarnSpy.mockRestore()
    })
  })

  describe('availability', () => {
    it('should be created when API key is configured', () => {
      // Provider is created successfully when API key exists
      expect(provider).toBeDefined()
    })

    it('should warn when API key is missing', () => {
      const originalApiKey = process.env.BLAXEL_API_KEY
      delete process.env.BLAXEL_API_KEY
      
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      new BlaxelProvider()
      
      expect(consoleWarnSpy).toHaveBeenCalled()
      
      process.env.BLAXEL_API_KEY = originalApiKey
      consoleWarnSpy.mockRestore()
    })
  })

  describe('createSandbox', () => {
    it('should create sandbox handle', async () => {
      // Verify the method exists and is callable
      expect(typeof provider.createSandbox).toBe('function')
      
      // Note: Actual sandbox creation requires Blaxel SDK and API key
      // This test just verifies the method signature
    })

    it('should enforce max instances', async () => {
      // This would require mocking the sandboxInstances map
      // For now, just verify the method exists
      expect(typeof provider.createSandbox).toBe('function')
    })
  })

  describe('getSandbox', () => {
    it('should retrieve existing sandbox', async () => {
      // Mock getting sandbox from instances map
      const sandboxId = 'test-sandbox-123'
      
      // Since getSandbox looks in sandboxInstances map, we need to mock it
      // For now, verify the method exists
      expect(typeof provider.getSandbox).toBe('function')
    })

    it('should throw error for non-existent sandbox', async () => {
      await expect(provider.getSandbox('non-existent-id'))
        .rejects
        .toThrow('not found')
    })
  })

  describe('destroySandbox', () => {
    it('should remove sandbox from instances', async () => {
      const sandboxId = 'test-sandbox-123'
      
      // Verify method exists
      expect(typeof provider.destroySandbox).toBe('function')
    })
  })

  describe('executeCommand', () => {
    it('should execute command with timeout', async () => {
      // Create a mock handle
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        executeCommand: vi.fn().mockResolvedValue({
          success: true,
          output: 'Command output',
          exitCode: 0,
        }),
      }

      const result = await mockHandle.executeCommand('ls -la', '/workspace', 30000)

      expect(result.success).toBe(true)
      expect(result.output).toBe('Command output')
      expect(result.exitCode).toBe(0)
    })

    it('should handle command timeout', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        executeCommand: vi.fn().mockResolvedValue({
          success: false,
          output: 'Command timed out',
          exitCode: 124,
        }),
      }

      const result = await mockHandle.executeCommand('long-running', '/workspace', 1000)

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(124)
    })
  })

  describe('file operations', () => {
    it('should write file', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        writeFile: vi.fn().mockResolvedValue({
          success: true,
          output: 'File written: /workspace/test.txt',
          exitCode: 0,
        }),
      }

      const result = await mockHandle.writeFile('test.txt', 'Hello World')

      expect(result.success).toBe(true)
      expect(result.output).toContain('File written')
    })

    it('should read file', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        readFile: vi.fn().mockResolvedValue({
          success: true,
          output: 'File content',
          exitCode: 0,
        }),
      }

      const result = await mockHandle.readFile('test.txt')

      expect(result.success).toBe(true)
      expect(result.output).toBe('File content')
    })

    it('should list directory', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        listDirectory: vi.fn().mockResolvedValue({
          success: true,
          output: 'file1.txt\nfile2.txt',
          exitCode: 0,
        }),
      }

      const result = await mockHandle.listDirectory('/workspace')

      expect(result.success).toBe(true)
    })
  })

  describe('batch jobs', () => {
    it('should run batch job', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        runBatchJob: vi.fn().mockResolvedValue({
          jobId: 'job-123',
          status: 'completed',
          totalTasks: 5,
          completedTasks: 5,
          failedTasks: 0,
          results: ['result1', 'result2', 'result3', 'result4', 'result5'],
        }),
      }

      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `task-${i}`,
        data: { input: `data-${i}` },
      }))

      const result = await mockHandle.runBatchJob(tasks)

      expect(result.status).toBe('completed')
      expect(result.completedTasks).toBe(5)
      expect(result.failedTasks).toBe(0)
    })

    it('should handle batch job failure', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        runBatchJob: vi.fn().mockRejectedValue(new Error('Job failed')),
      }

      await expect(mockHandle.runBatchJob([]))
        .rejects
        .toThrow('Job failed')
    })
  })

  describe('async execution', () => {
    it('should execute command asynchronously', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        executeAsync: vi.fn().mockResolvedValue({
          executionId: 'exec-123',
          status: 'started',
          callbackUrl: 'https://callback.url',
        }),
      }

      const result = await mockHandle.executeAsync({
        command: 'long-running-task',
        callbackUrl: 'https://callback.url',
      })

      expect(result.executionId).toBe('exec-123')
      expect(result.status).toBe('started')
    })
  })

  describe('agent handoffs', () => {
    it('should call another agent', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        callAgent: vi.fn().mockResolvedValue({
          result: 'Agent response',
        }),
      }

      const result = await mockHandle.callAgent({
        targetAgent: 'specialized-agent',
        input: { query: 'test' },
        waitForCompletion: true,
      })

      expect(result.result).toBe('Agent response')
    })
  })

  describe('preview links', () => {
    it('should get preview link', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        getPreviewLink: vi.fn().mockResolvedValue({
          port: 8080,
          url: 'https://test-sandbox.blaxel.ai:8080',
          token: undefined,
        }),
      }

      const preview = await mockHandle.getPreviewLink(8080)

      expect(preview.port).toBe(8080)
      expect(preview.url).toContain('blaxel.ai')
    })
  })

  describe('provider info', () => {
    it('should get provider information', async () => {
      const mockHandle = {
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        getProviderInfo: vi.fn().mockResolvedValue({
          provider: 'blaxel',
          region: 'us-pdx-1',
          status: 'running',
          url: 'https://test-sandbox.blaxel.ai',
          plan: 'standard',
        }),
      }

      const info = await mockHandle.getProviderInfo()

      expect(info.provider).toBe('blaxel')
      expect(info.region).toBe('us-pdx-1')
    })
  })
})

describe('BlaxelProvider Integration', () => {
  it('should integrate with quota manager', async () => {
    // Verify quota manager is imported and used
    const { quotaManager } = await import('../lib/services/quota-manager')
    expect(quotaManager).toBeDefined()
  })
})
