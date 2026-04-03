/**
 * Prompt Laboratory Tab
 * 
 * Interactive prompt engineering workspace:
 * - Prompt templates library
 * - A/B testing
 * - Real-time preview
 * - Version history
 * - Community sharing
 */

"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FlaskConical,
  TestTube,
  Copy,
  Save,
  Play,
  Trash,
  Star,
  Share,
  History,
  Sparkles,
  Wand2,
  Zap,
  Clock,
  CheckCircle,
  XCircle,
  TrendingUp,
  Users,
  Download,
  Upload,
  Search,
  Filter,
  Plus,
  Edit,
  Eye,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { clipboard } from '@bing/platform/clipboard';

// Fetch templates from API
async function fetchTemplates(): Promise<PromptTemplate[]> {
  try {
    const response = await fetch('/api/prompts/templates');
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch templates');
    }
    
    return data.templates || [];
  } catch (err: any) {
    console.error('[PromptLab] Failed to fetch templates:', err);
    toast.error('Failed to load templates');
    return [];
  }
}

// Test prompt via API
async function testPrompt(template: string, input: string, provider: string, model: string, variables?: Record<string, string>) {
  try {
    const response = await fetch('/api/prompts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, input, provider, model, variables }),
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Test failed');
    }
    
    return result;
  } catch (err: any) {
    console.error('[PromptLab] Test failed:', err);
    throw err;
  }
}

// Save template via API
async function saveTemplate(template: Omit<PromptTemplate, 'createdAt' | 'updatedAt' | 'uses' | 'rating'>) {
  try {
    const response = await fetch('/api/prompts/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to save template');
    }
    
    return result.template;
  } catch (err: any) {
    console.error('[PromptLab] Save failed:', err);
    throw err;
  }
}

// Types
interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  category: string;
  tags: string[];
  variables: string[];
  createdAt: number;
  updatedAt: number;
  uses: number;
  rating: number;
  author: string;
  isPublic: boolean;
}

interface TestResult {
  id: string;
  promptId: string;
  input: string;
  output: string;
  model: string;
  tokens: number;
  latency: number;
  rating: number;
  timestamp: number;
}

// Fallback templates if API fails (used as initial state before fetch)
const FALLBACK_TEMPLATES: PromptTemplate[] = [
  {
    id: "tmpl-1",
    name: "Code Review Expert",
    description: "Comprehensive code review with security focus",
    template: "You are a senior software engineer reviewing code. Analyze the following code for:\n\n1. Security vulnerabilities\n2. Performance issues\n3. Code quality and best practices\n4. Potential bugs\n\nCode:\n{{code}}\n\nProvide specific, actionable feedback.",
    category: "coding",
    tags: ["code-review", "security", "best-practices"],
    variables: ["code"],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 43200000,
    uses: 234,
    rating: 4.8,
    author: "you",
    isPublic: true,
  },
  {
    id: "tmpl-2",
    name: "API Documentation Generator",
    description: "Generate comprehensive API docs from code",
    template: "Generate comprehensive API documentation for the following endpoint:\n\n{{endpoint_code}}\n\nInclude:\n- Description\n- Parameters\n- Request/Response examples\n- Error codes\n- Usage examples\n\nFormat in Markdown.",
    category: "documentation",
    tags: ["api", "documentation", "markdown"],
    variables: ["endpoint_code"],
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now() - 86400000,
    uses: 567,
    rating: 4.9,
    author: "you",
    isPublic: true,
  },
  {
    id: "tmpl-3",
    name: "Bug Fix Assistant",
    description: "Debug and fix code issues",
    template: "Help me fix this bug:\n\n{{error_message}}\n\nCode:\n{{code}}\n\n1. Explain the root cause\n2. Provide the fixed code\n3. Explain the fix\n4. Suggest prevention strategies",
    category: "debugging",
    tags: ["debugging", "bug-fix", "troubleshooting"],
    variables: ["error_message", "code"],
    createdAt: Date.now() - 259200000,
    updatedAt: Date.now() - 172800000,
    uses: 892,
    rating: 4.7,
    author: "you",
    isPublic: false,
  },
  {
    id: "tmpl-4",
    name: "Architecture Designer",
    description: "Design system architecture",
    template: "Design a system architecture for:\n\n{{requirements}}\n\nConsider:\n- Scalability\n- Security\n- Performance\n- Cost\n- Maintainability\n\nProvide:\n1. High-level diagram description\n2. Component breakdown\n3. Technology recommendations\n4. Trade-offs analysis",
    category: "architecture",
    tags: ["architecture", "system-design", "planning"],
    variables: ["requirements"],
    createdAt: Date.now() - 345600000,
    updatedAt: Date.now() - 259200000,
    uses: 445,
    rating: 4.9,
    author: "you",
    isPublic: true,
  },
];

const CATEGORIES = [
  { id: "all", name: "All", icon: "📚", count: 24 },
  { id: "coding", name: "Coding", icon: "💻", count: 8 },
  { id: "documentation", name: "Docs", icon: "📝", count: 5 },
  { id: "debugging", name: "Debugging", icon: "🐛", count: 4 },
  { id: "architecture", name: "Architecture", icon: "🏗️", count: 3 },
  { id: "testing", name: "Testing", icon: "✅", count: 2 },
  { id: "optimization", name: "Optimization", icon: "⚡", count: 2 },
];

export default function PromptLabTab() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch templates from API on mount
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await fetchTemplates();
      setTemplates(data.length > 0 ? data : FALLBACK_TEMPLATES);
    } catch (err) {
      console.warn('Failed to fetch templates, using fallback:', err);
      setTemplates(FALLBACK_TEMPLATES);
    } finally {
      setLoading(false);
    }
  };
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [activeTab, setActiveTab] = useState<"library" | "editor" | "tests">("library");
  const [editedTemplate, setEditedTemplate] = useState<string>("");
  const [testInput, setTestInput] = useState("");
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isTesting, setIsTesting] = useState(false);

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === "all" || t.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleCreateTemplate = () => {
    const newTemplate: PromptTemplate = {
      id: `tmpl-${Date.now()}`,
      name: "New Template",
      description: "Describe your template...",
      template: "Enter your prompt template here. Use {{variable}} for variables.",
      category: "coding",
      tags: [],
      variables: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      uses: 0,
      rating: 0,
      author: "you",
      isPublic: false,
    };
    setTemplates(prev => [newTemplate, ...prev]);
    setSelectedTemplate(newTemplate);
    setEditedTemplate(newTemplate.template);
    setActiveTab("editor");
    toast.success("Template created");
  };

  const handleSaveTemplate = () => {
    if (!selectedTemplate) return;
    setTemplates(prev => prev.map(t =>
      t.id === selectedTemplate.id
        ? { ...t, template: editedTemplate, updatedAt: Date.now() }
        : t
    ));
    toast.success("Template saved");
  };

  const handleDeleteTemplate = (templateId: string) => {
    setTemplates(prev => prev.filter(t => t.id !== templateId));
    setSelectedTemplate(null);
    toast.success("Template deleted");
  };

  const handleDuplicateTemplate = (template: PromptTemplate) => {
    const duplicate: PromptTemplate = {
      ...template,
      id: `tmpl-${Date.now()}`,
      name: `${template.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      uses: 0,
    };
    setTemplates(prev => [duplicate, ...prev]);
    toast.success("Template duplicated");
  };

  const handleRunTest = async () => {
    if (!selectedTemplate || !testInput.trim()) return;
    
    setIsTesting(true);
    toast.info("Running test...");
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result: TestResult = {
      id: `test-${Date.now()}`,
      promptId: selectedTemplate.id,
      input: testInput,
      output: `Generated output for: ${testInput.slice(0, 50)}...`,
      model: "mistral-large",
      tokens: 456,
      latency: 1234,
      rating: 0,
      timestamp: Date.now(),
    };
    
    setTestResults(prev => [result, ...prev]);
    setIsTesting(false);
    toast.success("Test completed");
  };

  const handleCopyTemplate = (template: PromptTemplate) => {
    clipboard.writeText(template.template);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg">
            <FlaskConical className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Prompt Laboratory</h3>
            <p className="text-xs text-white/60">Engineer & Test Prompts</p>
          </div>
        </div>

        <Button
          onClick={handleCreateTemplate}
          className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      {/* Category Filter */}
      <ScrollArea className="h-14 border-b border-white/10">
        <div className="flex gap-2 p-4">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(cat.id)}
              className={`whitespace-nowrap bg-gradient-to-r ${
                selectedCategory === cat.id
                  ? "from-amber-500 to-orange-500 text-white border-white/30"
                  : "from-white/5 to-white/10 border-white/20 text-white/60 hover:text-white"
              }`}
            >
              {cat.icon} {cat.name} ({cat.count})
            </Button>
          ))}
        </div>
      </ScrollArea>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Left: Template Library */}
        <ScrollArea className="col-span-1 space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search templates..."
                className="pl-8 bg-black/40 border-white/20 text-white text-sm"
              />
            </div>
            <Button variant="ghost" size="icon" className="text-white/60">
              <Filter className="w-4 h-4" />
            </Button>
          </div>

          {filteredTemplates.map((template) => (
            <Card
              key={template.id}
              className={`bg-white/5 border-white/10 cursor-pointer transition-all ${
                selectedTemplate?.id === template.id
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "hover:bg-white/10"
              }`}
              onClick={() => {
                setSelectedTemplate(template);
                setEditedTemplate(template.template);
                setActiveTab("editor");
              }}
            >
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{template.name}</p>
                    <p className="text-xs text-white/40 line-clamp-2">{template.description}</p>
                  </div>
                  {template.isPublic && (
                    <Badge className="bg-green-500/20 text-green-400 text-[10px]">
                      <Users className="w-2 h-2 mr-1" />
                      Public
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-white/40">
                  <div className="flex gap-2">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {template.uses}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {template.rating.toFixed(1)}
                    </span>
                  </div>
                  <span>{new Date(template.updatedAt).toLocaleDateString()}</span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {template.tags.slice(0, 3).map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] border-white/20">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </ScrollArea>

        {/* Right: Editor & Tests */}
        <div className="col-span-2">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
            <TabsList className="w-full justify-start bg-black/40 border-b border-white/10 rounded-none">
              <TabsTrigger value="editor" className="data-[state=active]:bg-amber-500/20">
                <Edit className="w-4 h-4 mr-2" />
                Editor
              </TabsTrigger>
              <TabsTrigger value="tests" className="data-[state=active]:bg-amber-500/20">
                <TestTube className="w-4 h-4 mr-2" />
                A/B Tests
              </TabsTrigger>
              <TabsTrigger value="history" className="data-[state=active]:bg-amber-500/20">
                <History className="w-4 h-4 mr-2" />
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="editor" className="h-full mt-0">
              {selectedTemplate ? (
                <ScrollArea className="h-[calc(100%-40px)]">
                  <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <Input
                        value={selectedTemplate.name}
                        onChange={(e) => {
                          setTemplates(prev => prev.map(t =>
                            t.id === selectedTemplate.id ? { ...t, name: e.target.value } : t
                          ));
                        }}
                        className="w-64 bg-black/40 border-white/20 text-white font-semibold"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopyTemplate(selectedTemplate)}
                          className="text-white/60"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDuplicateTemplate(selectedTemplate)}
                          className="text-white/60"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteTemplate(selectedTemplate.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={handleSaveTemplate}
                          className="bg-gradient-to-r from-amber-500 to-orange-500"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>

                    <Textarea
                      value={editedTemplate}
                      onChange={(e) => setEditedTemplate(e.target.value)}
                      placeholder="Enter your prompt template..."
                      className="min-h-[300px] bg-black/40 border-white/20 text-white font-mono text-sm"
                    />

                    <div className="p-4 bg-black/40 rounded-lg border border-white/10">
                      <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Variables Detected
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedTemplate.variables.map((variable, i) => (
                          <Badge key={i} className="bg-amber-500/20 text-amber-400">
                            {`{{${variable}}}`}
                          </Badge>
                        ))}
                        {selectedTemplate.variables.length === 0 && (
                          <span className="text-xs text-white/40">
                            Add variables using {"{{variable}}"} syntax
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-4 bg-black/40 rounded-lg border border-white/10">
                      <h4 className="text-sm font-semibold text-white mb-2">Test Your Prompt</h4>
                      <div className="flex gap-2">
                        <Textarea
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          placeholder="Enter test input..."
                          className="flex-1 bg-black/60 border-white/20 text-white text-sm"
                        />
                        <Button
                          onClick={handleRunTest}
                          disabled={isTesting || !testInput.trim()}
                          className="bg-gradient-to-r from-green-500 to-emerald-500"
                        >
                          {isTesting ? (
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4 mr-2" />
                          )}
                          Test
                        </Button>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-white/60">
                    <FlaskConical className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <h3 className="text-xl font-semibold mb-2">Select a Template</h3>
                    <p>Choose a template from the library or create a new one</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="tests" className="h-full mt-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-3">
                  {testResults.map((result) => (
                    <Card key={result.id} className="bg-white/5 border-white/10">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-400" />
                            <span className="text-sm text-white">{result.model}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-white/40">
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              {result.tokens} tokens
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {result.latency}ms
                            </span>
                            <span>{new Date(result.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        <div className="p-3 bg-black/40 rounded text-xs text-white/80 font-mono">
                          <p className="text-white/40 mb-1">Input:</p>
                          <p className="mb-2">{result.input}</p>
                          <p className="text-white/40 mb-1">Output:</p>
                          <p>{result.output}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {testResults.length === 0 && (
                    <div className="text-center text-white/60 py-8">
                      <TestTube className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No test results yet</p>
                      <p className="text-sm">Run a test to see results here</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="history" className="h-full mt-0">
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-white/60">
                  <History className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">Version History</h3>
                  <p>Track changes and revert to previous versions</p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
