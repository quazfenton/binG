/**
 * Integration Status Dashboard
 * 
 * Shows connection status for all OAuth providers:
 * - Auth0 Connected Accounts (direct API access)
 * - Nango connections
 * - Composio connections  
 * - Arcade connections
 * 
 * Used in settings page and workspace panel to show available integrations.
 */
"use client";

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Connection {
  provider: string;
  connected: boolean;
  source?: 'auth0' | 'nango' | 'composio' | 'arcade';
}

interface IntegrationStatusProps {
  compact?: boolean;
  onConnect?: (provider: string) => void;
}

export function IntegrationStatus({ compact = false, onConnect }: IntegrationStatusProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    // Check Auth0 connection status
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        setAuthenticated(data.authenticated);
        setConnections(data.connections || []);
        setLoading(false);
      })
      .catch(() => {
        setConnections([]);
        setLoading(false);
      });
  }, []);

  const handleConnect = (provider: string) => {
    if (onConnect) {
      onConnect(provider);
    } else {
      // Default: redirect to Auth0 connect endpoint
      window.location.href = `/auth/connect?connection=${provider}`;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking connections...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="text-sm text-muted-foreground">
        Sign in to view connected integrations
      </div>
    );
  }

  const connectedCount = connections.filter(c => c.connected).length;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={connectedCount > 0 ? "default" : "secondary"}>
          {connectedCount} connected
        </Badge>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h3 className="text-sm font-medium">Connected Integrations</h3>
        <p className="text-xs text-muted-foreground">
          Manage your OAuth connections for AI agent tools and imports
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {connections.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No connections yet. Connect an account to get started.
          </div>
        ) : (
          connections.map((conn) => (
            <div
              key={conn.provider}
              className="flex items-center justify-between p-2 rounded-lg border"
            >
              <div className="flex items-center gap-2">
                {conn.connected ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-gray-400" />
                )}
                <span className="capitalize text-sm">{conn.provider}</span>
                {conn.connected && conn.source && (
                  <Badge variant="outline" className="text-xs">
                    {conn.source}
                  </Badge>
                )}
              </div>
              {!conn.connected && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleConnect(conn.provider)}
                  className="h-8 text-xs"
                >
                  Connect
                  <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          ))
        )}

        {/* Additional info */}
        <div className="pt-2 border-t text-xs text-muted-foreground">
          <p>
            Auth0 Connected Accounts provide direct API access for imports and agent tools.
          </p>
          <p className="mt-1">
            Also supports Nango, Composio, and Arcade for extended integrations.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Quick connect button for a specific provider
 */
export function ConnectButton({ 
  provider, 
  label,
  className 
}: { 
  provider: string; 
  label?: string;
  className?: string;
}) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        const conn = data.connections?.find(
          (c: Connection) => c.provider === provider
        );
        setConnected(!!conn?.connected);
        setChecking(false);
      })
      .catch(() => {
        setChecking(false);
      });
  }, [provider]);

  if (checking) {
    return (
      <Button disabled className={className}>
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Checking...
      </Button>
    );
  }

  if (connected) {
    return (
      <Button variant="outline" disabled className={className}>
        <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
        Connected
      </Button>
    );
  }

  return (
    <Button
      variant="default"
      onClick={() => {
        window.location.href = `/auth/connect?connection=${provider}`;
      }}
      className={className}
    >
      Connect {label || provider}
    </Button>
  );
}
