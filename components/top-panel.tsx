/**
 * Top Panel - Horizontal panel at screen top
 * 
 * Features:
 * - Glassmorphic transparent design
 * - Hover-triggered visibility
 * - Toggle icon in top-left corner
 * - Smooth slide-in animation
 * - Mutually exclusive with side workspace panel
 * - Positioned to NOT cover chatpanel (right) or interactionpanel (bottom)
 * - Max dimensions: 720px height x 1280px width
 * - High z-index (200) to be clickable above all panels
 */

"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePanel } from "@/contexts/panel-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  Newspaper,
  Puzzle,
  Workflow,
  Cpu,
  Image,
  Brain,
  FlaskConical,
  Music,
  Code,
  X,
  Maximize2,
  Minimize2,
  ExternalLink,
} from "lucide-react";
import WorkflowsTab from "./plugins/n8n-workflows-tab";
import OrchestrationTab from "./plugins/orchestration-tab";
import ArtGalleryTab from "./plugins/ai-art-gallery-tab";
import MindMapTab from "./plugins/mind-map-tab";
import PromptLabTab from "./plugins/prompt-lab-tab";
import MusicVisualizerTab from "./plugins/music-visualizer-tab";
import CodePlaygroundTab from "./plugins/code-playground-tab";

// News content (duplicated from news tab)
const NEWS_ITEMS = [
  {
    id: "1",
    title: "AI Breakthrough: New Model Achieves Human-Level Reasoning",
    source: "TechCrunch",
    time: "2 hours ago",
    category: "AI",
    summary: "Researchers announce major advancement in artificial general intelligence...",
  },
  {
    id: "2",
    title: "Next.js 15 Released with Revolutionary Features",
    source: "Vercel",
    time: "4 hours ago",
    category: "Development",
    summary: "The latest version brings server actions, partial prerendering, and more...",
  },
  {
    id: "3",
    title: "Open Source AI Models Surpass Proprietary Counterparts",
    source: "Hacker News",
    time: "6 hours ago",
    category: "AI",
    summary: "Community-driven models now match or exceed closed-source alternatives...",
  },
  {
    id: "4",
    title: "Web Assembly Performance Reaches New Heights",
    source: "MDN Blog",
    time: "8 hours ago",
    category: "Development",
    summary: "Latest benchmarks show WASM approaching native performance levels...",
  },
  {
    id: "5",
    title: "The Future of Full-Stack Development in 2026",
    source: "Dev.to",
    time: "12 hours ago",
    category: "Development",
    summary: "Industry experts share predictions on where web development is heading...",
  },
];

// Plugin viewer component for full-size plugin display
interface PluginViewerProps {
  pluginId?: string;
  onClose: () => void;
}

function PluginViewer({ pluginId, onClose }: PluginViewerProps) {
  const [selectedPlugin, setSelectedPlugin] = useState<string | undefined>(pluginId);

  const availablePlugins = [
    { id: "pstream-embed", name: "Movies", icon: "🎬" },
    { id: "e2b-desktop", name: "E2B Desktop", icon: "🖥️" },
    { id: "vercel-media-embed", name: "Vercel Media", icon: "🌐" },
    { id: "codesandbox-embed", name: "CodeSandbox", icon: "📦" },
    { id: "stackblitz-embed", name: "StackBlitz", icon: "⚡" },
    { id: "huggingface-spaces", name: "HF Spaces", icon: "🤗" },
  ];

  if (!selectedPlugin) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <Puzzle className="w-16 h-16 mx-auto text-purple-400/50" />
          <h3 className="text-xl font-semibold text-white">Select a Plugin</h3>
          <p className="text-white/60">Choose a plugin from the list to view full-screen</p>
        </div>
      </div>
    );
  }

  const plugin = availablePlugins.find(p => p.id === selectedPlugin);

  return (
    <div className="h-full flex flex-col">
      {/* Plugin Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{plugin?.icon}</span>
          <div>
            <h3 className="text-lg font-semibold text-white">{plugin?.name}</h3>
            <p className="text-xs text-white/60">Full-screen view</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedPlugin(undefined)}
            className="text-white/60 hover:text-white"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Plugin Content - Full Size */}
      <div className="flex-1 relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white/60">
            <p>{plugin?.name} would render here</p>
            <p className="text-sm mt-2">Full integration with existing plugin component</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TopPanel() {
  const {
    isTopPanelOpen,
    isTopPanelHovering,
    topPanelActiveTab,
    toggleTopPanel,
    closeTopPanel,
    setTopPanelTab,
    setTopPanelHovering,
  } = usePanel();

  const [isMaximized, setIsMaximized] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<string | undefined>();

  // Handle keyboard shortcut (Ctrl/Cmd + Shift + T)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        toggleTopPanel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleTopPanel]);

  return (
    <>
      {/* Toggle Icon - Always visible in top-left corner (z-[200] for highest priority) */}
      <motion.div
        className="fixed top-4 left-4 z-[200]"
        initial={{ opacity: 0.3 }}
        animate={{ 
          opacity: isTopPanelHovering || isTopPanelOpen ? 1 : 0.3,
          scale: isTopPanelHovering || isTopPanelOpen ? 1.1 : 1,
        }}
        onHoverStart={() => setTopPanelHovering(true)}
        onHoverEnd={() => setTopPanelHovering(false)}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTopPanel}
          className={`h-10 w-10 rounded-full backdrop-blur-md border transition-all duration-300 ${
            isTopPanelOpen
              ? "bg-white/20 border-white/30 text-white"
              : "bg-black/40 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
          }`}
          title="Toggle Top Panel (Ctrl+Shift+T)"
        >
          {isTopPanelOpen ? (
            <ChevronDown className="w-5 h-5" />
          ) : (
            <ChevronUp className="w-5 h-5" />
          )}
        </Button>
      </motion.div>

      {/* Top Panel - Positioned to avoid chatpanel (right) and interactionpanel (bottom) */}
      <AnimatePresence>
        {(isTopPanelOpen || isTopPanelHovering) && (
          <motion.div
            className="fixed z-[150]"
            style={{
              top: "80px", // Below toggle icon
              left: "20px",
              right: "420px", // Leave space for chatpanel on right (400px + margin)
              bottom: "320px", // Leave space for interactionpanel at bottom
            }}
            initial={{ height: 0, opacity: 0, y: -20 }}
            animate={{ 
              height: "auto",
              opacity: 1,
              y: 0,
              maxHeight: isMaximized ? "calc(100vh - 450px)" : "500px",
              maxWidth: "1280px",
            }}
            exit={{ height: 0, opacity: 0, y: -20 }}
            transition={{ 
              duration: 0.35,
              ease: [0.4, 0, 0.2, 1],
            }}
            onHoverStart={() => setTopPanelHovering(true)}
            onHoverEnd={() => setTopPanelHovering(false)}
          >
            {/* Glassmorphic Background */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-transparent backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl" />
            
            {/* Content */}
            <div className="relative h-full flex flex-col overflow-hidden rounded-2xl">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-semibold text-white">Top Panel</h2>
                  
                  {/* Tabs */}
                  <Tabs
                    value={topPanelActiveTab}
                    onValueChange={(v) => setTopPanelTab(v as any)}
                    className="w-auto"
                  >
                    <TabsList className="bg-white/5 border border-white/10">
                      <TabsTrigger
                        value="news"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Newspaper className="w-4 h-4 mr-2" />
                        News
                      </TabsTrigger>
                      <TabsTrigger
                        value="plugins"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Puzzle className="w-4 h-4 mr-2" />
                        Plugins
                      </TabsTrigger>
                      <TabsTrigger
                        value="workflows"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Workflow className="w-4 h-4 mr-2" />
                        Workflows
                      </TabsTrigger>
                      <TabsTrigger
                        value="orchestration"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Cpu className="w-4 h-4 mr-2" />
                        Orchestration
                      </TabsTrigger>
                      <TabsTrigger
                        value="art-gallery"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Image className="w-4 h-4 mr-2" />
                        Art Gallery
                      </TabsTrigger>
                      <TabsTrigger
                        value="mind-map"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Brain className="w-4 h-4 mr-2" />
                        Mind Map
                      </TabsTrigger>
                      <TabsTrigger
                        value="prompt-lab"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <FlaskConical className="w-4 h-4 mr-2" />
                        Prompt Lab
                      </TabsTrigger>
                      <TabsTrigger
                        value="music"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Music className="w-4 h-4 mr-2" />
                        Music
                      </TabsTrigger>
                      <TabsTrigger
                        value="code-playground"
                        className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-white/60"
                      >
                        <Code className="w-4 h-4 mr-2" />
                        Code
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsMaximized(!isMaximized)}
                    className="text-white/60 hover:text-white"
                    title={isMaximized ? "Minimize" : "Maximize"}
                  >
                    {isMaximized ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={closeTopPanel}
                    className="text-white/60 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-hidden">
                <Tabs value={topPanelActiveTab} className="h-full">
                  {/* News Tab */}
                  <TabsContent value="news" className="h-full mt-0">
                    <ScrollArea className="h-full">
                      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {NEWS_ITEMS.map((item) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all cursor-pointer group"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <span className="text-[10px] px-2 py-1 rounded-full bg-white/10 border border-white/20 text-white/80">
                                {item.category}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </div>
                            <h3 className="text-sm font-semibold text-white mb-2 line-clamp-2">
                              {item.title}
                            </h3>
                            <p className="text-xs text-white/60 mb-3 line-clamp-2">
                              {item.summary}
                            </p>
                            <div className="flex items-center justify-between text-xs text-white/40">
                              <span>{item.source}</span>
                              <span>{item.time}</span>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  {/* Plugins Tab */}
                  <TabsContent value="plugins" className="h-full mt-0">
                    {selectedPlugin ? (
                      <PluginViewer
                        pluginId={selectedPlugin}
                        onClose={() => setSelectedPlugin(undefined)}
                      />
                    ) : (
                      <ScrollArea className="h-full">
                        <div className="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {[
                            { id: "pstream-embed", name: "Movies", icon: "🎬", desc: "Stream movies & TV" },
                            { id: "e2b-desktop", name: "E2B Desktop", icon: "🖥️", desc: "Remote desktop environment" },
                            { id: "vercel-media-embed", name: "Vercel Media", icon: "🌐", desc: "Custom Vercel sites" },
                            { id: "codesandbox-embed", name: "CodeSandbox", icon: "📦", desc: "Online code editor" },
                            { id: "stackblitz-embed", name: "StackBlitz", icon: "⚡", desc: "WebContainers IDE" },
                            { id: "huggingface-spaces", name: "HF Spaces", icon: "🤗", desc: "AI models & demos" },
                          ].map((plugin) => (
                            <motion.div
                              key={plugin.id}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedPlugin(plugin.id)}
                              className="p-6 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer group text-center"
                            >
                              <div className="text-4xl mb-3">{plugin.icon}</div>
                              <h3 className="text-sm font-semibold text-white mb-1">{plugin.name}</h3>
                              <p className="text-xs text-white/60">{plugin.desc}</p>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-3 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Maximize2 className="w-3 h-3 mr-2" />
                                Open Full
                              </Button>
                            </motion.div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </TabsContent>

                  {/* Workflows Tab (n8n Integration) */}
                  <TabsContent value="workflows" className="h-full mt-0">
                    <WorkflowsTab />
                  </TabsContent>

                  {/* Orchestration Tab (Agent Options & Event Bus) */}
                  <TabsContent value="orchestration" className="h-full mt-0">
                    <OrchestrationTab />
                  </TabsContent>

                  {/* Art Gallery Tab (AI Image Showcase) */}
                  <TabsContent value="art-gallery" className="h-full mt-0">
                    <ArtGalleryTab />
                  </TabsContent>

                  {/* Mind Map Tab (Agent Reasoning Visualization) */}
                  <TabsContent value="mind-map" className="h-full mt-0">
                    <MindMapTab />
                  </TabsContent>

                  {/* Prompt Lab Tab (Prompt Engineering) */}
                  <TabsContent value="prompt-lab" className="h-full mt-0">
                    <PromptLabTab />
                  </TabsContent>

                  {/* Music Visualizer Tab (Audio Visualization) */}
                  <TabsContent value="music" className="h-full mt-0">
                    <MusicVisualizerTab />
                  </TabsContent>

                  {/* Code Playground Tab (Live Code Execution) */}
                  <TabsContent value="code-playground" className="h-full mt-0">
                    <CodePlaygroundTab />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
