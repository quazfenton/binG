"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { 
  Terminal, Play, Square, RefreshCw, Trash2, Download, Upload,
  Server, Cloud, Database, Container, GitBranch, Zap, Settings,
  Activity, AlertCircle, CheckCircle, XCircle, Loader2, DollarSign,
  BarChart, TrendingUp, Clock, Users, Code, Box
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string[];
  created: string;
}

interface CloudResource {
  id: string;
  name: string;
  type: string;
  provider: string;
  region: string;
  status: string;
  cost: number;
}

interface Pipeline {
  id: string;
  name: string;
  status: string;
  branch: string;
  commit: string;
  duration: number;
  started: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

const CLOUD_PROVIDERS = ['AWS', 'GCP', 'Azure', 'DigitalOcean', 'Heroku'];
const RESOURCE_TYPES = ['Compute', 'Database', 'Storage', 'Network', 'Function'];

export default function DevOpsCommandCenterPlugin({ onClose }: PluginProps) {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [resources, setResources] = useState<CloudResource[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [composeFile, setComposeFile] = useState('');
  const [command, setCommand] = useState('');
  const [commandOutput, setCommandOutput] = useState('');
  const [streamingLogs, setStreamingLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadContainers();
    loadResources();
    loadPipelines();
  }, []);

  useEffect(() => {
    if (streamingLogs && selectedContainer) {
      const interval = setInterval(() => {
        fetchLogs(selectedContainer);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [streamingLogs, selectedContainer]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const loadContainers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/docker/containers');
      if (res.ok) {
        const data = await res.json();
        setContainers(data);
      }
    } catch (err) {
      // Mock data for demo
      setContainers([
        { id: '1', name: 'nginx-proxy', image: 'nginx:latest', status: 'running', state: 'Up 2 hours', ports: ['80:80', '443:443'], created: '2 hours ago' },
        { id: '2', name: 'postgres-db', image: 'postgres:14', status: 'running', state: 'Up 1 day', ports: ['5432:5432'], created: '1 day ago' },
        { id: '3', name: 'redis-cache', image: 'redis:alpine', status: 'running', state: 'Up 5 hours', ports: ['6379:6379'], created: '5 hours ago' },
        { id: '4', name: 'api-server', image: 'node:18', status: 'exited', state: 'Exited (0) 10 minutes ago', ports: [], created: '3 hours ago' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const loadResources = async () => {
    try {
      const res = await fetch('/api/cloud/resources');
      if (res.ok) {
        const data = await res.json();
        setResources(data);
      }
    } catch (err) {
      // Mock data
      setResources([
        { id: 'r1', name: 'web-server-01', type: 'Compute', provider: 'AWS', region: 'us-east-1', status: 'running', cost: 48.50 },
        { id: 'r2', name: 'db-primary', type: 'Database', provider: 'AWS', region: 'us-east-1', status: 'running', cost: 125.00 },
        { id: 'r3', name: 'storage-bucket', type: 'Storage', provider: 'GCP', region: 'us-central1', status: 'active', cost: 12.30 },
        { id: 'r4', name: 'api-gateway', type: 'Network', provider: 'Azure', region: 'eastus', status: 'running', cost: 35.80 }
      ]);
    }
  };

  const loadPipelines = async () => {
    try {
      const res = await fetch('/api/cicd/pipelines');
      if (res.ok) {
        const data = await res.json();
        setPipelines(data);
      }
    } catch (err) {
      // Mock data
      setPipelines([
        { id: 'p1', name: 'Build & Test', status: 'success', branch: 'main', commit: 'a3f4b2c', duration: 245, started: '10 minutes ago' },
        { id: 'p2', name: 'Deploy Staging', status: 'running', branch: 'develop', commit: 'b5e6d1a', duration: 120, started: '2 minutes ago' },
        { id: 'p3', name: 'Security Scan', status: 'failed', branch: 'main', commit: 'c7g8h3e', duration: 180, started: '1 hour ago' },
        { id: 'p4', name: 'E2E Tests', status: 'success', branch: 'feature/new-ui', commit: 'd9i0j4f', duration: 320, started: '3 hours ago' }
      ]);
    }
  };

  const fetchLogs = async (containerId: string) => {
    try {
      const res = await fetch(`/api/docker/logs/${containerId}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      // Mock logs
      const mockLogs: LogEntry[] = Array.from({ length: 20 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 5000).toISOString(),
        level: ['INFO', 'WARN', 'ERROR', 'DEBUG'][Math.floor(Math.random() * 4)],
        message: `Log message ${i + 1}: ${['Request processed', 'Cache hit', 'Database query', 'API call completed'][Math.floor(Math.random() * 4)]}`
      }));
      setLogs(mockLogs);
    }
  };

  const startContainer = async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/docker/start/${id}`, { method: 'POST' });
      toast.success('Container started');
      loadContainers();
    } catch (err) {
      toast.error('Failed to start container');
    } finally {
      setLoading(false);
    }
  };

  const stopContainer = async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/docker/stop/${id}`, { method: 'POST' });
      toast.success('Container stopped');
      loadContainers();
    } catch (err) {
      toast.error('Failed to stop container');
    } finally {
      setLoading(false);
    }
  };

  const removeContainer = async (id: string) => {
    if (!confirm('Are you sure you want to remove this container?')) return;
    setLoading(true);
    try {
      await fetch(`/api/docker/remove/${id}`, { method: 'DELETE' });
      toast.success('Container removed');
      loadContainers();
    } catch (err) {
      toast.error('Failed to remove container');
    } finally {
      setLoading(false);
    }
  };

  const executeCommand = async () => {
    if (!command) return;
    setLoading(true);
    try {
      const res = await fetch('/api/docker/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ containerId: selectedContainer, command })
      });
      const data = await res.json();
      setCommandOutput(data.output);
      toast.success('Command executed');
    } catch (err) {
      setCommandOutput('Error executing command');
      toast.error('Command failed');
    } finally {
      setLoading(false);
    }
  };

  const deployCompose = async () => {
    setLoading(true);
    try {
      await fetch('/api/docker/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compose: composeFile })
      });
      toast.success('Compose deployed');
      loadContainers();
    } catch (err) {
      toast.error('Deploy failed');
    } finally {
      setLoading(false);
    }
  };

  const restartPipeline = async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/cicd/restart/${id}`, { method: 'POST' });
      toast.success('Pipeline restarted');
      loadPipelines();
    } catch (err) {
      toast.error('Failed to restart pipeline');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
      case 'success':
      case 'active':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'exited':
      case 'stopped':
        return <Square className="w-4 h-4 text-gray-400" />;
      default:
        return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
    }
  };

  const totalCost = resources.reduce((sum, r) => sum + r.cost, 0);

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            DevOps Command Center
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="containers" className="w-full">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="containers"><Container className="w-4 h-4 mr-1" /> Containers</TabsTrigger>
            <TabsTrigger value="cloud"><Cloud className="w-4 h-4 mr-1" /> Cloud</TabsTrigger>
            <TabsTrigger value="pipelines"><GitBranch className="w-4 h-4 mr-1" /> Pipelines</TabsTrigger>
            <TabsTrigger value="logs"><Terminal className="w-4 h-4 mr-1" /> Logs</TabsTrigger>
            <TabsTrigger value="compose"><Code className="w-4 h-4 mr-1" /> Compose</TabsTrigger>
          </TabsList>

          {/* Containers */}
          <TabsContent value="containers" className="space-y-3 pt-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">Docker Containers ({containers.length})</h3>
              <Button size="sm" onClick={loadContainers} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {containers.map(container => (
              <Card key={container.id} className="bg-white/5">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(container.status)}
                      <div>
                        <h4 className="font-medium text-sm">{container.name}</h4>
                        <p className="text-xs text-gray-400">{container.image}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {container.status === 'running' ? (
                        <Button size="sm" variant="ghost" onClick={() => stopContainer(container.id)}>
                          <Square className="w-3 h-3" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startContainer(container.id)}>
                          <Play className="w-3 h-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => fetchLogs(container.id)}>
                        <Terminal className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeContainer(container.id)}>
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-400">State:</span>
                      <span>{container.state}</span>
                    </div>
                    {container.ports.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Ports:</span>
                        <span>{container.ports.join(', ')}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-400">Created:</span>
                      <span>{container.created}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Cloud Resources */}
          <TabsContent value="cloud" className="space-y-3 pt-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">Cloud Resources</h3>
              <div className="flex items-center gap-3">
                <Badge variant="outline">
                  <DollarSign className="w-3 h-3 mr-1" />
                  ${totalCost.toFixed(2)}/mo
                </Badge>
                <Button size="sm" onClick={loadResources}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {resources.map(resource => (
              <Card key={resource.id} className="bg-white/5">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(resource.status)}
                        <h4 className="font-medium text-sm">{resource.name}</h4>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-gray-400">Type: </span>
                          <Badge variant="secondary" className="text-xs">{resource.type}</Badge>
                        </div>
                        <div>
                          <span className="text-gray-400">Provider: </span>
                          <Badge variant="secondary" className="text-xs">{resource.provider}</Badge>
                        </div>
                        <div>
                          <span className="text-gray-400">Region: </span>
                          <span>{resource.region}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Cost: </span>
                          <span className="text-green-400">${resource.cost.toFixed(2)}/mo</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* CI/CD Pipelines */}
          <TabsContent value="pipelines" className="space-y-3 pt-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">CI/CD Pipelines</h3>
              <Button size="sm" onClick={loadPipelines}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            {pipelines.map(pipeline => (
              <Card key={pipeline.id} className="bg-white/5">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      {getStatusIcon(pipeline.status)}
                      <div className="flex-1">
                        <h4 className="font-medium text-sm">{pipeline.name}</h4>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                          <Badge variant="outline" className="text-xs">{pipeline.branch}</Badge>
                          <span>•</span>
                          <span>{pipeline.commit}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {Math.floor(pipeline.duration / 60)}m {pipeline.duration % 60}s
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => restartPipeline(pipeline.id)}>
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="text-xs text-gray-400 mt-2">
                    Started {pipeline.started}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Logs */}
          <TabsContent value="logs" className="pt-4 space-y-3">
            <div className="flex gap-2 items-center">
              <Select value={selectedContainer} onValueChange={setSelectedContainer}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select container" />
                </SelectTrigger>
                <SelectContent>
                  {containers.filter(c => c.status === 'running').map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => fetchLogs(selectedContainer)} disabled={!selectedContainer}>
                Load Logs
              </Button>
              <Button
                variant={streamingLogs ? 'default' : 'outline'}
                onClick={() => setStreamingLogs(!streamingLogs)}
                disabled={!selectedContainer}
              >
                {streamingLogs ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
            </div>

            <Card className="bg-black border-white/10">
              <CardContent className="p-3 h-80 overflow-y-auto font-mono text-xs">
                {logs.map((log, i) => (
                  <div key={i} className="mb-1">
                    <span className="text-gray-500">{log.timestamp}</span>
                    {' '}
                    <span className={
                      log.level === 'ERROR' ? 'text-red-400' :
                      log.level === 'WARN' ? 'text-yellow-400' :
                      log.level === 'INFO' ? 'text-blue-400' :
                      'text-gray-400'
                    }>
                      [{log.level}]
                    </span>
                    {' '}
                    <span>{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </CardContent>
            </Card>

            <div className="space-y-2">
              <label className="text-sm font-medium">Execute Command</label>
              <div className="flex gap-2">
                <Input
                  placeholder="docker exec command..."
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && executeCommand()}
                />
                <Button onClick={executeCommand} disabled={!selectedContainer || !command}>
                  <Play className="w-4 h-4" />
                </Button>
              </div>
              {commandOutput && (
                <Card className="bg-black border-white/10">
                  <CardContent className="p-3 font-mono text-xs">
                    <pre>{commandOutput}</pre>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Docker Compose */}
          <TabsContent value="compose" className="pt-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Docker Compose YAML</label>
              <Textarea
                value={composeFile}
                onChange={(e) => setComposeFile(e.target.value)}
                placeholder="version: '3.8'\nservices:\n  web:\n    image: nginx:latest\n    ports:\n      - '80:80'"
                rows={15}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={deployCompose} disabled={!composeFile || loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Deploy Compose
              </Button>
              <Button variant="outline" onClick={() => setComposeFile('')}>
                Clear
              </Button>
            </div>

            <Card className="bg-white/5">
              <CardHeader>
                <CardTitle className="text-sm">Quick Templates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setComposeFile(`version: '3.8'
services:
  nginx:
    image: nginx:latest
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf`)}
                >
                  Nginx Web Server
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setComposeFile(`version: '3.8'
services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:`)}
                >
                  PostgreSQL Database
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setComposeFile(`version: '3.8'
services:
  app:
    image: node:18
    working_dir: /app
    volumes:
      - .:/app
    ports:
      - "3000:3000"
    command: npm run dev
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"`)}
                >
                  Node.js + Redis Stack
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
}
