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

// Fetch events from API
async function fetchEvents(limit = 50): Promise<EventBusEvent[]> {
  try {
    const response = await fetch(`/api/events?limit=${limit}`, { credentials: 'include' });

    if (!response.ok) {
      if (response.status === 401) return []; // Not authenticated — silent
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch events');
    }

    return (data.events || []).map((evt: any) => ({
      id: evt.id || `evt-${Date.now()}`,
      type: evt.type || 'UNKNOWN',
      timestamp: evt.created_at ? new Date(evt.created_at).getTime() : Date.now(),
      source: evt.user_id || 'system',
      target: evt.session_id || undefined,
      payload: typeof evt.payload === 'string' ? JSON.parse(evt.payload) : (evt.payload || {}),
      status: evt.status || 'pending',
      duration: evt.processed_at && evt.created_at ? new Date(evt.processed_at).getTime() - new Date(evt.created_at).getTime() : undefined,
    }));
  } catch (err: any) {
    console.error('[Orchestration] Failed to fetch events:', err);
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
  payload: Record<string, unknown>;
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
  const [events, setEvents] = useState<EventBusEvent[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [modes, setModes] = useState<OrchestrationModeOption[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventBusEvent | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showAgentDetails, setShowAgentDetails] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

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
        loadEvents(),
      ]);
      setLoading(false);
    };

    loadData();

    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadAgents, loadModes, loadWorkflows, loadEvents]);

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
          setDagWorkflows([]);
          setSelectedDag(null);
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
      
      // Fallback to empty for graceful degradation
      console.log('[OrchestrationTab] Falling back to empty state');
      setDagWorkflows([]);
      setSelectedDag(null);
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

  // Load initial events
  const loadEvents = useCallback(async () => {
    try {
      const evtList = await fetchEvents(50);
      // Client-side filter
      const filtered = filterType === "all" ? evtList : evtList.filter(e => e.type === filterType);
      setEvents(filtered);
      setEventsError(null);
    } catch (err: any) {
      console.error('[OrchestrationTab] Failed to load events:', err);
      setEventsError(err.message || 'Failed to load events');
    }
  }, [filterType]);

  // SSE event streaming connection
  useEffect(() => {
    if (isPaused) return;

    // Load initial batch when filter changes
    loadEvents();

    let eventSource: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        // Server-side filtering by types via query param
        const types = filterType === "all" ? '' : filterType;
        const url = `/api/events/stream${types ? `?types=${encodeURIComponent(types)}` : ''}`;
        // EventSource for same-origin requests automatically includes document cookies
        // No need for credentials: 'include' — browser handles this natively
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
          setEventsError(null);
        };

        eventSource.addEventListener('event', (e: MessageEvent) => {
          try {
            const wrapper = JSON.parse(e.data);
            // The SSE endpoint wraps events as { type: 'event', event: {...} }
            const raw = wrapper.event || wrapper;
            const evt: EventBusEvent = {
              id: raw.id || `evt-${Date.now()}`,
              type: raw.type || 'UNKNOWN',
              timestamp: raw.created_at ? new Date(raw.created_at).getTime() : Date.now(),
              source: raw.user_id || 'system',
              target: raw.session_id || undefined,
              payload: typeof raw.payload === 'string' ? JSON.parse(raw.payload) : (raw.payload || {}),
              status: raw.status || 'pending',
              duration: raw.processed_at && raw.created_at ? new Date(raw.processed_at).getTime() - new Date(raw.created_at).getTime() : undefined,
            };
            // Also apply client-side filter for safety
            if (filterType !== "all" && evt.type !== filterType) return;

            setEvents(prev => {
              const next = [...prev, evt];
              return next.length > 200 ? next.slice(-200) : next;
            });
          } catch (parseError) {
            console.warn('[OrchestrationTab] Failed to parse SSE event:', e.data, parseError);
          }
        });

        eventSource.onerror = () => {
          // Connection lost — will reconnect after delay
          eventSource?.close();
          eventSource = null;
          retryTimer = setTimeout(connect, 3000);
        };
      } catch (err: any) {
        console.error('[OrchestrationTab] SSE connection failed:', err);
        retryTimer = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      eventSource?.close();
    };
  }, [isPaused, filterType, loadEvents]);

  // Refresh events periodically
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(loadEvents, 10000);
    return () => clearInterval(interval);
  }, [isPaused, loadEvents]);

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
      case "ORCHESTRATION_PROGRESS": return <Activity className="w-3 h-3 text-purple-400" />;
      case "ORCHESTRATION_STEP": return <Workflow className="w-3 h-3" />;
      case "WORKFLOW": return <GitBranch className="w-3 h-3" />;
      case "HUMAN_APPROVAL": return <AlertCircle className="w-3 h-3 text-orange-400" />;
      case "SELF_HEALING": return <RefreshCw className="w-3 h-3 text-green-400" />;
      case "BACKGROUND_JOB": return <Clock className="w-3 h-3" />;
      case "AGENT_REQUEST": return <MessageSquare className="w-3 h-3" />;
      case "TOOL_EXECUTION": return <Code className="w-3 h-3" />;
      case "PROVIDER_ROUTING": return <Network className="w-3 h-3" />;
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
                      <SelectItem value="ORCHESTRATION_PROGRESS">Progress</SelectItem>
                      <SelectItem value="ORCHESTRATION_STEP">Steps</SelectItem>
                      <SelectItem value="WORKFLOW">Workflow</SelectItem>
                      <SelectItem value="HUMAN_APPROVAL">HITL</SelectItem>
                      <SelectItem value="SELF_HEALING">Self-Healing</SelectItem>
                      <SelectItem value="BACKGROUND_JOB">Background</SelectItem>
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

              {eventsError && (
                <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 text-xs mb-2">
                  <AlertCircle className="w-3 h-3 inline mr-1" />
                  {eventsError}
                </div>
              )}

              {events.length === 0 && !eventsError && (
                <div className="p-8 text-center text-white/30 text-sm">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No events yet. Events will appear when orchestration modes are active.</p>
                </div>
              )}

              <div className="space-y-2">
                {events.filter(e => filterType === "all" || e.type === filterType).map((event) => {
                  const isProgress = event.type === "ORCHESTRATION_PROGRESS";
                  const p = event.payload || {};

                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${getStatusColor(event.status)} ${selectedEvent?.id === event.id ? "ring-2 ring-purple-500" : ""}`}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getEventTypeIcon(event.type)}
                          <span className="text-xs font-medium">{event.type}</span>
                          {isProgress && (p as any).mode && (
                            <Badge className="text-[8px] bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              {(p as any).mode}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px]">{new Date(event.timestamp).toLocaleTimeString()}</span>
                      </div>

                      {/* Enhanced display for ORCHESTRATION_PROGRESS events */}
                      {isProgress ? (
                        <div className="text-xs space-y-1">
                          {/* Phase badge */}
                          {(p as any).phase && (
                            <Badge className={`text-[8px] mr-1 ${
                              (p as any).phase === 'planning' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                              (p as any).phase === 'acting' ? 'bg-green-500/20 text-green-300 border-green-500/30' :
                              (p as any).phase === 'verifying' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' :
                              (p as any).phase === 'responding' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
                              'bg-gray-500/20 text-gray-300 border-gray-500/30'
                            }`}>
                              {(p as any).phase}
                            </Badge>
                          )}

                          {/* Current action */}
                          {(p as any).currentAction && (
                            <p className="text-white/70 truncate">{(p as any).currentAction}</p>
                          )}

                          {/* Step progress */}
                          {(p as any).currentStepIndex !== undefined && (p as any).totalSteps !== undefined && (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-purple-500 rounded-full transition-all"
                                  style={{ width: `${(((p as any).currentStepIndex + 1) / (p as any).totalSteps) * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-white/40">
                                {(p as any).currentStepIndex + 1}/{(p as any).totalSteps}
                              </span>
                            </div>
                          )}

                          {/* Node info */}
                          {(p as any).nodeRole && (
                            <p className="text-white/40 text-[10px]">
                              Node: <span className="text-white/60">{(p as any).nodeRole}</span>
                              {(p as any).nodeModel && ` · ${(p as any).nodeModel}`}
                              {(p as any).nodeProvider && ` (${(p as any).nodeProvider})`}
                            </p>
                          )}

                          {/* Multi-agent topology */}
                          {Array.isArray((p as any).nodes) && (p as any).nodes.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1">
                              {(p as any).nodes.map((n: any, i: number) => (
                                <Badge key={i} variant="outline" className={`text-[8px] ${
                                  n.status === 'working' ? 'border-green-500/40 text-green-300' :
                                  n.status === 'waiting' ? 'border-yellow-500/40 text-yellow-300' :
                                  n.status === 'failed' ? 'border-red-500/40 text-red-300' :
                                  'border-white/20 text-white/40'
                                }`}>
                                  {n.role || n.id}: {n.status || 'unknown'}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {/* Steps list */}
                          {Array.isArray((p as any).steps) && (p as any).steps.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1">
                              {(p as any).steps.map((s: any, i: number) => (
                                <span key={s.id || i} className={`text-[8px] px-1 py-0.5 rounded ${
                                  s.status === 'running' ? 'bg-purple-500/20 text-purple-300' :
                                  s.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                                  s.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                                  'bg-white/5 text-white/30'
                                }`}>
                                  {s.title || s.id || `Step ${i + 1}`}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Errors */}
                          {Array.isArray((p as any).errors) && (p as any).errors.length > 0 && (
                            <p className="text-red-300 text-[10px] mt-1">
                              {(p as any).errors.map((e: any) => e.message).join('; ')}
                            </p>
                          )}

                          {/* HITL requests */}
                          {Array.isArray((p as any).hitlRequests) && (p as any).hitlRequests.length > 0 && (
                            <Badge className="text-[8px] bg-orange-500/20 text-orange-300 border-orange-500/30 mt-1">
                              {(p as any).hitlRequests.map((h: any) => h.action).join(', ')} — awaiting approval
                            </Badge>
                          )}
                        </div>
                      ) : (
                        /* Standard event display */
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
                      )}
                    </motion.div>
                  );
                })}
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
