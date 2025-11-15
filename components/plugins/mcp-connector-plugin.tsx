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
  Plug, Unplug, Server, Zap, CheckCircle, XCircle,
  Loader2, AlertCircle, Play, Copy, Trash2, Settings,
  Link as LinkIcon, RefreshCw, Terminal, Box, Layers
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface MCPServer {
  id: string;
  name: string;
  url: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  protocol: 'http' | 'websocket' | 'stdio';
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
  lastConnected?: string;
  error?: string;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  category?: string;
}

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface MCPPrompt {
  name: string;
  description: string;
  arguments?: any[];
}

interface ExecutionLog {
  id: string;
  timestamp: string;
  server: string;
  tool: string;
  input: string;
  output: string;
  status: 'success' | 'error';
  duration: number;
}

const MCPConnectorPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const [servers, setServers] = useState<MCPServer[]>([
    {
      id: 'demo-1',
      name: 'Filesystem MCP',
      url: 'http://localhost:3000/mcp',
      protocol: 'http',
      status: 'disconnected',
      tools: [
        {
          name: 'read_file',
          description: 'Read contents of a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          category: 'filesystem'
        },
        {
          name: 'write_file',
          description: 'Write content to a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' }
            }
          },
          category: 'filesystem'
        },
        {
          name: 'list_directory',
          description: 'List files in a directory',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          category: 'filesystem'
        }
      ]
    },
    {
      id: 'demo-2',
      name: 'Database MCP',
      url: 'ws://localhost:3001/mcp',
      protocol: 'websocket',
      status: 'disconnected',
      tools: [
        {
          name: 'query',
          description: 'Execute SQL query',
          inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
          category: 'database'
        },
        {
          name: 'get_schema',
          description: 'Get database schema',
          inputSchema: { type: 'object', properties: {} },
          category: 'database'
        }
      ]
    }
  ]);

  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerName, setNewServerName] = useState('');
  const [newServerProtocol, setNewServerProtocol] = useState<'http' | 'websocket' | 'stdio'>('http');
  const [toolInput, setToolInput] = useState('{}');
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState('servers');

  const connectToServer = async (serverId: string) => {
    setServers(prev => prev.map(s =>
      s.id === serverId ? { ...s, status: 'connecting' } : s
    ));

    // Simulate connection
    setTimeout(() => {
      setServers(prev => prev.map(s => {
        if (s.id === serverId) {
          const connected = Math.random() > 0.2; // 80% success rate for demo
          return {
            ...s,
            status: connected ? 'connected' : 'error',
            lastConnected: connected ? new Date().toISOString() : undefined,
            error: connected ? undefined : 'Connection timeout - ensure MCP server is running'
          };
        }
        return s;
      }));

      const server = servers.find(s => s.id === serverId);
      if (server && Math.random() > 0.2) {
        toast.success(`Connected to ${server.name}`);
      } else if (server) {
        toast.error(`Failed to connect to ${server.name}`);
      }
    }, 1500);
  };

  const disconnectFromServer = (serverId: string) => {
    setServers(prev => prev.map(s =>
      s.id === serverId ? { ...s, status: 'disconnected', lastConnected: undefined } : s
    ));

    const server = servers.find(s => s.id === serverId);
    if (server) {
      toast.info(`Disconnected from ${server.name}`);
    }
  };

  const addServer = () => {
    if (!newServerUrl || !newServerName) {
      toast.error('Please provide server name and URL');
      return;
    }

    const newServer: MCPServer = {
      id: `server-${Date.now()}`,
      name: newServerName,
      url: newServerUrl,
      protocol: newServerProtocol,
      status: 'disconnected',
      tools: []
    };

    setServers(prev => [...prev, newServer]);
    setNewServerUrl('');
    setNewServerName('');
    toast.success(`Added server: ${newServerName}`);
  };

  const removeServer = (serverId: string) => {
    setServers(prev => prev.filter(s => s.id !== serverId));
    if (selectedServer?.id === serverId) {
      setSelectedServer(null);
    }
    toast.success('Server removed');
  };

  const executeTool = async () => {
    if (!selectedServer || !selectedTool) {
      toast.error('Please select a server and tool');
      return;
    }

    if (selectedServer.status !== 'connected') {
      toast.error('Server is not connected');
      return;
    }

    setIsExecuting(true);
    const startTime = Date.now();

    try {
      JSON.parse(toolInput); // Validate JSON
    } catch (e) {
      toast.error('Invalid JSON input');
      setIsExecuting(false);
      return;
    }

    // Simulate tool execution
    setTimeout(() => {
      const duration = Date.now() - startTime;
      const success = Math.random() > 0.1; // 90% success rate

      const log: ExecutionLog = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        server: selectedServer.name,
        tool: selectedTool.name,
        input: toolInput,
        output: success
          ? JSON.stringify({ success: true, data: 'Execution successful', result: 'Mock result data' }, null, 2)
          : JSON.stringify({ error: 'Execution failed', message: 'Mock error message' }, null, 2),
        status: success ? 'success' : 'error',
        duration
      };

      setExecutionLogs(prev => [log, ...prev]);
      setIsExecuting(false);

      if (success) {
        toast.success(`Tool executed successfully (${duration}ms)`);
        onResult?.(log);
      } else {
        toast.error('Tool execution failed');
      }
    }, 1000 + Math.random() * 1000);
  };

  const getStatusIcon = (status: MCPServer['status']) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'disconnected':
        return <XCircle className="w-4 h-4 text-gray-400" />;
      case 'connecting':
        return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
    }
  };

  const getProtocolIcon = (protocol: string) => {
    switch (protocol) {
      case 'http':
        return <Server className="w-4 h-4" />;
      case 'websocket':
        return <Zap className="w-4 h-4" />;
      case 'stdio':
        return <Terminal className="w-4 h-4" />;
      default:
        return <Box className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Plug className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">MCP Connector</h2>
          <Badge variant="outline" className="text-xs">Model Context Protocol</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="w-4 h-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-black/40">
          <TabsTrigger value="servers" className="text-xs">
            <Server className="w-3 h-3 mr-1" />
            Servers
          </TabsTrigger>
          <TabsTrigger value="tools" className="text-xs">
            <Layers className="w-3 h-3 mr-1" />
            Tools
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">
            <Terminal className="w-3 h-3 mr-1" />
            Logs ({executionLogs.length})
          </TabsTrigger>
        </TabsList>

        {/* Servers Tab */}
        <TabsContent value="servers" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* Add Server Form */}
              <Card className="bg-black/40 border-purple-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Add MCP Server</CardTitle>
                  <CardDescription className="text-xs">Connect to a Model Context Protocol server</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="Server Name"
                    value={newServerName}
                    onChange={(e) => setNewServerName(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm"
                  />
                  <Input
                    placeholder="Server URL (e.g., http://localhost:3000/mcp)"
                    value={newServerUrl}
                    onChange={(e) => setNewServerUrl(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm"
                  />
                  <div className="flex gap-2">
                    <select
                      value={newServerProtocol}
                      onChange={(e) => setNewServerProtocol(e.target.value as any)}
                      className="flex-1 bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white text-sm"
                    >
                      <option value="http">HTTP</option>
                      <option value="websocket">WebSocket</option>
                      <option value="stdio">STDIO</option>
                    </select>
                    <Button onClick={addServer} className="bg-purple-600 hover:bg-purple-700">
                      <Plug className="w-4 h-4 mr-2" />
                      Add Server
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Server List */}
              <div className="space-y-2">
                {servers.map((server) => (
                  <Card
                    key={server.id}
                    className={`bg-black/40 border transition-all cursor-pointer hover:border-purple-500/40 ${
                      selectedServer?.id === server.id ? 'border-purple-500/60 bg-purple-500/10' : 'border-white/10'
                    }`}
                    onClick={() => setSelectedServer(server)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {getStatusIcon(server.status)}
                            {getProtocolIcon(server.protocol)}
                            <h3 className="font-medium text-white">{server.name}</h3>
                            <Badge variant="outline" className="text-xs">{server.protocol}</Badge>
                          </div>
                          <p className="text-xs text-white/60 mb-2">{server.url}</p>
                          {server.error && (
                            <div className="flex items-center gap-1 text-xs text-red-400 mb-2">
                              <AlertCircle className="w-3 h-3" />
                              <span>{server.error}</span>
                            </div>
                          )}
                          {server.lastConnected && (
                            <p className="text-xs text-green-400">
                              Last connected: {new Date(server.lastConnected).toLocaleTimeString()}
                            </p>
                          )}
                          {server.tools && server.tools.length > 0 && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-white/60">
                              <Layers className="w-3 h-3" />
                              <span>{server.tools.length} tools available</span>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {server.status === 'connected' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                disconnectFromServer(server.id);
                              }}
                              className="border-red-500/20 hover:bg-red-500/20"
                            >
                              <Unplug className="w-3 h-3" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                connectToServer(server.id);
                              }}
                              disabled={server.status === 'connecting'}
                              className="border-green-500/20 hover:bg-green-500/20"
                            >
                              {server.status === 'connecting' ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Plug className="w-3 h-3" />
                              )}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeServer(server.id);
                            }}
                            className="border-white/20 hover:bg-white/10"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Tools Tab */}
        <TabsContent value="tools" className="flex-1 p-4 overflow-hidden">
          {selectedServer ? (
            <div className="h-full flex flex-col gap-4">
              <Card className="bg-black/40 border-purple-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">
                    {selectedServer.name} - Tools
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {selectedServer.status === 'connected'
                      ? `${selectedServer.tools?.length || 0} tools available`
                      : 'Connect to server to see available tools'}
                  </CardDescription>
                </CardHeader>
              </Card>

              {selectedServer.status === 'connected' && selectedServer.tools && selectedServer.tools.length > 0 ? (
                <div className="flex-1 grid grid-cols-2 gap-4 overflow-auto">
                  {/* Tool List */}
                  <ScrollArea className="h-full">
                    <div className="space-y-2">
                      {selectedServer.tools.map((tool, idx) => (
                        <Card
                          key={idx}
                          className={`bg-black/40 border cursor-pointer transition-all hover:border-purple-500/40 ${
                            selectedTool?.name === tool.name ? 'border-purple-500/60 bg-purple-500/10' : 'border-white/10'
                          }`}
                          onClick={() => {
                            setSelectedTool(tool);
                            setToolInput(JSON.stringify(tool.inputSchema.properties || {}, null, 2));
                          }}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Zap className="w-4 h-4 text-purple-400" />
                              <h4 className="font-medium text-white text-sm">{tool.name}</h4>
                            </div>
                            <p className="text-xs text-white/60">{tool.description}</p>
                            {tool.category && (
                              <Badge variant="outline" className="text-xs mt-2">{tool.category}</Badge>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>

                  {/* Tool Execution */}
                  <div className="flex flex-col gap-3">
                    {selectedTool ? (
                      <>
                        <Card className="bg-black/40 border-white/10">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm text-white">{selectedTool.name}</CardTitle>
                            <CardDescription className="text-xs">{selectedTool.description}</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div>
                              <label className="text-xs text-white/60 mb-1 block">Input (JSON)</label>
                              <Textarea
                                value={toolInput}
                                onChange={(e) => setToolInput(e.target.value)}
                                className="bg-black/40 border-white/20 text-white font-mono text-xs min-h-[200px]"
                                placeholder='{"key": "value"}'
                              />
                            </div>
                            <Button
                              onClick={executeTool}
                              disabled={isExecuting}
                              className="w-full bg-purple-600 hover:bg-purple-700"
                            >
                              {isExecuting ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Executing...
                                </>
                              ) : (
                                <>
                                  <Play className="w-4 h-4 mr-2" />
                                  Execute Tool
                                </>
                              )}
                            </Button>
                          </CardContent>
                        </Card>
                      </>
                    ) : (
                      <Card className="bg-black/40 border-white/10">
                        <CardContent className="p-8 text-center">
                          <Layers className="w-12 h-12 text-white/20 mx-auto mb-3" />
                          <p className="text-sm text-white/60">Select a tool to execute</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              ) : (
                <Card className="bg-black/40 border-white/10 flex-1">
                  <CardContent className="p-8 text-center h-full flex items-center justify-center">
                    <div>
                      <Plug className="w-12 h-12 text-white/20 mx-auto mb-3" />
                      <p className="text-sm text-white/60">
                        {selectedServer.status === 'disconnected'
                          ? 'Connect to server to see available tools'
                          : 'Connecting to server...'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card className="bg-black/40 border-white/10 h-full">
              <CardContent className="p-8 text-center h-full flex items-center justify-center">
                <div>
                  <Server className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-sm text-white/60">Select a server to view tools</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {executionLogs.length > 0 ? (
                executionLogs.map((log) => (
                  <Card key={log.id} className="bg-black/40 border-white/10">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {log.status === 'success' ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400" />
                          )}
                          <span className="font-medium text-white text-sm">{log.tool}</span>
                          <Badge variant="outline" className="text-xs">{log.server}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-white/60">
                          <span>{log.duration}ms</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-white/60">Input:</label>
                          <pre className="bg-black/40 p-2 rounded text-xs text-white/80 overflow-x-auto">
                            {log.input}
                          </pre>
                        </div>
                        <div>
                          <label className="text-xs text-white/60">Output:</label>
                          <pre className={`bg-black/40 p-2 rounded text-xs overflow-x-auto ${
                            log.status === 'success' ? 'text-green-300' : 'text-red-300'
                          }`}>
                            {log.output}
                          </pre>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="bg-black/40 border-white/10">
                  <CardContent className="p-8 text-center">
                    <Terminal className="w-12 h-12 text-white/20 mx-auto mb-3" />
                    <p className="text-sm text-white/60">No execution logs yet</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MCPConnectorPlugin;
