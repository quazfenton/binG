/**
 * Workflow Visualizer Component
 *
 * Visual workflow builder and monitor for Mastra workflows.
 * Shows workflow steps, status, and execution flow.
 *
 * @component
 */

"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Workflow,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  GitBranch,
  Zap,
  Brain,
  Eye,
  Maximize2,
  Minimize2,
  Settings,
  Download,
  Share2,
} from "lucide-react";
import { toast } from "sonner";

// Fetch workflows from API
async function fetchWorkflows() {
  try {
    const response = await fetch('/api/workflows/visualizer');
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch workflows');
    }
    
    return {
      templates: data.templates || [],
      instances: data.instances || [],
    };
  } catch (err: any) {
    console.error('[WorkflowVisualizer] Failed to fetch:', err);
    toast.error('Failed to load workflows');
    return { templates: [], instances: [] };
  }
}

// Execute workflow via API
async function executeWorkflow(workflowId: string, input?: any) {
  try {
    const response = await fetch('/api/workflows/visualizer/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId, input }),
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to execute workflow');
    }
    
    return data.instance;
  } catch (err: any) {
    console.error('[WorkflowVisualizer] Execution failed:', err);
    throw err;
  }
}

// Types
interface WorkflowStep {
  id: string;
  name: string;
  type: 'planner' | 'executor' | 'critic' | 'researcher' | 'analyst' | 'synthesizer' | 'custom';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  duration?: number;
  error?: string;
  output?: any;
}

interface WorkflowInstance {
  id: string;
  workflowId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps: WorkflowStep[];
  startedAt?: number;
  completedAt?: number;
  progress: number;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: { id: string; name: string; type: WorkflowStep['type'] }[];
  icon: any;
}

// Workflow templates
const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'code-agent',
    name: 'Code Agent',
    description: 'Code generation with self-healing',
    icon: Zap,
    steps: [
      { id: 'collective', name: 'Collective', type: 'custom' },
      { id: 'planner', name: 'Planner', type: 'planner' },
      { id: 'executor', name: 'Executor', type: 'executor' },
      { id: 'critic', name: 'Critic', type: 'critic' },
      { id: 'self-healing', name: 'Self-Healing', type: 'custom' },
    ],
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Multi-source research & synthesis',
    icon: Brain,
    steps: [
      { id: 'planner', name: 'Research Planner', type: 'planner' },
      { id: 'researcher', name: 'Researcher', type: 'researcher' },
      { id: 'analyst', name: 'Analyst', type: 'analyst' },
      { id: 'synthesizer', name: 'Synthesizer', type: 'synthesizer' },
    ],
  },
  {
    id: 'data-analysis',
    name: 'Data Analysis',
    description: 'Dataset analysis & visualization',
    icon: GitBranch,
    steps: [
      { id: 'profiler', name: 'Data Profiler', type: 'custom' },
      { id: 'analyzer', name: 'Statistical Analyzer', type: 'analyst' },
      { id: 'designer', name: 'Visualization Designer', type: 'custom' },
      { id: 'reporter', name: 'Report Generator', type: 'synthesizer' },
    ],
  },
];

// Status colors
const statusColors: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/30 animate-pulse',
  completed: 'bg-green-500/20 text-green-300 border-green-500/30',
  failed: 'bg-red-500/20 text-red-300 border-red-500/30',
  skipped: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

// Step type icons
const stepTypeIcons: Record<string, any> = {
  planner: Brain,
  executor: Zap,
  critic: Eye,
  researcher: Workflow,
  analyst: GitBranch,
  synthesizer: CheckCircle,
  custom: Settings,
};

export default function WorkflowVisualizer() {
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  // Load workflows on mount
  useEffect(() => {
    loadWorkflows();
    const interval = setInterval(loadWorkflows, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadWorkflows = async () => {
    try {
      setLoading(true);
      const data = await fetchWorkflows();
      setTemplates(data.templates || WORKFLOW_TEMPLATES);
      setInstances(data.instances || []);
    } catch (err) {
      console.warn('Failed to load workflows, using defaults:', err);
      setTemplates(WORKFLOW_TEMPLATES);
    } finally {
      setLoading(false);
    }
  };

  // Simulate workflow execution
  useEffect(() => {
    if (!isRunning || !selectedInstance) return;

    const interval = setInterval(() => {
      setInstances(prev => prev.map(inst => {
        if (inst.id !== selectedInstance.id) return inst;

        const updatedSteps = inst.steps.map((step, index) => {
          // Complete previous steps
          if (index < inst.progress) {
            return { ...step, status: 'completed' as const, duration: Math.random() * 2000 + 500 };
          }
          // Run current step
          if (index === inst.progress) {
            return { ...step, status: 'running' as const };
          }
          // Pending steps
          return step;
        });

        const newProgress = inst.progress < inst.steps.length ? inst.progress + 0.1 : inst.progress;
        const isComplete = newProgress >= inst.steps.length;

        return {
          ...inst,
          steps: updatedSteps,
          progress: newProgress,
          status: isComplete ? 'completed' : inst.status,
          completedAt: isComplete ? Date.now() : undefined,
        };
      }));
    }, 500);

    return () => clearInterval(interval);
  }, [isRunning, selectedInstance]);

  // Start workflow
  const startWorkflow = async (template: WorkflowTemplate) => {
    try {
      const instance = await executeWorkflow(template.id);
      
      setInstances(prev => [instance, ...prev]);
      setSelectedInstance(instance);
      setIsRunning(true);
      toast.success(`Started ${template.name} workflow`);
    } catch (err: any) {
      console.error('Failed to start workflow:', err);
      toast.error(err.message || 'Failed to start workflow');
    }
  };

  // Stop workflow
  const stopWorkflow = () => {
    setIsRunning(false);
    if (selectedInstance) {
      setInstances(prev => prev.map(inst =>
        inst.id === selectedInstance.id
          ? { ...inst, status: 'failed' as const, steps: inst.steps.map(s =>
              s.status === 'running' ? { ...s, status: 'failed' as const, error: 'Stopped by user' } : s
            )}
          : inst
      ));
    }
    toast.info('Workflow stopped');
  };

  // Reset workflow
  const resetWorkflow = () => {
    if (selectedInstance) {
      setInstances(prev => prev.map(inst =>
        inst.id === selectedInstance.id
          ? { ...inst, status: 'pending' as const, steps: inst.steps.map(s => ({ ...s, status: 'pending' })), progress: 0 }
          : inst
      ));
    }
    toast.info('Workflow reset');
  };

  return (
    <div className={`h-full flex flex-col ${isFullscreen ? 'fixed inset-0 z-[9999] bg-black/95' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Workflow className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold text-white">Workflow Visualizer</h3>
          <Badge variant="outline" className="text-[10px] border-white/20">
            {instances.length} instances
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsFullscreen(!isFullscreen)}
            variant="ghost"
            size="icon"
            className="text-white/60 hover:text-white"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Templates Panel */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white">Workflow Templates</h4>
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {WORKFLOW_TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <Card
                    key={template.id}
                    className="bg-white/5 border-white/10 cursor-pointer hover:bg-white/10 transition-all"
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/20 rounded-lg">
                          <Icon className="w-4 h-4 text-purple-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">{template.name}</p>
                          <p className="text-xs text-white/40">{template.description}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            startWorkflow(template);
                          }}
                          className="bg-purple-500/20 hover:bg-purple-500/30"
                        >
                          <Play className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Workflow Diagram */}
        <div className="col-span-2 space-y-4">
          {selectedInstance ? (
            <>
              {/* Instance Header */}
              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-base font-semibold text-white">{selectedInstance.name}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={statusColors[selectedInstance.status]}>
                          {selectedInstance.status}
                        </Badge>
                        <span className="text-xs text-white/40">
                          Progress: {Math.round(selectedInstance.progress * 100)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isRunning ? (
                        <Button onClick={stopWorkflow} variant="outline" size="sm">
                          <Pause className="w-3 h-3 mr-2" />
                          Stop
                        </Button>
                      ) : (
                        <Button onClick={resetWorkflow} variant="outline" size="sm">
                          <RotateCcw className="w-3 h-3 mr-2" />
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Workflow Steps */}
              <div className="flex items-center gap-2 overflow-x-auto py-4">
                {selectedInstance.steps.map((step, index) => {
                  const StepIcon = stepTypeIcons[step.type] || Settings;
                  return (
                    <React.Fragment key={step.id}>
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: index * 0.1 }}
                      >
                        <Card className={`min-w-[140px] border ${statusColors[step.status]}`}>
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2">
                              <StepIcon className="w-4 h-4" />
                              <span className="text-sm font-medium">{step.name}</span>
                            </div>
                            {step.duration && (
                              <p className="text-xs mt-1 opacity-60">
                                {Math.round(step.duration / 1000)}s
                              </p>
                            )}
                            {step.error && (
                              <p className="text-xs mt-1 text-red-400">{step.error}</p>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                      {index < selectedInstance.steps.length - 1 && (
                        <ArrowRight className="w-4 h-4 text-white/40 flex-shrink-0" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-white/40">
                  <span>Overall Progress</span>
                  <span>{Math.round(selectedInstance.progress * 100)}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${selectedInstance.progress * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-white/40">
                <Workflow className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p>Select a workflow template to visualize</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Instances Panel */}
      {instances.length > 0 && (
        <div className="border-t border-white/10 p-4">
          <h4 className="text-sm font-semibold text-white mb-3">Recent Instances</h4>
          <ScrollArea className="h-32">
            <div className="grid grid-cols-4 gap-2">
              {instances.map((inst) => (
                <Card
                  key={inst.id}
                  className={`bg-white/5 border-white/10 cursor-pointer hover:bg-white/10 ${
                    selectedInstance?.id === inst.id ? 'border-purple-500/30' : ''
                  }`}
                  onClick={() => setSelectedInstance(inst)}
                >
                  <CardContent className="p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-white truncate">{inst.name}</span>
                      <Badge className={statusColors[inst.status]}>{inst.status}</Badge>
                    </div>
                    <p className="text-[10px] text-white/40 mt-1">
                      {inst.steps.filter(s => s.status === 'completed').length}/{inst.steps.length} steps
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
