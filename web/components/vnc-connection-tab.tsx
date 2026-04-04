"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import Server from "lucide-react/dist/esm/icons/server";
import Play from "lucide-react/dist/esm/icons/play";
import Square from "lucide-react/dist/esm/icons/square";
import Settings from "lucide-react/dist/esm/icons/settings";
import Shield from "lucide-react/dist/esm/icons/shield";
import Monitor from "lucide-react/dist/esm/icons/monitor";
import Wifi from "lucide-react/dist/esm/icons/wifi";
import WifiOff from "lucide-react/dist/esm/icons/wifi-off";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";

interface VNCConnectionTabProps {
  onConnectionChange?: (connected: boolean) => void;
}

interface VNCConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  protocol: "vnc" | "rdp" | "ssh";
  quality: "low" | "medium" | "high";
}

export default function VNCConnectionTab({ onConnectionChange }: VNCConnectionTabProps) {
  const [connections, setConnections] = useState<VNCConnection[]>([]);
  const [activeConnection, setActiveConnection] = useState<VNCConnection | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Connection form state
  const [newConnection, setNewConnection] = useState<Omit<VNCConnection, "id">>({
    name: "",
    host: "",
    port: 5900,
    password: "",
    protocol: "vnc",
    quality: "medium",
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [scaleViewport, setScaleViewport] = useState(true);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load saved connections from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("vnc-connections");
    if (saved) {
      try {
        setConnections(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load VNC connections:", e);
      }
    }
  }, []);

  // Save connections to localStorage (WITHOUT passwords for security)
  useEffect(() => {
    // Strip passwords before saving to localStorage
    const connectionsWithoutPasswords = connections.map(({ password, ...connection }) => connection);
    localStorage.setItem("vnc-connections", JSON.stringify(connectionsWithoutPasswords));
  }, [connections]);

  // Notify parent of connection changes
  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  const handleConnect = () => {
    if (!activeConnection) return;
    
    setIsConnecting(true);
    
    // Simulate VNC connection (in production, this would use a VNC client library)
    setTimeout(() => {
      setIsConnected(true);
      setIsConnecting(false);
      toast.success(`Connected to ${activeConnection.name}`);
      
      // Initialize canvas for VNC display
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Draw connection placeholder
          ctx.fillStyle = "#1a1a1a";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#4ade80";
          ctx.font = "16px monospace";
          ctx.textAlign = "center";
          ctx.fillText(`Connected to ${activeConnection.host}:${activeConnection.port}`, canvas.width / 2, canvas.height / 2);
        }
      }
    }, 2000);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setActiveConnection(null);
    toast.success("Disconnected from remote desktop");
    
    // Clear canvas
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleSaveConnection = () => {
    if (!newConnection.name || !newConnection.host) {
      toast.error("Please fill in name and host");
      return;
    }

    const connection: VNCConnection = {
      ...newConnection,
      id: Date.now().toString(),
    };

    setConnections([...connections, connection]);
    setActiveConnection(connection);
    toast.success(`Saved connection: ${connection.name}`);
  };

  const handleDeleteConnection = (id: string) => {
    setConnections(connections.filter((c) => c.id !== id));
    if (activeConnection?.id === id) {
      handleDisconnect();
    }
    toast.success("Connection removed");
  };

  const handleSelectConnection = (connection: VNCConnection) => {
    setActiveConnection(connection);
    setNewConnection({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      password: connection.password || "",
      protocol: connection.protocol,
      quality: connection.quality,
    });
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => {
        toast.error("Failed to enter fullscreen");
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div className="h-full flex flex-col" ref={containerRef}>
      {/* Connection Status Bar */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${
        isConnected 
          ? "bg-green-500/10 border-green-500/20" 
          : "bg-red-500/10 border-red-500/20"
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
              {activeConnection.name} ({activeConnection.host}:{activeConnection.port})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="h-7 px-2 text-xs"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3 h-3" />
            ) : (
              <Maximize2 className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="h-7 px-2 text-xs"
          >
            <Settings className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* VNC Display Area */}
      <div className="flex-1 relative bg-black/40 overflow-hidden">
        {!isConnected ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white/40">
              <Monitor className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Select or create a connection to start</p>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
            width={1280}
            height={720}
          />
        )}
      </div>

      {/* Connection Controls */}
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
              />
              <Input
                type="number"
                placeholder="Port"
                value={newConnection.port}
                onChange={(e) => setNewConnection({ ...newConnection, port: parseInt(e.target.value) || 5900 })}
                className="bg-white/5 border-white/10 text-sm w-24"
              />
            </div>

            {/* Saved Connections */}
            {connections.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Saved Connections</Label>
                <div className="flex flex-wrap gap-2">
                  {connections.map((conn) => (
                    <Button
                      key={conn.id}
                      variant={activeConnection?.id === conn.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSelectConnection(conn)}
                      className="h-8 text-xs"
                    >
                      <Server className="w-3 h-3 mr-1" />
                      {conn.name}
                    </Button>
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
                  onValueChange={(value: "vnc" | "rdp" | "ssh") => 
                    setNewConnection({ ...newConnection, protocol: value })
                  }
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vnc">VNC</SelectItem>
                    <SelectItem value="rdp">RDP</SelectItem>
                    <SelectItem value="ssh">SSH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                  onValueChange={(value: "low" | "medium" | "high") => 
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
            </div>

            {/* Advanced Settings */}
            {showAdvanced && (
              <div className="space-y-3 pt-3 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-white/60">View Only Mode</Label>
                  <Switch
                    checked={viewOnly}
                    onCheckedChange={setViewOnly}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-white/60">Scale to Fit</Label>
                  <Switch
                    checked={scaleViewport}
                    onCheckedChange={setScaleViewport}
                  />
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
              {viewOnly ? "View Only" : "Interactive"} • {newConnection.quality} quality
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
