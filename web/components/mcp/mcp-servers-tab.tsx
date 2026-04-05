/**
 * MCP Servers Tab — Workspace Panel
 *
 * Curated MCP server browser with:
 * - Pre-loaded server cards (the 9 from mcp.config.json + key-required servers)
 * - Inline API key management via @bing/platform/secrets (IndexedDB + AES-GCM)
 * - Desktop: spawns local npx processes; Web: calls /api/mcp/init server-side
 * - Visual status indicators for connected servers
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Puzzle,
  Terminal,
  Github,
  Database,
  Search,
  Brain,
  Globe,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  Shield,
  Zap,
  HardDrive,
  FolderOpen,
  Link2,
} from "lucide-react";
import { secrets } from "@bing/platform/secrets";

// ─── Server Definition ─────────────────────────────────────────────────────

interface MCPCardDef {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: "built-in" | "needs-key" | "remote";
  /** Env var names that need API keys */
  keyFields?: { envVar: string; label: string; placeholder: string }[];
  /** npx command args for desktop mode */
  npxArgs?: string[];
  /** Whether this server is already in mcp.config.json (auto-installed) */
  autoIncluded?: boolean;
  /** Remote URL for web mode */
  remoteUrl?: string;
}

const MCP_SERVERS: MCPCardDef[] = [
  // ── Built-in (no keys needed, pre-configured in mcp.config.json) ──
  {
    id: "context7",
    name: "Context7",
    description: "Live documentation & framework context injection for any library",
    icon: Globe,
    category: "built-in",
    npxArgs: ["-y", "@upstash/context7-mcp"],
    autoIncluded: true,
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read/write files with project root access",
    icon: FolderOpen,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    autoIncluded: true,
  },
  {
    id: "git",
    name: "Git",
    description: "Repository analysis, blame, log, and diff operations",
    icon: Github,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/mcp-server-git", "."],
    autoIncluded: true,
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "HTTP requests and web API fetching",
    icon: Link2,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/mcp-server-fetch"],
    autoIncluded: true,
  },
  {
    id: "memory",
    name: "Memory",
    description: "Persistent memory storage across sessions",
    icon: HardDrive,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/server-memory"],
    autoIncluded: true,
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Structured reasoning chains for complex tasks",
    icon: Brain,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    autoIncluded: true,
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Local SQLite database querying",
    icon: Database,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/server-sqlite", "./data/app.db"],
    autoIncluded: false,
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Headless browser automation",
    icon: Globe,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/server-puppeteer"],
    autoIncluded: false,
  },
  {
    id: "bash",
    name: "Bash",
    description: "Shell command execution with safety controls",
    icon: Terminal,
    category: "built-in",
    npxArgs: ["-y", "@modelcontextprotocol/server-bash"],
    autoIncluded: false,
  },

  // ── Needs API Key ──
  {
    id: "e2b-mcp",
    name: "E2B Code Interpreter",
    description: "Cloud sandbox for secure code execution",
    icon: Terminal,
    category: "needs-key",
    keyFields: [
      { envVar: "E2B_API_KEY", label: "E2B API Key", placeholder: "e2b_..." },
    ],
    npxArgs: ["-y", "@e2b-dev/mcp-server"],
  },
  {
    id: "github-mcp",
    name: "GitHub MCP",
    description: "Full GitHub API access — repos, issues, PRs, and more",
    icon: Github,
    category: "needs-key",
    keyFields: [
      { envVar: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Token", placeholder: "ghp_..." },
    ],
    npxArgs: ["-y", "@modelcontextprotocol/server-github"],
  },
  {
    id: "arcade-mcp",
    name: "Arcade MCP Gateway",
    description: "Multi-service tool gateway (Google, Slack, GitHub, etc.)",
    icon: Zap,
    category: "needs-key",
    keyFields: [
      { envVar: "ARCADE_API_KEY", label: "Arcade API Key", placeholder: "arcade_..." },
    ],
    remoteUrl: "https://mcp.arcade.dev",
  },
  {
    id: "blaxel-mcp",
    name: "Blaxel MCP",
    description: "Deploy and manage MCP servers on Blaxel cloud",
    icon: Globe,
    category: "needs-key",
    keyFields: [
      { envVar: "BLAXEL_API_KEY", label: "Blaxel API Key", placeholder: "blaxel_..." },
    ],
    npxArgs: ["-y", "blaxel-mcp-server"],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function secretKeyForServer(serverId: string, envVar: string): string {
  return `mcp-key:${serverId}:${envVar}`;
}

function connectionStatusKey(serverId: string): string {
  return `mcp-conn:${serverId}`;
}

// ─── Server Card Component ──────────────────────────────────────────────────

interface ServerCardProps {
  server: MCPCardDef;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: (server: MCPCardDef) => void;
  isDesktop: boolean;
}

function ServerCard({ server, isConnected, isConnecting, onConnect, isDesktop }: ServerCardProps) {
  const Icon = server.icon;
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);

  // Load stored keys on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!server.keyFields) { setKeysLoaded(true); return; }
      const loaded: Record<string, string> = {};
      for (const field of server.keyFields) {
        const val = await secrets.get(secretKeyForServer(server.id, field.envVar));
        loaded[field.envVar] = val || "";
      }
      if (!cancelled) {
        setKeyValues(loaded);
        setKeysLoaded(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [server.id, server.keyFields]);

  const hasRequiredKeys = server.keyFields
    ? server.keyFields.every(f => keyValues[f.envVar]?.trim())
    : true;

  const handleSaveKeys = async () => {
    if (!server.keyFields) return;
    setSavingKeys(true);
    for (const field of server.keyFields) {
      const val = keyValues[field.envVar]?.trim();
      if (val) {
        await secrets.set(secretKeyForServer(server.id, field.envVar), val);
      } else {
        await secrets.remove(secretKeyForServer(server.id, field.envVar));
      }
    }
    setSavingKeys(false);
    // After saving, connect
    onConnect(server);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        group relative rounded-xl border p-4 transition-all
        ${isConnected
          ? "border-green-500/30 bg-green-500/5 shadow-[0_0_12px_rgba(34,197,94,0.08)]"
          : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
        }
      `}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`
          flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
          ${isConnected
            ? "bg-green-500/15 text-green-400"
            : "bg-white/5 text-white/40 group-hover:text-white/60"
          }
        `}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white/90">{server.name}</span>
            {server.autoIncluded && (
              <Badge variant="secondary" className="text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/20">
                bundled
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-white/40 leading-relaxed">{server.description}</p>
        </div>

        {/* Status */}
        <div className="shrink-0">
          {isConnected ? (
            <Badge className="text-[10px] bg-green-500/15 text-green-400 border-green-500/20">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          ) : isConnecting ? (
            <Badge variant="secondary" className="text-[10px] bg-yellow-500/15 text-yellow-400 border-yellow-500/20">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Connecting
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-white/30 border-white/10">
              Idle
            </Badge>
          )}
        </div>
      </div>

      {/* API Key fields (for servers that need them) */}
      {server.keyFields && keysLoaded && (
        <div className="mt-3 space-y-2.5">
          {server.keyFields.map((field) => (
            <div key={field.envVar} className="flex items-center gap-2">
              <Key className="h-3.5 w-3.5 text-white/25 shrink-0" />
              <div className="relative flex-1">
                <Input
                  type={showKeys[field.envVar] ? "text" : "password"}
                  value={keyValues[field.envVar] || ""}
                  onChange={(e) => setKeyValues(prev => ({ ...prev, [field.envVar]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="h-7 text-xs bg-black/40 border-white/10 pr-8 text-white/70 placeholder:text-white/20"
                />
                <button
                  type="button"
                  onClick={() => setShowKeys(prev => ({ ...prev, [field.envVar]: !prev[field.envVar] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50"
                >
                  {showKeys[field.envVar] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}

          {server.keyFields.length > 0 && (
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                onClick={handleSaveKeys}
                disabled={savingKeys || !hasRequiredKeys}
                className="h-6 text-xs bg-white/5 hover:bg-white/10 text-white/60 border border-white/10"
              >
                {savingKeys ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Shield className="h-3 w-3 mr-1" />
                )}
                {hasRequiredKeys ? "Save & Connect" : "Save Keys"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Connect button for no-key servers */}
      {!server.keyFields && (
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            onClick={() => onConnect(server)}
            disabled={isConnecting || isConnected}
            className={`h-6 text-xs border border-white/10 ${
              isConnected
                ? "bg-green-500/10 text-green-400 cursor-default"
                : "bg-white/5 hover:bg-white/10 text-white/60"
            }`}
          >
            {isConnecting ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Connecting…</>
            ) : isConnected ? (
              <><CheckCircle2 className="h-3 w-3 mr-1" /> Connected</>
            ) : (
              <><Zap className="h-3 w-3 mr-1" /> {isDesktop ? "Connect (npx)" : "Enable"}</>
            )}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Tab Component ─────────────────────────────────────────────────────

export function MCPServersTab() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [connectedServers, setConnectedServers] = useState<Set<string>>(new Set());
  const [connectingServers, setConnectingServers] = useState<Set<string>>(new Set());
  const [isInitializing, setIsInitializing] = useState(false);

  // Detect desktop mode
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      try {
        const { isDesktopMode } = await import("@bing/platform/env");
        if (!cancelled) setIsDesktop(isDesktopMode());
      } catch { /* web mode */ }
    }
    detect();
    return () => { cancelled = true; };
  }, []);

  // Check which servers are already connected
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        // Check via API route instead of importing server-only config.ts
        const res = await fetch("/api/mcp/status");
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data.toolCount > 0) {
            const connected = new Set<string>();
            for (const s of MCP_SERVERS) {
              if (s.autoIncluded) connected.add(s.id);
            }
            setConnectedServers(connected);
          }
        }
      } catch { /* not initialized yet */ }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  const handleConnect = useCallback(async (server: MCPCardDef) => {
    setConnectingServers(prev => new Set(prev).add(server.id));

    try {
      // Collect any stored keys for this server
      const envVars: Record<string, string> = {};
      if (server.keyFields) {
        for (const field of server.keyFields) {
          const val = await secrets.get(secretKeyForServer(server.id, field.envVar));
          if (val) envVars[field.envVar] = val;
        }
      }

      if (isDesktop && server.npxArgs) {
        // Desktop: spawn npx via /api/mcp/init which triggers desktop MCP manager
        // We pass the server config with env vars
        await fetch("/api/mcp/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: server.id, envVars }),
        });
      } else {
        // Web mode: call init API which handles server-side
        await fetch("/api/mcp/init", { method: "POST" });
      }

      setConnectedServers(prev => new Set(prev).add(server.id));
    } catch (err) {
      console.error(`[MCP] Failed to connect ${server.id}:`, err);
    } finally {
      setConnectingServers(prev => {
        const next = new Set(prev);
        next.delete(server.id);
        return next;
      });
    }
  }, [isDesktop]);

  const handleConnectAll = async () => {
    setIsInitializing(true);
    try {
      await fetch("/api/mcp/init", { method: "POST" });
      const connected = new Set<string>();
      for (const s of MCP_SERVERS) {
        if (s.autoIncluded) connected.add(s.id);
      }
      setConnectedServers(connected);
    } catch (err) {
      console.error("[MCP] Failed to initialize all servers:", err);
    } finally {
      setIsInitializing(false);
    }
  };

  // Group servers by category
  const builtIn = MCP_SERVERS.filter(s => s.category === "built-in");
  const needsKey = MCP_SERVERS.filter(s => s.category === "needs-key");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
        <div>
          <h3 className="text-sm font-medium text-white/90 flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-white/40" />
            MCP Servers
          </h3>
          <p className="text-[11px] text-white/30 mt-0.5">
            {isDesktop ? "Local npx servers" : "Server-side MCP connections"}
            {" · "}
            {connectedServers.size} connected
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleConnectAll}
          disabled={isInitializing}
          className="h-7 text-xs bg-white/5 hover:bg-white/10 text-white/60 border border-white/10"
        >
          {isInitializing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5 mr-1.5" />
          )}
          Connect All
        </Button>
      </div>

      {/* Server lists */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-5">
        {/* Built-in servers */}
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Shield className="h-3.5 w-3.5 text-blue-400/60" />
            <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">
              Built-in
            </span>
            <Separator className="flex-1 bg-white/5" />
          </div>
          <div className="grid gap-2">
            {builtIn.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                isConnected={connectedServers.has(server.id)}
                isConnecting={connectingServers.has(server.id)}
                onConnect={handleConnect}
                isDesktop={isDesktop}
              />
            ))}
          </div>
        </div>

        {/* Servers that need keys */}
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Key className="h-3.5 w-3.5 text-yellow-400/60" />
            <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">
              Requires API Key
            </span>
            <Separator className="flex-1 bg-white/5" />
          </div>
          <div className="grid gap-2">
            {needsKey.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                isConnected={connectedServers.has(server.id)}
                isConnecting={connectingServers.has(server.id)}
                onConnect={handleConnect}
                isDesktop={isDesktop}
              />
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="pb-4 pt-2">
          <p className="text-[10px] text-white/20 text-center leading-relaxed">
            {isDesktop
              ? "Desktop mode: servers spawn as local npx processes. API keys are stored encrypted in IndexedDB."
              : "Web mode: MCP connections are handled server-side. API keys are stored encrypted in IndexedDB and passed to the server."}
          </p>
        </div>
      </div>
    </div>
  );
}
