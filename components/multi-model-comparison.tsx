"use client";

import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { 
  X, 
  Send, 
  Copy, 
  RefreshCw, 
  Zap,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  Sparkles,
  Wand2
} from 'lucide-react';
import type { LLMProvider } from '../lib/chat/llm-providers';

interface ModelResponse {
  provider: string;
  model: string;
  response: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
  error?: string;
}

interface MultiModelComparisonProps {
  isOpen: boolean;
  onClose: () => void;
  availableProviders: LLMProvider[];
  currentProvider: string;
  currentModel: string;
}

export default function MultiModelComparison({
  isOpen,
  onClose,
  availableProviders,
  currentProvider,
  currentModel
}: MultiModelComparisonProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedModels, setSelectedModels] = useState<Array<{provider: string, model: string}>>([]);
  const [responses, setResponses] = useState<ModelResponse[]>([]);
  const [isComparing, setIsComparing] = useState(false);

  // Initialize with current model and 2 others
  useEffect(() => {
    if (availableProviders.length > 0 && selectedModels.length === 0) {
      const models: Array<{provider: string, model: string}> = [];
      
      // Add current model
      models.push({ provider: currentProvider, model: currentModel });
      
      // Add 2 more different models
      for (const provider of availableProviders) {
        if (models.length >= 3) break;
        
        for (const model of provider.models) {
          if (models.length >= 3) break;
          
          const exists = models.some(m => m.provider === provider.id && m.model === model);
          if (!exists) {
            models.push({ provider: provider.id, model });
          }
        }
      }
      
      setSelectedModels(models);
    }
  }, [availableProviders, currentProvider, currentModel, selectedModels.length]);

  const handleModelToggle = (provider: string, model: string) => {
    const exists = selectedModels.some(m => m.provider === provider && m.model === model);
    
    if (exists) {
      setSelectedModels(prev => prev.filter(m => !(m.provider === provider && m.model === model)));
    } else if (selectedModels.length < 4) { // Max 4 models
      setSelectedModels(prev => [...prev, { provider, model }]);
    }
  };

  const handleCompare = async () => {
    if (!prompt.trim() || selectedModels.length === 0) return;
    
    setIsComparing(true);
    const startTime = Date.now();
    
    // Initialize responses
    const initialResponses: ModelResponse[] = selectedModels.map(({ provider, model }) => ({
      provider,
      model,
      response: '',
      status: 'pending',
      startTime
    }));
    
    setResponses(initialResponses);
    
    // Send requests to all models simultaneously
    const promises = selectedModels.map(async ({ provider, model }, index) => {
      try {
        setResponses(prev => prev.map((r, i) => 
          i === index ? { ...r, status: 'streaming' } : r
        ));
        
        const token = localStorage.getItem('token');
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            provider,
            model,
            stream: false // For comparison, we want complete responses
          }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const endTime = Date.now();
        
        setResponses(prev => prev.map((r, i) => 
          i === index ? { 
            ...r, 
            response: data.content || data.message || 'No response',
            status: 'complete',
            endTime
          } : r
        ));
        
      } catch (error) {
        const endTime = Date.now();
        setResponses(prev => prev.map((r, i) => 
          i === index ? { 
            ...r, 
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            endTime
          } : r
        ));
      }
    });
    
    await Promise.all(promises);
    setIsComparing(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getStatusIcon = (status: ModelResponse['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-gray-400" />;
      case 'streaming':
        return <Loader2 className="h-4 w-4 text-blue-400 thinking-spinner" />;
      case 'complete':
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-400" />;
    }
  };

  const getResponseTime = (response: ModelResponse) => {
    if (response.endTime) {
      return `${response.endTime - response.startTime}ms`;
    }
    return 'Pending...';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-b from-gray-900 to-black border border-purple-500/30 rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30">
              <Wand2 className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                Multi-Model Comparison
              </h2>
              <p className="text-xs text-white/50">Compare AI responses side-by-side</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30">
              {selectedModels.length} model{selectedModels.length !== 1 ? 's' : ''}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="text-white/60 hover:text-white hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col p-6 gap-5 overflow-hidden">
          {/* Prompt Input */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-white/80 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              Your Prompt
            </label>
            <div className="flex gap-3">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // Submit on Ctrl+Enter or Cmd+Enter
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (prompt.trim() && selectedModels.length > 0 && !isComparing) {
                      handleCompare();
                    }
                  }
                }}
                placeholder="Enter a prompt to compare how different models respond... (Ctrl+Enter to submit)"
                className="flex-1 min-h-[120px] bg-black/60 border-white/10 text-white placeholder:text-white/30 focus:border-purple-500/50 focus:ring-purple-500/20 rounded-lg resize-none"
              />
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleCompare}
                  disabled={!prompt.trim() || selectedModels.length === 0 || isComparing}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white border-0 gap-2"
                >
                  {isComparing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Compare
                </Button>
                {selectedModels.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setResponses([])}
                    disabled={responses.length === 0}
                    className="border-white/10 text-white/60 hover:text-white hover:bg-white/5"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Model Selection - Improved with dropdown-style grouping */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-white/80 flex items-center gap-2">
              <ChevronDown className="h-4 w-4 text-purple-400" />
              Select Models (max 4)
            </label>
            <div className="flex flex-wrap gap-2">
              {availableProviders.map(provider => (
                <div key={provider.id} className="flex flex-wrap gap-1.5">
                  {provider.models.map(model => {
                    const isSelected = selectedModels.some(m => m.provider === provider.id && m.model === model);
                    const isDisabled = !isSelected && selectedModels.length >= 4;
                    return (
                      <button
                        key={`${provider.id}-${model}`}
                        onClick={() => handleModelToggle(provider.id, model)}
                        disabled={isDisabled}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                          isSelected
                            ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                            : isDisabled
                            ? 'bg-white/5 text-white/30 cursor-not-allowed'
                            : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10'
                        }`}
                      >
                        <span className="text-white/60">{provider.name}</span>
                        <span className="mx-1.5 text-white/30">/</span>
                        <span>{model}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Responses Grid */}
          <div className="flex-1 min-h-0">
            {responses.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center border border-purple-500/20">
                    <Zap className="h-8 w-8 text-purple-400" />
                  </div>
                  <p className="text-white/50 text-sm">
                    Enter a prompt and select models to compare
                  </p>
                  <p className="text-white/30 text-xs mt-1">
                    Up to 4 models can be compared simultaneously
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full grid grid-cols-2 gap-4 overflow-auto">
                {responses.map((response, index) => {
                  const providerInfo = availableProviders.find(p => p.id === response.provider);
                  return (
                    <Card 
                      key={`${response.provider}-${response.model}`} 
                      className={`bg-black/60 border rounded-lg overflow-hidden flex flex-col ${
                        response.status === 'complete' ? 'border-green-500/30' :
                        response.status === 'error' ? 'border-red-500/30' :
                        'border-white/10'
                      }`}
                    >
                      <CardHeader className="pb-2 px-4 py-3 bg-black/20 border-b border-white/5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              response.status === 'complete' ? 'bg-green-400' :
                              response.status === 'error' ? 'bg-red-400' :
                              response.status === 'streaming' ? 'bg-purple-400 animate-pulse' :
                              'bg-gray-400'
                            }`} />
                            <CardTitle className="text-sm font-semibold text-white">
                              {providerInfo?.name || response.provider}
                            </CardTitle>
                          </div>
                          {getStatusIcon(response.status)}
                        </div>
                        <div className="flex items-center justify-between text-xs text-white/40 mt-1">
                          <span className="font-mono">{response.model}</span>
                          <span className={response.status === 'error' ? 'text-red-400' : ''}>
                            {getResponseTime(response)}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 p-4 overflow-auto">
                        {response.status === 'error' ? (
                          <div className="text-red-400 text-sm flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            {response.error}
                          </div>
                        ) : response.status === 'pending' ? (
                          <div className="text-white/40 text-sm flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Waiting for response...
                          </div>
                        ) : response.status === 'streaming' ? (
                          <div className="text-purple-400 text-sm flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Generating response...
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
                              {response.response}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopy(response.response)}
                              className="w-full border-white/10 text-white/60 hover:text-white hover:bg-white/5"
                            >
                              <Copy className="h-3 w-3 mr-1" />
                              Copy Response
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}