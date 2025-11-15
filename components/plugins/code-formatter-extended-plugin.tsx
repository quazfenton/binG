"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Code,
  Copy,
  Download,
  Upload,
  Play,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Settings,
  History,
  Package,
  FileText,
  Search,
  Filter,
  Info,
  XCircle
} from 'lucide-react';
import { Alert, AlertDescription } from '../ui/alert';
import { toast } from 'sonner';
import type { PluginProps } from './plugin-manager';
import BasePlugin, { BasePluginActions, BasePluginState } from './base-plugin';

// Define specific state and props for this plugin
interface CodeFormatterState extends BasePluginState {
  code: string;
  formattedCode: string;
  language: string;
  prettifyOptions: {
    semi: boolean;
    singleQuote: boolean;
    tabWidth: number;
    trailingComma: 'none' | 'es5' | 'all';
  };
}

interface CodeFormatterProps extends PluginProps {
  // Add plugin-specific props here if needed
}

// Code Formatter Plugin Implementation
const CodeFormatterPluginExtended: React.FC<CodeFormatterProps> = ({
  onClose,
  onResult,
  initialData
}) => {
  const [state, setState] = useState<CodeFormatterState>({
    isLoading: false,
    isProcessing: false,
    hasError: false,
    errorMessage: undefined,
    history: [],
    settings: {},
    activeTab: 'main',
    lastOperation: null,
    code: initialData?.code || '',
    formattedCode: initialData?.formattedCode || '',
    language: initialData?.language || 'javascript',
    prettifyOptions: initialData?.prettifyOptions || {
      semi: true,
      singleQuote: false,
      tabWidth: 2,
      trailingComma: 'es5'
    }
  });

  const actions: BasePluginActions = {
    executeOperation: async (operation: string, data?: any) => {
      setState(prev => ({ ...prev, isProcessing: true, hasError: false }));
      
      try {
        let result: any;
        
        switch(operation) {
          case 'format':
            result = await formatCode(state.code, state.language, state.prettifyOptions);
            setState(prev => ({ 
              ...prev, 
              formattedCode: result as string,
              isProcessing: false,
              hasError: false,
              lastOperation: operation
            }));
            break;
          case 'formatAndCopy':
            result = await formatCode(state.code, state.language, state.prettifyOptions);
            setState(prev => ({ 
              ...prev, 
              formattedCode: result as string,
              isProcessing: false,
              hasError: false,
              lastOperation: operation
            }));
            
            // Copy to clipboard
            await navigator.clipboard.writeText(result as string);
            toast.success('Formatted code copied to clipboard');
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        
        onResult?.(result);
        
        // Add to history
        addToHistory(operation, result, { 
          language: state.language,
          originalCode: state.code,
          formattedCode: result,
          options: state.prettifyOptions
        });
        
        toast.success(`Code ${operation === 'format' ? 'formatted' : 'formatted and copied'}`);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setState(prev => ({
          ...prev,
          isProcessing: false,
          hasError: true,
          errorMessage: errorMsg
        }));
        
        toast.error(`Formatting failed: ${errorMsg}`);
        throw error;
      }
    },
    
    addToHistory: (operation, result, metadata = {}) => {
      const item = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        operation,
        result,
        metadata
      };
      
      setState(prev => ({
        ...prev,
        history: [item, ...prev.history.slice(0, 49)] // Keep last 50 items
      }));
    },
    
    clearHistory: () => {
      setState(prev => ({ ...prev, history: [] }));
      toast.success('History cleared');
    },
    
    updateSettings: (newSettings) => {
      setState(prev => ({
        ...prev,
        settings: { ...prev.settings, ...newSettings }
      }));
      toast.success('Settings updated');
    },
    
    setError: (error) => {
      setState(prev => ({
        ...prev,
        hasError: true,
        errorMessage: error
      }));
    },
    
    clearError: () => {
      setState(prev => ({
        ...prev,
        hasError: false,
        errorMessage: undefined
      }));
    }
  };

  // Plugin-specific helper functions
  const formatCode = async (
    code: string,
    language: string,
    options: CodeFormatterState['prettifyOptions']
  ): Promise<string> => {
    // Simulate formatting with timeout
    await new Promise(resolve => setTimeout(resolve, 500));
    
    try {
      let formattedCode = code;
      
      switch (language) {
        case 'javascript':
        case 'typescript':
          formattedCode = formatJavaScript(code, options);
          break;
        case 'json':
          try {
            const parsed = JSON.parse(code);
            formattedCode = JSON.stringify(parsed, null, options.tabWidth);
          } catch {
            throw new Error('Invalid JSON format');
          }
          break;
        case 'html':
          formattedCode = formatHTML(code, options.tabWidth);
          break;
        case 'css':
          formattedCode = formatCSS(code, options.tabWidth);
          break;
        default:
          // For other languages, do basic indentation
          formattedCode = basicFormat(code, options.tabWidth);
      }
      
      return formattedCode;
    } catch (error) {
      throw new Error(`Failed to format as ${language}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const formatJavaScript = (code: string, options: CodeFormatterState['prettifyOptions']): string => {
    // Basic JavaScript formatting
    let formatted = code
      .replace(/;/g, options.semi ? ';\n' : '\n')
      .replace(/{/g, ` {\n${' '.repeat(options.tabWidth)}`)
      .replace(/}/g, `\n}`)
      .replace(/,/g, `,${options.trailingComma === 'none' ? '' : '\n' + ' '.repeat(options.tabWidth)}`)
      .replace(/\n\s*\n/g, '\n'); // Remove extra empty lines

    if (options.singleQuote) {
      formatted = formatted.replace(/"/g, "'");
    }
    
    return formatted;
  };

  const formatHTML = (code: string, tabWidth: number): string => {
    // Basic HTML formatting
    let formatted = code;
    const indent = ' '.repeat(tabWidth);
    
    // Add newlines around tags
    formatted = formatted.replace(/></g, `>\n<`);
    
    // Basic indentation (simplified)
    let level = 0;
    const lines = formatted.split('\n');
    const indented = lines.map(line => {
      if (line.trim().startsWith('</')) {
        level = Math.max(0, level - 1);
      }
      
      const indentedLine = level > 0 ? indent.repeat(level) + line.trim() : line.trim();
      
      if (line.trim().startsWith('<') && !line.trim().startsWith('</') && !line.trim().endsWith('/>')) {
        level++;
      }
      
      return indentedLine;
    });
    
    return indented.join('\n');
  };

  const formatCSS = (code: string, tabWidth: number): string => {
    // Basic CSS formatting
    let formatted = code
      .replace(/{/g, ' {\n' + ' '.repeat(tabWidth))
      .replace(/}/g, `\n}`)
      .replace(/;/g, ';\n' + ' '.repeat(tabWidth))
      .replace(/\n\s*\n/g, '\n'); // Remove extra empty lines
    
    return formatted;
  };

  const basicFormat = (code: string, tabWidth: number): string => {
    // Basic formatting with indentation
    return code
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  };

  const addToHistory = (operation: string, result: any, metadata?: Record<string, any>) => {
    const item = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      operation,
      result,
      metadata
    };
    
    setState(prev => ({
      ...prev,
      history: [item, ...prev.history.slice(0, 49)] // Keep last 50 items
    }));
  };

  const handleDownload = () => {
    const blob = new Blob([state.formattedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `formatted-code.${state.language}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Code downloaded');
  };

  const { 
    isLoading, 
    isProcessing, 
    hasError, 
    errorMessage, 
    code, 
    formattedCode, 
    language,
    prettifyOptions,
    history
  } = state;

  // Language options
  const languages = [
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'json', label: 'JSON' },
    { value: 'html', label: 'HTML' },
    { value: 'css', label: 'CSS' },
    { value: 'python', label: 'Python' },
    { value: 'java', label: 'Java' },
    { value: 'cpp', label: 'C++' },
    { value: 'sql', label: 'SQL' },
    { value: 'xml', label: 'XML' }
  ];

  return (
    <div className="h-full flex flex-col bg-black text-white">
      {/* Header */}
      <CardHeader className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="w-5 h-5 text-blue-400" />
            <CardTitle className="text-lg">Code Formatter Extended</CardTitle>
            <Badge variant="secondary">Formatter</Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onClose}>
              <XCircle className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        {hasError && (
          <Alert className="mb-4 border-red-500/50 bg-red-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <Tabs 
          value={state.activeTab} 
          onValueChange={(value) => setState(prev => ({ ...prev, activeTab: value }))} 
          className="h-full flex flex-col"
        >
          <TabsList className="grid grid-cols-3 w-full mb-4">
            <TabsTrigger value="main">Main</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="flex-1 overflow-auto">
            <div className="space-y-4">
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                  <p>Loading Code Formatter...</p>
                </div>
              )}

              <div className="space-y-4">
                {/* Language and Format Options */}
                <div className="flex gap-2">
                  <Select value={language} onValueChange={(value) => setState(prev => ({ ...prev, language: value }))}>
                    <SelectTrigger className="flex-1 bg-black/40 border-white/20">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      {languages.map(lang => (
                        <SelectItem key={lang.value} value={lang.value}>
                          {lang.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button 
                    onClick={() => actions.executeOperation('format')}
                    disabled={isProcessing || !code.trim()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isProcessing ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Formatting...
                      </>
                    ) : (
                      <>
                        <Code className="w-4 h-4 mr-2" />
                        Format
                      </>
                    )}
                  </Button>

                  <Button 
                    onClick={() => actions.executeOperation('formatAndCopy')}
                    disabled={isProcessing || !code.trim()}
                    variant="outline"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Format & Copy
                  </Button>
                </div>

                {/* Input Section */}
                <Card className="bg-white/5">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center justify-between">
                      Input Code
                      <Badge variant="outline">{language.toUpperCase()}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      value={code}
                      onChange={(e) => setState(prev => ({ ...prev, code: e.target.value }))}
                      placeholder={`Paste your ${language} code here...`}
                      className="min-h-[200px] bg-black/40 border-white/20 text-white resize-none font-mono text-sm"
                    />
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>{code.length} characters</span>
                      <span>{code.split('\n').length} lines</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Output Section */}
                {formattedCode && (
                  <Card className="bg-white/5">
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center justify-between">
                        Formatted Code
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => navigator.clipboard.writeText(formattedCode)}
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            Copy
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={handleDownload}
                          >
                            <Download className="w-3 h-3 mr-1" />
                            Download
                          </Button>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-sm font-mono bg-black p-3 rounded overflow-auto max-h-60">
                        {formattedCode}
                      </pre>
                      <div className="mt-2 text-xs text-gray-400">
                        {formattedCode.split('\n').length} lines, {formattedCode.length} characters
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card className="bg-white/5">
              <CardHeader>
                <CardTitle className="text-sm">Formatting Options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Semicolons</label>
                    <p className="text-xs text-gray-400">Add semicolons at the end of statements</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={prettifyOptions.semi} 
                    onChange={(e) => setState(prev => ({
                      ...prev,
                      prettifyOptions: { ...prev.prettifyOptions, semi: e.target.checked }
                    }))}
                    className="toggle"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Single Quotes</label>
                    <p className="text-xs text-gray-400">Use single quotes instead of double quotes</p>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={prettifyOptions.singleQuote} 
                    onChange={(e) => setState(prev => ({
                      ...prev,
                      prettifyOptions: { ...prev.prettifyOptions, singleQuote: e.target.checked }
                    }))}
                    className="toggle"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Tab Width: {prettifyOptions.tabWidth}</label>
                  <input 
                    type="range" 
                    min="1" 
                    max="8" 
                    value={prettifyOptions.tabWidth} 
                    onChange={(e) => setState(prev => ({
                      ...prev,
                      prettifyOptions: { ...prev.prettifyOptions, tabWidth: parseInt(e.target.value) }
                    }))}
                    className="w-full mt-2"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>1</span>
                    <span>8</span>
                  </div>
                </div>
                
                <div>
                  <label className="text-sm font-medium">Trailing Comma</label>
                  <Select 
                    value={prettifyOptions.trailingComma} 
                    onValueChange={(value) => setState(prev => ({
                      ...prev,
                      prettifyOptions: { ...prev.prettifyOptions, trailingComma: value as any }
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="es5">ES5</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <Button 
                  size="sm" 
                  onClick={() => actions.updateSettings(prettifyOptions)}
                  className="w-full"
                >
                  Save Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium">Formatting History</h3>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={actions.clearHistory}
                disabled={history.length === 0}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>

            {history.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No formatting history yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <Card key={item.id} className="bg-white/5">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">{item.operation}</div>
                          <div className="text-sm text-gray-400">
                            {new Date(item.timestamp).toLocaleString()}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {item.metadata?.language}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs font-mono bg-black p-2 rounded max-h-24 overflow-auto">
                        {typeof item.result === 'string' 
                          ? item.result.substring(0, 100) + (item.result.length > 100 ? '...' : '')
                          : JSON.stringify(item.result, null, 2)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default CodeFormatterPluginExtended;