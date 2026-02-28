/**
 * Agent Terminal Component
 * 
 * React component that integrates the Unified Agent with a terminal UI
 * using xterm.js and the useAgent hook.
 * 
 * @example
 * ```tsx
 * <AgentTerminal
 *   provider="e2b"
 *   capabilities={['terminal', 'desktop']}
 *   onConnect={(session) => console.log('Connected:', session)}
 *   height="500px"
 * />
 * ```
 */

'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAgent } from '@/lib/agent/use-agent'
import type { UnifiedAgentConfig } from '@/lib/agent/unified-agent'
import { TerminalIcon, Wifi, WifiOff, Copy, Trash2, Play, Square } from 'lucide-react'

interface AgentTerminalProps extends UnifiedAgentConfig {
  /** Terminal height */
  height?: string
  
  /** Terminal theme */
  theme?: 'dark' | 'light'
  
  /** Show connection status */
  showStatus?: boolean
  
  /** Show toolbar */
  showToolbar?: boolean
  
  /** Custom command input */
  commandInput?: boolean
  
  /** On connect callback */
  onConnect?: (session: any) => void
  
  /** On disconnect callback */
  onDisconnect?: () => void
}

export function AgentTerminal({
  height = '400px',
  theme = 'dark',
  showStatus = true,
  showToolbar = true,
  commandInput = true,
  onConnect,
  onDisconnect,
  ...agentConfig
}: AgentTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const [command, setCommand] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  const {
    connected,
    connecting,
    output,
    send,
    clearOutput,
    disconnect,
    reconnect,
    error,
  } = useAgent({
    ...agentConfig,
    onConnect: (session) => {
      console.log('Agent connected:', session)
      onConnect?.(session)
    },
    onDisconnect: () => {
      console.log('Agent disconnected')
      onDisconnect?.()
    },
  })

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current || !connected) return

    const initTerminal = async () => {
      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"Cascadia Code", "Fira Code", monospace',
        theme: theme === 'dark' ? {
          background: '#0a0a0a',
          foreground: '#e0e0e0',
          cursor: '#4ade80',
        } : {
          background: '#ffffff',
          foreground: '#0a0a0a',
          cursor: '#000000',
        },
        allowProposedApi: true,
        scrollback: 10000,
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.open(terminalRef.current)
      fitAddon.fit()

      xtermRef.current = { terminal, fitAddon }

      // Handle input
      terminal.onData((data: string) => {
        if (data === '\r') {
          // Enter - send command
          const command = terminal.buffer.active.getLine(terminal.buffer.active.cursorY)?.translateToString().trim() || ''
          send(command + '\n')
        } else {
          send(data)
        }
      })

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
      })
      resizeObserver.observe(terminalRef.current)

      return () => {
        resizeObserver.disconnect()
        terminal.dispose()
      }
    }

    initTerminal()
  }, [connected, theme, send])

  // Update terminal with output
  useEffect(() => {
    if (!xtermRef.current?.terminal || output.length === 0) return

    const { terminal } = xtermRef.current
    const lastOutput = output[output.length - 1]
    terminal.write(lastOutput.data)
  }, [output])

  // Handle connection status
  useEffect(() => {
    if (!xtermRef.current?.terminal) return

    const { terminal } = xtermRef.current

    if (connecting) {
      terminal.write('\r\n\x1b[33mConnecting...\x1b[0m\r\n')
    } else if (connected) {
      terminal.write('\r\n\x1b[32mConnected!\x1b[0m\r\n')
    } else if (error) {
      terminal.write(`\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`)
    }
  }, [connecting, connected, error])

  // Send command handler
  const handleSend = useCallback(() => {
    if (command.trim()) {
      send(command + '\n')
      setCommand('')
    }
  }, [command, send])

  // Clear terminal
  const handleClear = useCallback(() => {
    if (xtermRef.current?.terminal) {
      xtermRef.current.terminal.clear()
    }
    clearOutput()
  }, [clearOutput])

  // Copy output
  const handleCopy = useCallback(() => {
    if (xtermRef.current?.terminal) {
      const content = xtermRef.current.terminal.buffer.active.getLine(0)?.translateToString() || ''
      navigator.clipboard.writeText(content)
    }
  }, [])

  return (
    <div className={`border rounded-lg overflow-hidden ${theme === 'dark' ? 'bg-black border-gray-800' : 'bg-white border-gray-200'}`}>
      {/* Toolbar */}
      {showToolbar && (
        <div className={`flex items-center justify-between px-4 py-2 border-b ${theme === 'dark' ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-center gap-2">
            <TerminalIcon className={`w-4 h-4 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`} />
            <span className={`text-sm font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              Agent Terminal
            </span>
            {showStatus && (
              <div className="flex items-center gap-1 ml-4">
                {connected ? (
                  <Wifi className="w-3 h-3 text-green-400" />
                ) : connecting ? (
                  <Wifi className="w-3 h-3 text-yellow-400 animate-pulse" />
                ) : (
                  <WifiOff className="w-3 h-3 text-red-400" />
                )}
                <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className={`p-1 rounded ${theme === 'dark' ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-600'}`}
              title="Copy output"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={handleClear}
              className={`p-1 rounded ${theme === 'dark' ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-600'}`}
              title="Clear terminal"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            {connected ? (
              <button
                onClick={disconnect}
                className={`p-1 rounded ${theme === 'dark' ? 'hover:bg-red-900/50 text-red-400' : 'hover:bg-red-100 text-red-600'}`}
                title="Disconnect"
              >
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={reconnect}
                disabled={connecting}
                className={`p-1 rounded ${theme === 'dark' ? 'hover:bg-green-900/50 text-green-400' : 'hover:bg-green-100 text-green-600'} disabled:opacity-50`}
                title="Connect"
              >
                <Play className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Terminal */}
      <div
        ref={terminalRef}
        style={{ height }}
        className={`w-full ${theme === 'dark' ? 'bg-black' : 'bg-white'}`}
      />

      {/* Command Input */}
      {commandInput && (
        <div className={`flex items-center gap-2 px-4 py-2 border-t ${theme === 'dark' ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'}`}>
          <span className={`text-sm font-mono ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>$</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Enter command..."
            disabled={!connected}
            className={`flex-1 bg-transparent border-none outline-none text-sm font-mono ${theme === 'dark' ? 'text-white placeholder-gray-600' : 'text-gray-900 placeholder-gray-400'} disabled:opacity-50`}
          />
          <button
            onClick={handleSend}
            disabled={!connected || !command.trim()}
            className={`px-3 py-1 rounded text-sm font-medium ${theme === 'dark' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-500 hover:bg-green-600 text-white'} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Send
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border-t border-red-900/50">
          <p className="text-sm text-red-400">{error.message}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Agent Desktop Component
 * 
 * React component for computer use / desktop automation
 * with screenshot display and control overlay.
 */
export function AgentDesktop({
  provider = 'e2b',
  resolution = { width: 1920, height: 1080 },
  showControls = true,
}: {
  provider?: UnifiedAgentConfig['provider']
  resolution?: { width: number; height: number }
  showControls?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  const {
    connected,
    screenshot,
    resolution: currentResolution,
    captureScreenshot,
    desktopClick,
    desktopType,
    disconnect,
  } = useAgent({
    provider,
    capabilities: ['desktop'],
    desktop: { enabled: true, resolution },
  })

  // Render screenshot
  useEffect(() => {
    if (!screenshot || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)
    }
    img.src = `data:image/png;base64,${screenshot}`
  }, [screenshot])

  // Handle canvas click
  const handleCanvasClick = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connected) return

    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Scale to actual resolution
    const scaleX = (currentResolution?.width || 1920) / canvas.width
    const scaleY = (currentResolution?.height || 1080) / canvas.height

    await desktopClick({
      x: x * scaleX,
      y: y * scaleY,
    })
  }, [connected, currentResolution, desktopClick])

  // Auto-capture screenshots
  useEffect(() => {
    if (!connected) return

    const captureInterval = setInterval(async () => {
      setIsCapturing(true)
      try {
        await captureScreenshot()
      } catch {
        // Screenshot not available
      } finally {
        setIsCapturing(false)
      }
    }, 1000)

    return () => clearInterval(captureInterval)
  }, [connected, captureScreenshot])

  return (
    <div className="relative border rounded-lg overflow-hidden bg-black">
      {/* Toolbar */}
      {showControls && (
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2 bg-black/50 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white">
              {connected ? 'Desktop Active' : 'Connecting...'}
            </span>
            {isCapturing && (
              <span className="text-xs text-yellow-400">Capturing...</span>
            )}
          </div>
          <button
            onClick={disconnect}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* Desktop Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full cursor-crosshair"
        style={{ maxHeight: '80vh' }}
      />

      {/* Connection Overlay */}
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <WifiOff className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-white text-lg">Desktop not connected</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default AgentTerminal
