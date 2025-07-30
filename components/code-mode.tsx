"use client"

import * as React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { 
  Code, 
  FileText, 
  Send, 
  Plus, 
  Minus,
  Check,
  X,
  Eye,
  Edit3,
  Save,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  Terminal,
  GitBranch,
  Diff,
  ArrowRight,
  Copy,
  Download
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

interface ProjectFile {
  path: string;
  content: string;
  language: string;
  hasEdits?: boolean;
  pendingDiffs?: DiffOperation[];
}

interface DiffOperation {
  type: 'add' | 'remove' | 'modify';
  lineStart: number;
  lineEnd?: number;
  content: string;
  originalContent?: string;
}

interface CodeModeRequest {
  type: 'read_file' | 'write_diff' | 'list_files' | 'create_file' | 'delete_file';
  files?: string[];
  diffs?: { [filePath: string]: DiffOperation[] };
  content?: string;
  path?: string;
}

interface CodeModeResponse {
  type: 'file_content' | 'diff_preview' | 'file_list' | 'confirmation' | 'error';
  files?: { [path: string]: string };
  diffs?: { [filePath: string]: DiffOperation[] };
  message?: string;
  nextFiles?: string[];
}

interface CodeModeProps {
  projectFiles: { [key: string]: string };
  onUpdateFiles: (files: { [key: string]: string }) => void;
  onSendMessage: (message: string, context?: any) => void;
  isVisible: boolean;
  onClose: () => void;
}

export default function CodeMode({ 
  projectFiles, 
  onUpdateFiles, 
  onSendMessage, 
  isVisible, 
  onClose 
}: CodeModeProps) {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']));
  const [prompt, setPrompt] = useState('');
  const [rules, setRules] = useState('');
  const [pendingDiffs, setPendingDiffs] = useState<{ [filePath: string]: DiffOperation[] }>({});
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [lastResponse, setLastResponse] = useState<CodeModeResponse | null>(null);
  const [fileContents, setFileContents] = useState<{ [path: string]: ProjectFile }>({});
  const [activeTab, setActiveTab] = useState<'files' | 'diff' | 'output'>('files');

  // Initialize file contents from project files
  useEffect(() => {
    const contents: { [path: string]: ProjectFile } = {};
    Object.entries(projectFiles).forEach(([path, content]) => {
      const language = getLanguageFromPath(path);
      contents[path] = {
        path,
        content,
        language,
        hasEdits: false
      };
    });
    setFileContents(contents);
  }, [projectFiles]);

  const getLanguageFromPath = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'jsx',
      'ts': 'typescript',
      'tsx': 'tsx',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'json': 'json',
      'md': 'markdown',
      'yml': 'yaml',
      'yaml': 'yaml',
      'xml': 'xml',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'dart': 'dart',
      'vue': 'vue',
      'svelte': 'svelte'
    };
    return langMap[ext || ''] || 'text';
  };

  const buildFileTree = () => {
    const tree: { [key: string]: any } = {};
    Object.keys(fileContents).forEach(filepath => {
      const parts = filepath.split('/');
      let current = tree;
      
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
    return tree;
  };

  const renderFileTree = (tree: any, depth: number = 0): React.ReactNode => {
    return Object.entries(tree).map(([name, node]: [string, any]) => {
      if (node.type === 'file') {
        const isSelected = selectedFiles.has(node.path);
        const hasEdits = fileContents[node.path]?.hasEdits;
        
        return (
          <div
            key={node.path}
            className={`flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-white/5 rounded text-sm ${
              isSelected ? 'bg-blue-500/20 text-blue-300' : 'text-white/70'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => {
              const newSelected = new Set(selectedFiles);
              if (isSelected) {
                newSelected.delete(node.path);
              } else {
                newSelected.add(node.path);
              }
              setSelectedFiles(newSelected);
            }}
          >
            <Checkbox 
              checked={isSelected} 
              className="h-3 w-3"
            />
            <File className="h-4 w-4" />
            <span className="flex-1">{name}</span>
            {hasEdits && <div className="w-2 h-2 bg-orange-400 rounded-full" />}
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
                {renderFileTree(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }
    });
  };

  const formatCodeModeMessage = (): string => {
    const selectedFilePaths = Array.from(selectedFiles);
    const contextFiles = selectedFilePaths.map(path => ({
      path,
      content: fileContents[path]?.content || ''
    }));

    const message = {
      mode: 'code_editing',
      task: prompt,
      rules: rules || 'Follow standard coding practices and maintain code quality.',
      context_files: contextFiles,
      schema: {
        response_format: {
          type: 'code_mode_response',
          properties: {
            type: { enum: ['file_content', 'diff_preview', 'file_list', 'confirmation', 'error'] },
            files: { type: 'object', description: 'File contents keyed by path' },
            diffs: { 
              type: 'object', 
              description: 'Diff operations keyed by file path',
              properties: {
                type: { enum: ['add', 'remove', 'modify'] },
                lineStart: { type: 'number' },
                lineEnd: { type: 'number' },
                content: { type: 'string' },
                originalContent: { type: 'string' }
              }
            },
            message: { type: 'string' },
            nextFiles: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'List of files to read in next request'
            }
          }
        }
      },
      commands: {
        read_file: 'Request to read specific files: { "type": "read_file", "files": ["path1", "path2"] }',
        write_diff: 'Apply diff changes: { "type": "write_diff", "diffs": { "file_path": [diff_operations] } }',
        list_files: 'List project files: { "type": "list_files" }',
        create_file: 'Create new file: { "type": "create_file", "path": "file_path", "content": "file_content" }',
        delete_file: 'Delete file: { "type": "delete_file", "path": "file_path" }'
      }
    };

    return JSON.stringify(message, null, 2);
  };

  const handleSendMessage = () => {
    if (!prompt.trim()) return;
    
    const formattedMessage = formatCodeModeMessage();
    onSendMessage(formattedMessage, {
      mode: 'code_editing',
      selectedFiles: Array.from(selectedFiles),
      fileContents: Object.fromEntries(
        Array.from(selectedFiles).map(path => [path, fileContents[path]?.content || ''])
      )
    });
    
    setPrompt('');
  };

  const applyDiffs = (diffs: { [filePath: string]: DiffOperation[] }) => {
    const updatedContents = { ...fileContents };
    const updatedProjectFiles = { ...projectFiles };

    Object.entries(diffs).forEach(([filePath, operations]) => {
      if (!updatedContents[filePath]) return;

      let content = updatedContents[filePath].content;
      const lines = content.split('\n');

      // Sort operations by line number (descending) to avoid index shifting
      const sortedOps = [...operations].sort((a, b) => b.lineStart - a.lineStart);

      sortedOps.forEach(op => {
        switch (op.type) {
          case 'add':
            lines.splice(op.lineStart, 0, op.content);
            break;
          case 'remove':
            lines.splice(op.lineStart, (op.lineEnd || op.lineStart) - op.lineStart + 1);
            break;
          case 'modify':
            const endLine = op.lineEnd || op.lineStart;
            lines.splice(op.lineStart, endLine - op.lineStart + 1, op.content);
            break;
        }
      });

      const newContent = lines.join('\n');
      updatedContents[filePath] = {
        ...updatedContents[filePath],
        content: newContent,
        hasEdits: true
      };
      updatedProjectFiles[filePath] = newContent;
    });

    setFileContents(updatedContents);
    onUpdateFiles(updatedProjectFiles);
    setPendingDiffs({});
    setAwaitingConfirmation(false);
  };

  const renderDiffPreview = () => {
    if (Object.keys(pendingDiffs).length === 0) {
      return (
        <div className="text-center text-gray-400 py-8">
          <Diff className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No pending diffs</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {Object.entries(pendingDiffs).map(([filePath, operations]) => (
          <Card key={filePath} className="bg-gray-800 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <File className="h-4 w-4" />
                {filePath}
                <Badge variant="outline" className="text-xs">
                  {operations.length} change{operations.length !== 1 ? 's' : ''}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {operations.map((op, index) => (
                <div key={index} className="border border-gray-600 rounded">
                  <div className={`px-3 py-1 text-xs font-mono ${
                    op.type === 'add' ? 'bg-green-900/30 text-green-300' :
                    op.type === 'remove' ? 'bg-red-900/30 text-red-300' :
                    'bg-blue-900/30 text-blue-300'
                  }`}>
                    {op.type.toUpperCase()} @ line {op.lineStart}
                    {op.lineEnd && op.lineEnd !== op.lineStart && ` - ${op.lineEnd}`}
                  </div>
                  <div className="p-2 bg-gray-900 text-sm font-mono">
                    {op.type === 'remove' && op.originalContent && (
                      <div className="text-red-300 bg-red-900/20 p-1 rounded mb-1">
                        - {op.originalContent}
                      </div>
                    )}
                    {op.content && (
                      <div className={`p-1 rounded ${
                        op.type === 'add' ? 'text-green-300 bg-green-900/20' :
                        op.type === 'modify' ? 'text-blue-300 bg-blue-900/20' :
                        'text-gray-300'
                      }`}>
                        {op.type === 'add' ? '+ ' : op.type === 'modify' ? '~ ' : ''}{op.content}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
        
        {awaitingConfirmation && (
          <div className="flex gap-2 justify-center pt-4">
            <Button 
              onClick={() => applyDiffs(pendingDiffs)}
              className="bg-green-600 hover:bg-green-700"
            >
              <Check className="h-4 w-4 mr-2" />
              Apply Changes (Enter)
            </Button>
            <Button 
              variant="outline" 
              onClick={() => {
                setPendingDiffs({});
                setAwaitingConfirmation(false);
              }}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel (Esc)
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      
      if (awaitingConfirmation) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyDiffs(pendingDiffs);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setPendingDiffs({});
          setAwaitingConfirmation(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, awaitingConfirmation, pendingDiffs]);

  if (!isVisible) return null;

  const fileTree = buildFileTree();

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-white/20 rounded-lg shadow-2xl w-full h-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Terminal className="h-5 w-5 text-green-400" />
            <h2 className="text-lg font-semibold text-white">Code Mode</h2>
            <Badge variant="outline" className="text-xs">
              {selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''} selected
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - File Selection */}
          <div className="w-80 border-r border-white/10 flex flex-col">
            <div className="p-4 border-b border-white/10">
              <h3 className="text-sm font-medium text-white mb-2">Project Files</h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedFiles(new Set(Object.keys(fileContents)))}
                  className="text-xs"
                >
                  Select All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedFiles(new Set())}
                  className="text-xs"
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {renderFileTree(fileTree)}
            </div>
          </div>

          {/* Right Panel - Main Content */}
          <div className="flex-1 flex flex-col">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="flex-1 flex flex-col">
              <TabsList className="grid w-full grid-cols-3 bg-gray-800">
                <TabsTrigger value="files">Files</TabsTrigger>
                <TabsTrigger value="diff">Diffs</TabsTrigger>
                <TabsTrigger value="output">Output</TabsTrigger>
              </TabsList>

              <TabsContent value="files" className="flex-1 overflow-hidden">
                <div className="h-full overflow-y-auto p-4">
                  {Array.from(selectedFiles).map(filePath => {
                    const file = fileContents[filePath];
                    if (!file) return null;
                    
                    return (
                      <Card key={filePath} className="mb-4 bg-gray-800 border-gray-700">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm text-white flex items-center gap-2">
                            <File className="h-4 w-4" />
                            {filePath}
                            {file.hasEdits && <Badge variant="outline" className="text-xs">Modified</Badge>}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <SyntaxHighlighter
                            language={file.language}
                            style={oneDark}
                            customStyle={{
                              margin: 0,
                              borderRadius: '0.375rem',
                              fontSize: '0.875rem'
                            }}
                            showLineNumbers
                          >
                            {file.content}
                          </SyntaxHighlighter>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {selectedFiles.size === 0 && (
                    <div className="text-center text-gray-400 py-8">
                      <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Select files to view their content</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="diff" className="flex-1 overflow-hidden">
                <div className="h-full overflow-y-auto p-4">
                  {renderDiffPreview()}
                </div>
              </TabsContent>

              <TabsContent value="output" className="flex-1 overflow-hidden">
                <div className="h-full overflow-y-auto p-4">
                  {lastResponse ? (
                    <Card className="bg-gray-800 border-gray-700">
                      <CardHeader>
                        <CardTitle className="text-sm text-white">Last Response</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <pre className="text-sm text-gray-300 whitespace-pre-wrap">
                          {JSON.stringify(lastResponse, null, 2)}
                        </pre>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="text-center text-gray-400 py-8">
                      <Terminal className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No output yet</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Bottom Panel - Input */}
        <div className="border-t border-white/10 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-white mb-2 block">Task/Prompt</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want to do with the selected files..."
                className="bg-gray-800 border-gray-700 text-white resize-none"
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-white mb-2 block">Rules/Schema</label>
              <Textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="Additional rules or constraints..."
                className="bg-gray-800 border-gray-700 text-white resize-none"
                rows={3}
              />
            </div>
          </div>
          
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-400">
              {selectedFiles.size} files selected • Schema-based editing enabled
            </div>
            <Button
              onClick={handleSendMessage}
              disabled={!prompt.trim() || selectedFiles.size === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Send className="h-4 w-4 mr-2" />
              Send Request
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}