/**
 * Zine Engine Admin Panel
 * 
 * Configuration interface for managing:
 * - Data sources
 * - Templates
 * - Content
 * - Settings
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DataSource, ZineTemplate, ZineContent, LayoutStyle, AnimationStyle } from "./index";
import { createDataSource } from "./data-sources";

import {
  Plus,
  Trash2,
  Settings,
  Rss,
  Webhook,
  MessageSquare,
  Wifi,
  Bell,
  FileText,
  Play,
  Pause,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  Upload,
  Download,
  TestTube,
  LayoutTemplate,
  Palette,
  Clock,
  Layers,
  Zap,
  Globe,
  Github,
  Twitter,
  MessageCircle,
  Send,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface ZineAdminPanelProps {
  /** Initial data sources */
  initialDataSources?: DataSource[];
  /** Initial templates */
  initialTemplates?: ZineTemplate[];
  /** On configuration change */
  onConfigChange?: (config: ZineAdminConfig) => void;
  /** Debug mode */
  debug?: boolean;
}

export interface ZineAdminConfig {
  dataSources: DataSource[];
  templates: ZineTemplate[];
  settings: {
    autoRotateTemplates: boolean;
    rotationInterval: number;
    maxItems: number;
    enableNotifications: boolean;
  };
}

// ============================================================================
// Constants
// ============================================================================

const LAYOUT_OPTIONS: LayoutStyle[] = [
  "floating", "scattered", "spiral", "wave", "grid-free",
  "organic", "typographic", "brutalist", "minimal", "maximal"
];

const ANIMATION_OPTIONS: AnimationStyle[] = [
  "fade-in", "fly-in", "typewriter", "rotate-in", "scale-in",
  "blur-in", "chalk-write", "glitch", "none"
];

const DEFAULT_SETTINGS: ZineAdminConfig["settings"] = {
  autoRotateTemplates: true,
  rotationInterval: 30000,
  maxItems: 10,
  enableNotifications: true,
};

// ============================================================================
// Main Component
// ============================================================================

export function ZineAdminPanel({
  initialDataSources = [],
  initialTemplates = [],
  onConfigChange,
  debug = false,
}: ZineAdminPanelProps) {
  const [dataSources, setDataSources] = useState<DataSource[]>(initialDataSources);
  const [templates, setTemplates] = useState<ZineTemplate[]>(initialTemplates);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<"sources" | "templates" | "content" | "settings">("sources");
  const [contents, setContents] = useState<ZineContent[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Load configuration from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("zine-engine-config");
    if (saved) {
      try {
        const config: ZineAdminConfig = JSON.parse(saved);
        if (config.dataSources) setDataSources(config.dataSources);
        if (config.templates) setTemplates(config.templates);
        if (config.settings) setSettings(config.settings);
      } catch (e) {
        console.error("Error loading zine config:", e);
      }
    }
  }, []);

  // Save configuration
  const saveConfig = useCallback(async () => {
    setIsSaving(true);
    
    const config: ZineAdminConfig = {
      dataSources,
      templates,
      settings,
    };
    
    try {
      // Save to localStorage
      localStorage.setItem("zine-engine-config", JSON.stringify(config));
      
      // Save to server
      await fetch("/api/zine/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      
      // Notify parent
      onConfigChange?.(config);
      
      toast.success("Configuration saved");
    } catch (error) {
      console.error("Error saving config:", error);
      toast.error("Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  }, [dataSources, templates, settings, onConfigChange]);

  // Load active content
  const loadContents = useCallback(async () => {
    try {
      const response = await fetch("/api/zine/content");
      const data = await response.json();
      setContents(data.contents || []);
    } catch (error) {
      console.error("Error loading contents:", error);
    }
  }, []);

  useEffect(() => {
    loadContents();
    const interval = setInterval(loadContents, 5000);
    return () => clearInterval(interval);
  }, []);

  // Add data source
  const addDataSource = useCallback((type: string) => {
    let source: DataSource;
    
    switch (type) {
      case "rss":
        source = createDataSource.rss("https://example.com/feed.xml");
        break;
      case "webhook":
        source = createDataSource.webhook();
        break;
      case "discord":
        source = createDataSource.discord("token", "channel-id");
        break;
      case "twitter":
        source = createDataSource.twitter("token");
        break;
      case "slack":
        source = createDataSource.slack("token", "channel-id");
        break;
      case "websocket":
        source = createDataSource.websocket("wss://example.com/socket");
        break;
      default:
        source = {
          id: `source-${Date.now()}`,
          type: "manual",
          name: "New Source",
          enabled: true,
        };
    }
    
    setDataSources(prev => [...prev, source]);
    toast.success(`Added ${type} data source`);
  }, []);

  // Remove data source
  const removeDataSource = useCallback((id: string) => {
    setDataSources(prev => prev.filter(s => s.id !== id));
    toast.success("Data source removed");
  }, []);

  // Toggle data source
  const toggleDataSource = useCallback((id: string) => {
    setDataSources(prev => prev.map(s => 
      s.id === id ? { ...s, enabled: !s.enabled } : s
    ));
  }, []);

  // Add template
  const addTemplate = useCallback(() => {
    const newTemplate: ZineTemplate = {
      id: `template-${Date.now()}`,
      name: "Custom Template",
      layout: "floating",
      styles: {
        fontFamily: "system-ui",
        fontSize: "16px",
        color: "rgba(255, 255, 255, 0.9)",
        opacity: 0.8,
      },
      animation: "fade-in",
      transitionDuration: 8000,
      contentLimit: 5,
    };
    
    setTemplates(prev => [...prev, newTemplate]);
    toast.success("Template added");
  }, []);

  // Remove template
  const removeTemplate = useCallback((id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
    toast.success("Template removed");
  }, []);

  // Update template
  const updateTemplate = useCallback((id: string, updates: Partial<ZineTemplate>) => {
    setTemplates(prev => prev.map(t => 
      t.id === id ? { ...t, ...updates } : t
    ));
  }, []);

  // Test data source
  const testDataSource = useCallback(async (source: DataSource) => {
    toast.info(`Testing ${source.name}...`);
    
    try {
      // Simulate fetch (in production, actually fetch)
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success(`${source.name} is working!`);
    } catch (error) {
      toast.error(`${source.name} failed: ${error}`);
    }
  }, []);

  // Export configuration
  const exportConfig = useCallback(() => {
    const config: ZineAdminConfig = {
      dataSources,
      templates,
      settings,
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zine-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success("Configuration exported");
  }, [dataSources, templates, settings]);

  // Import configuration
  const importConfig = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const config: ZineAdminConfig = JSON.parse(e.target?.result as string);
        if (config.dataSources) setDataSources(config.dataSources);
        if (config.templates) setTemplates(config.templates);
        if (config.settings) setSettings(config.settings);
        toast.success("Configuration imported");
      } catch (error) {
        toast.error("Invalid configuration file");
      }
    };
    reader.readAsText(file);
  }, []);

  return (
    <Card className="w-full max-w-6xl mx-auto bg-black/80 border-white/10 text-white">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-purple-400" />
              Zine Engine Admin
            </CardTitle>
            <CardDescription className="text-white/60">
              Configure your unbounded display automation system
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportConfig}
              className="border-white/20 text-white/80 hover:bg-white/10"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <label>
              <Button
                variant="outline"
                size="sm"
                className="border-white/20 text-white/80 hover:bg-white/10 cursor-pointer"
                asChild
              >
                <span>
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </span>
              </Button>
              <input
                type="file"
                accept=".json"
                onChange={importConfig}
                className="hidden"
              />
            </label>
            <Button
              size="sm"
              onClick={saveConfig}
              disabled={isSaving}
              className="bg-purple-500 hover:bg-purple-600"
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="bg-white/10 border border-white/20">
            <TabsTrigger value="sources" className="data-[state=active]:bg-purple-500">
              <Layers className="w-4 h-4 mr-2" />
              Data Sources
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-purple-500">
              <LayoutTemplate className="w-4 h-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="content" className="data-[state=active]:bg-purple-500">
              <FileText className="w-4 h-4 mr-2" />
              Content
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-purple-500">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>
          
          {/* Data Sources Tab */}
          <TabsContent value="sources" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/80">Active Sources</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addDataSource("rss")}
                    className="border-white/20 text-white/80 hover:bg-white/10"
                  >
                    <Rss className="w-4 h-4 mr-2" />
                    RSS
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addDataSource("webhook")}
                    className="border-white/20 text-white/80 hover:bg-white/10"
                  >
                    <Webhook className="w-4 h-4 mr-2" />
                    Webhook
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addDataSource("discord")}
                    className="border-white/20 text-white/80 hover:bg-white/10"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Discord
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addDataSource("twitter")}
                    className="border-white/20 text-white/80 hover:bg-white/10"
                  >
                    <Twitter className="w-4 h-4 mr-2" />
                    Twitter
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addDataSource("slack")}
                    className="border-white/20 text-white/80 hover:bg-white/10"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Slack
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addDataSource("websocket")}
                    className="border-white/20 text-white/80 hover:bg-white/10"
                  >
                    <Wifi className="w-4 h-4 mr-2" />
                    WebSocket
                  </Button>
                </div>
              </div>
              
              <ScrollArea className="h-[400px] border border-white/10 rounded-lg p-4">
                <div className="space-y-2">
                  {dataSources.map(source => (
                    <div
                      key={source.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                    >
                      <div className="flex items-center gap-3">
                        {getSourceIcon(source.type)}
                        <div>
                          <div className="font-medium text-white">{source.name}</div>
                          <div className="text-xs text-white/60">
                            {source.type} {source.url && `• ${source.url}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn(
                          source.enabled
                            ? "border-green-400/50 text-green-400"
                            : "border-white/20 text-white/40"
                        )}>
                          {source.enabled ? "Active" : "Disabled"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => testDataSource(source)}
                          className="text-white/60 hover:text-white"
                        >
                          <TestTube className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleDataSource(source.id)}
                          className="text-white/60 hover:text-white"
                        >
                          {source.enabled ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeDataSource(source.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {dataSources.length === 0 && (
                    <div className="text-center py-8 text-white/40 text-sm">
                      No data sources configured. Add one to get started.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
          
          {/* Templates Tab */}
          <TabsContent value="templates" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/80">Display Templates</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addTemplate}
                  className="border-white/20 text-white/80 hover:bg-white/10"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Template
                </Button>
              </div>
              
              <ScrollArea className="h-[400px] border border-white/10 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templates.map(template => (
                    <div
                      key={template.id}
                      className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <input
                          value={template.name}
                          onChange={(e) => updateTemplate(template.id, { name: e.target.value })}
                          className="bg-transparent border-none text-white font-medium focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTemplate(template.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs text-white/60">Layout</Label>
                          <select
                            value={template.layout}
                            onChange={(e) => updateTemplate(template.id, { layout: e.target.value as LayoutStyle })}
                            className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white"
                          >
                            {LAYOUT_OPTIONS.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                        
                        <div>
                          <Label className="text-xs text-white/60">Animation</Label>
                          <select
                            value={template.animation}
                            onChange={(e) => updateTemplate(template.id, { animation: e.target.value as AnimationStyle })}
                            className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white"
                          >
                            {ANIMATION_OPTIONS.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs text-white/60">Duration (ms)</Label>
                            <Input
                              type="number"
                              value={template.transitionDuration}
                              onChange={(e) => updateTemplate(template.id, { transitionDuration: parseInt(e.target.value) })}
                              className="bg-white/10 border-white/20 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-white/60">Content Limit</Label>
                            <Input
                              type="number"
                              value={template.contentLimit}
                              onChange={(e) => updateTemplate(template.id, { contentLimit: parseInt(e.target.value) })}
                              className="bg-white/10 border-white/20 text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {templates.length === 0 && (
                    <div className="text-center py-8 text-white/40 text-sm col-span-full">
                      No templates configured. Add one to customize your display.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
          
          {/* Content Tab */}
          <TabsContent value="content" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/80">Active Content</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadContents}
                  className="border-white/20 text-white/80 hover:bg-white/10"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
              
              <ScrollArea className="h-[400px] border border-white/10 rounded-lg p-4">
                <div className="space-y-2">
                  {contents.map(content => (
                    <div
                      key={content.id}
                      className="p-3 rounded-lg bg-white/5 border border-white/10"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-white">{content.title || "Untitled"}</div>
                          <div className="text-xs text-white/60 mt-1 line-clamp-2">
                            {content.body || "No content"}
                          </div>
                          <div className="flex items-center gap-2 mt-2 text-[10px] text-white/40">
                            <Badge variant="outline" className="text-[10px]">
                              {content.type}
                            </Badge>
                            <span>{content.source || "manual"}</span>
                            <span>•</span>
                            <span>{new Date(content.createdAt).toLocaleString()}</span>
                            {content.expiresAt && (
                              <>
                                <span>•</span>
                                <span className={content.expiresAt < Date.now() ? "text-red-400" : "text-green-400"}>
                                  {content.expiresAt < Date.now() ? "Expired" : "Active"}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-white/60">Priority: {content.priority || 0}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {contents.length === 0 && (
                    <div className="text-center py-8 text-white/40 text-sm">
                      No active content. Content will appear here when data sources are fetched.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
          
          {/* Settings Tab */}
          <TabsContent value="settings" className="mt-4">
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Display Settings</h3>
                
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <div>
                    <div className="font-medium text-white">Auto-Rotate Templates</div>
                    <div className="text-xs text-white/60">Automatically cycle through templates</div>
                  </div>
                  <Switch
                    checked={settings.autoRotateTemplates}
                    onCheckedChange={(v) => setSettings(s => ({ ...s, autoRotateTemplates: v }))}
                  />
                </div>
                
                <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-white">Rotation Interval</div>
                      <div className="text-xs text-white/60">How often to switch templates</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-white/40" />
                      <Input
                        type="number"
                        value={settings.rotationInterval}
                        onChange={(e) => setSettings(s => ({ ...s, rotationInterval: parseInt(e.target.value) }))}
                        className="w-24 bg-white/10 border-white/20"
                      />
                      <span className="text-xs text-white/60">ms</span>
                    </div>
                  </div>
                </div>
                
                <div className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-white">Max Display Items</div>
                      <div className="text-xs text-white/60">Maximum concurrent content items</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-white/40" />
                      <Input
                        type="number"
                        value={settings.maxItems}
                        onChange={(e) => setSettings(s => ({ ...s, maxItems: parseInt(e.target.value) }))}
                        className="w-24 bg-white/10 border-white/20"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <div>
                    <div className="font-medium text-white">Enable Notifications</div>
                    <div className="text-xs text-white/60">Show toast notifications for new content</div>
                  </div>
                  <Switch
                    checked={settings.enableNotifications}
                    onCheckedChange={(v) => setSettings(s => ({ ...s, enableNotifications: v }))}
                  />
                </div>
              </div>
              
              <div className="pt-4 border-t border-white/10">
                <h3 className="text-sm font-medium text-white/80 mb-4">Debug Options</h3>
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <div>
                    <div className="font-medium text-white">Debug Mode</div>
                    <div className="text-xs text-white/60">Show debug overlay with content info</div>
                  </div>
                  <Switch
                    checked={debug}
                    onCheckedChange={() => {}}
                    disabled
                  />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// Helper function for source icons
function getSourceIcon(type: string) {
  switch (type) {
    case "rss":
      return <Rss className="w-5 h-5 text-orange-400" />;
    case "webhook":
      return <Webhook className="w-5 h-5 text-blue-400" />;
    case "discord":
      return <MessageSquare className="w-5 h-5 text-purple-400" />;
    case "twitter":
      return <Twitter className="w-5 h-5 text-blue-400" />;
    case "slack":
      return <MessageCircle className="w-5 h-5 text-green-400" />;
    case "websocket":
      return <Wifi className="w-5 h-5 text-yellow-400" />;
    case "oauth":
      return <Globe className="w-5 h-5 text-pink-400" />;
    case "github":
      return <Github className="w-5 h-5 text-white" />;
    default:
      return <FileText className="w-5 h-5 text-white/60" />;
  }
}

export default ZineAdminPanel;
