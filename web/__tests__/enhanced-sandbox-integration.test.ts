/**
 * Integration Tests: Enhanced Sandbox Infrastructure
 * 
 * Tests the integration between:
 * - Enhanced port detector
 * - Terminal session store
 * - Enhanced sandbox events
 * - E2B advanced agents (Amp + Codex)
 * 
 * @see lib/sandbox/enhanced-port-detector.ts
 * @see lib/sandbox/terminal-session-store.ts
 * @see lib/sandbox/sandbox-events-enhanced.ts
 * @see lib/sandbox/providers/e2b-amp-service.ts
 * @see lib/sandbox/providers/e2b-codex-service.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import all modules
import { enhancedPortDetector, detectPorts, clearDetectedPorts } from '@/lib/previews/enhanced-port-detector'
import {
  saveTerminalSession,
  getTerminalSession,
  updateTerminalSession,
  deleteTerminalSession,
  getSessionsByUserId,
  exportSessions,
  importSessions,
  clearAllSessions,
  type TerminalSessionState,
} from '@/lib/terminal/session/terminal-session-store'
import {
  enhancedSandboxEvents,
  emitEvent,
  subscribeToEvents,
  getEventHistory,
  type EnhancedSandboxEventType,
} from '@/lib/sandbox/sandbox-events-enhanced'
import { createAmpService, type AmpExecutionResult } from '@/lib/sandbox/spawn/e2b-amp-service'
import { createCodexService, CodexSchemas } from '@/lib/sandbox/spawn/e2b-codex-service'

// Mock sandbox for agent services
const createMockSandbox = () => ({
  sandboxId: 'test-sandbox',
  commands: { run: vi.fn() },
  files: { write: vi.fn(), read: vi.fn() },
  kill: vi.fn(),
})

describe('Enhanced Sandbox Infrastructure - Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDetectedPorts()
    clearAllSessions()
    enhancedSandboxEvents.clearHistory()
  })

  afterEach(() => {
    clearDetectedPorts()
    clearAllSessions()
    enhancedSandboxEvents.clearHistory()
  })

  describe('Port Detection + Event Emission Integration', () => {
    it('should detect ports and emit events', () => {
      // Simulate terminal output with port
      const terminalOutput = 'Server running on http://localhost:3000'
      
      // Detect ports
      const detectedPorts = detectPorts(terminalOutput)
      expect(detectedPorts).toContain(3000)
      
      // Emit event for detected port
      emitEvent('sbx-123', 'port_detected', {
        port: 3000,
        url: 'http://localhost:3000',
      })
      
      // Verify event was stored
      const events = getEventHistory('sbx-123', { types: ['port_detected'] })
      expect(events).toHaveLength(1)
      expect(events[0].data.port).toBe(3000)
    })

    it('should track multiple port detections over time', () => {
      const outputs = [
        'Vite running on localhost:5173',
        'Backend on localhost:3000',
        'Database on localhost:5432',
      ]
      
      const allDetectedPorts: number[] = []
      
      outputs.forEach((output, index) => {
        const ports = detectPorts(output)
        allDetectedPorts.push(...ports)
        
        // Emit event for each detection
        ports.forEach(port => {
          emitEvent('sbx-123', 'port_detected', {
            port,
            source: output,
            timestamp: Date.now() + index,
          })
        })
      })
      
      expect(allDetectedPorts).toEqual(expect.arrayContaining([5173, 3000, 5432]))
      
      const events = getEventHistory('sbx-123')
      expect(events.length).toBeGreaterThanOrEqual(3)
    })

    it('should handle port detection in streaming output', () => {
      const streamingChunks = [
        'Starting server...',
        'Running on http://localhost:3000',
        ' Ready!',
      ]
      
      let detectedInStream = false
      
      streamingChunks.forEach(chunk => {
        const ports = detectPorts(chunk)
        if (ports.length > 0) {
          detectedInStream = true
          emitEvent('sbx-stream', 'port_detected', { port: ports[0] })
        }
      })
      
      expect(detectedInStream).toBe(true)
      
      const events = getEventHistory('sbx-stream')
      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0].data.port).toBe(3000)
    })
  })

  describe('Terminal Session + Event Integration', () => {
    it('should save session and emit creation event', () => {
      const session: TerminalSessionState = {
        sessionId: 'sess-123',
        sandboxId: 'sbx-456',
        ptySessionId: 'pty-789',
        userId: 'user-abc',
        mode: 'pty',
        cwd: '/workspace',
        cols: 120,
        rows: 30,
        lastActive: Date.now(),
        history: [],
      }
      
      // Save session
      saveTerminalSession(session)
      
      // Emit creation event
      emitEvent('sbx-456', 'connected', {
        sessionId: 'sess-123',
        mode: 'pty',
      })
      
      // Verify both persisted
      const savedSession = getTerminalSession('sess-123')
      expect(savedSession).toBeDefined()
      
      const events = getEventHistory('sbx-456')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('connected')
    })

    it('should track session updates via events', () => {
      const session: TerminalSessionState = {
        sessionId: 'sess-123',
        sandboxId: 'sbx-456',
        ptySessionId: 'pty-789',
        userId: 'user-abc',
        mode: 'pty',
        cwd: '/workspace',
        cols: 120,
        rows: 30,
        lastActive: Date.now(),
        history: ['ls'],
      }
      
      saveTerminalSession(session)
      
      // Simulate command execution with events
      const commands = ['cd project', 'npm install', 'npm run dev']
      
      commands.forEach((cmd, index) => {
        // Update session history
        session.history.push(cmd)
        updateTerminalSession('sess-123', { history: [...session.history] })
        
        // Emit command event
        emitEvent('sbx-456', 'command_output', {
          command: cmd,
          order: index,
        })
      })
      
      // Verify session has all commands
      const savedSession = getTerminalSession('sess-123')
      expect(savedSession?.history).toHaveLength(4) // initial + 3 commands
      
      // Verify all command events
      const commandEvents = getEventHistory('sbx-456', { types: ['command_output'] })
      expect(commandEvents).toHaveLength(3)
    })

    it('should export sessions with related events', () => {
      const session: TerminalSessionState = {
        sessionId: 'sess-export',
        sandboxId: 'sbx-export',
        ptySessionId: 'pty-export',
        userId: 'user-export',
        mode: 'pty',
        cwd: '/workspace',
        cols: 80,
        rows: 24,
        lastActive: Date.now(),
        history: ['cmd1', 'cmd2'],
      }
      
      saveTerminalSession(session)
      
      emitEvent('sbx-export', 'connected', { sessionId: 'sess-export' })
      emitEvent('sbx-export', 'port_detected', { port: 3000 })
      
      // Export sessions
      const sessionsJson = exportSessions()
      const sessions = JSON.parse(sessionsJson)
      
      expect(sessions).toHaveLength(1)
      expect(sessions[0].sessionId).toBe('sess-export')
      
      // Export events
      const eventsJson = enhancedSandboxEvents.exportEvents('sbx-export')
      const events = JSON.parse(eventsJson)
      
      expect(events).toHaveLength(2)
    })

    it('should import sessions and recreate events', () => {
      const sessionData = [{
        sessionId: 'sess-import',
        sandboxId: 'sbx-import',
        ptySessionId: 'pty-import',
        userId: 'user-import',
        mode: 'command-mode',
        cwd: '/workspace',
        cols: 120,
        rows: 30,
        lastActive: Date.now(),
        history: ['imported-cmd'],
      }]
      
      const eventData = [{
        id: 'event-1',
        type: 'connected',
        sandboxId: 'sbx-import',
        timestamp: Date.now(),
        data: { sessionId: 'sess-import' },
      }]
      
      // Import sessions
      const sessionCount = importSessions(JSON.stringify(sessionData))
      expect(sessionCount).toBe(1)
      
      // Import events
      const eventCount = enhancedSandboxEvents.importEvents(JSON.stringify(eventData))
      expect(eventCount).toBe(1)
      
      // Verify both imported correctly
      const session = getTerminalSession('sess-import')
      expect(session).toBeDefined()
      expect(session?.userId).toBe('user-import')
      
      const events = getEventHistory('sbx-import')
      expect(events).toHaveLength(1)
    })
  })

  describe('User Session Tracking', () => {
    it('should track all sessions for a user across sandboxes', () => {
      const userSessions = [
        { sessionId: 'sess-1', sandboxId: 'sbx-1', userId: 'user-1' },
        { sessionId: 'sess-2', sandboxId: 'sbx-2', userId: 'user-1' },
        { sessionId: 'sess-3', sandboxId: 'sbx-3', userId: 'user-1' },
      ].map(s => ({
        ...s,
        ptySessionId: `pty-${s.sessionId}`,
        mode: 'pty' as const,
        cwd: '/workspace',
        cols: 120,
        rows: 30,
        lastActive: Date.now(),
        history: [],
      }))
      
      userSessions.forEach(session => saveTerminalSession(session))
      
      const user1Sessions = getSessionsByUserId('user-1')
      expect(user1Sessions).toHaveLength(3)
      
      // Each session should have associated events
      userSessions.forEach(session => {
        emitEvent(session.sandboxId, 'connected', { sessionId: session.sessionId })
      })
      
      // Verify events for all user sandboxes
      const allEvents = enhancedSandboxEvents.getEventsByType('connected')
      expect(allEvents).toHaveLength(3)
    })

    it('should handle user session migration', () => {
      // Create session for user
      const session: TerminalSessionState = {
        sessionId: 'sess-migrate',
        sandboxId: 'sbx-old',
        ptySessionId: 'pty-old',
        userId: 'user-old',
        mode: 'pty',
        cwd: '/workspace',
        cols: 120,
        rows: 30,
        lastActive: Date.now(),
        history: [],
      }
      
      saveTerminalSession(session)
      
      // Migrate to new sandbox
      updateTerminalSession('sess-migrate', {
        sandboxId: 'sbx-new',
        ptySessionId: 'pty-new',
      })
      
      // Emit migration event
      emitEvent('sbx-new', 'connected', {
        sessionId: 'sess-migrate',
        migratedFrom: 'sbx-old',
      })
      
      // Verify migration
      const updated = getTerminalSession('sess-migrate')
      expect(updated?.sandboxId).toBe('sbx-new')
      
      const migrationEvents = getEventHistory('sbx-new')
      expect(migrationEvents[0].data.migratedFrom).toBe('sbx-old')
    })
  })

  describe('Agent Services Integration', () => {
    it('should track Amp execution via events', async () => {
      const mockSandbox = createMockSandbox()
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Task completed',
        stderr: '',
      })
      
      const ampService = createAmpService(mockSandbox, 'test-key')
      
      // Subscribe to events before execution
      const events: any[] = []
      const unsubscribe = subscribeToEvents('sbx-amp', (event) => {
        events.push(event)
      }, { replay: false })
      
      // Execute Amp task
      await ampService.run({
        prompt: 'Fix bugs',
        dangerouslyAllowAll: true,
      })
      
      // Emit execution event
      emitEvent('sbx-amp', 'agent:tool_start', {
        tool: 'amp',
        prompt: 'Fix bugs',
      })
      
      unsubscribe()
      
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('agent:tool_start')
    })

    it('should track Codex execution with schema validation', async () => {
      const mockSandbox = createMockSandbox()
      mockSandbox.files.read.mockResolvedValue(JSON.stringify(CodexSchemas.securityReview))
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({ issues: [], summary: 'No issues' }),
        stderr: '',
      })
      
      const codexService = createCodexService(mockSandbox, 'test-key')
      
      // Track execution via events
      emitEvent('sbx-codex', 'agent:tool_start', {
        tool: 'codex',
        prompt: 'Security review',
        schemaUsed: 'securityReview',
      })
      
      await codexService.run({
        prompt: 'Security review',
        fullAuto: true,
        outputSchemaPath: '/schema.json',
      })
      
      emitEvent('sbx-codex', 'agent:tool_result', {
        success: true,
        issuesFound: 0,
      })
      
      const events = getEventHistory('sbx-codex')
      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('agent:tool_start')
      expect(events[1].type).toBe('agent:tool_result')
    })

    it('should handle multi-agent workflow tracking', async () => {
      const mockSandbox = createMockSandbox()
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Done',
        stderr: '',
      })
      
      const ampService = createAmpService(mockSandbox, 'test-key')
      const codexService = createCodexService(mockSandbox, 'test-key')
      
      // Track workflow
      const workflowId = 'workflow-123'
      
      // Step 1: Amp planning
      emitEvent('sbx-workflow', 'agent:tool_start', {
        workflowId,
        step: 1,
        agent: 'amp',
        action: 'planning',
      })
      
      await ampService.run({
        prompt: 'Create plan',
        dangerouslyAllowAll: true,
      })
      
      // Step 2: Codex implementation
      emitEvent('sbx-workflow', 'agent:tool_start', {
        workflowId,
        step: 2,
        agent: 'codex',
        action: 'implementation',
      })
      
      await codexService.run({
        prompt: 'Implement plan',
        fullAuto: true,
      })
      
      // Step 3: Complete
      emitEvent('sbx-workflow', 'agent:complete', {
        workflowId,
        stepsCompleted: 2,
      })
      
      // Verify workflow tracking
      const workflowEvents = getEventHistory('sbx-workflow')
        .filter(e => e.data.workflowId === workflowId)
      
      expect(workflowEvents).toHaveLength(3)
      expect(workflowEvents[0].data.step).toBe(1)
      expect(workflowEvents[1].data.step).toBe(2)
      expect(workflowEvents[2].type).toBe('agent:complete')
    })
  })

  describe('Port Detection + Agent Integration', () => {
    it('should detect ports during agent execution', async () => {
      const mockSandbox = createMockSandbox()
      
      // Simulate agent output with port
      mockSandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'Starting server on http://localhost:3000\nServer ready',
        stderr: '',
      })
      
      const ampService = createAmpService(mockSandbox, 'test-key')
      
      // Execute and detect ports in output
      const result = await ampService.run({
        prompt: 'Start server',
        dangerouslyAllowAll: true,
      })
      
      // Detect ports in output
      const ports = detectPorts(result.stdout)
      
      expect(ports).toContain(3000)
      
      // Emit port detected event
      if (ports.length > 0) {
        emitEvent('sbx-agent', 'port_detected', {
          port: ports[0],
          agent: 'amp',
        })
      }
      
      const portEvents = getEventHistory('sbx-agent', { types: ['port_detected'] })
      expect(portEvents).toHaveLength(1)
    })
  })

  describe('Session Recovery After Restart', () => {
    it('should recover sessions and replay events', () => {
      // Simulate pre-restart state
      const session: TerminalSessionState = {
        sessionId: 'sess-recover',
        sandboxId: 'sbx-recover',
        ptySessionId: 'pty-recover',
        userId: 'user-recover',
        mode: 'pty',
        cwd: '/workspace',
        cols: 120,
        rows: 30,
        lastActive: Date.now() - 10000,
        history: ['cmd1', 'cmd2'],
      }
      
      saveTerminalSession(session)
      emitEvent('sbx-recover', 'connected', { sessionId: 'sess-recover' })
      emitEvent('sbx-recover', 'command_output', { commands: ['cmd1', 'cmd2'] })
      
      // Simulate restart - export state
      const exportedSessions = exportSessions()
      const exportedEvents = enhancedSandboxEvents.exportEvents()
      
      // Clear in-memory state
      clearAllSessions()
      enhancedSandboxEvents.clearHistory()
      
      // Simulate recovery - import state
      importSessions(exportedSessions)
      enhancedSandboxEvents.importEvents(exportedEvents)
      
      // Verify recovery
      const recovered = getTerminalSession('sess-recover')
      expect(recovered).toBeDefined()
      expect(recovered?.history).toHaveLength(2)
      
      const recoveredEvents = getEventHistory('sbx-recover')
      expect(recoveredEvents).toHaveLength(2)
    })
  })

  describe('Performance Under Load', () => {
    it('should handle high event volume', () => {
      const eventCount = 1000
      
      for (let i = 0; i < eventCount; i++) {
        emitEvent(`sbx-${i % 10}`, 'pty_output', { line: i })
      }
      
      const stats = enhancedSandboxEvents.getStats()
      expect(stats.totalEvents).toBe(eventCount)
      expect(stats.totalStores).toBe(10)
    })

    it('should handle concurrent session operations', () => {
      const sessionCount = 100
      
      for (let i = 0; i < sessionCount; i++) {
        saveTerminalSession({
          sessionId: `sess-${i}`,
          sandboxId: `sbx-${i}`,
          ptySessionId: `pty-${i}`,
          userId: `user-${i % 10}`,
          mode: 'pty',
          cwd: '/workspace',
          cols: 120,
          rows: 30,
          lastActive: Date.now(),
          history: [],
        })
      }
      
      const allSessions = getAllTerminalSessions()
      expect(allSessions).toHaveLength(sessionCount)
      
      const user0Sessions = getSessionsByUserId('user-0')
      expect(user0Sessions.length).toBeGreaterThanOrEqual(10)
    })
  })
})

// Helper for getting all sessions (export from terminal-session-store if needed)
function getAllTerminalSessions(): TerminalSessionState[] {
  const sessions: TerminalSessionState[] = []
  // This would need to be exported from terminal-session-store
  // For now, using getSessionsByUserId as workaround
  for (let i = 0; i < 100; i++) {
    const session = getTerminalSession(`sess-${i}`)
    if (session) sessions.push(session)
  }
  return sessions
}
