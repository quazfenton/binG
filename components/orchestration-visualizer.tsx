"use client";

import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  MessageSquare,
  CheckCircle,
  XCircle,
  AlertCircle,
  Activity,
  Terminal,
  Cpu,
  GitBranch,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  Eye,
  Settings,
  MessageCircle,
  Send,
  Clock,
  CheckCircle2,
  XOctagon,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface AgentNode {
  id: string;
  name: string;
  type: 'planner' | 'executor' | 'critic' | 'manager' | 'tool';
  status: 'idle' | 'thinking' | 'executing' | 'waiting_approval' | 'completed' | 'failed';
  x: number;
  y: number;
  goal?: string;
  currentTask?: string;
  logs?: AgentLog[];
  hitlRequired?: boolean;
  hitlApproved?: boolean;
}

export interface AgentLog {
  id: string;
  timestamp: number;
  type: 'info' | 'action' | 'decision' | 'error' | 'approval';
  message: string;
  data?: any;
}

export interface AgentEdge {
  id: string;
  source: string;
  target: string;
  type: 'flow' | 'approval' | 'data';
  status: 'active' | 'completed' | 'blocked';
}

export interface OrchestrationVisualizerProps {
  agents: AgentNode[];
  edges: AgentEdge[];
  onAgentNudge?: (agentId: string, instruction: string) => void;
  onAgentApprove?: (agentId: string) => void;
  onAgentReject?: (agentId: string, reason: string) => void;
  onRefresh?: () => void;
}

// ============================================================================
// Mock Data for Development
// ============================================================================

const MOCK_AGENTS: AgentNode[] = [
  {
    id: 'agent-1',
    name: 'Planner Agent',
    type: 'planner',
    status: 'completed',
    x: 50,
    y: 50,
    goal: 'Break down task into steps',
    currentTask: 'Planning complete',
    logs: [
      { id: 'log-1', timestamp: Date.now() - 60000, type: 'info', message: 'Received task: Build todo app' },
      { id: 'log-2', timestamp: Date.now() - 55000, type: 'decision', message: 'Created 5-step plan' },
      { id: 'log-3', timestamp: Date.now() - 50000, type: 'action', message: 'Sent plan to executor' },
    ],
  },
  {
    id: 'agent-2',
    name: 'Executor Agent',
    type: 'executor',
    status: 'waiting_approval',
    x: 300,
    y: 50,
    goal: 'Execute planned steps',
    currentTask: 'Creating React components',
    hitlRequired: true,
    logs: [
      { id: 'log-4', timestamp: Date.now() - 45000, type: 'info', message: 'Received plan from planner' },
      { id: 'log-5', timestamp: Date.now() - 40000, type: 'action', message: 'Created package.json' },
      { id: 'log-6', timestamp: Date.now() - 35000, type: 'action', message: 'Created App.tsx' },
      { id: 'log-7', timestamp: Date.now() - 30000, type: 'approval', message: 'Waiting for approval to continue' },
    ],
  },
  {
    id: 'agent-3',
    name: 'Critic Agent',
    type: 'critic',
    status: 'thinking',
    x: 550,
    y: 50,
    goal: 'Review code quality',
    currentTask: 'Analyzing code structure',
    logs: [
      { id: 'log-8', timestamp: Date.now() - 25000, type: 'info', message: 'Received code for review' },
      { id: 'log-9', timestamp: Date.now() - 20000, type: 'decision', message: 'Found 2 potential issues' },
    ],
  },
  {
    id: 'agent-4',
    name: 'Manager Agent',
    type: 'manager',
    status: 'idle',
    x: 300,
    y: 200,
    goal: 'Coordinate agents',
    currentTask: 'Monitoring progress',
    logs: [
      { id: 'log-10', timestamp: Date.now() - 15000, type: 'info', message: 'Overall progress: 60%' },
    ],
  },
];

const MOCK_EDGES: AgentEdge[] = [
  { id: 'edge-1', source: 'agent-1', target: 'agent-2', type: 'flow', status: 'completed' },
  { id: 'edge-2', source: 'agent-2', target: 'agent-3', type: 'approval', status: 'active' },
  { id: 'edge-3', source: 'agent-3', target: 'agent-4', type: 'data', status: 'blocked' },
  { id: 'edge-4', source: 'agent-4', target: 'agent-2', type: 'flow', status: 'active' },
];

// ============================================================================
// Component
// ============================================================================

export default function OrchestrationVisualizer({
  agents,
  edges,
  onAgentNudge,
  onAgentApprove,
  onAgentReject,
  onRefresh,
}: OrchestrationVisualizerProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);
  const [showLogs, setShowLogs] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [nudgeInput, setNudgeInput] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  const getAgentColor = useCallback((status: AgentNode['status']) => {
    switch (status) {
      case 'idle': return '#6b7280'; // gray
      case 'thinking': return '#a855f7'; // purple
      case 'executing': return '#3b82f6'; // blue
      case 'waiting_approval': return '#f59e0b'; // yellow
      case 'completed': return '#22c55e'; // green
      case 'failed': return '#ef4444'; // red
      default: return '#6b7280';
    }
  }, []);

  const getAgentIcon = useCallback((type: AgentNode['type']) => {
    switch (type) {
      case 'planner': return '📋';
      case 'executor': return '⚡';
      case 'critic': return '🔍';
      case 'manager': return '🎯';
      case 'tool': return '🔧';
      default: return '🤖';
    }
  }, []);

  const getEdgeColor = useCallback((status: AgentEdge['status']) => {
    switch (status) {
      case 'active': return '#3b82f6';
      case 'completed': return '#22c55e';
      case 'blocked': return '#ef4444';
      default: return '#6b7280';
    }
  }, []);

  const handleNudge = () => {
    if (selectedAgent && nudgeInput.trim() && onAgentNudge) {
      onAgentNudge(selectedAgent.id, nudgeInput.trim());
      setNudgeInput('');
    }
  };

  const handleApprove = () => {
    if (selectedAgent && onAgentApprove) {
      onAgentApprove(selectedAgent.id);
    }
  };

  const handleReject = () => {
    if (selectedAgent && rejectReason.trim() && onAgentReject) {
      onAgentReject(selectedAgent.id, rejectReason.trim());
      setRejectReason('');
      setShowRejectDialog(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header Controls */}
      <div className="flex items-center justify-between mb-4 p-3 bg-black/40 rounded-lg border border-white/10">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-400" />
            Live Orchestration View
          </h3>
          <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-300">
            {agents.filter(a => a.status === 'executing').length} active
          </Badge>
          {agents.some(a => a.hitlRequired && !a.hitlApproved) && (
            <Badge variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-300 animate-pulse">
              <AlertCircle className="w-2 h-2 mr-1" />
              Approval Required
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowLogs(!showLogs)} className="text-white/60">
            <Terminal className="w-4 h-4 mr-1" />
            Logs
          </Button>
          <Button variant="ghost" size="sm" onClick={onRefresh} className="text-white/60">
            <RotateCcw className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-1 border-l border-white/10 pl-2">
            <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="text-white/60">
              <ZoomOut className="w-3 h-3" />
            </Button>
            <span className="text-xs text-white/40 w-10 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" onClick={() => setZoom(z => Math.min(2, z + 0.1))} className="text-white/60">
              <ZoomIn className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setZoom(1)} className="text-white/60">
              <Maximize className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* DAG Canvas */}
        <div className="flex-1 relative bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {/* SVG for edges */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {edges.map(edge => {
                const source = agents.find(a => a.id === edge.source);
                const target = agents.find(a => a.id === edge.target);
                if (!source || !target) return null;
                return (
                  <g key={edge.id}>
                    <line
                      x1={(source.x || 0) + 40}
                      y1={(source.y || 0) + 30}
                      x2={(target.x || 0) + 40}
                      y2={(target.y || 0) + 30}
                      stroke={getEdgeColor(edge.status)}
                      strokeWidth="2"
                      strokeDasharray={edge.type === 'approval' ? "5,5" : "none"}
                      className="transition-all duration-300"
                    />
                    {edge.type === 'approval' && (
                      <circle
                        cx={((source.x || 0) + (target.x || 0)) / 2 + 40}
                        cy={((source.y || 0) + (target.y || 0)) / 2 + 25}
                        r="8"
                        fill="#1e293b"
                        stroke="#f59e0b"
                        strokeWidth="2"
                      />
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Agent Nodes */}
            {agents.map(agent => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`absolute flex flex-col items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all hover:scale-105 ${
                  selectedAgent?.id === agent.id ? 'ring-2 ring-purple-500' : ''
                }`}
                style={{
                  left: agent.x || 0,
                  top: agent.y || 0,
                  borderColor: getAgentColor(agent.status),
                  background: 'rgba(0, 0, 0, 0.6)',
                }}
                onClick={() => setSelectedAgent(agent)}
              >
                {/* Status Indicator */}
                <div
                  className="w-3 h-3 rounded-full animate-pulse"
                  style={{ backgroundColor: getAgentColor(agent.status) }}
                />

                {/* Agent Icon & Name */}
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{getAgentIcon(agent.type)}</span>
                  <div>
                    <p className="text-sm font-medium text-white whitespace-nowrap">{agent.name}</p>
                    <p className="text-[10px] text-white/40">{agent.type}</p>
                  </div>
                </div>

                {/* Current Task */}
                {agent.currentTask && (
                  <p className="text-[10px] text-white/60 max-w-[150px] text-center truncate">
                    {agent.currentTask}
                  </p>
                )}

                {/* HITL Badge */}
                {agent.hitlRequired && !agent.hitlApproved && (
                  <Badge variant="outline" className="text-[8px] border-yellow-500/30 text-yellow-300 animate-pulse">
                    <AlertCircle className="w-2 h-2 mr-1" />
                    Approval Needed
                  </Badge>
                )}

                {/* Logs Count */}
                {showLogs && agent.logs && agent.logs.length > 0 && (
                  <Badge variant="outline" className="text-[8px] border-white/20">
                    <Terminal className="w-2 h-2 mr-1" />
                    {agent.logs.length}
                  </Badge>
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Side Panel - Agent Details & Controls */}
        {selectedAgent && (
          <div className="w-80 flex flex-col gap-3 overflow-hidden">
            {/* Agent Info Card */}
            <Card className="bg-black/40 border-white/10">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span className="text-xl">{getAgentIcon(selectedAgent.type)}</span>
                    {selectedAgent.name}
                  </h4>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedAgent(null)}
                    className="h-6 w-6 text-white/60"
                  >
                    <XCircle className="w-3 h-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Status */}
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getAgentColor(selectedAgent.status) }}
                  />
                  <span className="text-xs text-white/60 capitalize">{selectedAgent.status.replace('_', ' ')}</span>
                </div>

                {/* Goal */}
                {selectedAgent.goal && (
                  <div>
                    <p className="text-[10px] text-white/40 mb-1">Goal</p>
                    <p className="text-xs text-white/80">{selectedAgent.goal}</p>
                  </div>
                )}

                {/* HITL Controls */}
                {selectedAgent.hitlRequired && !selectedAgent.hitlApproved && (
                  <div className="space-y-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                    <p className="text-xs text-yellow-300 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Human approval required
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleApprove}
                        className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 h-7 text-xs"
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setShowRejectDialog(true)}
                        className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 h-7 text-xs"
                      >
                        <XOctagon className="w-3 h-3 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                )}

                {/* Nudge Control */}
                <div className="space-y-2">
                  <p className="text-[10px] text-white/40 flex items-center gap-1">
                    <MessageSquare className="w-2 h-2" />
                    Send instruction
                  </p>
                  <Textarea
                    value={nudgeInput}
                    onChange={(e) => setNudgeInput(e.target.value)}
                    placeholder="E.g., 'Try a different approach...'"
                    className="min-h-[60px] bg-black/30 border-white/10 text-white/90 placeholder:text-white/40 text-xs resize-none"
                  />
                  <Button
                    size="sm"
                    onClick={handleNudge}
                    disabled={!nudgeInput.trim()}
                    className="w-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 h-7 text-xs"
                  >
                    <Send className="w-3 h-3 mr-1" />
                    Send Nudge
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Logs Card */}
            {showLogs && selectedAgent.logs && selectedAgent.logs.length > 0 && (
              <Card className="bg-black/40 border-white/10 flex-1 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      Activity Log
                    </h4>
                    <Badge variant="outline" className="text-[10px] border-white/20">
                      {selectedAgent.logs.length} events
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {selectedAgent.logs.slice().reverse().map((log) => (
                        <div
                          key={log.id}
                          className="p-2 rounded bg-black/30 border border-white/5"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              variant="outline"
                              className={`text-[8px] h-4 ${
                                log.type === 'info' ? 'border-blue-500/30 text-blue-300' :
                                log.type === 'action' ? 'border-green-500/30 text-green-300' :
                                log.type === 'decision' ? 'border-purple-500/30 text-purple-300' :
                                log.type === 'error' ? 'border-red-500/30 text-red-300' :
                                'border-yellow-500/30 text-yellow-300'
                              }`}
                            >
                              {log.type}
                            </Badge>
                            <span className="text-[9px] text-white/40">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-xs text-white/80">{log.message}</p>
                          {log.data && (
                            <pre className="mt-1 text-[9px] text-white/60 bg-black/50 p-1 rounded overflow-auto max-h-20">
                              {JSON.stringify(log.data, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Reject Dialog */}
      {showRejectDialog && selectedAgent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <Card className="w-[400px] bg-black/90 border-white/20">
            <CardHeader>
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <XOctagon className="w-4 h-4 text-red-400" />
                Reject Agent Execution
              </h4>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-white/60">
                Provide a reason for rejecting {selectedAgent.name}'s current action:
              </p>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="E.g., 'This approach will cause issues with...'"
                className="min-h-[100px] bg-black/30 border-white/10 text-white/90 placeholder:text-white/40 text-xs resize-none"
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setShowRejectDialog(false)}
                  className="flex-1 text-white/60"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReject}
                  disabled={!rejectReason.trim()}
                  className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
                >
                  <XOctagon className="w-3 h-3 mr-1" />
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-white/60">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-500" />
          <span>Idle</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
          <span>Thinking</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
          <span>Executing</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse" />
          <span>Approval</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>Failed</span>
        </div>
      </div>
    </div>
  );
}
