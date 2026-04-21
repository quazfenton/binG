"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Zap, Mail, Calendar, FileText, Github, Twitter, MessageSquare,
  Music, Cloud, Search, Phone, Database, CheckCircle, XCircle,
  ExternalLink, RefreshCw, Loader2, Shield, Play, ArrowRight,
  Globe, Terminal, GitBranch, Webhook, Bell, Send, Download,
  Upload, Share2, Lock, Unlock, Sparkles, Command, LayoutGrid,
  List, Eye, ChevronRight, ChevronDown, ChevronUp, Settings,
  Plus, Trash2, Copy, Star, Heart, Bookmark, Hash, AtSign,
  Video, Image, MapPin, Mic, Smartphone, Layers, Box,
  Workflow, Timer, BarChart3, PieChart, TrendingUp, X, Users,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  provider: string;
  category: string;
  requiresConnection: boolean;
  actionFn?: () => Promise<ActionResult>;
  oauthProvider?: string;
}

interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;
  timestamp: number;
}

interface PlatformStatus {
  provider: string;
  connected: boolean;
  source: "auth0" | "arcade" | "nango" | "oauth" | null;
  lastChecked: number;
}

type ViewMode = "zine" | "grid" | "list" | "flow";
type FilterMode = "all" | "connected" | "available" | "email" | "social" | "dev" | "productivity" | "media" | "web";

// ---------------------------------------------------------------------------
// Platform action definitions
// ---------------------------------------------------------------------------

const PLATFORM_ACTIONS: ActionItem[] = [
  // Gmail / Google
  { id: "gmail-send", label: "Send Email", description: "Compose and send an email via Gmail", icon: Mail, provider: "gmail", category: "email", requiresConnection: true, oauthProvider: "gmail" },
  { id: "gmail-read", label: "Read Inbox", description: "Fetch recent inbox messages", icon: Mail, provider: "gmail", category: "email", requiresConnection: true, oauthProvider: "gmail" },
  { id: "gmail-search", label: "Search Emails", description: "Search across your Gmail messages", icon: Search, provider: "gmail", category: "email", requiresConnection: true, oauthProvider: "gmail" },
  // Google Calendar
  { id: "gcal-events", label: "List Events", description: "View upcoming calendar events", icon: Calendar, provider: "googlecalendar", category: "productivity", requiresConnection: true, oauthProvider: "googlecalendar" },
  { id: "gcal-create", label: "Create Event", description: "Schedule a new calendar event", icon: Plus, provider: "googlecalendar", category: "productivity", requiresConnection: true, oauthProvider: "googlecalendar" },
  // Google Drive
  { id: "gdrive-list", label: "List Files", description: "Browse files in Google Drive", icon: FileText, provider: "googledrive", category: "productivity", requiresConnection: true, oauthProvider: "googledrive" },
  { id: "gdrive-upload", label: "Upload File", description: "Upload a file to Google Drive", icon: Upload, provider: "googledrive", category: "productivity", requiresConnection: true, oauthProvider: "googledrive" },
  // Google Docs
  { id: "gdocs-create", label: "Create Doc", description: "Create a new Google Document", icon: FileText, provider: "googledocs", category: "productivity", requiresConnection: true, oauthProvider: "googledocs" },
  // Google Sheets
  { id: "gsheets-read", label: "Read Sheet", description: "Read data from a Google Sheet", icon: BarChart3, provider: "googlesheets", category: "productivity", requiresConnection: true, oauthProvider: "googlesheets" },
  // GitHub
  { id: "gh-repos", label: "List Repos", description: "Browse your GitHub repositories", icon: Github, provider: "github", category: "dev", requiresConnection: true, oauthProvider: "github" },
  { id: "gh-issues", label: "Create Issue", description: "Open a new GitHub issue", icon: GitBranch, provider: "github", category: "dev", requiresConnection: true, oauthProvider: "github" },
  { id: "gh-prs", label: "Create PR", description: "Open a pull request", icon: GitBranch, provider: "github", category: "dev", requiresConnection: true, oauthProvider: "github" },
  { id: "gh-search", label: "Search Code", description: "Search across GitHub repositories", icon: Search, provider: "github", category: "dev", requiresConnection: true, oauthProvider: "github" },
  // Slack
  { id: "slack-msg", label: "Send Message", description: "Post a message to a Slack channel", icon: MessageSquare, provider: "slack", category: "social", requiresConnection: true, oauthProvider: "slack" },
  { id: "slack-channels", label: "List Channels", description: "View available Slack channels", icon: Hash, provider: "slack", category: "social", requiresConnection: true, oauthProvider: "slack" },
  // Discord
  { id: "discord-msg", label: "Send Message", description: "Post a message to a Discord channel", icon: MessageSquare, provider: "discord", category: "social", requiresConnection: true, oauthProvider: "discord" },
  { id: "discord-servers", label: "List Servers", description: "View your Discord servers", icon: Globe, provider: "discord", category: "social", requiresConnection: true, oauthProvider: "discord" },
  // Twitter/X
  { id: "twitter-post", label: "Post Tweet", description: "Publish a tweet to X/Twitter", icon: Twitter, provider: "twitter", category: "social", requiresConnection: true, oauthProvider: "twitter" },
  { id: "twitter-search", label: "Search Tweets", description: "Search recent tweets", icon: Search, provider: "twitter", category: "social", requiresConnection: true, oauthProvider: "twitter" },
  // Spotify
  { id: "spotify-play", label: "Play Track", description: "Start playback on Spotify", icon: Play, provider: "spotify", category: "media", requiresConnection: true, oauthProvider: "spotify" },
  { id: "spotify-search", label: "Search Music", description: "Search tracks, albums, artists", icon: Search, provider: "spotify", category: "media", requiresConnection: true, oauthProvider: "spotify" },
  // Twilio
  { id: "twilio-sms", label: "Send SMS", description: "Send an SMS message", icon: Smartphone, provider: "twilio", category: "communication", requiresConnection: true, oauthProvider: "twilio" },
  // Reddit
  { id: "reddit-post", label: "Create Post", description: "Submit a post to a subreddit", icon: FileText, provider: "reddit", category: "social", requiresConnection: true, oauthProvider: "reddit" },
  // LinkedIn
  { id: "linkedin-post", label: "Create Post", description: "Publish a LinkedIn post", icon: Share2, provider: "linkedin", category: "social", requiresConnection: true, oauthProvider: "linkedin" },
  // Vercel
  { id: "vercel-deploy", label: "Deploy Project", description: "Deploy a project to Vercel", icon: Upload, provider: "vercel", category: "dev", requiresConnection: true, oauthProvider: "vercel" },
  // Railway
  { id: "railway-deploy", label: "Deploy Service", description: "Deploy to Railway", icon: Upload, provider: "railway", category: "dev", requiresConnection: true, oauthProvider: "railway" },
  // Web
  { id: "web-search", label: "Web Search", description: "Search the web with Exa", icon: Globe, provider: "exa", category: "web", requiresConnection: true, oauthProvider: "exa" },
  // Notion
  { id: "notion-search", label: "Search Pages", description: "Search across your Notion workspace", icon: Search, provider: "notion", category: "productivity", requiresConnection: true, oauthProvider: "notion" },
  { id: "notion-create", label: "Create Page", description: "Create a new page in Notion", icon: Plus, provider: "notion", category: "productivity", requiresConnection: true, oauthProvider: "notion" },
  { id: "notion-db", label: "Query Database", description: "Query a Notion database", icon: Database, provider: "notion", category: "productivity", requiresConnection: true, oauthProvider: "notion" },
  // Dropbox
  { id: "dropbox-list", label: "List Files", description: "Browse files in Dropbox", icon: Cloud, provider: "dropbox", category: "productivity", requiresConnection: true, oauthProvider: "dropbox" },
  { id: "dropbox-upload", label: "Upload File", description: "Upload a file to Dropbox", icon: Upload, provider: "dropbox", category: "productivity", requiresConnection: true, oauthProvider: "dropbox" },
  // Stripe
  { id: "stripe-balance", label: "Check Balance", description: "View your Stripe account balance", icon: BarChart3, provider: "stripe", category: "dev", requiresConnection: true, oauthProvider: "stripe" },
  { id: "stripe-customers", label: "List Customers", description: "View Stripe customers", icon: Users, provider: "stripe", category: "dev", requiresConnection: true, oauthProvider: "stripe" },
  // Zoom
  { id: "zoom-meetings", label: "List Meetings", description: "View upcoming Zoom meetings", icon: Video, provider: "zoom", category: "communication", requiresConnection: true, oauthProvider: "zoom" },
  { id: "zoom-create", label: "Schedule Meeting", description: "Create a new Zoom meeting", icon: Plus, provider: "zoom", category: "communication", requiresConnection: true, oauthProvider: "zoom" },
  // Linear
  { id: "linear-issues", label: "List Issues", description: "View Linear issues", icon: GitBranch, provider: "linear", category: "dev", requiresConnection: true, oauthProvider: "linear" },
  { id: "linear-create", label: "Create Issue", description: "Create a Linear issue", icon: Plus, provider: "linear", category: "dev", requiresConnection: true, oauthProvider: "linear" },
  // Jira
  { id: "jira-issues", label: "List Issues", description: "View Jira issues", icon: GitBranch, provider: "jira", category: "dev", requiresConnection: true, oauthProvider: "jira" },
  { id: "jira-create", label: "Create Issue", description: "Create a Jira issue", icon: Plus, provider: "jira", category: "dev", requiresConnection: true, oauthProvider: "jira" },
  // HubSpot
  { id: "hubspot-contacts", label: "List Contacts", description: "View HubSpot contacts", icon: Users, provider: "hubspot", category: "productivity", requiresConnection: true, oauthProvider: "hubspot" },
  // Salesforce
  { id: "salesforce-leads", label: "List Leads", description: "View Salesforce leads", icon: Users, provider: "salesforce", category: "productivity", requiresConnection: true, oauthProvider: "salesforce" },
  // Airtable
  { id: "airtable-list", label: "List Records", description: "List Airtable records", icon: Database, provider: "airtable", category: "productivity", requiresConnection: true, oauthProvider: "airtable" },
  { id: "airtable-create", label: "Create Record", description: "Create an Airtable record", icon: Plus, provider: "airtable", category: "productivity", requiresConnection: true, oauthProvider: "airtable" },
  // Asana
  { id: "asana-tasks", label: "List Tasks", description: "View Asana tasks", icon: CheckCircle, provider: "asana", category: "productivity", requiresConnection: true, oauthProvider: "asana" },
  { id: "asana-create", label: "Create Task", description: "Create an Asana task", icon: Plus, provider: "asana", category: "productivity", requiresConnection: true, oauthProvider: "asana" },
  // Local tools (no auth required)
  { id: "local-bash", label: "Run Command", description: "Execute a bash command in sandbox", icon: Terminal, provider: "local", category: "dev", requiresConnection: false },
  { id: "local-file", label: "Read File", description: "Read a file from the workspace", icon: FileText, provider: "local", category: "dev", requiresConnection: false },
  { id: "local-webhook", label: "Trigger Webhook", description: "Fire a webhook to any URL", icon: Webhook, provider: "local", category: "dev", requiresConnection: false },
];

// Provider display metadata
const PROVIDER_META: Record<string, { name: string; icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string; borderColor: string }> = {
  gmail: { name: "Gmail", icon: Mail, color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/20" },
  googlecalendar: { name: "Calendar", icon: Calendar, color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20" },
  googledrive: { name: "Drive", icon: Cloud, color: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/20" },
  googledocs: { name: "Docs", icon: FileText, color: "text-blue-300", bgColor: "bg-blue-400/10", borderColor: "border-blue-400/20" },
  googlesheets: { name: "Sheets", icon: BarChart3, color: "text-green-300", bgColor: "bg-green-400/10", borderColor: "border-green-400/20" },
  github: { name: "GitHub", icon: Github, color: "text-white/80", bgColor: "bg-white/5", borderColor: "border-white/15" },
  slack: { name: "Slack", icon: MessageSquare, color: "text-purple-400", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/20" },
  discord: { name: "Discord", icon: MessageSquare, color: "text-indigo-400", bgColor: "bg-indigo-500/10", borderColor: "border-indigo-500/20" },
  twitter: { name: "Twitter/X", icon: Twitter, color: "text-sky-400", bgColor: "bg-sky-500/10", borderColor: "border-sky-500/20" },
  spotify: { name: "Spotify", icon: Music, color: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/20" },
  twilio: { name: "Twilio", icon: Phone, color: "text-red-300", bgColor: "bg-red-400/10", borderColor: "border-red-400/20" },
  reddit: { name: "Reddit", icon: Globe, color: "text-orange-400", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/20" },
  linkedin: { name: "LinkedIn", icon: Share2, color: "text-blue-500", bgColor: "bg-blue-600/10", borderColor: "border-blue-600/20" },
  vercel: { name: "Vercel", icon: Upload, color: "text-white/80", bgColor: "bg-white/5", borderColor: "border-white/15" },
  railway: { name: "Railway", icon: Upload, color: "text-purple-300", bgColor: "bg-purple-400/10", borderColor: "border-purple-400/20" },
  exa: { name: "Exa Search", icon: Search, color: "text-cyan-400", bgColor: "bg-cyan-500/10", borderColor: "border-cyan-500/20" },
  notion: { name: "Notion", icon: FileText, color: "text-white/80", bgColor: "bg-white/5", borderColor: "border-white/15" },
  dropbox: { name: "Dropbox", icon: Cloud, color: "text-blue-300", bgColor: "bg-blue-400/10", borderColor: "border-blue-400/20" },
  stripe: { name: "Stripe", icon: BarChart3, color: "text-indigo-400", bgColor: "bg-indigo-500/10", borderColor: "border-indigo-500/20" },
  zoom: { name: "Zoom", icon: Video, color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20" },
  linear: { name: "Linear", icon: GitBranch, color: "text-purple-300", bgColor: "bg-purple-400/10", borderColor: "border-purple-400/20" },
  jira: { name: "Jira", icon: GitBranch, color: "text-blue-300", bgColor: "bg-blue-400/10", borderColor: "border-blue-400/20" },
  hubspot: { name: "HubSpot", icon: Users, color: "text-orange-400", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/20" },
  salesforce: { name: "Salesforce", icon: Database, color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20" },
  airtable: { name: "Airtable", icon: Database, color: "text-yellow-400", bgColor: "bg-yellow-500/10", borderColor: "border-yellow-500/20" },
  asana: { name: "Asana", icon: CheckCircle, color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/20" },
  local: { name: "Local", icon: Terminal, color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/20" },
};

// ---------------------------------------------------------------------------
// Action card component
// ---------------------------------------------------------------------------

function ActionCard({
  action,
  connected,
  onExecute,
  onConnect,
  viewMode,
  index,
}: {
  action: ActionItem;
  connected: boolean;
  onExecute: (action: ActionItem) => void;
  onConnect: (provider: string) => void;
  viewMode: ViewMode;
  index: number;
}) {
  const [executing, setExecuting] = useState(false);
  const meta = PROVIDER_META[action.provider] || PROVIDER_META.local;
  const Icon = action.icon;

  const handleClick = async () => {
    if (action.requiresConnection && !connected) {
      onConnect(action.oauthProvider || action.provider);
      return;
    }
    setExecuting(true);
    try {
      await onExecute(action);
    } finally {
      setExecuting(false);
    }
  };

  if (viewMode === "zine") {
    return (
      <motion.button
        initial={{ opacity: 0, y: 20, rotate: -1 + Math.random() * 2 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.4, delay: index * 0.03 }}
        onClick={handleClick}
        disabled={executing}
        className={
          "group relative text-left rounded-2xl border backdrop-blur-md p-5 transition-all duration-300 " +
          "hover:shadow-xl hover:shadow-white/5 hover:border-white/20 hover:-translate-y-1 " +
          (connected ? meta.bgColor + " " + meta.borderColor : "bg-white/[0.02] border-white/[0.06]") +
          (executing ? " opacity-70 pointer-events-none" : "")
        }
      >
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-gradient-to-br from-white/[0.02] to-transparent -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className={"shrink-0 w-10 h-10 rounded-xl flex items-center justify-center " + meta.bgColor + " border " + meta.borderColor}>
            {executing ? <Loader2 className={"w-5 h-5 animate-spin " + meta.color} /> : <Icon className={"w-5 h-5 " + meta.color} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-white/90">{action.label}</span>
              {!connected && action.requiresConnection && (
                <Lock className="w-3 h-3 text-white/30" />
              )}
              {connected && (
                <Unlock className="w-3 h-3 text-green-400/60" />
              )}
            </div>
            <p className="text-xs text-white/50 leading-relaxed">{action.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className={"text-[9px] px-1.5 py-0 " + meta.borderColor + " " + meta.color}>{meta.name}</Badge>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-white/10 text-white/30">{action.category}</Badge>
            </div>
          </div>
          <div className="shrink-0 self-center">
            {!connected && action.requiresConnection ? (
              <Button size="sm" variant="outline" className="h-7 text-[10px] border-white/15 text-white/60 hover:bg-white/10 hover:text-white" onClick={(e) => { e.stopPropagation(); onConnect(action.oauthProvider || action.provider); }}>
                <Lock className="w-2.5 h-2.5 mr-1" /> Connect
              </Button>
            ) : (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowRight className="w-4 h-4 text-white/40" />
              </div>
            )}
          </div>
        </div>
      </motion.button>
    );
  }

  if (viewMode === "grid") {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ delay: index * 0.02 }}
        onClick={handleClick}
        disabled={executing}
        className={
          "group relative text-left rounded-xl border backdrop-blur-md p-4 transition-all duration-200 " +
          "hover:shadow-lg hover:shadow-white/5 hover:border-white/20 " +
          (connected ? meta.bgColor + " " + meta.borderColor : "bg-white/[0.02] border-white/[0.06]")
        }
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className={"w-12 h-12 rounded-xl flex items-center justify-center " + meta.bgColor + " border " + meta.borderColor}>
            {executing ? <Loader2 className={"w-6 h-6 animate-spin " + meta.color} /> : <Icon className={"w-6 h-6 " + meta.color} />}
          </div>
          <div>
            <p className="text-xs font-semibold text-white/90 mb-0.5">{action.label}</p>
            <p className="text-[10px] text-white/40">{meta.name}</p>
          </div>
          {!connected && action.requiresConnection && (
            <Badge variant="outline" className="text-[8px] border-yellow-500/30 text-yellow-400">Connect</Badge>
          )}
        </div>
      </motion.button>
    );
  }

  // List mode
  return (
    <motion.button
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ delay: index * 0.02 }}
      onClick={handleClick}
      disabled={executing}
      className={
        "group w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-200 " +
        "hover:bg-white/5 hover:border-white/15 " +
        (connected ? meta.borderColor + " border-opacity-50" : "border-white/[0.06]")
      }
    >
      <div className={"shrink-0 w-8 h-8 rounded-lg flex items-center justify-center " + meta.bgColor + " border " + meta.borderColor}>
        {executing ? <Loader2 className={"w-4 h-4 animate-spin " + meta.color} /> : <Icon className={"w-4 h-4 " + meta.color} />}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-white/80 font-medium">{action.label}</span>
        <span className="text-xs text-white/40 ml-2">{meta.name}</span>
      </div>
      {!connected && action.requiresConnection ? (
        <Lock className="w-3 h-3 text-white/25 shrink-0" />
      ) : (
        <Play className="w-3 h-3 text-white/25 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Execution result toast
// ---------------------------------------------------------------------------

function showExecutionResult(result: ActionResult, actionLabel: string) {
  if (result.success) {
    toast.success(actionLabel + ": " + result.message, { duration: 3000 });
  } else {
    toast.error(actionLabel + ": " + result.message, { duration: 5000 });
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CommandDeckPlugin() {
  const [platformStatuses, setPlatformStatuses] = useState<Record<string, PlatformStatus>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("zine");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [executionLog, setExecutionLog] = useState<Array<{ action: string; result: ActionResult }>>([]);
  const [showLog, setShowLog] = useState(false);
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { const s = localStorage.getItem("command-deck-pins"); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
  });

  // Fetch connection statuses on mount
  const fetchStatuses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/connections");
      if (res.ok) {
        const data = await res.json();
        const statuses: Record<string, PlatformStatus> = {};
        if (data.connections && Array.isArray(data.connections)) {
          for (const conn of data.connections) {
            statuses[conn.provider] = {
              provider: conn.provider,
              connected: conn.isActive || conn.connected || false,
              source: conn.source || "oauth",
              lastChecked: Date.now(),
            };
          }
        }
        setPlatformStatuses(statuses);
      }
    } catch {
      // Fallback: mark all as disconnected
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  // Group actions by provider
  const providers = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const action of PLATFORM_ACTIONS) {
      const list = map.get(action.provider) || [];
      list.push(action);
      map.set(action.provider, list);
    }
    return map;
  }, []);

  // Filtered actions
  const filteredActions = useMemo(() => {
    let actions = PLATFORM_ACTIONS;

    if (filter === "connected") {
      actions = actions.filter(a => !a.requiresConnection || platformStatuses[a.provider]?.connected);
    } else if (filter === "available") {
      actions = actions.filter(a => !a.requiresConnection);
    } else if (filter !== "all") {
      actions = actions.filter(a => a.category === filter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      actions = actions.filter(a =>
        a.label.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.provider.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    }

    return actions;
  }, [filter, searchQuery, platformStatuses]);

  // Stats
  const stats = useMemo(() => {
    const totalProviders = providers.size;
    const connectedProviders = Object.values(platformStatuses).filter(s => s.connected).length;
    const totalActions = PLATFORM_ACTIONS.length;
    const executableActions = PLATFORM_ACTIONS.filter(a => !a.requiresConnection || platformStatuses[a.provider]?.connected).length;
    return { totalProviders, connectedProviders, totalActions, executableActions, pinned: pinnedIds.size };
  }, [platformStatuses, providers, pinnedIds]);

  // Persist pinned IDs to localStorage
  useEffect(() => {
    try { localStorage.setItem("command-deck-pins", JSON.stringify([...pinnedIds])); } catch {}
  }, [pinnedIds]);

  // Connection polling every 60s
  useEffect(() => {
    const interval = setInterval(fetchStatuses, 60000);
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  // Keyboard shortcut: Ctrl+K to focus search, Escape to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Connect provider (defined before handleExecute to avoid ref issues)
  const handleConnect = useCallback((provider: string) => {
    toast.info("Opening OAuth for " + (PROVIDER_META[provider]?.name || provider));
    window.dispatchEvent(new CustomEvent("open-integrations", { detail: { provider } }));
  }, []);

   // Execute action
   const handleExecute = useCallback(async (action: ActionItem) => {
     // For local actions, prompt the user for input
     let params: Record<string, unknown> = {};

     if (action.provider === 'local') {
       if (action.id === 'local-bash') {
         const command = prompt('Enter bash command to execute:');
         if (!command) return; // User cancelled
         params = { command };
       } else if (action.id === 'local-file') {
         const path = prompt('Enter file path to read (e.g., src/index.ts):');
         if (!path) return;
         params = { path };
       } else if (action.id === 'local-webhook') {
         const url = prompt('Enter webhook URL:');
         if (!url) return;
         params = { url, method: 'POST' };
       }
     }

     const result: ActionResult = {
       success: false,
       message: "Connecting to " + action.provider + "...",
       timestamp: Date.now(),
     };

     try {
       const res = await fetch("/api/integrations/execute", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           provider: action.provider,
           action: action.id.split("-").slice(1).join("_"),
           params,
         }),
       });

       if (res.ok) {
         const data = await res.json();
         result.success = data.success !== false;
         result.message = (data.message || data.output) ? "Executed successfully" : "Action triggered";
         result.data = data.output || data;
       } else {
         const err = await res.json().catch(() => ({}));
         result.message = err.error || "Execution failed (HTTP " + res.status + ")";
         if (res.status === 401 || err.requiresAuth) {
           result.message = "Connection required — redirecting to OAuth...";
           toast.info("Connect " + PROVIDER_META[action.provider]?.name + " to use this action");
           handleConnect(action.provider);
           return;
         }
       }
     } catch (err) {
       result.message = err instanceof Error ? err.message : "Network error";
     }

     setExecutionLog(prev => [{ action: action.label, result }, ...prev].slice(0, 50));
     showExecutionResult(result, action.label);
   }, [handleConnect]);

  // Toggle pin
  const handleTogglePin = useCallback((id: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Toggle provider expansion
  const toggleProvider = (provider: string) => {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider); else next.add(provider);
      return next;
    });
  };

  const filterOptions: Array<{ value: FilterMode; label: string }> = [
    { value: "all", label: "All" },
    { value: "connected", label: "Connected" },
    { value: "available", label: "No Auth" },
    { value: "email", label: "Email" },
    { value: "social", label: "Social" },
    { value: "dev", label: "Dev" },
    { value: "productivity", label: "Work" },
    { value: "media", label: "Media" },
    { value: "web", label: "Web" },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 bg-gradient-to-r from-amber-500/5 via-transparent to-rose-500/5">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ rotate: [0, 15, -15, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                <Command className="h-5 w-5 text-amber-400" />
              </motion.div>
              <h2 className="text-base font-bold text-white/90">Command Deck</h2>
              <Badge variant="secondary" className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/20">
                {stats.executableActions}/{stats.totalActions} ready
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setShowLog(!showLog)} className="h-7 text-xs hover:bg-white/10" title="Execution log">
                <Eye className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={fetchStatuses} className="h-7 text-xs hover:bg-white/10" title="Refresh connections">
                <RefreshCw className={"h-3 w-3" + (loading ? " animate-spin" : "")} />
              </Button>
              <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5 ml-1">
                {(["zine", "grid", "list"] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={"px-2 py-1 text-[10px] rounded-md transition-all " + (viewMode === mode ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70")}
                  >
                    {mode === "zine" ? <Sparkles className="h-3 w-3" /> : mode === "grid" ? <LayoutGrid className="h-3 w-3" /> : <List className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="flex items-center gap-1 text-[10px] text-green-300">
              <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
              {stats.connectedProviders} connected
            </span>
            <span className="flex items-center gap-1 text-[10px] text-white/30">
              <Globe className="h-2.5 w-2.5" />
              {stats.totalProviders} platforms
            </span>
            <span className="flex items-center gap-1 text-[10px] text-amber-300">
              <Zap className="h-2.5 w-2.5" />
              {stats.executableActions} actions ready
            </span>
            {stats.pinned > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-yellow-300">
                <Star className="h-2.5 w-2.5" fill="currentColor" />
                {stats.pinned} pinned
              </span>
            )}
          </div>

          {/* Search + filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-white/25" />
              <Input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search actions... (Ctrl+K)"
                className="h-7 text-xs bg-white/5 border-white/10 text-white/90 placeholder:text-white/25 pl-8 pr-7"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex gap-1">
              {filterOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={"px-2 py-1 text-[10px] rounded-md transition-all whitespace-nowrap " + (filter === opt.value ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Actions area */}
        <ScrollArea className="flex-1">
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-white/30" />
              </div>
            ) : viewMode === "zine" ? (
              /* Zine mode: asymmetric grid by provider */
              <div className="space-y-6">
                {Array.from(providers.entries()).map(([provider, actions]) => {
                  const filteredProviderActions = actions.filter(a => filteredActions.includes(a));
                  if (filteredProviderActions.length === 0) return null;
                  const meta = PROVIDER_META[provider] || PROVIDER_META.local;
                  const connected = platformStatuses[provider]?.connected || false;
                  const isExpanded = expandedProviders.has(provider) || filteredProviderActions.length <= 3;

                  return (
                    <motion.div key={provider} layout className="space-y-2">
                      <button
                        onClick={() => toggleProvider(provider)}
                        className="flex items-center gap-2 w-full text-left group"
                      >
                        <div className={"w-6 h-6 rounded-md flex items-center justify-center " + meta.bgColor + " border " + meta.borderColor}>
                          <meta.icon className={"w-3.5 h-3.5 " + meta.color} />
                        </div>
                        <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">{meta.name}</span>
                        {connected ? (
                          <Badge variant="secondary" className="text-[8px] bg-green-500/15 text-green-400 border border-green-500/20 px-1 py-0">connected</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[8px] bg-white/5 text-white/30 border border-white/10 px-1 py-0">not connected</Badge>
                        )}
                        <span className="text-[10px] text-white/20 ml-auto">{filteredProviderActions.length} actions</span>
                        {filteredProviderActions.length > 3 && (
                          isExpanded ? <ChevronUp className="w-3 h-3 text-white/30" /> : <ChevronDown className="w-3 h-3 text-white/30" />
                        )}
                      </button>
                      {isExpanded && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-2">
                          <AnimatePresence mode="popLayout">
                            {filteredProviderActions.map((action, i) => (
                              <ActionCard
                                key={action.id}
                                action={action}
                                connected={connected}
                                onExecute={handleExecute}
                                onConnect={handleConnect}
                                viewMode="zine"
                                index={i}
                              />
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                <AnimatePresence mode="popLayout">
                  {filteredActions.map((action, i) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      connected={platformStatuses[action.provider]?.connected || false}
                      onExecute={handleExecute}
                      onConnect={handleConnect}
                      viewMode="grid"
                      index={i}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              /* List mode */
              <div className="space-y-1">
                <AnimatePresence mode="popLayout">
                  {filteredActions.map((action, i) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      connected={platformStatuses[action.provider]?.connected || false}
                      onExecute={handleExecute}
                      onConnect={handleConnect}
                      viewMode="list"
                      index={i}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {filteredActions.length === 0 && !loading && (
              <div className="text-center py-16">
                <Command className="h-12 w-12 mx-auto text-white/10 mb-4" />
                <p className="text-sm text-white/40">No actions match your filter</p>
                <p className="text-xs text-white/25 mt-1">Try adjusting your search or filter</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Execution log sidebar */}
        <AnimatePresence>
          {showLog && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 border-l border-white/10 bg-black/20 overflow-hidden"
            >
              <div className="w-[280px] p-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-white/70">Execution Log</span>
                  <button onClick={() => setShowLog(false)} className="text-white/30 hover:text-white/60">
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto">
                  {executionLog.length === 0 ? (
                    <p className="text-[10px] text-white/30 text-center py-4">No executions yet</p>
                  ) : (
                    executionLog.map((entry, i) => (
                      <div key={i} className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                        <div className="flex items-center gap-2 mb-1">
                          {entry.result.success ? (
                            <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                          )}
                          <span className="text-[10px] text-white/70 font-medium truncate">{entry.action}</span>
                        </div>
                        <p className="text-[9px] text-white/40">{entry.result.message}</p>
                        <p className="text-[8px] text-white/20 mt-1">{new Date(entry.result.timestamp).toLocaleTimeString()}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
