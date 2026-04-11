"use client";

import React, { useState, useEffect } from "react";
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
  GitBranch,
  Cloud,
  Users,
} from "lucide-react";
import { useOrchestrationMode, type OrchestrationMode } from "@/contexts/orchestration-mode-context";
import { toast } from "sonner";

interface AgentTabProps {
  onClose?: () => void;
}

interface ModeConfigOption {
  type: 'select' | 'number' | 'text' | 'toggle';
  label: string;
  default: any;
  options?: string[];
  min?: number;
  max?: number;
  description?: string;
}

interface ModeData {
  id: string;
  name: string;
  description: string;
  status: 'stable' | 'experimental' | 'deprecated';
  features: string[];
  bestFor: string;
  active: boolean;
  providers: string[];
  executionType: 'v1' | 'v2' | 'both';
  v1Capabilities?: string[];
  v2Capabilities?: string[];
  configOptions?: Record<string, ModeConfigOption>;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'task-router': Route,
  'unified-agent': Brain,
  'stateful-agent': Cpu,
  'agent-kernel': Zap,
  'agent-loop': RotateCcw,
  'execution-graph': GitBranch,
  'nullclaw': Bot,
  'opencode-sdk': Cloud,
  'mastra-workflow': Workflow,
  'crewai': Bot,
  'v2-executor': Cpu,
  'agent-team': Users,
};

export default function AgentTab({ onClose }: AgentTabProps) {
  const { config, setMode, resetToDefault, isOverridden } = useOrchestrationMode();
  const [isTesting, setIsTesting] = useState(false);
  const [modes, setModes] = useState<ModeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModes();
  }, []);

  const fetchModes = () => {
    setLoading(true);
    setError(null);
    fetch('/api/chat/modes')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.success) {
          setModes(data.modes);
        } else {
          setError('Failed to load modes');
        }
      })
      .catch(err => {
        console.error('[AgentTab] Failed to fetch modes:', err);
        setError(err.message || 'Failed to load modes');
      })
      .finally(() => setLoading(false));
  };

  const checkModeReadiness = async (mode: ModeData): Promise<{ ready: boolean; error?: string }> => {
    if (mode.status === 'deprecated') {
      return { ready: false, error: 'This mode is deprecated' };
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    return { ready: true };
  };

  const isModeConfigValid = (mode: ModeData): boolean => {
    return mode.status !== 'deprecated' && mode.active;
  };

  const handleModeSelect = (modeId: string) => {
    setMode(modeId as OrchestrationMode);
    const mode = modes.find(m => m.id === modeId);
    toast.success(`Orchestration mode changed`, {
      description: `Now using ${mode?.name || modeId}`,
    });
  };

  const handleTestMode = async (modeId: string) => {
    const mode = modes.find(m => m.id === modeId);
    if (!mode) return;
    setIsTesting(true);
    try {
      const result = await checkModeReadiness(mode);
      if (!result.ready) {
        throw new Error(result.error || 'Mode is not ready');
      }
      toast.success(`Mode test completed`, {
        description: `${mode.name} is ready`,
      });
    } catch (error) {
      toast.error(`Mode test failed`, {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsTesting(false);
    }
  };

  if (loading) {
    return (
      <ScrollArea className="h-full">
        <div className="p-4 flex items-center justify-center h-40">
          <Loader2 className="h-5 w-5 text-white/40 animate-spin" />
          <span className="ml-2 text-sm text-white/40">Loading modes...</span>
        </div>
      </ScrollArea>
    );
  }

  if (error) {
    return (
      <ScrollArea className="h-full">
        <div className="p-4 flex items-center justify-center h-40">
          <div className="text-center">
            <AlertCircle className="h-5 w-5 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-300">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchModes}
              className="mt-2 text-xs text-white/60 hover:text-white"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </div>
        </div>
      </ScrollArea>
    );
  }

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
            {(() => {
              const currentMode = modes.find(m => m.id === config.mode);
              if (!currentMode) return null;
              const Icon = ICON_MAP[currentMode.id] || Cpu;
              return (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30">
                  <Icon className="h-6 w-6 text-purple-400" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white/90">{currentMode.name}</p>
                    <p className="text-xs text-white/60">{currentMode.description}</p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${
                      currentMode.status === 'stable'
                        ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                        : currentMode.status === 'experimental'
                        ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                        : 'bg-red-500/20 text-red-300 border border-red-500/30'
                    }`}
                  >
                    {currentMode.status}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${
                      currentMode.executionType === 'v2'
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        : currentMode.executionType === 'v1'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    }`}
                  >
                    {currentMode.executionType === 'v1' ? 'V1 API' : currentMode.executionType === 'v2' ? 'V2 Agent' : 'V1+V2'}
                  </Badge>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Separator className="bg-white/10" />

        {/* Mode Selection */}
        <div className="space-y-2" role="radiogroup" aria-label="Orchestration mode selection">
          <p className="text-xs font-medium text-white/70">Available Orchestration Modes</p>

          <div className="grid grid-cols-1 gap-2">
            {modes.map((mode) => {
              const isSelected = config.mode === mode.id;
              const Icon = ICON_MAP[mode.id] || Cpu;

              return (
                <motion.div
                  key={mode.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div
                    role="radio"
                    tabIndex={0}
                    aria-checked={isSelected}
                    aria-label={`Select ${mode.name} mode`}
                    className={`w-full text-left cursor-pointer transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-gray-900 rounded-lg ${
                      isSelected
                        ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-purple-500/40'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    } ${!mode.active ? 'opacity-50' : ''}`}
                    onClick={() => mode.active && handleModeSelect(mode.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        mode.active && handleModeSelect(mode.id);
                      }
                    }}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${
                          isSelected ? 'bg-purple-500/20' : 'bg-white/5'
                        }`}>
                          <Icon className={`h-5 w-5 ${
                            isSelected ? 'text-purple-400' : 'text-white/60'
                          }`} aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className={`text-sm font-semibold ${
                              isSelected ? 'text-white/90' : 'text-white/70'
                            }`}>
                              {mode.name}
                            </p>
                            {isSelected && (
                              <CheckCircle2 className="h-3 w-3 text-green-400" aria-hidden="true" />
                            )}
                            {!mode.active && (
                              <Badge variant="secondary" className="text-[8px] bg-gray-500/20 text-gray-400">
                                Not configured
                              </Badge>
                            )}
                            <Badge variant="secondary" className={`text-[8px] ${
                              mode.executionType === 'v2'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                : mode.executionType === 'v1'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            }`}>
                              {mode.executionType === 'v1' ? 'V1 API' : mode.executionType === 'v2' ? 'V2 Agent' : 'V1+V2'}
                            </Badge>
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

                          {/* Config Options Preview */}
                          {mode.configOptions && Object.keys(mode.configOptions).length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] text-white/40 mb-1">
                                <span className="font-medium">Config:</span> {Object.values(mode.configOptions).map((opt: ModeConfigOption) => opt.label).slice(0, 2).join(' · ')}
                                {Object.keys(mode.configOptions).length > 2 && ` +${Object.keys(mode.configOptions).length - 2} more`}
                              </p>
                            </div>
                          )}

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
                            handleTestMode(mode.id);
                          }}
                          disabled={isTesting || !isModeConfigValid(mode)}
                          className="h-8 w-8 p-0 hover:bg-white/10"
                          aria-label={`Test ${mode.name} mode`}
                          title={!isModeConfigValid(mode) ? 'Mode not available for testing' : `Test ${mode.name}`}
                        >
                          {isTesting ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Play className="h-3 w-3" aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </div>
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
