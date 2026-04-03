/**
 * Code Playground Tab
 * 
 * Live code execution environment with:
 * - Multi-language support
 * - Real-time preview
 * - Console output
 * - Code templates
 * - Share snippets
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Code,
  Play,
  Download,
  Share,
  Copy,
  Save,
  Trash,
  FileCode,
  Terminal,
  Eye,
  Settings,
  Plus,
  Edit,
  CheckCircle,
  AlertCircle,
  Clock,
  Zap,
  Layers,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { clipboard } from '@bing/platform/clipboard';

// Types
interface CodeSnippet {
  id: string;
  name: string;
  language: string;
  code: string;
  output?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  likes: number;
}

interface CodeTemplate {
  id: string;
  name: string;
  language: string;
  code: string;
  description: string;
  category: string;
}

const LANGUAGES = [
  { id: "javascript", name: "JavaScript", icon: "🟨" },
  { id: "typescript", name: "TypeScript", icon: "🟦" },
  { id: "python", name: "Python", icon: "🐍" },
  { id: "html", name: "HTML", icon: "📄" },
  { id: "css", name: "CSS", icon: "🎨" },
  { id: "sql", name: "SQL", icon: "🗄️" },
  { id: "bash", name: "Bash", icon: "💻" },
];

const TEMPLATES: CodeTemplate[] = [
  {
    id: "tmpl-1",
    name: "Hello World",
    language: "javascript",
    code: `console.log("Hello, World!");\n\n// Your code here`,
    description: "Basic Hello World example",
    category: "beginner",
  },
  {
    id: "tmpl-2",
    name: "Fetch API",
    language: "javascript",
    code: `async function fetchData() {\n  try {\n    const response = await fetch('https://api.example.com/data');\n    const data = await response.json();\n    console.log(data);\n  } catch (error) {\n    console.error('Error:', error);\n  }\n}\n\nfetchData();`,
    description: "API request example",
    category: "intermediate",
  },
  {
    id: "tmpl-3",
    name: "React Component",
    language: "typescript",
    code: `import React, { useState } from 'react';\n\ninterface Props {\n  title: string;\n}\n\nexport const Counter: React.FC<Props> = ({ title }) => {\n  const [count, setCount] = useState(0);\n\n  return (\n    <div>\n      <h1>{title}</h1>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(count + 1)}>\n        Increment\n      </button>\n    </div>\n  );\n};`,
    description: "React component with state",
    category: "intermediate",
  },
  {
    id: "tmpl-4",
    name: "Python Data Analysis",
    language: "python",
    code: `import pandas as pd\nimport numpy as np\n\n# Create sample data\ndata = {\n    'name': ['Alice', 'Bob', 'Charlie'],\n    'age': [25, 30, 35],\n    'score': [85, 90, 95]\n}\n\ndf = pd.DataFrame(data)\nprint(df)\nprint(f"\\nAverage age: {df['age'].mean()}")\nprint(f"Top scorer: {df.loc[df['score'].idxmax(), 'name']}")`,
    description: "Data analysis with pandas",
    category: "advanced",
  },
];

// Execute code via API
async function executeCode(code: string, language: string, timeout?: number): Promise<{
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
}> {
  try {
    const response = await fetch('/api/code/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language,
        timeout,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Execution failed');
    }

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      executionTime: result.executionTime,
    };
  } catch (err: any) {
    console.error('[CodePlayground] Failed to execute code:', err);
    throw err;
  }
}

// Get code template from API
async function getCodeTemplate(language: string): Promise<string> {
  try {
    const response = await fetch(`/api/code/execute?language=${language}`);
    const data = await response.json();

    if (data.success) {
      return data.template;
    }

    return '';
  } catch (err) {
    console.error('[CodePlayground] Failed to get template:', err);
    return '';
  }
}

// Fallback snippets when API is unavailable
const FALLBACK_SNIPPETS: CodeSnippet[] = [];

export default function CodePlaygroundTab() {
  const [snippets, setSnippets] = useState<CodeSnippet[]>(FALLBACK_SNIPPETS);
  const [loading, setLoading] = useState(true);

  // Fetch snippets from API on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/code/snippets?type=all');
        const data = await response.json();
        if (data.success && data.snippets) {
          setSnippets(data.snippets);
        }
      } catch (err) {
        console.warn('Failed to fetch snippets, using fallback:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);
  const [selectedSnippet, setSelectedSnippet] = useState<CodeSnippet | null>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"editor" | "templates" | "snippets">("editor");
  const [consoleOpen, setConsoleOpen] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleRun = async () => {
    if (!code.trim()) {
      toast.error("Please enter some code");
      return;
    }

    setIsRunning(true);
    setError("");
    setOutput("");

    try {
      // Execute code via API
      const result = await executeCode(code, language, 10000);

      if (!isMountedRef.current) return;

      if (result.success) {
        setOutput(result.output);
        toast.success(`Executed in ${result.executionTime}ms`);
      } else {
        setError(result.error || 'Execution failed');
        toast.error("Execution failed");
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      
      setError(err.message);
      toast.error(err.message || "Execution failed");
    } finally {
      setIsRunning(false);
    }
  };

  const handleSave = () => {
    if (!code.trim()) {
      toast.error("No code to save");
      return;
    }

    const newSnippet: CodeSnippet = {
      id: `snippet-${Date.now()}`,
      name: `Snippet ${snippets.length + 1}`,
      language,
      code,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: false,
      likes: 0,
    };

    setSnippets(prev => [newSnippet, ...prev]);
    setSelectedSnippet(newSnippet);
    toast.success("Snippet saved");
  };

  const handleLoadTemplate = async (template: CodeTemplate) => {
    try {
      // Load template from API
      const templateCode = await getCodeTemplate(template.language);
      
      setCode(templateCode || template.code);
      setLanguage(template.language);
      setActiveTab("editor");
      toast.success(`Loaded ${template.name} template`);
    } catch (err: any) {
      // Fallback to local template
      setCode(template.code);
      setLanguage(template.language);
      setActiveTab("editor");
      toast.success(`Loaded ${template.name} template (offline)`);
    }
  };

  const handleCopyCode = () => {
    clipboard.writeText(code);
    toast.success("Copied to clipboard");
  };

  const handleClear = () => {
    setCode("");
    setOutput("");
    setError("");
    toast.success("Editor cleared");
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-green-500/10 to-emerald-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg">
            <Code className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Code Playground</h3>
            <p className="text-xs text-white/60">Live Code Execution</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopyCode}
            className="text-white/60 hover:text-white"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConsoleOpen(!consoleOpen)}
            className={consoleOpen ? "text-green-400" : "text-white/60"}
          >
            <Terminal className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-2">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="w-full justify-start bg-black/40 border-b border-white/10 rounded-none">
            <TabsTrigger value="editor" className="data-[state=active]:bg-green-500/20">
              <Edit className="w-4 h-4 mr-2" />
              Editor
            </TabsTrigger>
            <TabsTrigger value="templates" className="data-[state=active]:bg-green-500/20">
              <Layers className="w-4 h-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="snippets" className="data-[state=active]:bg-green-500/20">
              <FileCode className="w-4 h-4 mr-2" />
              My Snippets
            </TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="h-[calc(100%-80px)] mt-0">
            <div className="h-full grid" style={{ gridTemplateRows: consoleOpen ? "1fr 200px" : "1fr" }}>
              {/* Editor */}
              <div className="flex flex-col border-b border-white/10">
                {/* Toolbar */}
                <div className="flex items-center justify-between p-2 border-b border-white/10 bg-black/20">
                  <div className="flex items-center gap-2">
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="bg-black/40 border border-white/20 rounded text-white text-sm px-2 py-1"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.id} value={lang.id}>
                          {lang.icon} {lang.name}
                        </option>
                      ))}
                    </select>
                    <Badge variant="outline" className="text-[10px] border-white/20">
                      {selectedSnippet ? "Editing" : "New Snippet"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClear}
                      className="text-white/60 hover:text-white"
                    >
                      <Trash className="w-3 h-3 mr-2" />
                      Clear
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSave}
                      className="border-white/20"
                    >
                      <Save className="w-3 h-3 mr-2" />
                      Save
                    </Button>
                    <Button
                      onClick={handleRun}
                      disabled={isRunning || !code.trim()}
                      className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
                    >
                      {isRunning ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Run
                    </Button>
                  </div>
                </div>

                {/* Code Editor */}
                <ScrollArea className="flex-1">
                  <Textarea
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={`// Write your ${language} code here...\n// Press Run to execute`}
                    className="w-full h-full min-h-[300px] bg-black/40 border-0 text-white font-mono text-sm resize-none focus:ring-0"
                  />
                </ScrollArea>
              </div>

              {/* Console Output */}
              {consoleOpen && (
                <ScrollArea className="border-t border-white/10 bg-black/60">
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                        <Terminal className="w-3 h-3" />
                        Console Output
                      </h4>
                      <div className="flex items-center gap-2">
                        {error && (
                          <Badge className="bg-red-500/20 text-red-400 text-[10px]">
                            <AlertCircle className="w-2 h-2 mr-1" />
                            Error
                          </Badge>
                        )}
                        {output && (
                          <Badge className="bg-green-500/20 text-green-400 text-[10px]">
                            <CheckCircle className="w-2 h-2 mr-1" />
                            Success
                          </Badge>
                        )}
                      </div>
                    </div>
                    {error ? (
                      <pre className="text-xs text-red-400 font-mono whitespace-pre-wrap">{error}</pre>
                    ) : output ? (
                      <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{output}</pre>
                    ) : (
                      <p className="text-xs text-white/40">Output will appear here...</p>
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </TabsContent>

          <TabsContent value="templates" className="h-[calc(100%-80px)] mt-0">
            <ScrollArea className="h-full">
              <div className="p-4 grid grid-cols-2 gap-4">
                {TEMPLATES.map((template) => (
                  <Card
                    key={template.id}
                    className="bg-white/5 border-white/10 cursor-pointer hover:bg-white/10 transition-all"
                    onClick={() => handleLoadTemplate(template)}
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-white">{template.name}</h4>
                        <Badge className="bg-green-500/20 text-green-400 text-[10px]">
                          {LANGUAGES.find(l => l.id === template.language)?.icon}
                        </Badge>
                      </div>
                      <p className="text-xs text-white/40">{template.description}</p>
                      <div className="flex items-center justify-between text-[10px] text-white/40">
                        <span className="capitalize">{template.category}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLoadTemplate(template);
                          }}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Load
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="snippets" className="h-[calc(100%-80px)] mt-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-white">Saved Snippets</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCode("");
                      setLanguage("javascript");
                      setSelectedSnippet(null);
                      setActiveTab("editor");
                    }}
                  >
                    <Plus className="w-3 h-3 mr-2" />
                    New
                  </Button>
                </div>

                {snippets.map((snippet) => (
                  <Card
                    key={snippet.id}
                    className="bg-white/5 border-white/10 cursor-pointer hover:bg-white/10 transition-all"
                    onClick={() => {
                      setCode(snippet.code);
                      setLanguage(snippet.language);
                      setSelectedSnippet(snippet);
                      setActiveTab("editor");
                    }}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileCode className="w-4 h-4 text-green-400" />
                          <p className="text-sm font-medium text-white">{snippet.name}</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-white/40">
                          <span>{LANGUAGES.find(l => l.id === snippet.language)?.name}</span>
                          <span>{new Date(snippet.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <pre className="text-xs text-white/60 font-mono bg-black/40 p-2 rounded line-clamp-3">
                        {snippet.code}
                      </pre>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
