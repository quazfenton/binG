/**
 * Agent Mind Map Tab
 * 
 * Visual representation of agent thinking process:
 * - Real-time thought visualization
 * - Decision tree exploration
 * - Token flow animation
 * - Reasoning chain display
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Brain,
  Zap,
  GitBranch,
  Lightbulb,
  Target,
  CheckCircle,
  AlertCircle,
  Clock,
  Activity,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  RefreshCw,
  Filter,
  Search,
  Download,
  Share,
  Eye,
  Layers,
  Network,
  Sparkles,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  X,
} from "lucide-react";
import { toast } from "sonner";

// Types
interface ThoughtNode {
  id: string;
  type: "thought" | "decision" | "action" | "result" | "question";
  content: string;
  timestamp: number;
  confidence?: number;
  tokens?: number;
  children?: string[];
  parentId?: string;
  status: "pending" | "active" | "completed" | "failed";
  metadata?: Record<string, any>;
}

interface ReasoningChain {
  id: string;
  taskId: string;
  task: string;
  startTime: number;
  endTime?: number;
  nodes: ThoughtNode[];
  status: "running" | "completed" | "failed";
  totalTokens: number;
  totalThoughts: number;
}

const MOCK_CHAINS: ReasoningChain[] = [
  {
    id: "chain-1",
    taskId: "task-1",
    task: "Build a Next.js authentication system",
    startTime: Date.now() - 300000,
    endTime: Date.now() - 240000,
    status: "completed",
    totalTokens: 4567,
    totalThoughts: 12,
    nodes: [
      {
        id: "node-1",
        type: "thought",
        content: "User needs authentication with Next.js. Should consider NextAuth.js vs custom implementation.",
        timestamp: Date.now() - 300000,
        confidence: 0.85,
        tokens: 234,
        status: "completed",
      },
      {
        id: "node-2",
        type: "question",
        content: "What authentication providers are needed? OAuth, email, or both?",
        timestamp: Date.now() - 295000,
        confidence: 0.9,
        tokens: 156,
        parentId: "node-1",
        status: "completed",
      },
      {
        id: "node-3",
        type: "decision",
        content: "Decision: Use NextAuth.js for flexibility and built-in providers",
        timestamp: Date.now() - 290000,
        confidence: 0.95,
        tokens: 189,
        parentId: "node-2",
        status: "completed",
      },
      {
        id: "node-4",
        type: "action",
        content: "Action: Create /api/auth/[...nextauth]/route.ts",
        timestamp: Date.now() - 285000,
        tokens: 345,
        parentId: "node-3",
        status: "completed",
      },
      {
        id: "node-5",
        type: "result",
        content: "✓ Created NextAuth configuration with Google & GitHub providers",
        timestamp: Date.now() - 240000,
        tokens: 567,
        parentId: "node-4",
        status: "completed",
      },
    ],
  },
  {
    id: "chain-2",
    taskId: "task-2",
    task: "Optimize database queries for performance",
    startTime: Date.now() - 120000,
    status: "running",
    totalTokens: 2345,
    totalThoughts: 7,
    nodes: [
      {
        id: "node-6",
        type: "thought",
        content: "Analyzing query patterns to identify bottlenecks...",
        timestamp: Date.now() - 120000,
        confidence: 0.75,
        tokens: 456,
        status: "completed",
      },
      {
        id: "node-7",
        type: "action",
        content: "Running EXPLAIN ANALYZE on slow queries...",
        timestamp: Date.now() - 115000,
        tokens: 234,
        parentId: "node-6",
        status: "active",
      },
    ],
  },
];

const NODE_COLORS = {
  thought: "from-blue-500 to-cyan-500",
  decision: "from-purple-500 to-pink-500",
  action: "from-green-500 to-emerald-500",
  result: "from-amber-500 to-orange-500",
  question: "from-indigo-500 to-violet-500",
};

const NODE_ICONS = {
  thought: Brain,
  decision: GitBranch,
  action: Zap,
  result: CheckCircle,
  question: AlertCircle,
};

export default function MindMapTab() {
  const [chains, setChains] = useState<ReasoningChain[]>(MOCK_CHAINS);
  const [selectedChain, setSelectedChain] = useState<ReasoningChain | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["node-1", "node-3"]));
  const [isPlaying, setIsPlaying] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleExport = () => {
    if (!selectedChain) return;
    const dataStr = JSON.stringify(selectedChain, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mindmap-${selectedChain.taskId}.json`;
    a.click();
    toast.success("Mind map exported");
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-indigo-500/10 to-purple-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Agent Mind Map</h3>
            <p className="text-xs text-white/60">Visual Reasoning & Thought Process</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsPlaying(!isPlaying)}
            className={isPlaying ? "text-green-400" : "text-white/60"}
          >
            {isPlaying ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExport}
            className="text-white/60 hover:text-white"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 grid grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Left: Chain List */}
        <ScrollArea className="col-span-1 space-y-3">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Reasoning Chains
            </h4>

            {chains.map((chain) => (
              <Card
                key={chain.id}
                className={`bg-white/5 border-white/10 cursor-pointer transition-all ${
                  selectedChain?.id === chain.id
                    ? "border-indigo-500/30 bg-indigo-500/10"
                    : "hover:bg-white/10"
                }`}
                onClick={() => setSelectedChain(chain)}
              >
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        chain.status === "completed" ? "bg-green-400" :
                        chain.status === "running" ? "bg-blue-400 animate-pulse" :
                        "bg-red-400"
                      }`} />
                      <p className="text-sm font-medium text-white line-clamp-2">
                        {chain.task}
                      </p>
                    </div>
                    {chain.status === "completed" && (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/40">
                    <span className="flex items-center gap-1">
                      <Brain className="w-3 h-3" />
                      {chain.totalThoughts} thoughts
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {chain.totalTokens} tokens
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {chain.endTime
                        ? `${Math.round((chain.endTime - chain.startTime) / 1000)}s`
                        : "Running"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        {/* Middle: Mind Map Visualization */}
        <div className="col-span-2 relative bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          {selectedChain ? (
            <div className="absolute inset-0 p-6 overflow-auto">
              <div className="space-y-4">
                {selectedChain.nodes.map((node, index) => {
                  const Icon = NODE_ICONS[node.type];
                  const isExpanded = expandedNodes.has(node.id);
                  const hasChildren = selectedChain.nodes.some(n => n.parentId === node.id);

                  return (
                    <motion.div
                      key={node.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="relative"
                    >
                      {/* Connection Line */}
                      {node.parentId && (
                        <div className="absolute -left-8 top-1/2 w-8 h-px bg-gradient-to-r from-transparent to-indigo-500/50" />
                      )}

                      <Card
                        className={`bg-gradient-to-r ${NODE_COLORS[node.type]} border-0 cursor-pointer transition-all hover:scale-[1.02]`}
                        onClick={() => hasChildren && toggleNode(node.id)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="p-2 bg-black/20 rounded-lg">
                              <Icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge className="bg-black/30 text-white text-[10px]">
                                  {node.type}
                                </Badge>
                                {node.confidence && (
                                  <span className="text-[10px] text-white/80">
                                    {(node.confidence * 100).toFixed(0)}% confidence
                                  </span>
                                )}
                                <span className="text-[10px] text-white/60 ml-auto">
                                  {node.tokens} tokens
                                </span>
                              </div>
                              <p className="text-sm text-white">{node.content}</p>
                              <div className="flex items-center gap-2 mt-2 text-[10px] text-white/60">
                                <Clock className="w-3 h-3" />
                                {new Date(node.timestamp).toLocaleTimeString()}
                                {node.status === "active" && (
                                  <span className="flex items-center gap-1 text-blue-400">
                                    <Activity className="w-3 h-3 animate-pulse" />
                                    Active
                                  </span>
                                )}
                              </div>
                            </div>
                            {hasChildren && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-white/60 hover:text-white"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Children Nodes */}
                      <AnimatePresence>
                        {isExpanded && hasChildren && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="ml-8 mt-2 space-y-2"
                          >
                            {selectedChain.nodes
                              .filter(n => n.parentId === node.id)
                              .map(childNode => (
                                <div
                                  key={childNode.id}
                                  className="p-2 bg-white/5 rounded border border-white/10 text-xs text-white/80"
                                >
                                  {childNode.content}
                                </div>
                              ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-white/60">
                <Brain className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-semibold mb-2">Select a Reasoning Chain</h3>
                <p>View the agent's thought process and decision tree</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
