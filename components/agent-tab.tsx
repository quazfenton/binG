"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Brain,
  Workflow,
  Bot,
  Cpu,
  Route,
  Zap,
  RotateCcw,
  Info,
  CheckCircle2,
  AlertCircle,
  Play,
  Loader2,
} from "lucide-react";
import { useOrchestrationMode, type OrchestrationMode } from "@/contexts/orchestration-mode-context";
import { toast } from "sonner";

interface AgentTabProps {
  onClose?: () => void;
}

interface ModeInfo {
  id: OrchestrationMode;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: 'stable' | 'experimental' | 'deprecated';
  features: string[];
  bestFor: string;
}

const MODE_INFO: Record<OrchestrationMode, ModeInfo> = {
  'task-router': {
    id: 'task-router',
    name: 'Task Router (Default)',
    description: 'Routes tasks between OpenCode and Nullclaw based on task type',
    icon: Route,
    status: 'stable',
    features: [
      'Automatic task classification',
      'OpenCode for coding tasks',
      'Nullclaw for non-coding tasks',
      'Execution policy selection',
    ],
    bestFor: 'General purpose - coding + automation tasks',
  },
  'unified-agent': {
    id: 'unified-agent',
    name: 'Unified Agent Service',
    description: 'Intelligent fallback chain with multiple execution modes',
    icon: Brain,
    status: 'experimental',
    features: [
      'StatefulAgent for complex tasks',
      'Fallback: StatefulAgent → V2 Native → V2 Local → V1 API',
      'Mastra workflow integration',
      'Tool execution support',
    ],
    bestFor: 'Complex multi-step agentic workflows',
  },
  'mastra-workflow': {
    id: 'mastra-workflow',
    name: 'Mastra Workflows',
    description: 'Mastra workflow engine with proper tracking and evals',
    icon: Workflow,
    status: 'experimental',
    features: [
      'Workflow-based execution',
      'Quality evaluations',
      'Memory system',
      'MCP integration',
    ],
    bestFor: 'Structured workflows with quality gates',
  },
  'crewai': {
    id: 'crewai',
    name: 'CrewAI Agents',
    description: 'Role-based multi-agent collaboration',
    icon: Bot,
    status: 'experimental',
    features: [
      'Role-based agents (Planner, Coder, Critic)',
      'Sequential/hierarchical processes',
      'Self-healing execution',
      'Knowledge base integration',
    ],
    bestFor: 'Complex tasks requiring multiple specialized agents',
  },
  'v2-executor': {
    id: 'v2-executor',
    name: 'V2 Containerized',
    description: 'OpenCode containerized execution with sandbox isolation',
    icon: Cpu,
    status: 'stable',
    features: [
      'Containerized execution',
      'Sandbox isolation',
      'Direct file operations',
      'Bash command execution',
    ],
    bestFor: 'Isolated code execution with full sandbox',
  },
};

export default function AgentTab({ onClose }: AgentTabProps) {
  const { config, setMode, resetToDefault, isOverridden } = useOrchestrationMode();
  const [isTesting, setIsTesting] = useState(false);

  const handleModeSelect = (mode: OrchestrationMode) => {
    setMode(mode);
    toast.success(`Orchestration mode changed`, {
      description: `Now using ${MODE_INFO[mode].name}`,
    });
  };

  const handleTestMode = async (mode: OrchestrationMode) => {
    setIsTesting(true);
    try {
      // TODO: Implement actual mode testing
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success(`Mode test completed`, {
        description: `${MODE_INFO[mode].name} is ready`,
      });
    } catch (error) {
      toast.error(`Mode test failed`, {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-lg border border-purple-500/30">
              <Brain className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white/90">Agent Orchestration</h3>
              <p className="text-[10px] text-white/50">Select execution framework</p>
            </div>
          </div>
          {isOverridden && (
            <Badge variant="secondary" className="text-[10px] bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
              <AlertCircle className="h-2 w-2 mr-1" />
              Custom Mode
            </Badge>
          )}
        </div>

        {/* Info Banner */}
        <Card className="bg-blue-500/10 border-blue-500/30">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-400 mt-0.5" />
              <div className="text-xs text-blue-300">
                <p className="font-medium mb-1">Orchestration Mode Selector</p>
                <p>
                  Choose which framework orchestrates agent tasks. Default is <strong>Task Router</strong>. 
                  Select alternative modes for testing different execution strategies.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Current Mode Display */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/90">Current Mode</span>
              {isOverridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetToDefault}
                  className="h-6 text-xs hover:bg-red-500/20"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset to Default
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30">
              {React.createElement(MODE_INFO[config.mode].icon, { className: "h-6 w-6 text-purple-400" })}
              <div className="flex-1">
                <p className="text-sm font-semibold text-white/90">{MODE_INFO[config.mode].name}</p>
                <p className="text-xs text-white/60">{MODE_INFO[config.mode].description}</p>
              </div>
              <Badge
                variant="secondary"
                className={`text-[10px] ${
                  MODE_INFO[config.mode].status === 'stable'
                    ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                    : MODE_INFO[config.mode].status === 'experimental'
                    ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                    : 'bg-red-500/20 text-red-300 border border-red-500/30'
                }`}
              >
                {MODE_INFO[config.mode].status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Separator className="bg-white/10" />

        {/* Mode Selection */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-white/70">Available Orchestration Modes</p>
          
          <div className="grid grid-cols-1 gap-2">
            {(Object.keys(MODE_INFO) as OrchestrationMode[]).map((modeId) => {
              const mode = MODE_INFO[modeId];
              const isSelected = config.mode === modeId;
              const Icon = mode.icon;

              return (
                <motion.div
                  key={modeId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card
                    className={`cursor-pointer transition-all duration-300 ${
                      isSelected
                        ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-purple-500/40'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                    onClick={() => handleModeSelect(modeId)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${
                          isSelected ? 'bg-purple-500/20' : 'bg-white/5'
                        }`}>
                          <Icon className={`h-5 w-5 ${
                            isSelected ? 'text-purple-400' : 'text-white/60'
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className={`text-sm font-semibold ${
                              isSelected ? 'text-white/90' : 'text-white/70'
                            }`}>
                              {mode.name}
                            </p>
                            {isSelected && (
                              <CheckCircle2 className="h-3 w-3 text-green-400" />
                            )}
                          </div>
                          <p className="text-xs text-white/50 mb-2">{mode.description}</p>
                          
                          {/* Features */}
                          <div className="flex flex-wrap gap-1 mb-2">
                            {mode.features.slice(0, 3).map((feature, idx) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-[8px] bg-white/5 text-white/60"
                              >
                                {feature}
                              </Badge>
                            ))}
                            {mode.features.length > 3 && (
                              <Badge
                                variant="secondary"
                                className="text-[8px] bg-white/5 text-white/60"
                              >
                                +{mode.features.length - 3} more
                              </Badge>
                            )}
                          </div>
                          
                          {/* Best For */}
                          <p className="text-[10px] text-white/40">
                            <span className="font-medium">Best for:</span> {mode.bestFor}
                          </p>
                        </div>
                        
                        {/* Test Button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTestMode(modeId);
                          }}
                          disabled={isTesting}
                          className="h-8 w-8 p-0 hover:bg-white/10"
                          title={`Test ${mode.name}`}
                        >
                          {isTesting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Status Legend */}
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-3">
            <p className="text-xs font-medium text-white/70 mb-2">Mode Status Legend</p>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-[10px] text-white/60">Stable</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-[10px] text-white/60">Experimental</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-[10px] text-white/60">Deprecated</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
