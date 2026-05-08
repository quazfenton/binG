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
  Store,
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
  ArrowRight,
  Plus,
  Check,
  Film,
  MessageCircle,
  Copy,
  Search,
} from "lucide-react";
import WorkflowsTab from "./plugins/n8n-workflows-tab";
import OrchestrationTab from "./plugins/orchestration-tab";
import ArtGalleryTab from "./plugins/ai-art-gallery-tab";
import MindMapTab from "./plugins/mind-map-tab";
import PromptLabTab from "./plugins/prompt-lab-tab";
import { MatrixChatPlugin } from "./plugins/matrix-chat-plugin";
import MusicHubTab from "./plugins/music-hub-tab";
import ImmersiveView from "./plugins/immersive-view";
import FlowEngine from "./plugins/flow-engine";
import EventsPanel from "./plugins/events-panel";
import WorkflowVisualizer from "./plugins/workflow-visualizer";
import MusicVisualizerTab from "./plugins/music-visualizer-tab";
import BroadwayDealHunterTab from "./top-panel/plugins/broadway-deal-hunter-tab";
import ModelComparisonTab from "./top-panel/plugins/model-comparison-tab";
import ZineDisplayTab from "./top-panel/plugins/zine-display-tab";
import CodePlaygroundTab from "./plugins/code-playground-tab";
import PluginMarketplace from "./plugins/plugin-marketplace";
import PStreamEmbedPlugin from "./plugins/pstream-embed-plugin";
import { MonacoVFSEditor } from "./monaco-vfs-editor";
import { BookmarksCurationPlugin } from "@/components/bookmarks/bookmarks-curation-plugin";
import { MCPStore } from "@/components/mcp/mcp-store";
import { ExperiencePanel } from "@/components/experience-panel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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
// Plugins Tab Component - Redesigned
// ---------------------------------------------------------------------------

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  tags: string[];
}

interface PluginsTabProps {
  visibleTabs: TopPanelTab[];
  toggleTabVisibility: (tab: TopPanelTab) => void;
  isTabVisible: (tab: TopPanelTab) => boolean;
  setVisibleTabs: (tabs: TopPanelTab[]) => void;
}

function PluginsTab({ visibleTabs, toggleTabVisibility, isTabVisible, setVisibleTabs }: PluginsTabProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [hoveredPlugin, setHoveredPlugin] = useState<string | null>(null);
  const { closeTopPanel, setTopPanelHovering } = usePanel();

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

  const handleClose = () => {
    setSelectedPlugin(null);
    setTopPanelHovering(false);  // Override hover state to ensure panel closes
    closeTopPanel();
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (selectedPlugin) {
    const plugin = plugins.find(p => p.id === selectedPlugin);
    if (!plugin) return null;

    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-xl">
              {plugin.icon || '🔌'}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{plugin.name}</h3>
              <p className="text-xs text-white/60">{plugin.category}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="text-white/60 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/60 p-8">
          <div className="text-center max-w-md space-y-4">
            <div className="w-16 h-16 mx-auto rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl">
              {plugin.icon || '🔌'}
            </div>
            <div>
              <p className="text-lg font-semibold text-white mb-2">{plugin.name}</p>
              <p className="text-sm text-white/70">{plugin.description}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {plugin.tags.map(tag => (
                <Badge
                  key={tag}
                  className="bg-purple-500/20 border-purple-500/30 text-purple-300 text-xs"
                >
                  {tag}
                </Badge>
              ))}
            </div>
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

  // All tabs can be shown/hidden except plugins (needed for management UI)
  const optionalTabs = TAB_DEFS.filter(tab =>
    !['plugins'].includes(tab.value)
  );

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-8">
        {/* Tab Management Section */}
        {toggleTabVisibility && isTabVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-purple-500/30 to-purple-500/30" />
              <h3 className="text-sm font-semibold text-white">Manage Tabs</h3>
              <div className="h-px flex-1 bg-gradient-to-l from-purple-500/30 to-purple-500/30 via-transparent" />
            </div>
            <p className="text-xs text-white/50 text-center mb-4">
              Click tabs to show/hide them from the top panel
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {optionalTabs.map((tab) => {
                const Icon = tab.icon;
                const isVisible = isTabVisible(tab.value);
                return (
                  <motion.button
                    key={tab.value}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => toggleTabVisibility(tab.value)}
                    className={`
                      p-3 rounded-lg border transition-all duration-200 flex items-center gap-2
                      ${isVisible
                        ? 'bg-purple-500/20 border-purple-500/40 text-white'
                        : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:border-white/20'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-medium truncate">{tab.label}</span>
                    {isVisible && (
                      <Check className="w-3 h-3 ml-auto shrink-0 text-purple-400" />
                    )}
                  </motion.button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/10">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleTabs(['news', 'music-hub', 'plugins', 'marketplace', 'immersive', 'monaco-editor', 'events', 'prompt-lab', 'workflows', 'movies'])}
                className="text-xs border-white/20 text-white/70 hover:bg-white/10"
              >
                Reset to Defaults
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleTabs(TAB_DEFS.map(t => t.value))}
                className="text-xs border-white/20 text-white/70 hover:bg-white/10"
              >
                Show All Tabs
              </Button>
            </div>
          </motion.div>
        )}

        {/* Plugins Section */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-white/20" />
          <h3 className="text-sm font-semibold text-white/80">Plugins</h3>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/10 to-white/20" />
        </div>
        {Object.entries(grouped).map(([category, categoryPlugins], categoryIndex) => (
          <motion.div
            key={category}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: categoryIndex * 0.05 }}
          >
            {/* Category Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-white/20" />
              <span className="text-xs font-medium text-white/50 uppercase tracking-wider">
                {category}
              </span>
              <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/10 to-white/20" />
            </div>
            
            {/* Plugin Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {categoryPlugins.map((plugin, pluginIndex) => (
                <motion.div
                  key={plugin.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: categoryIndex * 0.05 + pluginIndex * 0.02 }}
                  whileHover={{ y: -2 }}
                  onMouseEnter={() => setHoveredPlugin(plugin.id)}
                  onMouseLeave={() => setHoveredPlugin(null)}
                  onClick={() => setSelectedPlugin(plugin.id)}
                  className="group relative p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] hover:border-white/15 transition-all duration-300 cursor-pointer overflow-hidden"
                >
                  {/* Subtle gradient overlay on hover */}
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 group-hover:from-purple-500/[0.03] group-hover:to-pink-500/[0.03] transition-all duration-500" />
                  
                  <div className="relative z-10 space-y-2">
                    {/* Name - prominent */}
                    <h4 className="text-sm font-medium text-white/90 group-hover:text-white transition-colors">
                      {plugin.name}
                    </h4>

                    {/* Description - appears/expands on hover */}
                    <div className="overflow-hidden">
                      <motion.p
                        initial={{ opacity: 0.5 }}
                        animate={{ 
                          opacity: hoveredPlugin === plugin.id ? 1 : 0.5,
                          height: hoveredPlugin === plugin.id ? 'auto' : '2.5rem'
                        }}
                        className="text-xs text-white/60 group-hover:text-white/80 transition-colors line-clamp-2"
                      >
                        {plugin.description}
                      </motion.p>
                    </div>

                    {/* Tags - compact pill style */}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {plugin.tags.slice(0, 2).map((tag, i) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/5 text-white/50 group-hover:border-white/10 group-hover:text-white/70 transition-colors"
                        >
                          {tag}
                        </span>
                      ))}
                      {plugin.tags.length > 2 && (
                        <span className="text-[10px] px-1.5 py-0.5 text-white/40">
                          +{plugin.tags.length - 2}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Open indicator - slides in on hover */}
                  <motion.div
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ 
                      opacity: hoveredPlugin === plugin.id ? 1 : 0,
                      x: hoveredPlugin === plugin.id ? 0 : 10 
                    }}
                    className="absolute bottom-3 right-3 text-white/60"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </motion.div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ))}

        {plugins.length === 0 && (
          <div className="text-center py-12 text-white/60">
            <Puzzle className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No plugins available</p>
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
  { value: "marketplace", label: "Marketplace", icon: Store },
  { value: "workflows", label: "Workflows", icon: Workflow },
  { value: "orchestration", label: "Orchestration", icon: Cpu },
  { value: "art-gallery", label: "Art Gallery", icon: Image },
  { value: "mind-map", label: "Mind Map", icon: Brain },
  { value: "prompt-lab", label: "Prompt Lab", icon: FlaskConical },
  { value: "messages", label: "Messages", icon: MessageCircle },
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
  { value: "mcp", label: "MCP Store", icon: Puzzle },
  { value: "movies", label: "Movies", icon: Film },
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
  isTabVisible: (tab: TopPanelTab) => boolean;
  setTopPanelTab: (tab: TopPanelTab) => void;
}

function ScrollableTabBar({
  tabs,
  activeTab,
  onTabChange,
  isTabVisible,
  setTopPanelTab,
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
          {tabs.filter(tab => isTabVisible(tab.value)).map((tab) => {
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
          {/* Add/Manage Tabs Button - Use plain button to avoid Radix onValueChange conflict */}
          <button
            type="button"
            onClick={() => setTopPanelTab('plugins')}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-white/50 hover:text-white hover:bg-white/10 transition-all"
            title="Manage tabs"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
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
  const [panelHeightOffset, setPanelHeightOffset] = useState(360); // Pixels from bottom (default 360px)
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartHeightOffset = useRef(520);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(100);
  const resizeHandle = useRef<'left' | 'right' | 'bottom' | null>(null);

  // Tab visibility state - stored in localStorage
  const [visibleTabs, setVisibleTabs] = useState<TopPanelTab[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('topPanelVisibleTabs');
      if (saved) {
        try {
          return JSON.parse(saved) as TopPanelTab[];
        } catch {
          // Fallback to defaults if parsing fails
        }
      }
    }
    // Default visible tabs: News, Music Hub, Plugins, Marketplace, Immersive, Monaco Editor, Events, Prompt Lab, Workflows, Movies
    return ['news', 'music-hub', 'plugins', 'marketplace', 'immersive', 'monaco-editor', 'events', 'prompt-lab', 'workflows', 'movies'];
  });

  // Save visible tabs to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('topPanelVisibleTabs', JSON.stringify(visibleTabs));
    }
  }, [visibleTabs]);

  // Function to toggle tab visibility
  const toggleTabVisibility = useCallback((tab: TopPanelTab) => {
    setVisibleTabs(prev => {
      if (prev.includes(tab)) {
        // Don't allow hiding if only one tab would remain visible
        if (prev.length <= 1) {
          toast.error('At least one tab must be visible');
          return prev;
        }
        return prev.filter(t => t !== tab);
      } else {
        return [...prev, tab];
      }
    });
  }, []);

  // Function to check if a tab is visible
  const isTabVisible = useCallback((tab: TopPanelTab) => {
    return visibleTabs.includes(tab);
  }, [visibleTabs]);

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
          <>
            {/* Mobile: Separate panel with full width */}
            <motion.div
              className="fixed inset-x-2 top-2 z-[250] md:hidden"
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
            >
              <div className="absolute inset-0 bg-gradient-to-b from-black/90 via-black/80 to-transparent backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl pointer-events-none" />
              <div className="relative h-full">
                {/* Mobile Tab Bar */}
                <div className="p-2 border-b border-white/10">
                  <Tabs
                    value={(['news', 'plugins', 'marketplace'] as TopPanelTab[]).includes(topPanelActiveTab) ? topPanelActiveTab : 'news'}
                    onValueChange={(v) => setTopPanelTab(v as TopPanelTab)}
                  >
                    {/* Mobile: Only show tabs that have mobile content implemented */}
                    <ScrollableTabBar
                      tabs={TAB_DEFS.filter(tab => ['news', 'plugins', 'marketplace'].includes(tab.value))}
                      activeTab={(['news', 'plugins', 'marketplace'] as TopPanelTab[]).includes(topPanelActiveTab) ? topPanelActiveTab : 'news'}
                      onTabChange={setTopPanelTab}
                      isTabVisible={isTabVisible}
                      setTopPanelTab={setTopPanelTab}
                    />
                    {/* Mobile Tab Content */}
                    <div className="p-2 h-[calc(100vh-180px)] overflow-y-auto">
                      <TabsContent value="news" className="h-full mt-0">
                        <TabErrorBoundary tabName="News">
                          <NewsTab />
                        </TabErrorBoundary>
                      </TabsContent>
                      <TabsContent value="plugins" className="h-full mt-0">
                        <TabErrorBoundary tabName="Plugins">
                          <PluginsTab 
                            visibleTabs={visibleTabs}
                            toggleTabVisibility={toggleTabVisibility}
                            isTabVisible={isTabVisible}
                            setVisibleTabs={setVisibleTabs}
                          />
                        </TabErrorBoundary>
                      </TabsContent>
                      <TabsContent value="marketplace" className="h-full mt-0">
                        <TabErrorBoundary tabName="Marketplace">
                          <PluginMarketplace />
                        </TabErrorBoundary>
                      </TabsContent>
                    </div>
                  </Tabs>
                </div>
              </div>
            </motion.div>

            {/* Desktop: Original centered panel */}
            <motion.div
              className="hidden md:block fixed z-[150]"
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
              {/* Desktop Glassmorphic Background */}
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
                    isTabVisible={isTabVisible}
                    setTopPanelTab={setTopPanelTab}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTopPanel();
                    }}
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
                      <PluginsTab 
                        visibleTabs={visibleTabs}
                        toggleTabVisibility={toggleTabVisibility}
                        isTabVisible={isTabVisible}
                        setVisibleTabs={setVisibleTabs}
                      />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Marketplace */}
                  <TabsContent value="marketplace" className="h-full mt-0">
                    <TabErrorBoundary tabName="Marketplace">
                      <PluginMarketplace />
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

                  {/* Music Hub - forceMount keeps playback alive when switching tabs */}
                  <TabsContent value="music-hub" className="h-full mt-0" forceMount>
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

                  {/* Workflows — duplicate removed; primary at line 986 */}

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

                  <TabsContent value="mcp" className="h-full mt-0">
                    <TabErrorBoundary tabName="MCP Store">
                      <MCPStore />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent value="movies" className="h-full mt-0">
                    <TabErrorBoundary tabName="Movies">
                      <PStreamEmbedPlugin onClose={closeTopPanel} />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent value="experience" className="h-full mt-0">
                    <TabErrorBoundary tabName="Experience">
                      <ExperiencePanel />
                    </TabErrorBoundary>
                  </TabsContent>

                  <TabsContent value="movies-old" className="h-full mt-0">
                    <TabErrorBoundary tabName="Movies">
                      <PStreamEmbedPlugin onClose={closeTopPanel} />
                    </TabErrorBoundary>
                  </TabsContent>

                  {/* Events Panel — duplicate removed; primary at line 1048 */}

                  {/* Bookmarks — duplicate removed; primary at line 1054 */}

                  {/* Workflows, Code Playground, Monaco Editor — duplicates removed; primaries at lines 986, 1068, 1075 */}
                </Tabs>
              </div>
            </div>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </>
  );
}
