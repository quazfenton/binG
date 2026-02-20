import { getSandboxProvider, type SandboxHandle, type PtyHandle as ProviderPtyHandle, type SandboxProviderType } from './providers'
import { updateSession } from './session-store'
import type { PreviewInfo } from './types'

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

const activePtyConnections = new Map<string, PtyConnection>()
const commandModeConnections = new Map<string, CommandModeConnection>()

const PORT_PATTERNS = [
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/,
  /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /started\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /server\s+(?:running|started)\s+(?:at|on)\s+.*?:(\d+)/i,
]

export class TerminalManager {
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
    const primaryType = (process.env.SANDBOX_PROVIDER || 'daytona') as SandboxProviderType
    
    // Track tried providers to avoid duplicates
    const tried = new Set<SandboxProviderType>()
    
    const tryProvider = async (
      providerType: SandboxProviderType,
    ): Promise<{ handle: SandboxHandle; providerType: SandboxProviderType } | null> => {
      if (tried.has(providerType)) return null
      tried.add(providerType)
      try {
        const provider = getSandboxProvider(providerType)
        const handle = await provider.getSandbox(sandboxId)
        return { handle, providerType }
      } catch {
        return null
      }
    }
    
    // Try primary provider first
    const primaryResult = await tryProvider(primaryType)
    if (primaryResult) return primaryResult
    
    // Try all known providers to locate the sandbox (supports quota-based fallbacks)
    // This is critical because sandbox-service can create sandboxes on any provider via fallback
    const allProviders: SandboxProviderType[] = ['daytona', 'runloop', 'microsandbox', 'e2b']
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

  async createTerminalSession(
    sessionId: string,
    sandboxId: string,
    onData: (data: string) => void,
    onPortDetected?: (info: PreviewInfo) => void,
    options?: { cols?: number; rows?: number },
  ): Promise<string> {
    const { handle, providerType } = await this.resolveHandleForSandbox(sandboxId)
    const provider = getSandboxProvider(providerType)
    const ptyId = `pty-${sessionId}-${Date.now()}`

    // Clean up existing connection in either mode.
    await this.disconnectTerminal(sessionId)

    if (!handle.createPty) {
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
      onData('\r\n\x1b[33m[command-mode] PTY unavailable, using line-based execution.\x1b[0m\r\n')
      onData(`${handle.workspaceDir || '/workspace'} $ `)
      updateSession(sessionId, { ptySessionId: 'command-mode' })
      return 'command-mode'
    }

    const ptyHandle = await handle.createPty({
      id: ptyId,
      envs: { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
      cols: options?.cols ?? 120,
      rows: options?.rows ?? 30,
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

    activePtyConnections.set(sessionId, {
      ptyHandle,
      sandboxId,
      sessionId,
      lastActive: Date.now(),
      detectedPorts: new Set(),
    })

    updateSession(sessionId, { ptySessionId: ptyId })
    return ptyId
  }

  async reconnectTerminal(
    sessionId: string,
    sandboxId: string,
    ptySessionId: string,
    onData: (data: string) => void,
    onPortDetected?: (info: PreviewInfo) => void,
  ): Promise<void> {
    const { handle, providerType } = await this.resolveHandleForSandbox(sandboxId)
    const provider = getSandboxProvider(providerType)

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
    if (!cmdConn) throw new Error(`No active terminal session for ${sessionId}`)
    cmdConn.lastActive = Date.now()
    await this.sendCommandModeInput(cmdConn, data)
  }

  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (conn) {
      await conn.ptyHandle.resize(cols, rows)
      return
    }
    // Command mode is line-based; no-op for resize.
  }

  async disconnectTerminal(sessionId: string): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (conn) {
      try {
        await conn.ptyHandle.disconnect()
      } finally {
        activePtyConnections.delete(sessionId)
      }
    }

    commandModeConnections.delete(sessionId)
  }

  async killTerminal(sessionId: string): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (conn) {
      try {
        await conn.ptyHandle.kill()
      } finally {
        activePtyConnections.delete(sessionId)
      }
    }

    commandModeConnections.delete(sessionId)
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

  private async executeCommandModeCommand(conn: CommandModeConnection, command: string): Promise<void> {
    const provider = getSandboxProvider(conn.providerType)
    const handle = await provider.getSandbox(conn.sandboxId)

    if (command === 'clear') {
      conn.onData('\x1bc')
      return
    }

    if (command === 'pwd') {
      conn.onData(`${conn.cwd}\r\n`)
      return
    }

    if (command.startsWith('cd ')) {
      const target = command.slice(3).trim()
      if (!target) return
      const result = await handle.executeCommand(`cd ${target} && pwd`, conn.cwd, 30)
      if (result.success) {
        const next = result.output.trim().split('\n').pop()
        if (next) conn.cwd = next
      } else if (result.output) {
        conn.onData(`${result.output}\r\n`)
      }
      return
    }

    const result = await handle.executeCommand(command, conn.cwd, 120)
    const output = result.output || ''
    if (output) {
      const normalized = output.replace(/\r?\n/g, '\r\n')
      conn.onData(`${normalized}${normalized.endsWith('\r\n') ? '' : '\r\n'}`)
      if (conn.onPortDetected) {
        await this.detectPort(output, handle, conn.onPortDetected, conn)
      }
    }
    if (!result.success) {
      conn.onData(`\x1b[31m[exit ${result.exitCode ?? 1}]\x1b[0m\r\n`)
    }
  }

  private async detectPort(
    output: string,
    handle: SandboxHandle,
    callback: (info: PreviewInfo) => void,
    connection: { detectedPorts: Set<number> },
  ): Promise<void> {
    if (!handle.getPreviewLink) return

    for (const pattern of PORT_PATTERNS) {
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
