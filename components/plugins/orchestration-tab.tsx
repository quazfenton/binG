/**
 * Orchestration & Agent Options Tab
 * 
 * Visual orchestration control center with:
 * - Event bus visualization
 * - Agent selection & overrides
 * - Orchestration mode wiring
 * - Real-time execution logs
 * - Provider routing visualization
 */

"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
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
  Activity,
  Settings,
  Cpu,
  Workflow,
  Zap,
  Play,
  Square,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Database,
  Server,
  Cloud,
  Terminal,
  MessageSquare,
  Code,
  Layers,
  GitBranch,
  Box,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Pause,
  FastForward,
  Rewind,
  Filter,
  Download,
  Trash,
  Copy,
  Check,
  Network,
  Circle,
  ArrowRight,
  Plus,
  Minus,
  ZoomIn,
  ZoomOut,
  Maximize,
  X,
} from "lucide-react";
import { toast } from "sonner";

// Types
interface EventBusEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  target?: string;
  payload: any;
  status: "pending" | "processing" | "completed" | "failed";
  duration?: number;
}

interface AgentOption {
  id: string;
  name: string;
  type: "llm" | "tool" | "sandbox" | "orchestrator";
  provider: string;
  model?: string;
  active: boolean;
  priority: number;
  status: "online" | "offline" | "busy" | "error";
  lastActive?: number;
  executions: number;
  successRate: number;
}

interface OrchestrationMode {
  id: string;
  name: string;
  description: string;
  active: boolean;
  config: Record<string, any>;
  providers: string[];
  features: string[];
}

// DAG Visualizer Types
interface DAGNode {
  id: string;
  label: string;
  type: "start" | "task" | "decision" | "end";
  status: "pending" | "running" | "completed" | "failed";
  x?: number;
  y?: number;
}

interface DAGEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface DAGWorkflow {
  id: string;
  name: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  createdAt: number;
}

// Mock data (will be replaced with real event bus data)
const MOCK_EVENTS: EventBusEvent[] = [
  {
    id: "evt-1",
    type: "AGENT_REQUEST",
    timestamp: Date.now() - 5000,
    source: "chat-panel",
    target: "agent-gateway",
    payload: { task: "Build a Next.js app", provider: "mistral" },
    status: "completed",
    duration: 2340,
  },
  {
    id: "evt-2",
    type: "TOOL_EXECUTION",
    timestamp: Date.now() - 4000,
    source: "agent-gateway",
    target: "sandbox-provider",
    payload: { tool: "file.write", path: "/workspace/app.ts" },
    status: "completed",
    duration: 890,
  },
  {
    id: "evt-3",
    type: "ORCHESTRATION_STEP",
    timestamp: Date.now() - 3000,
    source: "orchestrator",
    target: "worker-1",
    payload: { step: "plan", phase: 1 },
    status: "processing",
  },
  {
    id: "evt-4",
    type: "PROVIDER_ROUTING",
    timestamp: Date.now() - 2000,
    source: "llm-router",
    target: "openrouter",
    payload: { model: "mistral-large", latency: 234 },
    status: "completed",
    duration: 234,
  },
  {
    id: "evt-5",
    type: "SANDBOX_CREATE",
    timestamp: Date.now() - 1000,
    source: "sandbox-orchestrator",
    target: "daytona",
    payload: { language: "typescript", autoStop: 60 },
    status: "pending",
  },
];

const MOCK_AGENTS: AgentOption[] = [
  {
    id: "agent-1",
    name: "Primary LLM",
    type: "llm",
    provider: "mistral",
    model: "mistral-large-latest",
    active: true,
    priority: 1,
    status: "online",
    executions: 1247,
    successRate: 98.5,
  },
  {
    id: "agent-2",
    name: "Fallback LLM",
    type: "llm",
    provider: "openrouter",
    model: "google/gemini-2.0-flash",
    active: true,
    priority: 2,
    status: "online",
    executions: 342,
    successRate: 97.2,
  },
  {
    id: "agent-3",
    name: "Code Agent",
    type: "sandbox",
    provider: "daytona",
    active: true,
    priority: 1,
    status: "busy",
    executions: 892,
    successRate: 99.1,
  },
  {
    id: "agent-4",
    name: "Tool Executor",
    type: "tool",
    provider: "composio",
    active: false,
    priority: 3,
    status: "offline",
    executions: 156,
    successRate: 94.8,
  },
  {
    id: "agent-5",
    name: "Orchestrator",
    type: "orchestrator",
    provider: "mastra",
    active: true,
    priority: 0,
    status: "online",
    executions: 2156,
    successRate: 99.8,
  },
];

const MOCK_MODES: OrchestrationMode[] = [
  {
    id: "mode-1",
    name: "V2 Agent (OpenCode)",
    description: "Containerized OpenCode CLI with full tool access",
    active: false,
    config: { containerized: true, maxSteps: 15 },
    providers: ["opencode", "daytona"],
    features: ["File Operations", "Bash Execution", "MCP Tools"],
  },
  {
    id: "mode-2",
    name: "Stateful Agent",
    description: "Plan-Act-Verify with persistent session state",
    active: true,
    config: { planType: "iterative", verification: true },
    providers: ["mistral", "sandbox"],
    features: ["Session Persistence", "Auto-Verification", "Rollback"],
  },
  {
    id: "mode-3",
    name: "Mastra Workflow",
    description: "Workflow-based orchestration with step management",
    active: false,
    config: { workflowId: "default", suspendResume: true },
    providers: ["mastra"],
    features: ["Workflow Steps", "Suspend/Resume", "Event Streaming"],
  },
  {
    id: "mode-4",
    name: "CrewAI Multi-Agent",
    description: "Role-based multi-agent collaboration",
    active: false,
    config: { process: "sequential", memory: true },
    providers: ["crewai"],
    features: ["Role Assignment", "Task Delegation", "Memory"],
  },
];

// Mock DAG Workflows
const MOCK_DAG_WORKFLOWS: DAGWorkflow[] = [
  {
    id: "dag-1",
    name: "Code Review Pipeline",
    createdAt: Date.now() - 3600000,
    nodes: [
      { id: "n1", label: "Start", type: "start", status: "completed", x: 50, y: 100 },
      { id: "n2", label: "Lint Code", type: "task", status: "completed", x: 150, y: 50 },
      { id: "n3", label: "Run Tests", type: "task", status: "completed", x: 150, y: 150 },
      { id: "n4", label: "All Passed?", type: "decision", status: "completed", x: 280, y: 100 },
      { id: "n5", label: "Build", type: "task", status: "pending", x: 400, y: 50 },
      { id: "n6", label: "Report Error", type: "task", status: "pending", x: 400, y: 150 },
      { id: "n7", label: "End", type: "end", status: "pending", x: 520, y: 100 },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n1", target: "n3" },
      { id: "e3", source: "n2", target: "n4" },
      { id: "e4", source: "n3", target: "n4" },
      { id: "e5", source: "n4", target: "n5", label: "Yes" },
      { id: "e6", source: "n4", target: "n6", label: "No" },
      { id: "e7", source: "n5", target: "n7" },
      { id: "e8", source: "n6", target: "n7" },
    ],
  },
  {
    id: "dag-2",
    name: "Research Agent",
    createdAt: Date.now() - 7200000,
    nodes: [
      { id: "r1", label: "Start", type: "start", status: "completed", x: 50, y: 80 },
      { id: "r2", label: "Search", type: "task", status: "completed", x: 150, y: 80 },
      { id: "r3", label: "Analyze", type: "task", status: "running", x: 280, y: 80 },
      { id: "r4", label: "Report", type: "task", status: "pending", x: 400, y: 80 },
      { id: "r5", label: "End", type: "end", status: "pending", x: 520, y: 80 },
    ],
    edges: [
      { id: "re1", source: "r1", target: "r2" },
      { id: "re2", source: "r2", target: "r3" },
      { id: "re3", source: "r3", target: "r4" },
      { id: "re4", source: "r4", target: "r5" },
    ],
  },
];

// Kernel data types (mirrored from agent-kernel.ts for client)
interface KernelAgent {
  id: string;
  config: {
    type: 'ephemeral' | 'persistent' | 'daemon' | 'worker';
    goal: string;
    userId: string;
    priority: 'critical' | 'high' | 'normal' | 'low';
  };
  status: 'pending' | 'ready' | 'running' | 'blocked' | 'suspended' | 'completed' | 'failed' | 'terminated';
  priority: 'critical' | 'high' | 'normal' | 'low';
  createdAt: number;
  iterations: number;
  quota: { computeMs: number; memoryBytes: number };
}

interface KernelStats {
  totalAgents: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  totalWorkItems: number;
  pendingWorkItems: number;
  computeUsedMs: number;
  memoryUsedBytes: number;
}

export default function OrchestrationTab() {
  const [events, setEvents] = useState<EventBusEvent[]>(MOCK_EVENTS);
  const [agents, setAgents] = useState<AgentOption[]>(MOCK_AGENTS);
  const [modes, setModes] = useState<OrchestrationMode[]>(MOCK_MODES);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventBusEvent | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showAgentDetails, setShowAgentDetails] = useState<Record<string, boolean>>({});

  // Real Kernel Data State
  const [kernelStats, setKernelStats] = useState<KernelStats | null>(null);
  const [kernelAgents, setKernelAgents] = useState<KernelAgent[]>([]);
  const [kernelLoading, setKernelLoading] = useState(false);
  const [kernelError, setKernelError] = useState<string | null>(null);

  // DAG Visualizer State - now uses real kernel data
  const [dagWorkflows, setDagWorkflows] = useState<DAGWorkflow[]>([]);
  const [selectedDag, setSelectedDag] = useState<DAGWorkflow | null>(null);
  const [dagZoom, setDagZoom] = useState(1);
  const [activeSubTab, setActiveSubTab] = useState<"agents" | "modes" | "events" | "dag">("dag");
  
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Fetch real kernel data
  const fetchKernelData = useCallback(async () => {
    setKernelLoading(true);
    try {
      const response = await fetch('/api/kernel/stats');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const stats = await response.json();
      setKernelStats(stats);
      
      // Also fetch agents
      const agentsRes = await fetch('/api/kernel/agents/list');
      if (agentsRes.ok) {
        const agents = await agentsRes.json();
        setKernelAgents(agents);
        
        // Convert kernel agents to DAG workflow
        if (agents.length > 0) {
          const workflow: DAGWorkflow = {
            id: 'kernel-agents',
            name: `Active Agents (${agents.length})`,
            createdAt: Date.now(),
            nodes: agents.map((agent: KernelAgent, index: number) => ({
              id: agent.id,
              label: agent.config.goal.substring(0, 20) + (agent.config.goal.length > 20 ? '...' : ''),
              type: agent.config.type === 'daemon' ? 'start' : 'task',
              status: agent.status as any,
              x: 50 + (index % 4) * 150,
              y: 50 + Math.floor(index / 4) * 80,
            })),
            edges: agents.filter((a: KernelAgent) => a.config.type === 'daemon' || a.config.type === 'persistent').map((agent: KernelAgent, index: number) => {
              if (index === 0) return null;
              return {
                id: `e-${agent.id}`,
                source: agents[index - 1].id,
                target: agent.id,
              };
            }).filter(Boolean) as DAGEdge[],
          };
          setDagWorkflows([workflow]);
          setSelectedDag(workflow);
        }
      }
      setKernelError(null);
    } catch (err: any) {
      setKernelError(err.message);
      // Fallback to mock data
      setDagWorkflows(MOCK_DAG_WORKFLOWS);
      setSelectedDag(MOCK_DAG_WORKFLOWS[0]);
    } finally {
      setKernelLoading(false);
    }
  }, []);

  // Poll kernel data every 5 seconds
  useEffect(() => {
    fetchKernelData();
    const interval = setInterval(fetchKernelData, 5000);
    return () => clearInterval(interval);
  }, [fetchKernelData]);

  // Auto-scroll to latest events
  useEffect(() => {
    if (autoScroll && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, autoScroll]);

  // Simulate live events (replace with real event bus connection)
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      const newEvent: EventBusEvent = {
        id: `evt-${Date.now()}`,
        type: ["AGENT_REQUEST", "TOOL_EXECUTION", "ORCHESTRATION_STEP", "PROVIDER_ROUTING", "SANDBOX_CREATE"][
          Math.floor(Math.random() * 5)
        ],
        timestamp: Date.now(),
        source: ["chat-panel", "agent-gateway", "orchestrator", "llm-router"][Math.floor(Math.random() * 4)],
        target: ["sandbox-provider", "daytona", "openrouter", "worker-1"][Math.floor(Math.random() * 4)],
        payload: { test: "data" },
        status: ["pending", "processing", "completed"][Math.floor(Math.random() * 3)] as any,
      };

      setEvents(prev => [...prev.slice(-99), newEvent]); // Keep last 100 events
    }, 2000);

    return () => clearInterval(interval);
  }, [isPaused]);

  const handleToggleAgent = (agentId: string) => {
    setAgents(prev => prev.map(a => 
      a.id === agentId ? { ...a, active: !a.active } : a
    ));
    toast.success("Agent toggled");
  };

  const handleActivateMode = (modeId: string) => {
    setModes(prev => prev.map(m => ({
      ...m,
      active: m.id === modeId,
    })));
    toast.success("Orchestration mode activated");
  };

  const handleClearEvents = () => {
    setEvents([]);
    toast.success("Events cleared");
  };

  const handleExportEvents = () => {
    const dataStr = JSON.stringify(events, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orchestration-events-${Date.now()}.json`;
    a.click();
    toast.success("Events exported");
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "text-green-400 bg-green-500/10 border-green-500/20";
      case "processing": return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "pending": return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
      case "failed": return "text-red-400 bg-red-500/10 border-red-500/20";
      default: return "text-gray-400 bg-gray-500/10 border-gray-500/20";
    }
  };

  const getAgentStatusColor = (status: string) => {
    switch (status) {
      case "online": return "text-green-400";
      case "offline": return "text-gray-400";
      case "busy": return "text-yellow-400";
      case "error": return "text-red-400";
      default: return "text-gray-400";
    }
  };

  const getEventTypeIcon = (type: string) => {
    switch (type) {
      case "AGENT_REQUEST": return <MessageSquare className="w-3 h-3" />;
      case "TOOL_EXECUTION": return <Code className="w-3 h-3" />;
      case "ORCHESTRATION_STEP": return <Workflow className="w-3 h-3" />;
      case "PROVIDER_ROUTING": return <GitBranch className="w-3 h-3" />;
      case "SANDBOX_CREATE": return <Box className="w-3 h-3" />;
      default: return <Activity className="w-3 h-3" />;
    }
  };

  // DAG Helper Functions
  const getDagNodeColor = (status: DAGNode['status']) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'running': return '#3b82f6';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getDagNodeShape = (type: DAGNode['type']) => {
    switch (type) {
      case 'start': return '●';
      case 'end': return '■';
      case 'decision': return '◇';
      default: return '○';
    }
  };

  const getDagNodeBorder = (type: DAGNode['type']) => {
    switch (type) {
      case 'start': return 'border-green-400';
      case 'end': return 'border-red-400';
      case 'decision': return 'border-yellow-400';
      default: return 'border-white/30';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-lg">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Orchestration Control</h3>
            <p className="text-xs text-white/60">Agent Kernel & DAG Workflows</p>
          </div>
        </div>

        {/* Sub-Tabs for detailed sections */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          <Button
            variant={activeSubTab === "agents" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("agents")}
            className={`text-xs ${activeSubTab === "agents" ? "bg-white/20 text-white" : "text-white/60"}`}
          >
            <Settings className="w-3 h-3 mr-1" />
            Agents
          </Button>
          <Button
            variant={activeSubTab === "modes" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("modes")}
            className={`text-xs ${activeSubTab === "modes" ? "bg-white/20 text-white" : "text-white/60"}`}
          >
            <Layers className="w-3 h-3 mr-1" />
            Modes
          </Button>
          <Button
            variant={activeSubTab === "events" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("events")}
            className={`text-xs ${activeSubTab === "events" ? "bg-white/20 text-white" : "text-white/60"}`}
          >
            <Activity className="w-3 h-3 mr-1" />
            Events
          </Button>
          <Button
            variant={activeSubTab === "dag" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("dag")}
            className={`text-xs ${activeSubTab === "dag" ? "bg-white/20 text-white" : "text-white/60"}`}
          >
            <Network className="w-3 h-3 mr-1" />
            DAG
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-4">
        {activeSubTab === "dag" ? (
          /* DAG Visualizer View */
          <div className="h-full flex flex-col">
            {/* DAG Controls */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Select
                  value={selectedDag?.id || ""}
                  onValueChange={(id) => setSelectedDag(dagWorkflows.find(d => d.id === id) || null)}
                >
                  <SelectTrigger className="w-[200px] bg-black/40 border-white/20 text-white">
                    <SelectValue placeholder="Select Workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    {dagWorkflows.map(dag => (
                      <SelectItem key={dag.id} value={dag.id}>{dag.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="text-white/60">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setDagZoom(z => Math.max(0.5, z - 0.1))} className="text-white/60">
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-xs text-white/40 w-12 text-center">{Math.round(dagZoom * 100)}%</span>
                <Button variant="ghost" size="icon" onClick={() => setDagZoom(z => Math.min(2, z + 0.1))} className="text-white/60">
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDagZoom(1)} className="text-white/60">
                  <Maximize className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* DAG Canvas */}
            <div className="flex-1 relative bg-black/20 rounded-lg border border-white/10 overflow-hidden">
              <div
                className="absolute inset-0"
                style={{ transform: `scale(${dagZoom})`, transformOrigin: 'top left' }}
              >
                {/* SVG for edges */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  {selectedDag?.edges.map(edge => {
                    const source = selectedDag.nodes.find(n => n.id === edge.source);
                    const target = selectedDag.nodes.find(n => n.id === edge.target);
                    if (!source || !target) return null;
                    return (
                      <g key={edge.id}>
                        <line
                          x1={(source.x || 0) + 30}
                          y1={(source.y || 0) + 20}
                          x2={(target.x || 0) + 30}
                          y2={(target.y || 0) + 20}
                          stroke="#6b7280"
                          strokeWidth="2"
                          strokeDasharray={edge.label ? "5,5" : "none"}
                        />
                        {edge.label && (
                          <text
                            x={((source.x || 0) + (target.x || 0)) / 2 + 30}
                            y={((source.y || 0) + (target.y || 0)) / 2 + 15}
                            fill="#9ca3af"
                            fontSize="10"
                          >
                            {edge.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Nodes */}
                {selectedDag?.nodes.map(node => (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`absolute flex items-center gap-2 px-3 py-2 rounded-lg border-2 bg-black/60 cursor-pointer transition-all hover:scale-105 ${
                      getDagNodeBorder(node.type)
                    }`}
                    style={{
                      left: node.x || 0,
                      top: node.y || 0,
                      borderColor: getDagNodeColor(node.status),
                    }}
                  >
                    <span style={{ color: getDagNodeColor(node.status) }} className="text-lg">
                      {getDagNodeShape(node.type)}
                    </span>
                    <span className="text-sm text-white">{node.label}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] border-white/20 ml-2"
                      style={{ color: getDagNodeColor(node.status) }}
                    >
                      {node.status}
                    </Badge>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* DAG Legend */}
            <div className="flex items-center gap-6 mt-4 text-xs text-white/60">
              <div className="flex items-center gap-2">
                <span className="text-green-400">●</span> Start
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white">○</span> Task
              </div>
              <div className="flex items-center gap-2">
                <span className="text-yellow-400">◇</span> Decision
              </div>
              <div className="flex items-center gap-2">
                <span className="text-red-400">■</span> End
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-0.5 bg-green-400"></span> Completed
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-0.5 bg-blue-400"></span> Running
              </div>
            </div>
          </div>
        ) : activeSubTab === "agents" ? (
          /* Agents View */
          <ScrollArea className="h-full">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Agent Options
              </h4>
              {agents.map((agent) => (
                <Card key={agent.id} className="bg-white/5 border-white/10">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${getAgentStatusColor(agent.status)}`} />
                        <div>
                          <p className="text-sm font-medium text-white">{agent.name}</p>
                          <p className="text-xs text-white/40">{agent.provider} {agent.model && `• ${agent.model}`}</p>
                        </div>
                      </div>
                      <Switch checked={agent.active} onCheckedChange={() => handleToggleAgent(agent.id)} className="scale-75" />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <Badge variant="outline" className="text-[10px] border-white/20">{agent.type}</Badge>
                      <span className="text-white/40">{agent.executions} exec • {agent.successRate}%</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        ) : activeSubTab === "modes" ? (
          /* Modes View */
          <ScrollArea className="h-full">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Orchestration Modes
              </h4>
              {modes.map((mode) => (
                <Card key={mode.id} className={`bg-white/5 border-white/10 cursor-pointer transition-all ${mode.active ? "border-purple-500/30 bg-purple-500/10" : "hover:bg-white/10"}`} onClick={() => handleActivateMode(mode.id)}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${mode.active ? "bg-purple-400" : "bg-gray-400"}`} />
                        <div>
                          <p className="text-sm font-medium text-white">{mode.name}</p>
                          <p className="text-xs text-white/40">{mode.description}</p>
                        </div>
                      </div>
                      {mode.active && <CheckCircle className="w-4 h-4 text-purple-400" />}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {mode.features.map((feature, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] border-white/20">{feature}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        ) : (
          /* Events View */
          <ScrollArea className="h-full">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Event Bus
                </h4>
                <div className="flex items-center gap-2">
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-[100px] h-6 text-xs bg-black/40 border-white/20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="AGENT_REQUEST">Requests</SelectItem>
                      <SelectItem value="TOOL_EXECUTION">Tools</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" onClick={() => setIsPaused(!isPaused)} className={isPaused ? "text-yellow-400" : "text-white/60"}>
                    {isPaused ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleClearEvents} className="text-white/60">
                    <Trash className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {events.filter(e => filterType === "all" || e.type === filterType).map((event) => (
                  <motion.div key={event.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className={`p-3 rounded-lg border cursor-pointer transition-all ${getStatusColor(event.status)} ${selectedEvent?.id === event.id ? "ring-2 ring-purple-500" : ""}`} onClick={() => setSelectedEvent(event)}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getEventTypeIcon(event.type)}
                        <span className="text-xs font-medium">{event.type}</span>
                      </div>
                      <span className="text-[10px]">{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-xs space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white/40">From:</span>
                        <span className="text-white/80">{event.source}</span>
                      </div>
                      {event.target && (
                        <div className="flex items-center gap-2">
                          <span className="text-white/40">To:</span>
                          <span className="text-white/80">{event.target}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
                <div ref={eventsEndRef} />
              </div>
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Event Details Panel */}
      <AnimatePresence>
        {selectedEvent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/10 bg-black/40"
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Event Details
                </h4>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedEvent(null)}
                  className="text-white/60 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-white/40">ID:</span>
                  <p className="text-white/80 font-mono text-xs">{selectedEvent.id}</p>
                </div>
                <div>
                  <span className="text-white/40">Type:</span>
                  <p className="text-white/80">{selectedEvent.type}</p>
                </div>
                <div>
                  <span className="text-white/40">Status:</span>
                  <Badge className={getStatusColor(selectedEvent.status)}>
                    {selectedEvent.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-white/40">Time:</span>
                  <p className="text-white/80">{new Date(selectedEvent.timestamp).toLocaleString()}</p>
                </div>
              </div>

              <div className="mt-3 p-3 bg-black/60 rounded-lg border border-white/10">
                <p className="text-xs text-white/40 mb-2">Payload:</p>
                <pre className="text-xs text-white/80 font-mono overflow-x-auto">
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
