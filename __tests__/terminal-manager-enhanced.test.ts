/**
 * Enhanced Integration Tests: Terminal Manager
 * 
 * Comprehensive tests for terminal manager with all enhancements:
 * - Enhanced port detection
 * - Session persistence
 * - Event emission
 * - Multi-provider support
 * - Error handling
 * - Performance scenarios
 * 
 * @see lib/sandbox/terminal-manager.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { terminalManager } from '@/lib/sandbox/terminal-manager'
import { getSandboxProvider } from '@/lib/sandbox/providers'
import { getAllTerminalSessions, getSessionsByUserId, clearAllSessions } from '@/lib/sandbox/terminal-session-store'
import { enhancedSandboxEvents, getEventHistory, clearDetectedPorts } from '@/lib/sandbox/sandbox-events-enhanced'

// Mock sandbox provider
const createMockProvider = () => ({
  name: 'test-provider',
  createSandbox: vi.fn().mockResolvedValue({
    id: 'test-sandbox',
    workspaceDir: '/workspace',
    createPty: vi.fn().mockResolvedValue({
      waitForConnection: vi.fn().mockResolvedValue(undefined),
      sendInput: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
    }),
    connectPty: undefined,
    executeCommand: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
    getPreviewLink: vi.fn().mockResolvedValue({ port: 3000, url: 'http://localhost:3000', token: 'test' }),
  }),
  getSandbox: vi.fn().mockResolvedValue({
    id: 'test-sandbox',
    workspaceDir: '/workspace',
    createPty: vi.fn().mockResolvedValue({
      waitForConnection: vi.fn().mockResolvedValue(undefined),
      sendInput: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
    }),
    connectPty: undefined,
    executeCommand: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
    getPreviewLink: vi.fn().mockResolvedValue({ port: 3000, url: 'http://localhost:3000', token: 'test' }),
  }),
  destroySandbox: vi.fn().mockResolvedValue(undefined),
})

describe('Terminal Manager - Enhanced Integration', () => {
  let mockProvider: ReturnType<typeof createMockProvider>

  beforeEach(() => {
    mockProvider = createMockProvider()
    vi.mock('@/lib/sandbox/providers', async () => {
      const actual = await vi.importActual('@/lib/sandbox/providers')
      return {
        ...actual,
        getSandboxProvider: vi.fn().mockReturnValue(mockProvider),
      }
    })
    clearAllSessions()
    enhancedSandboxEvents.clearHistory()
    clearDetectedPorts()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearAllSessions()
    enhancedSandboxEvents.clearHistory()
    clearDetectedPorts()
  })

  describe('Session Persistence', () => {
    it('should persist session on creation', async () => {
      await terminalManager.createTerminalSession(
        'test-session-1',
        'test-sandbox-1',
        () => {},
        undefined,
        { cols: 120, rows: 30 },
        'user-123'
      )

      const sessions = getAllTerminalSessions()
      expect(sessions.length).toBeGreaterThan(0)
      const session = sessions.find(s => s.sessionId === 'test-session-1')
      expect(session).toBeDefined()
      expect(session?.userId).toBe('user-123')
      expect(session?.mode).toBe('pty')
    })

    it('should persist session in command-mode when PTY unavailable', async () => {
      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox',
        workspaceDir: '/workspace',
        createPty: undefined, // No PTY support
        executeCommand: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
        getPreviewLink: undefined,
      })

      await terminalManager.createTerminalSession(
        'test-session-cmd',
        'test-sandbox-cmd',
        () => {},
        undefined,
        undefined,
        'user-456'
      )

      const sessions = getAllTerminalSessions()
      const cmdSession = sessions.find(s => s.sessionId === 'test-session-cmd')
      expect(cmdSession).toBeDefined()
      expect(cmdSession?.mode).toBe('command-mode')
      expect(cmdSession?.userId).toBe('user-456')
    })

    it('should track multiple sessions per user', async () => {
      await Promise.all([
        terminalManager.createTerminalSession('session-1', 'sbx-1', () => {}, undefined, undefined, 'user-multi'),
        terminalManager.createTerminalSession('session-2', 'sbx-2', () => {}, undefined, undefined, 'user-multi'),
        terminalManager.createTerminalSession('session-3', 'sbx-3', () => {}, undefined, undefined, 'user-multi'),
      ])

      const userSessions = getSessionsByUserId('user-multi')
      expect(userSessions.length).toBeGreaterThanOrEqual(3)
    })

    it('should clean up session on disconnect', async () => {
      await terminalManager.createTerminalSession(
        'test-session-disconnect',
        'test-sandbox-disconnect',
        () => {},
        undefined,
        undefined,
        'user-789'
      )

      expect(terminalManager.isConnected('test-session-disconnect')).toBe(true)

      await terminalManager.disconnectTerminal('test-session-disconnect')

      expect(terminalManager.isConnected('test-session-disconnect')).toBe(false)
    })
  })

  describe('Event Emission', () => {
    it('should emit connected event on session creation', async () => {
      await terminalManager.createTerminalSession(
        'test-session-event',
        'test-sandbox-event',
        () => {},
        undefined,
        undefined,
        'user-event'
      )

      const events = getEventHistory('test-sandbox-event', { types: ['connected'] })
      expect(events.length).toBeGreaterThan(0)
      expect(events[0].data.sessionId).toBe('test-session-event')
      expect(events[0].metadata?.userId).toBe('user-event')
    })

    it('should emit disconnected event on session disconnect', async () => {
      await terminalManager.createTerminalSession(
        'test-session-disc',
        'test-sandbox-disc',
        () => {},
        undefined,
        undefined,
        'user-disc'
      )

      await terminalManager.disconnectTerminal('test-session-disc')

      const events = getEventHistory('test-sandbox-disc', { types: ['disconnected'] })
      expect(events.length).toBeGreaterThan(0)
      expect(events[0].data.reason).toBe('user_requested')
    })

    it('should emit port_detected event when port found', async () => {
      const onData = vi.fn()
      const onPortDetected = vi.fn()

      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox-port',
        workspaceDir: '/workspace',
        createPty: vi.fn().mockImplementation(async (opts) => {
          // Simulate port detection in output
          if (opts.onData) {
            opts.onData(new TextEncoder().encode('Server running on http://localhost:3000'))
          }
          return {
            waitForConnection: vi.fn().mockResolvedValue(undefined),
            sendInput: vi.fn().mockResolvedValue(undefined),
            resize: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            kill: vi.fn().mockResolvedValue(undefined),
          }
        }),
        getPreviewLink: vi.fn().mockResolvedValue({ port: 3000, url: 'http://localhost:3000', token: 'test' }),
      })

      await terminalManager.createTerminalSession(
        'test-session-port',
        'test-sandbox-port',
        onData,
        onPortDetected,
        undefined,
        'user-port'
      )

      // Wait for async port detection
      await new Promise(resolve => setTimeout(resolve, 100))

      const events = getEventHistory('test-sandbox-port', { types: ['port_detected'] })
      expect(events.length).toBeGreaterThan(0)
      expect(events[0].data.port).toBe(3000)
    })
  })

  describe('Command Mode Execution', () => {
    it('should execute clear command', async () => {
      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox-cmd-clear',
        workspaceDir: '/workspace',
        createPty: undefined,
        executeCommand: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
      })

      const onData = vi.fn()
      await terminalManager.createTerminalSession(
        'test-session-cmd-clear',
        'test-sandbox-cmd-clear',
        onData,
        undefined,
        undefined,
        'user-cmd'
      )

      await terminalManager.sendInput('test-session-cmd-clear', 'clear\n')

      // Should emit clear output
      expect(onData).toHaveBeenCalledWith('\x1bc')
    })

    it('should execute pwd command', async () => {
      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox-cmd-pwd',
        workspaceDir: '/workspace',
        createPty: undefined,
        executeCommand: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
      })

      const onData = vi.fn()
      await terminalManager.createTerminalSession(
        'test-session-cmd-pwd',
        'test-sandbox-cmd-pwd',
        onData,
        undefined,
        undefined,
        'user-cmd'
      )

      await terminalManager.sendInput('test-session-cmd-pwd', 'pwd\n')

      // Should emit current directory
      expect(onData).toHaveBeenCalledWith('/workspace\r\n')
    })

    it('should execute cd command and update cwd', async () => {
      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox-cmd-cd',
        workspaceDir: '/workspace',
        createPty: undefined,
        executeCommand: vi.fn().mockImplementation((cmd) => {
          if (cmd.includes('pwd')) {
            return Promise.resolve({ success: true, output: '/workspace/newdir', exitCode: 0 })
          }
          return Promise.resolve({ success: true, output: '', exitCode: 0 })
        }),
      })

      const onData = vi.fn()
      await terminalManager.createTerminalSession(
        'test-session-cmd-cd',
        'test-sandbox-cmd-cd',
        onData,
        undefined,
        undefined,
        'user-cmd'
      )

      await terminalManager.sendInput('test-session-cmd-cd', 'cd newdir\n')

      // Should update cwd
      expect(onData).toHaveBeenCalledWith('/workspace/newdir\r\n')
    })

    it('should track command history', async () => {
      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox-cmd-history',
        workspaceDir: '/workspace',
        createPty: undefined,
        executeCommand: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
      })

      await terminalManager.createTerminalSession(
        'test-session-cmd-history',
        'test-sandbox-cmd-history',
        () => {},
        undefined,
        undefined,
        'user-history'
      )

      // Execute multiple commands
      await terminalManager.sendInput('test-session-cmd-history', 'ls\n')
      await terminalManager.sendInput('test-session-cmd-history', 'cd project\n')
      await terminalManager.sendInput('test-session-cmd-history', 'npm install\n')

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50))

      const session = getAllTerminalSessions().find(s => s.sessionId === 'test-session-cmd-history')
      expect(session?.history.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Error Handling', () => {
    it('should handle provider failure gracefully', async () => {
      mockProvider.getSandbox.mockRejectedValueOnce(new Error('Provider unavailable'))

      await expect(
        terminalManager.createTerminalSession(
          'test-session-error',
          'test-sandbox-error',
          () => {},
          undefined,
          undefined,
          'user-error'
        )
      ).rejects.toThrow('Provider unavailable')
    })

    it('should handle command execution failure', async () => {
      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox-cmd-fail',
        workspaceDir: '/workspace',
        createPty: undefined,
        executeCommand: vi.fn().mockResolvedValue({ success: false, output: 'Command failed', exitCode: 1 }),
      })

      const onData = vi.fn()
      await terminalManager.createTerminalSession(
        'test-session-cmd-fail',
        'test-sandbox-cmd-fail',
        onData,
        undefined,
        undefined,
        'user-cmd'
      )

      await terminalManager.sendInput('test-session-cmd-fail', 'failing-command\n')

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50))

      // Should emit error message
      expect(onData).toHaveBeenCalledWith(expect.stringContaining('[exit 1]'))
    })

    it('should handle invalid session ID', async () => {
      await expect(
        terminalManager.sendInput('non-existent-session', 'test\n')
      ).rejects.toThrow('No active terminal session')
    })
  })

  describe('Multi-Provider Support', () => {
    it('should fallback to alternative provider when primary fails', async () => {
      const fallbackProvider = createMockProvider()
      
      vi.mocked(getSandboxProvider)
        .mockImplementationOnce(() => {
          throw new Error('Primary provider unavailable')
        })
        .mockImplementationOnce(() => fallbackProvider)

      await expect(
        terminalManager.createTerminalSession(
          'test-session-fallback',
          'test-sandbox-fallback',
          () => {},
          undefined,
          undefined,
          'user-fallback'
        )
      ).resolves.toBeDefined()
    })

    it('should infer provider from sandbox ID', async () => {
      const e2bProvider = createMockProvider()
      e2bProvider.name = 'e2b'
      
      vi.mocked(getSandboxProvider)
        .mockImplementationOnce(() => e2bProvider)

      await terminalManager.createTerminalSession(
        'test-session-e2b',
        'e2b-test-sandbox',
        () => {},
        undefined,
        undefined,
        'user-e2b'
      )

      expect(e2bProvider.getSandbox).toHaveBeenCalledWith('e2b-test-sandbox')
    })
  })

  describe('Performance', () => {
    it('should handle concurrent session creation', async () => {
      const sessionCount = 10
      const promises = Array.from({ length: sessionCount }, (_, i) =>
        terminalManager.createTerminalSession(
          `concurrent-session-${i}`,
          `concurrent-sbx-${i}`,
          () => {},
          undefined,
          undefined,
          `user-concurrent-${i % 3}`
        )
      )

      await Promise.all(promises)

      const sessions = getAllTerminalSessions()
      expect(sessions.length).toBeGreaterThanOrEqual(sessionCount)
    })

    it('should handle rapid command execution', async () => {
      mockProvider.getSandbox.mockResolvedValueOnce({
        id: 'test-sandbox-rapid',
        workspaceDir: '/workspace',
        createPty: undefined,
        executeCommand: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
      })

      await terminalManager.createTerminalSession(
        'test-session-rapid',
        'test-sandbox-rapid',
        () => {},
        undefined,
        undefined,
        'user-rapid'
      )

      // Execute 100 commands rapidly
      const commandPromises = Array.from({ length: 100 }, (_, i) =>
        terminalManager.sendInput('test-session-rapid', `command-${i}\n`)
      )

      await Promise.all(commandPromises)

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100))

      const session = getAllTerminalSessions().find(s => s.sessionId === 'test-session-rapid')
      expect(session?.history.length).toBeGreaterThanOrEqual(100)
    })

    it('should handle large event volume', async () => {
      const eventCount = 500
      for (let i = 0; i < eventCount; i++) {
        enhancedSandboxEvents.emit('test-sandbox-volume', 'pty_output', { line: i })
      }

      const events = enhancedSandboxEvents.getHistory('test-sandbox-volume')
      expect(events.length).toBeGreaterThanOrEqual(eventCount)
    })
  })

  describe('Real-World Scenarios', () => {
    it('should handle full development workflow', async () => {
      // Create session
      await terminalManager.createTerminalSession(
        'dev-workflow-session',
        'dev-workflow-sbx',
        () => {},
        (preview) => console.log('Preview:', preview),
        undefined,
        'developer-1'
      )

      // Simulate development commands
      const devCommands = [
        'git clone https://github.com/user/repo.git',
        'cd repo',
        'npm install',
        'npm run dev',
        'npm test',
        'git add .',
        'git commit -m "feat: add feature"',
        'git push',
      ]

      for (const cmd of devCommands) {
        await terminalManager.sendInput('dev-workflow-session', `${cmd}\n`)
      }

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify session has all commands in history
      const session = getAllTerminalSessions().find(s => s.sessionId === 'dev-workflow-session')
      expect(session?.history.length).toBeGreaterThanOrEqual(devCommands.length)

      // Verify events were emitted
      const commandEvents = enhancedSandboxEvents.getHistory('dev-workflow-sbx', { types: ['command_output'] })
      expect(commandEvents.length).toBeGreaterThanOrEqual(devCommands.length)
    })

    it('should handle multi-user collaborative session', async () => {
      // Multiple users working on same sandbox
      const users = ['user-1', 'user-2', 'user-3']
      
      for (const user of users) {
        await terminalManager.createTerminalSession(
          `collab-session-${user}`,
          'collab-sandbox',
          () => {},
          undefined,
          undefined,
          user
        )
      }

      // Verify all sessions created
      const allSessions = getAllTerminalSessions()
      const collabSessions = allSessions.filter(s => s.sandboxId === 'collab-sandbox')
      expect(collabSessions.length).toBeGreaterThanOrEqual(3)

      // Verify each user has their session
      for (const user of users) {
        const userSessions = getSessionsByUserId(user)
        expect(userSessions.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should handle long-running development session', async () => {
      // Create session
      await terminalManager.createTerminalSession(
        'long-session',
        'long-sbx',
        () => {},
        undefined,
        undefined,
        'developer-long'
      )

      // Simulate hours of development (compressed)
      const hours = 8
      const commandsPerHour = 20
      
      for (let hour = 0; hour < hours; hour++) {
        for (let i = 0; i < commandsPerHour; i++) {
          await terminalManager.sendInput('long-session', `cmd-hour${hour}-${i}\n`)
        }
        // Small delay between hours
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100))

      const session = getAllTerminalSessions().find(s => s.sessionId === 'long-session')
      // Should have at least some commands (limited by history max of 100)
      expect(session?.history.length).toBeGreaterThan(0)
      expect(session?.history.length).toBeLessThanOrEqual(100) // Max history limit
    })
  })
})
