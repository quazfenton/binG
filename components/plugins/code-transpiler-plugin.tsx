"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Code2, ArrowRight, Copy, Download, Trash2, RefreshCw,
  Loader2, CheckCircle, Sparkles, History, BookOpen,
  Zap, FileCode, Settings, Eye, AlertCircle, Play,
  GitCompare, Layers, Search, Star, HelpCircle
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface Language {
  id: string;
  name: string;
  icon: string;
  extensions: string[];
  color: string;
}

interface TranslationHistory {
  id: string;
  timestamp: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceCode: string;
  targetCode: string;
  explanation?: string;
}

interface CodeSnippet {
  id: string;
  name: string;
  description: string;
  language: string;
  code: string;
  category: string;
}

const CodeTranspilerPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const languages: Language[] = [
    { id: 'javascript', name: 'JavaScript', icon: '🟨', extensions: ['.js', '.jsx'], color: 'text-yellow-400' },
    { id: 'typescript', name: 'TypeScript', icon: '🔷', extensions: ['.ts', '.tsx'], color: 'text-blue-400' },
    { id: 'python', name: 'Python', icon: '🐍', extensions: ['.py'], color: 'text-green-400' },
    { id: 'java', name: 'Java', icon: '☕', extensions: ['.java'], color: 'text-red-400' },
    { id: 'csharp', name: 'C#', icon: '🎯', extensions: ['.cs'], color: 'text-purple-400' },
    { id: 'go', name: 'Go', icon: '🐹', extensions: ['.go'], color: 'text-cyan-400' },
    { id: 'rust', name: 'Rust', icon: '🦀', extensions: ['.rs'], color: 'text-orange-400' },
    { id: 'php', name: 'PHP', icon: '🐘', extensions: ['.php'], color: 'text-indigo-400' },
    { id: 'ruby', name: 'Ruby', icon: '💎', extensions: ['.rb'], color: 'text-red-500' },
    { id: 'swift', name: 'Swift', icon: '🔶', extensions: ['.swift'], color: 'text-orange-500' },
    { id: 'kotlin', name: 'Kotlin', icon: '🟣', extensions: ['.kt'], color: 'text-purple-500' },
    { id: 'cpp', name: 'C++', icon: '⚙️', extensions: ['.cpp', '.hpp'], color: 'text-blue-500' }
  ];

  const [sourceLanguage, setSourceLanguage] = useState<Language>(languages[0]);
  const [targetLanguage, setTargetLanguage] = useState<Language>(languages[2]);
  const [sourceCode, setSourceCode] = useState('// Enter your code here\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("World"));');
  const [targetCode, setTargetCode] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationHistory, setTranslationHistory] = useState<TranslationHistory[]>([]);
  const [activeTab, setActiveTab] = useState('transpiler');
  const [explanation, setExplanation] = useState('');
  const [showExplanation, setShowExplanation] = useState(true);
  const [preserveComments, setPreserveComments] = useState(true);
  const [optimizeCode, setOptimizeCode] = useState(false);
  const [addTypeAnnotations, setAddTypeAnnotations] = useState(false);

  const codeSnippets: CodeSnippet[] = [
    {
      id: '1',
      name: 'Hello World',
      description: 'Basic hello world function',
      language: 'javascript',
      code: 'function hello() {\n  console.log("Hello, World!");\n}\nhello();',
      category: 'basic'
    },
    {
      id: '2',
      name: 'Array Map',
      description: 'Transform array with map',
      language: 'javascript',
      code: 'const numbers = [1, 2, 3, 4, 5];\nconst doubled = numbers.map(n => n * 2);\nconsole.log(doubled);',
      category: 'array'
    },
    {
      id: '3',
      name: 'Async/Await',
      description: 'Async function example',
      language: 'javascript',
      code: 'async function fetchData(url) {\n  try {\n    const response = await fetch(url);\n    const data = await response.json();\n    return data;\n  } catch (error) {\n    console.error("Error:", error);\n  }\n}',
      category: 'async'
    },
    {
      id: '4',
      name: 'Class Definition',
      description: 'ES6 class example',
      language: 'javascript',
      code: 'class Person {\n  constructor(name, age) {\n    this.name = name;\n    this.age = age;\n  }\n\n  greet() {\n    return `Hi, I\'m ${this.name}`;\n  }\n}',
      category: 'oop'
    },
    {
      id: '5',
      name: 'REST API Handler',
      description: 'Express route handler',
      language: 'javascript',
      code: 'app.get("/api/users/:id", async (req, res) => {\n  try {\n    const user = await User.findById(req.params.id);\n    res.json(user);\n  } catch (err) {\n    res.status(500).json({ error: err.message });\n  }\n});',
      category: 'api'
    }
  ];

  const mockTranslate = (source: string, fromLang: Language, toLang: Language): string => {
    // Mock translation logic - in production this would call an AI service
    const translations: Record<string, Record<string, string>> = {
      javascript: {
        python: source
          .replace(/function\s+(\w+)/g, 'def $1')
          .replace(/const\s+/g, '')
          .replace(/let\s+/g, '')
          .replace(/console\.log/g, 'print')
          .replace(/=>/g, ':')
          .replace(/\{/g, ':')
          .replace(/\}/g, '')
          .replace(/;/g, '')
          .replace(/`([^`]*)`/g, 'f"$1"')
          .replace(/\$\{(\w+)\}/g, '{$1}'),
        java: source
          .replace(/function\s+(\w+)/g, 'public static void $1')
          .replace(/const\s+/g, 'final ')
          .replace(/let\s+/g, '')
          .replace(/console\.log/g, 'System.out.println')
          .replace(/=>/g, '->'),
        go: source
          .replace(/function\s+(\w+)/g, 'func $1')
          .replace(/const\s+/g, '')
          .replace(/let\s+/g, '')
          .replace(/console\.log/g, 'fmt.Println')
          .replace(/=>/g, 'func'),
      }
    };

    const langMap = translations[fromLang.id]?.[toLang.id];
    if (langMap) {
      return langMap;
    }

    // Generic transformation
    return `// Translated from ${fromLang.name} to ${toLang.name}\n// Note: This is a mock translation\n\n${source}`;
  };

  const mockExplanation = (fromLang: Language, toLang: Language): string => {
    return `Translation from ${fromLang.name} to ${toLang.name}:

Key differences:
• Syntax: ${toLang.name} uses different syntax conventions
• Type System: ${toLang.name === 'TypeScript' ? 'Static typing with type annotations' : toLang.name === 'Python' ? 'Dynamic typing with optional hints' : 'Language-specific type system'}
• Memory Management: ${toLang.name === 'Rust' ? 'Ownership and borrowing system' : toLang.name === 'Go' ? 'Garbage collection with goroutines' : 'Standard garbage collection'}
• Async Handling: ${toLang.name === 'JavaScript' ? 'Promises and async/await' : toLang.name === 'Python' ? 'asyncio and coroutines' : 'Language-specific concurrency model'}

Considerations:
- Function declarations follow ${toLang.name} conventions
- Variable declarations adjusted for ${toLang.name} scope rules
- Built-in functions replaced with ${toLang.name} equivalents
- Comments and structure preserved where possible`;
  };

  const translateCode = async () => {
    if (!sourceCode.trim()) {
      toast.error('Please enter source code');
      return;
    }

    if (sourceLanguage.id === targetLanguage.id) {
      toast.error('Source and target languages must be different');
      return;
    }

    setIsTranslating(true);
    setExplanation('');

    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1500));

    const translated = mockTranslate(sourceCode, sourceLanguage, targetLanguage);
    const explain = mockExplanation(sourceLanguage, targetLanguage);

    setTargetCode(translated);
    setExplanation(explain);

    // Add to history
    const historyEntry: TranslationHistory = {
      id: `trans-${Date.now()}`,
      timestamp: new Date().toISOString(),
      sourceLanguage: sourceLanguage.name,
      targetLanguage: targetLanguage.name,
      sourceCode,
      targetCode: translated,
      explanation: explain
    };

    setTranslationHistory(prev => [historyEntry, ...prev].slice(0, 50));
    setIsTranslating(false);

    toast.success(`Translated to ${targetLanguage.name}`);
    onResult?.(historyEntry);
  };

  const swapLanguages = () => {
    const temp = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(temp);
    setSourceCode(targetCode);
    setTargetCode(sourceCode);
    toast.info('Languages swapped');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const downloadCode = (code: string, language: Language) => {
    const extension = language.extensions[0];
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated-code${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Code downloaded');
  };

  const loadSnippet = (snippet: CodeSnippet) => {
    const lang = languages.find(l => l.id === snippet.language);
    if (lang) {
      setSourceLanguage(lang);
      setSourceCode(snippet.code);
      setActiveTab('transpiler');
      toast.success(`Loaded: ${snippet.name}`);
    }
  };

  const loadFromHistory = (entry: TranslationHistory) => {
    const srcLang = languages.find(l => l.name === entry.sourceLanguage);
    const tgtLang = languages.find(l => l.name === entry.targetLanguage);

    if (srcLang && tgtLang) {
      setSourceLanguage(srcLang);
      setTargetLanguage(tgtLang);
      setSourceCode(entry.sourceCode);
      setTargetCode(entry.targetCode);
      setExplanation(entry.explanation || '');
      setActiveTab('transpiler');
      toast.success('Loaded from history');
    }
  };

  const clearHistory = () => {
    setTranslationHistory([]);
    toast.success('History cleared');
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 via-cyan-900/20 to-slate-900">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">Code Transpiler</h2>
          <Badge variant="outline" className="text-xs">
            <Sparkles className="w-3 h-3 mr-1" />
            AI-Powered
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <CheckCircle className="w-4 h-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-black/40">
          <TabsTrigger value="transpiler" className="text-xs">
            <GitCompare className="w-3 h-3 mr-1" />
            Transpiler
          </TabsTrigger>
          <TabsTrigger value="snippets" className="text-xs">
            <BookOpen className="w-3 h-3 mr-1" />
            Snippets
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            <History className="w-3 h-3 mr-1" />
            History ({translationHistory.length})
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-xs">
            <Settings className="w-3 h-3 mr-1" />
            Options
          </TabsTrigger>
        </TabsList>

        {/* Transpiler Tab */}
        <TabsContent value="transpiler" className="flex-1 p-4 overflow-hidden">
          <div className="h-full flex flex-col gap-4">
            {/* Language Selection */}
            <Card className="bg-black/40 border-cyan-500/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-center gap-4">
                  <select
                    value={sourceLanguage.id}
                    onChange={(e) => {
                      const lang = languages.find(l => l.id === e.target.value);
                      if (lang) setSourceLanguage(lang);
                    }}
                    className="flex-1 bg-black/40 border border-white/20 rounded-md px-4 py-2 text-white"
                  >
                    {languages.map(lang => (
                      <option key={lang.id} value={lang.id}>
                        {lang.icon} {lang.name}
                      </option>
                    ))}
                  </select>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={swapLanguages}
                    className="border-cyan-500/30 hover:bg-cyan-500/20"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>

                  <select
                    value={targetLanguage.id}
                    onChange={(e) => {
                      const lang = languages.find(l => l.id === e.target.value);
                      if (lang) setTargetLanguage(lang);
                    }}
                    className="flex-1 bg-black/40 border border-white/20 rounded-md px-4 py-2 text-white"
                  >
                    {languages.map(lang => (
                      <option key={lang.id} value={lang.id}>
                        {lang.icon} {lang.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 text-center">
                  <Button
                    onClick={translateCode}
                    disabled={isTranslating}
                    className="bg-cyan-600 hover:bg-cyan-700 px-8"
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Translating...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Translate Code
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Code Editors */}
            <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden">
              {/* Source Code */}
              <Card className="bg-black/40 border-white/10 flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <span className="text-xl">{sourceLanguage.icon}</span>
                      {sourceLanguage.name}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(sourceCode)}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSourceCode('')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden">
                  <Textarea
                    value={sourceCode}
                    onChange={(e) => setSourceCode(e.target.value)}
                    className="h-full bg-black/40 border-white/20 text-white font-mono text-sm resize-none"
                    placeholder="Enter source code..."
                  />
                </CardContent>
              </Card>

              {/* Target Code */}
              <Card className="bg-black/40 border-white/10 flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <span className="text-xl">{targetLanguage.icon}</span>
                      {targetLanguage.name}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(targetCode)}
                        disabled={!targetCode}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadCode(targetCode, targetLanguage)}
                        disabled={!targetCode}
                      >
                        <Download className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden">
                  {targetCode ? (
                    <ScrollArea className="h-full">
                      <pre className="bg-black/40 p-3 rounded text-sm text-white font-mono whitespace-pre-wrap">
                        {targetCode}
                      </pre>
                    </ScrollArea>
                  ) : (
                    <div className="h-full flex items-center justify-center text-white/40 text-sm">
                      <div className="text-center">
                        <ArrowRight className="w-12 h-12 mx-auto mb-2" />
                        <p>Translated code will appear here</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Explanation */}
            {showExplanation && explanation && (
              <Card className="bg-black/40 border-cyan-500/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-yellow-400" />
                      AI Explanation
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowExplanation(false)}
                    >
                      <Eye className="w-3 h-3" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs text-white/80 whitespace-pre-wrap">
                    {explanation}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Snippets Tab */}
        <TabsContent value="snippets" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              <Card className="bg-black/40 border-cyan-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Code Snippets Library</CardTitle>
                  <CardDescription className="text-xs">
                    Click any snippet to load it for translation
                  </CardDescription>
                </CardHeader>
              </Card>

              <div className="space-y-2">
                {codeSnippets.map((snippet) => {
                  const lang = languages.find(l => l.id === snippet.language);
                  return (
                    <Card
                      key={snippet.id}
                      className="bg-black/40 border-white/10 cursor-pointer hover:border-cyan-500/40 transition-all"
                      onClick={() => loadSnippet(snippet)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{lang?.icon}</span>
                            <div>
                              <h4 className="font-medium text-white text-sm">{snippet.name}</h4>
                              <p className="text-xs text-white/60">{snippet.description}</p>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">{snippet.category}</Badge>
                        </div>
                        <pre className="bg-black/40 p-2 rounded text-xs text-white/80 overflow-x-auto font-mono">
                          {snippet.code.substring(0, 100)}{snippet.code.length > 100 ? '...' : ''}
                        </pre>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Card className="flex-1 bg-black/40 border-cyan-500/20 mr-4">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-white">Translation History</CardTitle>
                  </CardHeader>
                </Card>
                {translationHistory.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearHistory}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {translationHistory.length > 0 ? (
                  translationHistory.map((entry) => (
                    <Card
                      key={entry.id}
                      className="bg-black/40 border-white/10 cursor-pointer hover:border-cyan-500/40 transition-all"
                      onClick={() => loadFromHistory(entry)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{entry.sourceLanguage}</Badge>
                            <ArrowRight className="w-3 h-3 text-white/40" />
                            <Badge variant="outline" className="text-xs">{entry.targetLanguage}</Badge>
                          </div>
                          <span className="text-xs text-white/60">
                            {new Date(entry.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <pre className="bg-black/40 p-2 rounded text-xs text-white/60 overflow-hidden font-mono">
                            {entry.sourceCode.substring(0, 80)}...
                          </pre>
                          <pre className="bg-black/40 p-2 rounded text-xs text-cyan-300 overflow-hidden font-mono">
                            {entry.targetCode.substring(0, 80)}...
                          </pre>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <Card className="bg-black/40 border-white/10">
                    <CardContent className="p-8 text-center">
                      <History className="w-12 h-12 text-white/20 mx-auto mb-3" />
                      <p className="text-sm text-white/60">No translation history</p>
                      <p className="text-xs text-white/40 mt-1">Translations will appear here</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              <Card className="bg-black/40 border-cyan-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Translation Options</CardTitle>
                  <CardDescription className="text-xs">
                    Configure how code is translated
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-sm text-white font-medium">Preserve Comments</p>
                      <p className="text-xs text-white/60">Keep comments in translated code</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={preserveComments}
                      onChange={(e) => setPreserveComments(e.target.checked)}
                      className="w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-sm text-white font-medium">Optimize Code</p>
                      <p className="text-xs text-white/60">Apply optimizations during translation</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={optimizeCode}
                      onChange={(e) => setOptimizeCode(e.target.checked)}
                      className="w-4 h-4"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-sm text-white font-medium">Add Type Annotations</p>
                      <p className="text-xs text-white/60">Include type hints when possible</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={addTypeAnnotations}
                      onChange={(e) => setAddTypeAnnotations(e.target.checked)}
                      className="w-4 h-4"
                    />
                  </label>
                </CardContent>
              </Card>

              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                    About
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-xs text-white/60">
                    <p>
                      The Code Transpiler uses AI to intelligently convert code between programming languages,
                      preserving logic and structure while adapting to language-specific conventions.
                    </p>
                    <p className="pt-2">
                      <strong className="text-white">Supported Languages:</strong> JavaScript, TypeScript,
                      Python, Java, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, C++
                    </p>
                    <p className="pt-2">
                      <strong className="text-white">Features:</strong>
                    </p>
                    <ul className="list-disc list-inside pl-2 space-y-1">
                      <li>Syntax conversion</li>
                      <li>Framework adaptation</li>
                      <li>Type system translation</li>
                      <li>Idiomatic code generation</li>
                      <li>Comment preservation</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>
