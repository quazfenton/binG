/**
 * Sandbox Connection Manager
 *
 * Handles WebSocket/SSE connection to sandbox with provider-specific PTY support.
 * Migrated from TerminalPanel.tsx lines 3267-3914
 *
 * Features:
 * - Connection throttling (5s cooldown)
 * - Abort controller management
 * - Spinner animation during connection
 * - Connection timeout (10s, then fallback)
 * - Session creation API calls
 * - Token retrieval
 * - WebSocket connection with full message handling
 * - Provider-specific PTY connections (E2B, Daytona, Sprites, CodeSandbox)
 * - Reconnection with exponential backoff
 * - SSE fallback when WebSocket unavailable
 * - Auto-cd to workspace
 * - Command queue buffering
 * - Agent tool execution display
 * - Port detection with toast notifications
 *
 * @example
 * ```typescript
 * const connectionManager = createSandboxConnectionManager({
 *   terminalId: 'term-1',
 *   write: (text) => term.write(text),
 *   writeLine: (text) => term.write(text + '\r\n'),
 *   updateTerminalState: (updates) => { ... },
 *   sendResize: (sessionId, cols, rows) => { ... },
 *   sendInput: (sessionId, data) => { ... },
 *   getPrompt: (mode, cwd) => getPrompt(mode, cwd),
 *   getCwd: () => localShellCwdRef.current[terminalId],
 *   setCwd: (cwd) => { localShellCwdRef.current[terminalId] = cwd },
 *   getAuthToken: () => localStorage.getItem('token'),
 *   getAuthHeaders: () => ({ Authorization: `Bearer ${token}` }),
 *   toSandboxScopedPath: (scopePath, sandboxId) => { ... },
 *   filesystemScopePath: 'project/sessions/...',
 * })
 *
 * await connectionManager.connect()
 * connectionManager.sendInput('ls -la\n')
 * connectionManager.sendResize(120, 30)
 * await connectionManager.disconnect()
 * ```
 */

import { createLogger } from '../utils/logger'
import type { SandboxProviderType } from './providers'

const logger = createLogger('SandboxConnection')

// Connection configuration
const CONNECTION_TIMEOUT_MS = parseInt(
  process.env.NEXT_PUBLIC_TERMINAL_CONNECTION_TIMEOUT_MS || '30000',
  10
) // Default 30s (configurable via env), increased from 10s to allow slow providers like Daytona
const CONNECTION_COOLDOWN_MS = 5000 // 5 seconds
const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_RECONNECT_DELAY = 1000 // 1 second
const HEALTH_CHECK_INTERVAL = 30000 // 30 seconds
const CUSTOM_WS_BASE_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL?.replace(/\/+$/, '')

// Spinner animation frames
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface SandboxConnectionManagerConfig {
  terminalId: string
  write: (text: string) => void
  writeLine: (text: string) => void
  updateTerminalState: (updates: any) => void
  sendResize: (sessionId: string, cols: number, rows: number) => void
  sendInput: (sessionId: string, data: string) => void
  getPrompt: (mode: string, cwd: string) => string
  getCwd: () => string
  setCwd: (cwd: string) => void
  getAuthToken: () => string | null
  getAuthHeaders: () => Record<string, string>
  toSandboxScopedPath: (scopePath: string, sandboxId: string) => string
  filesystemScopePath?: string
  getAnonymousSessionId: () => string | null
}

export interface SandboxConnectionState {
  sessionId?: string
  sandboxId?: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  mode: 'pty' | 'sandbox-cmd' | 'local'
  websocket?: WebSocket | null
  eventSource?: EventSource | null
  reconnectAttempts: number
  lastConnectionAttempt: number
}

export class SandboxConnectionManager {
  private terminalId: string
  private write: (text: string) => void
  private writeLine: (text: string) => void
  private updateTerminalState: (updates: any) => void
  private sendResize: (sessionId: string, cols: number, rows: number) => void
  private sendInput: (sessionId: string, data: string) => void
  private getPrompt: (mode: string, cwd: string) => string
  private getCwd: () => string
  private setCwd: (cwd: string) => void
  private getAuthToken: () => string | null
  private getAuthHeaders: () => Record<string, string>
  private toSandboxScopedPath: (scopePath: string, sandboxId: string) => string
  private filesystemScopePath?: string
  private getAnonymousSessionId: () => string | null

  private state: SandboxConnectionState = {
    status: 'disconnected',
    mode: 'local',
    reconnectAttempts: 0,
    lastConnectionAttempt: 0,
  }

  private abortController?: AbortController
  private spinnerInterval?: NodeJS.Timeout
  private connectionTimeout?: NodeJS.Timeout
  private healthCheckInterval?: NodeJS.Timeout
  private commandQueue: string[] = []

  constructor(config: SandboxConnectionManagerConfig) {
    this.terminalId = config.terminalId
    this.write = config.write
    this.writeLine = config.writeLine
    this.updateTerminalState = config.updateTerminalState
    this.sendResize = config.sendResize
    this.sendInput = config.sendInput
    this.getPrompt = config.getPrompt
    this.getCwd = config.getCwd
    this.setCwd = config.setCwd
    this.getAuthToken = config.getAuthToken
    this.getAuthHeaders = config.getAuthHeaders
    this.toSandboxScopedPath = config.toSandboxScopedPath
    this.filesystemScopePath = config.filesystemScopePath
    this.getAnonymousSessionId = config.getAnonymousSessionId
  }

  /**
   * Connect to sandbox
   */
  async connect(): Promise<void> {
    // Check cooldown
    const now = Date.now()
    const timeSinceLastAttempt = now - this.state.lastConnectionAttempt
    if (timeSinceLastAttempt < CONNECTION_COOLDOWN_MS) {
      const remaining = Math.ceil((CONNECTION_COOLDOWN_MS - timeSinceLastAttempt) / 1000)
      this.writeLine(`\x1b[90mReconnect cooldown: ${remaining}s remaining.\x1b[0m`)
      return
    }

    // Record connection attempt
    this.state.lastConnectionAttempt = now

    // Abort any pending connection
    this.abortController?.abort()
    this.abortController = new AbortController()

    // Update state to connecting
    this.updateTerminalState({
      sandboxInfo: { status: 'creating' },
      mode: 'connecting',
    })
    this.state.status = 'connecting'

    // Write connection message
    this.writeLine('')
    this.writeLine('\x1b[33m⟳ Connecting to sandbox...\x1b[0m')
    this.writeLine('\x1b[90mStep 1/2: Creating or verifying sandbox instance...\x1b[0m')
    this.writeLine('\x1b[90mThis may take 20-30s on first connection.\x1b[0m')
    this.writeLine('')

    // Start spinner
    this.startSpinner()

    // Declare token at method scope so catch block can reuse it
    let connectionToken: string | undefined

    try {
      // Create sandbox session
      const sessionResponse = await fetch('/api/sandbox/terminal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        credentials: 'include',
        signal: this.abortController.signal,
      })

      if (!sessionResponse.ok) {
        const errorData = await sessionResponse.json().catch(() => ({}))

        // Handle auth error
        if (sessionResponse.status === 401 && errorData.requiresAuth) {
          this.handleAuthRequired()
          return
        }

        throw new Error(errorData.error || 'Failed to create sandbox session')
      }

      const sessionData = await sessionResponse.json()
      const { sessionId, sandboxId } = sessionData

      this.state.sessionId = sessionId
      this.state.sandboxId = sandboxId

      // Detect provider type from sandbox ID prefix
      const providerType = this.detectProviderType(sandboxId)
      logger.debug(`Detected provider type: ${providerType} for sandbox ${sandboxId}`)

      // Update user with progress
      this.writeLine('\x1b[90mStep 2/2: Establishing terminal connection...\x1b[0m')

      // Get connection token (reuses outer-scope declaration)
      try {
        const tokenResponse = await fetch('/api/sandbox/terminal/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders(),
          },
          credentials: 'include',
          body: JSON.stringify({ sessionId, sandboxId }),
        })

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json()
          connectionToken = tokenData.connectionToken
        }
      } catch (err) {
        logger.warn('Failed to get connection token', err)
      }

      // NOW start the timeout for the SSE/PTY connection phase only
      this.connectionTimeout = setTimeout(() => {
        this.handleConnectionTimeout()
      }, CONNECTION_TIMEOUT_MS)

      // Try SSE first — it uses standard HTTP/1.1 with no protocol upgrade,
      // making it reliable behind Next.js proxies, load balancers, and reverse proxies.
      logger.info('[Terminal] Attempting SSE connection (primary transport)')
      await this.connectSSE(sessionId, sandboxId, connectionToken)
      // SSE is event-based; connection success is confirmed via 'connected' message
      // in handleSSEMessage which calls stopSpinner and updates state
      logger.info('[Terminal] SSE connection established — using SSE transport')
      return // SSE successful, exit early

    } catch (sseError: any) {
      // Check if this was an intentional abort (timeout already handled)
      if (sseError.name === 'AbortError' || sseError.message?.includes('aborted')) {
        logger.debug('[Terminal] Connection aborted (timeout or cancellation)')
        // Timeout handler already fell back to local mode, don't attempt PTY fallback
        return
      }

      // SSE failed — try provider-specific PTY WebSocket as fallback
      // Reuse sessionId, sandboxId from state; reuse connectionToken from earlier fetch
      const sessionState = this.state
      const { sessionId, sandboxId } = sessionState

      // Guard: skip PTY fallback if we don't have a session
      if (!sessionId || !sandboxId) {
        logger.warn('[Terminal] No session/sandbox ID for PTY fallback, skipping')
        this.handleConnectionError(new Error('No session available for terminal connection'))
        return
      }

      const providerType = this.detectProviderType(sandboxId)
      // Reuse the connectionToken from the successful fetch above (don't redeclare)
      logger.warn('[Terminal] SSE failed, trying provider PTY WebSocket', sseError)

      if (providerType && ['e2b', 'daytona', 'sprites', 'codesandbox', 'vercel-sandbox'].includes(providerType)) {
        try {
          logger.debug(`Trying ${providerType} PTY WebSocket connection`)
          const providerWs = await this.connectProviderPTY(providerType, sandboxId, sessionId)
          if (providerWs) {
            logger.info(`${providerType} PTY connected via WebSocket fallback`)
            // Update state with provider WebSocket
            this.state.websocket = providerWs
            this.state.status = 'connected'
            this.state.mode = 'pty'
            this.stopSpinner()
            this.clearConnectionTimeout()

            this.updateTerminalState({
              sandboxInfo: { sessionId, sandboxId, status: 'active' },
              websocket: providerWs,
              isConnected: true,
              mode: 'pty',
            })

            this.writeLine('')
            this.writeLine(`\x1b[1;32m✓ Connected to ${providerType} sandbox!\x1b[0m`)
            this.writeLine('\x1b[90mYou now have full terminal access.\x1b[0m')
            this.writeLine('')

            // Auto-cd to workspace
            if (this.filesystemScopePath) {
              const sandboxPath = this.toSandboxScopedPath(this.filesystemScopePath, sandboxId)
              this.setCwd(this.filesystemScopePath)
              this.writeLine(`\x1b[90m→ cd ${sandboxPath}\x1b[0m`)
              this.sendInput(sessionId, `cd ${sandboxPath}\n`)
            }

            // Send initial resize
            this.sendResize(sessionId, 120, 30)

            // Flush command queue
            for (const cmd of this.commandQueue) {
              this.sendInput(sessionId, cmd)
            }
            this.commandQueue = []
            return // Provider PTY successful, exit early
          }
        } catch (providerError) {
          logger.warn(`${providerType} PTY WebSocket also failed`, providerError)
          // Fall through to generic WebSocket or error
        }
      }

      // Try generic WebSocket only when a real custom WS endpoint is configured
      if (CUSTOM_WS_BASE_URL) {
        try {
          logger.info('[Terminal] Attempting generic WebSocket as final fallback')
          await this.connectWebSocket(sessionId, sandboxId, connectionToken)
          logger.info('[Terminal] WebSocket fallback successful — using WS transport')
          return // WebSocket successful, exit early
        } catch (wsError) {
          logger.warn('[Terminal] Generic WebSocket failed', wsError)
          // Fall through to error handling
        }
      }

      // All transports failed
      this.handleConnectionError(sseError)
    }
  }

  /**
   * Detect provider type from sandbox ID prefix
   */
  private detectProviderType(sandboxId: string): SandboxProviderType | null {
    if (!sandboxId) return null
    
    const lowerId = sandboxId.toLowerCase()
    
    // E2B new format: some IDs don't have the 'e2b-' prefix (e.g., 'ii8938a6cyxwggwamxh1k')
    const isE2BFormat = /^[a-z0-9]{15,25}$/i.test(sandboxId);
    if (isE2BFormat) return 'e2b';
    
    if (lowerId.startsWith('e2b-') || lowerId.startsWith('e2b_')) return 'e2b'
    if (lowerId.startsWith('daytona-') || lowerId.startsWith('daytona_')) return 'daytona'
    if (lowerId.startsWith('sprite-') || lowerId.startsWith('sprite_') || lowerId.startsWith('bing-')) return 'sprites'
    if (lowerId.startsWith('codesandbox-') || lowerId.startsWith('csb-')) return 'codesandbox'
    if (lowerId.startsWith('vercel-') || lowerId.startsWith('vc-')) return 'vercel-sandbox'
    if (lowerId.startsWith('mistral-')) return 'mistral-agent'
    if (lowerId.startsWith('blaxel-')) return 'blaxel'
    if (lowerId.startsWith('micro-')) return 'microsandbox'
    
    return null
  }

  /**
   * Connect via WebSocket
   */
  private async connectWebSocket(sessionId: string, sandboxId: string, connectionToken?: string): Promise<void> {
    if (!CUSTOM_WS_BASE_URL) {
      throw new Error('Custom terminal WebSocket endpoint is not configured')
    }

    const wsUrl = new URL(`${CUSTOM_WS_BASE_URL}/ws`)
    wsUrl.searchParams.set('sessionId', sessionId)
    wsUrl.searchParams.set('sandboxId', sandboxId)
    if (connectionToken) {
      wsUrl.searchParams.set('token', connectionToken)
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl.toString())
      let settled = false

      const rejectConnection = (error: Error) => {
        if (settled) return
        settled = true
        this.state.websocket = null
        reject(error)
      }

      this.state.websocket = ws

      ws.onopen = () => {
        if (settled) return
        settled = true
        logger.debug('WebSocket connected', { sessionId, sandboxId })
        resolve()
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          this.handleWebSocketMessage(msg)
        } catch (err) {
          logger.error('Failed to parse WebSocket message', err)
        }
      }

      ws.onerror = (err) => {
        logger.warn('WebSocket error', err)
        rejectConnection(new Error('WebSocket connection failed'))
      }

      ws.onclose = (event) => {
        if (!settled) {
          rejectConnection(new Error(`WebSocket closed before connection (${event.code})`))
          return
        }
        this.handleWebSocketClose(event)
      }

      this.updateTerminalState({
        sandboxInfo: { sessionId, sandboxId, status: 'creating' },
        websocket: ws,
        isConnected: false,
      })
    })
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(msg: any): void {
    switch (msg.type) {
      case 'error': {
        this.stopSpinner()
        this.clearConnectionTimeout()

        this.writeLine(`\x1b[31m${msg.error || msg.data || 'Unknown error'}\x1b[0m`)
        this.fallbackToCommandMode()
        break
      }

      case 'connected': {
        this.stopSpinner()
        this.clearConnectionTimeout()

        this.updateTerminalState({
          sandboxInfo: {
            sessionId: this.state.sessionId,
            sandboxId: this.state.sandboxId,
            status: 'active',
          },
          isConnected: true,
          mode: 'pty',
        })
        this.state.status = 'connected'
        this.state.mode = 'pty'

        this.writeLine('')
        this.writeLine('\x1b[1;32m✓ Sandbox connected!\x1b[0m')
        this.writeLine('\x1b[90mYou now have full terminal access.\x1b[0m')
        this.writeLine('')

        // Auto-cd to workspace
        if (this.filesystemScopePath) {
          const sandboxPath = this.toSandboxScopedPath(this.filesystemScopePath, this.state.sandboxId!)
          this.setCwd(this.filesystemScopePath)
          this.writeLine(`\x1b[90m→ cd ${sandboxPath}\x1b[0m`)
          this.sendInput(this.state.sessionId!, `cd ${sandboxPath}\n`)
        }

        // Send initial resize
        this.sendResize(this.state.sessionId!, 120, 30)

        // Flush command queue
        for (const cmd of this.commandQueue) {
          this.sendInput(this.state.sessionId!, cmd)
        }
        this.commandQueue = []
        break
      }

      case 'pty':
        this.write(msg.data)
        break

      case 'agent:tool_start':
        this.writeLine('')
        this.writeLine(`\x1b[1;35m🤖 Agent → ${msg.data.toolName}\x1b[0m`)
        if (msg.data.toolName === 'exec_shell' && msg.data.args?.command) {
          this.writeLine(`\x1b[90m   $ ${msg.data.args.command}\x1b[0m`)
        }
        break

      case 'agent:tool_result': {
        const r = msg.data.result
        if (r?.success) {
          this.writeLine(`\x1b[32m   ✓ Success\x1b[0m`)
        } else {
          this.writeLine(`\x1b[31m   ✗ Failed (exit ${r?.exitCode ?? '?'})\x1b[0m`)
        }
        if (r?.output) {
          const lines = r.output.split('\n')
          const maxLines = 15
          const display = lines.length > maxLines
            ? [...lines.slice(0, maxLines), `\x1b[90m   ... (${lines.length - maxLines} more lines)\x1b[0m`]
            : lines
          display.forEach((line: string) => {
            this.writeLine(`\x1b[90m   ${line}\x1b[0m`)
          })
        }
        break
      }

      case 'agent:complete':
        this.writeLine('')
        this.writeLine(`\x1b[1;32m🤖 Agent complete (${msg.data.totalSteps ?? 0} steps)\x1b[0m`)
        this.writeLine('')
        break

      case 'port_detected':
        this.writeLine('')
        this.writeLine(`\x1b[1;34m🌐 Preview: ${msg.data.url}\x1b[0m`)
        this.showToast(`Preview available on port ${msg.data.port}`, msg.data.url)
        break

      case 'ping':
        // Keepalive - no response needed
        break
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleWebSocketError(): void {
    this.writeLine('\x1b[33m⚠ PTY unavailable. Falling back to command-mode.\x1b[0m')
    this.writeLine('\x1b[90mType "connect" to retry PTY connection.\x1b[0m')
    this.fallbackToCommandMode()
  }

  /**
   * Handle WebSocket close
   */
  private handleWebSocketClose(event: CloseEvent): void {
    // Don't reconnect if already in command-mode
    if (this.state.mode === 'sandbox-cmd') {
      return
    }

    // If never opened, fall back immediately
    if (this.state.reconnectAttempts === 0) {
      logger.warn('WebSocket closed before connection, falling back to command-mode')
      this.fallbackToCommandMode()
      return
    }

    // Attempt reconnection with exponential backoff
    if (this.state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, this.state.reconnectAttempts)
      this.state.reconnectAttempts++

      logger.info('WebSocket closed, attempting reconnection', {
        attempt: this.state.reconnectAttempts,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        delay,
      })

      this.writeLine(`\x1b[33m⚠ Connection lost. Reconnecting (${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m`)

      setTimeout(() => {
        this.reconnectWebSocket()
      }, delay)
    } else {
      // Max reconnection attempts reached
      logger.warn('Max reconnection attempts reached, falling back to command-mode')
      this.writeLine('\x1b[31m⚠ Reconnection failed. Falling back to command-mode.\x1b[0m')
      this.writeLine('\x1b[90mType "connect" to retry PTY.\x1b[0m')
      this.fallbackToCommandMode()
    }
  }

  /**
   * Reconnect WebSocket
   */
  private reconnectWebSocket(): void {
    if (!this.state.sessionId || !this.state.sandboxId || !CUSTOM_WS_BASE_URL) {
      this.fallbackToCommandMode()
      return
    }

    const wsUrl = new URL(`${CUSTOM_WS_BASE_URL}/ws`)
    
    wsUrl.searchParams.set('sessionId', this.state.sessionId)
    wsUrl.searchParams.set('sandboxId', this.state.sandboxId)

    const ws = new WebSocket(wsUrl.toString())
    this.state.websocket = ws

    ws.onopen = () => {
      this.state.reconnectAttempts = 0
      logger.debug('WebSocket reconnected')
      this.writeLine('\x1b[32m✓ Reconnected!\x1b[0m')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        this.handleWebSocketMessage(msg)
      } catch (err) {
        logger.error('Failed to parse WebSocket message', err)
      }
    }

    ws.onerror = () => {
      this.handleWebSocketError()
    }

    ws.onclose = (event) => {
      this.handleWebSocketClose(event)
    }
  }

  /**
   * Connect via SSE
   */
  private async connectSSE(sessionId: string, sandboxId: string, connectionToken?: string): Promise<void> {
    const tokenParam = connectionToken ? `&token=${encodeURIComponent(connectionToken)}` : ''
    const anonymousSessionId = this.getAnonymousSessionId()
    const anonymousParam = anonymousSessionId ? `&anonymousSessionId=${encodeURIComponent(anonymousSessionId)}` : ''

    const streamUrl = `/api/sandbox/terminal/stream?sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(sandboxId)}${tokenParam}${anonymousParam}`

    logger.info('[Terminal SSE] Connecting to', streamUrl)

    const eventSource = new EventSource(streamUrl)
    this.state.eventSource = eventSource

    // Wrap EventSource in a Promise so connect() waits for 'connected' or error
    return new Promise<void>((resolve, reject) => {
      let settled = false

      // Set a connection timeout for SSE (slightly longer than overall timeout to allow PTY setup)
      const sseTimeout = setTimeout(() => {
        if (!settled) {
          settled = true
          eventSource.close()
          this.state.eventSource = null
          logger.warn('[Terminal SSE] Connection timeout — no response from server')
          reject(new Error('SSE connection timed out — server did not respond'))
        }
      }, 35000) // 35s timeout for SSE (increased from 15s to allow slow PTY setup)

      eventSource.onopen = () => {
        logger.info('[Terminal SSE] EventSource connection opened')
      }

      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          logger.debug('[Terminal SSE] Received message:', msg.type)

          // Check for 'connected' message to resolve the promise
          if (msg.type === 'connected' && !settled) {
            settled = true
            clearTimeout(sseTimeout)
            logger.info('[Terminal SSE] Connected — resolving promise')
            resolve()
          }

          // Check for 'error' message to reject
          if (msg.type === 'error' && !settled) {
            settled = true
            clearTimeout(sseTimeout)
            eventSource.close()
            this.state.eventSource = null
            logger.error('[Terminal SSE] Server error:', msg.data)
            reject(new Error(msg.data || 'SSE server error'))
            return
          }

          // Handle all messages normally (including 'connected' which updates terminal state)
          this.handleSSEMessage(msg)
        } catch (err) {
          logger.error('[Terminal SSE] Failed to parse SSE message', err)
        }
      }

      eventSource.onerror = (err) => {
        if (settled) return
        settled = true
        clearTimeout(sseTimeout)
        eventSource.close()
        this.state.eventSource = null
        logger.error('[Terminal SSE] Connection error', err)
        reject(new Error('SSE connection failed — server unreachable or CORS blocked'))
      }
    })
  }

  /**
   * Connect to provider-specific PTY
   * Routes to appropriate provider implementation based on sandbox ID prefix or config
   */
  private async connectProviderPTY(
    providerType: SandboxProviderType,
    sandboxId: string,
    sessionId: string
  ): Promise<WebSocket | null> {
    logger.debug(`Connecting to provider PTY: ${providerType}`, { sandboxId, sessionId })

    switch (providerType) {
      case 'e2b':
        return this.connectE2BPTY(sandboxId, sessionId)
      case 'daytona':
        return this.connectDaytonaPTY(sandboxId, sessionId)
      case 'sprites':
        return this.connectSpritesPTY(sandboxId, sessionId)
      case 'codesandbox':
        return this.connectCodeSandboxPTY(sandboxId, sessionId)
      case 'vercel-sandbox':
        return this.connectVercelSandboxPTY(sandboxId, sessionId)
      default:
        // Use generic WebSocket for other providers
        return null
    }
  }

  /**
   * Connect to E2B PTY
   * Uses E2B's native PTY connection via backend proxy
   */
  private async connectE2BPTY(sandboxId: string, sessionId: string): Promise<WebSocket | null> {
    try {
      logger.debug('Connecting to E2B PTY', { sandboxId })
      
      // Get E2B PTY URL from backend
      const response = await fetch('/api/sandbox/provider/pty', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ sandboxId, sessionId }),
      })

      if (!response.ok) {
        logger.warn('E2B PTY connection failed, using generic WebSocket')
        return null
      }

      const { ptyUrl } = await response.json()
      
      // Connect to E2B PTY WebSocket
      const ws = new WebSocket(ptyUrl)
      
      ws.onopen = () => {
        logger.debug('E2B PTY connected')
      }

      ws.onmessage = (event) => {
        this.write(event.data)
      }

      ws.onerror = (error) => {
        logger.warn('E2B PTY error', error)
      }

      ws.onclose = () => {
        logger.debug('E2B PTY closed')
        this.handleWebSocketClose({ code: 1000, reason: 'E2B PTY closed' } as CloseEvent)
      }

      // Handle terminal input
      this.sendInput = (_sessionId: string, data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      }

      return ws
    } catch (error) {
      logger.warn('Failed to connect E2B PTY, falling back to generic WebSocket', error)
      return null
    }
  }

  /**
   * Connect to Daytona PTY
   * Uses Daytona's WebSocket URL from sandbox handle
   */
  private async connectDaytonaPTY(sandboxId: string, sessionId: string): Promise<WebSocket | null> {
    try {
      logger.debug('Connecting to Daytona PTY', { sandboxId })
      
      // Get Daytona sandbox details including WebSocket URL
      const response = await fetch('/api/sandbox/provider/pty', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ sandboxId, sessionId }),
      })

      if (!response.ok) {
        logger.warn('Daytona PTY connection failed, using generic WebSocket')
        return null
      }

      const { wsUrl } = await response.json()
      const ws = new WebSocket(wsUrl)
      
      ws.onopen = () => {
        logger.debug('Daytona PTY connected')
      }

      ws.onmessage = (event) => {
        this.write(event.data)
      }

      ws.onerror = (error) => {
        logger.warn('Daytona PTY error', error)
      }

      ws.onclose = () => {
        logger.debug('Daytona PTY closed')
        this.handleWebSocketClose({ code: 1000, reason: 'Daytona PTY closed' } as CloseEvent)
      }

      // Handle terminal input
      this.sendInput = (_sessionId: string, data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      }

      return ws
    } catch (error) {
      logger.warn('Failed to connect Daytona PTY, falling back to generic WebSocket', error)
      return null
    }
  }

  /**
   * Connect to Sprites PTY
   * Uses Sprites workspace WebSocket URL with optional tar-sync for VFS
   */
  private async connectSpritesPTY(sandboxId: string, sessionId: string): Promise<WebSocket | null> {
    try {
      logger.debug('Connecting to Sprites PTY', { sandboxId })
      
      // Get Sprites workspace PTY URL via backend
      const response = await fetch('/api/sandbox/provider/pty', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ sandboxId, sessionId }),
      })

      if (!response.ok) {
        logger.warn('Sprites PTY connection failed, using generic WebSocket')
        return null
      }

      const { ptyUrl, workspaceUrl } = await response.json()
      const ws = new WebSocket(ptyUrl)
      
      ws.onopen = () => {
        logger.debug('Sprites PTY connected')
      }

      ws.onmessage = (event) => {
        this.write(event.data)
      }

      ws.onerror = (error) => {
        logger.warn('Sprites PTY error', error)
      }

      ws.onclose = () => {
        logger.debug('Sprites PTY closed')
        this.handleWebSocketClose({ code: 1000, reason: 'Sprites PTY closed' } as CloseEvent)
      }

      // Handle terminal input
      this.sendInput = (_sessionId: string, data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      }

      // Note: For VFS sync, use sprites-tar-sync.ts service
      // Example: await syncFilesToSprite(spriteInstance, files, targetDir)
      // This happens separately via vfsSyncBackService

      return ws
    } catch (error) {
      logger.warn('Failed to connect Sprites PTY, falling back to generic WebSocket', error)
      return null
    }
  }

  /**
   * Connect to CodeSandbox PTY
   * Uses CodeSandbox DevBox WebSocket
   */
  private async connectCodeSandboxPTY(sandboxId: string, sessionId: string): Promise<WebSocket | null> {
    try {
      logger.debug('Connecting to CodeSandbox PTY', { sandboxId })
      
      const response = await fetch('/api/sandbox/provider/pty', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ sandboxId, sessionId }),
      })

      if (!response.ok) {
        logger.warn('CodeSandbox PTY connection failed, using generic WebSocket')
        return null
      }

      const { wsUrl } = await response.json()
      const ws = new WebSocket(wsUrl)
      
      ws.onopen = () => {
        logger.debug('CodeSandbox PTY connected')
      }

      ws.onmessage = (event) => {
        this.write(event.data)
      }

      ws.onerror = (error) => {
        logger.warn('CodeSandbox PTY error', error)
      }

      ws.onclose = () => {
        logger.debug('CodeSandbox PTY closed')
        this.handleWebSocketClose({ code: 1000, reason: 'CodeSandbox PTY closed' } as CloseEvent)
      }

      // Handle terminal input
      this.sendInput = (_sessionId: string, data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      }

      return ws
    } catch (error) {
      logger.warn('Failed to connect CodeSandbox PTY, falling back to generic WebSocket', error)
      return null
    }
  }

  /**
   * Connect to Vercel Sandbox PTY
   * Uses Vercel's isolated VM WebSocket
   */
  private async connectVercelSandboxPTY(sandboxId: string, sessionId: string): Promise<WebSocket | null> {
    try {
      logger.debug('Connecting to Vercel Sandbox PTY', { sandboxId })
      
      const response = await fetch('/api/sandbox/provider/pty', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({ sandboxId, sessionId }),
      })

      if (!response.ok) {
        logger.warn('Vercel Sandbox PTY connection failed, using generic WebSocket')
        return null
      }

      const { wsUrl } = await response.json()
      const ws = new WebSocket(wsUrl)
      
      ws.onopen = () => {
        logger.debug('Vercel Sandbox PTY connected')
      }

      ws.onmessage = (event) => {
        this.write(event.data)
      }

      ws.onerror = (error) => {
        logger.warn('Vercel Sandbox PTY error', error)
      }

      ws.onclose = () => {
        logger.debug('Vercel Sandbox PTY closed')
        this.handleWebSocketClose({ code: 1000, reason: 'Vercel Sandbox PTY closed' } as CloseEvent)
      }

      // Handle terminal input
      this.sendInput = (_sessionId: string, data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      }

      return ws
    } catch (error) {
      logger.warn('Failed to connect Vercel Sandbox PTY, falling back to generic WebSocket', error)
      return null
    }
  }

  /**
   * Handle SSE message
   */
  private handleSSEMessage(msg: any): void {
    switch (msg.type) {
      case 'connected': {
        this.stopSpinner()
        this.clearConnectionTimeout()

        this.updateTerminalState({
          sandboxInfo: {
            sessionId: this.state.sessionId,
            sandboxId: this.state.sandboxId,
            status: 'active',
          },
          isConnected: true,
          mode: 'pty',
        })
        this.state.status = 'connected'
        this.state.mode = 'pty'

        this.writeLine('')
        this.writeLine('\x1b[1;32m✓ Sandbox connected!\x1b[0m')
        this.writeLine('\x1b[90mYou now have full terminal access.\x1b[0m')
        this.writeLine('')

        // Send initial resize
        this.sendResize(this.state.sessionId!, 120, 30)

        // Flush command queue
        for (const cmd of this.commandQueue) {
          this.sendInput(this.state.sessionId!, cmd)
        }
        this.commandQueue = []
        break
      }

      case 'pty':
        this.write(msg.data)
        break

      case 'error': {
        this.stopSpinner()
        this.clearConnectionTimeout()

        this.writeLine(`\x1b[31m${msg.data}\x1b[0m`)
        
        if (this.state.status !== 'connected') {
          this.updateTerminalState({
            sandboxInfo: {
              sessionId: this.state.sessionId,
              sandboxId: this.state.sandboxId,
              status: 'error',
            },
            isConnected: false,
            mode: 'sandbox-cmd',
          })
          this.state.eventSource?.close()
          this.state.reconnectAttempts = 0
          this.state.lastConnectionAttempt = Date.now() + 5000
          
          this.writeLine('\x1b[33m⚠ PTY unavailable. Falling back to command-mode.\x1b[0m')
          this.writeLine('\x1b[90mType "connect" to retry PTY.\x1b[0m')
          const cwd = this.getCwd()
          this.write(this.getPrompt('sandbox-cmd', cwd))
        }
        break
      }

      // Handle same messages as WebSocket
      case 'agent:tool_start':
      case 'agent:tool_result':
      case 'agent:complete':
      case 'port_detected':
      case 'ping':
        // Same handling as WebSocket
        this.handleWebSocketMessage(msg)
        break
    }
  }

  /**
   * Handle connection timeout
   */
  private handleConnectionTimeout(): void {
    logger.warn('[Terminal] Connection timeout — falling back to local shell mode')
    this.stopSpinner()
    this.abortController?.abort()

    this.updateTerminalState({
      sandboxInfo: { status: 'error' },
      isConnected: false,
      mode: 'local',
    })
    this.state.status = 'error'
    this.state.mode = 'local'

    this.writeLine('')
    this.writeLine('\x1b[33m⚠ Connection timeout. Using local shell mode.\x1b[0m')
    this.writeLine('\x1b[90mYou can keep using the local shell or type "connect" to retry the sandbox.\x1b[0m')
    this.writeLine('')
    const cwd = this.getCwd()
    this.write(this.getPrompt('local', cwd))
  }

  /**
   * Handle auth required
   */
  private handleAuthRequired(): void {
    this.stopSpinner()
    this.clearConnectionTimeout()

    this.updateTerminalState({
      sandboxInfo: { status: 'active' },
      isConnected: true,
      mode: 'local',
    })

    this.writeLine('')
    this.writeLine('\x1b[33m⚠ Sandbox requires authentication\x1b[0m')
    this.writeLine('\x1b[90mPlease sign in to use the sandbox terminal.\x1b[0m')
    this.writeLine('\x1b[90mUsing local shell mode in the meantime.\x1b[0m')
    this.writeLine('')
    const cwd = this.getCwd()
    this.write(this.getPrompt('local', cwd))
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(error: any): void {
    this.stopSpinner()
    this.clearConnectionTimeout()

    // Handle AbortError (timeout or cancellation)
    if (error?.name === 'AbortError') {
      logger.debug('[Terminal] Connection aborted (timeout or cancellation)')
      return
    }

    const errMsg = error?.message || 'Unknown error'
    logger.error(`[Terminal] Connection failed — falling back to command-mode: ${errMsg}`)
    this.updateTerminalState({
      sandboxInfo: { status: 'error' },
      isConnected: false,
      mode: 'sandbox-cmd',
    })
    this.state.status = 'error'
    this.state.mode = 'sandbox-cmd'
    this.state.reconnectAttempts = 0
    this.state.lastConnectionAttempt = Date.now() + 5000

    this.writeLine(`\x1b[31m✗ Failed to connect: ${errMsg}\x1b[0m`)
    this.writeLine('\x1b[33m⚠ Falling back to command-mode. Type "connect" to retry.\x1b[0m')
    const cwd = this.getCwd()
    this.write(this.getPrompt('sandbox-cmd', cwd))
  }

  /**
   * Fallback to command-mode
   */
  private fallbackToCommandMode(): void {
    this.updateTerminalState({
      isConnected: false,
      mode: 'sandbox-cmd',
    })
    this.state.mode = 'sandbox-cmd'
    this.state.reconnectAttempts = 0
    this.state.lastConnectionAttempt = Date.now() + 5000

    const cwd = this.getCwd()
    this.write(this.getPrompt('sandbox-cmd', cwd))
  }

  /**
   * Start spinner animation
   */
  private startSpinner(): void {
    let spinnerFrameIndex = 0
    this.spinnerInterval = setInterval(() => {
      if (this.state.status !== 'connecting') {
        this.stopSpinner()
        return
      }
      const frame = SPINNER_FRAMES[spinnerFrameIndex % SPINNER_FRAMES.length]
      spinnerFrameIndex++
      this.write(`\r\x1b[33m${frame}\x1b[0m \x1b[90mProvisioning sandbox environment...\x1b[0m`)
    }, 80)
  }

  /**
   * Stop spinner animation
   */
  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval)
      this.spinnerInterval = undefined
      this.write('\r\x1b[K') // Clear spinner line
    }
  }

  /**
   * Clear connection timeout
   */
  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = undefined
    }
  }

  /**
   * Send input to sandbox
   */
  sendToSandboxInput(data: string): void {
    if (this.state.status === 'connected' && this.state.sessionId) {
      this.sendInput(this.state.sessionId, data)
    } else {
      // Queue for later
      this.commandQueue.push(data)
    }
  }

  /**
   * Send resize to sandbox
   */
  sendToSandboxResize(cols: number, rows: number): void {
    if (this.state.status === 'connected' && this.state.sessionId) {
      this.sendResize(this.state.sessionId, cols, rows)
    }
  }

  /**
   * Disconnect from sandbox
   */
  async disconnect(): Promise<void> {
    const sessionId = this.state.sessionId

    this.stopSpinner()
    this.clearConnectionTimeout()
    this.abortController?.abort()

    if (this.state.websocket) {
      this.state.websocket.close()
      this.state.websocket = null
    }

    if (this.state.eventSource) {
      this.state.eventSource.close()
      this.state.eventSource = null
    }

    if (sessionId) {
      try {
        await fetch('/api/sandbox/terminal', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders(),
          },
          credentials: 'include',
          body: JSON.stringify({ sessionId }),
        })
      } catch (error) {
        logger.warn('Failed to delete sandbox terminal session during disconnect', error)
      }
    }

    this.state.status = 'disconnected'
    this.state.mode = 'local'
    this.state.sessionId = undefined
    this.state.sandboxId = undefined
    this.state.reconnectAttempts = 0
    this.commandQueue = []

    this.updateTerminalState({
      sandboxInfo: { status: 'none' },
      isConnected: false,
      mode: 'local',
    })
  }

  /**
   * Get connection state
   */
  getState(): SandboxConnectionState {
    return this.state
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state.status === 'connected'
  }

  /**
   * Show toast notification
   */
  private showToast(message: string, url?: string): void {
    // Simple toast - in real implementation would use toast library
    this.writeLine(`\x1b[1;34m🌐 ${message}\x1b[0m`)
    if (url) {
      this.writeLine(`\x1b[90m   ${url}\x1b[0m`)
    }
  }
}

/**
 * Create Sandbox Connection Manager
 */
export function createSandboxConnectionManager(config: SandboxConnectionManagerConfig): SandboxConnectionManager {
  return new SandboxConnectionManager(config)
}
