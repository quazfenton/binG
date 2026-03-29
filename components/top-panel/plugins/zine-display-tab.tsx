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
} from "./zine-engine";

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

function useDataSources(
  template: ZineTemplate,
  onData: (fragments: ZineFragment[]) => void,
) {
  const managerRef = useRef<DataSourceManager | null>(null);
  const [sources, setSources] = useState<DataSourceConfig[]>([]);
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

    return () => mgr.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    managerRef.current?.setTemplate(template);
  }, [template]);

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

  return { sources, addSource, removeSource, toggleSource, fetchNow };
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
}

function FragmentRenderer({
  fragment,
  index,
  onRemove,
  isPaused,
  template,
  bounded,
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

  // Unbounded: absolute positioned floating text
  const inlineStyle: React.CSSProperties = {
    position: "absolute",
    left: `${style.x}%`,
    top: `${style.y}%`,
    transform: `rotate(${style.rotation}deg) scale(${style.scale})`,
    fontSize: `${style.fontSize}px`,
    fontFamily: style.fontFamily,
    color: style.color,
    fontWeight: style.fontWeight,
    letterSpacing: `${style.letterSpacing}px`,
    lineHeight: style.lineHeight,
    textTransform: style.textTransform,
    textAlign: style.textAlign,
    zIndex: style.zIndex,
    maxWidth: type === "heading" ? "80%" : type === "whisper" ? "50%" : "60%",
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
      whileHover={{ scale: (style.scale || 1) * 1.05, zIndex: 999 }}
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
}

function ContentZone({
  zone,
  fragments,
  onRemove,
  isPaused,
  template,
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
// SourceManagerPanel — UI for managing data sources
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium">
          Data Sources
        </span>
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

      {showAddForm && (
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

  const addFragments = useCallback(
    (newFragments: ZineFragment[]) => {
      setFragments((prev) => {
        const combined = [...prev, ...newFragments];
        return combined.slice(-template.maxVisible);
      });
    },
    [template.maxVisible],
  );

  const { sources, addSource, removeSource, toggleSource, fetchNow } =
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
                </div>

                <div className="flex items-center gap-1">
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
            className="h-full w-full p-3 overflow-hidden"
            style={{
              display: "grid",
              gridTemplate: template.gridTemplate ?? "'full' 1fr / 1fr",
              gap: template.gridGap ?? "8px",
            }}
          >
            {template.zones.map((zone, idx) => {
              if (zone.type === "floating") return null;
              const zoneFrags = fragmentsByZone.get(
                zone.gridArea ?? zone.type,
              ) ?? [];
              return (
                <div
                  key={`${zone.type}-${idx}`}
                  style={{ gridArea: zone.gridArea }}
                  className={`overflow-hidden rounded-lg ${
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
                />
              );
            })}
          </div>
        )}

        {/* Template watermark */}
        <div className="absolute bottom-2 right-3 pointer-events-none z-50">
          <span
            className="text-[9px] font-mono tracking-widest uppercase"
            style={{ color: template.palette.muted, opacity: 0.3 }}
          >
            {template.id} · {template.displayMode}
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
