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
  Bot,
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
import { useOrchestrationMode, type OrchestrationMode } from "@/contexts/orchestration-mode-context";
import OrchestrationVisualizer, { type AgentNode, type AgentEdge, type AgentLog } from "@/components/orchestration-visualizer";
import FrameworkVisualizer, {
  type WorkflowConfig,
  type WorkflowParameter,
  MOCK_MASTRA_WORKFLOW,
  MOCK_CREWAI_WORKFLOW
} from "@/components/framework-visualizer";

// Fetch agents from API
async function fetchAgents(): Promise<AgentOption[]> {
  try {
    const response = await fetch('/api/orchestration/agents');
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch agents');
    }
    
    return (data.agents || []).map((agent: any) => ({
      id: agent.id,
      name: agent.name,
      type: 'llm' as const,
      provider: agent.provider,
      model: agent.model,
      active: agent.active,
      priority: 1,
      status: agent.status === 'running' ? 'online' : agent.status === 'error' ? 'error' : 'busy',
      lastActive: agent.lastActive,
      executions: 0,
      successRate: 100,
    }));
  } catch (err: any) {
    console.error('[Orchestration] Failed to fetch agents:', err);
    return [];
  }
}

// Fetch workflows from API
async function fetchWorkflows(): Promise<WorkflowConfig[]> {
  try {
    const response = await fetch('/api/orchestration/workflows');
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch workflows');
    }
    
    return data.workflows || [];
  } catch (err: any) {
    console.error('[Orchestration] Failed to fetch workflows:', err);
    return [];
  }
}

// Execute workflow via API
async function executeWorkflow(workflowId: string, params?: Record<string, any>): Promise<{ executionId: string; status: string }> {
  try {
    const response = await fetch(`/api/orchestration/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to execute workflow');
    }
    
    return result;
  } catch (err: any) {
    console.error('[Orchestration] Failed to execute workflow:', err);
    throw err;
  }
}

// Fetch agent logs from API
async function fetchLogs(agentId?: string, limit = 50): Promise<AgentLog[]> {
  try {
    const params = new URLSearchParams();
    if (agentId) params.set('agentId', agentId);
    params.set('limit', limit.toString());
    
    const response = await fetch(`/api/orchestration/logs?${params}`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch logs');
    }
    
    return data.logs || [];
  } catch (err: any) {
    console.error('[Orchestration] Failed to fetch logs:', err);
    return [];
  }
}

// Control agent via API
async function controlAgent(agentId: string, action: 'start' | 'stop' | 'pause' | 'resume', task?: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/orchestration/agents/${agentId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || `Failed to ${action} agent`);
    }
    
    return true;
  } catch (err: any) {
    console.error('[Orchestration] Failed to control agent:', err);
    toast.error(err.message || `Failed to ${action} agent`);
    return false;
  }
}

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

interface OrchestrationModeOption {
  id: string;
  name: string;
  description: string;
  active: boolean;
  config: Record<string, any>;
  providers: string[];
  features: string[];
  orchestrationMode?: OrchestrationMode;
  executionType?: 'v1' | 'v2' | 'both';
  v1Capabilities?: string[];
  v2Capabilities?: string[];
  configOptions?: Record<string, {
    type: string;
    label: string;
    default: any;
    options?: string[];
    min?: number;
    max?: number;
    description?: string;
  }>;
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
    type: "ORCHESTRATION_PROGRESS",
    timestamp: Date.now() - 60000,
    source: "agent-team",
    target: "architect",
    payload: {
      mode: "agent-team",
      phase: "planning",
      nodeId: "architect-1",
      nodeRole: "architect",
      nodeModel: "claude-sonnet-4",
      nodeProvider: "claude-code",
      currentAction: "Creating execution plan",
      currentStepIndex: 0,
      totalSteps: 3,
      steps: [
        { id: "step-1", title: "Planning", status: "running" },
        { id: "step-2", title: "Development", status: "pending" },
        { id: "step-3", title: "Review", status: "pending" },
      ],
      nodes: [
        { id: "architect-1", role: "architect", model: "claude-sonnet-4", provider: "claude-code", status: "working" },
        { id: "developer-1", role: "developer", model: "claude-sonnet-4", provider: "claude-code", status: "waiting" },
        { id: "reviewer-1", role: "reviewer", model: "claude-sonnet-4", provider: "claude-code", status: "idle" },
      ],
    },
    status: "processing",
  },
  {
    id: "evt-2",
    type: "AGENT_REQUEST",
    timestamp: Date.now() - 120000,
    source: "chat-panel",
    target: "sandbox-provider",
    payload: { model: "claude-sonnet-4", provider: "openrouter" },
    status: "completed",
  },
  {
    id: "evt-3",
    type: "ORCHESTRATION_STEP",
    timestamp: Date.now() - 180000,
    source: "orchestrator",
    target: "worker-1",
    payload: { phase: "acting", iteration: 2 },
    status: "completed",
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

const MOCK_MODES: OrchestrationModeOption[] = [
  {
    id: "mode-task-router",
    name: "Task Router (Default)",
    description: "Routes tasks between OpenCode and Nullclaw based on task type",
    active: true,
    config: {},
    providers: ["opencode", "nullclaw", "cli"],
    features: ["Task Classification", "Auto-Routing", "Policy Selection"],
    orchestrationMode: "task-router",
    executionType: "both",
  },
  {
    id: "mode-unified",
    name: "Unified Agent Service",
    description: "Intelligent fallback chain: StatefulAgent → V2 → V1 API",
    active: true,
    config: { mode: "auto" },
    providers: ["openai", "anthropic", "mistral"],
    features: ["Fallback Chain", "Task Classifier", "Multi-Provider"],
    orchestrationMode: "unified-agent",
    executionType: "both",
  },
  {
    id: "mode-sa",
    name: "Stateful Agent",
    description: "Plan-Act-Verify with ToolExecutor and smartApply",
    active: false,
    config: { enforcePlanActVerify: true, maxSelfHealAttempts: 3 },
    providers: ["sandbox", "vfs"],
    features: ["Plan-Act-Verify", "ToolExecutor", "Smart Apply", "Diff Repair"],
    orchestrationMode: "stateful-agent",
    executionType: "both",
  },
  {
    id: "mode-kernel",
    name: "Agent Kernel",
    description: "OS-like priority scheduler with agent lifecycle management",
    active: true,
    config: { maxConcurrent: 8, timeSlice: 60000 },
    providers: ["internal"],
    features: ["Priority Scheduling", "Resource Quotas", "Self-Healing"],
    orchestrationMode: "agent-kernel",
    executionType: "both",
  },
  {
    id: "mode-loop",
    name: "Agent Loop",
    description: "ToolLoopAgent - iterative tool-loop execution",
    active: false,
    config: { maxIterations: 10 },
    providers: ["openrouter", "chutes", "github", "nvidia"],
    features: ["ToolLoopAgent", "Filesystem Tools", "Multi-Provider"],
    orchestrationMode: "agent-loop",
    executionType: "both",
  },
  {
    id: "mode-dag",
    name: "Execution Graph",
    description: "DAG dependency engine for parallel task execution",
    active: true,
    config: { maxRetries: 3 },
    providers: ["internal"],
    features: ["DAG Dependencies", "Parallel Execution", "Auto-Retry"],
    orchestrationMode: "execution-graph",
    executionType: "both",
  },
  {
    id: "mode-nullclaw",
    name: "Nullclaw",
    description: "External server for messaging, browsing, automation",
    active: false,
    config: {},
    providers: ["nullclaw"],
    features: ["Discord/Telegram", "Web Browsing", "API Calls"],
    orchestrationMode: "nullclaw",
    executionType: "v2",
  },
  {
    id: "mode-opencode-sdk",
    name: "OpenCode SDK",
    description: "Direct SDK connection to local OpenCode server (remote CLI agent)",
    active: false,
    config: { hostname: "127.0.0.1", port: 4096 },
    providers: ["openai", "anthropic", "google"],
    features: ["SDK Integration", "Session Management", "Git Ops"],
    orchestrationMode: "opencode-sdk",
    executionType: "v2",
  },
  {
    id: "mode-mastra",
    name: "Mastra Workflow",
    description: "Workflow engine with planner/executor/critic pattern",
    active: false,
    config: { workflowId: "code-agent", selfHealing: true },
    providers: ["mastra"],
    features: ["Workflow Steps", "Self-Healing", "Code Quality Evals"],
    orchestrationMode: "mastra-workflow",
    executionType: "both",
  },
  {
    id: "mode-crewai",
    name: "CrewAI Multi-Agent",
    description: "Role-based multi-agent collaboration",
    active: false,
    config: { process: "sequential", memory: true },
    providers: ["crewai"],
    features: ["Role Assignment", "Task Delegation", "Memory"],
    orchestrationMode: "crewai",
    executionType: "both",
  },
  {
    id: "mode-v2",
    name: "V2 Containerized",
    description: "OpenCode containerized execution with sandbox isolation",
    active: false,
    config: { containerized: true, maxSteps: 15 },
    providers: ["opencode", "daytona"],
    features: ["Sandbox Isolation", "File Operations", "Bash Execution"],
    orchestrationMode: "v2-executor",
    executionType: "v2",
  },
  {
    id: "mode-team",
    name: "Agent Team",
    description: "Multi-agent team orchestration with 5 collaboration strategies",
    active: true,
    config: { strategy: "hierarchical", maxIterations: 3 },
    providers: ["claude-code", "amp", "codex", "opencode"],
    features: ["Hierarchical", "Collaborative", "Consensus", "Relay", "Competitive"],
    orchestrationMode: "agent-team",
    executionType: "v2",
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
  name?: string;
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
  const { setMode: setOrchestrationMode } = useOrchestrationMode();
  const [events, setEvents] = useState<EventBusEvent[]>(MOCK_EVENTS);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [modes, setModes] = useState<OrchestrationModeOption[]>(MOCK_MODES);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventBusEvent | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showAgentDetails, setShowAgentDetails] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Real Kernel Data State
  const [kernelStats, setKernelStats] = useState<KernelStats | null>(null);
  const [kernelAgents, setKernelAgents] = useState<KernelAgent[]>([]);
  const [kernelLoading, setKernelLoading] = useState(false);
  const [kernelError, setKernelError] = useState<string | null>(null);

  // DAG Visualizer State - now uses real kernel data
  const [dagWorkflows, setDagWorkflows] = useState<DAGWorkflow[]>([]);
  const [selectedDag, setSelectedDag] = useState<DAGWorkflow | null>(null);
  const [dagZoom, setDagZoom] = useState(1);
  const [activeSubTab, setActiveSubTab] = useState<"agents" | "modes" | "events" | "dag" | "mastra" | "crewai">("dag");

  // Enhanced orchestration visualizer state
  const [visAgents, setVisAgents] = useState<AgentNode[]>([]);
  const [visEdges, setVisEdges] = useState<AgentEdge[]>([]);

  // Framework workflows state
  const [mastraWorkflows, setMastraWorkflows] = useState<WorkflowConfig[]>([]);
  const [crewaiWorkflows, setCrewaiWorkflows] = useState<WorkflowConfig[]>([]);

  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Fetch agents from API
  const loadAgents = useCallback(async () => {
    try {
      const data = await fetchAgents();
      setAgents(data);
    } catch (err: any) {
      console.error('[OrchestrationTab] Failed to fetch agents:', err);
    }
  }, []);

  // Fetch orchestration modes from API
  const loadModes = useCallback(async () => {
    try {
      const response = await fetch('/api/chat/modes');
      const data = await response.json();
      if (data.success && data.modes) {
        // Transform API data to OrchestrationModeOption format
        const mappedModes = data.modes.map((m: any) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          active: m.active,
          config: {},
          providers: m.providers || [],
          features: m.features || [],
          orchestrationMode: m.id as OrchestrationMode,
          executionType: m.executionType || 'v2',
          v1Capabilities: m.v1Capabilities,
          v2Capabilities: m.v2Capabilities,
          configOptions: m.configOptions,
        }));
        setModes(mappedModes);
      }
    } catch (err: any) {
      console.error('[OrchestrationTab] Failed to fetch modes:', err);
      // Fallback to mock data if API fails
      setModes(MOCK_MODES);
    }
  }, []);

  // Fetch workflows from API
  const loadWorkflows = useCallback(async () => {
    try {
      const workflows = await fetchWorkflows();
      setMastraWorkflows(workflows);
      setCrewaiWorkflows(workflows);
    } catch (err: any) {
      console.error('[OrchestrationTab] Failed to fetch workflows:', err);
    }
  }, []);  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        loadAgents(),
        loadModes(),
        loadWorkflows(),
      ]);
      setLoading(false);
    };

    loadData();

    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadAgents, loadModes, loadWorkflows]);

  // Fetch real kernel data
  const fetchKernelData = useCallback(async () => {
    setKernelLoading(true);
    try {
      // Fetch kernel stats
      const response = await fetch('/api/kernel/stats', {
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      
      if (!response.ok) {
        // Differentiate between client and server errors
        if (response.status >= 500) {
          console.error('[OrchestrationTab] Kernel server error:', response.status);
          throw new Error(`Kernel server error: HTTP ${response.status}`);
        } else if (response.status === 404) {
          // Kernel API not available - use mock data silently
          console.log('[OrchestrationTab] Kernel API not available, using mock data');
          setDagWorkflows(MOCK_DAG_WORKFLOWS);
          setSelectedDag(MOCK_DAG_WORKFLOWS[0]);
          setKernelLoading(false);
          return;
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      }
      
      const stats = await response.json();
      setKernelStats(stats);

      // Also fetch agents
      const agentsRes = await fetch('/api/kernel/agents/list', {
        signal: AbortSignal.timeout(5000),
      });
      
      if (agentsRes.ok) {
        const agents = await agentsRes.json();
        setKernelAgents(agents);
        
        // Convert to visualizer format (immediate)
        convertKernelAgentsToVisualizer(agents);

        // Convert to DAG workflow (debounced to prevent rapid updates)
        debouncedConvertToDag(agents);
      }
      
      setKernelError(null);
    } catch (err: any) {
      // Log error for debugging
      console.error('[OrchestrationTab] Failed to fetch kernel data:', err.message);
      
      // Set error state
      setKernelError(err.message);
      
      // Show user-friendly error message via toast
      toast.error('Failed to load kernel data', {
        description: err.message || 'Please check if the kernel API is running',
        duration: 5000,
      });
      
      // Fallback to mock data for graceful degradation
      console.log('[OrchestrationTab] Falling back to mock data');
      setDagWorkflows(MOCK_DAG_WORKFLOWS);
      setSelectedDag(MOCK_DAG_WORKFLOWS[0]);
    } finally {
      setKernelLoading(false);
    }
  }, []);

  // Convert kernel agents to visualizer format
  const convertKernelAgentsToVisualizer = useCallback((agents: KernelAgent[]) => {
    // Validate agents data - filter out invalid entries
    const validAgents = agents.filter(agent => {
      if (!agent || !agent.id) {
        console.warn('[OrchestrationTab] Invalid agent detected, skipping:', agent);
        return false;
      }
      if (!agent.config || !agent.config.type) {
        console.warn('[OrchestrationTab] Agent missing config, skipping:', agent.id);
        return false;
      }
      return true;
    });

    // Deduplicate agents by ID
    const uniqueAgents = Array.from(
      new Map(validAgents.map(agent => [agent.id, agent])).values()
    );

    const visAgents: AgentNode[] = uniqueAgents.map((agent, index) => ({
      id: agent.id,
      name: agent.name || agent.config.goal?.substring(0, 20) || `Agent ${index + 1}`,
      type: agent.config.type === 'daemon' ? 'manager' : 
            agent.config.type === 'persistent' ? 'executor' : 'tool',
      status: agent.status === 'running' ? 'executing' :
              agent.status === 'terminated' ? 'idle' :
              agent.status === 'failed' ? 'failed' :
              agent.status === 'ready' ? 'completed' : 'thinking',
      // Stable positioning based on agent ID hash for consistent layout
      x: 50 + (agent.id.charCodeAt(0) % 4) * 200,
      y: 50 + (agent.id.charCodeAt(1) % 3) * 150,
      goal: agent.config.goal,
      currentTask: agent.status === 'running' ? 'Executing...' : undefined,
      logs: [{
        id: `log-${agent.id}-${Date.now()}`,
        timestamp: Date.now(),
        type: 'info' as const,
        message: `Agent ${agent.status}`,
      }],
    }));

    // Create edges only between valid agents
    const visEdges: AgentEdge[] = uniqueAgents
      .filter((a, i) => i > 0 && uniqueAgents[i - 1])
      .map((agent, index) => ({
        id: `edge-${agent.id}`,
        source: uniqueAgents[index - 1]?.id || '',
        target: agent.id,
        type: 'flow' as const,
        status: agent.status === 'running' ? 'active' as const : 'completed' as const,
      }))
      .filter(edge => edge.source && edge.target); // Filter invalid edges

    setVisAgents(visAgents);
    setVisEdges(visEdges);
  }, []);

  // Debounced DAG workflow conversion to prevent rapid updates
  const convertToDagWorkflow = useCallback((agents: KernelAgent[]) => {
    // Validate agents data
    const validAgents = agents.filter(agent => 
      agent && agent.id && agent.config && agent.config.type
    );

    if (validAgents.length === 0) {
      console.log('[OrchestrationTab] No valid agents for DAG conversion');
      return;
    }

    const workflow: DAGWorkflow = {
      id: 'kernel-agents',
      name: `Active Agents (${validAgents.length})`,
      createdAt: Date.now(),
      nodes: validAgents.map((agent, index) => ({
        id: agent.id,
        label: agent.config.goal?.substring(0, 20) + (agent.config.goal?.length > 20 ? '...' : '') || `Agent ${index + 1}`,
        type: agent.config.type === 'daemon' ? 'start' : 'task',
        status: agent.status as any,
        // Stable positioning
        x: 50 + (index % 4) * 150,
        y: 50 + Math.floor(index / 4) * 80,
      })),
      edges: validAgents
        .filter((_, index) => index > 0)
        .map((agent, index) => ({
          id: `e-${agent.id}`,
          source: validAgents[index - 1].id,
          target: agent.id,
        })),
    };
    
    setDagWorkflows([workflow]);
    setSelectedDag(workflow);
  }, []);

  // Debounce helper
  const debounce = <T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  };

  // Debounced version of DAG conversion (300ms delay)
  const debouncedConvertToDag = useCallback(
    debounce((agents: KernelAgent[]) => convertToDagWorkflow(agents), 300),
    [convertToDagWorkflow]
  );

  // HITL Handlers
  const handleAgentNudge = useCallback((agentId: string, instruction: string) => {
    console.log(`[HITL] Nudging agent ${agentId}:`, instruction);
    toast.success('Instruction sent to agent', {
      description: `Agent ${agentId} has been nudged`,
    });
    // TODO: Send to API endpoint
  }, []);

  const handleAgentApprove = useCallback((agentId: string) => {
    console.log(`[HITL] Approved agent ${agentId}`);
    toast.success('Agent approved', {
      description: `Agent ${agentId} can continue`,
    });
    // TODO: Send approval to API endpoint
    setVisAgents(prev => prev.map(a => 
      a.id === agentId ? { ...a, hitlApproved: true, status: 'executing' as const } : a
    ));
  }, []);

  const handleAgentReject = useCallback((agentId: string, reason: string) => {
    console.log(`[HITL] Rejected agent ${agentId}:`, reason);
    toast.error('Agent rejected', {
      description: reason,
    });
    // TODO: Send rejection to API endpoint
    setVisAgents(prev => prev.map(a => 
      a.id === agentId ? { ...a, status: 'failed' as const } : a
    ));
  }, []);

  // Framework workflow handlers
  const handleToggleWorkflow = useCallback((workflowId: string, enabled: boolean) => {
    console.log(`[Framework] Toggling workflow ${workflowId}:`, enabled);
    // Update state
    setMastraWorkflows(prev => prev.map(w => 
      w.id === workflowId ? { ...w, enabled } : w
    ));
    setCrewaiWorkflows(prev => prev.map(w => 
      w.id === workflowId ? { ...w, enabled } : w
    ));
  }, []);

  const handleUpdateParameter = useCallback((workflowId: string, parameterId: string, value: any) => {
    console.log(`[Framework] Updating parameter ${parameterId} in ${workflowId}:`, value);
    // Update state
    setMastraWorkflows(prev => prev.map(w => 
      w.id === workflowId ? {
        ...w,
        parameters: w.parameters.map(p => 
          p.id === parameterId ? { ...p, value } : p
        )
      } : w
    ));
    setCrewaiWorkflows(prev => prev.map(w => 
      w.id === workflowId ? {
        ...w,
        parameters: w.parameters.map(p => 
          p.id === parameterId ? { ...p, value } : p
        )
      } : w
    ));
  }, []);

  const handleRunWorkflow = useCallback((workflowId: string) => {
    console.log(`[Framework] Running workflow ${workflowId}`);
    toast.success('Workflow execution started', {
      description: 'Monitor logs for progress',
    });
    // TODO: Call API to start workflow
  }, []);

  const handleStopWorkflow = useCallback((workflowId: string) => {
    console.log(`[Framework] Stopping workflow ${workflowId}`);
    toast.info('Workflow execution stopped', {
      description: 'Workflow has been halted',
    });
    // TODO: Call API to stop workflow
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
      const eventTypes = ["AGENT_REQUEST", "TOOL_EXECUTION", "ORCHESTRATION_STEP", "ORCHESTRATION_PROGRESS", "PROVIDER_ROUTING", "SANDBOX_CREATE"];
      const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];

      let payload: Record<string, unknown> = { test: "data" };

      if (type === "ORCHESTRATION_PROGRESS") {
        const phases = ["planning", "acting", "verifying", "responding"] as const;
        const roles = ["architect", "developer", "reviewer", "researcher", "tester"] as const;
        const providers = ["opencode", "claude-code", "amp", "codex"] as const;
        const statuses = ["idle", "working", "waiting", "failed"] as const;
        const phase = phases[Math.floor(Math.random() * phases.length)];
        const role = roles[Math.floor(Math.random() * roles.length)];
        payload = {
          mode: "agent-team",
          phase,
          nodeId: `${role}-${Math.floor(Math.random() * 3)}`,
          nodeRole: role,
          nodeModel: "claude-sonnet-4",
          nodeProvider: providers[Math.floor(Math.random() * providers.length)],
          currentAction: phase === "planning" ? "Creating execution plan" : phase === "acting" ? "Implementing changes" : phase === "verifying" ? "Running tests" : "Finalizing response",
          currentStepIndex: Math.floor(Math.random() * 5),
          totalSteps: 5,
          nodes: [
            { id: "architect-0", role: "architect", provider: "opencode", status: statuses[Math.floor(Math.random() * statuses.length)] },
            { id: "developer-0", role: "developer", provider: "claude-code", status: statuses[Math.floor(Math.random() * statuses.length)] },
            { id: "reviewer-0", role: "reviewer", provider: "amp", status: statuses[Math.floor(Math.random() * statuses.length)] },
          ],
          steps: [
            { id: "s1", title: "Analyze", status: "completed" },
            { id: "s2", title: "Plan", status: phase === "planning" ? "running" : "completed" },
            { id: "s3", title: "Implement", status: phase === "acting" ? "running" : "pending" },
            { id: "s4", title: "Verify", status: phase === "verifying" ? "running" : "pending" },
            { id: "s5", title: "Respond", status: phase === "responding" ? "running" : "pending" },
          ],
        };
      }

      const newEvent: EventBusEvent = {
        id: `evt-${Date.now()}`,
        type,
        timestamp: Date.now(),
        source: ["chat-panel", "agent-gateway", "orchestrator", "llm-router"][Math.floor(Math.random() * 4)],
        target: ["sandbox-provider", "daytona", "openrouter", "worker-1"][Math.floor(Math.random() * 4)],
        payload,
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
    
    // Map to actual orchestration mode and persist via context
    const mode = modes.find(m => m.id === modeId);
    if (mode?.orchestrationMode) {
      setOrchestrationMode(mode.orchestrationMode);
      toast.success(`Orchestration mode activated`, {
        description: `Now using ${mode.name}`,
      });
    } else {
      toast.success("Orchestration mode activated");
    }
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
          <Button
            variant={activeSubTab === "mastra" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("mastra")}
            className={`text-xs ${activeSubTab === "mastra" ? "bg-purple-500/20 text-purple-300" : "text-white/60"}`}
          >
            <Layers className="w-3 h-3 mr-1" />
            Mastra
          </Button>
          <Button
            variant={activeSubTab === "crewai" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveSubTab("crewai")}
            className={`text-xs ${activeSubTab === "crewai" ? "bg-cyan-500/20 text-cyan-300" : "text-white/60"}`}
          >
            <Bot className="w-3 h-3 mr-1" />
            CrewAI
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-4">
        {activeSubTab === "dag" ? (
          /* Enhanced Orchestration Visualizer */
          <OrchestrationVisualizer
            agents={visAgents}
            edges={visEdges}
            onAgentNudge={handleAgentNudge}
            onAgentApprove={handleAgentApprove}
            onAgentReject={handleAgentReject}
            onRefresh={fetchKernelData}
          />
        ) : activeSubTab === "mastra" ? (
          /* Mastra Workflow Visualizer */
          <FrameworkVisualizer
            framework="mastra"
            workflows={mastraWorkflows}
            onToggleWorkflow={handleToggleWorkflow}
            onUpdateParameter={handleUpdateParameter}
            onRunWorkflow={handleRunWorkflow}
            onStopWorkflow={handleStopWorkflow}
            onRefresh={fetchKernelData}
          />
        ) : activeSubTab === "crewai" ? (
          /* CrewAI Workflow Visualizer */
          <FrameworkVisualizer
            framework="crewai"
            workflows={crewaiWorkflows}
            onToggleWorkflow={handleToggleWorkflow}
            onUpdateParameter={handleUpdateParameter}
            onRunWorkflow={handleRunWorkflow}
            onStopWorkflow={handleStopWorkflow}
            onRefresh={fetchKernelData}
          />
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
                      <div className="flex items-center gap-1">
                        {mode.executionType && (
                          <Badge variant="outline" className={`text-[8px] ${
                            mode.executionType === 'v2' ? 'border-blue-500/40 text-blue-300'
                            : mode.executionType === 'v1' ? 'border-cyan-500/40 text-cyan-300'
                            : 'border-purple-500/40 text-purple-300'
                          }`}>
                            {mode.executionType === 'v1' ? 'V1 API' : mode.executionType === 'v2' ? 'V2 Agent' : 'V1+V2'}
                          </Badge>
                        )}
                        {mode.active && <CheckCircle className="w-4 h-4 text-purple-400" />}
                      </div>
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
