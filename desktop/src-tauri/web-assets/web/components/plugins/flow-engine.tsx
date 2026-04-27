/**
 * Zine Flow Engine - Avant-Garde Multi-Purpose Display System
 * 
 * A boundary-breaking, artistic content delivery system that:
 * - Displays content in unbounded, free-floating UI elements
 * - Handles multiple data sources (RSS, webhooks, APIs, OAuth integrations)
 * - Features rotating artistic templates with dynamic positioning
 * - Supports custom data forms and media types
 * - Implements content deduplication and intelligent optimization
 * - Creates flying/floating animations for content delivery
 * - Enables invisible background content + notification fade-ins
 * - Provides rotation automation based on content intent/purpose
 * - Breaks conventional UI boundaries for artistic expression
 */

"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  Zap, Sparkles, Rotate3D, Move, Maximize2, Minimize2, X, Plus,
  Settings, RefreshCw, Palette, Type, Image, Video, Music, FileText,
  Link2, Rss, Webhook, Cloud, Database, Clock, Calendar, Bell,
  Eye, EyeOff, Shuffle, Layers, Grid3X3, List, Columns, Focus,
  Aperture, Hexagon, Circle, Square, Triangle, Star, Heart,
  MessageSquare, Share2, Copy, ExternalLink, Download, Upload,
  CheckCircle, AlertCircle, Loader2, Search, Filter, SortAsc,
  TrendingUp, Activity, Wifi, WifiOff, Shield, Key, Users,
  MessageCircle, Send, Bookmark, Tag, FolderOpen, Archive,
  Trash2, Edit2, Save, XCircle, Check, ChevronRight, ChevronLeft,
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Sun, Moon, CloudRain, Wind, Flame, Droplets,
  Code, Terminal, Cpu, Server, Globe, MapPin, Hash,
} from "lucide-react";
import { toast } from "sonner";
import { PersistentCache } from "@/lib/cache";
import { clipboard } from '@bing/platform/clipboard';

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

// ==================== Types ====================

interface ContentItem {
  id: string;
  type: ContentType;
  source: ContentSource;
  title: string;
  content: string;
  media?: MediaItem[];
  metadata: ContentMetadata;
  style?: ContentStyle;
  position?: Position2D;
  createdAt: number;
  expiresAt?: number;
  priority: Priority;
  tags: string[];
  dedupHash: string;
}

interface MediaItem {
  type: 'image' | 'video' | 'audio' | 'embed';
  url: string;
  alt?: string;
  duration?: number;
  thumbnail?: string;
}

interface ContentMetadata {
  author?: string;
  sourceUrl?: string;
  platform?: string;
  integrationId?: string;
  oauthProvider?: string;
  cronSchedule?: string;
  rssFeed?: string;
  webhookEvent?: string;
  emailThread?: string;
  notificationType?: string;
  customData?: Record<string, any>;
}

interface ContentStyle {
  template: TemplateType;
  rotation?: number;
  scale?: number;
  opacity?: number;
  blendMode?: BlendMode;
  fontFamily?: string;
  fontSize?: number;
  colors?: ColorScheme;
  animation?: AnimationType;
  floating?: boolean;
  boundary?: 'bounded' | 'unbounded' | 'fullscreen';
}

interface Position2D {
  x: number;
  y: number;
  vx?: number; // velocity x
  vy?: number; // velocity y
}

interface ColorScheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

type ContentType = 
  | 'text' | 'message' | 'announcement' | 'blog' | 'notification'
  | 'image' | 'video' | 'audio' | 'embed' | 'integration'
  | 'data' | 'chart' | 'code' | 'email' | 'social' | 'custom';

type ContentSource = 
  | 'rss' | 'webhook' | 'api' | 'cron' | 'oauth' | 'manual'
  | 'integration' | 'email' | 'notification' | 'file' | 'url';

type TemplateType = 
  | 'floating' | 'rotating' | 'grid' | 'stream' | 'cluster'
  | 'spiral' | 'wave' | 'scatter' | 'orbit' | 'random'
  | 'typewriter' | 'chalkboard' | 'neon' | 'minimal' | 'maximal'
  | 'brutalist' | 'glassmorphic' | 'retro' | 'futuristic' | 'organic';

type BlendMode = 
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

type AnimationType = 
  | 'fade' | 'slide' | 'zoom' | 'rotate' | 'bounce' | 'float'
  | 'typewriter' | 'glitch' | 'pulse' | 'glow' | 'shake' | 'none';

type Priority = 'low' | 'normal' | 'high' | 'urgent' | 'system';

interface DisplayConfig {
  id: string;
  name: string;
  active: boolean;
  filters: ContentFilter;
  style: DisplayStyle;
  sources: ContentSource[];
  maxItems: number;
  dedupWindow: number; // milliseconds
}

interface ContentFilter {
  types: ContentType[];
  sources: ContentSource[];
  tags: string[];
  minPriority: Priority;
  dateRange?: { start: number; end: number };
}

interface DisplayStyle {
  defaultTemplate: TemplateType;
  rotationInterval: number; // ms
  maxVisible: number;
  layout: LayoutType;
  colors: ColorScheme;
  typography: Typography;
  animations: AnimationConfig;
}

interface LayoutType {
  type: 'free' | 'grid' | 'masonry' | 'columns' | 'stream';
  columns?: number;
  gap?: number;
  padding?: number;
}

interface Typography {
  fontFamily: string;
  baseSize: number;
  scaleRatio: number;
  lineHeight: number;
}

interface AnimationConfig {
  entrance: AnimationType;
  exit: AnimationType;
  duration: number;
  stagger: number;
}

interface IntegrationConfig {
  id: string;
  provider: string;
  type: 'oauth' | 'webhook' | 'api' | 'rss';
  connected: boolean;
  lastSync?: number;
  config: Record<string, any>;
}

// ==================== Constants ====================

const COLOR_SCHEMES: Record<string, ColorScheme> = {
  neon: {
    primary: '#00f0ff',
    secondary: '#ff00ff',
    accent: '#ffff00',
    background: 'rgba(0, 0, 0, 0.9)',
    text: '#ffffff',
  },
  sunset: {
    primary: '#ff6b6b',
    secondary: '#feca57',
    accent: '#ff9ff3',
    background: 'rgba(20, 10, 30, 0.95)',
    text: '#ffffff',
  },
  ocean: {
    primary: '#00d2d3',
    secondary: '#54a0ff',
    accent: '#5f27cd',
    background: 'rgba(0, 20, 40, 0.95)',
    text: '#ffffff',
  },
  forest: {
    primary: '#10ac84',
    secondary: '#1dd1a1',
    accent: '#feca57',
    background: 'rgba(10, 30, 20, 0.95)',
    text: '#ffffff',
  },
  monochrome: {
    primary: '#ffffff',
    secondary: '#888888',
    accent: '#444444',
    background: 'rgba(0, 0, 0, 0.95)',
    text: '#ffffff',
  },
  chalkboard: {
    primary: '#ffffff',
    secondary: '#ffff00',
    accent: '#ff6b6b',
    background: 'rgba(20, 40, 30, 0.98)',
    text: '#f0f0f0',
  },
};

const TEMPLATES: TemplateType[] = [
  'floating', 'rotating', 'grid', 'stream', 'cluster',
  'spiral', 'wave', 'scatter', 'orbit', 'random',
  'typewriter', 'chalkboard', 'neon', 'minimal', 'maximal',
  'brutalist', 'glassmorphic', 'retro', 'futuristic', 'organic',
];

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

const ANIMATIONS: AnimationType[] = [
  'fade', 'slide', 'zoom', 'rotate', 'bounce', 'float',
  'typewriter', 'glitch', 'pulse', 'glow', 'shake', 'none',
];

// ==================== Cache ====================

const zineCache = new PersistentCache('zine_flow_', 7 * 24 * 60 * 60 * 1000);
const contentCache = new PersistentCache('zine_content_', 24 * 60 * 60 * 1000);
const seenCache = new PersistentCache('zine_seen_', 24 * 60 * 60 * 1000);

// ==================== Utility Functions ====================

function generateId(): string {
  return `zine_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateDedupHash(content: string, source: string): string {
  let hash = 0;
  const str = content + source;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `hash_${Math.abs(hash)}`;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function randomPosition(containerWidth: number, containerHeight: number): Position2D {
  return {
    x: Math.random() * (containerWidth - 200),
    y: Math.random() * (containerHeight - 150),
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
  };
}

// ==================== Content Item Component ====================

interface ContentItemProps {
  item: ContentItem;
  style: ContentStyle;
  colors: ColorScheme;
  onClose: (id: string) => void;
  onClick: (item: ContentItem) => void;
  containerSize: { width: number; height: number };
}

const ContentItemComponent: React.FC<ContentItemProps> = ({
  item,
  style,
  colors,
  onClose,
  onClick,
  containerSize,
}) => {
  const controls = useAnimation();
  const elementRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState<Position2D>(
    style.floating && item.position ? item.position : { x: 0, y: 0 }
  );
  const animationRef = useRef<number | undefined>(undefined);

  // Floating animation
  useEffect(() => {
    if (!style.floating) return;

    const animate = () => {
      setPosition(prev => ({
        ...prev,
        x: Math.max(0, Math.min(containerSize.width - 300, prev.x + (prev.vx || 0))),
        y: Math.max(0, Math.min(containerSize.height - 200, prev.y + (prev.vy || 0))),
        vx: prev.x <= 0 || prev.x >= containerSize.width - 300 ? -(prev.vx || 0) : prev.vx,
        vy: prev.y <= 0 || prev.y >= containerSize.height - 200 ? -(prev.vy || 0) : prev.vy,
      }));
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [style.floating, containerSize]);

  // Entrance animation
  useEffect(() => {
    const animation = style.animation || 'fade';
    
    const animations: Record<AnimationType, any> = {
      fade: { opacity: [0, 1], scale: [0.9, 1] },
      slide: { x: [100, 0], opacity: [0, 1] },
      zoom: { scale: [0, 1], opacity: [0, 1] },
      rotate: { rotate: [180, 0], scale: [0, 1] },
      bounce: { y: [-100, 0], opacity: [0, 1] },
      float: { y: [20, 0], opacity: [0, 1] },
      typewriter: { opacity: [0, 1], x: [-50, 0] },
      glitch: { x: [-10, 10, -5, 5, 0], opacity: [0, 1] },
      pulse: { scale: [0.8, 1.1, 1], opacity: [0, 1] },
      glow: { scale: [0.9, 1], filter: ['brightness(0.5)', 'brightness(1)'] },
      shake: { x: [-10, 10, -10, 10, 0], opacity: [0, 1] },
      none: {},
    };

    controls.start(animations[animation] || animations.fade);
  }, [style.animation, controls]);

  const templateStyles: Record<TemplateType, string> = {
    floating: 'backdrop-blur-xl',
    rotating: 'backdrop-blur-lg',
    grid: 'backdrop-blur-md',
    stream: 'backdrop-blur-sm',
    cluster: 'backdrop-blur-xl',
    spiral: 'backdrop-blur-lg',
    wave: 'backdrop-blur-md',
    scatter: 'backdrop-blur-xl',
    orbit: 'backdrop-blur-lg',
    random: 'backdrop-blur-md',
    typewriter: 'font-mono',
    chalkboard: 'border-2 border-white/20',
    neon: 'border border-cyan-400/50 shadow-lg shadow-cyan-400/20',
    minimal: 'backdrop-blur-none bg-transparent',
    maximal: 'backdrop-blur-2xl border border-white/30',
    brutalist: 'border-4 border-white',
    glassmorphic: 'backdrop-blur-2xl bg-white/10',
    retro: 'border-2 border-dashed',
    futuristic: 'clip-path-polygon',
    organic: 'rounded-3xl',
  };

  const renderContent = () => {
    switch (item.type) {
      case 'image':
        return (
          <div className="space-y-2">
            {item.media?.map((media, idx) => (
              <img
                key={idx}
                src={getProxiedImageUrl(media.url)}
                alt={media.alt || item.title}
                className="w-full rounded-lg"
              />
            ))}
            <p className="text-sm opacity-80">{item.content}</p>
          </div>
        );
      
      case 'video':
        return (
          <div className="space-y-2">
            {item.media?.map((media, idx) => (
              <video
                key={idx}
                src={media.url}
                poster={getProxiedImageUrl(media.thumbnail)}
                controls
                className="w-full rounded-lg"
              />
            ))}
          </div>
        );
      
      case 'code':
        return (
          <pre className="bg-black/50 p-3 rounded-lg overflow-auto text-xs font-mono">
            <code>{item.content}</code>
          </pre>
        );
      
      case 'integration':
        return (
          <div className="flex items-center gap-3">
            {item.metadata.oauthProvider && (
              <Badge variant="outline" className="border-white/30">
                {item.metadata.oauthProvider}
              </Badge>
            )}
            <p className="text-sm">{item.content}</p>
          </div>
        );
      
      default:
        return (
          <div className="space-y-2">
            {item.title && (
              <h3 className="text-lg font-bold" style={{ color: colors.primary }}>
                {item.title}
              </h3>
            )}
            <p className="text-sm leading-relaxed">{item.content}</p>
            {item.media && item.media.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {item.media.map((media, idx) => (
                  media.type === 'image' && (
                    <img
                      key={idx}
                      src={getProxiedImageUrl(media.url)}
                      alt={media.alt || 'Media'}
                      className="w-20 h-20 object-cover rounded"
                    />
                  )
                ))}
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <motion.div
      ref={elementRef}
      initial={{ opacity: 0 }}
      animate={controls}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.5 }}
      className={`group absolute p-4 rounded-xl cursor-pointer transition-all duration-300 ${templateStyles[style.template]}`}
      style={{
        left: style.floating ? position.x : undefined,
        top: style.floating ? position.y : undefined,
        transform: style.rotation ? `rotate(${style.rotation}deg)` : undefined,
        scale: style.scale || 1,
        opacity: style.opacity || 1,
        mixBlendMode: style.blendMode,
        fontFamily: style.fontFamily,
        backgroundColor: colors.background,
        color: colors.text,
        zIndex: isHovered ? 50 : 10,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick(item)}
    >
      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose(item.id);
        }}
        className="absolute top-2 right-2 p-1 rounded-full hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>

      {/* Content */}
      <div className="max-w-sm">
        {renderContent()}
        
        {/* Metadata */}
        <div className="flex items-center gap-2 mt-3 text-xs opacity-60">
          <span>{timeAgo(item.createdAt)}</span>
          {item.metadata.platform && (
            <>
              <span>•</span>
              <span>{item.metadata.platform}</span>
            </>
          )}
          {item.priority !== 'normal' && (
            <>
              <span>•</span>
              <Badge 
                variant="outline" 
                className={`text-[10px] ${
                  item.priority === 'urgent' ? 'border-red-400 text-red-400' :
                  item.priority === 'high' ? 'border-orange-400 text-orange-400' :
                  'border-blue-400 text-blue-400'
                }`}
              >
                {item.priority}
              </Badge>
            </>
          )}
        </div>

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {item.tags.map((tag, idx) => (
              <Badge key={idx} variant="outline" className="text-[10px] border-white/20">
                #{tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

const ContentItemDisplay = React.memo(ContentItemComponent);
ContentItemDisplay.displayName = 'ContentItemDisplay';

// ==================== Main Component ====================

export default function FlowEngine() {
  // State
  const [items, setItems] = useState<ContentItem[]>([]);
  const [displayConfigs, setDisplayConfigs] = useState<DisplayConfig[]>([]);
  const [activeConfig, setActiveConfig] = useState<DisplayConfig | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTemplate, setCurrentTemplate] = useState<TemplateType>('floating');
  const [colorScheme, setColorScheme] = useState<keyof typeof COLOR_SCHEMES>('neon');
  const [showControls, setShowControls] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [rotationSpeed, setRotationSpeed] = useState(30000); // 30s
  const [maxVisible, setMaxVisible] = useState(20);
  const [containerSize, setContainerSize] = useState({ width: 1920, height: 1080 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const rotationTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Load persisted data
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const savedConfigs = zineCache.get<DisplayConfig[]>('configs');
      const savedIntegrations = zineCache.get<IntegrationConfig[]>('integrations');
      const savedSettings = zineCache.get<{
        template: TemplateType;
        colorScheme: string;
        autoRotate: boolean;
        rotationSpeed: number;
        maxVisible: number;
      }>('settings');

      if (savedConfigs?.length) setDisplayConfigs(savedConfigs);
      if (savedIntegrations?.length) setIntegrations(savedIntegrations);
      if (savedSettings) {
        setCurrentTemplate(savedSettings.template);
        setColorScheme(savedSettings.colorScheme as any);
        setAutoRotate(savedSettings.autoRotate);
        setRotationSpeed(savedSettings.rotationSpeed);
        setMaxVisible(savedSettings.maxVisible);
      }
    } catch (err) {
      console.warn('Failed to load persisted data:', err);
    }
  }, []);

  // Persist settings
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        zineCache.set('settings', {
          template: currentTemplate,
          colorScheme,
          autoRotate,
          rotationSpeed,
          maxVisible,
        });
        zineCache.set('configs', displayConfigs);
        zineCache.set('integrations', integrations);
      } catch (err) {
        console.warn('Failed to persist settings:', err);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [currentTemplate, colorScheme, autoRotate, rotationSpeed, maxVisible, displayConfigs, integrations]);

  // Track container size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Auto-rotate templates
  useEffect(() => {
    if (!autoRotate) return;

    const rotate = () => {
      const currentIndex = TEMPLATES.indexOf(currentTemplate);
      const nextIndex = (currentIndex + 1) % TEMPLATES.length;
      setCurrentTemplate(TEMPLATES[nextIndex]);
      toast.info(`Template: ${TEMPLATES[nextIndex]}`);
    };

    rotationTimeoutRef.current = setTimeout(rotate, rotationSpeed);
    return () => {
      if (rotationTimeoutRef.current) clearTimeout(rotationTimeoutRef.current);
    };
  }, [autoRotate, currentTemplate, rotationSpeed]);

  // Fetch content from sources
  const fetchContent = useCallback(async (source: ContentSource, config?: any) => {
    try {
      let newItems: ContentItem[] = [];

      switch (source) {
        case 'rss': {
          const response = await fetch(`/api/zine/rss?url=${encodeURIComponent(config.url)}`);
          const data = await response.json();
          if (data.success) {
            newItems = data.items.map((item: any) => ({
              id: generateId(),
              type: 'text' as ContentType,
              source: 'rss' as ContentSource,
              title: item.title,
              content: item.content || item.description,
              metadata: {
                sourceUrl: item.link,
                author: item.author,
                rssFeed: config.url,
              },
              createdAt: Date.now(),
              priority: 'normal' as Priority,
              tags: item.categories || [],
              dedupHash: generateDedupHash(item.title, config.url),
            }));
          }
          break;
        }

        case 'webhook': {
          const response = await fetch('/api/zine/webhook');
          const data = await response.json();
          if (data.success) {
            newItems = data.items.map((item: any) => ({
              id: generateId(),
              type: item.type || 'text',
              source: 'webhook',
              title: item.title || '',
              content: item.content,
              media: item.media,
              metadata: {
                webhookEvent: item.event,
                customData: item.data,
              },
              createdAt: Date.now(),
              priority: item.priority || 'normal',
              tags: item.tags || [],
              dedupHash: generateDedupHash(item.content, 'webhook'),
            }));
          }
          break;
        }

        case 'api': {
          const response = await fetch(config.endpoint, {
            headers: config.headers || {},
          });
          const data = await response.json();
          newItems = parseApiResponse(data, config);
          break;
        }

        case 'integration': {
          const integration = integrations.find(i => i.id === config.integrationId);
          if (integration?.connected) {
            const response = await fetch(`/api/zine/integration/${integration.provider}`);
            const data = await response.json();
            if (data.success) {
              newItems = data.items.map((item: any) => ({
                id: generateId(),
                type: 'integration' as ContentType,
                source: 'oauth' as ContentSource,
                title: item.title || '',
                content: item.content,
                metadata: {
                  oauthProvider: integration.provider,
                  integrationId: integration.id,
                },
                createdAt: Date.now(),
                priority: 'normal' as Priority,
                tags: [],
                dedupHash: generateDedupHash(item.content, integration.provider),
              }));
            }
          }
          break;
        }

        case 'notification': {
          // Handled by notification system
          break;
        }
      }

      // Deduplicate
      const seenHashes = new Set(items.map(i => i.dedupHash));
      const uniqueItems = newItems.filter(item => {
        if (seenHashes.has(item.dedupHash)) return false;
        seenHashes.add(item.dedupHash);
        return true;
      });

      if (uniqueItems.length > 0) {
        setItems(prev => {
          const updated = [...uniqueItems, ...prev].slice(0, maxVisible * 2);
          // Cache seen hashes
          updated.forEach(item => {
            seenCache.set(item.dedupHash, { seen: Date.now() });
          });
          return updated;
        });
        toast.success(`Added ${uniqueItems.length} new items`);
      }

      return uniqueItems;
    } catch (err) {
      console.error('Fetch error:', err);
      return [];
    }
  }, [items, maxVisible, integrations]);

  // Parse API response
  const parseApiResponse = (data: any, config: any): ContentItem[] => {
    const items: ContentItem[] = [];
    const path = config.path || '';
    
    // Navigate to data array
    let dataArray = data;
    if (path) {
      dataArray = path.split('.').reduce((obj, key) => obj?.[key], data);
    }

    if (Array.isArray(dataArray)) {
      dataArray.forEach((item: any) => {
        items.push({
          id: generateId(),
          type: config.typeMapper?.(item) || 'text',
          source: 'api',
          title: config.titleField ? item[config.titleField] : '',
          content: config.contentField ? item[config.contentField] : JSON.stringify(item),
          media: config.mediaField ? item[config.mediaField] : undefined,
          metadata: {
            customData: item,
          },
          createdAt: Date.now(),
          priority: 'normal',
          tags: [],
          dedupHash: generateDedupHash(JSON.stringify(item), config.endpoint),
        });
      });
    }

    return items;
  };

  // Add manual content
  const addManualContent = useCallback((content: Partial<ContentItem>) => {
    const newItem: ContentItem = {
      id: generateId(),
      type: content.type || 'text',
      source: 'manual',
      title: content.title || '',
      content: content.content || '',
      media: content.media,
      metadata: content.metadata || {},
      style: content.style,
      position: content.position,
      createdAt: Date.now(),
      expiresAt: content.expiresAt,
      priority: content.priority || 'normal',
      tags: content.tags || [],
      dedupHash: generateDedupHash(content.content || '', 'manual'),
    };

    setItems(prev => [newItem, ...prev].slice(0, maxVisible * 2));
    toast.success('Content added');
  }, [maxVisible]);

  // Remove item
  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  // Clear all items
  const clearAll = useCallback(() => {
    setItems([]);
    toast.success('All content cleared');
  }, []);

  // Handle item click
  const handleItemClick = useCallback((item: ContentItem) => {
    if (item.metadata.sourceUrl) {
      window.open(item.metadata.sourceUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

  // Colors
  const colors = COLOR_SCHEMES[colorScheme];

  return (
    <ErrorBoundary>
      <div
        ref={containerRef}
        data-zine-container
        className={`relative w-full h-screen overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[9999]' : ''}`}
        style={{
          backgroundColor: colors.background,
          color: colors.text,
        }}
        onMouseMove={() => setShowControls(true)}
      >
        {/* Background Effects */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-cyan-500/5" />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        {/* Content Items */}
        <AnimatePresence>
          {items.slice(0, maxVisible).map((item) => (
            <ContentItemDisplay
              key={item.id}
              item={item}
              style={{
                template: currentTemplate,
                floating: currentTemplate === 'floating' || currentTemplate === 'scatter' || currentTemplate === 'orbit',
                rotation: currentTemplate === 'rotating' ? Math.random() * 360 : undefined,
                animation: currentTemplate === 'neon' ? 'glow' : currentTemplate === 'brutalist' ? 'shake' : 'fade',
                blendMode: currentTemplate === 'glassmorphic' ? 'screen' : 'normal',
              }}
              colors={colors}
              onClose={removeItem}
              onClick={handleItemClick}
              containerSize={containerSize}
            />
          ))}
        </AnimatePresence>

        {/* Empty State */}
        {items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-6"
            >
              <Aperture className="w-24 h-24 mx-auto opacity-20" />
              <h2 className="text-2xl font-bold">Zine Flow Engine</h2>
              <p className="opacity-60 max-w-md">
                An avant-garde content display system. Add content from RSS, webhooks, APIs, or integrations.
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <Button
                  onClick={() => addManualContent({
                    type: 'text',
                    title: 'Welcome',
                    content: 'This is your first zine item. Add more from various sources!',
                    priority: 'high',
                    tags: ['welcome', 'first'],
                  })}
                  className="bg-white/10 hover:bg-white/20"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Item
                </Button>
                <Button
                  onClick={() => setIsSettingsOpen(true)}
                  variant="outline"
                  className="border-white/20"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Configure Sources
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Control Bar */}
        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-0 left-0 right-0 z-50"
            >
              <div className="mx-4 mb-4 p-4 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  {/* Template Selector */}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => {
                        const idx = TEMPLATES.indexOf(currentTemplate);
                        setCurrentTemplate(TEMPLATES[(idx + 1) % TEMPLATES.length]);
                      }}
                      variant="ghost"
                      size="sm"
                      className="text-white/80"
                    >
                      <Rotate3D className="w-4 h-4 mr-2" />
                      {currentTemplate}
                    </Button>
                    <Button
                      onClick={() => setAutoRotate(!autoRotate)}
                      variant={autoRotate ? 'default' : 'ghost'}
                      size="sm"
                      className={autoRotate ? 'bg-purple-500/30' : 'text-white/60'}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Color Scheme */}
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-white/60" />
                    <select
                      value={colorScheme}
                      onChange={(e) => setColorScheme(e.target.value)}
                      className="bg-white/10 border border-white/20 rounded px-2 py-1 text-sm"
                    >
                      {Object.keys(COLOR_SCHEMES).map(scheme => (
                        <option key={scheme} value={scheme} className="bg-black">
                          {scheme}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => fetchContent('rss', { url: 'https://feeds.feedburner.com/techcrunch' })}
                      variant="ghost"
                      size="sm"
                      className="text-white/60"
                    >
                      <Rss className="w-4 h-4" />
                    </Button>
                    <Button
                      onClick={clearAll}
                      variant="ghost"
                      size="sm"
                      className="text-white/60"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button
                      onClick={() => setIsSettingsOpen(true)}
                      variant="ghost"
                      size="sm"
                      className="text-white/60"
                    >
                      <Settings className="w-4 h-4" />
                    </Button>
                    <Button
                      onClick={() => setIsFullscreen(!isFullscreen)}
                      variant="ghost"
                      size="sm"
                      className="text-white/60"
                    >
                      {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Panel */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-50 w-96 max-h-[80vh] overflow-auto"
            >
              <Card className="backdrop-blur-2xl bg-black/80 border-white/10">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Zine Settings</h3>
                    <Button
                      onClick={() => setIsSettingsOpen(false)}
                      variant="ghost"
                      size="icon"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Sources */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white/60">Content Sources</h4>
                    <div className="space-y-2">
                      <Button
                        onClick={() => {
                          const url = prompt('Enter RSS feed URL:');
                          if (url) fetchContent('rss', { url });
                        }}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start border-white/20"
                      >
                        <Rss className="w-4 h-4 mr-2" />
                        Add RSS Feed
                      </Button>
                      <Button
                        onClick={() => {
                          const endpoint = prompt('Enter API endpoint:');
                          if (endpoint) fetchContent('api', { endpoint });
                        }}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start border-white/20"
                      >
                        <Cloud className="w-4 h-4 mr-2" />
                        Add API Source
                      </Button>
                      <Button
                        onClick={() => {
                          toast.info('Webhook endpoint: /api/zine/webhook');
                          clipboard.writeText(`${window.location.origin}/api/zine/webhook`);
                        }}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start border-white/20"
                      >
                        <Webhook className="w-4 h-4 mr-2" />
                        Copy Webhook URL
                      </Button>
                    </div>
                  </div>

                  {/* Integrations */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white/60">Integrations</h4>
                    <div className="space-y-2">
                      {['discord', 'twitter', 'github', 'notion'].map(provider => (
                        <Button
                          key={provider}
                          variant="outline"
                          size="sm"
                          className="w-full justify-start border-white/20 capitalize"
                        >
                          <Key className="w-4 h-4 mr-2" />
                          Connect {provider}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Display Settings */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white/60">Display</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-white/40">Max Items: {maxVisible}</label>
                        <Slider
                          value={[maxVisible]}
                          min={5}
                          max={50}
                          step={5}
                          onValueChange={(v) => setMaxVisible(v[0])}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/40">Rotation Speed: {rotationSpeed / 1000}s</label>
                        <Slider
                          value={[rotationSpeed / 1000]}
                          min={5}
                          max={120}
                          step={5}
                          onValueChange={(v) => setRotationSpeed(v[0] * 1000)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Manual Content */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white/60">Add Content</h4>
                    <Button
                      onClick={() => {
                        const content = prompt('Enter content:');
                        if (content) {
                          addManualContent({
                            type: 'text',
                            content,
                            priority: 'normal',
                          });
                        }
                      }}
                      variant="outline"
                      size="sm"
                      className="w-full border-white/20"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Quick Add Text
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}

// Error Boundary
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-black">
          <Card className="bg-red-500/10 border-red-500/30 p-6">
            <CardContent className="text-center space-y-4">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
              <h3 className="text-lg font-semibold text-white">Zine Flow Error</h3>
              <Button onClick={() => this.setState({ hasError: false })} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
