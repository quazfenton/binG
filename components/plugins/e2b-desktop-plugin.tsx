/**
 * E2B Desktop Plugin
 *
 * Computer use desktop environment plugin for binG
 * Provides VNC desktop streaming and computer use agent controls
 *
 * Features:
 * - Live VNC desktop streaming
 * - Computer use agent controls
 * - Action history and statistics
 * - Screenshot gallery
 * - Terminal command execution
 * - Agent loop monitoring
 *
 * Uses API endpoints instead of direct server imports
 */

'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import useIframeLoader from '@/hooks/use-iframe-loader'
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen'
import type { DesktopAction, AgentLoopResult, DesktopStats } from '@/lib/computer/e2b-desktop-provider-enhanced'

// ==================== Types ====================

interface DesktopPluginProps {
  onClose?: () => void
  isVisible?: boolean
}

interface DesktopInfo {
  sandboxId: string
  streamUrl: string
  resolution: [number, number]
  createdAt: number
}

interface ActionHistoryItem {
  id: string
  iteration: number
  action: DesktopAction
  result: { success: boolean; output: string }
  timestamp: number
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  details?: string
}

// ==================== Component ====================

export default function E2BDesktopPlugin({ onClose, isVisible = true }: DesktopPluginProps) {
  // Desktop state
  const [desktopId, setDesktopId] = useState<string>('')
  const [streamUrl, setStreamUrl] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string>('')
  const [desktop, setDesktop] = useState<any>(null)

  // Agent state
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [agentTask, setAgentTask] = useState<string>('')
  const [currentIteration, setCurrentIteration] = useState(0)
  const [maxIterations, setMaxIterations] = useState(50)

  // History and stats
  const [actionHistory, setActionHistory] = useState<ActionHistoryItem[]>([])
  const [stats, setStats] = useState<DesktopStats | null>(null)
  const [currentScreenshot, setCurrentScreenshot] = useState<string>('')

  // UI state
  const [activeTab, setActiveTab] = useState<'desktop' | 'agent' | 'history' | 'terminal'>('desktop')
  const [terminalCommand, setTerminalCommand] = useState('')
  const [terminalOutput, setTerminalOutput] = useState<string[]>([])

  // Refs
  const screenshotCanvasRef = useRef<HTMLCanvasElement>(null)
  const terminalEndRef = useRef<HTMLDivElement>(null)

  // Use iframe loader hook with fallback for stream URL
  const {
    isLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    canRetry,
    isUsingFallback,
    fallbackUrl,
    handleLoad,
    handleRetry,
    handleReset,
    handleFallback,
  } = useIframeLoader({
    url: streamUrl,
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 5000,
    enableAutoRetry: true,
    enableFallback: true,
    onLoaded: () => {
      setIsConnected(true);
      setError('');
    },
    onFailed: (reason, error) => {
      setIsConnected(false);
      setError(error || 'Failed to load desktop stream');
    },
  });

  // ==================== Desktop Lifecycle ====================

  /**
   * Connect to desktop sandbox via API
   */
  const connectToDesktop = useCallback(async () => {
    setIsConnecting(true)
    setError('')

    try {
      const response = await fetch('/api/desktop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution: [1024, 720],
          dpi: 96,
          timeoutMs: 300000,
        }),
      })

      const data: ApiResponse<DesktopInfo> = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to create desktop')
      }

      setDesktopId(data.data!.sandboxId)
      setStreamUrl(data.data!.streamUrl)
      setIsConnected(true)

      // Start stats polling
      const statsInterval = setInterval(async () => {
        try {
          const statsResponse = await fetch(`/api/desktop/${data.data!.sandboxId}`)
          const statsData: ApiResponse<{ stats: DesktopStats; screenshot: string }> = await statsResponse.json()
          
          if (statsData.success) {
            setStats(statsData.data!.stats)
            setCurrentScreenshot(statsData.data!.screenshot)
          } else {
            clearInterval(statsInterval)
          }
        } catch {
          clearInterval(statsInterval)
        }
      }, 5000)

      console.log('[DesktopPlugin] Connected to desktop:', data.data!.sandboxId)
    } catch (err: any) {
      console.error('[DesktopPlugin] Connection error:', err)
      setError(err.message || 'Failed to connect to desktop')
    } finally {
      setIsConnecting(false)
    }
  }, [])

  /**
   * Disconnect from desktop via API
   */
  const disconnectFromDesktop = useCallback(async () => {
    if (!desktopId) return

    try {
      await fetch(`/api/desktop/${desktopId}`, {
        method: 'DELETE',
      })
      
      setDesktopId('')
      setStreamUrl('')
      setIsConnected(false)
      setActionHistory([])
      setStats(null)
      console.log('[DesktopPlugin] Disconnected from desktop')
    } catch (err: any) {
      console.error('[DesktopPlugin] Disconnect error:', err)
    }
  }, [desktopId])

  /**
   * Execute terminal command via API
   */
  const executeTerminalCommand = useCallback(async (command: string) => {
    if (!desktopId || !command) return

    try {
      const response = await fetch(`/api/desktop/${desktopId}/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })

      const data: ApiResponse<{ output: string; exitCode: number }> = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to execute command')
      }

      setTerminalOutput(prev => [...prev, `$ ${command}`, data.data!.output])
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (err: any) {
      setTerminalOutput(prev => [...prev, `$ ${command}`, `Error: ${err.message}`])
    }
  }, [desktopId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (desktopId) {
        disconnectFromDesktop().catch(console.error)
      }
    }
  }, [desktopId, disconnectFromDesktop])

  // Auto-connect on mount
  useEffect(() => {
    if (isVisible && !desktopId && !isConnecting) {
      connectToDesktop()
    }
  }, [isVisible, desktopId, isConnecting, connectToDesktop])

  // Scroll terminal to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [terminalOutput])

  // ==================== Agent Loop ====================

  /**
   * Run computer use agent via API endpoint
   */
  const runAgent = useCallback(async () => {
    if (!desktopId || !agentTask) return

    setIsAgentRunning(true)
    setCurrentIteration(0)
    setActionHistory([])
    appendTerminalOutput(`Starting agent loop for task: "${agentTask}"`)

    try {
      // Call API endpoint to run agent
      const response = await fetch(`/api/desktop/${desktopId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: agentTask,
          maxIterations,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Agent failed')
      }

      // Stream agent output
      const reader = response.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'iteration') {
              setCurrentIteration(event.iteration)
              appendTerminalOutput(`\n--- Iteration ${event.iteration} ---`)
            } else if (event.type === 'action') {
              appendTerminalOutput(`Agent action: ${event.action}`)
            } else if (event.type === 'result') {
              appendTerminalOutput(`Result: ${event.result}`)
            } else if (event.type === 'message') {
              appendTerminalOutput(`Agent: ${event.message}`)
            } else if (event.type === 'history') {
              setActionHistory(event.history)
            }
          } catch (e) {
            // Non-JSON output
            if (chunk.trim()) appendTerminalOutput(chunk)
          }
        }
      }

      appendTerminalOutput(`\nAgent finished`)
      setIsAgentRunning(false)
    } catch (err: any) {
      console.error('[DesktopPlugin] Agent error:', err)
      appendTerminalOutput(`Agent error: ${err.message}`)
      setIsAgentRunning(false)
      toast.error('Agent failed', { description: err.message })
    }
  }, [desktopId, agentTask, maxIterations])

  /**
   * Execute a desktop action via API endpoint
   */
  const executeDesktopAction = async (action: DesktopAction): Promise<{ success: boolean; output: string }> => {
    try {
      const response = await fetch(`/api/desktop/${desktopId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      })

      if (!response.ok) {
        const error = await response.json()
        return { success: false, output: error.error || 'Action failed' }
      }

      const result = await response.json()
      return { success: result.success, output: result.output || 'Success' }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  /**
   * Stop agent loop
   */
  const stopAgent = useCallback(() => {
    setIsAgentRunning(false)
    appendTerminalOutput('Agent stopped by user')
  }, [])

  // ==================== Manual Actions ====================

  /**
   * Take screenshot via API
   */
  const takeScreenshot = useCallback(async () => {
    if (!desktopId) return

    try {
      const response = await fetch(`/api/desktop/${desktopId}/screenshot`, {
        method: 'POST',
      })
      const data = await response.json()
      
      if (data.success) {
        setCurrentScreenshot(data.dataUrl)
        appendTerminalOutput('Screenshot captured')
      } else {
        appendTerminalOutput(`Screenshot error: ${data.error}`)
      }
    } catch (err: any) {
      appendTerminalOutput(`Screenshot error: ${err.message}`)
    }
  }, [desktopId])

  /**
   * Run terminal command via API
   */
  const runTerminalCommand = useCallback(async () => {
    if (!desktopId || !terminalCommand) return

    try {
      appendTerminalOutput(`$ ${terminalCommand}`)
      await executeTerminalCommand(terminalCommand)
      setTerminalCommand('')
    } catch (err: any) {
      appendTerminalOutput(`Command error: ${err.message}`)
    }
  }, [desktopId, terminalCommand, executeTerminalCommand])

  /**
   * Append to terminal output
   */
  const appendTerminalOutput = (line: string) => {
    setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`])
  }

  // ==================== Manual Desktop Actions ====================

  const manualAction = useCallback(async (action: DesktopAction) => {
    if (!desktopId) return

    try {
      const result = await executeDesktopAction(action)
      setActionHistory(prev => [
        ...prev,
        {
          id: `manual-${Date.now()}`,
          iteration: prev.length + 1,
          action,
          result: { success: result.success, output: result.output || '' },
          timestamp: Date.now(),
        },
      ])
      appendTerminalOutput(`Action ${action.type}: ${result.success ? 'Success' : 'Failed'} - ${result.output}`)
    } catch (err: any) {
      appendTerminalOutput(`Action error: ${err.message}`)
    }
  }, [desktopId])

  // ==================== Render ====================

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg w-full max-w-7xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">E2B Desktop</h2>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-400">
                {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <button
                onClick={connectToDesktop}
                disabled={isConnecting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            ) : (
              <button
                onClick={disconnectFromDesktop}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-900/50 text-red-200 border-b border-red-700">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('desktop')}
            className={`px-4 py-2 ${activeTab === 'desktop' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Desktop
          </button>
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-4 py-2 ${activeTab === 'agent' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Agent
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 ${activeTab === 'history' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            History ({actionHistory.length})
          </button>
          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-4 py-2 ${activeTab === 'terminal' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Terminal
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {/* Desktop Tab */}
          {activeTab === 'desktop' && (
            <div className="h-full flex flex-col">
              {/* VNC Stream */}
              {streamUrl ? (
                isFailed ? (
                  <div className="flex-1 relative">
                    <IframeUnavailableScreen
                      url={streamUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || undefined}
                      onRetry={handleRetry}
                      onTryFallback={handleFallback}
                      onOpenExternal={() => window.open(streamUrl, '_blank', 'noopener,noreferrer')}
                      onClose={onClose}
                      autoRetryCount={retryCount}
                      maxRetries={3}
                    />
                  </div>
                ) : (
                  <iframe
                    src={isUsingFallback && fallbackUrl ? fallbackUrl : streamUrl}
                    className="flex-1 w-full bg-black"
                    title="Desktop Stream"
                    allow="fullscreen"
                  />
                )
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  {isConnected ? 'No stream available' : 'Connect to desktop'}
                </div>
              )}

              {/* Controls */}
              <div className="p-4 border-t border-gray-700 flex gap-2">
                <button
                  onClick={takeScreenshot}
                  disabled={!isConnected}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  📸 Screenshot
                </button>
                <button
                  onClick={() => manualAction({ type: 'left_click' })}
                  disabled={!isConnected}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  🖱️ Left Click
                </button>
                <button
                  onClick={() => manualAction({ type: 'right_click' })}
                  disabled={!isConnected}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  🖱️ Right Click
                </button>
                <button
                  onClick={() => manualAction({ type: 'keypress', keys: ['Control_L', 'c'] })}
                  disabled={!isConnected}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  ⌨️ Ctrl+C
                </button>
              </div>
            </div>
          )}

          {/* Agent Tab */}
          {activeTab === 'agent' && (
            <div className="h-full p-4 overflow-auto">
              <div className="max-w-2xl mx-auto space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Agent Task</label>
                  <textarea
                    value={agentTask}
                    onChange={(e) => setAgentTask(e.target.value)}
                    placeholder="Describe what you want the agent to do (e.g., 'Open Firefox and navigate to example.com')"
                    className="w-full h-32 p-3 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                    disabled={isAgentRunning}
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Max Iterations</label>
                  <input
                    type="number"
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(parseInt(e.target.value) || 50)}
                    className="w-full p-3 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                    disabled={isAgentRunning}
                    min="1"
                    max="200"
                  />
                </div>

                <div className="flex gap-2">
                  {!isAgentRunning ? (
                    <button
                      onClick={runAgent}
                      disabled={!desktop || !agentTask}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      🚀 Start Agent
                    </button>
                  ) : (
                    <button
                      onClick={stopAgent}
                      className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      ⏹️ Stop Agent
                    </button>
                  )}
                </div>

                {isAgentRunning && (
                  <div className="p-4 bg-gray-800 rounded">
                    <div className="text-sm text-gray-400">Iteration</div>
                    <div className="text-2xl font-bold text-white">{currentIteration} / {maxIterations}</div>
                  </div>
                )}

                {/* Stats */}
                {stats && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-gray-800 rounded">
                      <div className="text-sm text-gray-400">Actions</div>
                      <div className="text-xl font-bold text-white">{stats.actionCount}</div>
                    </div>
                    <div className="p-4 bg-gray-800 rounded">
                      <div className="text-sm text-gray-400">Screenshots</div>
                      <div className="text-xl font-bold text-white">{stats.screenshotsTaken}</div>
                    </div>
                    <div className="p-4 bg-gray-800 rounded">
                      <div className="text-sm text-gray-400">Commands</div>
                      <div className="text-xl font-bold text-white">{stats.commandsRun}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="h-full overflow-auto p-4">
              {actionHistory.length === 0 ? (
                <div className="text-center text-gray-400 mt-8">No actions yet</div>
              ) : (
                <div className="space-y-2">
                  {actionHistory.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded border ${
                        item.result.success
                          ? 'bg-green-900/20 border-green-700'
                          : 'bg-red-900/20 border-red-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-sm text-white">
                          {item.action.type}
                        </div>
                        <div className="text-xs text-gray-400">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="text-sm text-gray-300 mt-1">
                        {item.result.output}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Terminal Tab */}
          {activeTab === 'terminal' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-auto p-4 bg-black font-mono text-sm">
                {terminalOutput.map((line, i) => (
                  <div key={i} className="text-green-400">
                    {line}
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>
              <div className="p-4 border-t border-gray-700 flex gap-2">
                <input
                  value={terminalCommand}
                  onChange={(e) => setTerminalCommand(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && runTerminalCommand()}
                  placeholder="Enter command..."
                  className="flex-1 p-2 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
                  disabled={!isConnected}
                />
                <button
                  onClick={runTerminalCommand}
                  disabled={!isConnected || !terminalCommand}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Run
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Hidden canvas for screenshots */}
        <canvas ref={screenshotCanvasRef} className="hidden" />
      </div>
    </div>
  )
}
