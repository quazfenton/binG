"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Sparkles,
  LayoutDashboard,
  Settings2,
  CheckCircle,
  AlertCircle,
  Zap,
  Layers,
  Monitor,
  ChevronRight,
} from "lucide-react"

export default function SettingsPage() {
  const [useEnhanced, setUseEnhanced] = useState(true)
  const [enableTopPanel, setEnableTopPanel] = useState(true)
  const [enableWorkspacePanel, setEnableWorkspacePanel] = useState(true)
  const [enableTerminal, setEnableTerminal] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    
    // Load settings from localStorage
    if (typeof window !== "undefined") {
      const enhanced = localStorage.getItem("use_enhanced_interface")
      const topPanel = localStorage.getItem("enable_top_panel")
      const workspacePanel = localStorage.getItem("enable_workspace_panel")
      const terminal = localStorage.getItem("enable_terminal")

      if (enhanced !== null) setUseEnhanced(enhanced === "true")
      if (topPanel !== null) setEnableTopPanel(topPanel === "true")
      if (workspacePanel !== null) setEnableWorkspacePanel(workspacePanel === "true")
      if (terminal !== null) setEnableTerminal(terminal === "true")
    }
  }, [])

  const saveSetting = (key: string, value: boolean) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(key, value.toString())
    }
  }

  const handleToggleEnhanced = (value: boolean) => {
    setUseEnhanced(value)
    saveSetting("use_enhanced_interface", value)
    toast.success(value ? "Enhanced interface enabled" : "Legacy interface enabled")
  }

  const handleToggleTopPanel = (value: boolean) => {
    setEnableTopPanel(value)
    saveSetting("enable_top_panel", value)
    toast.success(value ? "Top panel enabled" : "Top panel disabled")
  }

  const handleToggleWorkspacePanel = (value: boolean) => {
    setEnableWorkspacePanel(value)
    saveSetting("enable_workspace_panel", value)
    toast.success(value ? "Workspace panel enabled" : "Workspace panel disabled")
  }

  const handleToggleTerminal = (value: boolean) => {
    setEnableTerminal(value)
    saveSetting("enable_terminal", value)
    toast.success(value ? "Terminal enabled" : "Terminal disabled")
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 text-sm">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-black to-white/5 text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Settings</h1>
              <p className="text-sm text-white/60 mt-1">Configure your binG workspace</p>
            </div>
            <Badge variant="outline" className="border-purple-400/50 text-purple-400">
              <Settings2 className="w-3 h-3 mr-1" />
              v2.0
            </Badge>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Interface Selection */}
        <Card className="mb-6 bg-white/5 border-white/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-purple-400" />
              <CardTitle className="text-white">Interface Mode</CardTitle>
            </div>
            <CardDescription className="text-white/60">
              Choose between the enhanced production-ready interface or the legacy interface
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${useEnhanced ? "bg-purple-500/20" : "bg-white/10"}`}>
                  {useEnhanced ? (
                    <Sparkles className="w-5 h-5 text-purple-400" />
                  ) : (
                    <Layers className="w-5 h-5 text-white/60" />
                  )}
                </div>
                <div>
                  <div className="font-medium text-white">
                    {useEnhanced ? "Enhanced Interface" : "Legacy Interface"}
                  </div>
                  <div className="text-xs text-white/60">
                    {useEnhanced
                      ? "Production-ready panels with responsive resizing"
                      : "Classic interface layout"}
                  </div>
                </div>
              </div>
              <Switch
                checked={useEnhanced}
                onCheckedChange={handleToggleEnhanced}
                className="data-[state=checked]:bg-purple-500"
              />
            </div>

            {/* Enhanced Interface Features */}
            {useEnhanced && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-400/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-purple-400" />
                    <span className="text-sm font-medium text-white">Features</span>
                  </div>
                  <ul className="text-xs text-white/60 space-y-1">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-3 h-3 text-green-400" />
                      Responsive drag-to-resize panels
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-3 h-3 text-green-400" />
                      Snap-to-border functionality
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-3 h-3 text-green-400" />
                      Real API integrations
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-3 h-3 text-green-400" />
                      Persistent state
                    </li>
                  </ul>
                </div>
                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <Monitor className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-white">Panels</span>
                  </div>
                  <ul className="text-xs text-white/60 space-y-1">
                    <li>• Enhanced Top Panel (news, plugins)</li>
                    <li>• Enhanced Workspace Panel (right chat)</li>
                    <li>• Enhanced Interaction Panel (bottom)</li>
                    <li>• Keyboard shortcuts</li>
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Panel Configuration */}
        {useEnhanced && (
          <Card className="mb-6 bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-400" />
                <CardTitle className="text-white">Panel Configuration</CardTitle>
              </div>
              <CardDescription className="text-white/60">
                Enable or disable specific panels in the enhanced interface
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Top Panel */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${enableTopPanel ? "bg-blue-500/20" : "bg-white/10"}`}>
                    <Monitor className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <div className="font-medium text-white">Top Panel</div>
                    <div className="text-xs text-white/60">News, plugins, workflows, and more</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-green-400/50 text-green-400">
                    Active
                  </Badge>
                  <Switch
                    checked={enableTopPanel}
                    onCheckedChange={handleToggleTopPanel}
                    className="data-[state=checked]:bg-blue-500"
                  />
                </div>
              </div>

              {/* Workspace Panel */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${enableWorkspacePanel ? "bg-green-500/20" : "bg-white/10"}`}>
                    <LayoutDashboard className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <div className="font-medium text-white">Workspace Panel</div>
                    <div className="text-xs text-white/60">Right-side chat with multi-thread support</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-green-400/50 text-green-400">
                    Active
                  </Badge>
                  <Switch
                    checked={enableWorkspacePanel}
                    onCheckedChange={handleToggleWorkspacePanel}
                    className="data-[state=checked]:bg-green-500"
                  />
                </div>
              </div>

              {/* Terminal */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${enableTerminal ? "bg-orange-500/20" : "bg-white/10"}`}>
                    <AlertCircle className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <div className="font-medium text-white">Terminal Panel</div>
                    <div className="text-xs text-white/60">Integrated terminal access (experimental)</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-orange-400/50 text-orange-400">
                    Experimental
                  </Badge>
                  <Switch
                    checked={enableTerminal}
                    onCheckedChange={handleToggleTerminal}
                    className="data-[state=checked]:bg-orange-500"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Keyboard Shortcuts */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              <CardTitle className="text-white">Keyboard Shortcuts</CardTitle>
            </div>
            <CardDescription className="text-white/60">
              Quick access keys for the enhanced interface
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/80">Toggle Top Panel</span>
                  <ChevronRight className="w-3 h-3 text-white/40" />
                </div>
                <kbd className="px-2 py-1 text-xs bg-white/10 rounded text-white/60">Ctrl+Shift+T</kbd>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/80">Focus Input</span>
                  <ChevronRight className="w-3 h-3 text-white/40" />
                </div>
                <kbd className="px-2 py-1 text-xs bg-white/10 rounded text-white/60">Ctrl+K</kbd>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/80">Resize Panel</span>
                  <ChevronRight className="w-3 h-3 text-white/40" />
                </div>
                <kbd className="px-2 py-1 text-xs bg-white/10 rounded text-white/60">Arrow Keys</kbd>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/80">Maximize</span>
                  <ChevronRight className="w-3 h-3 text-white/40" />
                </div>
                <kbd className="px-2 py-1 text-xs bg-white/10 rounded text-white/60">M</kbd>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/80">Close Panel</span>
                  <ChevronRight className="w-3 h-3 text-white/40" />
                </div>
                <kbd className="px-2 py-1 text-xs bg-white/10 rounded text-white/60">Esc</kbd>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white/80">Send Message</span>
                  <ChevronRight className="w-3 h-3 text-white/40" />
                </div>
                <kbd className="px-2 py-1 text-xs bg-white/10 rounded text-white/60">Enter</kbd>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-white/40">
          <p>binG Settings v2.0 • Enhanced Panel System</p>
          <p className="mt-1">Changes are saved automatically to localStorage</p>
        </div>
      </div>
    </div>
  )
}
