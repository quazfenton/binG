"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  StopCircle,
  RotateCcw,
  Settings,
  Activity,
  Terminal,
  Cpu,
  GitBranch,
  Zap,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Layers,
  Workflow,
  Bot,
  MessageSquare,
  Send,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Save,
  Download,
  Upload,
  ChevronRight,
  ChevronDown,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type FrameworkType = 'mastra' | 'crewai';

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'action' | 'condition' | 'loop' | 'parallel' | 'wait';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  duration?: number;
  error?: string;
  config?: Record<string, any>;
  condition?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  type: 'sequential' | 'conditional' | 'parallel';
}

export interface WorkflowConfig {
  id: string;
  name: string;
  framework: FrameworkType;
  enabled: boolean;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  parameters: WorkflowParameter[];
  logs: WorkflowLog[];
  events: WorkflowEvent[];
}

export interface WorkflowParameter {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  value: any;
  defaultValue: any;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description?: string;
}

export interface WorkflowLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  data?: any;
}

export interface WorkflowEvent {
  id: string;
  timestamp: number;
  type: 'step_start' | 'step_complete' | 'step_fail' | 'condition' | 'parallel_start' | 'parallel_complete';
  stepId?: string;
  data?: any;
}

export interface WorkflowVisualizerProps {
  framework: FrameworkType;
  workflows: WorkflowConfig[];
  onToggleWorkflow?: (workflowId: string, enabled: boolean) => void;
  onUpdateParameter?: (workflowId: string, parameterId: string, value: any) => void;
  onRunWorkflow?: (workflowId: string) => void;
  onStopWorkflow?: (workflowId: string) => void;
  onRefresh?: () => void;
}

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_MASTRA_WORKFLOW: WorkflowConfig = {
  id: 'mastra-code-agent',
  name: 'Code Agent Workflow',
  framework: 'mastra',
  enabled: true,
  steps: [
    { id: 'step-1', name: 'Plan Generation', type: 'action', status: 'completed', duration: 2340 },
    { id: 'step-2', name: 'Tool Selection', type: 'condition', status: 'completed', duration: 890 },
    { id: 'step-3', name: 'Code Execution', type: 'action', status: 'running', duration: 0 },
    { id: 'step-4', name: 'Syntax Check', type: 'condition', status: 'pending' },
    { id: 'step-5', name: 'Self-Healing', type: 'condition', status: 'pending', condition: 'if syntax fails' },
    { id: 'step-6', name: 'Final Review', type: 'action', status: 'pending' },
  ],
  edges: [
    { id: 'edge-1', source: 'step-1', target: 'step-2', type: 'sequential' },
    { id: 'edge-2', source: 'step-2', target: 'step-3', type: 'sequential' },
    { id: 'edge-3', source: 'step-3', target: 'step-4', type: 'sequential' },
    { id: 'edge-4', source: 'step-4', target: 'step-5', type: 'conditional', condition: 'fails' },
    { id: 'edge-5', source: 'step-4', target: 'step-6', type: 'conditional', condition: 'passes' },
    { id: 'edge-6', source: 'step-5', target: 'step-3', type: 'sequential' },
  ],
  parameters: [
    { id: 'p1', name: 'Max Steps', type: 'number', value: 15, defaultValue: 10, min: 1, max: 50, step: 1, description: 'Maximum execution steps' },
    { id: 'p2', name: 'Temperature', type: 'number', value: 0.7, defaultValue: 0.7, min: 0, max: 2, step: 0.1, description: 'LLM temperature' },
    { id: 'p3', name: 'Enable Self-Healing', type: 'boolean', value: true, defaultValue: true, description: 'Auto-retry on failures' },
    { id: 'p4', name: 'Model', type: 'select', value: 'gpt-4o', defaultValue: 'gpt-4o', options: ['gpt-4o', 'claude-sonnet', 'gemini-pro'], description: 'LLM model' },
  ],
  logs: [
    { id: 'log-1', timestamp: Date.now() - 60000, level: 'info', source: 'workflow', message: 'Workflow started' },
    { id: 'log-2', timestamp: Date.now() - 55000, level: 'info', source: 'step-1', message: 'Planning phase initiated' },
    { id: 'log-3', timestamp: Date.now() - 50000, level: 'info', source: 'step-1', message: 'Generated 5-step plan' },
    { id: 'log-4', timestamp: Date.now() - 45000, level: 'info', source: 'step-2', message: 'Selected tools: write_file, execute_code' },
    { id: 'log-5', timestamp: Date.now() - 40000, level: 'info', source: 'step-3', message: 'Executing code...' },
  ],
  events: [
    { id: 'evt-1', timestamp: Date.now() - 60000, type: 'step_start', stepId: 'step-1' },
    { id: 'evt-2', timestamp: Date.now() - 50000, type: 'step_complete', stepId: 'step-1' },
    { id: 'evt-3', timestamp: Date.now() - 45000, type: 'step_start', stepId: 'step-2' },
    { id: 'evt-4', timestamp: Date.now() - 40000, type: 'step_complete', stepId: 'step-2' },
    { id: 'evt-5', timestamp: Date.now() - 40000, type: 'step_start', stepId: 'step-3' },
  ],
};

const MOCK_CREWAI_WORKFLOW: WorkflowConfig = {
  id: 'crewai-multi-agent',
  name: 'Multi-Agent Crew',
  framework: 'crewai',
  enabled: true,
  steps: [
    { id: 'agent-1', name: 'Planner Agent', type: 'action', status: 'completed', duration: 3200 },
    { id: 'agent-2', name: 'Researcher Agent', type: 'action', status: 'completed', duration: 4500 },
    { id: 'agent-3', name: 'Writer Agent', type: 'action', status: 'running', duration: 0 },
    { id: 'agent-4', name: 'Critic Agent', type: 'condition', status: 'pending' },
    { id: 'agent-5', name: 'Manager Agent', type: 'parallel', status: 'pending' },
  ],
  edges: [
    { id: 'edge-1', source: 'agent-1', target: 'agent-2', type: 'sequential' },
    { id: 'edge-2', source: 'agent-2', target: 'agent-3', type: 'sequential' },
    { id: 'edge-3', source: 'agent-3', target: 'agent-4', type: 'sequential' },
    { id: 'edge-4', source: 'agent-4', target: 'agent-5', type: 'conditional', condition: 'if approval needed' },
  ],
  parameters: [
    { id: 'p1', name: 'Process Type', type: 'select', value: 'sequential', defaultValue: 'sequential', options: ['sequential', 'hierarchical', 'consensual'], description: 'Agent coordination' },
    { id: 'p2', name: 'Verbose', type: 'boolean', value: true, defaultValue: false, description: 'Detailed logging' },
    { id: 'p3', name: 'Memory', type: 'boolean', value: true, defaultValue: true, description: 'Enable agent memory' },
    { id: 'p4', name: 'Cache', type: 'boolean', value: true, defaultValue: true, description: 'Enable result caching' },
    { id: 'p5', name: 'Max RPM', type: 'number', value: 30, defaultValue: 30, min: 1, max: 100, step: 1, description: 'Rate limit' },
    { id: 'p6', name: 'Manager LLM', type: 'select', value: 'gpt-4o', defaultValue: 'gpt-4o', options: ['gpt-4o', 'claude-sonnet', 'gemini-pro'], description: 'Manager model' },
  ],
  logs: [
    { id: 'log-1', timestamp: Date.now() - 90000, level: 'info', source: 'crew', message: 'Crew kickoff initiated' },
    { id: 'log-2', timestamp: Date.now() - 85000, level: 'info', source: 'agent-1', message: 'Planner agent started' },
    { id: 'log-3', timestamp: Date.now() - 80000, level: 'info', source: 'agent-1', message: 'Created task breakdown' },
    { id: 'log-4', timestamp: Date.now() - 75000, level: 'info', source: 'agent-2', message: 'Research agent started' },
    { id: 'log-5', timestamp: Date.now() - 70000, level: 'info', source: 'agent-2', message: 'Gathered 15 sources' },
    { id: 'log-6', timestamp: Date.now() - 65000, level: 'info', source: 'agent-3', message: 'Writer agent started' },
    { id: 'log-7', timestamp: Date.now() - 60000, level: 'info', source: 'agent-3', message: 'Drafting content...' },
  ],
  events: [
    { id: 'evt-1', timestamp: Date.now() - 90000, type: 'step_start', stepId: 'agent-1' },
    { id: 'evt-2', timestamp: Date.now() - 80000, type: 'step_complete', stepId: 'agent-1' },
    { id: 'evt-3', timestamp: Date.now() - 75000, type: 'step_start', stepId: 'agent-2' },
    { id: 'evt-4', timestamp: Date.now() - 70000, type: 'step_complete', stepId: 'agent-2' },
    { id: 'evt-5', timestamp: Date.now() - 65000, type: 'step_start', stepId: 'agent-3' },
  ],
};

// ============================================================================
// Component
// ============================================================================

export default function FrameworkVisualizer({
  framework,
  workflows,
  onToggleWorkflow,
  onUpdateParameter,
  onRunWorkflow,
  onStopWorkflow,
  onRefresh,
}: WorkflowVisualizerProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowConfig | null>(
    workflows.find(w => w.enabled) || workflows[0] || null
  );
  const [showLogs, setShowLogs] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showConfig, setShowConfig] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedWorkflow?.logs, showLogs]);

  // Auto-scroll events
  useEffect(() => {
    if (showEvents && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedWorkflow?.events, showEvents]);

  const getStepColor = useCallback((status: WorkflowStep['status']) => {
    switch (status) {
      case 'pending': return '#6b7280';
      case 'running': return '#3b82f6';
      case 'completed': return '#22c55e';
      case 'failed': return '#ef4444';
      case 'skipped': return '#6b7280';
      default: return '#6b7280';
    }
  }, []);

  const getStepIcon = useCallback((type: WorkflowStep['type']) => {
    switch (type) {
      case 'action': return '⚡';
      case 'condition': return '🔀';
      case 'loop': return '🔄';
      case 'parallel': return '∥';
      case 'wait': return '⏳';
      default: return '📦';
    }
  }, []);

  const getLogLevelColor = useCallback((level: WorkflowLog['level']) => {
    switch (level) {
      case 'info': return '#3b82f6';
      case 'warn': return '#f59e0b';
      case 'error': return '#ef4444';
      case 'debug': return '#6b7280';
      default: return '#6b7280';
    }
  }, []);

  const getEventTypeColor = useCallback((type: WorkflowEvent['type']) => {
    switch (type) {
      case 'step_start': return '#3b82f6';
      case 'step_complete': return '#22c55e';
      case 'step_fail': return '#ef4444';
      case 'condition': return '#f59e0b';
      case 'parallel_start': return '#a855f7';
      case 'parallel_complete': return '#a855f7';
      default: return '#6b7280';
    }
  }, []);

  const handleParameterChange = (parameterId: string, value: any) => {
    if (selectedWorkflow && onUpdateParameter) {
      onUpdateParameter(selectedWorkflow.id, parameterId, value);
    }
  };

  const handleRun = () => {
    if (selectedWorkflow && onRunWorkflow) {
      setIsRunning(true);
      onRunWorkflow(selectedWorkflow.id);
      toast.success('Workflow started', {
        description: `${selectedWorkflow.name} is now running`,
      });
    }
  };

  const handleStop = () => {
    if (selectedWorkflow && onStopWorkflow) {
      setIsRunning(false);
      onStopWorkflow(selectedWorkflow.id);
      toast.info('Workflow stopped', {
        description: `${selectedWorkflow.name} has been stopped`,
      });
    }
  };

  const handleToggle = (enabled: boolean) => {
    if (selectedWorkflow && onToggleWorkflow) {
      onToggleWorkflow(selectedWorkflow.id, enabled);
      toast.success(enabled ? 'Workflow enabled' : 'Workflow disabled', {
        description: selectedWorkflow.name,
      });
    }
  };

  if (!selectedWorkflow) {
    return (
      <div className="h-full flex items-center justify-center text-white/40">
        <div className="text-center">
          <Workflow className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No workflows available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-black/40 rounded-lg border border-white/10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {framework === 'mastra' ? (
              <Layers className="w-5 h-5 text-purple-400" />
            ) : (
              <Bot className="w-5 h-5 text-cyan-400" />
            )}
            <h3 className="text-sm font-semibold text-white">{selectedWorkflow.name}</h3>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              selectedWorkflow.enabled
                ? 'border-green-500/30 text-green-300'
                : 'border-gray-500/30 text-gray-400'
            }`}
          >
            {selectedWorkflow.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          {isRunning && (
            <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-300 animate-pulse">
              <Activity className="w-2 h-2 mr-1" />
              Running
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleToggle(!selectedWorkflow.enabled)}
            className={`text-xs ${
              selectedWorkflow.enabled
                ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                : 'bg-gray-500/20 text-gray-300 hover:bg-gray-500/30'
            }`}
          >
            {selectedWorkflow.enabled ? (
              <>
                <Eye className="w-3 h-3 mr-1" />
                Disable
              </>
            ) : (
              <>
                <EyeOff className="w-3 h-3 mr-1" />
                Enable
              </>
            )}
          </Button>
          {!isRunning ? (
            <Button
              size="sm"
              onClick={handleRun}
              disabled={!selectedWorkflow.enabled}
              className="bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 text-xs"
            >
              <Play className="w-3 h-3 mr-1" />
              Run
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleStop}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-xs"
            >
              <StopCircle className="w-3 h-3 mr-1" />
              Stop
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onRefresh} className="text-white/60">
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Workflow Canvas */}
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {/* Workflow Visualization */}
          <Card className="bg-black/40 border-white/10 flex-1 overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Workflow className="w-4 h-4" />
                  Workflow Steps
                </h4>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="text-white/60">
                    <ZoomOut className="w-3 h-3" />
                  </Button>
                  <span className="text-xs text-white/40 w-10 text-center">{Math.round(zoom * 100)}%</span>
                  <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.min(2, z + 0.1))} className="text-white/60">
                    <ZoomIn className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div
                  className="relative min-h-[400px]"
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                >
                  {/* SVG for edges */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    {selectedWorkflow.edges.map(edge => {
                      const sourceIndex = selectedWorkflow.steps.findIndex(s => s.id === edge.source);
                      const targetIndex = selectedWorkflow.steps.findIndex(s => s.id === edge.target);
                      if (sourceIndex === -1 || targetIndex === -1) return null;
                      
                      const sourceY = 80 + sourceIndex * 100;
                      const targetY = 80 + targetIndex * 100;
                      
                      return (
                        <g key={edge.id}>
                          <line
                            x1={200}
                            y1={sourceY + 60}
                            x2={200}
                            y2={targetY - 20}
                            stroke={getStepColor(selectedWorkflow.steps.find(s => s.id === edge.source)?.status || 'pending')}
                            strokeWidth="2"
                            strokeDasharray={edge.type === 'conditional' ? "5,5" : "none"}
                            className="transition-all duration-300"
                          />
                          {edge.condition && (
                            <text
                              x={210}
                              y={(sourceY + targetY) / 2}
                              fill="#f59e0b"
                              fontSize="10"
                              fontStyle="italic"
                            >
                              {edge.condition}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>

                  {/* Steps */}
                  {selectedWorkflow.steps.map((step, index) => (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="absolute flex items-center gap-3 p-3 rounded-lg border-2 bg-black/60 cursor-pointer transition-all hover:scale-105"
                      style={{
                        left: 50,
                        top: 80 + index * 100,
                        borderColor: getStepColor(step.status),
                      }}
                    >
                      {/* Status Indicator */}
                      <div
                        className={`w-3 h-3 rounded-full ${
                          step.status === 'running' ? 'animate-pulse' : ''
                        }`}
                        style={{ backgroundColor: getStepColor(step.status) }}
                      />

                      {/* Icon */}
                      <span className="text-xl">{getStepIcon(step.type)}</span>

                      {/* Content */}
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">{step.name}</p>
                        <div className="flex items-center gap-2 text-[10px] text-white/40">
                          <span className="capitalize">{step.type}</span>
                          {step.duration !== undefined && step.duration > 0 && (
                            <span>• {step.duration}ms</span>
                          )}
                        </div>
                      </div>

                      {/* Status Badge */}
                      <Badge
                        variant="outline"
                        className={`text-[8px] ${
                          step.status === 'completed' ? 'border-green-500/30 text-green-300' :
                          step.status === 'running' ? 'border-blue-500/30 text-blue-300' :
                          step.status === 'failed' ? 'border-red-500/30 text-red-300' :
                          'border-gray-500/30 text-gray-400'
                        }`}
                      >
                        {step.status}
                      </Badge>
                    </motion.div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Logs & Events */}
          <div className="grid grid-cols-2 gap-4 h-64">
            {/* Logs */}
            {showLogs && (
              <Card className="bg-black/40 border-white/10 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      Logs
                    </h4>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowLogs(false)}
                      className="h-6 w-6 text-white/60"
                    >
                      <Minimize className="w-3 h-3" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[180px]">
                    <div className="space-y-1">
                      {selectedWorkflow.logs?.slice(-20).reverse().map((log) => (
                        <div
                          key={log.id}
                          className="p-1.5 rounded bg-black/30 border border-white/5 text-[10px]"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[9px]"
                              style={{ color: getLogLevelColor(log.level) }}
                            >
                              [{log.level.toUpperCase()}]
                            </span>
                            <span className="text-white/40">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="text-white/60">{log.source}</span>
                          </div>
                          <p className="text-white/80 mt-0.5">{log.message}</p>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Events */}
            {showEvents && (
              <Card className="bg-black/40 border-white/10 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Events
                    </h4>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowEvents(false)}
                      className="h-6 w-6 text-white/60"
                    >
                      <Minimize className="w-3 h-3" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[180px]">
                    <div className="space-y-1">
                      {selectedWorkflow.events?.slice(-20).reverse().map((event) => (
                        <div
                          key={event.id}
                          className="p-1.5 rounded bg-black/30 border border-white/5 text-[10px]"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[9px]"
                              style={{ color: getEventTypeColor(event.type) }}
                            >
                              {event.type.replace('_', ' ')}
                            </span>
                            <span className="text-white/40">
                              {new Date(event.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))}
                      <div ref={eventsEndRef} />
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Configuration Panel */}
        {showConfig && (
          <div className="w-80 flex flex-col gap-3 overflow-hidden">
            <Card className="bg-black/40 border-white/10 flex-1 overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    Parameters
                  </h4>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowConfig(false)}
                    className="h-6 w-6 text-white/60"
                  >
                    <Minimize className="w-3 h-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4">
                    {selectedWorkflow.parameters.map((param) => (
                      <div key={param.id} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-white/80">{param.name}</Label>
                          {param.value !== param.defaultValue && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleParameterChange(param.id, param.defaultValue)}
                              className="h-5 w-5 text-white/40 hover:text-white/60"
                              title="Reset to default"
                            >
                              <RotateCcw className="w-2 h-2" />
                            </Button>
                          )}
                        </div>
                        
                        {param.type === 'string' && (
                          <Input
                            value={param.value}
                            onChange={(e) => handleParameterChange(param.id, e.target.value)}
                            className="h-7 bg-black/30 border-white/10 text-white/90 text-xs"
                          />
                        )}
                        
                        {param.type === 'number' && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Slider
                                value={[param.value]}
                                onValueChange={(v) => handleParameterChange(param.id, v[0])}
                                min={param.min}
                                max={param.max}
                                step={param.step}
                                className="flex-1"
                              />
                              <span className="text-xs text-white/60 w-12 text-right">
                                {param.value}
                              </span>
                            </div>
                            {param.description && (
                              <p className="text-[9px] text-white/40">{param.description}</p>
                            )}
                          </div>
                        )}
                        
                        {param.type === 'boolean' && (
                          <div className="flex items-center justify-between">
                            <Switch
                              checked={param.value}
                              onCheckedChange={(v) => handleParameterChange(param.id, v)}
                            />
                            {param.description && (
                              <p className="text-[9px] text-white/40">{param.description}</p>
                            )}
                          </div>
                        )}
                        
                        {param.type === 'select' && (
                          <select
                            value={param.value}
                            onChange={(e) => handleParameterChange(param.id, e.target.value)}
                            className="w-full h-7 bg-black/30 border border-white/10 rounded text-xs text-white/90 px-2"
                          >
                            {param.options?.map((opt) => (
                              <option key={opt} value={opt} className="bg-black text-white">
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-white/60">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-500" />
          <span>Pending</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
          <span>Running</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>Failed</span>
        </div>
        <div className="border-l border-white/10 pl-4 flex items-center gap-2">
          <span className="text-[10px]">⚡ Action</span>
          <span className="text-[10px]">🔀 Condition</span>
          <span className="text-[10px]">🔄 Loop</span>
          <span className="text-[10px]">∥ Parallel</span>
        </div>
      </div>
    </div>
  );
}

// Export mock data for integration
export { MOCK_MASTRA_WORKFLOW, MOCK_CREWAI_WORKFLOW };
