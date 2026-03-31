"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Newspaper,
  RefreshCw,
  ExternalLink,
  Rss,
  Search,
  Clock,
  Heart,
  Share2,
  TrendingUp,
  Zap,
  Globe,
  Cpu,
  Image,
  ImageIcon,
  Loader2,
  X,
  Maximize2,
  ChevronRight,
  Star,
  MessageCircle,
  ArrowUpRight,
  LayoutGrid,
  List,
  AlignLeft,
  Video,
  Radio,
  Calendar,
  Bookmark,
  BookmarkPlus,
  Settings,
  GripVertical,
  ThumbsUp,
  Eye,
  Play,
  Volume2,
  Wifi,
} from "lucide-react";
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

interface NewsArticle {
  id: string;
  title: string;
  description?: string;
  content?: string;
  url: string;
  imageUrl?: string;
  source: string;
  author?: string;
  publishedAt: number;
  category?: string;
  categories?: string[];
  upvotes?: number;
  comments?: number;
  // Video-specific
  videoUrl?: string;
  duration?: string;
  // Live-specific
  isLive?: boolean;
  viewerCount?: number;
  // Internal reading
  keywords?: string;
  readingTime?: number;
}

// Layout configuration per session/author
interface LayoutConfig {
  id: string;
  name: string;
  defaultView: 'hero' | 'grid' | 'list' | 'compact' | 'video' | 'live' | 'masonry';
  showImages: boolean;
  showMetadata: boolean;
  columns: number;
  cardStyle: 'minimal' | 'rich' | 'collage';
}

// Predefined layout templates
const LAYOUT_TEMPLATES: Record<string, LayoutConfig> = {
  default: { id: 'default', name: 'Default', defaultView: 'grid', showImages: true, showMetadata: true, columns: 2, cardStyle: 'rich' },
  minimal: { id: 'minimal', name: 'Minimal', defaultView: 'list', showImages: false, showMetadata: false, columns: 1, cardStyle: 'minimal' },
  collage: { id: 'collage', name: 'Collage', defaultView: 'masonry', showImages: true, showMetadata: true, columns: 3, cardStyle: 'collage' },
  video: { id: 'video', name: 'Video Focus', defaultView: 'video', showImages: true, showMetadata: true, columns: 2, cardStyle: 'rich' },
  live: { id: 'live', name: 'Live News', defaultView: 'live', showImages: true, showMetadata: true, columns: 1, cardStyle: 'rich' },
};

// Extended news sources with real RSS feeds
const NEWS_SOURCES = [
  { id: "hn", name: "Hacker News", icon: Zap, color: "text-orange-400", bg: "bg-orange-500/20", feed: "hn", category: "tech" },
  { id: "hnnew", name: "HN Newest", icon: Zap, color: "text-orange-300", bg: "bg-orange-500/20", feed: "hnnew", category: "tech" },
  { id: "hnask", name: "HN Ask", icon: MessageCircle, color: "text-orange-400", bg: "bg-orange-500/20", feed: "hnask", category: "discussion" },
  { id: "techcrunch", name: "TechCrunch", icon: Cpu, color: "text-blue-400", bg: "bg-blue-500/20", feed: "techcrunch", category: "tech" },
  { id: "ars", name: "Ars Technica", icon: Cpu, color: "text-red-400", bg: "bg-red-500/20", feed: "ars", category: "tech" },
  { id: "verge", name: "The Verge", icon: Globe, color: "text-green-400", bg: "bg-green-500/20", feed: "verge", category: "tech" },
  { id: "wired", name: "Wired", icon: Zap, color: "text-yellow-400", bg: "bg-yellow-500/20", feed: "wired", category: "tech" },
  { id: "bbc", name: "BBC Tech", icon: Globe, color: "text-green-400", bg: "bg-green-500/20", feed: "bbc", category: "world" },
];

// Key for storing layout preferences in localStorage
const LAYOUT_STORAGE_KEY = 'bing-news-layout-';

// Fetch images for articles without cover images
async function fetchMissingImages(articles: NewsArticle[]): Promise<Map<string, string[]>> {
  const articlesNeedingImages = articles.filter(a => !a.imageUrl);

  if (articlesNeedingImages.length === 0) {
    return new Map();
  }

  // Prepare articles with required fields
  const articlesForSearch = articlesNeedingImages
    .filter(a => a.id && a.title)
    .map(a => ({ id: a.id, title: a.title }));

  if (articlesForSearch.length === 0) {
    console.warn('[NewsPanel] No valid articles for image search');
    return new Map();
  }

  try {
    const response = await fetch('/api/news/image-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articles: articlesForSearch
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn('[NewsPanel] Image search failed:', response.status, errorData.error);
      return new Map();
    }

    const data = await response.json();
    if (!data.success) {
      console.warn('[NewsPanel] Image search returned error:', data.error);
      return new Map();
    }

    const imageMap = new Map<string, string[]>();
    for (const result of data.results || []) {
      imageMap.set(result.id, result.images || []);
    }
    return imageMap;
  } catch (error) {
    console.error('[NewsPanel] Image search error:', error);
    return new Map();
  }
}

// Fetch real articles from RSS API
async function fetchRSSArticles(source: string, signal?: AbortSignal): Promise<NewsArticle[]> {
  try {
    const controller = signal ? null : new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000);
    
    const response = await fetch(`/api/news/rss?source=${source}&limit=20`, {
      signal: signal || controller?.signal,
      headers: { 'Accept': 'application/json' },
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success || !data.articles) {
      console.warn('[NewsPanel] API returned error:', data.error);
      return [];
    }
    
    // Transform API response to NewsArticle format
    return data.articles.map((article: any) => ({
      id: article.id,
      title: article.title,
      description: article.description,
      url: article.url,
      imageUrl: article.imageUrl,
      source: data.source,
      author: article.author,
      publishedAt: article.publishedAt || Date.now(),
      category: article.categories?.[0],
      categories: article.categories,
      // Add mock engagement for HN
      ...(source.startsWith('hn') ? { 
        upvotes: Math.floor(Math.random() * 500) + 10, 
        comments: Math.floor(Math.random() * 100) + 1 
      } : {}),
    }));
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn('[NewsPanel] Fetch aborted');
    } else {
      console.error('[NewsPanel] Fetch error:', error);
    }
    return [];
  }
}

// Fallback mock data when RSS fails
const generateMockArticles = (source: string, count: number): NewsArticle[] => {
  const sourceName = NEWS_SOURCES.find(s => s.id === source)?.name || 'News';
  const titles = [
    "AI Model Breaks New Ground in Language Understanding",
    "Quantum Computing Reaches Milestone with 1000 Qubit Chip",
    "New Battery Technology Promises Week-Long Phone Charge",
    "SpaceX Starship Completes First Orbital Flight",
    "Open Source Project Revolutionizes Web Development",
    "Climate Tech Startup Raises $500M for Carbon Capture",
    "Neural Network Achieves Human-Level Code Generation",
    "New Material Enables Transparent Solar Panels",
    "Breakthrough in Nuclear Fusion Energy Announced",
    "Tech Giants Form Alliance for AI Safety Standards",
    "Autonomous Vehicles Approved for Highway Use",
    "Revolutionary MRI Technique Reduces Scan Time by 90%",
    "New Antibiotic Shows Promise Against Resistant Bacteria",
    "Mars Colony Design Unveiled by Space Agency",
    "Blockchain Technology Adoption Reaches All-Time High",
  ];

  return Array.from({ length: count }, (_, i) => ({
    id: `mock-${source}-${i}-${Date.now()}`,
    title: titles[i % titles.length],
    description: `This is a summary of the latest ${sourceName} news story. Click to read more about this fascinating development.`,
    url: "https://example.com/article",
    imageUrl: `https://picsum.photos/seed/${source}${i}/400/200`,
    source: sourceName,
    author: "Staff Writer",
    publishedAt: Date.now() - i * 3600000,
    category: ["AI", "Space", "Energy", "Science", "Tech"][i % 5],
    upvotes: source.startsWith('hn') ? Math.floor(Math.random() * 500) + 10 : undefined,
    comments: source.startsWith('hn') ? Math.floor(Math.random() * 100) + 1 : undefined,
  }));
};

// Time ago helper
const timeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// Card Templates

// Template 1: Hero Card with large image
function HeroCard({ article, onClick }: { article: NewsArticle; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className="relative group cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-white/0"
      onClick={onClick}
    >
      <div className="relative h-40 overflow-hidden">
        {article.imageUrl ? (
          <img
            src={getProxiedImageUrl(article.imageUrl)}
            alt={article.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center">
            <Image className="h-12 w-12 text-white/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <div className="absolute top-3 left-3">
          <Badge className="bg-cyan-500/80 text-white text-[10px]">{article.category}</Badge>
        </div>
      </div>
      <div className="p-4">
        <h3 className="text-sm font-semibold text-white/90 line-clamp-2 group-hover:text-cyan-300 transition-colors">
          {article.title}
        </h3>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2 text-[10px] text-white/50">
            <Clock className="h-3 w-3" />
            {timeAgo(article.publishedAt)}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-white/50">
            {article.upvotes && (
              <span className="flex items-center gap-0.5">
                <Heart className="h-3 w-3 text-pink-400" />
                {article.upvotes}
              </span>
            )}
            {article.comments !== undefined && (
              <span className="flex items-center gap-0.5 ml-2">
                <MessageCircle className="h-3 w-3 text-blue-400" />
                {article.comments}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Template 2: Compact horizontal card
function CompactCard({ article, onClick }: { article: NewsArticle; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ x: 4 }}
      className="flex gap-3 p-3 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 cursor-pointer transition-all"
      onClick={onClick}
    >
      {article.imageUrl && (
        <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
          <img src={getProxiedImageUrl(article.imageUrl)} alt={article.title} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-xs font-medium text-white/90 line-clamp-2">{article.title}</h4>
          <ArrowUpRight className="h-3 w-3 text-white/40 flex-shrink-0 mt-0.5" />
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-white/40">
          <span className="truncate">{article.source}</span>
          <span>•</span>
          <span>{timeAgo(article.publishedAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// Template 3: Grid card with image
function GridCard({ article, onClick }: { article: NewsArticle; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.03 }}
      className="group cursor-pointer rounded-xl border border-white/10 bg-white/5 overflow-hidden hover:bg-white/10 transition-all"
      onClick={onClick}
    >
      <div className="aspect-video relative overflow-hidden">
        {article.imageUrl ? (
          <img
            src={getProxiedImageUrl(article.imageUrl)}
            alt={article.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
            <Newspaper className="h-8 w-8 text-white/30" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge className="bg-black/60 text-white text-[8px] backdrop-blur-sm">
            {article.category}
          </Badge>
        </div>
      </div>
      <div className="p-3">
        <h4 className="text-xs font-medium text-white/80 line-clamp-2 group-hover:text-cyan-300 transition-colors">
          {article.title}
        </h4>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] text-white/40">{article.source}</span>
          <span className="text-[9px] text-white/40">{timeAgo(article.publishedAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// Template 4: List item with source icon
function ListCard({ article, onClick }: { article: NewsArticle; onClick?: (e: React.MouseEvent) => void }) {
  const SourceIcon = NEWS_SOURCES.find(s => s.id === article.source)?.icon || Newspaper;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors group"
      onClick={onClick}
    >
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
        <SourceIcon className="h-4 w-4 text-cyan-400" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm text-white/80 line-clamp-1 group-hover:text-white transition-colors">
          {article.title}
        </h4>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-white/40">
          <span>{article.source}</span>
          <span>•</span>
          <span>{timeAgo(article.publishedAt)}</span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-cyan-400 transition-colors" />
    </motion.div>
  );
}

// Template 5: Video Card with play button overlay
function VideoCard({ article, onClick }: { article: NewsArticle; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className="group cursor-pointer rounded-xl border border-white/10 bg-white/5 overflow-hidden"
      onClick={onClick}
    >
      <div className="relative aspect-video">
        {article.imageUrl ? (
          <img
            src={getProxiedImageUrl(article.imageUrl)}
            alt={article.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center">
            <Video className="h-12 w-12 text-white/30" />
          </div>
        )}
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="h-5 w-5 text-black ml-0.5" />
          </div>
        </div>
        {/* Duration badge */}
        {article.duration && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 text-white text-[10px] rounded">
            {article.duration}
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge className="bg-purple-500/80 text-white text-[8px]">
            <Video className="h-2.5 w-2.5 mr-1" />
            Video
          </Badge>
        </div>
      </div>
      <div className="p-3">
        <h4 className="text-sm font-medium text-white/90 line-clamp-2 group-hover:text-cyan-300 transition-colors">
          {article.title}
        </h4>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2 text-[10px] text-white/40">
            <span>{article.source}</span>
            <span>•</span>
            <span>{timeAgo(article.publishedAt)}</span>
          </div>
          {article.viewerCount && (
            <div className="flex items-center gap-1 text-[10px] text-white/40">
              <Eye className="h-3 w-3" />
              {article.viewerCount.toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Template 6: Live News Card with pulsing indicator
function LiveCard({ article, onClick }: { article: NewsArticle; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ x: 4 }}
      className="flex gap-4 p-4 rounded-xl border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 cursor-pointer transition-all"
      onClick={onClick}
    >
      {/* Live indicator */}
      <div className="relative flex-shrink-0">
        <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
          <Radio className="h-5 w-5 text-red-400" />
        </div>
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge className="bg-red-500/20 text-red-400 text-[8px] animate-pulse">LIVE</Badge>
          {article.category && (
            <span className="text-[10px] text-red-300/70">{article.category}</span>
          )}
        </div>
        <h4 className="text-sm font-medium text-white/90 line-clamp-2">{article.title}</h4>
        <p className="text-[11px] text-white/50 line-clamp-1 mt-1">{article.description}</p>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-white/40">
          {article.viewerCount && (
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {article.viewerCount.toLocaleString()} watching
            </span>
          )}
          <span>{timeAgo(article.publishedAt)}</span>
        </div>
      </div>
      
      {article.imageUrl && (
        <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
          <img src={getProxiedImageUrl(article.imageUrl)} alt="" className="w-full h-full object-cover" />
        </div>
      )}
    </motion.div>
  );
}

// Template 7: Masonry/Collage Card (for collage layout)
function MasonryCard({ article, onClick, style = 'rich' }: { article: NewsArticle; onClick?: (e: React.MouseEvent) => void; style?: 'minimal' | 'rich' | 'collage' }) {
  const isCollage = style === 'collage';
  const isMinimal = style === 'minimal';
  
  if (isMinimal) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
        onClick={onClick}
      >
        <h4 className="text-xs text-white/80 line-clamp-2">{article.title}</h4>
        <span className="text-[9px] text-white/40 mt-1 block">{timeAgo(article.publishedAt)}</span>
      </motion.div>
    );
  }
  
  if (isCollage) {
    const isLarge = Math.random() > 0.5; // Randomly make some cards larger
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ scale: 1.02 }}
        className={`group cursor-pointer rounded-lg overflow-hidden ${isLarge ? 'col-span-2 row-span-2' : ''}`}
        onClick={onClick}
      >
        {article.imageUrl ? (
          <img
            src={getProxiedImageUrl(article.imageUrl)}
            alt={article.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-24 bg-gradient-to-br from-cyan-500/20 to-purple-500/20" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <h4 className={`text-${isLarge ? 'sm' : 'xs'} font-medium text-white line-clamp-2`}>
            {article.title}
          </h4>
        </div>
      </motion.div>
    );
  }
  
  // Rich style (default)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.03 }}
      className="group cursor-pointer rounded-xl border border-white/10 bg-white/5 overflow-hidden"
      onClick={onClick}
    >
      {article.imageUrl && (
        <div className="aspect-video relative overflow-hidden">
          <img
            src={getProxiedImageUrl(article.imageUrl)}
            alt={article.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}
      <div className="p-3">
        <h4 className="text-xs font-medium text-white/80 line-clamp-2 group-hover:text-cyan-300 transition-colors">
          {article.title}
        </h4>
        <div className="flex items-center justify-between mt-2 text-[9px] text-white/40">
          <span>{article.source}</span>
          <span>{timeAgo(article.publishedAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// Main News Panel Component
interface NewsPanelProps {
  onClose?: () => void;
}

export function NewsPanel({ onClose }: NewsPanelProps) {
  const [selectedSource, setSelectedSource] = useState("all");
  const [viewMode, setViewMode] = useState<"hero" | "grid" | "list" | "compact" | "video" | "live" | "masonry">("grid");
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [layoutConfig, setLayoutConfig] = useState<LayoutConfig>(LAYOUT_TEMPLATES.default);
  const [showLayoutSettings, setShowLayoutSettings] = useState(false);
  const [allArticles, setAllArticles] = useState<NewsArticle[]>([]); // Store all for "all" source
  const [expandedArticle, setExpandedArticle] = useState<NewsArticle | null>(null); // For internal reading view
  const [isExpanding, setIsExpanding] = useState(false);

  // Load layout config from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (stored) {
        try {
          const config = JSON.parse(stored);
          setLayoutConfig(config);
          setViewMode(config.defaultView as any);
        } catch {}
      }
    }
  }, []);

  // Save layout config when changed
  const updateLayoutConfig = useCallback((updates: Partial<LayoutConfig>) => {
    const newConfig = { ...layoutConfig, ...updates };
    setLayoutConfig(newConfig);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(newConfig));
    }
    if (updates.defaultView) {
      setViewMode(updates.defaultView as any);
    }
  }, [layoutConfig]);

  // Fetch articles from RSS API
  const fetchArticles = async (source: string) => {
    setIsLoading(true);
    try {
      // If "all", fetch from multiple sources
      if (source === 'all') {
        const sources = ['hn', 'techcrunch', 'ars', 'verge'];
        const results = await Promise.all(
          sources.map(s => fetchRSSArticles(s))
        );
        const combined = results.flat().sort((a, b) => b.publishedAt - a.publishedAt);
        
        if (combined.length === 0) {
          // Fallback to mock
          const mockWithImages = generateMockArticles('hn', 15);
          setArticles(mockWithImages);
          setAllArticles(mockWithImages);
        } else {
          // Fetch missing images
          const imageMap = await fetchMissingImages(combined);
          const withImages = combined.map(article => ({
            ...article,
            imageUrl: article.imageUrl || imageMap.get(article.id)?.[0],
            readingTime: Math.ceil((article.description?.split(' ').length || 100) / 200),
          }));
          setArticles(withImages);
          setAllArticles(withImages);
        }
      } else {
        const rssArticles = await fetchRSSArticles(source);
        
        if (rssArticles.length === 0) {
          // Fallback to mock data
          const mock = generateMockArticles(source, 15);
          setArticles(mock);
          if (source === 'all') setAllArticles(mock);
        } else {
          // Fetch missing images
          const imageMap = await fetchMissingImages(rssArticles);
          const withImages = rssArticles.map(article => ({
            ...article,
            imageUrl: article.imageUrl || imageMap.get(article.id)?.[0],
            readingTime: Math.ceil((article.description?.split(' ').length || 100) / 200),
          }));
          setArticles(withImages);
          if (source === 'all') setAllArticles(withImages);
        }
      }
    } catch (error) {
      console.error("Failed to fetch news:", error);
      toast.error("Failed to load news");
      // Fallback
      const mock = generateMockArticles(source === "all" ? "hn" : source, 15);
      setArticles(mock);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchArticles(selectedSource);
  }, [selectedSource]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchArticles(selectedSource);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedSource]);

  // Refresh handler
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchArticles(selectedSource);
    setRefreshing(false);
    toast.success("News refreshed");
  };

  // Filter articles by search
  const filteredArticles = (selectedSource === 'all' ? allArticles : articles).filter(article =>
    article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    article.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle article click - expand for internal reading or open external
  const handleArticleClick = (article: NewsArticle, e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // Open external link
      window.open(article.url, '_blank');
    } else {
      // Internal reading view with smooth transition
      setExpandedArticle(article);
      setIsExpanding(true);
    }
  };

  // Close expanded article
  const closeExpandedArticle = () => {
    setIsExpanding(false);
    setTimeout(() => setExpandedArticle(null), 300); // Wait for animation
  };

  // Apply layout columns
  const getGridClass = () => {
    const cols = layoutConfig.columns;
    if (viewMode === 'masonry') return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
    if (viewMode === 'live') return 'space-y-3';
    if (viewMode === 'video') return `grid-cols-1 md:grid-cols-${Math.min(cols, 2)}`;
    if (viewMode === 'hero') return 'space-y-4';
    return `grid-cols-1 ${cols > 1 ? 'md:grid-cols-' + cols : ''}`;
  };

  // Render article cards based on view mode
  const renderArticles = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      );
    }

    if (filteredArticles.length === 0) {
      return (
        <div className="text-center py-12">
          <Newspaper className="h-12 w-12 text-white/20 mx-auto mb-3" />
          <p className="text-white/40 text-sm">No articles found</p>
        </div>
      );
    }

    switch (viewMode) {
      case "hero":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {filteredArticles.slice(0, 3).map((article) => (
                <HeroCard
                  key={article.id || article.url}
                  article={article}
                  onClick={(e) => handleArticleClick(article, e)}
                />
              ))}
            </div>
            <div className="space-y-2 mt-6">
              <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">More Stories</h3>
              {filteredArticles.slice(3).map((article) => (
                <CompactCard
                  key={article.id || article.url}
                  article={article}
                  onClick={(e) => handleArticleClick(article, e)}
                />
              ))}
            </div>
          </div>
        );

      case "grid":
        return (
          <div className={`grid ${getGridClass()} gap-3`}>
            {filteredArticles.map((article) => (
              <MasonryCard
                key={article.id || article.url}
                article={article}
                style={layoutConfig.cardStyle}
                onClick={(e) => handleArticleClick(article, e)}
              />
            ))}
          </div>
        );

      case "masonry":
        return (
          <div className={`grid ${getGridClass()} gap-2`}>
            {filteredArticles.map((article) => (
              <MasonryCard
                key={article.url}
                article={article}
                style="collage"
                onClick={(e) => handleArticleClick(article, e)}
              />
            ))}
          </div>
        );

      case "video":
        return (
          <div className={`grid ${getGridClass()} gap-4`}>
            {filteredArticles.map((article) => (
              <VideoCard
                key={article.url}
                article={article}
                onClick={(e) => handleArticleClick(article, e)}
              />
            ))}
          </div>
        );

      case "live":
        return (
          <div className={`${getGridClass()} gap-3`}>
            {filteredArticles.slice(0, 10).map((article) => (
              <LiveCard
                key={`${article.url}-live`}
                article={{ ...article, isLive: true, viewerCount: Math.floor(Math.random() * 5000) + 100 }}
                onClick={(e) => handleArticleClick(article, e)}
              />
            ))}
          </div>
        );

      case "list":
        return (
          <div className="space-y-1">
            {filteredArticles.map((article) => (
              <ListCard
                key={article.url}
                article={article}
                onClick={(e) => handleArticleClick(article, e)}
              />
            ))}
          </div>
        );

      case "compact":
        return (
          <div className="space-y-2">
            {filteredArticles.map((article) => (
              <CompactCard
                key={article.url}
                article={article}
                onClick={(e) => handleArticleClick(article, e)}
              />
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-lg border border-cyan-500/30">
            <Newspaper className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">News Feed</h2>
            <p className="text-[10px] text-white/40">Latest stories from across the web</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          className="h-7 w-7 hover:bg-white/10"
          disabled={refreshing}
        >
          <RefreshCw className={`h-3 w-3 text-white/60 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="p-3 space-y-3 border-b border-white/5">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-white/40" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search news..."
            className="pl-9 h-8 bg-white/5 border-white/10 text-white/90 placeholder:text-white/40 text-xs"
          />
        </div>

        {/* Source Tabs */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          <Button
            variant={selectedSource === "all" ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedSource("all")}
            className={`text-[10px] h-6 px-2 ${selectedSource === "all" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-white/50 hover:text-white/80"}`}
          >
            All
          </Button>
          {NEWS_SOURCES.map((source) => (
            <Button
              key={source.id}
              variant={selectedSource === source.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setSelectedSource(source.id)}
              className={`text-[10px] h-6 px-2 whitespace-nowrap ${selectedSource === source.id ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-white/50 hover:text-white/80"}`}
            >
              <source.icon className={`h-3 w-3 mr-1 ${source.color}`} />
              {source.name}
            </Button>
          ))}
        </div>

        {/* View Mode Toggle with Layout Settings */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
            {[
              { id: "masonry", icon: LayoutGrid, label: "Collage" },
              { id: "grid", icon: LayoutGrid, label: "Grid" },
              { id: "list", icon: List, label: "List" },
              { id: "compact", icon: AlignLeft, label: "Compact" },
              { id: "hero", icon: ImageIcon, label: "Hero" },
              { id: "video", icon: Video, label: "Video" },
              { id: "live", icon: Radio, label: "Live" },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id as typeof viewMode)}
                title={mode.label}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === mode.id
                    ? "bg-cyan-500/30 text-cyan-300"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                <mode.icon className="h-3 w-3" />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowLayoutSettings(!showLayoutSettings)}
              className="h-6 w-6 hover:bg-white/10"
            >
              <Settings className="h-3 w-3 text-white/50" />
            </Button>
            <Badge variant="secondary" className="text-[9px] bg-white/10 text-white/50">
              {filteredArticles.length} articles
            </Badge>
          </div>
        </div>

        {/* Layout Settings Panel */}
        <AnimatePresence>
          {showLayoutSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-3 pb-2 space-y-3 border-t border-white/5">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(LAYOUT_TEMPLATES).map(([key, template]) => (
                    <Button
                      key={key}
                      variant={layoutConfig.id === key ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateLayoutConfig(template)}
                      className={`text-[10px] h-6 ${layoutConfig.id === key ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" : "border-white/20 text-white/60"}`}
                    >
                      {template.name}
                    </Button>
                  ))}
                </div>
                
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-[10px] text-white/50">
                    <input
                      type="checkbox"
                      checked={layoutConfig.showImages}
                      onChange={(e) => updateLayoutConfig({ showImages: e.target.checked })}
                      className="rounded border-white/20"
                    />
                    Show Images
                  </label>
                  <label className="flex items-center gap-2 text-[10px] text-white/50">
                    <input
                      type="checkbox"
                      checked={layoutConfig.showMetadata}
                      onChange={(e) => updateLayoutConfig({ showMetadata: e.target.checked })}
                      className="rounded border-white/20"
                    />
                    Show Metadata
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/50">Columns:</span>
                    <input
                      type="range"
                      min="1"
                      max="4"
                      value={layoutConfig.columns}
                      onChange={(e) => updateLayoutConfig({ columns: parseInt(e.target.value) })}
                      className="w-16"
                    />
                    <span className="text-[10px] text-white/40">{layoutConfig.columns}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Articles Content */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedSource + viewMode}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {renderArticles()}
            </motion.div>
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-white/5">
        <div className="flex items-center justify-between text-[10px] text-white/40">
          <div className="flex items-center gap-2">
            <Rss className="h-3 w-3" />
            <span>RSS Feeds</span>
            <span className="text-white/20">|</span>
            <span className="text-cyan-400/60">Shift+Click for external link</span>
          </div>
          <div className="flex items-center gap-1">
            <span>Auto-refresh:</span>
            <Badge variant="outline" className="text-[8px] bg-green-500/20 text-green-400 border-green-500/30">
              5 min
            </Badge>
          </div>
        </div>
      </div>

      {/* Internal Reading View - Expanded Article */}
      <AnimatePresence>
        {expandedArticle && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: isExpanding ? 1 : 0, y: isExpanding ? 0 : 20 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col"
          >
            {/* Expanded Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closeExpandedArticle}
                  className="h-8 w-8 hover:bg-white/10"
                >
                  <X className="h-4 w-4 text-white/80" />
                </Button>
                <div>
                  <h2 className="text-sm font-semibold text-white/90 line-clamp-1">{expandedArticle.title}</h2>
                  <p className="text-[10px] text-white/40">{expandedArticle.source} • {expandedArticle.readingTime || 3} min read</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(expandedArticle.url, '_blank')}
                  className="h-8 text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Visit Original
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closeExpandedArticle}
                  className="h-8 w-8 hover:bg-white/10"
                >
                  <Maximize2 className="h-4 w-4 text-white/60" />
                </Button>
              </div>
            </div>

            {/* Expanded Content */}
            <ScrollArea className="flex-1">
              <div className="max-w-3xl mx-auto p-6">
                {/* Hero Image */}
                {expandedArticle.imageUrl && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                    className="relative aspect-video rounded-xl overflow-hidden mb-6"
                  >
                    <img
                      src={getProxiedImageUrl(expandedArticle.imageUrl)}
                      alt={expandedArticle.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  </motion.div>
                )}

                {/* Article Meta */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="flex items-center gap-4 mb-6 text-xs text-white/50"
                >
                  {expandedArticle.author && (
                    <span className="flex items-center gap-1">
                      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center">
                        {expandedArticle.author[0].toUpperCase()}
                      </span>
                      {expandedArticle.author}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(expandedArticle.publishedAt).toLocaleDateString()}
                  </span>
                  {expandedArticle.category && (
                    <Badge className="bg-cyan-500/20 text-cyan-300 text-[8px]">
                      {expandedArticle.category}
                    </Badge>
                  )}
                  {expandedArticle.upvotes && (
                    <span className="flex items-center gap-1 text-pink-400">
                      <Heart className="h-3 w-3" />
                      {expandedArticle.upvotes}
                    </span>
                  )}
                  {expandedArticle.comments !== undefined && (
                    <span className="flex items-center gap-1 text-blue-400">
                      <MessageCircle className="h-3 w-3" />
                      {expandedArticle.comments}
                    </span>
                  )}
                </motion.div>

                {/* Title */}
                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-2xl font-bold text-white/90 mb-4 leading-tight"
                >
                  {expandedArticle.title}
                </motion.h1>

                {/* Description/Content */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.25 }}
                  className="prose prose-invert prose-sm max-w-none"
                >
                  <p className="text-white/70 leading-relaxed text-base">
                    {expandedArticle.description || 'Click the button below to read the full article on the original website.'}
                  </p>
                  {expandedArticle.content && (
                    <div className="mt-4 text-white/60 whitespace-pre-wrap">
                      {expandedArticle.content}
                    </div>
                  )}
                </motion.div>

                {/* Action Buttons */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mt-8 flex gap-3"
                >
                  <Button
                    onClick={() => window.open(expandedArticle.url, '_blank')}
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Read Full Article
                  </Button>
                  <Button
                    variant="outline"
                    onClick={closeExpandedArticle}
                    className="border-white/20 text-white/70 hover:bg-white/10"
                  >
                    Back to Feed
                  </Button>
                </motion.div>

                {/* Source Info */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 }}
                  className="mt-8 pt-6 border-t border-white/10 text-center"
                >
                  <p className="text-xs text-white/40">
                    Source: {expandedArticle.url}
                  </p>
                </motion.div>
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default NewsPanel;