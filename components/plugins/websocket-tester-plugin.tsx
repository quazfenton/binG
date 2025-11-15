"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Wifi, WifiOff, Send, Trash2, Copy, Download, Play, Pause,
  Loader2, CheckCircle, XCircle, AlertCircle, Radio,
  Clock, Activity, MessageSquare, Settings, Filter,
  Link2, Zap, Eye, EyeOff, RefreshCw, Database,
  BarChart3, Globe, Terminal, Search, Star
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface WebSocketConnection {
  id: string;
  name: string;
  url: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  protocol?: string;
  created: string;
  lastConnected?: string;
  messageCount: number;
  error?: string;
}

interface WebSocketMessage {
  id: string;
  connectionId: string;
  timestamp: string;
  type: 'sent' | 'received' | 'error' | 'info';
  content: string;
  size: number;
}

interface ConnectionStats {
  totalMessages: number;
  messagesSent: number;
  messagesReceived: number;
  avgMessageSize: number;
  connectionUptime: number;
  errors: number;
}

const WebSocketTesterPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const [connections, setConnections] = useState<WebSocketConnection[]>([
    {
      id: 'conn-1',
      name: 'Echo Server',
      url: 'wss://echo.websocket.org',
      status: 'disconnected',
      created: new Date().toISOString(),
      messageCount: 0
    }
  ]);

  const [selectedConnection, setSelectedConnection] = useState<WebSocketConnection | null>(connections[0]);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [messageInput, setMessageInput] = useState('{"type": "ping", "data": "Hello WebSocket!"}');
  const [newConnectionName, setNewConnectionName] = useState('');
  const [newConnectionUrl, setNewConnectionUrl] = useState('');
  const [activeTab, setActiveTab] = useState('tester');
  const [autoReconnect, setAutoReconnect] = useState(false);
  const [messageFormat, setMessageFormat] = useState<'json' | 'text'>('json');
  const [filterType, setFilterType] = useState<'all' | 'sent' | 'received' | 'error'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [pingInterval, setPingInterval] = useState(30);
  const [enablePing, setEnablePing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRefs = useRef<Map<string, WebSocket>>(new Map());

  // Simulate WebSocket connection
  const connectToWebSocket = (connectionId: string) => {
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return;

    setConnections(prev => prev.map(c =>
      c.id === connectionId ? { ...c, status: 'connecting' } : c
    ));

    // Simulate connection delay
    setTimeout(() => {
      const success = Math.random() > 0.1; // 90% success rate for demo

      if (success) {
        setConnections(prev => prev.map(c =>
          c.id === connectionId
            ? { ...c, status: 'connected', lastConnected: new Date().toISOString(), error: undefined }
            : c
        ));

        // Add connection info message
        const infoMessage: WebSocketMessage = {
          id: `msg-${Date.now()}`,
          connectionId,
          timestamp: new Date().toISOString(),
          type: 'info',
          content: `Connected to ${connection.url}`,
          size: 0
        };
        setMessages(prev => [...prev, infoMessage]);

        toast.success(`Connected to ${connection.name}`);

        // Simulate receiving messages periodically
        const interval = setInterval(() => {
          if (connections.find(c => c.id === connectionId)?.status !== 'connected') {
            clearInterval(interval);
            return;
          }

          // Random chance to receive a message
          if (Math.random() < 0.3) {
            const receivedMessage: WebSocketMessage = {
              id: `msg-${Date.now()}-${Math.random()}`,
              connectionId,
              timestamp: new Date().toISOString(),
              type: 'received',
              content: JSON.stringify({
                type: 'notification',
                data: {
                  message: 'Server update',
                  timestamp: Date.now(),
                  value: Math.random() * 100
                }
              }, null, 2),
              size: Math.floor(Math.random() * 500) + 100
            };

            setMessages(prev => [...prev, receivedMessage]);
            setConnections(prev => prev.map(c =>
              c.id === connectionId ? { ...c, messageCount: c.messageCount + 1 } : c
            ));
          }
        }, 5000);

        // Store interval for cleanup
        (wsRefs.current.get(connectionId) as any) = { interval };
      } else {
        setConnections(prev => prev.map(c =>
          c.id === connectionId
            ? { ...c, status: 'error', error: 'Connection failed - unable to reach server' }
            : c
        ));

        const errorMessage: WebSocketMessage = {
          id: `msg-${Date.now()}`,
          connectionId,
          timestamp: new Date().toISOString(),
          type: 'error',
          content: 'Connection failed',
          size: 0
        };
        setMessages(prev => [...prev, errorMessage]);

        toast.error(`Failed to connect to ${connection.name}`);
      }
    }, 1500);
  };

  const disconnectFromWebSocket = (connectionId: string) => {
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) return;

    // Clear interval
    const wsData = wsRefs.current.get(connectionId) as any;
    if (wsData?.interval) {
      clearInterval(wsData.interval);
    }

    setConnections(prev => prev.map(c =>
      c.id === connectionId ? { ...c, status: 'disconnected' } : c
    ));

    const infoMessage: WebSocketMessage = {
      id: `msg-${Date.now()}`,
      connectionId,
      timestamp: new Date().toISOString(),
      type: 'info',
      content: `Disconnected from ${connection.url}`,
      size: 0
    };
    setMessages(prev => [...prev, infoMessage]);

    toast.info(`Disconnected from ${connection.name}`);
  };

  const sendMessage = () => {
    if (!selectedConnection || selectedConnection.status !== 'connected') {
      toast.error('Not connected to WebSocket');
      return;
    }

    if (!messageInput.trim()) {
      toast.error('Please enter a message');
      return;
    }

    // Validate JSON if format is JSON
    if (messageFormat === 'json') {
      try {
        JSON.parse(messageInput);
      } catch (e) {
        toast.error('Invalid JSON format');
        return;
      }
    }

    const sentMessage: WebSocketMessage = {
      id: `msg-${Date.now()}`,
      connectionId: selectedConnection.id,
      timestamp: new Date().toISOString(),
      type: 'sent',
      content: messageInput,
      size: new Blob([messageInput]).size
    };

    setMessages(prev => [...prev, sentMessage]);
    setConnections(prev => prev.map(c =>
      c.id === selectedConnection.id ? { ...c, messageCount: c.messageCount + 1 } : c
    ));

    // Simulate echo response
    setTimeout(() => {
      const echoMessage: WebSocketMessage = {
        id: `msg-${Date.now()}-echo`,
        connectionId: selectedConnection.id,
        timestamp: new Date().toISOString(),
        type: 'received',
        content: messageFormat === 'json'
          ? JSON.stringify({ echo: JSON.parse(messageInput), timestamp: Date.now() }, null, 2)
          : `Echo: ${messageInput}`,
        size: new Blob([messageInput]).size + 50
      };
      setMessages(prev => [...prev, echoMessage]);
    }, 500 + Math.random() * 1000);

    toast.success('Message sent');
  };

  const addConnection = () => {
    if (!newConnectionName.trim() || !newConnectionUrl.trim()) {
      toast.error('Please provide connection name and URL');
      return;
    }

    // Basic URL validation
    if (!newConnectionUrl.startsWith('ws://') && !newConnectionUrl.startsWith('wss://')) {
      toast.error('URL must start with ws:// or wss://');
      return;
    }

    const newConnection: WebSocketConnection = {
      id: `conn-${Date.now()}`,
      name: newConnectionName,
      url: newConnectionUrl,
      status: 'disconnected',
      created: new Date().toISOString(),
      messageCount: 0
    };

    setConnections(prev => [...prev, newConnection]);
    setNewConnectionName('');
    setNewConnectionUrl('');
    toast.success(`Connection added: ${newConnectionName}`);
  };

  const deleteConnection = (id: string) => {
    // Disconnect first if connected
    const conn = connections.find(c => c.id === id);
    if (conn?.status === 'connected') {
      disconnectFromWebSocket(id);
    }

    setConnections(prev => prev.filter(c => c.id !== id));
    if (selectedConnection?.id === id) {
      setSelectedConnection(connections[0] || null);
    }
    toast.success('Connection deleted');
  };

  const clearMessages = () => {
    setMessages([]);
    toast.success('Messages cleared');
  };

  const exportMessages = (format: 'json' | 'csv' | 'txt') => {
    let content = '';
    let filename = '';

    const filteredMessages = messages.filter(m => m.connectionId === selectedConnection?.id);

    switch (format) {
      case 'json':
        content = JSON.stringify(filteredMessages, null, 2);
        filename = `websocket-messages-${Date.now()}.json`;
        break;
      case 'csv':
        const csvRows = [
          ['Timestamp', 'Type', 'Content', 'Size'].join(','),
          ...filteredMessages.map(m =>
            [m.timestamp, m.type, `"${m.content.replace(/"/g, '""')}"`, m.size].join(',')
          )
        ];
        content = csvRows.join('\n');
        filename = `websocket-messages-${Date.now()}.csv`;
        break;
      case 'txt':
        content = filteredMessages.map(m =>
          `[${new Date(m.timestamp).toLocaleString()}] ${m.type.toUpperCase()}: ${m.content}`
        ).join('\n\n');
        filename = `websocket-messages-${Date.now()}.txt`;
        break;
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const calculateStats = (): ConnectionStats => {
    const connectionMessages = messages.filter(m => m.connectionId === selectedConnection?.id);
    const sent = connectionMessages.filter(m => m.type === 'sent').length;
    const received = connectionMessages.filter(m => m.type === 'received').length;
    const errors = connectionMessages.filter(m => m.type === 'error').length;
    const totalSize = connectionMessages.reduce((sum, m) => sum + m.size, 0);
    const avgSize = connectionMessages.length > 0 ? Math.round(totalSize / connectionMessages.length) : 0;

    return {
      totalMessages: connectionMessages.length,
      messagesSent: sent,
      messagesReceived: received,
      avgMessageSize: avgSize,
      connectionUptime: 0,
      errors
    };
  };

  const filteredMessages = messages.filter(m => {
    const matchesConnection = m.connectionId === selectedConnection?.id;
    const matchesType = filterType === 'all' || m.type === filterType;
    const matchesSearch = !searchQuery || m.content.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesConnection && matchesType && matchesSearch;
  });

  const stats = calculateStats();

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const getStatusColor = (status: WebSocketConnection['status']) => {
    switch (status) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: WebSocketConnection['status']) => {
    switch (status) {
      case 'connected': return <Radio className="w-4 h-4 text-green-400 animate-pulse" />;
      case 'connecting': return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-400" />;
      default: return <WifiOff className="w-4 h-4 text-gray-400" />;
    }
  };

  const messageTemplates = [
    { name: 'Ping', content: '{"type": "ping", "timestamp": ' + Date.now() + '}' },
    { name: 'Subscribe', content: '{"type": "subscribe", "channel": "updates"}' },
    { name: 'Unsubscribe', content: '{"type": "unsubscribe", "channel": "updates"}' },
    { name: 'Auth', content: '{"type": "auth", "token": "your-token-here"}' },
    { name: 'Request', content: '{"type": "request", "action": "getData", "params": {}}' }
  ];

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 via-teal-900/20 to-slate-900">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Wifi className="w-5 h-5 text-teal-400" />
          <h2 className="text-lg font-semibold text-white">WebSocket Tester</h2>
          <Badge variant="outline" className="text-xs">Real-time</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="w-4 h-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-black/40">
          <TabsTrigger value="tester" className="text-xs">
            <Activity className="w-3 h-3 mr-1" />
            Tester
          </TabsTrigger>
          <TabsTrigger value="connections" className="text-xs">
            <Link2 className="w-3 h-3 mr-1" />
            Connections ({connections.length})
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-xs">
            <BarChart3 className="w-3 h-3 mr-1" />
            Stats
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-xs">
            <Settings className="w-3 h-3 mr-1" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Tester Tab */}
        <TabsContent value="tester" className="flex-1 p-4 overflow-hidden flex flex-col gap-4">
          {/* Connection Status */}
          <Card className="bg-black/40 border-teal-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(selectedConnection?.status || 'disconnected')}
                  <div>
                    <h3 className="font-medium text-white">{selectedConnection?.name || 'No connection'}</h3>
                    <p className="text-xs text-white/60">{selectedConnection?.url || '-'}</p>
                  </div>
                  <Badge variant="outline" className={`text-xs ${getStatusColor(selectedConnection?.status || 'disconnected')}`}>
                    {selectedConnection?.status || 'disconnected'}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  {selectedConnection?.status === 'connected' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectedConnection && disconnectFromWebSocket(selectedConnection.id)}
                      className="border-red-500/20 hover:bg-red-500/20"
                    >
                      <WifiOff className="w-3 h-3 mr-1" />
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectedConnection && connectToWebSocket(selectedConnection.id)}
                      disabled={selectedConnection?.status === 'connecting'}
                      className="border-green-500/20 hover:bg-green-500/20"
                    >
                      {selectedConnection?.status === 'connecting' ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Wifi className="w-3 h-3 mr-1" />
                      )}
                      Connect
                    </Button>
                  )}
                  <select
                    value={selectedConnection?.id || ''}
                    onChange={(e) => {
                      const conn = connections.find(c => c.id === e.target.value);
                      setSelectedConnection(conn || null);
                    }}
                    className="bg-black/40 border border-white/20 rounded-md px-3 py-1 text-white text-sm"
                  >
                    {connections.map(conn => (
                      <option key={conn.id} value={conn.id}>{conn.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Messages */}
          <Card className="flex-1 bg-black/40 border-white/10 flex flex-col overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Messages ({filteredMessages.length})
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-white/40" />
                    <Input
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-7 h-7 w-32 bg-black/40 border-white/20 text-white text-xs"
                    />
                  </div>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as any)}
                    className="h-7 bg-black/40 border border-white/20 rounded-md px-2 text-white text-xs"
                  >
                    <option value="all">All</option>
                    <option value="sent">Sent</option>
                    <option value="received">Received</option>
                    <option value="error">Error</option>
                  </select>
                  <Button size="sm" variant="ghost" onClick={clearMessages}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => exportMessages('json')}>
                    <Download className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-4">
                <div className="space-y-2 py-2">
                  {filteredMessages.length > 0 ? (
                    filteredMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`p-3 rounded border ${
                          msg.type === 'sent'
                            ? 'bg-blue-500/10 border-blue-500/20 ml-8'
                            : msg.type === 'received'
                            ? 'bg-green-500/10 border-green-500/20 mr-8'
                            : msg.type === 'error'
                            ? 'bg-red-500/10 border-red-500/20'
                            : 'bg-gray-500/10 border-gray-500/20'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              msg.type === 'sent'
                                ? 'text-blue-400'
                                : msg.type === 'received'
                                ? 'text-green-400'
                                : msg.type === 'error'
                                ? 'text-red-400'
                                : 'text-gray-400'
                            }`}
                          >
                            {msg.type.toUpperCase()}
                          </Badge>
                          {showTimestamps && (
                            <span className="text-xs text-white/60">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        <pre className="text-xs text-white/80 whitespace-pre-wrap break-words font-mono">
                          {msg.content}
                        </pre>
                        {msg.size > 0 && (
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-white/40">{msg.size} bytes</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(msg.content)}
                              className="h-5 text-xs"
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <MessageSquare className="w-12 h-12 text-white/20 mx-auto mb-3" />
                      <p className="text-sm text-white/60">No messages yet</p>
                      <p className="text-xs text-white/40 mt-1">Connect and send a message to start</p>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Message Input */}
          <Card className="bg-black/40 border-white/10">
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-2">
                {messageTemplates.map((template) => (
                  <Button
                    key={template.name}
                    size="sm"
                    variant="outline"
                    onClick={() => setMessageInput(template.content)}
                    className="text-xs"
                  >
                    {template.name}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Enter message to send..."
                  className="flex-1 bg-black/40 border-white/20 text-white font-mono text-sm min-h-[80px]"
                  disabled={selectedConnection?.status !== 'connected'}
                />
                <Button
                  onClick={sendMessage}
                  disabled={selectedConnection?.status !== 'connected'}
                  className="bg-teal-600 hover:bg-teal-700 self-end"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs text-white/60">
                <span>Ctrl+Enter to send</span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={messageFormat === 'json'}
                      onChange={() => setMessageFormat('json')}
                    />
                    JSON
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={messageFormat === 'text'}
                      onChange={() => setMessageFormat('text')}
                    />
                    Text
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* Add Connection */}
              <Card className="bg-black/40 border-teal-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Add WebSocket Connection</CardTitle>
                  <CardDescription className="text-xs">Create a new WebSocket connection</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="Connection Name"
                    value={newConnectionName}
                    onChange={(e) => setNewConnectionName(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm"
                  />
                  <Input
                    placeholder="WebSocket URL (ws:// or wss://)"
                    value={newConnectionUrl}
                    onChange={(e) => setNewConnectionUrl(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm"
                  />
                  <Button onClick={addConnection} className="w-full bg-teal-600 hover:bg-teal-700">
                    <Zap className="w-4 h-4 mr-2" />
                    Add Connection
                  </Button>
                </CardContent>
              </Card>

              {/* Connection List */}
              <div className="space-y-2">
                {connections.map((conn) => (
                  <Card
                    key={conn.id}
                    className={`bg-black/40 border cursor-pointer transition-all hover:border-teal-500/40 ${
                      selectedConnection?.id === conn.id ? 'border-teal-500/60' : 'border-white/10'
                    }`}
                    onClick={() => setSelectedConnection(conn)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            {getStatusIcon(conn.status)}
                            <h3 className="font-medium text-white">{conn.name}</h3>
                            <Badge variant="outline" className={`text-xs ${getStatusColor(conn.status)}`}>
                              {conn.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-white/60 mb-1">{conn.url}</p>
                          <div className="flex items-center gap-4 text-xs text-white/60">
                            <span>{conn.messageCount} messages</span>
                            {conn.lastConnected && (
                              <span>Last: {new Date(conn.lastConnected).toLocaleTimeString()}</span>
                            )}
                          </div>
                          {conn.error && (
                            <div className="mt-2 flex items-center gap-1 text-xs text-red-400">
                              <AlertCircle className="w-3 h-3" />
                              {conn.error}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {conn.status === 'connected' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                disconnectFromWebSocket(conn.id);
                              }}
                            >
                              <WifiOff className="w-3 h-3" />
