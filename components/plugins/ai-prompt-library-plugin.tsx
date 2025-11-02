"use client";

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { 
  Brain, Plus, Save, Copy, Play, Layers, Sparkles,
  Loader2, XCircle, Heart, TrendingUp, Code, FileText
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface Prompt {
  id: string;
  title: string;
  content: string;
  category: string;
  variables: string[];
  tags: string[];
  likes: number;
}

interface WorkflowStep {
  id: string;
  promptId: string;
  output: string;
}

const CATEGORIES = ['Writing', 'Coding', 'Analysis', 'Creative', 'Business', 'Research'];

const SAMPLE_PROMPTS: Prompt[] = [
  {
    id: '1',
    title: 'Code Explainer',
    content: 'Explain the following code in simple terms:\n\n{{code}}\n\nProvide a clear explanation of what it does and how it works.',
    category: 'Coding',
    variables: ['code'],
    tags: ['explanation', 'code', 'learning'],
    likes: 42
  },
  {
    id: '2',
    title: 'Blog Post Generator',
    content: 'Write a professional blog post about {{topic}}. Include:\n- Introduction\n- Main points\n- Conclusion\n\nTone: {{tone}}',
    category: 'Writing',
    variables: ['topic', 'tone'],
    tags: ['blog', 'content', 'writing'],
    likes: 38
  },
  {
    id: '3',
    title: 'Data Analysis',
    content: 'Analyze this dataset and provide insights:\n\n{{data}}\n\nFocus on trends, patterns, and actionable recommendations.',
    category: 'Analysis',
    variables: ['data'],
    tags: ['analysis', 'insights', 'data'],
    likes: 27
  }
];

export default function AIPromptLibraryPlugin({ onClose }: PluginProps) {
  const [prompts, setPrompts] = useState<Prompt[]>(SAMPLE_PROMPTS);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [newPrompt, setNewPrompt] = useState<Partial<Prompt>>({
    title: '',
    content: '',
    category: 'Writing',
    tags: []
  });
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [generating, setGenerating] = useState(false);
  const [filterCategory, setFilterCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Workflow
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [selectedModel, setSelectedModel] = useState('gpt-4');

  const extractVariables = (content: string): string[] => {
    const matches = content.match(/{{(\w+)}}/g);
    return matches ? matches.map(m => m.replace(/{{|}}/g, '')) : [];
  };

  const savePrompt = () => {
    if (!newPrompt.title || !newPrompt.content) {
      toast.error('Title and content are required');
      return;
    }

    const variables = extractVariables(newPrompt.content);
    const prompt: Prompt = {
      id: Date.now().toString(),
      title: newPrompt.title,
      content: newPrompt.content,
      category: newPrompt.category || 'Writing',
      variables,
      tags: newPrompt.tags || [],
      likes: 0
    };

    setPrompts([...prompts, prompt]);
    setNewPrompt({ title: '', content: '', category: 'Writing', tags: [] });
    setEditingPrompt(false);
    toast.success('Prompt saved');
  };

  const executePrompt = async () => {
    if (!selectedPrompt) return;

    setGenerating(true);
    try {
      let processedContent = selectedPrompt.content;
      selectedPrompt.variables.forEach(variable => {
        const value = variableValues[variable] || '';
        processedContent = processedContent.replace(new RegExp(`{{${variable}}}`, 'g'), value);
      });

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const mockResult = `[Generated response for: ${selectedPrompt.title}]\n\n${processedContent}\n\n[This is a simulated response. Connect to an LLM API for real results.]`;
      setResult(mockResult);
      toast.success('Prompt executed');
    } catch (err) {
      toast.error('Execution failed');
    } finally {
      setGenerating(false);
    }
  };

  const copyPrompt = () => {
    if (!selectedPrompt) return;
    navigator.clipboard.writeText(selectedPrompt.content);
    toast.success('Prompt copied');
  };

  const likePrompt = (id: string) => {
    setPrompts(prompts.map(p => 
      p.id === id ? { ...p, likes: p.likes + 1 } : p
    ));
  };

  const addToWorkflow = () => {
    if (!selectedPrompt) return;
    
    const step: WorkflowStep = {
      id: Date.now().toString(),
      promptId: selectedPrompt.id,
      output: result
    };
    
    setWorkflowSteps([...workflowSteps, step]);
    toast.success('Added to workflow');
  };

  const filteredPrompts = prompts.filter(p => {
    const matchesCategory = filterCategory === 'All' || p.category === filterCategory;
    const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         p.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            AI Prompt Library
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="library" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="library"><FileText className="w-4 h-4 mr-1" /> Library</TabsTrigger>
            <TabsTrigger value="create"><Plus className="w-4 h-4 mr-1" /> Create</TabsTrigger>
            <TabsTrigger value="workflow"><Layers className="w-4 h-4 mr-1" /> Workflow</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="grid grid-cols-3 gap-4 pt-4">
            <div className="space-y-3">
              <Input
                placeholder="Search prompts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Categories</SelectItem>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="space-y-2">
                {filteredPrompts.map(prompt => (
                  <Card
                    key={prompt.id}
                    className={`cursor-pointer transition ${
                      selectedPrompt?.id === prompt.id ? 'bg-blue-500/20' : 'bg-white/5 hover:bg-white/10'
                    }`}
                    onClick={() => {
                      setSelectedPrompt(prompt);
                      setVariableValues({});
                      setResult('');
                    }}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-medium text-sm">{prompt.title}</h4>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Heart className="w-3 h-3" />
                          {prompt.likes}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs">{prompt.category}</Badge>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {prompt.tags.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="col-span-2">
              {selectedPrompt ? (
                <div className="space-y-3">
                  <Card className="bg-white/5">
                    <CardHeader className="p-3">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-sm">{selectedPrompt.title}</CardTitle>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={copyPrompt}>
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => likePrompt(selectedPrompt.id)}>
                            <Heart className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3">
                      <pre className="text-xs whitespace-pre-wrap bg-black p-3 rounded">
                        {selectedPrompt.content}
                      </pre>
                    </CardContent>
                  </Card>

                  {selectedPrompt.variables.length > 0 && (
                    <Card className="bg-white/5">
                      <CardHeader className="p-3">
                        <CardTitle className="text-sm">Variables</CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 space-y-2">
                        {selectedPrompt.variables.map(variable => (
                          <div key={variable}>
                            <label className="text-xs mb-1 block">{variable}</label>
                            <Textarea
                              placeholder={`Enter ${variable}...`}
                              value={variableValues[variable] || ''}
                              onChange={(e) => setVariableValues({
                                ...variableValues,
                                [variable]: e.target.value
                              })}
                              rows={2}
                            />
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex gap-2">
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gpt-4">GPT-4</SelectItem>
                        <SelectItem value="gpt-3.5">GPT-3.5</SelectItem>
                        <SelectItem value="claude">Claude</SelectItem>
                        <SelectItem value="llama">Llama 2</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={executePrompt} disabled={generating} className="flex-1">
                      {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                      Execute
                    </Button>
                  </div>

                  {result && (
                    <Card className="bg-white/5">
                      <CardHeader className="p-3">
                        <div className="flex justify-between items-center">
                          <CardTitle className="text-sm">Result</CardTitle>
                          <Button size="sm" variant="ghost" onClick={addToWorkflow}>
                            <Layers className="w-3 h-3 mr-1" />
                            Add to Workflow
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3">
                        <pre className="text-xs whitespace-pre-wrap">{result}</pre>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Select a prompt to get started</p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="create" className="space-y-3 pt-4">
            <Input
              placeholder="Prompt Title"
              value={newPrompt.title}
              onChange={(e) => setNewPrompt({ ...newPrompt, title: e.target.value })}
            />

            <Select value={newPrompt.category} onValueChange={(v) => setNewPrompt({ ...newPrompt, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Textarea
              placeholder="Prompt content... Use {{variable}} for variables"
              value={newPrompt.content}
              onChange={(e) => setNewPrompt({ ...newPrompt, content: e.target.value })}
              rows={12}
            />

            <Card className="bg-white/5">
              <CardContent className="p-3 text-xs text-gray-400">
                <p>💡 Tip: Use {{'{'}}{'{'}variable{'}'}{'}'}  syntax to create reusable variables</p>
                <p className="mt-1">Example: "Explain {{'{'}}{'{'}concept{'}'}{'}'}} in simple terms"</p>
              </CardContent>
            </Card>

            <Button onClick={savePrompt} className="w-full">
              <Save className="w-4 h-4 mr-2" />
              Save Prompt
            </Button>
          </TabsContent>

          <TabsContent value="workflow" className="space-y-3 pt-4">
            <Card className="bg-white/5">
              <CardHeader className="p-3">
                <CardTitle className="text-sm">Workflow Steps</CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                {workflowSteps.length === 0 ? (
                  <div className="text-center text-gray-400 py-8">
                    <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No workflow steps yet</p>
                    <p className="text-xs mt-2">Execute prompts and add them to build a workflow</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {workflowSteps.map((step, index) => {
                      const prompt = prompts.find(p => p.id === step.promptId);
                      return (
                        <Card key={step.id} className="bg-black">
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline">{index + 1}</Badge>
                              <span className="text-sm font-medium">{prompt?.title}</span>
                            </div>
                            <pre className="text-xs text-gray-400 whitespace-pre-wrap">
                              {step.output.slice(0, 200)}...
                            </pre>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
}
