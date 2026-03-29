/**
 * n8n Workflows Tab
 * 
 * Frontend for external n8n automation integration
 * Features:
 * - Workflow execution & monitoring
 * - Visual workflow settings
 * - Execution history
 * - Sleek glassmorphic design
 */

"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Workflow,
  Play,
  Square,
  RefreshCw,
  Settings,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Zap,
  Calendar,
  BarChart3,
  ExternalLink,
  Plus,
  Trash,
  Edit,
  Save,
  Eye,
  Copy,
  Download,
  Upload,
  Link,
  Unlink,
  ChevronRight,
  ChevronDown,
  Activity,
  Timer,
  Database,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";

// Types
interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "success" | "error" | "running" | "waiting";
  startTime: number;
  endTime?: number;
  duration?: number;
  trigger: "manual" | "webhook" | "schedule" | "api";
}

interface Workflow {
  id: string;
  name: string;
  active: boolean;
  lastRun?: number;
  nextRun?: number;
  trigger: "webhook" | "schedule" | "manual";
  schedule?: string;
  executions: number;
  successRate: number;
  avgDuration: number;
}

interface WorkflowSettings {
  n8nUrl: string;
  apiKey: string;
  autoRefresh: boolean;
  refreshInterval: number;
  showNotifications: boolean;
  compactMode: boolean;
}

// Mock data (will be replaced with real n8n API calls)
const MOCK_WORKFLOWS: Workflow[] = [
  {
    id: "1",
    name: "Content Publishing Pipeline",
    active: true,
    lastRun: Date.now() - 3600000,
    nextRun: Date.now() + 3600000,
    trigger: "schedule",
    schedule: "0 * * * *",
    executions: 1247,
    successRate: 98.5,
    avgDuration: 2340,
  },
  {
    id: "2",
    name: "Social Media Auto-Poster",
    active: true,
    lastRun: Date.now() - 7200000,
    trigger: "webhook",
    executions: 892,
    successRate: 99.2,
    avgDuration: 1250,
  },
  {
    id: "3",
    name: "Data Sync & Backup",
    active: false,
    lastRun: Date.now() - 86400000,
    trigger: "schedule",
    schedule: "0 0 * * *",
    executions: 365,
    successRate: 97.8,
    avgDuration: 45000,
  },
  {
    id: "4",
    name: "Lead Processing Automation",
    active: true,
    lastRun: Date.now() - 1800000,
    trigger: "webhook",
    executions: 2156,
    successRate: 99.8,
    avgDuration: 890,
  },
];

const MOCK_EXECUTIONS: WorkflowExecution[] = [
  {
    id: "exec-1",
    workflowId: "1",
    workflowName: "Content Publishing Pipeline",
    status: "success",
    startTime: Date.now() - 3600000,
    endTime: Date.now() - 3597660,
    duration: 2340,
    trigger: "schedule",
  },
  {
    id: "exec-2",
    workflowId: "2",
    workflowName: "Social Media Auto-Poster",
    status: "success",
    startTime: Date.now() - 7200000,
    endTime: Date.now() - 7198750,
    duration: 1250,
    trigger: "webhook",
  },
  {
    id: "exec-3",
    workflowId: "4",
    workflowName: "Lead Processing Automation",
    status: "running",
    startTime: Date.now() - 30000,
    trigger: "api",
  },
  {
    id: "exec-4",
    workflowId: "1",
    workflowName: "Content Publishing Pipeline",
    status: "error",
    startTime: Date.now() - 7200000,
    endTime: Date.now() - 7195000,
    duration: 5000,
    trigger: "schedule",
  },
];

export default function WorkflowsTab() {
  const [workflows, setWorkflows] = useState<Workflow[]>(MOCK_WORKFLOWS);
  const [executions, setExecutions] = useState<WorkflowExecution[]>(MOCK_EXECUTIONS);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"workflows" | "executions" | "settings">("workflows");

  const [settings, setSettings] = useState<WorkflowSettings>({
    n8nUrl: "",
    apiKey: "",
    autoRefresh: true,
    refreshInterval: 30,
    showNotifications: true,
    compactMode: false,
  });

  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("n8n-workflow-settings");
      if (saved) {
        setSettings(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load workflow settings:", e);
    }
  }, []);

  // Save settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("n8n-workflow-settings", JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save workflow settings:", e);
    }
  }, [settings]);

  // Auto-refresh
  useEffect(() => {
    if (!settings.autoRefresh) return;

    const interval = setInterval(() => {
      handleRefresh();
    }, settings.refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [settings.autoRefresh, settings.refreshInterval]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // TODO: Replace with actual n8n API calls
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsRefreshing(false);
    toast.success("Workflows refreshed");
  };

  const handleToggleWorkflow = async (workflowId: string) => {
    setWorkflows(prev => prev.map(w => 
      w.id === workflowId ? { ...w, active: !w.active } : w
    ));
    toast.success("Workflow toggled");
    // TODO: Call n8n API to actually toggle
  };

  const handleRunWorkflow = async (workflowId: string) => {
    toast.info("Starting workflow execution...");
    // TODO: Call n8n API to run workflow
    setTimeout(() => {
      toast.success("Workflow started");
    }, 500);
  };

  const handleSaveSettings = () => {
    localStorage.setItem("n8n-workflow-settings", JSON.stringify(settings));
    toast.success("Settings saved");
    setShowSettings(false);
  };

  const getStatusIcon = (status: WorkflowExecution["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-400" />;
      case "running":
        return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
      case "waiting":
        return <Clock className="w-4 h-4 text-yellow-400" />;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">n8n Workflows</h3>
            <p className="text-xs text-white/60">Automation & Workflow Management</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("workflows")}
            className={activeTab === "workflows" ? "bg-white/10" : ""}
          >
            <Workflow className="w-4 h-4 mr-2" />
            Workflows
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("executions")}
            className={activeTab === "executions" ? "bg-white/10" : ""}
          >
            <Activity className="w-4 h-4 mr-2" />
            Executions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("settings")}
            className={activeTab === "settings" ? "bg-white/10" : ""}
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-white/60 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <AnimatePresence mode="wait">
          {/* Workflows Tab */}
          {activeTab === "workflows" && (
            <motion.div
              key="workflows"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-3"
            >
              {/* Stats Overview */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Workflow className="w-4 h-4 text-orange-400" />
                      <span className="text-xs text-white/60">Total</span>
                    </div>
                    <p className="text-xl font-bold text-white">{workflows.length}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-white/60">Active</span>
                    </div>
                    <p className="text-xl font-bold text-white">{workflows.filter(w => w.active).length}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="w-4 h-4 text-blue-400" />
                      <span className="text-xs text-white/60">Executions</span>
                    </div>
                    <p className="text-xl font-bold text-white">{workflows.reduce((sum, w) => sum + w.executions, 0)}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-white/60">Success Rate</span>
                    </div>
                    <p className="text-xl font-bold text-white">
                      {(workflows.reduce((sum, w) => sum + w.successRate, 0) / workflows.length).toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Workflow List */}
              {workflows.map((workflow) => (
                <motion.div
                  key={workflow.id}
                  layout
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${workflow.active ? "bg-green-400" : "bg-gray-400"}`} />
                      <h4 className="text-sm font-semibold text-white">{workflow.name}</h4>
                      <Badge variant="outline" className="text-[10px] border-white/20">
                        {workflow.trigger}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedWorkflow(workflow)}
                        className="h-6 w-6 text-white/60 hover:text-white"
                      >
                        <Eye className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRunWorkflow(workflow.id)}
                        className="h-6 w-6 text-green-400 hover:text-green-300"
                      >
                        <Play className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleWorkflow(workflow.id)}
                        className={`h-6 w-6 ${workflow.active ? "text-green-400" : "text-gray-400"}`}
                      >
                        {workflow.active ? <Zap className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-white/40">Last Run</span>
                      <p className="text-white/80">{workflow.lastRun ? formatTime(workflow.lastRun) : "Never"}</p>
                    </div>
                    <div>
                      <span className="text-white/40">Next Run</span>
                      <p className="text-white/80">{workflow.nextRun ? formatTime(workflow.nextRun) : "Manual"}</p>
                    </div>
                    <div>
                      <span className="text-white/40">Success Rate</span>
                      <p className="text-white/80">{workflow.successRate}%</p>
                    </div>
                    <div>
                      <span className="text-white/40">Avg Duration</span>
                      <p className="text-white/80">{formatDuration(workflow.avgDuration)}</p>
                    </div>
                  </div>

                  {workflow.schedule && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
                      <Calendar className="w-3 h-3" />
                      <span>Schedule: {workflow.schedule}</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Executions Tab */}
          {activeTab === "executions" && (
            <motion.div
              key="executions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-2"
            >
              {executions.map((execution) => (
                <motion.div
                  key={execution.id}
                  layout
                  className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(execution.status)}
                      <div>
                        <p className="text-sm font-medium text-white">{execution.workflowName}</p>
                        <p className="text-xs text-white/40">{formatTime(execution.startTime)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <span className="text-white/40">Duration</span>
                        <p className="text-white/80">{execution.duration ? formatDuration(execution.duration) : "Running"}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-white/20">
                        {execution.trigger}
                      </Badge>
                      <ChevronRight className="w-4 h-4 text-white/40" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Settings Tab */}
          {activeTab === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-4"
            >
              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Link className="w-4 h-4 text-orange-400" />
                    n8n Connection
                  </h4>
                  
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-white/60">n8n Instance URL</Label>
                      <Input
                        value={settings.n8nUrl}
                        onChange={(e) => setSettings(prev => ({ ...prev, n8nUrl: e.target.value }))}
                        placeholder="https://your-n8n-instance.com"
                        className="bg-black/40 border-white/20 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-white/60">API Key</Label>
                      <Input
                        type="password"
                        value={settings.apiKey}
                        onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                        placeholder="Enter your n8n API key"
                        className="bg-black/40 border-white/20 text-white"
                      />
                    </div>
                    <Button
                      onClick={() => toast.info("Testing connection...")}
                      variant="outline"
                      size="sm"
                      className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                    >
                      <ExternalLink className="w-3 h-3 mr-2" />
                      Test Connection
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Timer className="w-4 h-4 text-blue-400" />
                    Refresh Settings
                  </h4>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-white/80">Auto Refresh</Label>
                      <p className="text-xs text-white/40">Automatically refresh workflow data</p>
                    </div>
                    <Switch
                      checked={settings.autoRefresh}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, autoRefresh: checked }))}
                    />
                  </div>

                  <div>
                    <Label className="text-xs text-white/60">Refresh Interval (seconds)</Label>
                    <Input
                      type="number"
                      value={settings.refreshInterval}
                      onChange={(e) => setSettings(prev => ({ ...prev, refreshInterval: parseInt(e.target.value) || 30 }))}
                      className="bg-black/40 border-white/20 text-white"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Settings className="w-4 h-4 text-purple-400" />
                    Display Settings
                  </h4>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-white/80">Show Notifications</Label>
                      <p className="text-xs text-white/40">Get notified on workflow events</p>
                    </div>
                    <Switch
                      checked={settings.showNotifications}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showNotifications: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-white/80">Compact Mode</Label>
                      <p className="text-xs text-white/40">Show more workflows in less space</p>
                    </div>
                    <Switch
                      checked={settings.compactMode}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, compactMode: checked }))}
                    />
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={handleSaveSettings}
                className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>
    </div>
  );
}
