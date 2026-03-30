"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Trash2,
  Sparkles,
  Type,
  FileJson,
  Link as LinkIcon,
  Rss,
  X,
  Shuffle,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  PenTool,
  Bell,
  BellOff,
  Settings2,
  Wifi,
  WifiOff,
  RefreshCw,
  LayoutGrid,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  type ZineFragment,
  type ZineTemplate,
  type ZoneConfig,
  type ZoneType,
  type FragmentType,
  type InputFormat,
  type DataSourceConfig,
  type NotificationItem,
  TEMPLATES,
  getTemplate,
  AutoStyler,
  NotificationEngine,
  DataSourceManager,
  SOURCE_PRESETS,
  SAMPLE_FRAGMENTS,
  ALL_ANIMATIONS,
  createFragment,
  generateStyle,
  generateAnimSeeds,
  getAnimationProps,
  pick,
  rand,
  getResponsiveGridTemplate,
  getZoneVisibility,
  getZoneColumns,
  getResponsiveGap,
  getResponsivePadding,
  getResponsiveFontScale,
  pluginRegistry,
  type DataSourcePlugin,
} from "./zine-engine";

// ---------------------------------------------------------------------------
// Responsive Layout Hook - Viewport-based fragment sizing
// ---------------------------------------------------------------------------

export type ViewportSize = 'mobile' | 'tablet' | 'desktop' | 'wide';

export interface ResponsiveConfig {
  size: ViewportSize;
  width: number;
  fontScale: number;
  maxWidth: number;
  zoneGap: number;
  padding: number;
  gridColumns: number;
  showLabels: boolean;
  animationDuration: number;
}

const VIEWPORT_BREAKPOINTS = {
  mobile: 0,
  tablet: 640,
  desktop: 1024,
  wide: 1440,
};

const RESPONSIVE_CONFIGS: Record<ViewportSize, Omit<ResponsiveConfig, 'size' | 'width'>> = {
  mobile: {
    fontScale: 0.65,
    maxWidth: 90,
    zoneGap: 4,
    padding: 8,
    gridColumns: 1,
    showLabels: false,
    animationDuration: 0.3,
  },
  tablet: {
    fontScale: 0.8,
    maxWidth: 85,
    zoneGap: 6,
    padding: 12,
    gridColumns: 2,
    showLabels: true,
    animationDuration: 0.5,
  },
  desktop: {
    fontScale: 1,
    maxWidth: 80,
    zoneGap: 8,
    padding: 16,
    gridColumns: 3,
    showLabels: true,
    animationDuration: 0.7,
  },
  wide: {
    fontScale: 1.15,
    maxWidth: 75,
    zoneGap: 12,
    padding: 20,
    gridColumns: 4,
    showLabels: true,
    animationDuration: 0.8,
  },
};

function getViewportSize(width: number): ViewportSize {
  if (width >= VIEWPORT_BREAKPOINTS.desktop) return 'wide';
  if (width >= VIEWPORT_BREAKPOINTS.tablet) return 'desktop';
  if (width >= VIEWPORT_BREAKPOINTS.mobile) return 'tablet';
  return 'mobile';
}

export function useResponsiveLayout() {
  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const size = getViewportSize(viewport.width);
  const baseConfig = RESPONSIVE_CONFIGS[size];

  const config: ResponsiveConfig = {
    size,
    width: viewport.width,
    ...baseConfig,
  };

  // Calculate aspect ratio adjustments
  const aspectRatio = viewport.width / viewport.height;
  const isPortrait = aspectRatio < 1;
  const isLandscape = aspectRatio > 1.5;

  // Adjust config based on aspect ratio
  if (isPortrait) {
    config.fontScale *= 0.85;
    config.gridColumns = Math.max(1, config.gridColumns - 1);
  } else if (isLandscape) {
    config.gridColumns = Math.min(4, config.gridColumns + 1);
  }

  // Store viewport size for template-specific scaling in component
  (config as ResponsiveConfig & { viewportSize: typeof size }).viewportSize = size;

  return config;
}

// Apply responsive scaling to fragment styles
export function applyResponsiveStyles(
  style: ZineFragment['style'],
  config: ResponsiveConfig,
  type: FragmentType,
): React.CSSProperties {
  const baseFontSize = style.fontSize * config.fontScale;
  
  // Type-specific responsive sizing
  const typeScales: Record<FragmentType, number> = {
    heading: 1,
    announcement: 0.95,
    quote: 0.9,
    text: 0.85,
    data: 0.75,
    notification: 0.8,
    whisper: 0.7,
    ticker: 0.75,
    media: 0.85,
  };

  const fontSize = baseFontSize * (typeScales[type] || 0.85);
  const maxWidth = type === 'heading' 
    ? `${config.maxWidth + 5}%` 
    : type === 'whisper' 
      ? `${config.maxWidth * 0.6}%` 
      : `${config.maxWidth}%`;

  return {
    fontSize: `${fontSize}px`,
    maxWidth,
    letterSpacing: `${style.letterSpacing * config.fontScale}px`,
    lineHeight: style.lineHeight,
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useNotificationEngine() {
  const engineRef = useRef<NotificationEngine | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const engine = new NotificationEngine();
    engineRef.current = engine;
    const unsub = engine.subscribe(setNotifications);
    return () => {
      unsub();
      engine.destroy();
    };
  }, []);

  const push = useCallback(
    (
      fragment: ZineFragment,
      duration?: number,
      position?: NotificationItem["position"],
    ) => {
      engineRef.current?.push(fragment, duration, position);
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    engineRef.current?.dismiss(id);
  }, []);

  const clearAll = useCallback(() => {
    engineRef.current?.clear();
  }, []);

  return { notifications, push, dismiss, clearAll };
}

// ---------------------------------------------------------------------------
// OAuth Notifications Hook - fetches real notifications from connected providers
// ---------------------------------------------------------------------------

interface FetchedNotification {
  id: string;
  content: string;
  type: string;
  source: string;
  author?: string;
  timestamp: string;
  url?: string;
  priority?: 'low' | 'normal' | 'high';
}

function useOAuthNotifications(
  pushNotification: (fragment: ZineFragment, duration?: number, position?: NotificationItem["position"]) => void,
  template: ZineTemplate,
  enabled: boolean,
) {
   const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
   const [isOAuthPolling, setIsOAuthPolling] = useState(false);
   const intervalRef = useRef<NodeJS.Timeout | null>(null);
   const lastFetchRef = useRef<number>(0);

  // Fetch connected OAuth providers on mount
  useEffect(() => {
    async function checkConnections() {
      try {
        const res = await fetch('/api/auth/oauth/connections');
        if (res.ok) {
          const data = await res.json();
          setConnectedProviders(data.connections || []);
        }
      } catch (err) {
        console.log('[Zine] Failed to check OAuth connections:', err);
      }
    }
    checkConnections();
  }, []);

   // Fetch notifications from API
   const fetchNotifications = useCallback(async () => {
     // Debounce to prevent rapid polling
     const now = Date.now();
     if (now - lastFetchRef.current < 5000) return;
     lastFetchRef.current = now;
 
     try {
       const res = await fetch('/api/zine-display/notifications');
       if (!res.ok) return;
 
       const data = await res.json();
       if (!data.success || !data.notifications) return;
 
       const notifs: FetchedNotification[] = data.notifications;
 
       // Convert to fragments and push as notifications
       for (const notif of notifs.slice(0, 3)) {
         const sourceIcons: Record<string, string> = {
           discord: '💬',
           gmail: '📧',
           slack: '💼',
           github: '🐙',
           twitter: '🐦',
         };
         const icon = sourceIcons[notif.source] || '📌';        const fragment = createFragment(
          `${icon} ${notif.content}`,
          'notification',
          (notif.source || 'manual') as any,
          notif.priority === 'high' ? 'drop' : 'fade-in',
          template,
          (notif.author || undefined) as any,
          { url: notif.url, timestamp: notif.timestamp },
        );
 
         pushNotification(fragment, 12000, 'top-right');
       }
     } catch (err) {
       console.log('[Zine] Notification fetch error:', err);
     }
   }, [pushNotification, template]);
 
   // Start/stop polling when enabled and has connected providers
   useEffect(() => {
     if (!enabled || connectedProviders.length === 0) {
       if (intervalRef.current) {
         clearInterval(intervalRef.current);
         intervalRef.current = null;
       }
       setIsOAuthPolling(false);
       return;
     }
 
     // Initial fetch
     fetchNotifications();
 
     // Poll every 30 seconds
     intervalRef.current = setInterval(fetchNotifications, 30000);
     setIsOAuthPolling(true);
 
     return () => {
       if (intervalRef.current) {
         clearInterval(intervalRef.current);
         intervalRef.current = null;
       }
     };
   }, [enabled, connectedProviders.length, fetchNotifications]);
 
   return { connectedProviders, isPolling: isOAuthPolling, fetchNow: fetchNotifications };
}

// ---------------------------------------------------------------------------
// SSE Hook - Real-time updates via Server-Sent Events
// ---------------------------------------------------------------------------

function useSSEStream(
  pushNotification: (fragment: ZineFragment, duration?: number, position?: NotificationItem["position"]) => void,
  template: ZineTemplate,
  channel: string = 'default',
  enabled: boolean,
) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<string>('');

  // Connect to SSE stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sseUrl = `/api/zine-display/sse?channel=${encodeURIComponent(channel)}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      setIsConnected(true);
      console.log('[Zine-SSE] Connected to channel:', channel);
    };

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        setLastEvent(message.timestamp);

        // Handle different event types
        if (message.event === 'notification' || message.event === 'data') {
          const fragment = createFragment(
            message.data.content || 'New update',
            message.data.type || 'text',
            message.data.source || 'sse',
            'fade-in',
            template,
            message.data.author,
            { url: message.data.url, timestamp: message.data.timestamp },
          );
          pushNotification(fragment, 15000, 'top-right');
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();

      // Attempt reconnect after 5 seconds
      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 5000);
      }
    };

    eventSourceRef.current = eventSource;
  }, [channel, template, enabled, pushNotification]);

  // Connect/disconnect based on enabled state
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      setIsConnected(false);
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, connect]);

  return { isConnected, lastEvent };
}

function useDataSources(
   template: ZineTemplate,
   onData: (fragments: ZineFragment[]) => void,
 ) {
   const managerRef = useRef<DataSourceManager | null>(null);
   const [sources, setSources] = useState<DataSourceConfig[]>([]);
   const [isDataSourcePolling, setIsDataSourcePolling] = useState(false);
   const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
   const onDataRef = useRef(onData);
   onDataRef.current = onData;
 
   useEffect(() => {
     const mgr = new DataSourceManager(
       (frags) => onDataRef.current(frags),
       template,
     );
     managerRef.current = mgr;
 
     // Load presets
     for (const preset of SOURCE_PRESETS) {
       mgr.addSource({ ...preset });
     }
     setSources(mgr.getSources());
 
     return () => {
       if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
       mgr.destroy();
     };
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);
 
   useEffect(() => {
     managerRef.current?.setTemplate(template);
   }, [template]);
 
   // Start/stop continuous polling for all enabled sources
   // Use ref to track polling state to avoid stale closure issues
   const isPollingRef = useRef(false);
   
   const togglePolling = useCallback(() => {
     if (isPollingRef.current) {
       if (pollingIntervalRef.current) {
         clearInterval(pollingIntervalRef.current);
         pollingIntervalRef.current = null;
       }
       isPollingRef.current = false;
       setIsDataSourcePolling(false);
     } else {
       // Poll every 30 seconds
       pollingIntervalRef.current = setInterval(() => {
         const enabledSources = managerRef.current?.getSources().filter(s => s.enabled) || [];
         for (const source of enabledSources) {
           managerRef.current?.fetchSource(source.id);
         }
       }, 30000);
       isPollingRef.current = true;
       setIsDataSourcePolling(true);
       // Initial fetch
       const enabledSources = managerRef.current?.getSources().filter(s => s.enabled) || [];
       for (const source of enabledSources) {
         managerRef.current?.fetchSource(source.id);
       }
     }
   }, []);
 
   const addSource = useCallback((config: DataSourceConfig) => {
     managerRef.current?.addSource(config);
     setSources(managerRef.current?.getSources() ?? []);
   }, []);
 
   const removeSource = useCallback((id: string) => {
     managerRef.current?.removeSource(id);
     setSources(managerRef.current?.getSources() ?? []);
   }, []);
 
   const toggleSource = useCallback((id: string) => {
     managerRef.current?.toggleSource(id);
     setSources(managerRef.current?.getSources() ?? []);
   }, []);
 
   const fetchNow = useCallback((id: string) => {
     managerRef.current?.fetchSource(id);
   }, []);
 
   return { sources, addSource, removeSource, toggleSource, fetchNow, isPolling: isDataSourcePolling, togglePolling };
 }

// ---------------------------------------------------------------------------
// FragmentRenderer — renders a single fragment
// ---------------------------------------------------------------------------

interface FragmentRendererProps {
  fragment: ZineFragment;
  index: number;
  onRemove: (id: string) => void;
  isPaused: boolean;
  template: ZineTemplate;
  bounded: boolean;
  responsiveConfig?: ResponsiveConfig;
}

function FragmentRenderer({
  fragment,
  index,
  onRemove,
  isPaused,
  template,
  bounded,
  responsiveConfig,
}: FragmentRendererProps) {
  const { style, animation, content, type, animSeeds } = fragment;
  const animProps = getAnimationProps(animation, index, animSeeds);

  const freezeTransition = { duration: 0 };
  const mergedAnim = isPaused
    ? {
        ...animProps,
        animate: {
          ...(typeof animProps.animate === "object" ? animProps.animate : {}),
          transition: freezeTransition,
        },
      }
    : animProps;

  if (bounded) {
    return (
      <BoundedFragmentCard
        fragment={fragment}
        index={index}
        onRemove={onRemove}
        mergedAnim={mergedAnim}
        template={template}
      />
    );
  }

  // Calculate responsive styles for unbounded fragments
  const responsiveStyles = responsiveConfig
    ? applyResponsiveStyles(style, responsiveConfig, type)
    : {};

  // Unbounded: absolute positioned floating text
  const inlineStyle: React.CSSProperties = {
    position: "absolute",
    left: `${style.x}%`,
    top: `${style.y}%`,
    transform: `rotate(${style.rotation}deg) scale(${style.scale})`,
    fontSize: responsiveStyles.fontSize ?? `${style.fontSize}px`,
    fontFamily: style.fontFamily,
    color: style.color,
    fontWeight: style.fontWeight,
    letterSpacing: responsiveStyles.letterSpacing ?? `${style.letterSpacing}px`,
    lineHeight: responsiveStyles.lineHeight ?? style.lineHeight,
    textTransform: style.textTransform,
    textAlign: style.textAlign,
    zIndex: style.zIndex,
    maxWidth: responsiveStyles.maxWidth ?? (type === "heading" ? "80%" : type === "whisper" ? "50%" : "60%"),
    mixBlendMode: style.mixBlendMode as React.CSSProperties["mixBlendMode"],
    pointerEvents: "auto",
    cursor: "default",
    userSelect: "text",
    wordBreak: "break-word",
  };

  if (template.id === "chalkboard") {
    inlineStyle.textShadow =
      "0 0 8px rgba(255,255,255,0.15), 0 0 2px rgba(255,255,255,0.3)";
  }
  if (template.id === "neon-board") {
    inlineStyle.textShadow = `0 0 10px ${style.color}, 0 0 20px ${style.color}40`;
  }

  return (
    <motion.div
      layout
      {...mergedAnim}
      style={inlineStyle}
      className="group"
      whileHover={{ scale: ((style.scale || 1) * (responsiveConfig?.fontScale ?? 1)) * 1.05, zIndex: 999 }}
    >
      <span className="relative">{content}</span>
      {fragment.author && (
        <span className="block text-[9px] mt-0.5 opacity-40">
          — {fragment.author}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(fragment.id);
        }}
        className="absolute -top-2 -right-4 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity text-white/40 hover:text-red-400 p-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// BoundedFragmentCard — for bounded/card display within zones
// ---------------------------------------------------------------------------

interface BoundedCardProps {
  fragment: ZineFragment;
  index: number;
  onRemove: (id: string) => void;
  mergedAnim: Record<string, unknown>;
  template: ZineTemplate;
}

function BoundedFragmentCard({
  fragment,
  index,
  onRemove,
  mergedAnim,
  template,
}: BoundedCardProps) {
  const { style, content, type } = fragment;
  const isMessageBoard = template.id === "message-board";
  const isRSSFeed = template.id === "rss-feed";
  const isNotifStream = template.id === "notification-stream";

  let cardClass =
    "relative group p-3 rounded-lg transition-all hover:z-50 ";

  if (isMessageBoard) {
    const noteBgs = [
      "bg-yellow-200/90",
      "bg-blue-200/80",
      "bg-pink-200/80",
      "bg-green-200/80",
      "bg-orange-200/85",
    ];
    cardClass += `${pick(noteBgs)} shadow-md `;
    cardClass += `transform rotate-[${fragment.style.rotation}deg] `;
  } else if (isRSSFeed) {
    cardClass += "bg-white/5 border border-white/10 hover:bg-white/10 ";
  } else if (isNotifStream) {
    cardClass +=
      "border-l-2 border-white/15 pl-3 bg-white/[0.03] hover:bg-white/[0.06] ";
  } else {
    cardClass += "bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] ";
  }

  const textColor = isMessageBoard
    ? template.palette.text
    : style.color;

  return (
    <motion.div layout {...mergedAnim} className={cardClass}>
      <div
        style={{
          fontSize: Math.min(style.fontSize, type === "heading" ? 28 : 16) + "px",
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing + "px",
          lineHeight: style.lineHeight,
          textTransform: style.textTransform,
          color: textColor,
        }}
      >
        {type === "heading" && (
          <div
            className="text-[9px] uppercase tracking-widest mb-1"
            style={{ color: template.palette.accent, opacity: 0.7 }}
          >
            {fragment.source === "rss" ? "RSS" : "HEADLINE"}
          </div>
        )}
        <span>{content}</span>
      </div>

      {(fragment.author || fragment.timestamp) && (
        <div
          className="flex items-center gap-2 mt-1.5 text-[10px]"
          style={{ color: template.palette.muted }}
        >
          {fragment.author && <span>{fragment.author}</span>}
          {fragment.author && fragment.timestamp && <span>·</span>}
          {fragment.timestamp && <span>{fragment.timestamp}</span>}
        </div>
      )}

      {fragment.url && (
        <a
          href={fragment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] mt-1 inline-block hover:underline"
          style={{ color: template.palette.accent }}
          onClick={(e) => e.stopPropagation()}
        >
          ↗ Open link
        </a>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(fragment.id);
        }}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity p-0.5"
        style={{ color: isMessageBoard ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.3)" }}
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// ContentZone — renders a layout zone (bounded or unbounded)
// ---------------------------------------------------------------------------

interface ContentZoneProps {
  zone: ZoneConfig;
  fragments: ZineFragment[];
  onRemove: (id: string) => void;
  isPaused: boolean;
  template: ZineTemplate;
  responsiveConfig?: ResponsiveConfig;
}

function ContentZone({
  zone,
  fragments,
  onRemove,
  isPaused,
  template,
  responsiveConfig,
}: ContentZoneProps) {
  const isBounded = zone.bordered || template.displayMode === "bounded";
  const isUnbounded = !isBounded && (template.displayMode === "unbounded" || zone.type === "floating");

  if (isUnbounded) {
    // Unbounded zone — fragments float freely
    const zoneStyle: React.CSSProperties = zone.bounds
      ? {
          position: "absolute",
          left: `${zone.bounds.x}%`,
          top: `${zone.bounds.y}%`,
          width: `${zone.bounds.w}%`,
          height: `${zone.bounds.h}%`,
        }
      : { position: "absolute", inset: 0 };

    return (
      <div style={{ ...zoneStyle, overflow: zone.overflow, pointerEvents: "none" }}>
        <AnimatePresence mode="popLayout">
          {fragments.map((frag, i) => (
            <FragmentRenderer
              key={frag.id}
              fragment={frag}
              index={i}
              onRemove={onRemove}
              isPaused={isPaused}
              template={template}
              bounded={false}
              responsiveConfig={(template as any).fragmentConfig}
            />
          ))}
        </AnimatePresence>
      </div>
    );
  }

  // Bounded zone — fragments in scrollable container
  return (
    <div
      className="relative flex flex-col h-full overflow-hidden"
      style={{ gridArea: zone.gridArea }}
    >
      {zone.label && (
        <div
          className="shrink-0 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] font-medium border-b"
          style={{
            color: template.palette.accent,
            borderColor: `${template.palette.muted}40`,
            opacity: 0.7,
          }}
        >
          {zone.label}
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          <AnimatePresence mode="popLayout">
            {fragments.map((frag, i) => (
              <FragmentRenderer
                key={frag.id}
                fragment={frag}
                index={i}
                onRemove={onRemove}
                isPaused={isPaused}
                template={template}
                bounded={true}
                responsiveConfig={(template as any).fragmentConfig}
              />
            ))}
          </AnimatePresence>
          {fragments.length === 0 && (
            <div
              className="text-center py-6 text-[10px]"
              style={{ color: template.palette.muted }}
            >
              Empty zone — add content
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationOverlay — independent floating notification layer
// ---------------------------------------------------------------------------

interface NotificationOverlayProps {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
}

function NotificationOverlay({
  notifications,
  onDismiss,
}: NotificationOverlayProps) {
  if (notifications.length === 0) return null;

  const positionMap: Record<string, string> = {
    "top-left": "top-3 left-3",
    "top-right": "top-3 right-3",
    "bottom-left": "bottom-3 left-3",
    "bottom-right": "bottom-3 right-3",
    center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-[999]">
      {notifications.slice(-8).map((notif, idx) => {
        const pos =
          notif.position === "random"
            ? pick(Object.keys(positionMap) as (keyof typeof positionMap)[])
            : notif.position;
        const posClass = positionMap[pos] ?? "top-3 right-3";
        const offsetY = idx * 56;

        return (
          <motion.div
            key={notif.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: offsetY, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={`absolute ${posClass} pointer-events-auto max-w-xs`}
          >
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-black/80 backdrop-blur-md border border-white/15 shadow-xl">
              <Bell className="w-3 h-3 mt-0.5 shrink-0 text-white/50" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/90 leading-snug truncate">
                  {notif.fragment.content}
                </p>
                {notif.fragment.author && (
                  <p className="text-[9px] text-white/40 mt-0.5">
                    {notif.fragment.author}
                  </p>
                )}
              </div>
              <button
                onClick={() => onDismiss(notif.id)}
                className="shrink-0 text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugin Configuration Form — for custom data source plugins
// ---------------------------------------------------------------------------

interface PluginConfigFormProps {
  plugin: DataSourcePlugin;
  onSubmit: (config: DataSourceConfig) => void;
  onCancel: () => void;
}

function PluginConfigForm({ plugin, onSubmit, onCancel }: PluginConfigFormProps) {
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (plugin.configSchema) {
      for (const [key, field] of Object.entries(plugin.configSchema)) {
        initial[key] = field.default !== undefined ? String(field.default) : '';
      }
    }
    return initial;
  });
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSubmit = () => {
    // Validate required fields
    if (plugin.configSchema) {
      for (const [key, field] of Object.entries(plugin.configSchema)) {
        if (field.required && !formData[key]?.trim()) {
          toast.error(`${key} is required`);
          return;
        }
      }
    }

    // Store full plugin config in transform field for the plugin to use
    const config: DataSourceConfig = {
      id: crypto.randomUUID(),
      type: 'api',
      name: `${plugin.icon} ${plugin.name}`,
      enabled: true,
      url: formData.url || formData.endpoint || undefined,
      pollIntervalMs: parseInt(formData.pollIntervalMs) || 60000,
      // Serialize full plugin config including plugin ID for plugin registry to use
      transform: JSON.stringify({
        _pluginId: plugin.id,
        ...formData,
      }),
    };

    onSubmit(config);
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      if (plugin.test) {
        const mockConfig: DataSourceConfig = {
          id: 'test',
          type: 'api',
          name: 'Test',
          enabled: true,
          url: formData.url || formData.endpoint,
          pollIntervalMs: 60000,
        };
        const result = await plugin.test(mockConfig);
        setTestResult({
          success: result,
          message: result ? 'Connection successful!' : 'Connection failed',
        });
      } else {
        setTestResult({
          success: true,
          message: 'Plugin does not support connection testing',
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="p-3 rounded-md bg-white/[0.03] border border-white/[0.08] space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{plugin.icon}</span>
        <div>
          <span className="text-xs font-medium text-white/80">{plugin.name}</span>
          <span className="text-[9px] text-white/30 ml-2">v{plugin.version}</span>
        </div>
      </div>

      <p className="text-[9px] text-white/40">{plugin.description}</p>

      {plugin.configSchema && Object.keys(plugin.configSchema).length > 0 && (
        <div className="space-y-2">
          {Object.entries(plugin.configSchema).map(([key, field]) => (
            <div key={key}>
              <label className="text-[9px] text-white/50 uppercase tracking-wider flex items-center gap-1">
                {key}
                {field.required && <span className="text-red-400">*</span>}
              </label>
              {field.type === 'object' ? (
                <Textarea
                  value={formData[key] || ''}
                  onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                  placeholder='{"key": "value"}'
                  className="h-16 text-[10px] bg-black/30 border-white/10 text-white/80 placeholder:text-white/20 font-mono"
                />
              ) : (
                <Input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={formData[key] || ''}
                  onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                  placeholder={field.default !== undefined ? String(field.default) : key}
                  className="h-6 text-[10px] bg-black/30 border-white/10 text-white/80 placeholder:text-white/20"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <div className={`text-[9px] px-2 py-1 rounded ${testResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {testResult.message}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTest}
          disabled={isTesting}
          className="h-6 text-[9px] text-white/40"
        >
          {isTesting ? 'Testing...' : 'Test Connection'}
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-6 text-[9px] text-white/30"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          className="h-6 text-[9px] bg-white/10 hover:bg-white/15 text-white/70 border border-white/10"
        >
          Add Plugin
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PluginSelector — Choose from available plugins
// ---------------------------------------------------------------------------

interface PluginSelectorProps {
  onSelect: (plugin: DataSourcePlugin) => void;
  onCancel: () => void;
}

function PluginSelector({ onSelect, onCancel }: PluginSelectorProps) {
  const plugins = pluginRegistry.list();

  return (
    <div className="p-3 rounded-md bg-white/[0.03] border border-white/[0.08] space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium">
          Select Plugin
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-5 text-[9px] text-white/30"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {plugins.map((plugin) => (
          <button
            key={plugin.id}
            onClick={() => onSelect(plugin)}
            className="p-2 rounded-md bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/10 transition-all text-left"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{plugin.icon}</span>
              <span className="text-[10px] font-medium text-white/70">{plugin.name}</span>
            </div>
            <p className="text-[8px] text-white/30 line-clamp-2">{plugin.description}</p>
          </button>
        ))}
      </div>

      <div className="pt-2 border-t border-white/[0.06]">
        <p className="text-[8px] text-white/25 text-center">
          Custom plugins can be registered via the plugin API
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceManagerPanel — UI for managing data sources with plugin support
// ---------------------------------------------------------------------------

interface SourceManagerPanelProps {
  sources: DataSourceConfig[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onFetch: (id: string) => void;
  onAdd: (config: DataSourceConfig) => void;
}

function SourceManagerPanel({
  sources,
  onToggle,
  onRemove,
  onFetch,
  onAdd,
}: SourceManagerPanelProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newType, setNewType] = useState<DataSourceConfig["type"]>("rss");
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<DataSourcePlugin | null>(null);

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAdd({
      id: crypto.randomUUID(),
      type: newType,
      name: newName,
      enabled: true,
      url: newUrl || undefined,
      rssSource: newType === "rss" && !newUrl ? "hn" : undefined,
      pollIntervalMs: 60000,
    });
    setNewName("");
    setNewUrl("");
    setShowAddForm(false);
    toast.success("Source added");
  };

  const handlePluginSelect = (plugin: DataSourcePlugin) => {
    setSelectedPlugin(plugin);
    setShowPluginSelector(false);
  };

  const handlePluginSubmit = (config: DataSourceConfig) => {
    onAdd(config);
    setSelectedPlugin(null);
    toast.success(`${config.name} added`);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium">
          Data Sources
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPluginSelector(true)}
            className="h-5 text-[10px] text-purple-400 hover:text-purple-300 px-1.5"
            title="Add custom plugin"
          >
            <Layers className="w-2.5 h-2.5 mr-1" />
            Plugins
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="h-5 text-[10px] text-white/40 hover:text-white/70 px-1.5"
          >
            <Plus className="w-2.5 h-2.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Plugin selector dropdown */}
      {showPluginSelector && (
        <PluginSelector
          onSelect={handlePluginSelect}
          onCancel={() => setShowPluginSelector(false)}
        />
      )}

      {/* Plugin configuration form */}
      {selectedPlugin && (
        <PluginConfigForm
          plugin={selectedPlugin}
          onSubmit={handlePluginSubmit}
          onCancel={() => setSelectedPlugin(null)}
        />
      )}

      {/* Basic source add form */}
      {showAddForm && !selectedPlugin && !showPluginSelector && (
        <div className="p-2 rounded-md bg-white/[0.03] border border-white/[0.06] space-y-2">
          <div className="flex items-center gap-1">
            {(["rss", "webhook", "api", "url", "local"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
                  newType === t
                    ? "bg-white/15 text-white"
                    : "text-white/30 hover:text-white/60"
                }`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Source name"
            className="h-6 text-[10px] bg-black/30 border-white/10 text-white/80 placeholder:text-white/20"
          />
          <Input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={newType === "rss" ? "RSS feed URL (or leave blank for HN)" : "Endpoint URL"}
            className="h-6 text-[10px] bg-black/30 border-white/10 text-white/80 placeholder:text-white/20"
          />
          <div className="flex gap-1 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddForm(false)}
              className="h-5 text-[9px] text-white/30"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="h-5 text-[9px] bg-white/10 hover:bg-white/15 text-white/70 border border-white/10"
            >
              Add Source
            </Button>
          </div>
        </div>
      )}

      {/* Sources list - separated by type */}
      <div className="space-y-1">
        {sources.map((src) => (
          <div
            key={src.id}
            className="flex items-center justify-between px-2 py-1 rounded-md bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => onToggle(src.id)}
                className="shrink-0"
                title={src.enabled ? "Disable" : "Enable"}
              >
                {src.enabled ? (
                  <Wifi className="w-3 h-3 text-green-400/70" />
                ) : (
                  <WifiOff className="w-3 h-3 text-white/20" />
                )}
              </button>
              <div className="min-w-0">
                <span className="text-[10px] text-white/70 truncate block">
                  {src.name}
                </span>
                <span className="text-[8px] text-white/25">
                  {src.type.toUpperCase()}
                  {src.lastFetchedAt
                    ? ` · ${Math.round((Date.now() - src.lastFetchedAt) / 1000)}s ago`
                    : ""}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onFetch(src.id)}
                className="p-0.5 text-white/20 hover:text-white/60 transition-colors"
                title="Fetch now"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
              <button
                onClick={() => onRemove(src.id)}
                className="p-0.5 text-white/20 hover:text-red-400/60 transition-colors"
                title="Remove"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Plugin usage hint */}
      <div className="pt-2 border-t border-white/[0.06]">
        <p className="text-[8px] text-white/25 text-center">
          <span className="text-purple-400">Pro tip:</span> Use Plugins for REST API, WebSocket, GraphQL, Database, or Custom JS
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TemplateSelector — visual template picker
// ---------------------------------------------------------------------------

interface TemplateSelectorProps {
  activeId: string;
  onChange: (id: string) => void;
}

function TemplateSelector({ activeId, onChange }: TemplateSelectorProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all flex items-center gap-1 ${
            activeId === t.id
              ? "bg-white/15 text-white shadow-sm"
              : "text-white/35 hover:text-white/65 hover:bg-white/5"
          }`}
          title={`${t.name} — ${t.displayMode}`}
        >
          <span>{t.emoji}</span>
          <span className="hidden sm:inline">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InputPanel — enhanced content input with multiple formats
// ---------------------------------------------------------------------------

interface InputPanelProps {
  onAdd: (fragments: ZineFragment[]) => void;
  onNotify: (fragment: ZineFragment) => void;
  template: ZineTemplate;
}

function InputPanel({ onAdd, onNotify, template }: InputPanelProps) {
  const [inputText, setInputText] = useState("");
  const [inputFormat, setInputFormat] = useState<InputFormat>("text");
  const [isExpanded, setIsExpanded] = useState(false);
  const [sendAsNotification, setSendAsNotification] = useState(false);

  const handleAdd = useCallback(() => {
    if (!inputText.trim()) return;

    try {
      let fragments: ZineFragment[];
      if (inputFormat === "json") {
        fragments = AutoStyler.parseJsonInput(inputText, template);
      } else if (inputFormat === "url") {
        const url = inputText.trim();
        fragments = [
          createFragment(
            `📡 ${url}`,
            "data",
            "url",
            "slide-left",
            template,
            undefined,
            { url },
          ),
        ];
      } else if (inputFormat === "rss") {
        fragments = [
          createFragment(
            `Loading RSS: ${inputText.trim()}...`,
            "data",
            "rss",
            "typewriter",
            template,
          ),
        ];
        // Trigger async RSS fetch
        fetch(`/api/news/rss?url=${encodeURIComponent(inputText.trim())}&limit=10`)
          .then((r) => r.json())
          .then((data) => {
            if (data.articles?.length) {
              const rssFrags = AutoStyler.transformRSSItems(
                data.articles,
                template,
              );
              onAdd(rssFrags);
              toast.success(`+${rssFrags.length} from RSS`);
            }
          })
          .catch(() => toast.error("RSS fetch failed"));
      } else {
        fragments = AutoStyler.autoFragment(inputText, "manual", template);
      }

      if (fragments.length === 0) {
        toast.error("No content to add");
        return;
      }

      if (sendAsNotification) {
        for (const frag of fragments) onNotify(frag);
        toast.success(`${fragments.length} notification(s) sent`);
      } else {
        onAdd(fragments);
        toast.success(
          `+${fragments.length} fragment${fragments.length > 1 ? "s" : ""}`,
        );
      }
      setInputText("");
    } catch (err) {
      toast.error(
        "Parse error: " +
          (err instanceof Error ? err.message : "Invalid input"),
      );
    }
  }, [inputText, inputFormat, template, onAdd, onNotify, sendAsNotification]);

  const placeholders: Record<InputFormat, string> = {
    text: "Type anything — prefix with # (heading), > (quote), ! (announcement), ~ (whisper), $ (data), 🔔 (notification), >>> (ticker)\nMultiple lines → multiple fragments",
    json: '[{"content": "hello", "type": "heading", "author": "zine-bot"}]',
    url: "https://example.com/api/feed.json",
    rss: "https://hnrss.org/frontpage",
  };

  return (
    <div className="shrink-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 bg-white/[0.03] hover:bg-white/[0.06] border-t border-white/[0.06] transition-colors"
      >
        <span className="flex items-center gap-2 text-xs text-white/50">
          <PenTool className="w-3 h-3" />
          Add Content
        </span>
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-white/40" />
        ) : (
          <ChevronUp className="w-3 h-3 text-white/40" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/[0.06] bg-black/40"
          >
            <div className="p-3 space-y-2">
              {/* Format toggle */}
              <div className="flex items-center gap-1">
                {(["text", "json", "url", "rss"] as InputFormat[]).map(
                  (fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setInputFormat(fmt)}
                      className={`px-2.5 py-1 text-[10px] rounded-md transition-all flex items-center gap-1 ${
                        inputFormat === fmt
                          ? "bg-white/15 text-white"
                          : "text-white/40 hover:text-white/70 hover:bg-white/5"
                      }`}
                    >
                      {fmt === "json" && <FileJson className="w-2.5 h-2.5" />}
                      {fmt === "text" && <Type className="w-2.5 h-2.5" />}
                      {fmt === "url" && <LinkIcon className="w-2.5 h-2.5" />}
                      {fmt === "rss" && <Rss className="w-2.5 h-2.5" />}
                      {fmt.toUpperCase()}
                    </button>
                  ),
                )}

                <div className="flex-1" />

                {/* Notification toggle */}
                <button
                  onClick={() => setSendAsNotification(!sendAsNotification)}
                  className={`px-2 py-1 text-[10px] rounded-md flex items-center gap-1 transition-all ${
                    sendAsNotification
                      ? "bg-purple-500/20 text-purple-300 border border-purple-400/30"
                      : "text-white/30 hover:text-white/60"
                  }`}
                  title="Send as floating notification"
                >
                  {sendAsNotification ? (
                    <Bell className="w-2.5 h-2.5" />
                  ) : (
                    <BellOff className="w-2.5 h-2.5" />
                  )}
                  Notify
                </button>
              </div>

              {/* Input */}
              {inputFormat === "url" || inputFormat === "rss" ? (
                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  placeholder={placeholders[inputFormat]}
                  className="h-8 text-xs bg-black/30 border-white/10 text-white/90 placeholder:text-white/20 font-mono"
                />
              ) : (
                <Textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={placeholders[inputFormat]}
                  className="min-h-[72px] max-h-[120px] text-xs bg-black/30 border-white/10 text-white/90 placeholder:text-white/20 font-mono resize-none"
                />
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsExpanded(false);
                    setInputText("");
                  }}
                  className="h-7 text-xs text-white/40"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={!inputText.trim()}
                  className="h-7 text-xs bg-white/10 hover:bg-white/15 border border-white/10 text-white/80"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  {sendAsNotification ? "Notify" : "Drop In"}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template overlays (visual textures per template)
// ---------------------------------------------------------------------------

function TemplateOverlay({ template }: { template: ZineTemplate }) {
  switch (template.id) {
    case "chalkboard":
      return (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
      );
    case "punk-zine":
      return (
        <>
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent, transparent 40px, rgba(255,255,255,0.5) 40px, rgba(255,255,255,0.5) 41px)",
            }}
          />
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.02]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, white 2px, transparent 2px), radial-gradient(circle at 70% 60%, white 1px, transparent 1px), radial-gradient(circle at 45% 80%, white 3px, transparent 3px)",
            }}
          />
        </>
      );
    case "data-terminal":
      return (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(0deg, transparent 95%, rgba(100,255,180,0.3) 95%)",
            backgroundSize: "100% 30px",
          }}
        />
      );
    case "neon-board":
      return (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 30% 20%, rgba(255,50,200,0.15), transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(50,255,200,0.1), transparent 50%)",
          }}
        />
      );
    case "art-deco":
      return (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent, transparent 80px, rgba(200,170,100,0.3) 80px, rgba(200,170,100,0.3) 81px)",
          }}
        />
      );
    case "newspaper":
      return (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 18px, rgba(240,235,220,0.4) 18px, rgba(240,235,220,0.4) 19px)",
          }}
        />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ZineDisplayTab() {
  const [fragments, setFragments] = useState<ZineFragment[]>([]);
  const [templateId, setTemplateId] = useState("freeform");
  const [isPaused, setIsPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const template = getTemplate(templateId);
  const { notifications, push: pushNotification, dismiss: dismissNotification, clearAll: clearNotifications } = useNotificationEngine();

  // Responsive layout configuration
  const responsiveConfig = useResponsiveLayout();
  
  // Get responsive grid template from engine
  const responsiveGridTemplate = template.gridTemplate ? getResponsiveGridTemplate(template, responsiveConfig.size) : undefined;
  const zoneVisibility = getZoneVisibility(template, responsiveConfig.size);
  const zoneColumns = getZoneColumns(responsiveConfig.size);
  const responsiveGap = getResponsiveGap(template, responsiveConfig.size);
  const responsivePadding = getResponsivePadding(template, responsiveConfig.size);
  
  // Get template-specific font scale factor (templates with large decorative fonts need scaling)
  const templateFontScale = getResponsiveFontScale(template, responsiveConfig.size);
  
  // Combine base config font scale with template-specific scale
  // Use weighted blend: base scale provides viewport baseline, template scale adjusts for decorative fonts
  // This avoids double-scaling that would make fonts too small on mobile
  const combinedFontScale = responsiveConfig.fontScale * 0.7 + templateFontScale * 0.3;
  
  // Create modified config for fragment rendering with combined font scale
  const fragmentConfig = { ...responsiveConfig, fontScale: combinedFontScale };

  // OAuth notifications - fetch from connected providers
  const [oauthNotificationsEnabled, setOauthNotificationsEnabled] = useState(false);
  const { connectedProviders, isPolling: oauthIsPolling, fetchNow: fetchOAuthNotifications } = useOAuthNotifications(
    pushNotification,
    template,
    oauthNotificationsEnabled,
  );

  // SSE real-time stream
  const [sseEnabled, setSseEnabled] = useState(false);
  const { isConnected: sseConnected, lastEvent } = useSSEStream(
    pushNotification,
    template,
    'default',
    sseEnabled,
  );

  const addFragments = useCallback(
    (newFragments: ZineFragment[]) => {
      setFragments((prev) => {
        const combined = [...prev, ...newFragments];
        return combined.slice(-template.maxVisible);
      });
    },
    [template.maxVisible],
  );

  const { sources, addSource, removeSource, toggleSource, fetchNow, isPolling: sourceIsPolling, togglePolling } =
    useDataSources(template, addFragments);

  // Load sample content on first mount
  useEffect(() => {
    const initial = SAMPLE_FRAGMENTS.map((frag) =>
      createFragment(
        frag.content,
        frag.type,
        frag.source,
        frag.animation,
        getTemplate("freeform"),
      ),
    );
    setFragments(initial);
  }, []);

  const removeFragment = useCallback((id: string) => {
    setFragments((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setFragments([]);
    clearNotifications();
    toast.success("Canvas cleared");
  }, [clearNotifications]);

  const reshufflePositions = useCallback(() => {
    setFragments((prev) =>
      prev.map((f) => ({
        ...f,
        style: generateStyle(f.type, template, f.zone),
        animation: pick(ALL_ANIMATIONS),
        animSeeds: generateAnimSeeds(),
      })),
    );
    toast.success("Reshuffled");
  }, [template]);

  const changeTemplate = useCallback(
    (newId: string) => {
      const newTemplate = getTemplate(newId);
      setTemplateId(newId);
      setFragments((prev) =>
        prev.map((f) => {
          const newZone = f.zone ? f.zone : undefined;
          return {
            ...f,
            style: generateStyle(f.type, newTemplate, newZone),
            zone: newZone,
          };
        }),
      );
    },
    [],
  );

  const handleNotify = useCallback(
    (fragment: ZineFragment) => {
      pushNotification(fragment, 8000, "top-right");
    },
    [pushNotification],
  );

  const exportFragments = useCallback(() => {
    const blob = new Blob([JSON.stringify(fragments, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zine-${templateId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported");
  }, [fragments, templateId]);

  const handleFileImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result as string;
          const imported = JSON.parse(text) as ZineFragment[];
          if (Array.isArray(imported)) {
            setFragments((prev) =>
              [...prev, ...imported].slice(-template.maxVisible),
            );
            toast.success(`Imported ${imported.length} fragments`);
          }
        } catch {
          toast.error("Invalid import file");
        }
      };
      reader.readAsText(file);
    },
    [template.maxVisible],
  );

  // Group fragments by zone for bounded templates
  const fragmentsByZone = groupByZone(fragments, template);

  const isBoundedTemplate =
    template.displayMode === "bounded" ||
    template.displayMode === "hybrid";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Controls bar */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 border-b border-white/[0.06] bg-gradient-to-r from-purple-500/[0.03] via-transparent to-cyan-500/[0.03] overflow-hidden"
          >
            <div className="p-3 space-y-2">
              {/* Top row: title + actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: [0, 5, -5, 0] }}
                    transition={{
                      duration: 4,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <Sparkles className="w-4 h-4 text-purple-400" />
                  </motion.div>
                  <span className="text-xs font-bold text-white/80 tracking-wider uppercase">
                    Zine Display
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[9px] bg-white/5 text-white/40 border border-white/10 px-1.5 py-0"
                  >
                    {fragments.length}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-[8px] bg-purple-500/10 text-purple-300/60 border border-purple-400/20 px-1.5 py-0"
                  >
                    {template.emoji} {template.name}
                  </Badge>
                  {/* Viewport size indicator */}
                  <Badge
                    variant="secondary"
                    className={`text-[8px] px-1.5 py-0 ${
                      responsiveConfig.size === 'mobile' ? 'bg-orange-500/10 text-orange-400/70 border border-orange-400/20' :
                      responsiveConfig.size === 'tablet' ? 'bg-yellow-500/10 text-yellow-400/70 border border-yellow-400/20' :
                      responsiveConfig.size === 'desktop' ? 'bg-green-500/10 text-green-400/70 border border-green-400/20' :
                      'bg-blue-500/10 text-blue-400/70 border border-blue-400/20'
                    }`}
                  >
                    {responsiveConfig.size.toUpperCase()}
                  </Badge>
                </div>

                <div className="flex items-center gap-1">
                  {/* OAuth Notifications Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOauthNotificationsEnabled(!oauthNotificationsEnabled)}
                    className={`h-6 w-6 p-0 ${
                      oauthNotificationsEnabled
                        ? "text-green-400"
                        : "text-white/40 hover:text-white/80"
                    }`}
                    title={oauthNotificationsEnabled ? "OAuth Notifications ON (click to disable)" : "Enable OAuth Notifications (Discord, Gmail, Slack, GitHub)"}
                  >
                    <Bell className={`w-3 h-3 ${oauthIsPolling ? 'animate-pulse' : ''}`} />
                  </Button>
                  {oauthNotificationsEnabled && connectedProviders.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[8px] h-4 px-1 bg-green-500/10 text-green-400/70 border border-green-400/20"
                    >
                      {connectedProviders.length} connected
                    </Badge>
                  )}
                  {/* SSE Real-time Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSseEnabled(!sseEnabled)}
                    className={`h-6 w-6 p-0 ${
                      sseConnected
                        ? "text-amber-400"
                        : "text-white/40 hover:text-white/80"
                    }`}
                    title={sseEnabled ? "SSE Connected (click to disconnect)" : "Enable SSE for real-time push"}
                  >
                    <Wifi className={`w-3 h-3 ${sseConnected ? 'animate-pulse' : ''}`} />
                  </Button>
                  {sseConnected && (
                    <Badge
                      variant="secondary"
                      className="text-[8px] h-4 px-1 bg-amber-500/10 text-amber-400/70 border border-amber-400/20"
                    >
                      LIVE
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={togglePolling}
                    className={`h-6 w-6 p-0 ${
                      sourceIsPolling
                        ? "text-cyan-400"
                        : "text-white/40 hover:text-white/80"
                    }`}
                    title={sourceIsPolling ? "Stop polling" : "Start continuous polling (30s interval)"}
                  >
                    <RefreshCw className={`w-3 h-3 ${sourceIsPolling ? 'animate-spin' : ''}`} />
                  </Button>
                  {sourceIsPolling && (
                    <Badge
                      variant="secondary"
                      className="text-[8px] h-4 px-1 bg-cyan-500/10 text-cyan-400/70 border border-cyan-400/20"
                    >
                      POLL
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSources(!showSources)}
                    className={`h-6 w-6 p-0 ${
                      showSources
                        ? "text-purple-400"
                        : "text-white/40 hover:text-white/80"
                    }`}
                    title="Data Sources"
                  >
                    <Settings2 className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsPaused(!isPaused)}
                    className="h-6 w-6 p-0 text-white/40 hover:text-white/80"
                    title={isPaused ? "Resume" : "Pause"}
                  >
                    {isPaused ? (
                      <Play className="w-3 h-3" />
                    ) : (
                      <Pause className="w-3 h-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={reshufflePositions}
                    className="h-6 w-6 p-0 text-white/40 hover:text-white/80"
                    title="Reshuffle"
                  >
                    <Shuffle className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={exportFragments}
                    className="h-6 w-6 p-0 text-white/40 hover:text-white/80"
                    title="Export"
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={handleFileImport}
                    />
                    <div
                      className="h-6 w-6 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
                      title="Import"
                    >
                      <Upload className="w-3 h-3" />
                    </div>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    className="h-6 w-6 p-0 text-white/40 hover:text-red-400"
                    title="Clear all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Template selector */}
              <TemplateSelector
                activeId={templateId}
                onChange={changeTemplate}
              />

              {/* Data sources panel */}
              <AnimatePresence>
                {showSources && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-2 border-t border-white/[0.06]">
                      <SourceManagerPanel
                        sources={sources}
                        onToggle={toggleSource}
                        onRemove={removeSource}
                        onFetch={fetchNow}
                        onAdd={addSource}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle controls visibility */}
      <button
        onClick={() => setShowControls(!showControls)}
        className="shrink-0 w-full py-0.5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors flex items-center justify-center"
      >
        {showControls ? (
          <ChevronUp className="w-3 h-3 text-white/20" />
        ) : (
          <ChevronDown className="w-3 h-3 text-white/20" />
        )}
      </button>

      {/* ================================================================= */}
      {/* THE CANVAS                                                        */}
      {/* ================================================================= */}
      <div
        ref={canvasRef}
        className={`flex-1 relative overflow-hidden ${template.backgroundCSS}`}
        style={{ minHeight: 0 }}
      >
        {/* Template texture overlay */}
        <TemplateOverlay template={template} />

        {/* Notification overlay — floating on top */}
        <NotificationOverlay
          notifications={notifications}
          onDismiss={dismissNotification}
        />

        {/* Empty state */}
        {fragments.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center space-y-3"
            >
              <Sparkles className="w-10 h-10 mx-auto text-white/10" />
              <p
                className="text-sm tracking-wider"
                style={{ color: template.palette.muted }}
              >
                empty canvas
              </p>
              <p className="text-[10px]" style={{ color: template.palette.muted }}>
                add content below or enable a data source
              </p>
            </motion.div>
          </div>
        )}

        {/* Render by display mode */}
        {isBoundedTemplate ? (
          // Bounded / Hybrid — CSS Grid layout with zones
          <div
            className="h-full w-full overflow-hidden"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${zoneColumns}, 1fr)`,
              gridTemplate: responsiveGridTemplate ?? "'full' 1fr / 1fr",
              gap: template.gridGap ?? responsiveGap,
              padding: responsivePadding,
            }}
          >
            {template.zones.map((zone, idx) => {
              // Skip hidden zones based on viewport
              const zoneKey = zone.gridArea ?? zone.type;
              const visibility = zoneVisibility[zoneKey] ?? 'show';
              if (visibility === 'hide') return null;
              
              if (zone.type === "floating") return null;
              const zoneFrags = fragmentsByZone.get(
                zone.gridArea ?? zone.type,
              ) ?? [];
              
              // Apply collapse styling
              const isCollapsed = visibility === 'collapse';
              
              return (
                <div
                  key={`${zone.type}-${idx}`}
                  style={{ gridArea: zone.gridArea }}
                  className={`overflow-hidden rounded-lg transition-all ${
                    isCollapsed ? 'max-h-0 p-0 opacity-0' : ''
                  } ${
                    zone.bordered
                      ? "border border-white/[0.08] bg-white/[0.02]"
                      : ""
                  }`}
                >
                  <ContentZone
                    zone={zone}
                    fragments={zoneFrags}
                    onRemove={removeFragment}
                    isPaused={isPaused}
                    template={template}
                    responsiveConfig={(template as any).fragmentConfig}
                  />
                </div>
              );
            })}

            {/* Hybrid: render floating zone on top */}
            {template.displayMode === "hybrid" && (
              <div className="absolute inset-0 pointer-events-none">
                {template.zones
                  .filter((z) => z.type === "floating")
                  .map((zone, idx) => {
                    const zoneFrags =
                      fragmentsByZone.get("floating") ?? [];
                    return (
                      <ContentZone
                        key={`floating-${idx}`}
                        zone={zone}
                        fragments={zoneFrags}
                        onRemove={removeFragment}
                        isPaused={isPaused}
                        template={template}
                        responsiveConfig={(template as any).fragmentConfig}
                      />
                    );
                  })}
              </div>
            )}
          </div>
        ) : (
          // Unbounded — fragments float freely
          <div className="absolute inset-0">
            {template.zones.map((zone, idx) => {
              const zoneFrags =
                fragmentsByZone.get(zone.type) ?? fragments;
              return (
                <ContentZone
                  key={`${zone.type}-${idx}`}
                  zone={zone}
                  fragments={zoneFrags}
                  onRemove={removeFragment}
                  isPaused={isPaused}
                  template={template}
                  responsiveConfig={(template as any).fragmentConfig}
                />
              );
            })}
          </div>
        )}

        {/* Template watermark with responsive info */}
        <div className="absolute bottom-2 right-3 pointer-events-none z-50 flex items-center gap-2">
          <span
            className="text-[9px] font-mono tracking-widest uppercase"
            style={{ color: template.palette.muted, opacity: 0.3 }}
          >
            {template.id} · {template.displayMode}
          </span>
          <span
            className="text-[8px] font-mono"
            style={{ color: template.palette.muted, opacity: 0.2 }}
          >
            {responsiveConfig.width}px
          </span>
        </div>
      </div>

      {/* Input panel */}
      <InputPanel
        onAdd={addFragments}
        onNotify={handleNotify}
        template={template}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByZone(
  fragments: ZineFragment[],
  template: ZineTemplate,
): Map<string, ZineFragment[]> {
  const map = new Map<string, ZineFragment[]>();

  for (const zone of template.zones) {
    const key = zone.gridArea ?? zone.type;
    map.set(key, []);
  }

  if (template.zones.length === 1) {
    const key =
      template.zones[0].gridArea ?? template.zones[0].type;
    map.set(key, fragments);
    return map;
  }

  for (const frag of fragments) {
    const zone = frag.zone;
    if (!zone) {
      // Assign to first zone
      const firstKey =
        template.zones[0].gridArea ?? template.zones[0].type;
      map.get(firstKey)?.push(frag);
      continue;
    }

    // Find matching zone config
    const matchedZone = template.zones.find(
      (z) => z.type === zone || z.gridArea === zone,
    );
    if (matchedZone) {
      const key = matchedZone.gridArea ?? matchedZone.type;
      const arr = map.get(key);
      if (arr && arr.length < matchedZone.maxFragments) {
        arr.push(frag);
      } else {
        // Overflow: assign to first zone with space
        for (const [k, v] of map.entries()) {
          const zConfig = template.zones.find(
            (z) => (z.gridArea ?? z.type) === k,
          );
          if (zConfig && v.length < zConfig.maxFragments) {
            v.push(frag);
            break;
          }
        }
      }
    } else {
      // No match: assign to first zone
      const firstKey =
        template.zones[0].gridArea ?? template.zones[0].type;
      map.get(firstKey)?.push(frag);
    }
  }

  return map;
}
