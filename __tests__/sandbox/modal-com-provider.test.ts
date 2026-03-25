/**
 * Modal.com Provider Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ModalComProvider,
  ModalComSandboxHandle,
  createModalComProvider,
  getModalComProvider,
  isModalComSandbox,
  cleanupModalComSandboxes,
  type ModalComConfig,
} from '@/lib/sandbox/providers/modal-com-provider'

// Mock logger
vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

describe('ModalComProvider', () => {
  let provider: ModalComProvider
  const originalToken = process.env.MODAL_API_TOKEN

  beforeEach(() => {
    provider = new ModalComProvider()
    process.env.MODAL_API_TOKEN = 'test-token'
  })

  afterEach(() => {
    process.env.MODAL_API_TOKEN = originalToken
  })

  describe('isAvailable', () => {
    it('should return true when API token is set', () => {
      expect(provider.isAvailable()).toBe(true)
    })

    it('should return false when API token is not set', () => {
      delete process.env.MODAL_API_TOKEN
      expect(provider.isAvailable()).toBe(false)
    })
  })

  describe('initialization', () => {
    it('should initialize with API token', () => {
      expect(() => {
        provider.initialize('test-token')
      }).not.toThrow()
    })

    it('should initialize from environment variable', () => {
      expect(() => {
        provider.initialize()
      }).not.toThrow()
    })

    it('should throw without API token', () => {
      delete process.env.MODAL_API_TOKEN
      
      expect(() => {
        provider.initialize()
      }).toThrow('Modal.com API token required')
    })

    it('should set initialized flag', () => {
      provider.initialize('test-token')
      // Provider should be usable after initialization
      expect(provider.isAvailable()).toBe(true)
    })
  })

  describe('createSandbox', () => {
    it('should create sandbox with basic config', async () => {
      provider.initialize('test-token')
      
      const sandbox = await provider.createSandbox({
        image: 'python:3.13',
      })
      
      expect(sandbox).toBeInstanceOf(ModalComSandboxHandle)
      expect(sandbox.id).toMatch(/^modal-com-\d+-/)
      expect(sandbox.workspaceDir).toBe('/root')
    })

    it('should create sandbox with GPU config', async () => {
      provider.initialize('test-token')
      
      const sandbox = await provider.createSandbox({
        image: 'python:3.13',
        gpu: 'H100',
        cpu: 4,
        memory: 8192,
      })
      
      const data = sandbox.getSandboxData()
      expect(data?.gpu).toBe('H100')
      expect(data?.cpu).toBe(4)
      expect(data?.memory).toBe(8192)
    })

    it('should create sandbox with per-config API token', async () => {
      delete process.env.MODAL_API_TOKEN
      
      const sandbox = await provider.createSandbox({
        image: 'python:3.13',
        apiToken: 'override-token',
      })
      
      expect(sandbox).toBeDefined()
    })

    it('should throw when no API token is available', async () => {
      delete process.env.MODAL_API_TOKEN
      
      await expect(
        provider.createSandbox({ image: 'python:3.13' })
      ).rejects.toThrow('Modal.com API token required')
    })

    it('should track active sandboxes', async () => {
      provider.initialize('test-token')
      
      const sandbox1 = await provider.createSandbox({ image: 'python:3.13' })
      const sandbox2 = await provider.createSandbox({ image: 'python:3.13' })
      
      expect(provider.getActiveSandboxCount()).toBe(2)
      expect(provider.getActiveSandboxes()).toContain(sandbox1)
      expect(provider.getActiveSandboxes()).toContain(sandbox2)
    })
  })

  describe('getSandbox', () => {
    it('should get existing sandbox', async () => {
      provider.initialize('test-token')
      
      const created = await provider.createSandbox({ image: 'python:3.13' })
      const retrieved = await provider.getSandbox(created.id)
      
      expect(retrieved).toBe(created)
    })

    it('should throw for non-existent sandbox', async () => {
      provider.initialize('test-token')
      
      await expect(provider.getSandbox('non-existent')).rejects.toThrow(
        'Modal.com sandbox not found: non-existent'
      )
    })
  })

  describe('destroySandbox', () => {
    it('should destroy sandbox', async () => {
      provider.initialize('test-token')
      
      const sandbox = await provider.createSandbox({ image: 'python:3.13' })
      
      await provider.destroySandbox(sandbox.id)
      
      expect(provider.getActiveSandboxCount()).toBe(0)
    })

    it('should handle destroying non-existent sandbox gracefully', async () => {
      provider.initialize('test-token')
      
      await expect(provider.destroySandbox('non-existent'))
        .resolves.not.toThrow()
    })

    it('should close tunnels before destroying', async () => {
      provider.initialize('test-token')
      
      const sandbox = await provider.createSandbox({ image: 'python:3.13' })
      
      // Create a tunnel
      await sandbox.getPreviewLink(8000)
      
      await provider.destroySandbox(sandbox.id)
      
      expect(provider.getActiveSandboxCount()).toBe(0)
    })
  })

  describe('destroyAll', () => {
    it('should destroy all active sandboxes', async () => {
      provider.initialize('test-token')
      
      await provider.createSandbox({ image: 'python:3.13' })
      await provider.createSandbox({ image: 'python:3.13' })
      await provider.createSandbox({ image: 'python:3.13' })
      
      await provider.destroyAll()
      
      expect(provider.getActiveSandboxCount()).toBe(0)
    })

    it('should handle empty sandbox list', async () => {
      provider.initialize('test-token')
      
      await expect(provider.destroyAll()).resolves.not.toThrow()
    })
  })
})

describe('ModalComSandboxHandle', () => {
  let sandbox: ModalComSandboxHandle
  const originalToken = process.env.MODAL_API_TOKEN

  beforeEach(async () => {
    process.env.MODAL_API_TOKEN = 'test-token'
    const provider = new ModalComProvider()
    provider.initialize('test-token')
    sandbox = await provider.createSandbox({ image: 'python:3.13' })
  })

  afterEach(() => {
    process.env.MODAL_API_TOKEN = originalToken
  })

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      const result = await sandbox.executeCommand('python --version')
      
      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.executionTime).toBeDefined()
    })

    it('should handle command with cwd', async () => {
      const result = await sandbox.executeCommand('ls -la', '/root/project')
      
      expect(result).toBeDefined()
    })

    it('should handle command with timeout', async () => {
      const result = await sandbox.executeCommand('sleep 10', undefined, 30)
      
      expect(result).toBeDefined()
    })
  })

  describe('file operations', () => {
    describe('writeFile', () => {
      it('should write file successfully', async () => {
        const result = await sandbox.writeFile('/test.txt', 'Hello Modal!')
        
        expect(result.success).toBe(true)
        expect(result.output).toContain('File written')
      })
    })

    describe('readFile', () => {
      it('should read file', async () => {
        const result = await sandbox.readFile('/test.txt')
        
        expect(result).toBeDefined()
      })
    })

    describe('listDirectory', () => {
      it('should list directory', async () => {
        const result = await sandbox.listDirectory('/root')
        
        expect(result).toBeDefined()
      })
    })
  })

  describe('getPreviewLink', () => {
    it('should create tunnel for port', async () => {
      const preview = await sandbox.getPreviewLink(8000)
      
      expect(preview.port).toBe(8000)
      expect(preview.url).toMatch(/https:\/\/.*\.r5\.modal\.host/)
      expect(preview.openedAt).toBeDefined()
    })

    it('should return same tunnel for same port', async () => {
      const preview1 = await sandbox.getPreviewLink(8000)
      const preview2 = await sandbox.getPreviewLink(8000)
      
      expect(preview1.url).toBe(preview2.url)
    })

    it('should store tunnel info', async () => {
      await sandbox.getPreviewLink(8000)
      
      const tunnel = sandbox.getTunnel(8000)
      expect(tunnel).toBeDefined()
      expect(tunnel?.port).toBe(8000)
    })
  })

  describe('PTY operations', () => {
    describe('createPty', () => {
      it('should create PTY session', async () => {
        const pty = await sandbox.createPty({
          id: 'test-pty',
          cwd: '/root',
          cols: 80,
          rows: 24,
          onData: vi.fn(),
        })
        
        expect(pty.sessionId).toBe('test-pty')
      })

      it('should generate ID if not provided', async () => {
        const pty = await sandbox.createPty({
          onData: vi.fn(),
        })
        
        expect(pty.sessionId).toMatch(/^pty-\d+/)
      })
    })

    describe('connectPty', () => {
      it('should connect to existing PTY', async () => {
        const original = await sandbox.createPty({
          id: 'test-pty',
          onData: vi.fn(),
        })
        
        const connected = await sandbox.connectPty('test-pty', {
          onData: vi.fn(),
        })
        
        expect(connected).toBe(original)
      })

      it('should throw for non-existent PTY', async () => {
        await expect(
          sandbox.connectPty('non-existent', { onData: vi.fn() })
        ).rejects.toThrow('PTY session not found')
      })
    })

    describe('killPty', () => {
      it('should kill existing PTY', async () => {
        await sandbox.createPty({
          id: 'test-pty',
          onData: vi.fn(),
        })
        
        await expect(sandbox.killPty('test-pty')).resolves.not.toThrow()
      })

      it('should handle non-existent PTY gracefully', async () => {
        await expect(sandbox.killPty('non-existent')).resolves.not.toThrow()
      })
    })

    describe('resizePty', () => {
      it('should resize existing PTY', async () => {
        await sandbox.createPty({
          id: 'test-pty',
          onData: vi.fn(),
        })
        
        await expect(sandbox.resizePty('test-pty', 120, 40))
          .resolves.not.toThrow()
      })

      it('should throw for non-existent PTY', async () => {
        await expect(sandbox.resizePty('non-existent', 120, 40))
          .rejects.toThrow('PTY session not found')
      })
    })
  })

  describe('tunnel management', () => {
    describe('closeTunnel', () => {
      it('should close existing tunnel', async () => {
        await sandbox.getPreviewLink(8000)
        
        await expect(sandbox.closeTunnel(8000)).resolves.not.toThrow()
        expect(sandbox.getTunnel(8000)).toBeUndefined()
      })

      it('should handle non-existent tunnel gracefully', async () => {
        await expect(sandbox.closeTunnel(9999)).resolves.not.toThrow()
      })
    })

    describe('getTunnels', () => {
      it('should return all active tunnels', async () => {
        await sandbox.getPreviewLink(8000)
        await sandbox.getPreviewLink(3000)
        
        const tunnels = sandbox.getTunnels()
        expect(tunnels).toHaveLength(2)
      })
    })
  })

  describe('getSandboxData', () => {
    it('should return sandbox data', () => {
      const data = sandbox.getSandboxData()
      
      expect(data).toBeDefined()
      expect(data?.sandboxId).toBe(sandbox.id)
      expect(data?.status).toBe('running')
    })
  })
})

describe('createModalComProvider', () => {
  const originalToken = process.env.MODAL_API_TOKEN

  afterEach(() => {
    process.env.MODAL_API_TOKEN = originalToken
  })

  it('should create and initialize provider', () => {
    const provider = createModalComProvider('test-token')
    
    expect(provider).toBeInstanceOf(ModalComProvider)
    expect(provider.name).toBe('modal-com')
    expect(provider.isAvailable()).toBe(true)
  })

  it('should use environment token if not provided', () => {
    process.env.MODAL_API_TOKEN = 'env-token'
    
    const provider = createModalComProvider()
    
    expect(provider).toBeInstanceOf(ModalComProvider)
  })

  it('should handle missing token gracefully', () => {
    delete process.env.MODAL_API_TOKEN
    
    const provider = createModalComProvider()
    
    expect(provider).toBeInstanceOf(ModalComProvider)
    expect(provider.isAvailable()).toBe(false)
  })
})

describe('getModalComProvider', () => {
  const originalToken = process.env.MODAL_API_TOKEN

  afterEach(() => {
    process.env.MODAL_API_TOKEN = originalToken
  })

  it('should return singleton provider', () => {
    process.env.MODAL_API_TOKEN = 'test-token'
    
    const provider1 = getModalComProvider()
    const provider2 = getModalComProvider()
    
    expect(provider1).toBe(provider2)
  })

  it('should warn when token is missing', () => {
    delete process.env.MODAL_API_TOKEN
    
    const provider = getModalComProvider()
    
    expect(provider.isAvailable()).toBe(false)
  })
})

describe('cleanupModalComSandboxes', () => {
  const originalToken = process.env.MODAL_API_TOKEN

  beforeEach(() => {
    process.env.MODAL_API_TOKEN = 'test-token'
  })

  afterEach(() => {
    process.env.MODAL_API_TOKEN = originalToken
  })

  it('should cleanup all sandboxes', async () => {
    const provider = new ModalComProvider()
    provider.initialize('test-token')
    
    await provider.createSandbox({ image: 'python:3.13' })
    await provider.createSandbox({ image: 'python:3.13' })
    
    await cleanupModalComSandboxes()
    
    expect(provider.getActiveSandboxCount()).toBe(0)
  })

  it('should handle cleanup errors gracefully', async () => {
    // Should not throw even if there are errors
    await expect(cleanupModalComSandboxes()).resolves.not.toThrow()
  })
})

describe('isModalComSandbox', () => {
  it('should return true for Modal.com sandboxes', async () => {
    process.env.MODAL_API_TOKEN = 'test-token'
    const provider = new ModalComProvider()
    provider.initialize('test-token')
    const sandbox = await provider.createSandbox({ image: 'python:3.13' })
    
    expect(isModalComSandbox(sandbox)).toBe(true)
  })

  it('should return false for other objects', () => {
    expect(isModalComSandbox({})).toBe(false)
    expect(isModalComSandbox(null)).toBe(false)
    expect(isModalComSandbox(undefined)).toBe(false)
    expect(isModalComSandbox('string')).toBe(false)
    expect(isModalComSandbox(123)).toBe(false)
  })
})
