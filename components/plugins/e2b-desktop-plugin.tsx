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
 */

'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createComputerUseAgent, getComputerUseSystemPrompt, computerUseTools, toolCallToAction } from '@/lib/sandbox/providers/computer-use-tools-enhanced'
import type { DesktopSandboxHandle, DesktopAction, DesktopStats } from '@/lib/computer/e2b-desktop-provider-enhanced'
import { openai } from '@ai-sdk/openai'

// ==================== Types ====================

interface DesktopPluginProps {
  onClose?: () => void
  isVisible?: boolean
}

interface ActionHistoryItem {
  id: string
  action: DesktopAction
  result: { success: boolean; output: string }
  timestamp: number
}

// ==================== Component ====================

export default function E2BDesktopPlugin({ onClose, isVisible = true }: DesktopPluginProps) {
  // Desktop state
  const [desktop, setDesktop] = useState<DesktopSandboxHandle | null>(null)
  const [streamUrl, setStreamUrl] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string>('')

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

  // ==================== Desktop Lifecycle ====================

  /**
   * Connect to desktop sandbox
   */
  const connectToDesktop = useCallback(async () => {
    setIsConnecting(true)
    setError('')

    try {
      const { e2bDesktopProvider } = await import('@/lib/computer/e2b-desktop-provider-enhanced')

      const desktopHandle = await e2bDesktopProvider.createDesktop({
        resolution: [1024, 720],
        dpi: 96,
        timeoutMs: 300000,
        startStreaming: true,
        // Note: autoCleanup is not a valid option for createDesktop
        // Use desktopSessionManager.createSession if you need autoCleanup
      })

      setDesktop(desktopHandle)
      setStreamUrl(desktopHandle.getStreamUrl() || '')
      setIsConnected(true)

      // Start stats polling
      const statsInterval = setInterval(() => {
        if (desktopHandle.isAlive()) {
          setStats(desktopHandle.getStats())
        } else {
          clearInterval(statsInterval)
        }
      }, 5000)

      console.log('[DesktopPlugin] Connected to desktop:', desktopHandle.id)
    } catch (err: any) {
      console.error('[DesktopPlugin] Connection error:', err)
      setError(err.message || 'Failed to connect to desktop')
    } finally {
      setIsConnecting(false)
    }
  }, [])

  /**
   * Disconnect from desktop
   */
  const disconnectFromDesktop = useCallback(async () => {
    if (desktop) {
      try {
        await desktop.kill()
        setDesktop(null)
        setStreamUrl('')
        setIsConnected(false)
        setActionHistory([])
        setStats(null)
        console.log('[DesktopPlugin] Disconnected from desktop')
      } catch (err: any) {
        console.error('[DesktopPlugin] Disconnect error:', err)
      }
    }
  }, [desktop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (desktop && desktop.isAlive()) {
        desktop.kill().catch(console.error)
      }
    }
  }, [desktop])

  // Auto-connect on mount
  useEffect(() => {
    if (isVisible && !desktop && !isConnecting) {
      connectToDesktop()
    }
  }, [isVisible, desktop, isConnecting, connectToDesktop])

  // Scroll terminal to bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [terminalOutput])

  // ==================== Agent Loop ====================

  /**
   * Run computer use agent
   */
  const runAgent = useCallback(async () => {
    if (!desktop || !agentTask) return

    setIsAgentRunning(true)
    setCurrentIteration(0)
    setActionHistory([])

    try {
      // Import generateText from ai SDK for LLM calls
      const { generateText } = await import('ai')

      const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        appendTerminalOutput('Error: No LLM API key configured (OPENAI_API_KEY or OPENROUTER_API_KEY)')
        setIsAgentRunning(false)
        return
      }

      // Create OpenAI model instance
      const model = process.env.COMPUTER_USE_MODEL || 'gpt-4o'
      const openaiModel = openai(model)

      // Manual agent loop implementation
      let iteration = 0
      let shouldContinue = true

      while (shouldContinue && iteration < maxIterations && desktop.isAlive()) {
        iteration++
        setCurrentIteration(iteration)

        try {
          // Take screenshot for vision input
          const screenshotBase64 = await desktop.screenshotBase64()

          appendTerminalOutput(`\n--- Iteration ${iteration} ---`)

          // Call LLM with computer use tools
          const result = await generateText({
            model: openaiModel,
            system: getComputerUseSystemPrompt(),
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: agentTask },
                  { type: 'image', image: screenshotBase64 },
                ],
              },
            ],
            tools: computerUseTools,
          } as any)

          // Get the tool call from the result
          const toolCall = result.toolCalls?.[0]

          if (toolCall) {
            appendTerminalOutput(`Agent calling: ${toolCall.toolName}`)

            // Convert tool call to desktop action
            const action = toolCallToAction(toolCall.toolName, (toolCall as any).args)

            if (action) {
              // Execute the action on the desktop
              const actionResult = await executeDesktopAction(action)

              // Record in history
              setActionHistory(prev => [
                ...prev,
                {
                  id: `${iteration}-${Date.now()}`,
                  action,
                  result: { success: actionResult.success, output: actionResult.output || '' },
                  timestamp: Date.now(),
                },
              ])

              appendTerminalOutput(`Action result: ${actionResult.success ? 'Success' : 'Failed'} - ${actionResult.output?.substring(0, 100)}`)
            }
          } else if (result.text) {
            appendTerminalOutput(`Agent: ${result.text}`)
            // If no tool call and we have text, agent might be done
            if (result.text.toLowerCase().includes('complete') || result.text.toLowerCase().includes('done')) {
              shouldContinue = false
            }
          } else {
            appendTerminalOutput('Agent returned no action or text, stopping...')
            shouldContinue = false
          }

          // Small delay between iterations
          await new Promise(resolve => setTimeout(resolve, 1000))
        } catch (llmError: any) {
          appendTerminalOutput(`LLM Error: ${llmError.message}`)
          console.error('[DesktopPlugin] LLM error:', llmError)
          shouldContinue = false
        }
      }

      appendTerminalOutput(`\nAgent finished after ${iteration} iterations`)
      setIsAgentRunning(false)
    } catch (err: any) {
      console.error('[DesktopPlugin] Agent error:', err)
      appendTerminalOutput(`Agent error: ${err.message}`)
      setIsAgentRunning(false)
    }
  }, [desktop, agentTask, maxIterations])

  /**
   * Execute a desktop action and return the result
   */
  const executeDesktopAction = async (action: DesktopAction): Promise<{ success: boolean; output: string }> => {
    try {
      switch (action.type) {
        case 'mouse_move':
          return await desktop.moveMouse(action.x, action.y)
        case 'left_click':
          return await desktop.leftClick(action.x, action.y)
        case 'right_click':
          return await desktop.rightClick(action.x, action.y)
        case 'double_click':
          return await desktop.doubleClick(action.x, action.y)
        case 'middle_click':
          return await desktop.leftClick(action.x, action.y, 'middle')
        case 'drag':
          return await desktop.drag(action.startX, action.startY, action.endX, action.endY)
        case 'scroll':
          const scrollDirection = action.scrollY > 0 ? 'down' : 'up'
          const scrollTicks = Math.abs(action.scrollY)
          return await desktop.scroll(scrollDirection, scrollTicks)
        case 'type':
          return await desktop.type(action.text)
        case 'keypress':
          return await desktop.press(action.keys)
        case 'screenshot':
          const base64 = await desktop.screenshotBase64()
          return { success: true, output: `Screenshot taken (${base64.length} bytes)` }
        default:
          return { success: false, output: `Unknown action type: ${(action as any).type}` }
      }
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
   * Take screenshot
   */
  const takeScreenshot = useCallback(async () => {
    if (!desktop) return

    try {
      const dataUrl = await (desktop as any).screenshotDataUrl()
      setCurrentScreenshot(dataUrl)

      // Draw to canvas
      const canvas = screenshotCanvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        const img = new Image()
        img.onload = () => {
          canvas.width = img.width
          canvas.height = img.height
          ctx?.drawImage(img, 0, 0)
        }
        img.src = dataUrl
      }

      appendTerminalOutput('Screenshot captured')
    } catch (err: any) {
      appendTerminalOutput(`Screenshot error: ${err.message}`)
    }
  }, [desktop])

  /**
   * Run terminal command
   */
  const runTerminalCommand = useCallback(async () => {
    if (!desktop || !terminalCommand) return

    try {
      appendTerminalOutput(`$ ${terminalCommand}`)
      const result = await (desktop as any).runCommand(terminalCommand)

      if (result.output) {
        appendTerminalOutput(result.output)
      }

      if (!result.success) {
        appendTerminalOutput(`Command failed with exit code ${result.exitCode}`)
      }

      setTerminalCommand('')
    } catch (err: any) {
      appendTerminalOutput(`Command error: ${err.message}`)
    }
  }, [desktop, terminalCommand])

  /**
   * Append to terminal output
   */
  const appendTerminalOutput = (line: string) => {
    setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`])
  }

  // ==================== Manual Desktop Actions ====================

  const manualAction = useCallback(async (action: DesktopAction) => {
    if (!desktop) return

    try {
      const result = await (desktop as any).executeAction(action)
      setActionHistory(prev => [
        ...prev,
        {
          id: `manual-${Date.now()}`,
          action,
          result: { success: result.success, output: result.output || '' },
          timestamp: Date.now(),
        },
      ])
      appendTerminalOutput(`Action ${action.type}: ${result.success ? 'Success' : 'Failed'} - ${result.output}`)
    } catch (err: any) {
      appendTerminalOutput(`Action error: ${err.message}`)
    }
  }, [desktop])

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
                <iframe
                  src={streamUrl}
                  className="flex-1 w-full bg-black"
                  title="Desktop Stream"
                  allow="fullscreen"
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  {isConnected ? 'No stream available' : 'Connect to desktop'}
                </div>
              )}

              {/* Controls */}
              <div className="p-4 border-t border-gray-700 flex gap-2">
                <button
                  onClick={takeScreenshot}
                  disabled={!desktop}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  📸 Screenshot
                </button>
                <button
                  onClick={() => manualAction({ type: 'left_click' })}
                  disabled={!desktop}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  🖱️ Left Click
                </button>
                <button
                  onClick={() => manualAction({ type: 'right_click' })}
                  disabled={!desktop}
                  className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  🖱️ Right Click
                </button>
                <button
                  onClick={() => manualAction({ type: 'keypress', keys: ['Control_L', 'c'] })}
                  disabled={!desktop}
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
                      <div className="text-xl font-bold text-white">{stats.actionsExecuted}</div>
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
                  disabled={!desktop}
                />
                <button
                  onClick={runTerminalCommand}
                  disabled={!desktop || !terminalCommand}
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
