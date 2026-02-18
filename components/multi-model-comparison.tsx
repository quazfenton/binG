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
  Loader2
} from 'lucide-react';
import type { LLMProvider } from '../lib/api/llm-providers';

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
        
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
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
        return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-white/20 rounded-lg shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-yellow-400" />
            <h2 className="text-lg font-semibold text-white">Multi-Model Comparison</h2>
            <Badge variant="outline" className="text-xs">
              {selectedModels.length} model{selectedModels.length !== 1 ? 's' : ''}
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

        {/* Content */}
        <div className="flex-1 flex flex-col p-4 gap-4">
          {/* Prompt Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">Prompt</label>
            <div className="flex gap-2">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your prompt to compare across models..."
                className="flex-1 min-h-[100px] bg-black/40 border-white/20 text-white"
              />
              <Button
                onClick={handleCompare}
                disabled={!prompt.trim() || selectedModels.length === 0 || isComparing}
                className="self-end"
              >
                {isComparing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Compare
              </Button>
            </div>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">Select Models (max 4)</label>
            <div className="flex flex-wrap gap-2">
              {availableProviders.map(provider =>
                provider.models.map(model => {
                  const isSelected = selectedModels.some(m => m.provider === provider.id && m.model === model);
                  return (
                    <Button
                      key={`${provider.id}-${model}`}
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      onClick={() => handleModelToggle(provider.id, model)}
                      disabled={!isSelected && selectedModels.length >= 4}
                      className="text-xs"
                    >
                      {provider.name}: {model}
                    </Button>
                  );
                })
              )}
            </div>
          </div>

          {/* Responses Grid */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-auto">
            {responses.map((response, index) => (
              <Card key={`${response.provider}-${response.model}`} className="bg-black/40 border-white/20">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-white">
                      {availableProviders.find(p => p.id === response.provider)?.name || response.provider}
                    </CardTitle>
                    {getStatusIcon(response.status)}
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{response.model}</span>
                    <span>{getResponseTime(response)}</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {response.status === 'error' ? (
                      <div className="text-red-400 text-sm">
                        Error: {response.error}
                      </div>
                    ) : (
                      <div className="text-white/90 text-sm max-h-60 overflow-y-auto">
                        {response.response || (response.status === 'pending' ? 'Waiting...' : 'Generating...')}
                      </div>
                    )}
                    {response.response && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopy(response.response)}
                        className="w-full"
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}