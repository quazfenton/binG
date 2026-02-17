'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Mail, Calendar, FileText, Github, Twitter, MessageSquare, 
  Music, Cloud, MapPin, Search, Phone, Database, CheckCircle,
  XCircle, ExternalLink, RefreshCw, Plus, Trash2, Shield
} from 'lucide-react';
import { toast } from 'sonner';

interface Integration {
  id: string;
  name: string;
  provider: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  connected: boolean;
  scopes: string[];
  authUrl?: string;
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'google',
    name: 'Google Workspace',
    provider: 'google',
    description: 'Access Gmail, Calendar, Drive, Docs, and Sheets',
    icon: <Mail className="w-5 h-5" />,
    category: 'Productivity',
    connected: false,
    scopes: ['gmail', 'calendar', 'drive', 'docs', 'sheets']
  },
  {
    id: 'github',
    name: 'GitHub',
    provider: 'github',
    description: 'Create issues, manage repositories, and review code',
    icon: <Github className="w-5 h-5" />,
    category: 'Development',
    connected: false,
    scopes: ['repo', 'issues', 'pull_requests']
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    provider: 'twitter',
    description: 'Post tweets and search for content',
    icon: <Twitter className="w-5 h-5" />,
    category: 'Social',
    connected: false,
    scopes: ['tweet', 'read']
  },
  {
    id: 'slack',
    name: 'Slack',
    provider: 'slack',
    description: 'Send messages to Slack channels',
    icon: <MessageSquare className="w-5 h-5" />,
    category: 'Communication',
    connected: false,
    scopes: ['chat:write', 'channels:read']
  },
  {
    id: 'spotify',
    name: 'Spotify',
    provider: 'spotify',
    description: 'Control playback and search for music',
    icon: <Music className="w-5 h-5" />,
    category: 'Entertainment',
    connected: false,
    scopes: ['playback', 'search']
  },
  {
    id: 'notion',
    name: 'Notion',
    provider: 'notion',
    description: 'Create and update Notion pages and databases',
    icon: <FileText className="w-5 h-5" />,
    category: 'Productivity',
    connected: false,
    scopes: ['pages', 'databases']
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    provider: 'dropbox',
    description: 'Upload and download files from Dropbox',
    icon: <Cloud className="w-5 h-5" />,
    category: 'Storage',
    connected: false,
    scopes: ['files']
  },
  {
    id: 'exa',
    name: 'Exa Search',
    provider: 'exa',
    description: 'Advanced web search and content discovery',
    icon: <Search className="w-5 h-5" />,
    category: 'Search',
    connected: false,
    scopes: ['search']
  },
  {
    id: 'twilio',
    name: 'Twilio',
    provider: 'twilio',
    description: 'Send SMS messages and make calls',
    icon: <Phone className="w-5 h-5" />,
    category: 'Communication',
    connected: false,
    scopes: ['sms', 'calls']
  },
  {
    id: 'vercel',
    name: 'Vercel',
    provider: 'vercel',
    description: 'Deploy projects and manage deployments',
    icon: <Cloud className="w-5 h-5" />,
    category: 'Development',
    connected: false,
    scopes: ['deployments']
  },
  {
    id: 'railway',
    name: 'Railway',
    provider: 'railway',
    description: 'Deploy applications to Railway',
    icon: <Database className="w-5 h-5" />,
    category: 'Development',
    connected: false,
    scopes: ['deployments']
  },
  {
    id: 'discord',
    name: 'Discord',
    provider: 'discord',
    description: 'Send messages to Discord channels',
    icon: <MessageSquare className="w-5 h-5" />,
    category: 'Communication',
    connected: false,
    scopes: ['bot', 'messages']
  }
];

interface IntegrationPanelProps {
  userId?: string;
  onClose?: () => void;
}

export default function IntegrationPanel({ userId, onClose }: IntegrationPanelProps) {
  const [integrations, setIntegrations] = useState<Integration[]>(INTEGRATIONS);
  const [loading, setLoading] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);

  const categories = ['All', ...Array.from(new Set(INTEGRATIONS.map(i => i.category)))];

  useEffect(() => {
    if (userId) {
      fetchConnectedIntegrations();
    }
  }, [userId]);

  useEffect(() => {
    // Listen for OAuth success/cancel messages from popup
    const handleMessage = (event: MessageEvent) => {
      // Validate message origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'oauth_success') {
        setPopupWindow(null);
        setLoading(null);
        fetchConnectedIntegrations();
        toast.success('Integration connected successfully');
      } else if (event.data?.type === 'oauth_cancel') {
        setPopupWindow(null);
        setLoading(null);
        toast.info('Connection cancelled');
      }
    };

    window.addEventListener('message', handleMessage);

    // Only poll for popup close if a popup is actually open
    let interval: number | undefined;
    if (popupWindow) {
      interval = setInterval(() => {
        if (popupWindow.closed) {
          setPopupWindow(null);
          setLoading(null);
          // Popup closed without sending message - treat as cancel
          fetchConnectedIntegrations();
        }
      }, 500);
    }

    return () => {
      if (interval !== undefined) {
        clearInterval(interval);
      }
      window.removeEventListener('message', handleMessage);
    };
  }, [popupWindow]);

  const fetchConnectedIntegrations = async () => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/tools/execute?userId=${userId}`);
      if (response.ok) {
        const data = await response.json();
        const connectedProviders = data.connectedProviders || [];
        
        setIntegrations(prev => prev.map(integration => ({
          ...integration,
          connected: connectedProviders.includes(integration.provider)
        })));
      }
    } catch (error) {
      console.error('Failed to fetch connected integrations:', error);
    }
  };

  const handleConnect = async (integration: Integration) => {
    if (!userId) {
      toast.error('Please sign in to connect integrations');
      return;
    }

    setLoading(integration.id);

    try {
      // Determine the auth endpoint based on provider
      let authEndpoint = `/api/auth/oauth/initiate?provider=${integration.provider}&userId=${userId}`;

      // Check if provider uses Arcade
      const arcadeProviders = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'exa', 'twilio', 'spotify', 'vercel', 'railway'];
      if (arcadeProviders.includes(integration.provider)) {
        try {
          const response = await fetch(`/api/auth/arcade/authorize?provider=${integration.provider}&userId=${userId}`);
          if (response.ok) {
            const data = await response.json();
            authEndpoint = data.authUrl;
          } else {
            toast.error(`Failed to initialize ${integration.name} connection`);
            setLoading(null);
            return;
          }
        } catch {
          toast.error(`Failed to reach authorization service for ${integration.name}`);
          setLoading(null);
          return;
        }
      }

      // Calculate popup position centered on screen
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      // Add origin parameter for postMessage security validation
      const urlWithOrigin = `${authEndpoint}${authEndpoint.includes('?') ? '&' : '?'}origin=${encodeURIComponent(window.location.origin)}`;

      // Open OAuth popup (without noopener to allow window.opener.postMessage communication)
      const popup = window.open(
        urlWithOrigin,
        'oauth_popup',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
      );

      if (popup) {
        setPopupWindow(popup);
        toast.info(`Connecting to ${integration.name}...`);
      } else {
        toast.error('Popup blocked. Please allow popups for this site.');
        setLoading(null);
      }
    } catch (error) {
      console.error('Connection error:', error);
      toast.error(`Failed to connect to ${integration.name}`);
      setLoading(null);
    }
  };

  const handleDisconnect = async (integration: Integration) => {
    if (!userId) return;

    setLoading(integration.id);

    try {
      // Call API to revoke connection
      const response = await fetch(`/api/user/integrations/${integration.provider}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      if (response.ok) {
        setIntegrations(prev => prev.map(i => 
          i.id === integration.id ? { ...i, connected: false } : i
        ));
        toast.success(`Disconnected from ${integration.name}`);
      } else {
        throw new Error('Failed to disconnect');
      }
    } catch (error) {
      toast.error(`Failed to disconnect from ${integration.name}`);
    } finally {
      setLoading(null);
    }
  };

  const filteredIntegrations = selectedCategory === 'All' 
    ? integrations 
    : integrations.filter(i => i.category === selectedCategory);

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-purple-400" />
                Integrations
              </CardTitle>
              <CardDescription className="text-white/60 mt-1">
                Connect third-party services to enable powerful AI-assisted workflows
              </CardDescription>
            </div>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Category Filter */}
          <div className="flex flex-wrap gap-2 mb-6">
            {categories.map(category => (
              <Button
                key={category}
                variant={selectedCategory === category ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(category)}
                className={`text-xs ${
                  selectedCategory === category 
                    ? 'bg-purple-600 hover:bg-purple-700' 
                    : 'bg-white/5 hover:bg-white/10 border-white/20'
                }`}
              >
                {category}
              </Button>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white/5 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">
                {integrations.filter(i => i.connected).length}
              </div>
              <div className="text-xs text-white/60">Connected</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">
                {integrations.length}
              </div>
              <div className="text-xs text-white/60">Available</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">
                {categories.length - 1}
              </div>
              <div className="text-xs text-white/60">Categories</div>
            </div>
          </div>

          {/* Integrations Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredIntegrations.map(integration => (
              <div
                key={integration.id}
                className={`p-4 rounded-lg border transition-all duration-200 ${
                  integration.connected
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      integration.connected ? 'bg-green-500/20' : 'bg-white/10'
                    }`}>
                      {integration.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-white">{integration.name}</h3>
                        {integration.connected && (
                          <Badge variant="outline" className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Connected
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-white/60 mt-1">{integration.description}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {integration.scopes.slice(0, 3).map(scope => (
                          <span key={scope} className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/50">
                            {scope}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    {integration.connected ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisconnect(integration)}
                        disabled={loading === integration.id}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        {loading === integration.id ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnect(integration)}
                        disabled={loading === integration.id || !userId}
                        className="bg-white/10 hover:bg-white/20 border-white/20"
                      >
                        {loading === integration.id ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="w-4 h-4 mr-1" />
                            Connect
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!userId && (
            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-400">
                <Shield className="w-5 h-5" />
                <span className="font-medium">Sign in required</span>
              </div>
              <p className="text-sm text-white/60 mt-1">
                Please sign in to connect and manage integrations.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
