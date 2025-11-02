"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { 
  Play, Square, Download, Upload, Code, Terminal, FileCode,
  Loader2, XCircle, CheckCircle, AlertCircle, Copy, Share2,
  Settings, Package, Zap
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

const LANGUAGES = [
  { id: 'javascript', name: 'JavaScript', ext: 'js', mode: 'javascript' },
  { id: 'typescript', name: 'TypeScript', ext: 'ts', mode: 'typescript' },
  { id: 'python', name: 'Python', ext: 'py', mode: 'python' },
  { id: 'rust', name: 'Rust', ext: 'rs', mode: 'rust' },
  { id: 'go', name: 'Go', ext: 'go', mode: 'go' },
  { id: 'java', name: 'Java', ext: 'java', mode: 'java' },
  { id: 'cpp', name: 'C++', ext: 'cpp', mode: 'cpp' },
  { id: 'c', name: 'C', ext: 'c', mode: 'c' },
  { id: 'ruby', name: 'Ruby', ext: 'rb', mode: 'ruby' },
  { id: 'php', name: 'PHP', ext: 'php', mode: 'php' }
];

const TEMPLATES = {
  javascript: `// JavaScript Sandbox
console.log("Hello, World!");

// Your code here
const sum = (a, b) => a + b;
console.log("2 + 3 =", sum(2, 3));`,
  
  python: `# Python Sandbox
print("Hello, World!")

# Your code here
def sum(a, b):
    return a + b

print("2 + 3 =", sum(2, 3))`,
  
  rust: `// Rust Sandbox
fn main() {
    println!("Hello, World!");
    
    // Your code here
    let result = sum(2, 3);
    println!("2 + 3 = {}", result);
}

fn sum(a: i32, b: i32) -> i32 {
    a + b
}`,
  
  go: `// Go Sandbox
package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
    
    // Your code here
    result := sum(2, 3)
    fmt.Printf("2 + 3 = %d\\n", result)
}

func sum(a, b int) int {
    return a + b
}`
};

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

export default function CodeSandboxPlugin({ onClose }: PluginProps) {
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState(TEMPLATES.javascript);
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [executionTime, setExecutionTime] = useState(0);
  const [packages, setPackages] = useState<string[]>([]);
  const [newPackage, setNewPackage] = useState('');
  const [installingPackage, setInstallingPackage] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const template = TEMPLATES[language as keyof typeof TEMPLATES] || '';
    setCode(template);
    setOutput('');
  }, [language]);

  const runCode = async () => {
    setIsRunning(true);
    setOutput('Running...\n');
    const startTime = Date.now();

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          code,
          packages
        })
      });

      const data: ExecutionResult = await res.json();
      const time = Date.now() - startTime;
      setExecutionTime(time);

      let result = '';
      if (data.stdout) result += data.stdout;
      if (data.stderr) result += '\n[STDERR]\n' + data.stderr;
      result += `\n\n--- Execution completed in ${time}ms ---`;
      if (data.exitCode !== 0) result += `\nExit code: ${data.exitCode}`;

      setOutput(result);
      
      if (data.exitCode === 0) {
        toast.success('Code executed successfully');
      } else {
        toast.error('Execution failed');
      }
    } catch (err: any) {
      setOutput(`Error: ${err.message}`);
      toast.error('Execution error');
    } finally {
      setIsRunning(false);
    }
  };

  const installPackage = async () => {
    if (!newPackage) return;
    setInstallingPackage(true);
    try {
      // Simulate package install
      await new Promise(resolve => setTimeout(resolve, 1000));
      setPackages([...packages, newPackage]);
      setNewPackage('');
      toast.success(`Installed ${newPackage}`);
    } catch (err) {
      toast.error('Failed to install package');
    } finally {
      setInstallingPackage(false);
    }
  };

  const removePackage = (pkg: string) => {
    setPackages(packages.filter(p => p !== pkg));
    toast.success(`Removed ${pkg}`);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    toast.success('Code copied to clipboard');
  };

  const shareCode = () => {
    const url = `${window.location.origin}/sandbox?lang=${language}&code=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(url);
    toast.success('Share link copied!');
  };

  const downloadCode = () => {
    const lang = LANGUAGES.find(l => l.id === language);
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${lang?.ext || 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textareaRef.current?.selectionStart || 0;
      const end = textareaRef.current?.selectionEnd || 0;
      const newCode = code.substring(0, start) + '  ' + code.substring(end);
      setCode(newCode);
      setTimeout(() => {
        textareaRef.current?.setSelectionRange(start + 2, start + 2);
      }, 0);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      runCode();
    }
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Code className="w-5 h-5 text-green-400" />
            Live Code Sandbox
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-4 h-full">
          {/* Editor Panel */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(lang => (
                    <SelectItem key={lang.id} value={lang.id}>{lang.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button onClick={runCode} disabled={isRunning} className="flex-1">
                {isRunning ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Run (Ctrl+Enter)
              </Button>

              <Button variant="outline" size="icon" onClick={copyCode}>
                <Copy className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={shareCode}>
                <Share2 className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={downloadCode}>
                <Download className="w-4 h-4" />
              </Button>
            </div>

            <Card className="flex-1 bg-black border-white/10">
              <CardContent className="p-0 h-full">
                <textarea
                  ref={textareaRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full h-full bg-transparent text-white font-mono text-sm p-4 resize-none focus:outline-none"
                  placeholder="Write your code here..."
                  spellCheck={false}
                />
              </CardContent>
            </Card>

            {/* Packages */}
            <Card className="bg-white/5">
              <CardHeader className="p-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Packages
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPackage}
                    onChange={(e) => setNewPackage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && installPackage()}
                    placeholder="lodash, axios, etc."
                    className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-sm"
                  />
                  <Button size="sm" onClick={installPackage} disabled={installingPackage}>
                    {installingPackage ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Install'}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {packages.map(pkg => (
                    <div key={pkg} className="flex items-center gap-1 bg-black px-2 py-1 rounded text-xs">
                      <span>{pkg}</span>
                      <button onClick={() => removePackage(pkg)} className="hover:text-red-400">
                        <XCircle className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Output Panel */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                Output
              </h3>
              {executionTime > 0 && (
                <span className="text-xs text-gray-400">
                  Executed in {executionTime}ms
                </span>
              )}
            </div>

            <Card className="flex-1 bg-black border-white/10">
              <CardContent className="p-4 h-full overflow-auto">
                <pre className="font-mono text-xs whitespace-pre-wrap">{output || 'No output yet. Click Run to execute your code.'}</pre>
              </CardContent>
            </Card>

            {/* Quick Tips */}
            <Card className="bg-white/5">
              <CardHeader className="p-3">
                <CardTitle className="text-sm">Quick Tips</CardTitle>
              </CardHeader>
              <CardContent className="p-3 text-xs space-y-1 text-gray-400">
                <div>• Press <kbd className="px-1 bg-black rounded">Ctrl+Enter</kbd> to run code</div>
                <div>• Press <kbd className="px-1 bg-black rounded">Tab</kbd> for indentation</div>
                <div>• Install packages for Node.js/Python</div>
                <div>• Share your code with the share button</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </CardContent>
    </div>
  );
}
