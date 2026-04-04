"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  ExternalLink,
  Check,
  X,
  Loader2,
  Key,
  Zap,
  MessageCircle,
  Mail,
  Send,
  FileText,
  Github,
  Linkedin,
  Twitter,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

// Import existing OAuth infrastructure
import { toolAuthManager } from "@/lib/tools/tool-authorization-manager";
import {
  TOOL_PROVIDER_MAP,
  getAuthorizationUrlForPlatform,
  ARCADE_PLATFORMS,
  NANGO_PLATFORMS,
} from "@/lib/oauth/provider-map";
import type { ZineFragment } from "./zine-engine";
import { createFragment, getTemplate } from "./zine-engine";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface OAuthProvider {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  scopes: string[];
  service: "arcade" | "nango" | "composio" | "auth0";
}

interface OAuthConnection {
  provider: string;
  connected: boolean;
  userId?: string;
  lastSync?: number;
  error?: string;
}

interface ZineNotification {
  id: string;
  source: string;
  sourceName: string;
  content: string;
  author?: string;
  timestamp: number;
  priority: "low" | "normal" | "high";
  url?: string;
}

// ---------------------------------------------------------------------
// Available OAuth Providers for Zine Display
// ---------------------------------------------------------------------

const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: "discord",
    name: "Discord",
    icon: <MessageCircle className="w-4 h-4" />,
    color: "bg-[#5865F2]",
    description: "Get notifications from Discord channels and DMs",
    scopes: ["messages.read", "channels.read"],
    service: "nango",
  },
  {
    id: "gmail",
    name: "Gmail",
    icon: <Mail className="w-4 h-4" />,
    color: "bg-[#EA4335]",
    description: "Receive email notifications and summaries",
    scopes: ["gmail.readonly", "gmail.send"],
    service: "arcade",
  },
  {
    id: "slack",
    name: "Slack",
    icon: <Send className="w-4 h-4" />,
    color: "bg-[#4A154B]",
    description: "Get Slack messages and channel updates",
    scopes: ["channels:history", "chat:write"],
    service: "nango",
  },
  {
    id: "github",
    name: "GitHub",
    icon: <Github className="w-4 h-4" />,
    color: "bg-[#333]",
    description: "Notifications for PRs, issues, and repos",
    scopes: ["notifications", "repo"],
    service: "nango",
  },
  {
    id: "twitter",
    name: "Twitter/X",
    icon: <Twitter className="w-4 h-4" />,
    color: "bg-[#1DA1F2]",
    description: "Timeline updates and mentions",
    scopes: ["tweet.read", "users.read"],
    service: "nango",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    icon: <Linkedin className="w-4 h-4" />,
    color: "bg-[#0A66C2]",
    description: "Connection requests and job alerts",
    scopes: ["r_network", "r_emailaddress"],
    service: "nango",
  },
  {
    id: "notion",
    name: "Notion",
    icon: <FileText className="w-4 h-4" />,
    color: "bg-[#000000]",
    description: "Updates from connected workspaces",
    scopes: ["read content", "update content"],
    service: "composio",
  },
];

// ---------------------------------------------------------------------
// OAuth Service Hook - connects to existing toolAuthManager
// ---------------------------------------------------------------------

function useZineOAuth(onNotification: (n: ZineNotification) => void) {
  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());

  // Load existing connections on mount
  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    setLoading(true);
    try {
      // Call the existing OAuth API to get user connections
      const res = await fetch("/api/auth/oauth/connections");
      if (res.ok) {
        const data = await res.json();
        const connectedProviders = data.connections || [];
        
        setConnections(
          OAUTH_PROVIDERS.map((p) => ({
            provider: p.id,
            connected: connectedProviders.includes(p.id),
            lastSync: connectedProviders.includes(p.id) ? Date.now() : undefined,
          }))
        );
      } else {
        // Initialize with all disconnected
        setConnections(
          OAUTH_PROVIDERS.map((p) => ({
            provider: p.id,
            connected: false,
          }))
        );
      }
    } catch {
      setConnections(
        OAUTH_PROVIDERS.map((p) => ({
          provider: p.id,
          connected: false,
        }))
      );
    }
    setLoading(false);
  };

  const initiateOAuth = async (providerId: string) => {
    const provider = OAUTH_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    setSyncing((prev) => new Set(prev).add(providerId));
    
    try {
      // Use the existing OAuth initiation endpoint
      const res = await fetch("/api/auth/oauth/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          provider: providerId,
          redirect: true,
          purpose: "zine-display-notifications",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.authUrl) {
          // Open OAuth in popup or redirect
          window.open(data.authUrl, "_blank", "width=600,height=700");
          toast.success(`Connecting ${provider.name}... Check the popup window.`);
          
          // Poll for connection status
          pollForConnection(providerId);
        }
      } else {
        const data = await res.json();
        toast.error(data.message || `Failed to connect ${provider.name}`);
      }
    } catch (error) {
      toast.error(`Failed to initiate ${provider.name} connection`);
    } finally {
      setSyncing((prev) => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
    }
  };

  const pollForConnection = async (providerId: string, attempts = 0) => {
    if (attempts > 20) {
      toast.error("Connection timed out. Please try again.");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
      const res = await fetch("/api/auth/oauth/connections");
      if (res.ok) {
        const data = await res.json();
        if (data.connections?.includes(providerId)) {
          setConnections((prev) =>
            prev.map((c) =>
              c.provider === providerId
                ? { ...c, connected: true, lastSync: Date.now() }
                : c
            )
          );
          toast.success(`Connected to ${providerId}!`);
          
          // Start polling for notifications
          startNotificationPolling(providerId);
          return;
        }
      }
    } catch {
      // Continue polling
    }

    pollForConnection(providerId, attempts + 1);
  };

  const startNotificationPolling = (providerId: string) => {
    // In a real implementation, this would start a polling interval
    // that fetches new data from the connected service
    console.log(`[ZineOAuth] Started polling for ${providerId}`);
    
    // For demo, emit some mock notifications
    setTimeout(() => {
      onNotification({
        id: `notif-${providerId}-${Date.now()}`,
        source: providerId,
        sourceName: OAUTH_PROVIDERS.find((p) => p.id === providerId)?.name || providerId,
        content: `✅ Successfully connected to ${providerId}! You'll receive notifications here.`,
        timestamp: Date.now(),
        priority: "normal",
      });
    }, 2000);
  };

  const disconnect = async (providerId: string) => {
    try {
      const res = await fetch("/api/auth/oauth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });

      if (res.ok) {
        setConnections((prev) =>
          prev.map((c) =>
            c.provider === providerId
              ? { ...c, connected: false, lastSync: undefined }
              : c
          )
        );
        toast.success(`Disconnected from ${providerId}`);
      }
    } catch {
      toast.error(`Failed to disconnect ${providerId}`);
    }
  };

  const syncProvider = async (providerId: string) => {
    setSyncing((prev) => new Set(prev).add(providerId));
    
    try {
      // Fetch latest data from the provider
      const res = await fetch(`/api/zine-display/feed?action=fetch&source=${providerId}-notifications`);
      
      if (res.ok) {
        const data = await res.json();
        if (data.items?.length) {
          for (const item of data.items.slice(0, 3)) {
            onNotification({
              id: `notif-${providerId}-${Date.now()}-${Math.random()}`,
              source: providerId,
              sourceName: OAUTH_PROVIDERS.find((p) => p.id === providerId)?.name || providerId,
              content: item.content,
              author: item.author,
              timestamp: item.timestamp || Date.now(),
              priority: item.type === "announcement" ? "high" : "normal",
              url: item.url,
            });
          }
        }
        
        setConnections((prev) =>
          prev.map((c) =>
            c.provider === providerId ? { ...c, lastSync: Date.now() } : c
          )
        );
        
        toast.success(`Synced latest from ${providerId}`);
      }
    } catch (error) {
      toast.error(`Failed to sync ${providerId}`);
    } finally {
      setSyncing((prev) => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
    }
  };

  return {
    connections,
    loading,
    syncing,
    initiateOAuth,
    disconnect,
    syncProvider,
    refresh: loadConnections,
  };
}

// ---------------------------------------------------------------------
// Provider Card Component
// ---------------------------------------------------------------------

interface ProviderCardProps {
  provider: OAuthProvider;
  connection: OAuthConnection;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  isSyncing: boolean;
}

function ProviderCard({
  provider,
  connection,
  onConnect,
  onDisconnect,
  onSync,
  isSyncing,
}: ProviderCardProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-white ${provider.color}`}>
          {provider.icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-white/90 truncate">
              {provider.name}
            </span>
            {connection.connected && (
              <Badge
                variant="secondary"
                className="text-[8px] px-1 py-0 h-4 bg-green-500/20 text-green-400 border border-green-500/30"
              >
                <Check className="w-2 h-2 mr-0.5" />
                Connected
              </Badge>
            )}
          </div>
          <p className="text-[9px] text-white/40 truncate">{provider.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {connection.connected ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSync}
              disabled={isSyncing}
              className="h-6 px-2 text-[10px] text-white/50 hover:text-white/80"
              title="Sync now"
            >
              {isSyncing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              className="h-6 px-2 text-[10px] text-white/40 hover:text-red-400"
              title="Disconnect"
            >
              <X className="w-3 h-3" />
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onConnect}
            disabled={isSyncing}
            className="h-6 px-2 text-[10px] text-white/60 hover:text-white/90 bg-white/5 hover:bg-white/10"
          >
            {isSyncing ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <ExternalLink className="w-3 h-3 mr-1" />
            )}
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Main OAuth Integration Panel
// ---------------------------------------------------------------------

interface ZineOAuthIntegrationProps {
  onNotification: (notification: ZineNotification) => void;
}

export function ZineOAuthIntegration({ onNotification }: ZineOAuthIntegrationProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showOnlyConnected, setShowOnlyConnected] = useState(false);

  const {
    connections,
    loading,
    syncing,
    initiateOAuth,
    disconnect,
    syncProvider,
  } = useZineOAuth(onNotification);

  const filteredProviders = showOnlyConnected
    ? OAUTH_PROVIDERS.filter((p) => connections.find((c) => c.provider === p.id)?.connected)
    : OAUTH_PROVIDERS;

  const connectedCount = connections.filter((c) => c.connected).length;

  return (
    <div className="border-t border-white/[0.06] bg-black/20">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-white/50" />
          <span className="text-xs text-white/50 font-medium">
            OAuth Connections
          </span>
          {connectedCount > 0 && (
            <Badge
              variant="secondary"
              className="text-[9px] px-1.5 py-0 h-4 bg-purple-500/20 text-purple-300 border border-purple-400/30"
            >
              {connectedCount} connected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {connectedCount > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowOnlyConnected(!showOnlyConnected);
              }}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                showOnlyConnected
                  ? "text-white/80 bg-white/10"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              {showOnlyConnected ? "Show all" : "Show connected"}
            </button>
          )}
          <Zap className={`w-3.5 h-3.5 text-white/30 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Quick Stats */}
                  <div className="flex items-center gap-3 text-[10px] text-white/40">
                    <span>{connections.filter((c) => c.connected).length} platforms connected</span>
                    <span>•</span>
                    <span>Real-time notifications enabled</span>
                  </div>

                  {/* Provider List */}
                  <div className="space-y-1.5">
                    {filteredProviders.map((provider) => {
                      const connection = connections.find(
                        (c) => c.provider === provider.id
                      ) || { provider: provider.id, connected: false };

                      return (
                        <ProviderCard
                          key={provider.id}
                          provider={provider}
                          connection={connection}
                          onConnect={() => initiateOAuth(provider.id)}
                          onDisconnect={() => disconnect(provider.id)}
                          onSync={() => syncProvider(provider.id)}
                          isSyncing={syncing.has(provider.id)}
                        />
                      );
                    })}
                  </div>

                  {/* Info Text */}
                  <div className="flex items-start gap-2 p-2 rounded bg-blue-500/5 border border-blue-500/10">
                    <AlertCircle className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-[9px] text-blue-300/70 leading-tight">
                      Connect your accounts to receive notifications in the Zine Display. 
                      OAuth tokens are stored securely and used only for notification fetching.
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------
// Notification Display Component
// ---------------------------------------------------------------------

interface ZineNotificationDisplayProps {
  notifications: ZineNotification[];
  onDismiss: (id: string) => void;
}

export function ZineNotificationDisplay({
  notifications,
  onDismiss,
}: ZineNotificationDisplayProps) {
  if (notifications.length === 0) return null;

  return (
    <div className="space-y-1.5 p-3">
      {notifications.slice(-10).reverse().map((notif) => {
        const provider = OAUTH_PROVIDERS.find((p) => p.id === notif.source);
        
        return (
          <motion.div
            key={notif.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className={`p-2 rounded-md border-l-2 ${
              notif.priority === "high"
                ? "bg-red-500/5 border-red-500/40"
                : notif.priority === "low"
                ? "bg-white/[0.02] border-white/10"
                : "bg-white/[0.03] border-white/20"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {provider && (
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-white text-[8px] shrink-0 ${provider.color}`}>
                    {provider.icon}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-medium text-white/60 truncate">
                      {notif.sourceName}
                    </span>
                    {notif.author && (
                      <span className="text-[8px] text-white/30">
                        • {notif.author}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-white/80 leading-snug truncate">
                    {notif.content}
                  </p>
                </div>
              </div>
              <button
                onClick={() => onDismiss(notif.id)}
                className="shrink-0 text-white/30 hover:text-white/50 transition-colors"
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

export type { ZineNotification, OAuthProvider, OAuthConnection };
