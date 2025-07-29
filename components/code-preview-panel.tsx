import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { 
  Code, 
  Download, 
  Copy, 
  Play, 
  Folder, 
  File, 
  ChevronRight, 
  ChevronDown,
  X,
  Maximize2,
  Minimize2,
  RefreshCw,
  Eye,
  EyeOff,
  Settings,
  Package,
  Terminal,
  FileText,
  Zap,
  Globe,
  Monitor,
  Smartphone,
  Tablet
} from 'lucide-react';
import { SandpackProvider, SandpackLayout, SandpackCodeEditor, SandpackPreview, SandpackConsole } from '@codesandbox/sandpack-react';

interface CodeBlock {
  language: string;
  code: string;
  filename: string;
  index: number;
}

interface ProjectStructure {
  files: { [key: string]: string };
  dependencies: string[];
  devDependencies: string[];
  scripts: { [key: string]: string };
  framework: 'react' | 'vue' | 'angular' | 'svelte' | 'vanilla' | 'next' | 'nuxt' | 'astro' | 'remix' | 'gatsby' | 'vite' | 'solid';
  bundler?: 'webpack' | 'vite' | 'parcel' | 'rollup' | 'esbuild';
  packageManager: 'npm' | 'yarn' | 'pnpm';
}

interface CodePreviewPanelProps {
  messages: Array<{ role: string; content: string; id?: string }>;
  isVisible: boolean;
  onClose: () => void;
}

export default function CodePreviewPanel({ messages, isVisible, onClose }: CodePreviewPanelProps) {
  const [activeTab, setActiveTab] = useState('preview');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [showConsole, setShowConsole] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']));

  if (!isVisible) return null;

  // Helper to get file extension based on language
  const getFileExtension = (language: string): string => {
    const extensions: { [key: string]: string } = {
      javascript: 'js',
      typescript: 'ts',
      jsx: 'jsx',
      tsx: 'tsx',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      json: 'json',
      xml: 'xml',
      yaml: 'yml',
      yml: 'yml',
      python: 'py',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      php: 'php',
      ruby: 'rb',
      go: 'go',
      rust: 'rs',
      swift: 'swift',
      kotlin: 'kt',
      dart: 'dart',
      vue: 'vue',
      svelte: 'svelte',
      angular: 'ts',
      react: 'jsx',
      bash: 'sh',
      shell: 'sh',
      sh: 'sh',
      sql: 'sql',
      dockerfile: 'dockerfile',
      docker: 'dockerfile',
      makefile: 'makefile',
      make: 'makefile',
      markdown: 'md',
      md: 'md',
      text: 'txt'
    };
    return extensions[language.toLowerCase()] || 'txt';
  };

  // Simplified filename cleaning
  const cleanFilename = (filenameHint: string, language: string, index: number): string => {
    if (!filenameHint || filenameHint.trim().length === 0) {
      return `file-${index}.${getFileExtension(language)}`;
    }

    let cleaned = filenameHint.trim();
    
    // Remove common markdown artifacts
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, ''); // Remove ```language
    cleaned = cleaned.replace(/```$/, ''); // Remove trailing ```
    cleaned = cleaned.replace(/^[#\-\*\s]+/, ''); // Remove leading #, -, *, spaces
    cleaned = cleaned.replace(/[#\-\*\s]+$/, ''); // Remove trailing #, -, *, spaces
    
    // Extract just the filename if it looks like a path
    if (cleaned.includes('/')) {
      const parts = cleaned.split('/');
      cleaned = parts[parts.length - 1]; // Get last part
    }
    
    // Remove invalid filename characters
    cleaned = cleaned.replace(/[<>:"|?*]/g, '');
    cleaned = cleaned.replace(/\s+/g, '_'); // Replace spaces with underscores
    
    // Ensure it has an extension
    if (!cleaned.includes('.')) {
      cleaned += `.${getFileExtension(language)}`;
    }
    
    return cleaned || `file-${index}.${getFileExtension(language)}`;
  };

  // Extract code blocks from messages
  const codeBlocks = useMemo(() => {
    const blocks: CodeBlock[] = [];
    messages.forEach((message) => {
      if (message.role === "assistant") {
        const codeBlockRegex = /```(\w+)?\s*([^\n]*)\n([\s\S]*?)```/g;
        let match;
        let blockIndex = 0;
        
        while ((match = codeBlockRegex.exec(message.content)) !== null) {
          const language = match[1] || 'text';
          const filenameHint = match[2] ? match[2].trim() : '';
          const code = match[3];
          
          const filename = cleanFilename(filenameHint, language, blockIndex);
          
          blocks.push({
            language,
            code: code.trim(),
            filename,
            index: blockIndex
          });
          blockIndex++;
        }
      }
    });
    return blocks;
  }, [messages]);

  // Analyze project structure
  const projectStructure = useMemo(() => {
    const files: { [key: string]: string } = {};
    const dependencies: string[] = [];
    const devDependencies: string[] = [];
    const scripts: { [key: string]: string } = {};
    let framework: ProjectStructure['framework'] = 'vanilla';

    codeBlocks.forEach(block => {
      files[block.filename] = block.code;
      
      // Detect framework
      if (block.code.includes('import React') || block.code.includes('from "react"')) {
        framework = 'react';
      } else if (block.code.includes('import Vue') || block.code.includes('from "vue"')) {
        framework = 'vue';
      } else if (block.code.includes('@angular/') || block.code.includes('import { Component }')) {
        framework = 'angular';
      }
    });

    return {
      files,
      dependencies,
      devDependencies,
      scripts,
      framework,
      packageManager: 'npm' as const
    };
  }, [codeBlocks]);

  // Set initial selected file
  useEffect(() => {
    if (codeBlocks.length > 0 && !selectedFile) {
      setSelectedFile(codeBlocks[0].filename);
    }
  }, [codeBlocks, selectedFile]);

  const handleDownload = () => {
    if (codeBlocks.length === 1) {
      // Single file download
      const block = codeBlocks[0];
      const blob = new Blob([block.code], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = block.filename;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Multiple files - create a zip-like structure
      let content = '';
      codeBlocks.forEach(block => {
        content += `// File: ${block.filename}\n`;
        content += block.code;
        content += '\n\n';
      });
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project-files.txt';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  const renderFileTree = () => {
    const fileTree: { [key: string]: any } = {};
    
    Object.keys(projectStructure.files).forEach(filepath => {
      const parts = filepath.split('/');
      let current = fileTree;
      
      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          // It's a file
          current[part] = { type: 'file', path: filepath };
        } else {
          // It's a folder
          if (!current[part]) {
            current[part] = { type: 'folder', children: {} };
          }
          current = current[part].children;
        }
      });
    });

    const renderTreeNode = (name: string, node: any, depth: number = 0): React.ReactNode => {
      if (node.type === 'file') {
        return (
          <div
            key={node.path}
            className={`flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-white/5 rounded text-sm ${
              selectedFile === node.path ? 'bg-blue-500/20 text-blue-300' : 'text-white/70'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => setSelectedFile(node.path)}
          >
            <File className="h-4 w-4" />
            <span>{name}</span>
          </div>
        );
      } else {
        const isExpanded = expandedFolders.has(name);
        return (
          <div key={name}>
            <div
              className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-white/5 rounded text-sm text-white/70"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => {
                const newExpanded = new Set(expandedFolders);
                if (isExpanded) {
                  newExpanded.delete(name);
                } else {
                  newExpanded.add(name);
                }
                setExpandedFolders(newExpanded);
              }}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Folder className="h-4 w-4" />
              <span>{name}</span>
            </div>
            {isExpanded && (
              <div>
                {Object.entries(node.children).map(([childName, childNode]) =>
                  renderTreeNode(childName, childNode, depth + 1)
                )}
              </div>
            )}
          </div>
        );
      }
    };

    return (
      <div className="space-y-1">
        {Object.entries(fileTree).map(([name, node]) => renderTreeNode(name, node))}
      </div>
    );
  };

  const renderLivePreview = () => {
    if (projectStructure.framework === 'react' && Object.keys(projectStructure.files).length > 0) {
      const sandpackFiles: { [key: string]: { code: string } } = {};
      
      Object.entries(projectStructure.files).forEach(([path, content]) => {
        const sandpackPath = path.startsWith('/') ? path : `/${path}`;
        sandpackFiles[sandpackPath] = { code: content };
      });

      // Add default files if missing
      if (!sandpackFiles['/src/index.js'] && !sandpackFiles['/src/index.jsx']) {
        sandpackFiles['/src/index.js'] = {
          code: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`
        };
      }

      return (
        <SandpackProvider
          template="react"
          files={sandpackFiles}
          theme="dark"
          options={{
            showConsole: showConsole,
            showConsoleButton: true,
            showRefreshButton: true,
          }}
        >
          <SandpackLayout>
            <div className="flex-1">
              <SandpackPreview 
                style={{ height: '100%' }}
                showOpenInCodeSandbox={false}
                showRefreshButton={true}
              />
            </div>
            {showConsole && (
              <div className="h-48">
                <SandpackConsole />
              </div>
            )}
          </SandpackLayout>
        </SandpackProvider>
      );
    }

    // Fallback for non-React projects
    return (
      <div className="flex items-center justify-center h-full text-white/60">
        <div className="text-center">
          <Monitor className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Live preview not available for this project type</p>
          <p className="text-sm mt-2">Framework: {projectStructure.framework}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-gray-900 border border-white/20 rounded-lg shadow-2xl transition-all duration-300 ${
        isMinimized ? 'w-80 h-16' : 'w-full h-full max-w-7xl max-h-[90vh]'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Code className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Code Preview</h2>
            <Badge variant="outline" className="text-xs">
              {codeBlocks.length} file{codeBlocks.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsMinimized(!isMinimized)}
              className="text-gray-400 hover:text-white"
            >
              {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!isMinimized && (
          <div className="flex h-full">
            {/* Sidebar */}
            <div className="w-80 border-r border-white/10 flex flex-col">
              <div className="p-4 border-b border-white/10">
                <h3 className="text-sm font-medium text-white mb-3">Project Files</h3>
                <div className="max-h-60 overflow-y-auto">
                  {renderFileTree()}
                </div>
              </div>
              
              <div className="p-4 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-white">Actions</h3>
                </div>
                <div className="space-y-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownload}
                    className="w-full justify-start"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Files
                  </Button>
                  {selectedFile && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(projectStructure.files[selectedFile])}
                      className="w-full justify-start"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Selected
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                <div className="border-b border-white/10 px-4">
                  <TabsList className="bg-transparent">
                    <TabsTrigger value="preview" className="data-[state=active]:bg-white/10">
                      <Eye className="h-4 w-4 mr-2" />
                      Live Preview
                    </TabsTrigger>
                    <TabsTrigger value="code" className="data-[state=active]:bg-white/10">
                      <Code className="h-4 w-4 mr-2" />
                      Code Editor
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="preview" className="flex-1 m-0 p-0">
                  <div className="h-full">
                    {renderLivePreview()}
                  </div>
                </TabsContent>

                <TabsContent value="code" className="flex-1 m-0 p-0">
                  <div className="h-full flex">
                    {selectedFile && (
                      <div className="flex-1 p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-medium text-white">{selectedFile}</h3>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopy(projectStructure.files[selectedFile])}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy
                          </Button>
                        </div>
                        <pre className="bg-black/40 rounded-lg p-4 overflow-auto text-sm text-white/90 h-full">
                          <code>{projectStructure.files[selectedFile]}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}