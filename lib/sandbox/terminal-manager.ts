/**
 * Terminal Manager
 *
 * Manages terminal sessions across all sandbox providers
 * Enhanced with:
 * - Enhanced port detection (10+ patterns)
 * - Terminal session persistence
 * - Enhanced event emission
 *
 * @see lib/sandbox/enhanced-port-detector.ts
 * @see lib/sandbox/terminal-session-store.ts
 * @see lib/sandbox/sandbox-events-enhanced.ts
 */

import { getSandboxProvider, type SandboxHandle, type PtyHandle as ProviderPtyHandle, type SandboxProviderType } from './providers'
import { updateSession } from './session-store'
import type { PreviewInfo } from './types'
import { enhancedPortDetector } from './enhanced-port-detector'
import {
  saveTerminalSession,
  getTerminalSession,
  updateTerminalSession,
  deleteTerminalSession,
  type TerminalSessionState,
} from './terminal-session-store'
import { emitEvent } from './sandbox-events'
import { createLogger } from '@/lib/utils/logger'

const log = createLogger('TerminalManager')

interface PtyConnection {
  ptyHandle: ProviderPtyHandle
  sandboxId: string
  sessionId: string
  lastActive: number
  detectedPorts: Set<number>
}

interface CommandModeConnection {
  sandboxId: string
  sessionId: string
  lastActive: number
  detectedPorts: Set<number>
  onData: (data: string) => void
  onPortDetected?: (info: PreviewInfo) => void
  lineBuffer: string
  cwd: string
  execQueue: Promise<void>
  providerType: SandboxProviderType
}

interface WebSocketConnection {
  sandboxId: string
  sessionId: string
  lastActive: number
  detectedPorts: Set<number>
  ws: any // WebSocket instance
}

const activePtyConnections = new Map<string, PtyConnection>()
const commandModeConnections = new Map<string, CommandModeConnection>()
const websocketConnections = new Map<string, WebSocketConnection>()

// ✅ FIX: Connection limits to prevent resource exhaustion
const MAX_PTY_CONNECTIONS = 50
const MAX_WEBSOCKET_CONNECTIONS = 100
const CONNECTION_IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

// Legacy port patterns (kept for backward compatibility)
const LEGACY_PORT_PATTERNS = [
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/,
  /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /started\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /server\s+(?:running|started)\s+(?:at|on)\s+.*?:(\d+)/i,
]

// ✅ FIX: Periodic cleanup of idle connections
setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  
  // Clean up idle PTY connections
  for (const [sessionId, conn] of activePtyConnections.entries()) {
    if (now - conn.lastActive > CONNECTION_IDLE_TIMEOUT_MS) {
      log.warn(`Cleaning up idle PTY connection: ${sessionId}`)
      activePtyConnections.delete(sessionId)
      cleaned++
    }
  }
  
  // Clean up idle command-mode connections
  for (const [sessionId, conn] of commandModeConnections.entries()) {
    if (now - conn.lastActive > CONNECTION_IDLE_TIMEOUT_MS) {
      log.warn(`Cleaning up idle command-mode connection: ${sessionId}`)
      commandModeConnections.delete(sessionId)
      cleaned++
    }
  }
  
  // Clean up idle WebSocket connections
  for (const [sessionId, conn] of websocketConnections.entries()) {
    if (now - conn.lastActive > CONNECTION_IDLE_TIMEOUT_MS) {
      log.warn(`Cleaning up idle WebSocket connection: ${sessionId}`)
      conn.ws.close(4008, 'Idle timeout')
      websocketConnections.delete(sessionId)
      cleaned++
    }
  }
  
  if (cleaned > 0) {
    log.info(`Cleaned up ${cleaned} idle connections`)
  }
}, 5 * 60 * 1000) // Run every 5 minutes

export class TerminalManager {
  private inferProviderFromSandboxId(sandboxId: string): SandboxProviderType | null {
    if (sandboxId.startsWith('mistral-')) return 'mistral'
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp'
    if (sandboxId.startsWith('blaxel-') || sandboxId.includes('-blaxel-')) return 'blaxel'
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-') || sandboxId.includes('-sprites-')) return 'sprites'
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer'
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem'
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn'
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter'
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent'
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox'
    return null
  }

  private getFallbackProviderType(): SandboxProviderType | null {
    if (process.env.SANDBOX_ENABLE_FALLBACK !== 'true') return null
    const fallbackType = (process.env.SANDBOX_FALLBACK_PROVIDER || 'microsandbox') as SandboxProviderType
    const primaryType = (process.env.SANDBOX_PROVIDER || 'daytona') as SandboxProviderType
    if (fallbackType === primaryType) return null
    return fallbackType
  }

  private async resolveHandleForSandbox(
    sandboxId: string,
  ): Promise<{ handle: SandboxHandle; providerType: SandboxProviderType }> {
    // Timeout wrapper for provider operations
    const PROVIDER_TIMEOUT_MS = 30_000; // 30s timeout per provider
    
    const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Provider ${label} timed out after ${ms}ms`)), ms)
        ),
      ])
    }

    const inferredProvider = this.inferProviderFromSandboxId(sandboxId)
    if (inferredProvider) {
      try {
        const provider = await getSandboxProvider(inferredProvider)
        const handle = await provider.getSandbox(sandboxId)
        return { handle, providerType: inferredProvider }
      } catch {
        // Continue to generic probing.
      }
    }

    const primaryType = (process.env.SANDBOX_PROVIDER || 'daytona') as SandboxProviderType
    
    // Track tried providers to avoid duplicates
    const tried = new Set<SandboxProviderType>()
    
    const tryProvider = async (
      providerType: SandboxProviderType,
    ): Promise<{ handle: SandboxHandle; providerType: SandboxProviderType } | null> => {
      if (tried.has(providerType)) return null
      tried.add(providerType)
      try {
        const provider = await getSandboxProvider(providerType)
        const handle = await withTimeout(
          provider.getSandbox(sandboxId),
          PROVIDER_TIMEOUT_MS,
          providerType
        )
        return { handle, providerType }
      } catch (err) {
        console.warn(`[TerminalManager] Provider ${providerType} failed:`, err instanceof Error ? err.message : 'Unknown error')
        return null
      }
    }
    
    // Try primary provider first
    const primaryResult = await tryProvider(primaryType)
    if (primaryResult) return primaryResult
    
    // Try all known providers to locate the sandbox (supports quota-based fallbacks)
    // This is critical because sandbox-service can create sandboxes on any provider via fallback
    const allProviders: SandboxProviderType[] = ['daytona', 'runloop', 'blaxel', 'blaxel-mcp', 'sprites', 'codesandbox', 'webcontainer', 'webcontainer-filesystem', 'webcontainer-spawn', 'opensandbox', 'opensandbox-code-interpreter', 'opensandbox-agent', 'microsandbox', 'e2b', 'mistral', 'vercel-sandbox'] //codesandbox***
    for (const providerType of allProviders) {
      const result = await tryProvider(providerType)
      if (result) return result
    }
    
    // Finally try explicit fallback provider if configured
    const fallbackType = this.getFallbackProviderType()
    if (fallbackType) {
      const fallbackResult = await tryProvider(fallbackType)
      if (fallbackResult) return fallbackResult
    }

    throw new Error(`Sandbox ${sandboxId} not found on configured providers`)
  }

  /**
   * Create a new terminal session
   * 
   * Enhanced with:
   * - Enhanced port detection
   * - Session persistence
   * - Event emission
   */
  async createTerminalSession(
    sessionId: string,
    sandboxId: string,
    onData: (data: string) => void,
    onPortDetected?: (info: PreviewInfo) => void,
    options?: { cols?: number; rows?: number },
    userId?: string,
  ): Promise<string> {
    log.info(`Creating terminal session: sessionId=${sessionId}, sandboxId=${sandboxId}`)
    
    const { handle, providerType } = await this.resolveHandleForSandbox(sandboxId)
    log.debug(`Resolved sandbox handle from provider: ${providerType}, workspace: ${handle.workspaceDir}`)
    const provider = await getSandboxProvider(providerType)
    const ptyId = `pty-${sessionId}-${Date.now()}`

    // Clean up existing connection in either mode.
    await this.disconnectTerminal(sessionId)

    // Emit session creation event
    emitEvent(sandboxId, 'connected', {
      sessionId,
      mode: handle.createPty ? 'pty' : 'command-mode',
      provider: providerType,
    }, { userId })

    if (!handle.createPty) {
      log.debug(`PTY not available for ${sandboxId}, using command-mode`)
      // Fallback providers (e.g. microsandbox) can still support command execution mode.
      commandModeConnections.set(sessionId, {
        sandboxId,
        sessionId,
        lastActive: Date.now(),
        detectedPorts: new Set(),
        onData,
        onPortDetected,
        lineBuffer: '',
        cwd: handle.workspaceDir || '/workspace',
        execQueue: Promise.resolve(),
        providerType,
      })

      const modeMessage = '\r\n\x1b[33m[command-mode] PTY unavailable, using line-based execution.\x1b[0m\r\n'
      onData(modeMessage)
      onData(`${handle.workspaceDir || '/workspace'} $ `)

      updateSession(sessionId, { ptySessionId: 'command-mode' })

      // Save terminal session for persistence
      saveTerminalSession({
        sessionId,
        sandboxId,
        ptySessionId: 'command-mode',
        userId: userId || '',
        mode: 'command-mode',
        cwd: handle.workspaceDir || '/workspace',
        cols: options?.cols ?? 120,
        rows: options?.rows ?? 30,
        lastActive: Date.now(),
        history: [],
      })
      log.info(`Terminal session created in command-mode for ${sessionId}`)

      return 'command-mode'
    }

    log.debug(`Creating PTY session with dimensions: ${options?.cols ?? 120}x${options?.rows ?? 30}`)

    let ptyHandle: any
    try {
      ptyHandle = await handle.createPty({
        id: ptyId,
        envs: { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
        cols: options?.cols ?? 120,
        rows: options?.rows ?? 30,
        onData: (data: Uint8Array) => {
          const text = new TextDecoder().decode(data)
          onData(text)

          // Enhanced port detection
          if (onPortDetected) {
            const detectedPorts = enhancedPortDetector.detectPorts(text)
            const connection = activePtyConnections.get(sessionId)

            for (const { port, protocol, url } of detectedPorts) {
              if (handle.getPreviewLink && !connection?.detectedPorts.has(port)) {
                handle.getPreviewLink(port).then(preview => {
                  log.info(`Port detected: ${port} (${protocol}) -> ${url || preview.url}`)
                  onPortDetected!(preview)
                  connection?.detectedPorts.add(port)

                  // Emit port detected event
                  emitEvent(sandboxId, 'port_detected', {
                    port,
                    url: url || preview.url,
                    protocol,
                }, { userId })
              }).catch(() => {
                // Port not yet available, ignore
              })
            }
          }
        }
      },
    })

    await ptyHandle.waitForConnection()

    // ✅ FIX: Check connection limit before adding
    if (activePtyConnections.size >= MAX_PTY_CONNECTIONS) {
      log.warn(`PTY connection limit reached (${MAX_PTY_CONNECTIONS}), cleaning up oldest`)
      // Clean up oldest connection
      let oldestId: string | null = null
      let oldestTime = Infinity
      for (const [id, conn] of activePtyConnections.entries()) {
        if (conn.lastActive < oldestTime) {
          oldestTime = conn.lastActive
          oldestId = id
        }
      }
      if (oldestId) {
        activePtyConnections.delete(oldestId)
        log.info(`Evicted oldest PTY connection: ${oldestId}`)
      }
    }

    // ✅ FIX: Wrap PTY connection in try-catch with cleanup on error
    try {
      await ptyHandle.waitForConnection()

      activePtyConnections.set(sessionId, {
        ptyHandle,
        sandboxId,
        sessionId,
        lastActive: Date.now(),
        detectedPorts: new Set(),
      })

      updateSession(sessionId, { ptySessionId: ptyId })

      // Save terminal session for persistence
      saveTerminalSession({
        sessionId,
        sandboxId,
        ptySessionId: ptyId,
        userId: userId || '',
        mode: 'pty',
        cwd: handle.workspaceDir || '/workspace',
        cols: options?.cols ?? 120,
        rows: options?.rows ?? 30,
        lastActive: Date.now(),
        history: [],
      })

      return ptyId
    } catch (error: any) {
      // ✅ FIX: Clean up on error to prevent connection leaks
      log.error(`PTY connection failed, cleaning up: ${error.message}`)
      activePtyConnections.delete(sessionId)
      throw error
    }
  } catch (error: any) {
    // Handle errors from createPty
    log.error(`Failed to create PTY: ${error.message}`)
    activePtyConnections.delete(sessionId)
    throw error
  }
  }

  async reconnectTerminal(
    sessionId: string,
    sandboxId: string,
    ptySessionId: string,
    onData: (data: string) => void,
    onPortDetected?: (info: PreviewInfo) => void,
  ): Promise<void> {
    const { handle, providerType } = await this.resolveHandleForSandbox(sandboxId)
    const provider = await getSandboxProvider(providerType)

    if (!handle.connectPty) {
      throw new Error(`Provider '${provider.name}' does not support PTY reconnection`)
    }

    const ptyHandle = await handle.connectPty(ptySessionId, {
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        onData(text)

        if (onPortDetected) {
          const connection = activePtyConnections.get(sessionId)
          if (connection) {
            this.detectPort(text, handle, onPortDetected, connection)
          }
        }
      },
    })

    await ptyHandle.waitForConnection()

    // Clean up existing connection if present (prevent resource leak)
    const existingConnection = activePtyConnections.get(sessionId)
    if (existingConnection) {
      try {
        await existingConnection.ptyHandle.disconnect()
      } catch {
        // Ignore errors during cleanup
      }
    }

    activePtyConnections.set(sessionId, {
      ptyHandle,
      sandboxId,
      sessionId,
      lastActive: Date.now(),
      detectedPorts: new Set(),
    })
  }

  async sendInput(sessionId: string, data: string): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (conn) {
      conn.lastActive = Date.now()
      await conn.ptyHandle.sendInput(data)
      return
    }

    const cmdConn = commandModeConnections.get(sessionId)
    if (cmdConn) {
      cmdConn.lastActive = Date.now()
      await this.sendCommandModeInput(cmdConn, data)
      return
    }

    // Check WebSocket connection
    const wsConn = websocketConnections.get(sessionId)
    if (wsConn) {
      wsConn.lastActive = Date.now()
      // Send input through WebSocket
      wsConn.ws.send(JSON.stringify({ type: 'input', data }))
      return
    }

    throw new Error(`No active terminal session for ${sessionId}`)
  }

  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (conn) {
      await conn.ptyHandle.resize(cols, rows)
      return
    }

    // Check WebSocket connection
    const wsConn = websocketConnections.get(sessionId)
    if (wsConn) {
      wsConn.ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      return
    }
    // Command mode is line-based; no-op for resize.
  }

  /**
   * Register a WebSocket connection for terminal session
   */
  registerWebSocketConnection(ws: any, sessionId: string, sandboxId: string): void {
    // ✅ FIX: Verify PTY connection exists first
    if (!this.hasPtyConnection(sessionId)) {
      log.warn(`Attempted to register WebSocket without PTY: ${sessionId}`)
      throw new Error('Cannot register WebSocket without PTY connection')
    }

    // ✅ FIX: Check connection limit before adding
    if (websocketConnections.size >= MAX_WEBSOCKET_CONNECTIONS) {
      log.warn(`WebSocket connection limit reached (${MAX_WEBSOCKET_CONNECTIONS}), closing oldest`)
      // Close oldest connection
      let oldestId: string | null = null
      let oldestTime = Infinity
      for (const [id, conn] of websocketConnections.entries()) {
        if (conn.lastActive < oldestTime) {
          oldestTime = conn.lastActive
          oldestId = id
        }
      }
      if (oldestId) {
        const oldestConn = websocketConnections.get(oldestId)
        if (oldestConn?.ws?.readyState === 1) { // WebSocket.OPEN
          oldestConn.ws.close(4009, 'Connection limit reached')
        }
        websocketConnections.delete(oldestId)
        log.info(`Evicted oldest WebSocket connection: ${oldestId}`)
      }
    }

    websocketConnections.set(sessionId, {
      ws,
      sandboxId,
      sessionId,
      lastActive: Date.now(),
      detectedPorts: new Set(),
    })
  }

  /**
   * Unregister a WebSocket connection
   */
  unregisterWebSocketConnection(sessionId: string): void {
    websocketConnections.delete(sessionId)
  }

  /**
   * Check if session has WebSocket connection
   */
  hasWebSocketConnection(sessionId: string): boolean {
    return websocketConnections.has(sessionId)
  }

  /**
   * Check if session has an actual PTY connection (not just WebSocket)
   */
  hasPtyConnection(sessionId: string): boolean {
    return activePtyConnections.has(sessionId)
  }

  /**
   * Disconnect terminal session
   * 
   * Enhanced with:
   * - Session cleanup
   * - Event emission
   */
  async disconnectTerminal(sessionId: string): Promise<void> {
    log.debug(`Disconnecting terminal session: ${sessionId}`)
    
    const conn = activePtyConnections.get(sessionId)
    if (conn) {
      try {
        log.debug(`Disconnecting PTY handle for ${sessionId}`)
        await conn.ptyHandle.disconnect()

        // Emit disconnect event
        emitEvent(conn.sandboxId, 'disconnected', {
          sessionId,
          reason: 'user_requested',
        })
      } finally {
        activePtyConnections.delete(sessionId)
        log.debug(`PTY connection removed for ${sessionId}`)
      }

      // Update session status
      deleteTerminalSession(sessionId)
      log.info(`Terminal session disconnected: ${sessionId}`)
    }

    const cmdConn = commandModeConnections.get(sessionId)
    if (cmdConn) {
      // Emit disconnect event for command mode
      emitEvent(cmdConn.sandboxId, 'disconnected', {
        sessionId,
        reason: 'user_requested',
      })

      commandModeConnections.delete(sessionId)
      deleteTerminalSession(sessionId)
      log.info(`Command-mode session disconnected: ${sessionId}`)
    }
  }

  /**
   * Kill terminal session
   * 
   * Enhanced with:
   * - Session cleanup
   * - Event emission
   */
  async killTerminal(sessionId: string): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (conn) {
      try {
        await conn.ptyHandle.kill()
        
        // Emit kill event
        emitEvent(conn.sandboxId, 'disconnected', {
          sessionId,
          reason: 'killed',
        })
      } finally {
        activePtyConnections.delete(sessionId)
      }
      
      // Update session status
      deleteTerminalSession(sessionId)
    }

    const cmdConn = commandModeConnections.get(sessionId)
    if (cmdConn) {
      // Emit kill event for command mode
      emitEvent(cmdConn.sandboxId, 'disconnected', {
        sessionId,
        reason: 'killed',
      })
      
      commandModeConnections.delete(sessionId)
      deleteTerminalSession(sessionId)
    }
  }

  isConnected(sessionId: string): boolean {
    return activePtyConnections.has(sessionId) || commandModeConnections.has(sessionId)
  }

  getConnection(sessionId: string): PtyConnection | undefined {
    return activePtyConnections.get(sessionId)
  }

  private async sendCommandModeInput(conn: CommandModeConnection, data: string): Promise<void> {
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        conn.onData('\r\n')
        const command = conn.lineBuffer.trim()
        conn.lineBuffer = ''

        if (!command) {
          conn.onData(`${conn.cwd} $ `)
          continue
        }

        conn.execQueue = conn.execQueue.then(async () => {
          try {
            await this.executeCommandModeCommand(conn, command)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            conn.onData(`\x1b[31m${msg}\x1b[0m\r\n`)
          } finally {
            conn.onData(`${conn.cwd} $ `)
          }
        })
        await conn.execQueue
      } else if (ch === '\u007f') {
        // Backspace
        if (conn.lineBuffer.length > 0) {
          conn.lineBuffer = conn.lineBuffer.slice(0, -1)
          conn.onData('\b \b')
        }
      } else if (ch >= ' ') {
        conn.lineBuffer += ch
        conn.onData(ch)
      }
    }
  }

  /**
   * Execute command in command mode
   * 
   * Enhanced with:
   * - Enhanced port detection
   * - Event emission
   * - History tracking
   */
  private async executeCommandModeCommand(conn: CommandModeConnection, command: string): Promise<void> {
    const provider = await getSandboxProvider(conn.providerType)
    const handle = await provider.getSandbox(conn.sandboxId)

    // Emit command start event
    emitEvent(conn.sandboxId, 'command_output', {
      sessionId: conn.sessionId,
      command,
      status: 'started',
    })

    if (command === 'clear') {
      conn.onData('\x1bc')
      
      // Update session history for clear command too
      const session = getTerminalSession(conn.sessionId)
      if (session) {
        const newHistory = [...session.history, command].slice(-100)
        updateTerminalSession(conn.sessionId, { history: newHistory })
      }
      
      emitEvent(conn.sandboxId, 'command_output', {
        sessionId: conn.sessionId,
        command: 'clear',
        status: 'completed',
      })
      return
    }

    if (command === 'pwd') {
      conn.onData(`${conn.cwd}\r\n`)
      
      // Update session history for pwd command too
      const session = getTerminalSession(conn.sessionId)
      if (session) {
        const newHistory = [...session.history, command].slice(-100)
        updateTerminalSession(conn.sessionId, { history: newHistory })
      }
      
      emitEvent(conn.sandboxId, 'command_output', {
        sessionId: conn.sessionId,
        command: 'pwd',
        status: 'completed',
        result: conn.cwd,
      })
      return
    }

    if (command.startsWith('cd ')) {
      const target = command.slice(3).trim()
      if (!target) return
      const result = await handle.executeCommand(`cd ${target} && pwd`, conn.cwd, 30)
      if (result.success) {
        const next = result.output.trim().split('\n').pop()
        if (next) {
          conn.cwd = next
          // Update session with new cwd
          updateTerminalSession(conn.sessionId, { cwd: next })
        }
      } else if (result.output) {
        conn.onData(`${result.output}\r\n`)
      }

      // Update session history for cd command too
      const session = getTerminalSession(conn.sessionId)
      if (session) {
        const newHistory = [...session.history, command].slice(-100)
        updateTerminalSession(conn.sessionId, { history: newHistory })
      }

      emitEvent(conn.sandboxId, 'command_output', {
        sessionId: conn.sessionId,
        command,
        status: result.success ? 'completed' : 'failed',
        cwd: conn.cwd,
      })
      return
    }

    const result = await handle.executeCommand(command, conn.cwd, 120)
    const output = result.output || ''
    if (output) {
      const normalized = output.replace(/\r?\n/g, '\r\n')
      conn.onData(`${normalized}${normalized.endsWith('\r\n') ? '' : '\r\n'}`)
      
      // Enhanced port detection
      if (conn.onPortDetected) {
        const detectedPorts = enhancedPortDetector.detectPorts(output)
        for (const { port, protocol, url } of detectedPorts) {
          if (handle.getPreviewLink && !conn.detectedPorts.has(port)) {
            handle.getPreviewLink(port).then(preview => {
              conn.onPortDetected!(preview)
              conn.detectedPorts.add(port)
              
              // Emit port detected event
              emitEvent(conn.sandboxId, 'port_detected', {
                port,
                url: url || preview.url,
                protocol,
                sessionId: conn.sessionId,
              })
            }).catch(() => {
              // Port not yet available, ignore
            })
          }
        }
      }
    }
    if (!result.success) {
      conn.onData(`\x1b[31m[exit ${result.exitCode ?? 1}]\x1b[0m\r\n`)
    }
    
    // Update session history
    const session = getTerminalSession(conn.sessionId)
    if (session) {
      const newHistory = [...session.history, command].slice(-100) // Keep last 100 commands
      updateTerminalSession(conn.sessionId, { history: newHistory })
    }
    
    // Emit command completion event
    emitEvent(conn.sandboxId, 'command_output', {
      sessionId: conn.sessionId,
      command,
      status: result.success ? 'completed' : 'failed',
      exitCode: result.exitCode,
    })
  }

  private async detectPort(
    output: string,
    handle: SandboxHandle,
    callback: (info: PreviewInfo) => void,
    connection: { detectedPorts: Set<number> },
  ): Promise<void> {
    if (!handle.getPreviewLink) return

    for (const pattern of LEGACY_PORT_PATTERNS) {
      const match = output.match(pattern)
      if (match) {
        const port = parseInt(match[1], 10)
        if (port > 0 && port < 65536 && !connection.detectedPorts.has(port)) {
          try {
            const preview = await handle.getPreviewLink(port)
            callback(preview)
            connection.detectedPorts.add(port)
          } catch {
            // Port not yet available, ignore
          }
          break
        }
      }
    }
  }
}

export const terminalManager = new TerminalManager()
