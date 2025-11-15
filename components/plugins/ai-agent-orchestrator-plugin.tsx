"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Bot, Users, Workflow, Zap, Play, Pause, StopCircle,
  Loader2, CheckCircle, XCircle, AlertCircle, ArrowRight,
  Brain, Code, FileText, Search, Database, Send,
  GitBranch, Network, Activity, Clock, Eye, Settings,
  Plus, Trash2, Copy, Download, MessageSquare, Sparkles
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface AIAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  status: 'idle' | 'active' | 'thinking' | 'error' | 'completed';
  capabilities: string[];
  systemPrompt: string;
  icon: string;
  color: string;
  tasksCompleted: number;
  currentTask?: string;
}

interface WorkflowStep {
  id: string;
  agentId: string;
  action: string;
  input: string;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  duration?: number;
  dependencies: string[];
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: 'draft' | 'running' | 'paused' | 'completed' | 'error';
  created: string;
  progress: number;
}

interface AgentCommunication {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  message: string;
  type: 'request' | 'response' | 'delegation' | 'completion';
}

const AIAgentOrchestratorPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const [agents, setAgents] = useState<AIAgent[]>([
    {
      id: 'agent-1',
      name: 'Research Agent',
      role: 'Research Specialist',
      description: 'Gathers and analyzes information from various sources',
      status: 'idle',
      capabilities: ['web_search', 'data_analysis', 'summarization'],
      systemPrompt: 'You are a research specialist. Your role is to gather comprehensive information and provide detailed analysis.',
      icon: '🔍',
      color: 'text-blue-400',
      tasksCompleted: 0
    },
    {
      id: 'agent-2',
      name: 'Code Agent',
      role: 'Software Engineer',
      description: 'Writes, reviews, and optimizes code',
      status: 'idle',
      capabilities: ['code_generation', 'code_review', 'debugging', 'optimization'],
      systemPrompt: 'You are an expert software engineer. Write clean, efficient, and well-documented code.',
      icon: '💻',
      color: 'text-green-400',
      tasksCompleted: 0
    },
    {
      id: 'agent-3',
      name: 'Writer Agent',
      role: 'Content Creator',
      description: 'Creates engaging written content',
      status: 'idle',
      capabilities: ['content_writing', 'editing', 'copywriting'],
      systemPrompt: 'You are a professional content writer. Create engaging, clear, and compelling content.',
      icon: '✍️',
      color: 'text-purple-400',
      tasksCompleted: 0
    },
    {
      id: 'agent-4',
      name: 'Analyst Agent',
      role: 'Data Analyst',
      description: 'Processes and visualizes data insights',
      status: 'idle',
      capabilities: ['data_processing', 'visualization', 'statistics'],
      systemPrompt: 'You are a data analyst. Process data and provide actionable insights.',
      icon: '📊',
      color: 'text-yellow-400',
      tasksCompleted: 0
    }
  ]);

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [communications, setCommunications] = useState<AgentCommunication[]>([]);
  const [activeTab, setActiveTab] = useState('agents');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [isOrchestrating, setIsOrchestrating] = useState(false);

  // Agent templates
  const agentTemplates = [
    { name: 'QA Tester', role: 'Quality Assurance', icon: '🧪', capabilities: ['testing', 'bug_detection'] },
    { name: 'Designer', role: 'UI/UX Designer', icon: '🎨', capabilities: ['design', 'prototyping'] },
    { name: 'DevOps', role: 'DevOps Engineer', icon: '⚙️', capabilities: ['deployment', 'monitoring'] },
    { name: 'Security', role: 'Security Specialist', icon: '🔒', capabilities: ['security_audit', 'vulnerability_scan'] },
    { name: 'Translator', role: 'Language Translator', icon: '🌐', capabilities: ['translation', 'localization'] },
    { name: 'Reviewer', role: 'Code Reviewer', icon: '👁️', capabilities: ['code_review', 'best_practices'] }
  ];

  const createAgent = () => {
    if (!newAgentName || !newAgentRole) {
      toast.error('Please provide agent name and role');
      return;
    }

    const newAgent: AIAgent = {
      id: `agent-${Date.now()}`,
      name: newAgentName,
      role: newAgentRole,
      description: `${newAgentRole} agent`,
      status: 'idle',
      capabilities: ['general'],
      systemPrompt: newAgentPrompt || `You are a ${newAgentRole}. Perform your role effectively.`,
      icon: '🤖',
      color: 'text-cyan-400',
      tasksCompleted: 0
    };

    setAgents(prev => [...prev, newAgent]);
    setNewAgentName('');
    setNewAgentRole('');
    setNewAgentPrompt('');
    toast.success(`Agent created: ${newAgent.name}`);
  };

  const createAgentFromTemplate = (template: typeof agentTemplates[0]) => {
    const newAgent: AIAgent = {
      id: `agent-${Date.now()}`,
      name: template.name,
      role: template.role,
      description: `${template.role} specialist`,
      status: 'idle',
      capabilities: template.capabilities,
      systemPrompt: `You are a ${template.role}. Your capabilities include: ${template.capabilities.join(', ')}.`,
      icon: template.icon,
      color: 'text-cyan-400',
      tasksCompleted: 0
    };

    setAgents(prev => [...prev, newAgent]);
    toast.success(`Agent created from template: ${newAgent.name}`);
  };

  const deleteAgent = (id: string) => {
    setAgents(prev => prev.filter(a => a.id !== id));
    if (selectedAgent?.id === id) {
      setSelectedAgent(null);
    }
    toast.success('Agent deleted');
  };

  const createWorkflow = () => {
    if (!workflowName) {
      toast.error('Please provide workflow name');
      return;
    }

    const newWorkflow: Workflow = {
      id: `workflow-${Date.now()}`,
      name: workflowName,
      description: workflowDescription,
      steps: [],
      status: 'draft',
      created: new Date().toISOString(),
      progress: 0
    };

    setWorkflows(prev => [...prev, newWorkflow]);
    setSelectedWorkflow(newWorkflow);
    setWorkflowName('');
    setWorkflowDescription('');
    toast.success('Workflow created');
  };

  const startOrchestration = async (workflow: Workflow) => {
    if (workflow.steps.length === 0) {
      toast.error('Workflow has no steps');
      return;
    }

    setIsOrchestrating(true);
    setWorkflows(prev => prev.map(w =>
      w.id === workflow.id ? { ...w, status: 'running', progress: 0 } : w
    ));

    // Simulate workflow execution
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const agent = agents.find(a => a.id === step.agentId);

      if (!agent) continue;

      // Update agent status
      setAgents(prev => prev.map(a =>
        a.id === step.agentId
          ? { ...a, status: 'thinking', currentTask: step.action }
          : a
      ));

      // Update step status
      setWorkflows(prev => prev.map(w =>
        w.id === workflow.id
          ? {
              ...w,
              steps: w.steps.map(s =>
                s.id === step.id ? { ...s, status: 'running' } : s
              )
            }
          : w
      ));

      // Add communication
      const comm: AgentCommunication = {
        id: `comm-${Date.now()}`,
        timestamp: new Date().toISOString(),
        from: 'Orchestrator',
        to: agent.name,
        message: `Executing: ${step.action}`,
        type: 'request'
      };
      setCommunications(prev => [comm, ...prev]);

      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));

      // Complete step
      const output = `Completed: ${step.action}. Generated result based on input: "${step.input}"`;

      setWorkflows(prev => prev.map(w =>
        w.id === workflow.id
          ? {
              ...w,
              steps: w.steps.map(s =>
                s.id === step.id
                  ? { ...s, status: 'completed', output, duration: Math.floor(Math.random() * 3000) + 1000 }
                  : s
              ),
              progress: Math.round(((i + 1) / workflow.steps.length) * 100)
            }
          : w
      ));

      setAgents(prev => prev.map(a =>
        a.id === step.agentId
          ? { ...a, status: 'completed', tasksCompleted: a.tasksCompleted + 1, currentTask: undefined }
          : a
      ));

      // Add response communication
      const respComm: AgentCommunication = {
        id: `comm-${Date.now()}`,
        timestamp: new Date().toISOString(),
        from: agent.name,
        to: 'Orchestrator',
        message: output,
        type: 'completion'
      };
      setCommunications(prev => [respComm, ...prev]);

      toast.success(`${agent.name} completed: ${step.action}`);
    }

    // Complete workflow
    setWorkflows(prev => prev.map(w =>
      w.id === workflow.id ? { ...w, status: 'completed', progress: 100 } : w
    ));

    setAgents(prev => prev.map(a => ({ ...a, status: 'idle' })));
    setIsOrchestrating(false);
    toast.success('Workflow completed!');
    onResult?.(workflow);
  };

  const addWorkflowStep = (workflowId: string, agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      agentId,
      action: `Task for ${agent.name}`,
      input: '',
      status: 'pending',
      dependencies: []
    };

    setWorkflows(prev => prev.map(w =>
      w.id === workflowId
        ? { ...w, steps: [...w.steps, newStep] }
        : w
    ));

    toast.success(`Added ${agent.name} to workflow`);
  };

  const quickOrchestration = async (task: string) => {
    if (!task.trim()) {
      toast.error('Please describe the task');
      return;
    }

    // Create automatic workflow
    const autoWorkflow: Workflow = {
      id: `workflow-auto-${Date.now()}`,
      name: 'Quick Task',
      description: task,
      steps: [
        {
          id: 'step-1',
          agentId: agents[0].id,
          action: 'Analyze task requirements',
          input: task,
          status: 'pending',
          dependencies: []
        },
        {
          id: 'step-2',
          agentId: agents[1].id,
          action: 'Execute main task',
          input: 'Based on analysis',
          status: 'pending',
          dependencies: ['step-1']
        },
        {
          id: 'step-3',
          agentId: agents[3].id,
          action: 'Review and validate results',
          input: 'Validation check',
          status: 'pending',
          dependencies: ['step-2']
        }
      ],
      status: 'draft',
      created: new Date().toISOString(),
      progress: 0
    };

    setWorkflows(prev => [autoWorkflow, ...prev]);
    setSelectedWorkflow(autoWorkflow);
    setActiveTab('workflows');

    toast.success('Auto-workflow created. Click "Run Workflow" to start.');
  };

  const getAgentStatusIcon = (status: AIAgent['status']) => {
    switch (status) {
      case 'active':
      case 'thinking':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Bot className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 via-violet-900/20 to-slate-900">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold text-white">AI Agent Orchestrator</h2>
          <Badge variant="outline" className="text-xs">
            <Sparkles className="w-3 h-3 mr-1" />
            Multi-Agent
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="w-4 h-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-black/40">
          <TabsTrigger value="agents" className="text-xs">
            <Users className="w-3 h-3 mr-1" />
            Agents ({agents.length})
          </TabsTrigger>
          <TabsTrigger value="workflows" className="text-xs">
            <Workflow className="w-3 h-3 mr-1" />
            Workflows ({workflows.length})
          </TabsTrigger>
          <TabsTrigger value="orchestrate" className="text-xs">
            <Zap className="w-3 h-3 mr-1" />
            Quick Start
          </TabsTrigger>
          <TabsTrigger value="communications" className="text-xs">
            <MessageSquare className="w-3 h-3 mr-1" />
            Comms ({communications.length})
          </TabsTrigger>
        </TabsList>

        {/* Agents Tab */}
        <TabsContent value="agents" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* Create Agent */}
              <Card className="bg-black/40 border-violet-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Create AI Agent</CardTitle>
                  <CardDescription className="text-xs">
                    Define a specialized AI agent with custom capabilities
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Agent Name"
                      value={newAgentName}
                      onChange={(e) => setNewAgentName(e.target.value)}
                      className="bg-black/40 border-white/20 text-white text-sm"
                    />
                    <Input
                      placeholder="Role/Specialty"
                      value={newAgentRole}
                      onChange={(e) => setNewAgentRole(e.target.value)}
                      className="bg-black/40 border-white/20 text-white text-sm"
                    />
                  </div>
                  <Textarea
                    placeholder="System prompt (optional)"
                    value={newAgentPrompt}
                    onChange={(e) => setNewAgentPrompt(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm min-h-[60px]"
                  />
                  <Button onClick={createAgent} className="w-full bg-violet-600 hover:bg-violet-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Agent
                  </Button>
                </CardContent>
              </Card>

              {/* Agent Templates */}
              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Quick Templates</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2">
                    {agentTemplates.map((template) => (
                      <button
                        key={template.name}
                        onClick={() => createAgentFromTemplate(template)}
                        className="p-3 bg-black/40 hover:bg-black/60 border border-white/10 rounded text-xs text-white transition-all"
                      >
                        <span className="text-2xl mb-1 block">{template.icon}</span>
                        <div className="font-medium">{template.name}</div>
                        <div className="text-white/60 text-xs">{template.role}</div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Agent List */}
              <div className="space-y-2">
                {agents.map((agent) => (
                  <Card
                    key={agent.id}
                    className={`bg-black/40 border cursor-pointer transition-all hover:border-violet-500/40 ${
                      selectedAgent?.id === agent.id
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-white/10'
                    }`}
                    onClick={() => setSelectedAgent(agent)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-2xl">{agent.icon}</span>
                            {getAgentStatusIcon(agent.status)}
                            <div>
                              <h3 className="font-medium text-white">{agent.name}</h3>
                              <p className="text-xs text-white/60">{agent.role}</p>
                            </div>
                            <Badge variant="outline" className="text-xs ml-auto">
                              {agent.tasksCompleted} tasks
                            </Badge>
                          </div>
                          {agent.currentTask && (
                            <div className="mb-2 p-2 bg-blue-500/20 rounded border border-blue-500/30">
                              <p className="text-xs text-blue-300">
                                <Activity className="w-3 h-3 inline mr-1" />
                                {agent.currentTask}
                              </p>
                            </div>
                          )}
                          <p className="text-xs text-white/60 mb-2">{agent.description}</p>
                          <div className="flex flex-wrap gap-1">
                            {agent.capabilities.map((cap, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {cap}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 ml-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(agent.systemPrompt);
                              toast.success('Prompt copied');
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAgent(agent.id);
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Workflows Tab */}
        <TabsContent value="workflows" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* Create Workflow */}
              <Card className="bg-black/40 border-violet-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Create Workflow</CardTitle>
                  <CardDescription className="text-xs">
                    Design multi-agent collaboration workflows
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="Workflow Name"
                    value={workflowName}
                    onChange={(e) => setWorkflowName(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm"
                  />
                  <Textarea
                    placeholder="Description"
                    value={workflowDescription}
                    onChange={(e) => setWorkflowDescription(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm min-h-[60px]"
                  />
                  <Button onClick={createWorkflow} className="w-full bg-violet-600 hover:bg-violet-700">
                    <GitBranch className="w-4 h-4 mr-2" />
                    Create Workflow
                  </Button>
                </CardContent>
              </Card>

              {/* Workflow List */}
              <div className="space-y-2">
                {workflows.map((workflow) => (
                  <Card
                    key={workflow.id}
                    className="bg-black/40 border-white/10"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-white">{workflow.name}</h3>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                workflow.status === 'running'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : workflow.status === 'completed'
                                  ? 'bg-green-500/20 text-green-400'
                                  : workflow.status === 'error'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-gray-500/20 text-gray-400'
                              }`}
                            >
                              {workflow.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-white/60 mb-2">{workflow.description}</p>
                          <div className="flex items-center gap-4 text-xs text-white/60">
                            <span>{workflow.steps.length} steps</span>
                            <span>{new Date(workflow.created).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {workflow.status === 'running' ? (
                            <Button size="sm" variant="outline" disabled>
                              <Loader2 className="w-3 h-3 animate-spin" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startOrchestration(workflow)}
                              disabled={isOrchestrating || workflow.steps.length === 0}
                            >
                              <Play className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setWorkflows(prev => prev.filter(w => w.id !== workflow.id));
                              toast.success('Workflow deleted');
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      {workflow.status === 'running' && (
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-xs text-white/60 mb-1">
                            <span>Progress</span>
                            <span>{workflow.progress}%</span>
                          </div>
                          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-violet-500 transition-all duration-300"
                              style={{ width: `${workflow.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Workflow Steps */}
                      <div className="space-y-2">
                        {workflow.steps.map((step, idx) => {
                          const agent = agents.find(a => a.id === step.agentId);
                          return (
                            <div
                              key={step.id}
                              className="flex items-center gap-2 p-2 bg-black/40 rounded border border-white/10"
                            >
                              <span className="text-xs text-white/40">{idx + 1}</span>
                              <span className="text-lg">{agent?.icon || '🤖'}</span>
                              <div className="flex-1">
                                <p className="text-xs text-white font-medium">{step.action}</p>
                                <p className="text-xs text-white/60 truncate">{step.input}</p>
                              </div>
                              {step.status === 'running' && (
                                <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                              )}
                              {step.status === 'completed' && (
                                <CheckCircle className="w-3 h-3 text-green-400" />
                              )}
                              {step.status === 'error' && (
                                <XCircle className="w-3 h-3 text-red-400" />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Add Agent to Workflow */}
                      {workflow.status === 'draft' && (
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <div className="flex gap-2 flex-wrap">
                            {agents.map((agent) => (
                              <button
                                key={agent.id}
                                onClick={() => addWorkflowStep(workflow.id, agent.id)}
                                className="px-2 py-1 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 rounded text-xs text-white transition-all"
                              >
                                <span className="mr-1">{agent.icon}</span>
                                {agent.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}

                {workflows.length === 0 && (
                  <Card className="bg-black/40 border-white/10">
                    <CardContent className="p-8 text-center">
                      <Workflow className="w-12 h-12 text-white/20 mx-auto mb-3" />
                      <p className="text-sm text-white/60">No workflows yet</p>
                      <p className="text-xs text-white/40 mt-1">Create a workflow to orchestrate agents</p>
                    </CardContent>
                  </Card>
