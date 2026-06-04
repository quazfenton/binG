'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Switch } from './ui/switch'
import Server from 'lucide-react/dist/esm/icons/server'
import Play from 'lucide-react/dist/esm/icons/play'
import Square from 'lucide-react/dist/esm/icons/square'
import Settings from 'lucide-react/dist/esm/icons/settings'
import Monitor from 'lucide-react/dist/esm/icons/monitor'
import Wifi from 'lucide-react/dist/esm/icons/wifi'
import WifiOff from 'lucide-react/dist/esm/icons/wifi-off'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2'
import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2'
import Plus from 'lucide-react/dist/esm/icons/plus'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import Cloud from 'lucide-react/dist/esm/icons/cloud'

// @novnc/novnc is ESM-only; we import it lazily

type ConnectionMode = 'vnc' | 'rdp' | 'ssh' | 'e2b'

interface SavedConnection {
  id: string
  name: string
  host: string
  port: number
  password?: string
  protocol: ConnectionMode
  quality: 'low' | 'medium' | 'high'
}

interface VNCConnectionTabProps {
  onConnectionChange?: (connected: boolean) => void
}

const WS_BASE = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
  : 'ws://localhost:3000'

function getWsUrl(host: string, port: number): string {
  return `${WS_BASE}/vnc-proxy?host=${encodeURIComponent(host)}&port=${port}`
}

async function loadRFB(): Promise<typeof import('@novnc/novnc')> {
  return import('@novnc/novnc')
}

export default function VNCConnectionTab({ onConnectionChange }: VNCConnectionTabProps) {
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [activeConnection, setActiveConnection] = useState<SavedConnection | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [newConnection, setNewConnection] = useState<Omit<SavedConnection, 'id'>>({
    name: '',
    host: '',
    port: 5900,
    password: '',
    protocol: 'vnc',
    quality: 'medium',
  })

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [viewOnly, setViewOnly] = useState(false)
  const [scaleViewport, setScaleViewport] = useState(true)

  const containerRef = useRef<HTMLDivElement>(null)
  const vncCanvasRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const rfbRef = useRef<RFBInstance | null>(null)
  const rfbCleanupRef = useRef<(() => void) | null>(null)

  // E2B cloud desktop state
  const [e2bStreamUrl, setE2bStreamUrl] = useState<string>('')
  const [e2bDesktopId, setE2bDesktopId] = useState<string>('')

  // Load saved connections from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vnc-connections')
      if (saved) setConnections(JSON.parse(saved))
    } catch {}
  }, [])

  // Save connections without passwords
  useEffect(() => {
    const safe = connections.map(({ password, ...c }) => c)
    localStorage.setItem('vnc-connections', JSON.stringify(safe))
  }, [connections])

  useEffect(() => {
    onConnectionChange?.(isConnected)
  }, [isConnected, onConnectionChange])

  // Track latest e2bDesktopId via ref for unmount cleanup (avoids stale closure)
  const e2bDesktopIdRef = useRef<string>('');
  useEffect(() => {
    e2bDesktopIdRef.current = e2bDesktopId;
  }, [e2bDesktopId]);

  // Cleanup RFB on unmount
  useEffect(() => {
    return () => {
      disconnectRfb()
      // Use ref to avoid stale closure over e2bDesktopId state
      const id = e2bDesktopIdRef.current;
      if (id) {
        fetch(`/api/desktop/${id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  }, [])

  function disconnectRfb() {
    if (rfbRef.current) {
      try { rfbRef.current.disconnect() } catch {}
      rfbRef.current = null
    }
    if (rfbCleanupRef.current) {
      rfbCleanupRef.current()
      rfbCleanupRef.current = null
    }
  }

  async function disconnectE2B() {
    if (e2bDesktopId) {
      try {
        await fetch(`/api/desktop/${e2bDesktopId}`, { method: 'DELETE' })
      } catch {}
      setE2bDesktopId('')
      setE2bStreamUrl('')
    }
  }

  // ==================== Connect: E2B Cloud Desktop ====================
  const connectE2B = useCallback(async () => {
    setIsConnecting(true)
    try {
      const res = await fetch('/api/desktop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: [1024, 720], dpi: 96, timeoutMs: 300000 }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => 'Unknown error')
        throw new Error(`Server ${res.status}: ${text}`)
      }
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to create desktop')

      setE2bDesktopId(data.data.sandboxId)
      setE2bStreamUrl(data.data.streamUrl)
      setIsConnected(true)
      toast.success('E2B Cloud Desktop ready')
    } catch (err: any) {
      toast.error('E2B connection failed', { description: err.message })
    } finally {
      setIsConnecting(false)
    }
  }, [])

  // ==================== Connect: Manual VNC via noVNC ====================
  const connectVNC = useCallback(async () => {
    // Use the editable form state (newConnection) instead of activeConnection,
    // so updated host/password/quality values in the form are reflected at connect time.
    const target = newConnection;
    if (!target.host || target.protocol === 'e2b') return;
    const connName = target.name || activeConnection?.name || target.host
    const connPassword = target.password
    const connQuality = target.quality

    setIsConnecting(true)

    try {
      disconnectRfb()
      disconnectE2B()

      const RFBClass = (await loadRFB()).default
      const wsUrl = getWsUrl(target.host, target.port)

      if (!vncCanvasRef.current) throw new Error('VNC canvas not ready')

      const rfb = new RFBClass(vncCanvasRef.current, wsUrl, {
        credentials: connPassword ? { password: connPassword } : undefined,
        shared: true,
        repeaterID: '',
      })

      rfb.scaleViewport = scaleViewport
      rfb.viewOnly = viewOnly

      if (connQuality === 'low') {
        rfb.set_quality_level?.(3)
        rfb.setCompressLevel?.(9)
      } else if (connQuality === 'medium') {
        rfb.set_quality_level?.(6)
        rfb.setCompressLevel?.(3)
      } else {
        rfb.set_quality_level?.(9)
        rfb.setCompressLevel?.(0)
      }

      const onConnect = () => {
        setIsConnected(true)
        setIsConnecting(false)
        toast.success(`Connected to ${connName}`)
      }
      const onDisconnect = (e: any) => {
        setIsConnected(false)
        setIsConnecting(false)
        disconnectRfb()
        if (e?.detail?.clean !== true) {
          toast.error('VNC disconnected', { description: e?.detail?.reason || 'unknown' })
        }
      }
      const onError = () => {
        setIsConnected(false)
        setIsConnecting(false)
        disconnectRfb()
        toast.error('VNC connection error')
      }

      rfb.addEventListener('connect', onConnect)
      rfb.addEventListener('disconnect', onDisconnect)
      rfb.addEventListener('error', onError)

      rfbRef.current = rfb
      rfbCleanupRef.current = () => {
        rfb.removeEventListener('connect', onConnect)
        rfb.removeEventListener('disconnect', onDisconnect)
        rfb.removeEventListener('error', onError)
      }
    } catch (err: any) {
      setIsConnecting(false)
      toast.error('VNC connection failed', { description: err.message })
    }
  }, [activeConnection, newConnection, scaleViewport, viewOnly])

  const handleConnect = useCallback(async () => {
    if (!activeConnection) return
    if (isConnected) {
      await disconnectE2B()
      disconnectRfb()
      setIsConnected(false)
    }
    // Use newConnection.protocol (the editable form state) instead of
    // activeConnection.protocol so that protocol edits made in the form
    // are reflected at connect time without requiring a save first.
    const protocol = newConnection.protocol || activeConnection.protocol;
    if (protocol === 'e2b') {
      await connectE2B()
    } else if (protocol === 'vnc') {
      await connectVNC()
    } else {
      toast.info(`${protocol.toUpperCase()} connections are not yet implemented`)
    }
  }, [activeConnection, newConnection, isConnected, connectE2B, connectVNC])

  const handleDisconnect = useCallback(async () => {
    disconnectRfb()
    // Use a fresh fetch call rather than the closure-captured disconnectE2B
    // which may be stale due to its closure over e2bDesktopId.
    if (e2bDesktopId) {
      try {
        await fetch(`/api/desktop/${e2bDesktopId}`, { method: 'DELETE' })
      } catch {}
    }
    setE2bDesktopId('')
    setE2bStreamUrl('')
    setIsConnected(false)
    setActiveConnection(null)
    toast.success('Disconnected')
  }, [e2bDesktopId])

  // ==================== Connection Management ====================
  const handleSaveConnection = () => {
    if (!newConnection.name || (!newConnection.host && newConnection.protocol !== 'e2b')) {
      toast.error('Name and host are required')
      return
    }

    const connection: SavedConnection = {
      ...newConnection,
      id: Date.now().toString(),
    }
    setConnections([...connections, connection])
    setActiveConnection(connection)
      toast.success(`Saved: ${connection.name}`)
  }

  const handleDeleteConnection = (id: string) => {
    setConnections(connections.filter(c => c.id !== id))
    if (activeConnection?.id === id) handleDisconnect()
    toast.success('Connection removed')
  }

  const handleSelectConnection = (connection: SavedConnection) => {
    setActiveConnection(connection)
    setNewConnection({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      password: connection.password || '',
      protocol: connection.protocol,
      quality: connection.quality,
    })
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => toast.error('Fullscreen failed'))
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  return (
    <div className="h-full flex flex-col" ref={containerRef}>
      {/* Connection Status Bar */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${
        isConnected
          ? 'bg-green-500/10 border-green-500/20'
          : 'bg-red-500/10 border-red-500/20'
      }`}>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <Wifi className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400">Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">Disconnected</span>
            </>
          )}
          {activeConnection && (
            <span className="text-xs text-white/60 ml-2">
              {activeConnection.name}
              {activeConnection.protocol !== 'e2b' && ` (${activeConnection.host}:${activeConnection.port})`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={toggleFullscreen} className="h-7 px-2 text-xs">
            {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)} className="h-7 px-2 text-xs">
            <Settings className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Display Area */}
      <div className="flex-1 relative bg-black/40 overflow-hidden">
        {!isConnected ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white/40">
              <Monitor className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Select or create a connection to start</p>
            </div>
          </div>
        ) : activeConnection?.protocol === 'vnc' ? (
          <div ref={vncCanvasRef} className="w-full h-full" />
        ) : activeConnection?.protocol === 'e2b' && e2bStreamUrl ? (
          <iframe
            ref={iframeRef}
            src={e2bStreamUrl}
            className="w-full h-full bg-black"
            title="E2B Desktop Stream"
            allow="fullscreen"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/40">
            <p className="text-sm">Connected — display not available</p>
          </div>
        )}
      </div>

      {/* Connection Panel */}
      <div className="p-4 border-t border-white/10 bg-black/20">
        {!isConnected ? (
          <div className="space-y-3">
            {/* Quick Connect */}
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Host (e.g., 192.168.1.100)"
                value={newConnection.host}
                onChange={(e) => setNewConnection({ ...newConnection, host: e.target.value })}
                className="bg-white/5 border-white/10 text-sm"
                disabled={newConnection.protocol === 'e2b'}
              />
              <Input
                type="number"
                placeholder="Port"
                value={newConnection.protocol === 'e2b' ? '' : newConnection.port}
                onChange={(e) => setNewConnection({ ...newConnection, port: parseInt(e.target.value) || 5900 })}
                className="bg-white/5 border-white/10 text-sm w-24"
                disabled={newConnection.protocol === 'e2b'}
              />
            </div>

            {/* Saved Connections */}
            {connections.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Saved Connections</Label>
                <div className="flex flex-wrap gap-2">
                  {connections.map((conn) => (
                    <div key={conn.id} className="flex items-center gap-1">
                      <Button
                        variant={activeConnection?.id === conn.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleSelectConnection(conn)}
                        className="h-8 text-xs"
                      >
                        {conn.protocol === 'e2b' ? <Cloud className="w-3 h-3 mr-1" /> : <Server className="w-3 h-3 mr-1" />}
                        {conn.name}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteConnection(conn.id)}
                        className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connection Form */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-white/60">Connection Name</Label>
                <Input
                  placeholder="My Server"
                  value={newConnection.name}
                  onChange={(e) => setNewConnection({ ...newConnection, name: e.target.value })}
                  className="bg-white/5 border-white/10 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-white/60">Protocol</Label>
                <Select
                  value={newConnection.protocol}
                  onValueChange={(value: ConnectionMode) => {
                    setNewConnection({
                      ...newConnection,
                      protocol: value,
                      ...(value === 'e2b' ? { host: 'cloud', port: 0 } : {}),
                    })
                  }}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vnc">VNC</SelectItem>
                    <SelectItem value="rdp">RDP</SelectItem>
                    <SelectItem value="ssh">SSH</SelectItem>
                    <SelectItem value="e2b">E2B Cloud Desktop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newConnection.protocol !== 'e2b' && (
                <>
                  <div>
                    <Label className="text-xs text-white/60">Password</Label>
                    <Input
                      type="password"
                      placeholder="Optional"
                      value={newConnection.password}
                      onChange={(e) => setNewConnection({ ...newConnection, password: e.target.value })}
                      className="bg-white/5 border-white/10 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-white/60">Quality</Label>
                    <Select
                      value={newConnection.quality}
                      onValueChange={(value: 'low' | 'medium' | 'high') =>
                        setNewConnection({ ...newConnection, quality: value })
                      }
                    >
                      <SelectTrigger className="bg-white/5 border-white/10 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low (Fast)</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High Quality</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {/* Advanced Settings */}
            {showAdvanced && (
              <div className="space-y-3 pt-3 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-white/60">View Only Mode</Label>
                  <Switch checked={viewOnly} onCheckedChange={setViewOnly} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-white/60">Scale to Fit</Label>
                  <Switch checked={scaleViewport} onCheckedChange={setScaleViewport} />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSaveConnection}
                className="flex-1 bg-white/10 hover:bg-white/20"
                size="sm"
              >
                <Plus className="w-3 h-3 mr-2" />
                Save Connection
              </Button>
              <Button
                onClick={handleConnect}
                disabled={!activeConnection || isConnecting}
                className="flex-1 bg-green-600 hover:bg-green-700"
                size="sm"
              >
                {isConnecting ? (
                  <>
                    <Settings className="w-3 h-3 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 mr-2" />
                    Connect
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              onClick={handleDisconnect}
              variant="outline"
              className="bg-red-500/20 border-red-500/30 hover:bg-red-500/30"
              size="sm"
            >
              <Square className="w-3 h-3 mr-2" />
              Disconnect
            </Button>
            <div className="flex-1" />
            <span className="text-xs text-white/60">
              {viewOnly ? 'View Only' : 'Interactive'} &bull; {newConnection.quality} quality
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
