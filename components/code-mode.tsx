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
  Download,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { useCodeModeIntegration } from '../hooks/use-code-mode-integration';
import { CodeModeFile, CodeModeDiff } from '../lib/services/code-mode-integration';

// Legacy interfaces for backward compatibility
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
  // Integration hook
  const [integrationState, integrationActions] = useCodeModeIntegration({
    autoCleanup: true,
    enableRealTimeUpdates: true,
  });

  // Local state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']));
  const [prompt, setPrompt] = useState('');
  const [rules, setRules] = useState('');
  const [fileContents, setFileContents] = useState<{ [path: string]: ProjectFile }>({});
  const [activeTab, setActiveTab] = useState<'files' | 'diff' | 'output'>('files');
  const [sessionInitialized, setSessionInitialized] = useState(false);

  // Derived state from integration
  const { 
    currentSession, 
    isProcessing, 
    error: integrationError, 
    pendingDiffs, 
    lastResponse 
  } = integrationState;

  // Initialize file contents from project files and create session
  useEffect(() => {
    const contents: { [path: string]: ProjectFile } = {};
    const codeModeFiles: CodeModeFile[] = [];

    Object.entries(projectFiles).forEach(([path, content]) => {
      const language = getLanguageFromPath(path);
      const projectFile = {
        path,
        content,
        language,
        hasEdits: false
      };
      contents[path] = projectFile;

      // Convert to CodeModeFile format
      codeModeFiles.push({
        id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: path.split('/').pop() || path,
        path,
        content,
        language,
        hasEdits: false,
        lastModified: new Date(),
      });
    });

    setFileContents(contents);

    // Initialize session if not already done and files are available
    if (!sessionInitialized && codeModeFiles.length > 0 && isVisible) {
      integrationActions.createSession(codeModeFiles)
        .then(() => setSessionInitialized(true))
        .catch(console.error);
    }
  }, [projectFiles, sessionInitialized, isVisible, integrationActions]);

  // Update session files when file contents change
  useEffect(() => {
    if (currentSession && sessionInitialized) {
      const updatedFiles: CodeModeFile[] = Object.values(fileContents).map(file => ({
        id: currentSession.files.find(f => f.path === file.path)?.id || `file_${Date.now()}`,
        name: file.path.split('/').pop() || file.path,
        path: file.path,
        content: file.content,
        language: file.language,
        hasEdits: file.hasEdits || false,
        lastModified: new Date(),
      }));
      
      integrationActions.updateSessionFiles(updatedFiles);
    }
  }, [fileContents, currentSession, sessionInitialized, integrationActions]);

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



  const handleSendMessage = async () => {
    if (!prompt.trim() || !currentSession || isProcessing) return;
    
    try {
      // Clear any previous errors
      integrationActions.clearError();

      // Execute code task using the integration service
      const selectedFilePaths = Array.from(selectedFiles);
      
      // Start the task execution
      const taskPromise = integrationActions.executeCodeTask(
        prompt,
        rules || undefined,
        selectedFilePaths.length > 0 ? selectedFilePaths : undefined
      );
      
      // Clear prompt immediately to show it's being processed
      setPrompt('');
      setActiveTab('diff'); // Switch to diff tab to show results
      
      // Wait for the response
      const response = await taskPromise;
      
      // Also send message to parent for compatibility with existing chat system
      if (onSendMessage) {
        const contextData = {
          mode: 'code_editing',
          sessionId: currentSession.id,
          selectedFiles: selectedFilePaths,
          integrationResponse: response,
        };
        onSendMessage(prompt, contextData);
      }
      
    } catch (error) {
      console.error('Failed to execute code task:', error);
      // Error is handled by the integration hook
      // Restore prompt if there was an error
      if (error instanceof Error && error.message !== 'Operation cancelled') {
        // Don't restore prompt if it was cancelled
      }
    }
  };

  const handleStopGeneration = () => {
    if (currentSession && isProcessing) {
      integrationActions.cancelSession().catch(console.error);
    }
  };

  const applyDiffs = async () => {
    if (!currentSession || Object.keys(pendingDiffs).length === 0) return;

    try {
      // Convert DiffOperation to CodeModeDiff format
      const codeDiffs: { [filePath: string]: CodeModeDiff[] } = {};
      Object.entries(pendingDiffs).forEach(([filePath, diffs]) => {
        codeDiffs[filePath] = diffs.map(diff => ({
          type: diff.type,
          lineStart: diff.lineStart,
          lineEnd: diff.lineEnd,
          content: diff.content,
          originalContent: diff.originalContent,
        }));
      });

      const response = await integrationActions.applyDiffs(codeDiffs);
      
      if (response.success && response.files) {
        // Update local file contents
        const updatedContents = { ...fileContents };
        const updatedProjectFiles = { ...projectFiles };

        Object.entries(response.files).forEach(([filePath, content]) => {
          if (updatedContents[filePath]) {
            updatedContents[filePath] = {
              ...updatedContents[filePath],
              content,
              hasEdits: true
            };
            updatedProjectFiles[filePath] = content;
          }
        });

        setFileContents(updatedContents);
        onUpdateFiles(updatedProjectFiles);
        setActiveTab('files'); // Switch back to files tab
      }
    } catch (error) {
      console.error('Failed to apply diffs:', error);
      // Error is handled by the integration hook
    }
  };

  const renderDiffPreview = () => {
    const hasPendingDiffs = Object.keys(pendingDiffs).length > 0;
    const awaitingConfirmation = hasPendingDiffs && !isProcessing;

    if (!hasPendingDiffs) {
      return (
        <div className="text-center text-gray-400 py-8">
          <Diff className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No pending diffs</p>
          {lastResponse?.message && (
            <p className="text-sm mt-2 text-gray-500">{lastResponse.message}</p>
          )}
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
              onClick={applyDiffs}
              disabled={isProcessing}
              className="bg-green-600 hover:bg-green-700"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Apply Changes (Enter)
            </Button>
            <Button 
              variant="outline" 
              disabled={isProcessing}
              onClick={() => {
                integrationActions.clearError();
              }}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel (Esc)
            </Button>
          </div>
        )}

        {integrationError && (
          <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-700 rounded text-red-300">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{integrationError}</span>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={integrationActions.clearError}
              className="ml-auto"
            >
              <X className="h-3 w-3" />
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
      
      const hasPendingDiffs = Object.keys(pendingDiffs).length > 0;
      const awaitingConfirmation = hasPendingDiffs && !isProcessing;
      
      if (awaitingConfirmation) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyDiffs();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          integrationActions.clearError();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, pendingDiffs, isProcessing, integrationActions]);

  // Cleanup session when component unmounts or becomes invisible
  useEffect(() => {
    return () => {
      if (currentSession && !isVisible) {
        integrationActions.cancelSession().catch(console.error);
        setSessionInitialized(false);
      }
    };
  }, [isVisible, currentSession, integrationActions]);

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
            <div className="text-sm text-gray-400 flex items-center gap-2">
              {selectedFiles.size} files selected • Enhanced orchestrator integration
              {currentSession && (
                <Badge variant="outline" className="text-xs">
                  Session: {currentSession.status}
                </Badge>
              )}
              {!sessionInitialized && (
                <span className="text-yellow-400">Initializing...</span>
              )}
            </div>
            <div className="flex gap-2">
              {isProcessindleSendMessage}
              disabled={!prompt.trim() || selectedFiles.size === 0 || isProcessing || !sessionInitialized}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {isProcessing ? 'Processing...' : 'Send Request'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}