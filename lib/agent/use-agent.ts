/**
 * Unified Agent React Hook
 * 
 * Provides React integration for the Unified Agent Interface
 * with automatic lifecycle management and real-time updates.
 * 
 * @example
 * ```tsx
 * function TerminalComponent() {
 *   const { agent, connected, output, send, cleanup } = useAgent({
 *     provider: 'e2b',
 *     capabilities: ['terminal', 'desktop'],
 *   })
 * 
 *   return (
 *     <div>
 *       <div>Status: {connected ? 'Connected' : 'Disconnected'}</div>
 *       <Terminal output={output} />
 *       <button onClick={() => send('ls -la')}>List Files</button>
 *     </div>
 *   )
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { createAgent, type UnifiedAgentConfig, type UnifiedAgent, type TerminalOutput, type AgentSession } from '@/lib/agent/unified-agent'

export interface UseAgentOptions extends UnifiedAgentConfig {
  /** Auto-connect on mount */
  autoConnect?: boolean
  
  /** Auto-cleanup on unmount */
  autoCleanup?: boolean
  
  /** Callback when agent connects */
  onConnect?: (session: AgentSession) => void
  
  /** Callback when agent disconnects */
  onDisconnect?: () => void
  
  /** Callback on terminal output */
  onOutput?: (output: TerminalOutput) => void
  
  /** Callback on error */
  onError?: (error: Error) => void
}

export interface UseAgentReturn {
  /** The agent instance (null if not connected) */
  agent: UnifiedAgent | null
  
  /** Connection status */
  connected: boolean
  
  /** Connecting status */
  connecting: boolean
  
  /** Current session info */
  session: AgentSession | null
  
  /** Terminal output history */
  output: TerminalOutput[]
  
  /** Desktop screenshot (base64) */
  screenshot: string | null
  
  /** Screen resolution */
  resolution: { width: number; height: number } | null
  
  /** Available MCP tools */
  mcpTools: Array<{ name: string; description: string }> | null
  
  /** Send terminal input */
  send: (input: string) => Promise<void>
  
  /** Clear terminal output */
  clearOutput: () => void
  
  /** Take desktop screenshot */
  captureScreenshot: () => Promise<string>
  
  /** Call MCP tool */
  callMcpTool: (toolName: string, args: Record<string, any>) => Promise<any>
  
  /** Execute code */
  executeCode: (language: string, code: string) => Promise<any>
  
  /** Reconnect agent */
  reconnect: () => Promise<void>

  /** Disconnect and cleanup */
  disconnect: () => Promise<void>

  /** Last error */
  error: Error | null

  /** Desktop click (if desktop capability enabled) */
  desktopClick?: (position: { x: number; y: number }) => Promise<void>

  /** Desktop type (if desktop capability enabled) */
  desktopType?: (text: string) => Promise<void>
}

/**
 * React hook for Unified Agent integration
 */
export function useAgent(options: UseAgentOptions = {}): UseAgentReturn {
  const {
    autoConnect = true,
    autoCleanup = true,
    onConnect,
    onDisconnect,
    onOutput,
    onError,
    ...agentConfig
  } = options

  // State
  const [agent, setAgent] = useState<UnifiedAgent | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [session, setSession] = useState<AgentSession | null>(null)
  const [output, setOutput] = useState<TerminalOutput[]>([])
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null)
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string }>>([])
  const [error, setError] = useState<Error | null>(null)

  // Refs
  const agentRef = useRef<UnifiedAgent | null>(null)
  const outputRef = useRef<TerminalOutput[]>([])

  // Initialize agent
  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)

    try {
      const newAgent = await createAgent(agentConfig)
      
      setAgent(newAgent)
      agentRef.current = newAgent

      const sessionInfo = newAgent.getSession()
      if (sessionInfo) {
        setSession(sessionInfo)
        onConnect?.(sessionInfo)
      }

      // Set up output callback
      newAgent.onTerminalOutput((outputItem) => {
        setOutput(prev => [...prev, outputItem])
        outputRef.current.push(outputItem)
        onOutput?.(outputItem)
      })

      // Get MCP tools if available
      try {
        const tools = await newAgent.mcpListTools()
        setMcpTools(tools.map(t => ({ name: t.name, description: t.description || '' })))
      } catch {
        // MCP not enabled
      }

      // Get initial desktop resolution if available
      try {
        const res = await newAgent.desktopResolution()
        setResolution(res)
      } catch {
        // Desktop not enabled
      }

      setConnected(true)
    } catch (err: any) {
      setError(err)
      onError?.(err)
      setConnected(false)
    } finally {
      setConnecting(false)
    }
  }, [agentConfig, onConnect, onError, onOutput])

  // Cleanup
  const disconnect = useCallback(async () => {
    if (agentRef.current) {
      try {
        await agentRef.current.cleanup()
      } catch (err: any) {
        console.error('Agent cleanup error:', err)
      }
      
      agentRef.current = null
      setAgent(null)
      setConnected(false)
      setSession(null)
      setOutput([])
      setScreenshot(null)
      setResolution(null)
      setMcpTools([])
      outputRef.current = []
      
      onDisconnect?.()
    }
  }, [onDisconnect])

  // Send terminal input
  const send = useCallback(async (input: string) => {
    if (!agentRef.current) {
      throw new Error('Agent not connected')
    }
    await agentRef.current.terminalSend(input)
  }, [])

  // Clear output
  const clearOutput = useCallback(() => {
    setOutput([])
    outputRef.current = []
  }, [])

  // Capture screenshot
  const captureScreenshot = useCallback(async (): Promise<string> => {
    if (!agentRef.current) {
      throw new Error('Agent not connected')
    }
    
    const buffer = await agentRef.current.desktopScreenshot()
    const base64 = buffer.toString('base64')
    setScreenshot(base64)
    return base64
  }, [])

  // Call MCP tool
  const callMcpTool = useCallback(async (toolName: string, args: Record<string, any>) => {
    if (!agentRef.current) {
      throw new Error('Agent not connected')
    }
    return agentRef.current.mcpCall(toolName, args)
  }, [])

  // Execute code
  const executeCode = useCallback(async (language: string, code: string) => {
    if (!agentRef.current) {
      throw new Error('Agent not connected')
    }
    return agentRef.current.codeExecute(language, code)
  }, [])

  // Reconnect
  const reconnect = useCallback(async () => {
    await disconnect()
    await connect()
  }, [connect, disconnect])

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect()
    }
    return () => {
      if (autoCleanup) {
        disconnect()
      }
    }
  }, [autoConnect, autoCleanup, connect, disconnect])

  return {
    agent,
    connected,
    connecting,
    session,
    output,
    screenshot,
    resolution,
    mcpTools,
    send,
    clearOutput,
    captureScreenshot,
    callMcpTool,
    executeCode,
    reconnect,
    disconnect,
    error,
  }
}

/**
 * React Hook for desktop-only agent
 * Simplified interface for computer use scenarios
 */
export function useDesktopAgent(options: {
  provider?: UnifiedAgentConfig['provider']
  resolution?: { width: number; height: number }
  autoConnect?: boolean
  onScreenshot?: (screenshot: string) => void
} = {}): Omit<UseAgentReturn, 'agent' | 'session' | 'mcpTools' | 'callMcpTool' | 'executeCode'> {
  const {
    provider = 'e2b',
    resolution = { width: 1920, height: 1080 },
    autoConnect = true,
    onScreenshot,
  } = options

  const baseHook = useAgent({
    provider,
    capabilities: ['desktop'],
    desktop: { enabled: true, resolution },
    autoConnect,
    onOutput: (output) => {
      // Desktop agents typically don't need terminal output
    },
  })

  // Auto-capture screenshots on changes
  useEffect(() => {
    if (!baseHook.connected) return

    const captureInterval = setInterval(async () => {
      try {
        const ss = await baseHook.captureScreenshot()
        onScreenshot?.(ss)
      } catch {
        // Screenshot not available
      }
    }, 1000)

    return () => clearInterval(captureInterval)
  }, [baseHook.connected, onScreenshot])

  const { agent: _, session: __, mcpTools: ___, callMcpTool: ____, executeCode: _____, ...desktopHook } = baseHook

  return desktopHook
}

/**
 * React Hook for terminal-only agent
 * Simplified interface for terminal scenarios
 */
export function useTerminalAgent(options: {
  provider?: UnifiedAgentConfig['provider']
  autoConnect?: boolean
  maxOutputLength?: number
} = {}): Omit<UseAgentReturn, 'agent' | 'session' | 'screenshot' | 'resolution' | 'mcpTools' | 'captureScreenshot' | 'callMcpTool' | 'executeCode'> {
  const {
    provider = 'e2b',
    autoConnect = true,
    maxOutputLength = 1000,
  } = options

  const baseHook = useAgent({
    provider,
    capabilities: ['terminal'],
    autoConnect,
  })

  // Limit output length for performance
  useEffect(() => {
    if (baseHook.output.length > maxOutputLength) {
      // Keep last N items
      baseHook.clearOutput()
    }
  }, [baseHook.output.length, maxOutputLength, baseHook.clearOutput])

  const { agent: _, session: __, screenshot: ___, resolution: ____, mcpTools: _____, captureScreenshot: ______, callMcpTool: _______, executeCode: ________, ...terminalHook } = baseHook

  return terminalHook
}

export default useAgent
