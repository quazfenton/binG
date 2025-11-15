"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Webhook, Copy, Trash2, Play, Eye, EyeOff,
  Loader2, CheckCircle, XCircle, AlertCircle,
  Download, Filter, Search, RefreshCw, Zap,
  Clock, Globe, Code, Send, Terminal, Link2,
  BarChart3, Activity, Radio, Server
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface WebhookRequest {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
  query: Record<string, string>;
  ip: string;
  userAgent?: string;
  status: 'captured' | 'replayed';
  size: number;
}

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  created: string;
  requestCount: number;
  active: boolean;
}

interface WebhookStats {
  totalRequests: number;
  uniqueIPs: number;
  methodCounts: Record<string, number>;
  avgSize: number;
}

const WebhookDebuggerPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([
    {
      id: 'ep-1',
      name: 'Production Webhook',
      url: 'https://webhook.site/abc123-def456-ghi789',
      created: new Date().toISOString(),
      requestCount: 0,
      active: true
    }
  ]);

  const [selectedEndpoint, setSelectedEndpoint] = useState<WebhookEndpoint | null>(endpoints[0]);
  const [requests, setRequests] = useState<WebhookRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<WebhookRequest | null>(null);
  const [isListening, setIsListening] = useState(true);
  const [activeTab, setActiveTab] = useState('endpoint');
  const [filterMethod, setFilterMethod] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [newEndpointName, setNewEndpointName] = useState('');
  const [forwardUrl, setForwardUrl] = useState('');
  const [autoForward, setAutoForward] = useState(false);
  const [showHeaders, setShowHeaders] = useState(true);
  const [showBody, setShowBody] = useState(true);

  // Simulate incoming webhook requests
  useEffect(() => {
    if (!isListening || !selectedEndpoint) return;

    const interval = setInterval(() => {
      // Randomly generate webhook requests (20% chance every 3 seconds)
      if (Math.random() < 0.2) {
        const methods = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'];
        const paths = ['/webhook', '/api/callback', '/events', '/notifications'];
        const mockRequest: WebhookRequest = {
          id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          method: methods[Math.floor(Math.random() * methods.length)],
          path: paths[Math.floor(Math.random() * paths.length)],
          headers: {
            'content-type': 'application/json',
            'user-agent': 'GitHub-Hookshot/abc123',
            'x-github-event': 'push',
            'x-request-id': Math.random().toString(36).substr(2, 9)
          },
          body: {
            event: 'test.event',
            timestamp: Date.now(),
            data: {
              id: Math.floor(Math.random() * 10000),
              status: Math.random() > 0.5 ? 'success' : 'pending',
              message: 'Webhook event triggered successfully'
            }
          },
          query: { source: 'github', ref: 'main' },
          ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
          userAgent: 'GitHub-Hookshot/abc123',
          status: 'captured',
          size: Math.floor(Math.random() * 5000) + 500
        };

        setRequests(prev => [mockRequest, ...prev].slice(0, 100)); // Keep last 100
        setEndpoints(prev => prev.map(ep =>
          ep.id === selectedEndpoint.id
            ? { ...ep, requestCount: ep.requestCount + 1 }
            : ep
        ));

        toast.success('New webhook captured', {
          description: `${mockRequest.method} ${mockRequest.path}`
        });
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isListening, selectedEndpoint]);

  const createEndpoint = () => {
    if (!newEndpointName.trim()) {
      toast.error('Please provide an endpoint name');
      return;
    }

    const randomId = Math.random().toString(36).substr(2, 9);
    const newEndpoint: WebhookEndpoint = {
      id: `ep-${Date.now()}`,
      name: newEndpointName,
      url: `https://webhook.site/${randomId}-${randomId}-${randomId}`,
      created: new Date().toISOString(),
      requestCount: 0,
      active: true
    };

    setEndpoints(prev => [...prev, newEndpoint]);
    setNewEndpointName('');
    toast.success(`Endpoint created: ${newEndpoint.name}`);
  };

  const deleteEndpoint = (id: string) => {
    setEndpoints(prev => prev.filter(ep => ep.id !== id));
    if (selectedEndpoint?.id === id) {
      setSelectedEndpoint(endpoints[0] || null);
    }
    toast.success('Endpoint deleted');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const clearRequests = () => {
    setRequests([]);
    setSelectedRequest(null);
    toast.success('Requests cleared');
  };

  const replayRequest = async (request: WebhookRequest) => {
    if (!forwardUrl) {
      toast.error('Please set a forward URL');
      return;
    }

    toast.info('Replaying request...');

    // Simulate replay
    setTimeout(() => {
      setRequests(prev => prev.map(r =>
        r.id === request.id ? { ...r, status: 'replayed' } : r
      ));
      toast.success('Request replayed successfully');
    }, 1000);
  };

  const exportRequests = (format: 'json' | 'csv') => {
    let content = '';
    let filename = '';

    if (format === 'json') {
      content = JSON.stringify(requests, null, 2);
      filename = `webhook-requests-${Date.now()}.json`;
    } else {
      const csvRows = [
        ['Timestamp', 'Method', 'Path', 'IP', 'Size', 'Status'].join(','),
        ...requests.map(r =>
          [r.timestamp, r.method, r.path, r.ip, r.size, r.status].join(',')
        )
      ];
      content = csvRows.join('\n');
      filename = `webhook-requests-${Date.now()}.csv`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported as ${format.toUpperCase()}`);
  };

  const filteredRequests = requests.filter(req => {
    const matchesMethod = filterMethod === 'ALL' || req.method === filterMethod;
    const matchesSearch = !searchQuery ||
      JSON.stringify(req).toLowerCase().includes(searchQuery.toLowerCase());
    return matchesMethod && matchesSearch;
  });

  const calculateStats = (): WebhookStats => {
    const methodCounts: Record<string, number> = {};
    const uniqueIPs = new Set<string>();
    let totalSize = 0;

    requests.forEach(req => {
      methodCounts[req.method] = (methodCounts[req.method] || 0) + 1;
      uniqueIPs.add(req.ip);
      totalSize += req.size;
    });

    return {
      totalRequests: requests.length,
      uniqueIPs: uniqueIPs.size,
      methodCounts,
      avgSize: requests.length > 0 ? Math.round(totalSize / requests.length) : 0
    };
  };

  const stats = calculateStats();

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 via-indigo-900/20 to-slate-900">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Webhook className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">Webhook Debugger</h2>
          <Badge variant="outline" className="text-xs">
            {isListening ? (
              <>
                <Radio className="w-3 h-3 mr-1 animate-pulse text-green-400" />
                Listening
              </>
            ) : (
              'Paused'
            )}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="w-4 h-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-black/40">
          <TabsTrigger value="endpoint" className="text-xs">
            <Server className="w-3 h-3 mr-1" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="requests" className="text-xs">
            <Activity className="w-3 h-3 mr-1" />
            Requests ({requests.length})
          </TabsTrigger>
          <TabsTrigger value="inspector" className="text-xs">
            <Eye className="w-3 h-3 mr-1" />
            Inspector
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-xs">
            <BarChart3 className="w-3 h-3 mr-1" />
            Stats
          </TabsTrigger>
        </TabsList>

        {/* Endpoints Tab */}
        <TabsContent value="endpoint" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* Create Endpoint */}
              <Card className="bg-black/40 border-indigo-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Create Webhook Endpoint</CardTitle>
                  <CardDescription className="text-xs">
                    Generate a unique URL to receive webhook requests
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Endpoint name (e.g., GitHub Webhooks)"
                      value={newEndpointName}
                      onChange={(e) => setNewEndpointName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createEndpoint()}
                      className="bg-black/40 border-white/20 text-white"
                    />
                    <Button onClick={createEndpoint} className="bg-indigo-600 hover:bg-indigo-700">
                      <Zap className="w-4 h-4 mr-2" />
                      Create
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Endpoint List */}
              <div className="space-y-2">
                {endpoints.map((endpoint) => (
                  <Card
                    key={endpoint.id}
                    className={`bg-black/40 border cursor-pointer transition-all hover:border-indigo-500/40 ${
                      selectedEndpoint?.id === endpoint.id
                        ? 'border-indigo-500/60 bg-indigo-500/10'
                        : 'border-white/10'
                    }`}
                    onClick={() => setSelectedEndpoint(endpoint)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-white">{endpoint.name}</h3>
                            <Badge variant="outline" className="text-xs">
                              {endpoint.requestCount} requests
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <Link2 className="w-3 h-3 text-white/60" />
                            <code className="text-xs text-white/80 bg-black/40 px-2 py-1 rounded">
                              {endpoint.url}
                            </code>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(endpoint.url);
                              }}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                          <p className="text-xs text-white/60">
                            Created: {new Date(endpoint.created).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteEndpoint(endpoint.id);
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Forwarding Config */}
              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Request Forwarding</CardTitle>
                  <CardDescription className="text-xs">
                    Automatically forward captured requests to your server
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="https://your-server.com/webhook"
                    value={forwardUrl}
                    onChange={(e) => setForwardUrl(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm"
                  />
                  <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoForward}
                      onChange={(e) => setAutoForward(e.target.checked)}
                      className="rounded"
                    />
                    <span>Auto-forward incoming requests</span>
                  </label>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Requests Tab */}
        <TabsContent value="requests" className="flex-1 p-4 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input
                placeholder="Search requests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-black/40 border-white/20 text-white text-sm"
              />
            </div>
            <select
              value={filterMethod}
              onChange={(e) => setFilterMethod(e.target.value)}
              className="bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white text-sm"
            >
              <option value="ALL">All Methods</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsListening(!isListening)}
            >
              {isListening ? <Radio className="w-4 h-4 text-green-400" /> : <Activity className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={clearRequests}>
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportRequests('json')}>
              <Download className="w-4 h-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-2">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request) => (
                  <Card
                    key={request.id}
                    className={`bg-black/40 border cursor-pointer transition-all hover:border-indigo-500/40 ${
                      selectedRequest?.id === request.id
                        ? 'border-indigo-500/60 bg-indigo-500/10'
                        : 'border-white/10'
                    }`}
                    onClick={() => {
                      setSelectedRequest(request);
                      setActiveTab('inspector');
                    }}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                request.method === 'POST'
                                  ? 'bg-green-500/20 text-green-400'
                                  : request.method === 'GET'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : request.method === 'DELETE'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-yellow-500/20 text-yellow-400'
                              }`}
                            >
                              {request.method}
                            </Badge>
                            <code className="text-sm text-white font-mono">{request.path}</code>
                            {request.status === 'replayed' && (
                              <Badge variant="outline" className="text-xs">
                                <RefreshCw className="w-3 h-3 mr-1" />
                                Replayed
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-white/60">
                            <span>{new Date(request.timestamp).toLocaleTimeString()}</span>
                            <span>{request.ip}</span>
                            <span>{request.size} bytes</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            replayRequest(request);
                          }}
                          disabled={!forwardUrl}
                        >
                          <Play className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="bg-black/40 border-white/10">
                  <CardContent className="p-8 text-center">
                    <Webhook className="w-12 h-12 text-white/20 mx-auto mb-3" />
                    <p className="text-sm text-white/60">No webhook requests captured yet</p>
                    <p className="text-xs text-white/40 mt-1">
                      {isListening ? 'Waiting for incoming requests...' : 'Start listening to capture requests'}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Inspector Tab */}
        <TabsContent value="inspector" className="flex-1 p-4 overflow-hidden">
          {selectedRequest ? (
            <ScrollArea className="h-full">
              <div className="space-y-4">
                {/* Request Overview */}
                <Card className="bg-black/40 border-indigo-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-sm">{selectedRequest.method}</Badge>
                        <code className="text-sm text-white font-mono">{selectedRequest.path}</code>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => copyToClipboard(JSON.stringify(selectedRequest, null, 2))}>
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => replayRequest(selectedRequest)} disabled={!forwardUrl}>
                          <Play className="w-3 h-3 mr-1" />
                          Replay
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-white/60">Timestamp:</span>
                        <p className="text-white">{new Date(selectedRequest.timestamp).toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-white/60">IP Address:</span>
                        <p className="text-white">{selectedRequest.ip}</p>
                      </div>
                      <div>
                        <span className="text-white/60">User Agent:</span>
                        <p className="text-white truncate">{selectedRequest.userAgent || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-white/60">Size:</span>
                        <p className="text-white">{selectedRequest.size} bytes</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Headers */}
                <Card className="bg-black/40 border-white/10">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <Code className="w-4 h-4" />
                        Headers
                      </CardTitle>
                      <Button size="sm" variant="ghost" onClick={() => setShowHeaders(!showHeaders)}>
                        {showHeaders ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </Button>
                    </div>
                  </CardHeader>
                  {showHeaders && (
                    <CardContent>
                      <pre className="bg-black/40 p-3 rounded text-xs text-white/80 overflow-x-auto">
                        {JSON.stringify(selectedRequest.headers, null, 2)}
                      </pre>
                    </CardContent>
                  )}
                </Card>

                {/* Query Parameters */}
                {Object.keys(selectedRequest.query).length > 0 && (
                  <Card className="bg-black/40 border-white/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <Search className="w-4 h-4" />
                        Query Parameters
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-black/40 p-3 rounded text-xs text-white/80 overflow-x-auto">
                        {JSON.stringify(selectedRequest.query, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Body */}
                <Card className="bg-black/40 border-white/10">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <Terminal className="w-4 h-4" />
                        Request Body
                      </CardTitle>
                      <Button size="sm" variant="ghost" onClick={() => setShowBody(!showBody)}>
                        {showBody ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </Button>
                    </div>
                  </CardHeader>
                  {showBody && (
                    <CardContent>
                      <pre className="bg-black/40 p-3 rounded text-xs text-white/80 overflow-x-auto max-h-96">
                        {JSON.stringify(selectedRequest.body, null, 2)}
                      </pre>
                    </CardContent>
                  )}
                </Card>
              </div>
            </ScrollArea>
          ) : (
            <Card className="bg-black/40 border-white/10 h-full">
              <CardContent className="p-8 text-center h-full flex items-center justify-center">
                <div>
                  <Eye className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-sm text-white/60">No request selected</p>
                  <p className="text-xs text-white/40 mt-1">Select a request to inspect details</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Stats Tab */}
        <TabsContent value="stats" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-black/40 border-indigo-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-indigo-400" />
                      <span className="text-xs text-white/60">Total Requests</span>
                    </div>
                    <p className="text-2xl font-bold text-white">{stats.totalRequests}</p>
                  </CardContent>
                </Card>
                <Card className="bg-black/40 border-indigo-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-white/60">Unique IPs</span>
                    </div>
                    <p className="text-2xl font-bold text-white">{stats.uniqueIPs}</p>
                  </CardContent>
                </Card>
                <Card className="bg-black/40 border-indigo-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-4 h-4 text-yellow-400" />
                      <span className="text-xs text-white/60">Avg Size</span>
                    </div>
                    <p className="text-2xl font-bold text-white">{stats.avgSize} bytes</p>
                  </CardContent>
                </Card>
                <Card className="bg-black/40 border-indigo-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-purple-400" />
                      <span className="text-xs text-white/60">Last Request</span>
                    </div>
                    <p className="text-sm font-medium text-white">
                      {requests.length > 0
                        ? new Date(requests[0].timestamp).toLocaleTimeString()
                        : 'N/A'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Methods Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(stats.methodCounts).map(([method, count]) => (
                      <div key={method} className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">{method}</Badge>
                        <div className="flex-1 mx-3">
                          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500"
                              style={{
                                width: `${(count / stats.totalRequests) * 100}%`
                              }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-white/60">{count}
