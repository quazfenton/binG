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
 * - Scrollable tab bar for many tabs
 */

"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePanel } from "@/contexts/panel-context";
import type { TopPanelTab } from "@/contexts/panel-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Newspaper,
  Puzzle,
  Workflow,
  Cpu,
  Image,
  Brain,
  FlaskConical,
  Music,
  Radio,
  Code,
  Zap,
  X,
  Maximize2,
  Minimize2,
  ExternalLink,
  Loader2,
  Aperture,
  Palette,
  Sparkles,
  Activity,
  Workflow,
} from "lucide-react";
import WorkflowsTab from "./plugins/n8n-workflows-tab";
import OrchestrationTab from "./plugins/orchestration-tab";
import ArtGalleryTab from "./plugins/ai-art-gallery-tab";
import MindMapTab from "./plugins/mind-map-tab";
import PromptLabTab from "./plugins/prompt-lab-tab";
import MusicVisualizerTab from "./plugins/music-visualizer-tab";
import MusicHubTab from "./plugins/music-hub-tab";
import ImmersiveView from "./plugins/immersive-view";
import ZineFlowEngine from "./plugins/zine-flow-engine";
import EventsPanel from "./plugins/events-panel";
import WorkflowVisualizer from "./plugins/workflow-visualizer";
import CodePlaygroundTab from "./plugins/code-playground-tab";
import BroadwayDealHunterTab from "./top-panel/plugins/broadway-deal-hunter-tab";
import ModelComparisonTab from "./top-panel/plugins/model-comparison-tab";
import ZineDisplayTab from "./top-panel/plugins/zine-display-tab";

// ---------------------------------------------------------------------------
// Shared data
// ---------------------------------------------------------------------------

const NEWS_ITEMS = [
  {
    id: "1",
    title: "AI Breakthrough: New Model Achieves Human-Level Reasoning",
    source: "TechCrunch",
    time: "2 hours ago",
    category: "AI",
    summary:
      "Researchers announce major advancement in artificial general intelligence...",
  },
  {
    id: "2",
    title: "Next.js 15 Released with Revolutionary Features",
    source: "Vercel",
    time: "4 hours ago",
    category: "Development",
    summary:
      "The latest version brings server actions, partial prerendering, and more...",
  },
  {
    id: "3",
    title: "Open Source AI Models Surpass Proprietary Counterparts",
    source: "Hacker News",
    time: "6 hours ago",
    category: "AI",
    summary:
      "Community-driven models now match or exceed closed-source alternatives...",
  },
  {
    id: "4",
    title: "Web Assembly Performance Reaches New Heights",
    source: "MDN Blog",
    time: "8 hours ago",
    category: "Development",
    summary:
      "Latest benchmarks show WASM approaching native performance levels...",
  },
  {
    id: "5",
    title: "The Future of Full-Stack Development in 2026",
    source: "Dev.to",
    time: "12 hours ago",
    category: "Development",
    summary:
      "Industry experts share predictions on where web development is heading...",
  },
];

const AVAILABLE_PLUGINS = [
  { id: "pstream-embed", name: "Movies", icon: "🎬", desc: "Stream movies & TV" },
  { id: "e2b-desktop", name: "E2B Desktop", icon: "🖥️", desc: "Remote desktop environment" },
  { id: "vercel-media-embed", name: "Vercel Media", icon: "🌐", desc: "Custom Vercel sites" },
  { id: "codesandbox-embed", name: "CodeSandbox", icon: "📦", desc: "Online code editor" },
  { id: "stackblitz-embed", name: "StackBlitz", icon: "⚡", desc: "WebContainers IDE" },
  { id: "huggingface-spaces", name: "HF Spaces", icon: "🤗", desc: "AI models & demos" },
] as const;

type PluginId = (typeof AVAILABLE_PLUGINS)[number]["id"];

interface TabDef {
  value: TopPanelTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TAB_DEFS: TabDef[] = [
  { value: "news", label: "News", icon: Newspaper },
  { value: "plugins", label: "Plugins", icon: Puzzle },
  { value: "workflows", label: "Workflows", icon: Workflow },
  { value: "orchestration", label: "Orchestration", icon: Cpu },
  { value: "art-gallery", label: "Art Gallery", icon: Image },
  { value: "mind-map", label: "Mind Map", icon: Brain },
  { value: "prompt-lab", label: "Prompt Lab", icon: FlaskConical },
  { value: "music", label: "Music", icon: Music },
  { value: "music-hub", label: "Music Hub", icon: Radio },
  { value: "immersive", label: "Immersive", icon: Aperture },
  { value: "zine-flow", label: "Zine Flow", icon: Sparkles },
  { value: "events", label: "Events", icon: Activity },
  { value: "workflows", label: "Workflows", icon: Workflow },
  { value: "code-playground", label: "Code", icon: Code },
  { value: "broadway-deal-hunter", label: "Broadway", icon: Zap },
  { value: "model-comparison", label: "Model Compare", icon: Zap },
  { value: "zine-display", label: "Zine", icon: Palette },
];

// ---------------------------------------------------------------------------
// Error boundary for tab content
// ---------------------------------------------------------------------------

interface TabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class TabErrorBoundary extends React.Component<
  { children: React.ReactNode; tabName: string },
  TabErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; tabName: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error(`[TopPanel] Error in tab "${this.props.tabName}":`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center p-8">
          <div className="text-center space-y-3 max-w-sm">
            <div className="text-4xl">⚠️</div>
            <h3 className="text-lg font-semibold text-white">
              Something went wrong
            </h3>
            <p className="text-sm text-white/60">
              The {this.props.tabName} tab encountered an error.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="border-white/20 text-white/80 hover:bg-white/10"
            >
              Try Again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Plugin viewer (full-screen plugin display)
// ---------------------------------------------------------------------------

interface PluginViewerProps {
  pluginId?: string;
  onClose: () => void;
}

function PluginViewer({ pluginId, onClose }: PluginViewerProps) {
  const [selectedPlugin, setSelectedPlugin] = useState<string | undefined>(
    pluginId,
  );

  // Sync with parent prop changes
  useEffect(() => {
    setSelectedPlugin(pluginId);
  }, [pluginId]);

  if (!selectedPlugin) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <Puzzle className="w-16 h-16 mx-auto text-purple-400/50" />
          <h3 className="text-xl font-semibold text-white">Select a Plugin</h3>
          <p className="text-white/60">
            Choose a plugin from the list to view full-screen
          </p>
        </div>
      </div>
    );
  }

  const plugin = AVAILABLE_PLUGINS.find((p) => p.id === selectedPlugin);

  return (
    <div className="h-full flex flex-col">
      {/* Plugin Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{plugin?.icon}</span>
          <div>
            <h3 className="text-lg font-semibold text-white">
              {plugin?.name ?? "Unknown Plugin"}
            </h3>
            <p className="text-xs text-white/60">Full-screen view</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedPlugin(undefined)}
            className="text-white/60 hover:text-white"
            title="Back to plugin list"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white/60 hover:text-white"
            title="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Plugin Content - Full Size */}
      <div className="flex-1 relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white/60">
            <p>{plugin?.name ?? "Plugin"} would render here</p>
            <p className="text-sm mt-2">
              Full integration with existing plugin component
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scrollable tab bar (handles overflow with left/right arrows)
// ---------------------------------------------------------------------------

interface ScrollableTabBarProps {
  tabs: TabDef[];
  activeTab: TopPanelTab;
  onTabChange: (tab: TopPanelTab) => void;
}

function ScrollableTabBar({
  tabs,
  activeTab,
  onTabChange,
}: ScrollableTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      observer.disconnect();
    };
  }, [checkScroll]);

  // Auto-scroll active tab into view
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeBtn = el.querySelector<HTMLElement>(
      `[data-tab-value="${activeTab}"]`,
    );
    activeBtn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeTab]);

  const scrollBy = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <div className="relative flex items-center flex-1 min-w-0">
      {/* Left fade + arrow */}
      <AnimatePresence>
        {canScrollLeft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute left-0 z-10 flex items-center h-full"
          >
            <div className="h-full w-8 bg-gradient-to-r from-black/60 to-transparent" />
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-0 h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => scrollBy("left")}
              tabIndex={-1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scrollable tabs container */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <TabsList className="bg-transparent border-none h-auto p-0 gap-1 whitespace-nowrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.value;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                data-tab-value={tab.value}
                onClick={() => onTabChange(tab.value)}
                className={`
                  relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                  transition-all duration-200 whitespace-nowrap cursor-pointer
                  ${
                    isActive
                      ? "bg-white/20 text-white shadow-sm shadow-white/5"
                      : "text-white/50 hover:text-white/80 hover:bg-white/5"
                  }
                `}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="top-panel-active-tab-indicator"
                    className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-white/60"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      {/* Right fade + arrow */}
      <AnimatePresence>
        {canScrollRight && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute right-0 z-10 flex items-center h-full"
          >
            <div className="h-full w-8 bg-gradient-to-l from-black/60 to-transparent" />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => scrollBy("right")}
              tabIndex={-1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TopPanel component
// ---------------------------------------------------------------------------

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

  // Keyboard shortcut (Ctrl/Cmd + Shift + T)
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

  // Close panel on Escape
  useEffect(() => {
    if (!isTopPanelOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTopPanel();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isTopPanelOpen, closeTopPanel]);

  const handleTabChange = useCallback(
    (value: string) => {
      setTopPanelTab(value as TopPanelTab);
    },
    [setTopPanelTab],
  );

  const panelVisible = isTopPanelOpen || isTopPanelHovering;

  return (
    <>
      {/* Toggle Icon - Always visible in top-left corner */}
      <motion.div
        className="fixed top-4 left-4 z-[200]"
        initial={{ opacity: 0.3 }}
        animate={{
          opacity: panelVisible ? 1 : 0.3,
          scale: panelVisible ? 1.1 : 1,
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

      {/* Top Panel */}
      <AnimatePresence>
        {panelVisible && (
          <motion.div
            className="fixed z-[150]"
            style={{
              top: "80px",
              left: "20px",
              right: "420px",
              bottom: "320px",
            }}
            initial={{ height: 0, opacity: 0, y: -20 }}
            animate={{
              height: "auto",
              opacity: 1,
              y: 0,
              maxHeight: isMaximized
                ? "calc(100vh - 120px)"
                : "calc(100vh - 450px)",
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
              {/* Header with tabs */}
              <div className="flex items-center justify-between gap-3 p-3 border-b border-white/10 bg-white/5">
                <Tabs
                  value={topPanelActiveTab}
                  onValueChange={handleTabChange}
                  className="flex-1 min-w-0"
                >
                  <ScrollableTabBar
                    tabs={TAB_DEFS}
                    activeTab={topPanelActiveTab}
                    onTabChange={setTopPanelTab}
                  />
                </Tabs>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsMaximized((v) => !v)}
                    className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10"
                    title={isMaximized ? "Restore" : "Maximize"}
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
                    className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-hidden">
                <Tabs value={topPanelActiveTab} className="h-full">
                  {/* News */}
                  <TabsContent value="news" className="h-full mt-0">
                    <TabErrorBoundary tabName="News">
                      <ScrollArea className="h-full">
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {NEWS_ITEMS.map((item, i) => (
                            <motion.div
                              key={item.id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.05 }}
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
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Plugins */}
                  <TabsContent value="plugins" className="h-full mt-0">
                    <TabErrorBoundary tabName="Plugins">
                      {selectedPlugin ? (
                        <PluginViewer
                          pluginId={selectedPlugin}
                          onClose={() => setSelectedPlugin(undefined)}
                        />
                      ) : (
                        <ScrollArea className="h-full">
                          <div className="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {AVAILABLE_PLUGINS.map((plugin) => (
                              <motion.div
                                key={plugin.id}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setSelectedPlugin(plugin.id)}
                                className="p-6 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer group text-center"
                              >
                                <div className="text-4xl mb-3">
                                  {plugin.icon}
                                </div>
                                <h3 className="text-sm font-semibold text-white mb-1">
                                  {plugin.name}
                                </h3>
                                <p className="text-xs text-white/60">
                                  {plugin.desc}
                                </p>
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
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Workflows */}
                  <TabsContent value="workflows" className="h-full mt-0">
                    <TabErrorBoundary tabName="Workflows">
                      <WorkflowsTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Orchestration */}
                  <TabsContent value="orchestration" className="h-full mt-0">
                    <TabErrorBoundary tabName="Orchestration">
                      <OrchestrationTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Art Gallery */}
                  <TabsContent value="art-gallery" className="h-full mt-0">
                    <TabErrorBoundary tabName="Art Gallery">
                      <ArtGalleryTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Mind Map */}
                  <TabsContent value="mind-map" className="h-full mt-0">
                    <TabErrorBoundary tabName="Mind Map">
                      <MindMapTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Prompt Lab */}
                  <TabsContent value="prompt-lab" className="h-full mt-0">
                    <TabErrorBoundary tabName="Prompt Lab">
                      <PromptLabTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Music Visualizer */}
                  <TabsContent value="music" className="h-full mt-0">
                    <TabErrorBoundary tabName="Music Visualizer">
                      <MusicVisualizerTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Music Hub */}
                  <TabsContent value="music-hub" className="h-full mt-0">
                    <TabErrorBoundary tabName="Music Hub">
                      <MusicHubTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Immersive View */}
                  <TabsContent value="immersive" className="h-full mt-0">
                    <TabErrorBoundary tabName="Immersive View">
                      <ImmersiveView />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Zine Flow Engine */}
                  <TabsContent value="zine-flow" className="h-full mt-0">
                    <TabErrorBoundary tabName="Zine Flow Engine">
                      <ZineFlowEngine />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Events Panel */}
                  <TabsContent value="events" className="h-full mt-0">
                    <TabErrorBoundary tabName="Events Panel">
                      <EventsPanel />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Workflow Visualizer */}
                  <TabsContent value="workflows" className="h-full mt-0">
                    <TabErrorBoundary tabName="Workflow Visualizer">
                      <WorkflowVisualizer />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Code Playground */}
                  <TabsContent value="code-playground" className="h-full mt-0">
                    <TabErrorBoundary tabName="Code Playground">
                      <CodePlaygroundTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Broadway Deal Hunter */}
                  <TabsContent
                    value="broadway-deal-hunter"
                    className="h-full mt-0"
                  >
                    <TabErrorBoundary tabName="Broadway Deal Hunter">
                      <BroadwayDealHunterTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Model Comparison */}
                  <TabsContent value="model-comparison" className="h-full mt-0">
                    <TabErrorBoundary tabName="Model Comparison">
                      <ModelComparisonTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Zine Display */}
                  <TabsContent value="zine-display" className="h-full mt-0">
                    <TabErrorBoundary tabName="Zine Display">
                      <ZineDisplayTab />
                    </TabErrorBoundary>
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
