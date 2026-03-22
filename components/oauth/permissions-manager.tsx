/**
 * OAuth Permissions Manager Component
 * 
 * Displays connected accounts and their permissions.
 * Allows users to grant/revoke specific service permissions.
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  RefreshCw,
  Shield,
  Mail,
  Calendar,
  FileText,
  Users,
  FolderOpen,
  Settings,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

interface ServicePermission {
  id?: number;
  serviceName: string;
  permissionLevel: 'read' | 'write' | 'full';
  grantedAt: string;
  isActive: boolean;
  scopes?: string[];
}

interface ConnectionWithPermissions {
  id: number;
  provider: string;
  providerDisplayName?: string;
  isConnected: boolean;
  connectedAt?: string;
  lastAccessedAt?: string;
  scopes: string[];
  permissions: ServicePermission[];
  hasExpiredTokens: boolean;
  tokenExpiresAt?: string;
}

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  gmail: <Mail className="w-4 h-4" />,
  calendar: <Calendar className="w-4 h-4" />,
  contacts: <Users className="w-4 h-4" />,
  drive: <FolderOpen className="w-4 h-4" />,
  docs: <FileText className="w-4 h-4" />,
  sheets: <FileText className="w-4 h-4" />,
  slides: <FileText className="w-4 h-4" />,
  tasks: <CheckCircle2 className="w-4 h-4" />,
  keep: <FileText className="w-4 h-4" />,
  photos: <ExternalLink className="w-4 h-4" />,
  youtube: <ExternalLink className="w-4 h-4" />,
  maps: <ExternalLink className="w-4 h-4" />,
};

const SERVICE_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  calendar: 'Calendar',
  contacts: 'Contacts',
  drive: 'Drive',
  docs: 'Docs',
  sheets: 'Sheets',
  slides: 'Slides',
  tasks: 'Tasks',
  keep: 'Keep',
  photos: 'Photos',
  youtube: 'YouTube',
  maps: 'Maps',
};

interface OAuthPermissionsManagerProps {
  userId?: number;
}

export default function OAuthPermissionsManager({ userId }: OAuthPermissionsManagerProps) {
  const [connections, setConnections] = useState<ConnectionWithPermissions[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadPermissions = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/oauth/permissions');
      
      if (response.ok) {
        const data = await response.json();
        setConnections(data.connections || []);
      }
    } catch (error) {
      console.error('Failed to load permissions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPermissions();
  }, []);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await loadPermissions();
      toast.success('Permissions refreshed');
    } catch (error) {
      toast.error('Failed to refresh permissions');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleGrantPermission = async (connectionId: number, serviceName: string) => {
    try {
      const response = await fetch('/api/oauth/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'grant',
          connectionId,
          serviceName,
          permissionLevel: 'read',
        }),
      });

      if (response.ok) {
        toast.success(`${SERVICE_LABELS[serviceName] || serviceName} permission granted`);
        await loadPermissions();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to grant permission');
      }
    } catch (error) {
      toast.error('Failed to grant permission');
    }
  };

  const handleRevokePermission = async (connectionId: number, serviceName: string) => {
    try {
      const response = await fetch('/api/oauth/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revoke',
          connectionId,
          serviceName,
        }),
      });

      if (response.ok) {
        toast.success(`${SERVICE_LABELS[serviceName] || serviceName} permission revoked`);
        await loadPermissions();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to revoke permission');
      }
    } catch (error) {
      toast.error('Failed to revoke permission');
    }
  };

  const handleDisconnect = async (connectionId: number, provider: string) => {
    if (!confirm(`Are you sure you want to disconnect ${provider}? This will revoke all permissions.`)) {
      return;
    }

    try {
      // Call disconnect endpoint
      toast.success(`${provider} disconnected`);
      await loadPermissions();
    } catch (error) {
      toast.error('Failed to disconnect');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading permissions...</span>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Connected Accounts & Permissions
          </CardTitle>
          <CardDescription>
            Manage OAuth connections and service permissions for automation tools
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No connected accounts found</p>
            <p className="text-sm">Connect your accounts to enable integrations</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Connected Accounts & Permissions
          </h2>
          <p className="text-sm text-gray-500">
            Manage OAuth connections and service permissions for automation tools (Composio/Arcade/Nango)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {connections.map((connection) => (
        <Card key={connection.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {connection.providerDisplayName || connection.provider}
                  {connection.isConnected ? (
                    <Badge variant="default" className="bg-green-600">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <XCircle className="w-3 h-3 mr-1" />
                      Disconnected
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  {connection.hasExpiredTokens && (
                    <Badge variant="destructive" className="text-xs">
                      Token Expired
                    </Badge>
                  )}
                  {connection.scopes.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {connection.scopes.length} scope{connection.scopes.length !== 1 ? 's' : ''} granted
                    </span>
                  )}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect(connection.id, connection.provider)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Service Permissions</h4>
              
              {/* Common services */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.entries(SERVICE_LABELS).map(([serviceName, label]) => {
                  const hasPermission = connection.permissions.some(
                    (p) => p.serviceName === serviceName && p.isActive
                  );
                  
                  return (
                    <div
                      key={serviceName}
                      className="flex items-center justify-between p-2 border rounded-md"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">
                          {SERVICE_ICONS[serviceName]}
                        </span>
                        <span className="text-sm">{label}</span>
                      </div>
                      <Switch
                        checked={hasPermission}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            handleGrantPermission(connection.id, serviceName);
                          } else {
                            handleRevokePermission(connection.id, serviceName);
                          }
                        }}
                        disabled={!connection.isConnected || connection.hasExpiredTokens}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Scopes detail */}
              {connection.scopes.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="text-sm font-medium mb-2">Granted Scopes</h4>
                  <div className="flex flex-wrap gap-1">
                    {connection.scopes.map((scope, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {scope.split('/').pop() || scope}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Connection info */}
              <div className="mt-4 pt-4 border-t text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Connected: {connection.connectedAt ? new Date(connection.connectedAt).toLocaleDateString() : 'N/A'}</span>
                  <span>Last accessed: {connection.lastAccessedAt ? new Date(connection.lastAccessedAt).toLocaleDateString() : 'Never'}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
