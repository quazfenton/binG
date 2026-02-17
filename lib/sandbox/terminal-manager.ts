import { getSandboxProvider, type SandboxHandle, type PtyHandle as ProviderPtyHandle } from './providers'
import { updateSession } from './session-store'
import type { PreviewInfo } from './types'

interface PtyConnection {
  ptyHandle: ProviderPtyHandle
  sandboxId: string
  sessionId: string
  lastActive: number
  detectedPorts: Set<number>
}

const activePtyConnections = new Map<string, PtyConnection>()

const PORT_PATTERNS = [
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/,
  /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /started\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /server\s+(?:running|started)\s+(?:at|on)\s+.*?:(\d+)/i,
]

export class TerminalManager {
  async createTerminalSession(
    sessionId: string,
    sandboxId: string,
    onData: (data: string) => void,
    onPortDetected?: (info: PreviewInfo) => void,
    options?: { cols?: number; rows?: number },
  ): Promise<string> {
    const provider = getSandboxProvider()
    const handle = await provider.getSandbox(sandboxId)
    const ptyId = `pty-${sessionId}-${Date.now()}`

    if (!handle.createPty) {
      throw new Error(`Provider '${provider.name}' does not support PTY sessions`)
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
    const provider = getSandboxProvider()
    const handle = await provider.getSandbox(sandboxId)

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
    if (!conn) throw new Error(`No active PTY for session ${sessionId}`)
    conn.lastActive = Date.now()
    await conn.ptyHandle.sendInput(data)
  }

  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (!conn) return
    await conn.ptyHandle.resize(cols, rows)
  }

  async disconnectTerminal(sessionId: string): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (!conn) return

    try {
      await conn.ptyHandle.disconnect()
    } finally {
      activePtyConnections.delete(sessionId)
    }
  }

  async killTerminal(sessionId: string): Promise<void> {
    const conn = activePtyConnections.get(sessionId)
    if (!conn) return

    try {
      await conn.ptyHandle.kill()
    } finally {
      activePtyConnections.delete(sessionId)
    }
  }

  isConnected(sessionId: string): boolean {
    return activePtyConnections.has(sessionId)
  }

  private async detectPort(
    output: string,
    handle: SandboxHandle,
    callback: (info: PreviewInfo) => void,
    connection: PtyConnection,
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
