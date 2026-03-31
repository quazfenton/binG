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
  Bookmark,
  RefreshCw,
  AlertCircle,
  Play,
  Terminal,
} from "lucide-react";
import WorkflowsTab from "./plugins/n8n-workflows-tab";
import OrchestrationTab from "./plugins/orchestration-tab";
import ArtGalleryTab from "./plugins/ai-art-gallery-tab";
import MindMapTab from "./plugins/mind-map-tab";
import PromptLabTab from "./plugins/prompt-lab-tab";
import MusicVisualizerTab from "./plugins/music-visualizer-tab";
import MusicHubTab from "./plugins/music-hub-tab";
import ImmersiveView from "./plugins/immersive-view";
import FlowEngine from "./plugins/flow-engine";
import EventsPanel from "./plugins/events-panel";
import WorkflowVisualizer from "./plugins/workflow-visualizer";
import BroadwayDealHunterTab from "./top-panel/plugins/broadway-deal-hunter-tab";
import ModelComparisonTab from "./top-panel/plugins/model-comparison-tab";
import ZineDisplayTab from "./top-panel/plugins/zine-display-tab";
import CodePlaygroundTab from "./plugins/code-playground-tab";
import { MonacoVFSEditor } from "./monaco-vfs-editor";
import { BookmarksCurationPlugin } from "@/components/bookmarks/bookmarks-curation-plugin";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Search } from "lucide-react";

// Helper to ensure image URLs go through the proxy
function getProxiedImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Already proxied
  if (url.startsWith('/api/image-proxy')) return url;
  // Data URLs (base64) - don't proxy
  if (url.startsWith('data:')) return url;
  // External URL - proxy it
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    const fullUrl = url.startsWith('//') ? `https:${url}` : url;
    return `/api/image-proxy?url=${encodeURIComponent(fullUrl)}`;
  }
  // Local/relative paths - don't proxy
  return url;
}
interface TabDef {
  value: TopPanelTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// ---------------------------------------------------------------------------
// News Tab Component
// ---------------------------------------------------------------------------

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  category: string;
  publishedAt: string;
  imageUrl?: string;
  author?: string;
}

function NewsTab() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/news?limit=30');
      const data = await response.json();

      if (data.success) {
        setArticles(data.articles);
        setUsingFallback(data.usingFallback || false);
        if (data.usingFallback) {
          toast.info('Showing cached news (RSS feeds unavailable)');
        }
      } else {
        setError(data.error || 'Failed to fetch news');
      }
    } catch (err: any) {
      console.error('[NewsTab] Error:', err);
      setError('Failed to fetch news');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm">
          <AlertCircle className="w-12 h-12 mx-auto text-red-400" />
          <h3 className="text-lg font-semibold text-white">Failed to load news</h3>
          <p className="text-sm text-white/60">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchNews}
            className="border-white/20 text-white/80 hover:bg-white/10"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-white/60">
          <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{usingFallback ? 'Loading fallback news...' : 'No news available'}</p>
          {!usingFallback && (
            <Button
              variant="outline"
              size="sm"
              onClick={fetchNews}
              className="mt-4 border-white/20"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {articles.map((article, i) => (
          <motion.a
            key={article.id}
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group block"
          >
            {/* Thumbnail image if available */}
            {article.imageUrl && (
              <div className="mb-3 rounded-lg overflow-hidden aspect-video bg-white/10">
                <img
                  src={getProxiedImageUrl(article.imageUrl)}
                  alt={article.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <div className="flex items-start justify-between mb-2">
              <span className="text-[10px] px-2 py-1 rounded-full bg-white/10 border border-white/20 text-white/80">
                {article.category}
              </span>
              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-white/60" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-2 line-clamp-2">
              {article.title}
            </h3>
            <p className="text-xs text-white/60 mb-3 line-clamp-2">
              {article.summary}
            </p>
            <div className="flex items-center justify-between text-xs text-white/40">
              <span>{article.source}{article.author ? ` • ${article.author}` : ''}</span>
              <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
            </div>
          </motion.a>
        ))}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Plugins Tab Component
// ---------------------------------------------------------------------------

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  tags: string[];
}

function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);

  const fetchPlugins = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/plugins');
      const data = await response.json();
      
      if (data.success) {
        setPlugins(data.plugins);
      }
    } catch (err: any) {
      console.error('[PluginsTab] Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (selectedPlugin) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{plugins.find(p => p.id === selectedPlugin)?.icon || '🔌'}</span>
            <div>
              <h3 className="text-lg font-semibold text-white">
                {plugins.find(p => p.id === selectedPlugin)?.name}
              </h3>
              <p className="text-xs text-white/60">Plugin details</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedPlugin(null)}
              className="text-white/60 hover:text-white"
            >
              <Minimize2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedPlugin(null)}
              className="text-white/60 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/60">
          <div className="text-center">
            <p className="text-lg mb-2">{selectedPlugin}</p>
            <p className="text-sm">Plugin would load here</p>
            <p className="text-xs mt-2">Integration with actual plugin component coming soon</p>
          </div>
        </div>
      </div>
    );
  }

  // Group plugins by category
  const grouped = plugins.reduce((acc, plugin) => {
    if (!acc[plugin.category]) {
      acc[plugin.category] = [];
    }
    acc[plugin.category].push(plugin);
    return acc;
  }, {} as Record<string, PluginInfo[]>);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {Object.entries(grouped).map(([category, categoryPlugins]) => (
          <div key={category}>
            <h3 className="text-sm font-semibold text-white/80 mb-3 capitalize">
              {category}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {categoryPlugins.map((plugin) => (
                <motion.div
                  key={plugin.id}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedPlugin(plugin.id)}
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer group text-center"
                >
                  <div className="text-3xl mb-2">
                    {plugin.icon || '🔌'}
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">
                    {plugin.name}
                  </h4>
                  <p className="text-xs text-white/60 mb-2 line-clamp-2">
                    {plugin.description}
                  </p>
                  <div className="flex flex-wrap justify-center gap-1">
                    {plugin.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="outline" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Maximize2 className="w-3 h-3 mr-2" />
                    Open
                  </Button>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
        
        {plugins.length === 0 && (
          <div className="text-center py-12 text-white/60">
            <Puzzle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No plugins available</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Shared data
// ---------------------------------------------------------------------------

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
  { value: "flow", label: "Flow", icon: Sparkles },
  { value: "events", label: "Events", icon: Activity },
  { value: "bookmarks", label: "Bookmarks", icon: Bookmark },
  { value: "code-playground", label: "Code", icon: Code },
  { value: "monaco-editor", label: "Monaco Editor", icon: Code },
  { value: "broadway-deal-hunter", label: "Broadway", icon: Zap },
  { value: "model-comparison", label: "Model Compare", icon: Zap },
  { value: "zine-display", label: "Zine", icon: Palette },
];

// ---------------------------------------------------------------------------
// Prompt Lab Tab Component
// ---------------------------------------------------------------------------

interface Prompt {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  upvotes: number;
  downloads: number;
}

// PromptLabTab is imported from ./plugins/prompt-lab-tab

// ---------------------------------------------------------------------------
// Art Gallery Tab Component
// ---------------------------------------------------------------------------

interface Artwork {
  id: string;
  title: string;
  artist: string;
  imageUrl: string;
  style: string;
  likes: number;
  views: number;
  tags: string[];
}

// ArtGalleryTab is imported from ./plugins/ai-art-gallery-tab

// ---------------------------------------------------------------------------
// Code Playground Tab Component
// ---------------------------------------------------------------------------

interface ExecutionResult {
  output: string;
  error?: string;
  executionTime: number;
}

// CodePlaygroundTab is imported from ./plugins/code-playground-tab

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
    monacoFilePath,
    closeMonacoEditor,
  } = usePanel();

  const [isMaximized, setIsMaximized] = useState(false);
  const [panelWidth, setPanelWidth] = useState(100); // Percentage of available space (40-100)
  const [panelHeightOffset, setPanelHeightOffset] = useState(520); // Pixels from bottom (default 520px)
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartHeightOffset = useRef(520);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(100);
  const resizeHandle = useRef<'left' | 'right' | 'bottom' | null>(null);

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

  // Resize handlers
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeHandle.current === 'bottom') {
        // Vertical resize - adjust height
        const deltaY = resizeStartY.current - e.clientY;
        let newHeightOffset = resizeStartHeightOffset.current + deltaY;
        
        // Clamp between 200px and 800px from bottom
        newHeightOffset = Math.max(200, Math.min(800, newHeightOffset));
        setPanelHeightOffset(newHeightOffset);
      } else {
        // Horizontal resize - adjust width
        const deltaX = e.clientX - resizeStartX.current;
        const screenWidth = window.innerWidth;
        const deltaPercent = (deltaX / screenWidth) * 100;

        let newWidth = resizeStartWidth.current + (
          resizeHandle.current === 'left' ? -deltaPercent : deltaPercent
        );

        // Clamp between 40% and 100%
        newWidth = Math.max(40, Math.min(100, newWidth));
        setPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeHandle.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleTabChange = useCallback(
    (value: string) => {
      setTopPanelTab(value as TopPanelTab);
    },
    [setTopPanelTab],
  );

  const panelVisible = isTopPanelOpen || isTopPanelHovering;

  const startResize = useCallback((e: React.MouseEvent, handle: 'left' | 'right' | 'bottom') => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    if (handle === 'bottom') {
      resizeStartY.current = e.clientY;
      resizeStartHeightOffset.current = panelHeightOffset;
    } else {
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = panelWidth;
    }
    resizeHandle.current = handle;
  }, [panelWidth, panelHeightOffset]);

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
              left: `calc(20px + ((100 - ${panelWidth}) * 0.5%))`,
              right: `calc(420px + ((100 - ${panelWidth}) * 0.5%))`,
              top: "20px",
            }}
            initial={{ height: 0, opacity: 0, y: -20 }}
            animate={{
              height: "auto",
              opacity: 1,
              y: 0,
              maxHeight: isMaximized
                ? "calc(100vh - 120px)"
                : `calc(100vh - ${panelHeightOffset}px)`,
            }}
            exit={{ height: 0, opacity: 0, y: -20 }}
            transition={{
              duration: 0.35,
              ease: [0.4, 0, 0.2, 1],
            }}
            onHoverStart={() => !isResizing && setTopPanelHovering(true)}
            onHoverEnd={() => !isResizing && setTopPanelHovering(false)}
          >
            {/* Glassmorphic Background */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-transparent backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl pointer-events-none" />

            {/* Resize handles need to be above the background */}
            {/* Left Resize Handle */}
            <div
              className={`absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-[170] group pointer-events-auto ${
                isResizing ? 'bg-purple-500/50' : 'bg-transparent hover:bg-purple-500/30'
              }`}
              onMouseDown={(e) => {
                e.stopPropagation();
                startResize(e, 'left');
              }}
              onMouseEnter={(e) => e.stopPropagation()}
              onMouseLeave={(e) => e.stopPropagation()}
              title="Drag to resize panel width"
            >
              <div className="absolute left-1/2 top-1/2 -translate-y-1/2 w-0.5 h-16 bg-purple-400/0 group-hover:bg-purple-400/60 rounded transition-colors" />
            </div>

            {/* Right Resize Handle */}
            <div
              className={`absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-[170] group pointer-events-auto ${
                isResizing ? 'bg-purple-500/50' : 'bg-transparent hover:bg-purple-500/30'
              }`}
              onMouseDown={(e) => {
                e.stopPropagation();
                startResize(e, 'right');
              }}
              onMouseEnter={(e) => e.stopPropagation()}
              onMouseLeave={(e) => e.stopPropagation()}
              title="Drag to resize panel width"
            >
              <div className="absolute right-1/2 top-1/2 -translate-y-1/2 w-0.5 h-16 bg-purple-400/0 group-hover:bg-purple-400/60 rounded transition-colors" />
            </div>

            {/* Bottom Resize Handle */}
            <div
              className={`absolute left-0 right-0 bottom-0 h-3 cursor-ns-resize z-[170] group pointer-events-auto ${
                isResizing ? 'bg-purple-500/50' : 'bg-transparent hover:bg-purple-500/30'
              }`}
              onMouseDown={(e) => {
                e.stopPropagation();
                startResize(e, 'bottom');
              }}
              onMouseEnter={(e) => e.stopPropagation()}
              onMouseLeave={(e) => e.stopPropagation()}
              title="Drag to resize panel height"
            >
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-0.5 bg-purple-400/0 group-hover:bg-purple-400/60 rounded transition-colors" />
            </div>

            {/* Glassmorphic Background */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-transparent backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl pointer-events-none" />

            {/* Content */}
            <div className="relative z-[10] h-full flex flex-col overflow-hidden rounded-2xl" style={{ maxHeight: isMaximized ? "calc(100vh - 120px)" : `calc(100vh - ${panelHeightOffset}px)` }}>
              {/* Header with tabs */}
              <div className="flex items-center justify-between gap-3 p-3 border-b border-white/10 bg-white/5 shrink-0">
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
                  {/* Reset height button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPanelHeightOffset(520)}
                    className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10"
                    title="Reset height"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>

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

              {/* Tab Content - Scrollable */}
              <div className="flex-1 overflow-y-auto pointer-events-auto">
                <Tabs value={topPanelActiveTab} className="h-full">
                  {/* News */}
                  <TabsContent value="news" className="h-full mt-0">
                    <TabErrorBoundary tabName="News">
                      <NewsTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Plugins */}
                  <TabsContent value="plugins" className="h-full mt-0">
                    <TabErrorBoundary tabName="Plugins">
                      <PluginsTab />
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
<TabsContent value="flow" className="h-full mt-0">
                    <TabErrorBoundary tabName="Flow">
                      <FlowEngine />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent value="events" className="h-full mt-0">
                    <TabErrorBoundary tabName="Events">
                      <EventsPanel />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent value="bookmarks" className="h-full mt-0">
                    <TabErrorBoundary tabName="Bookmarks">
                      <BookmarksCurationPlugin />
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

                  {/* Monaco Editor */}
                  <TabsContent value="monaco-editor" className="h-full mt-0">
                    <TabErrorBoundary tabName="Monaco Editor">
                      <MonacoVFSEditor 
                        initialFilePath={monacoFilePath || undefined}
                        onClose={() => {
                          closeMonacoEditor();
                          setTopPanelTab('news');
                        }}
                      />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent
                    value="broadway-deal-hunter"
                    className="h-full mt-0"
                  >
                    <TabErrorBoundary tabName="Broadway Deal Hunter">
                      <BroadwayDealHunterTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent
                    value="model-comparison"
                    className="h-full mt-0"
                  >
                    <TabErrorBoundary tabName="Model Comparison">
                      <ModelComparisonTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent value="zine-display" className="h-full mt-0">
                    <TabErrorBoundary tabName="Zine Display">
                      <ZineDisplayTab />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Events Panel */}
                  <TabsContent value="events" className="h-full mt-0">
                    <TabErrorBoundary tabName="Events Panel">
                      <EventsPanel />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Bookmarks Curation */}
                  <TabsContent value="bookmarks" className="h-full mt-0">
                    <TabErrorBoundary tabName="Bookmarks">
                      <BookmarksCurationPlugin />
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

                  {/* Monaco Editor */}
                  <TabsContent value="monaco-editor" className="h-full mt-0">
                    <TabErrorBoundary tabName="Monaco Editor">
                      <MonacoVFSEditor 
                        initialFilePath={monacoFilePath || undefined}
                        onClose={() => {
                          closeMonacoEditor();
                          setTopPanelTab('news');
                        }}
                      />
                    </TabErrorBoundary>
                  </TabsContent>

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
