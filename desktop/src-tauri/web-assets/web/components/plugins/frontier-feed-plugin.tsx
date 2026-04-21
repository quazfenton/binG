"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles, Clock, Plus, Trash2, Upload, Download,
  FileJson, FileText, Filter, Eye, EyeOff, Zap, Star,
  Hash, X, AlertCircle, Loader2, Link as LinkIcon, Type,
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

interface FeedItem {
  id: string;
  title: string;
  body: string;
  tags: string[];
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  createdAt: string;
  expiresAt?: string;
  meta: Record<string, unknown>;
  format: "text" | "json" | "markdown" | "card";
  imageUrl?: string;
  link?: string;
}

interface FeedState {
  items: FeedItem[];
  rotationInterval: number;
  maxItems: number;
  sortBy: "newest" | "oldest" | "priority" | "alphabetical";
  filterCategory: string;
  showExpired: boolean;
}

type InputFormat = "json" | "text" | "csv";

function isExpired(item: FeedItem): boolean {
  if (!item.expiresAt) return false;
  return new Date(item.expiresAt).getTime() < Date.now();
}

function priorityWeight(p: FeedItem["priority"]): number {
  switch (p) {
    case "critical": return 4;
    case "high": return 3;
    case "medium": return 2;
    case "low": return 1;
    default: return 0;
  }
}

function sortItems(items: FeedItem[], sortBy: FeedState["sortBy"]): FeedItem[] {
  const sorted = [...items];
  switch (sortBy) {
    case "newest":
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case "oldest":
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case "priority":
      return sorted.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
    case "alphabetical":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return sorted;
  }
}

function parseInput(raw: string, format: InputFormat): FeedItem[] {
  const now = new Date().toISOString();
  const items: FeedItem[] = [];
  try {
    if (format === "json") {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of arr) {
        items.push({
          id: entry.id || crypto.randomUUID(),
          title: String(entry.title || entry.name || "Untitled"),
          body: String(entry.body || entry.content || entry.text || entry.description || ""),
          tags: Array.isArray(entry.tags) ? entry.tags : typeof entry.tags === "string" ? entry.tags.split(",").map((t: string) => t.trim()) : [],
          category: String(entry.category || entry.type || "general"),
          priority: ["low", "medium", "high", "critical"].includes(entry.priority) ? entry.priority : "medium",
          createdAt: entry.createdAt || entry.created || entry.date || now,
          expiresAt: entry.expiresAt || entry.expires || entry.ttl || undefined,
          meta: entry.meta || entry.metadata || {},
          format: entry.format === "markdown" ? "markdown" : entry.format === "card" ? "card" : "text",
          imageUrl: entry.imageUrl || entry.image || entry.thumbnail || undefined,
          link: entry.link || entry.url || entry.href || undefined,
        });
      }
    } else if (format === "text") {
      const lines = raw.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        const tags = line.match(/#(\w+)/g)?.map((t: string) => t.slice(1)) || [];
        const priorityMatch = line.match(/\[(low|medium|high|critical)\]/i);
        const categoryMatch = line.match(/@(\w+)/);
        items.push({
          id: crypto.randomUUID(),
          title: line.replace(/#\w+/g, "").replace(/\[(low|medium|high|critical)\]/gi, "").replace(/@\w+/g, "").trim().slice(0, 120),
          body: line,
          tags,
          category: categoryMatch ? categoryMatch[1] : "general",
          priority: priorityMatch ? priorityMatch[1].toLowerCase() as FeedItem["priority"] : "medium",
          createdAt: now,
          meta: {},
          format: "text",
        });
      }
    } else if (format === "csv") {
      const rows = raw.split("\n").filter((r: string) => r.trim());
      if (rows.length < 2) throw new Error("CSV needs header + data");
      const headers = rows[0].split(",").map((h: string) => h.trim().toLowerCase());
      for (let i = 1; i < rows.length; i++) {
        const vals = rows[i].split(",").map((v: string) => v.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => { obj[h] = vals[idx] || ""; });
        items.push({
          id: obj.id || crypto.randomUUID(),
          title: obj.title || obj.name || "Row " + i,
          body: obj.body || obj.content || obj.text || "",
          tags: (obj.tags || "").split(";").filter(Boolean),
          category: obj.category || obj.type || "general",
          priority: (["low", "medium", "high", "critical"].includes(obj.priority) ? obj.priority : "medium") as FeedItem["priority"],
          createdAt: obj.createdat || obj.date || now,
          expiresAt: obj.expiresat || obj.expires || undefined,
          meta: {},
          format: "text",
          imageUrl: obj.imageurl || obj.image || undefined,
          link: obj.link || obj.url || undefined,
        });
      }
    }
  } catch (err) {
    toast.error("Parse error: " + (err instanceof Error ? err.message : "Invalid input"));
  }
  return items;
}

function priorityStyle(p: FeedItem["priority"]) {
  switch (p) {
    case "critical": return { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-300", dot: "bg-red-400" };
    case "high": return { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-300", dot: "bg-orange-400" };
    case "medium": return { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-300", dot: "bg-blue-400" };
    case "low": return { bg: "bg-white/5", border: "border-white/10", text: "text-white/50", dot: "bg-white/30" };
    default: return { bg: "bg-white/5", border: "border-white/10", text: "text-white/50", dot: "bg-white/30" };
  }
}

const SAMPLE_ITEMS: FeedItem[] = [
  { id: "s1", title: "System Performance Update", body: "All services at 99.97% uptime. Latency reduced 12ms after migration.", tags: ["system", "performance"], category: "ops", priority: "high", createdAt: new Date(Date.now() - 120000).toISOString(), meta: {}, format: "text" },
  { id: "s2", title: "New API Endpoint Deployed", body: "POST /api/v3/generate — streaming, function calling, multi-modal.", tags: ["api", "deploy"], category: "engineering", priority: "medium", createdAt: new Date(Date.now() - 900000).toISOString(), expiresAt: new Date(Date.now() + 7200000).toISOString(), meta: {}, format: "text" },
  { id: "s3", title: "Critical: Memory Pressure Alert", body: "Heap usage 85% on worker-7. Auto-scaling triggered.", tags: ["alert", "memory"], category: "ops", priority: "critical", createdAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), meta: {}, format: "text" },
  { id: "s4", title: "Feature Flag: Dark Mode v2", body: "Rolled out to 25% of users. OLED-true-black option included.", tags: ["feature", "ui"], category: "product", priority: "low", createdAt: new Date(Date.now() - 2700000).toISOString(), meta: {}, format: "text" },
  { id: "s5", title: "Weekly Security Scan", body: "0 critical, 2 medium, 5 low findings. Remediation ETA 48h.", tags: ["security", "scan"], category: "security", priority: "medium", createdAt: new Date(Date.now() - 10800000).toISOString(), meta: {}, format: "text" },
  { id: "s6", title: "Documentation Update: Agent SDK", body: "Added examples for tool-use, multi-step reasoning. Python and TS SDKs.", tags: ["docs", "sdk"], category: "engineering", priority: "low", createdAt: new Date(Date.now() - 21600000).toISOString(), meta: {}, format: "text" },
];

interface FeedCardProps {
  item: FeedItem;
  index: number;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  isPinned: boolean;
}

function FeedCard({ item, index, onRemove, onTogglePin, isPinned }: FeedCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.3 });
  const ps = priorityStyle(item.priority);
  const expired = isExpired(item);
  const [, forceUpdate] = useState(0);

  // Live-updating time display
  useEffect(() => {
    if (!item.expiresAt) return;
    const interval = setInterval(() => forceUpdate(n => n + 1), 30000);
    return () => clearInterval(interval);
  }, [item.expiresAt]);

  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(item.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }, [item.createdAt]);

  const expiresIn = useMemo(() => {
    if (!item.expiresAt) return null;
    const diff = new Date(item.expiresAt).getTime() - Date.now();
    if (diff <= 0) return "expired";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + "m left";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h left";
    return Math.floor(hrs / 24) + "d left";
  }, [item.expiresAt]);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={isInView ? { opacity: expired && !isPinned ? 0.4 : 1, y: 0, scale: 1 } : { opacity: 0, y: 30, scale: 0.95 }}
      exit={{ opacity: 0, x: -80, scale: 0.9 }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={"group relative rounded-xl border backdrop-blur-md transition-all duration-300 hover:shadow-lg hover:shadow-white/5 " + ps.bg + " " + ps.border + (isPinned ? " ring-1 ring-yellow-400/30" : "")}
    >
      <div className="absolute inset-0 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
      </div>
      <div className="relative p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={"h-2 w-2 rounded-full shrink-0 " + ps.dot + (item.priority === "critical" ? " animate-pulse" : "")} />
            <h3 className="text-sm font-semibold text-white/90 truncate">{item.title}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onTogglePin(item.id)} className={"p-1 rounded hover:bg-white/10 transition-colors " + (isPinned ? "text-yellow-400" : "text-white/30 opacity-0 group-hover:opacity-100")} title={isPinned ? "Unpin" : "Pin"}>
              <Star className="h-3 w-3" fill={isPinned ? "currentColor" : "none"} />
            </button>
            <button onClick={() => onRemove(item.id)} className="p-1 rounded hover:bg-red-500/20 text-white/30 opacity-0 group-hover:opacity-100 transition-colors hover:text-red-400" title="Remove">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
        {item.body && <p className="text-xs text-white/60 mb-3 leading-relaxed line-clamp-3 whitespace-pre-wrap">{item.body}</p>}
        {item.imageUrl && (
          <div className="mb-3 rounded-lg overflow-hidden border border-white/10">
            <img src={getProxiedImageUrl(item.imageUrl)} alt={item.title} className="w-full h-32 object-cover opacity-80 hover:opacity-100 transition-opacity" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
        )}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {item.tags.slice(0, 5).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] bg-white/5 text-white/50 border border-white/10 px-1.5 py-0">
                <Hash className="h-2 w-2 mr-0.5" />{tag}
              </Badge>
            ))}
            {item.tags.length > 5 && <Badge variant="secondary" className="text-[10px] bg-white/5 text-white/40">+{item.tags.length - 5}</Badge>}
          </div>
        )}
        <div className="flex items-center justify-between text-[10px] text-white/40">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{timeAgo}</span>
            <Badge variant="outline" className="text-[9px] border-white/10 text-white/40 px-1 py-0">{item.category}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {expiresIn && (
              <span className={"flex items-center gap-1 " + (expired ? "text-red-400" : expiresIn.includes("m left") ? "text-yellow-400" : "text-white/40")}>
                <Zap className="h-2.5 w-2.5" />{expiresIn}
              </span>
            )}
            {item.link && <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:text-white/80 transition-colors"><LinkIcon className="h-2.5 w-2.5" /></a>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function FrontierFeedPlugin() {
  const [state, setState] = useState<FeedState>({
    items: SAMPLE_ITEMS,
    rotationInterval: 3600000,
    maxItems: 100,
    sortBy: "newest",
    filterCategory: "all",
    showExpired: false,
  });
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [inputText, setInputText] = useState("");
  const [inputFormat, setInputFormat] = useState<InputFormat>("json");
  const [showInput, setShowInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => {
        const now = Date.now();
        const active = prev.items.filter(item => {
          if (pinnedIds.has(item.id)) return true;
          if (!item.expiresAt) return true;
          return new Date(item.expiresAt).getTime() > now;
        });
        if (active.length !== prev.items.length) {
          const removed = prev.items.length - active.length;
          if (removed > 0) toast.info("Rotated out " + removed + " expired item" + (removed > 1 ? "s" : ""), { duration: 2000 });
        }
        return { ...prev, items: active };
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [pinnedIds]);

  const categories = useMemo(() => {
    const cats = new Set(state.items.map(i => i.category));
    return ["all", ...Array.from(cats).sort()];
  }, [state.items]);

  const filteredItems = useMemo(() => {
    let items = state.items;
    if (state.filterCategory !== "all") items = items.filter(i => i.category === state.filterCategory);
    if (!state.showExpired) items = items.filter(i => !isExpired(i) || pinnedIds.has(i.id));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q) || i.tags.some(t => t.toLowerCase().includes(q)));
    }
    const pinned = items.filter(i => pinnedIds.has(i.id));
    const rest = sortItems(items.filter(i => !pinnedIds.has(i.id)), state.sortBy);
    return [...sortItems(pinned, state.sortBy), ...rest];
  }, [state.items, state.filterCategory, state.showExpired, state.sortBy, searchQuery, pinnedIds]);

  const stats = useMemo(() => {
    const total = state.items.length;
    const expired = state.items.filter(i => isExpired(i)).length;
    const pinned = pinnedIds.size;
    const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
    state.items.forEach(i => byPriority[i.priority]++);
    return { total, expired, pinned, byPriority };
  }, [state.items, pinnedIds]);

  const handleAddItems = useCallback(() => {
    if (!inputText.trim()) return;
    const items = parseInput(inputText, inputFormat);
    if (items.length === 0) { toast.error("No valid items parsed"); return; }
    // Deduplicate by title+body combination
    setState(prev => {
      const existingKeys = new Set(prev.items.map(i => i.title.toLowerCase() + "::" + i.body.toLowerCase().slice(0, 80)));
      const newItems = items.filter(i => !existingKeys.has(i.title.toLowerCase() + "::" + i.body.toLowerCase().slice(0, 80)));
      if (newItems.length < items.length) {
        toast.info("Skipped " + (items.length - newItems.length) + " duplicate" + (items.length - newItems.length > 1 ? "s" : ""));
      }
      if (newItems.length === 0) return prev;
      return { ...prev, items: [...newItems, ...prev.items].slice(0, prev.maxItems) };
    });
    setInputText("");
    setShowInput(false);
    toast.success("Added " + items.length + " item" + (items.length > 1 ? "s" : ""));
  }, [inputText, inputFormat]);

  const handleRemove = useCallback((id: string) => {
    setState(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) }));
    setPinnedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const handleClearAll = useCallback(() => {
    setState(prev => {
      const cleared = prev.items.filter(i => !pinnedIds.has(i.id));
      if (cleared.length === 0) return prev;
      // Store in sessionStorage for undo
      try { sessionStorage.setItem("frontier-feed-undo", JSON.stringify(cleared)); } catch {}
      toast.success("Cleared " + cleared.length + " unpinned items", {
        action: {
          label: "Undo",
          onClick: () => {
            try {
              const saved = sessionStorage.getItem("frontier-feed-undo");
              if (saved) {
                const items = JSON.parse(saved);
                setState(p => ({ ...p, items: [...items, ...p.items].slice(0, p.maxItems) }));
                sessionStorage.removeItem("frontier-feed-undo");
                toast.success("Restored " + items.length + " items");
              }
            } catch {}
          },
        },
        duration: 8000,
      });
      return { ...prev, items: prev.items.filter(i => pinnedIds.has(i.id)) };
    });
  }, [pinnedIds]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(state.items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "frontier-feed-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Feed exported");
  }, [state.items]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const fmt: InputFormat = file.name.endsWith(".csv") ? "csv" : file.name.endsWith(".json") ? "json" : "text";
      const items = parseInput(text, fmt);
      if (items.length > 0) {
        setState(prev => ({ ...prev, items: [...items, ...prev.items].slice(0, prev.maxItems) }));
        toast.success("Imported " + items.length + " items");
      }
    };
    reader.readAsText(file);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-white/10 bg-gradient-to-r from-purple-500/5 via-transparent to-cyan-500/5">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }}>
                <Sparkles className="h-5 w-5 text-purple-400" />
              </motion.div>
              <h2 className="text-base font-bold text-white/90">Frontier Feed</h2>
              <Badge variant="secondary" className="text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/20">{stats.total} items</Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setShowInput(!showInput)} className="h-7 text-xs hover:bg-white/10">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExport} className="h-7 text-xs hover:bg-white/10"><Download className="h-3 w-3" /></Button>
              <label className="cursor-pointer">
                <input type="file" accept=".json,.csv,.txt" className="hidden" onChange={handleFileImport} />
                <Button variant="ghost" size="sm" asChild className="h-7 text-xs hover:bg-white/10"><span><Upload className="h-3 w-3" /></span></Button>
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3 mb-3">
            {stats.byPriority.critical > 0 && <span className="flex items-center gap-1 text-[10px] text-red-300"><div className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />{stats.byPriority.critical} critical</span>}
            {stats.byPriority.high > 0 && <span className="flex items-center gap-1 text-[10px] text-orange-300"><div className="h-1.5 w-1.5 rounded-full bg-orange-400" />{stats.byPriority.high} high</span>}
            {stats.pinned > 0 && <span className="flex items-center gap-1 text-[10px] text-yellow-300"><Star className="h-2.5 w-2.5" fill="currentColor" />{stats.pinned} pinned</span>}
            {stats.expired > 0 && <span className="flex items-center gap-1 text-[10px] text-white/40"><Clock className="h-2.5 w-2.5" />{stats.expired} expired</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search feed... (Ctrl+K)" className="h-7 text-xs bg-white/5 border-white/10 text-white/90 placeholder:text-white/30 flex-1 min-w-[120px]" />
            <select value={state.filterCategory} onChange={(e) => setState(prev => ({ ...prev, filterCategory: e.target.value }))} className="h-7 text-xs bg-white/5 border border-white/10 rounded px-2 text-white/70 focus:outline-none focus:border-purple-500/50">
              {categories.map(c => <option key={c} value={c} className="bg-gray-900">{c === "all" ? "All Categories" : c}</option>)}
            </select>
            <select value={state.sortBy} onChange={(e) => setState(prev => ({ ...prev, sortBy: e.target.value as FeedState["sortBy"] }))} className="h-7 text-xs bg-white/5 border border-white/10 rounded px-2 text-white/70 focus:outline-none focus:border-purple-500/50">
              <option value="newest" className="bg-gray-900">Newest</option>
              <option value="oldest" className="bg-gray-900">Oldest</option>
              <option value="priority" className="bg-gray-900">Priority</option>
              <option value="alphabetical" className="bg-gray-900">A-Z</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => setState(prev => ({ ...prev, showExpired: !prev.showExpired }))} className={"h-7 text-xs " + (state.showExpired ? "bg-white/10 text-white" : "text-white/50")} title={state.showExpired ? "Hide expired" : "Show expired"}>
              {state.showExpired ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-7 text-xs text-white/40 hover:text-red-400 hover:bg-red-500/10" title="Clear unpinned"><Trash2 className="h-3 w-3" /></Button>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {showInput && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="shrink-0 border-b border-white/10 bg-black/20 overflow-hidden">
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
                  {(["json", "text", "csv"] as InputFormat[]).map((fmt) => (
                    <button key={fmt} onClick={() => setInputFormat(fmt)} className={"px-2.5 py-1 text-[10px] rounded-md transition-all " + (inputFormat === fmt ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80")}>
                      {fmt === "json" ? <FileJson className="h-3 w-3 mr-1 inline" /> : fmt === "csv" ? <FileText className="h-3 w-3 mr-1 inline" /> : <Type className="h-3 w-3 mr-1 inline" />}
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder={inputFormat === "json" ? '[{"title":"...","body":"...","priority":"high"}]' : inputFormat === "csv" ? "title,body,tags,priority\nMy Item,Some content,tag1;tag2,high" : "Line 1 #tag [high] @category"} className="min-h-[100px] text-xs bg-black/30 border-white/10 text-white/90 placeholder:text-white/20 font-mono resize-none" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setShowInput(false); setInputText(""); }} className="h-7 text-xs">Cancel</Button>
                <Button size="sm" onClick={handleAddItems} disabled={!inputText.trim()} className="h-7 text-xs bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30"><Plus className="h-3 w-3 mr-1" /> Add Items</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredItems.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
                <Sparkles className="h-12 w-12 mx-auto text-white/10 mb-4" />
                <p className="text-sm text-white/40">No items in feed</p>
                <p className="text-xs text-white/25 mt-1">Add items or import a file to get started</p>
              </motion.div>
            ) : (
              filteredItems.map((item, index) => (
                <FeedCard key={item.id} item={item} index={index} onRemove={handleRemove} onTogglePin={handleTogglePin} isPinned={pinnedIds.has(item.id)} />
              ))
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
